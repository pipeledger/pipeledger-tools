/**
 * pl audit tail [--since <timestamp>] [--actions <action1,action2>]
 *
 * Real-time stream of audit_logs via Server-Sent Events.
 * Reconnects automatically on timeout (Vercel 60s limit).
 * Includes bytes_scanned metadata for FIQ cost observability.
 */

import { Command, InvalidArgumentError } from "commander";
import {
  ApiClient,
  ApiClientError,
  parseReviewedCustomerProblem,
} from "../lib/client";
import { LocalCliError } from "../lib/local-error";
import {
  parseJsonOrTableFormat,
  type JsonOrTableFormat,
} from "../lib/output";

export interface AuditEvent {
  cursor: string;
  timestamp: string;
  action: string;
  resource_type: string;
}

interface AuditTailOptions {
  since?: string;
  actions?: string;
  limit: number | false;
  format: JsonOrTableFormat;
}

interface AuditTailRuntime {
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  onEvent?: (event: AuditEvent) => void;
  writeStatus?: (message: string) => void;
}

const MAX_SERVER_LIMIT = 500;

export const auditCommand = new Command("audit").description(
  "Audit trail management"
);

auditCommand
  .command("tail")
  .description("Stream real-time audit log events (requires pl_audit)")
  .option(
    "--since <timestamp>",
    "Start after an ISO 8601 timestamp with timezone",
  )
  .option("--actions <list>", "Comma-separated action filter")
  .option(
    "-l, --limit <n>",
    `Max events per fetch, 1-${MAX_SERVER_LIMIT}`,
    parseAuditLimit,
    100,
  )
  .option(
    "--no-limit",
    `Use the server maximum of ${MAX_SERVER_LIMIT} events per fetch`,
  )
  .option(
    "--format <fmt>",
    "Output format: table or newline-delimited JSON",
    parseJsonOrTableFormat,
    "table",
  )
  .action(async (opts: AuditTailOptions) => {
    const client = new ApiClient();
    await tailAuditEvents(client, opts);
  });

export async function tailAuditEvents(
  client: Pick<ApiClient, "stream">,
  opts: AuditTailOptions,
  runtime: AuditTailRuntime = {},
): Promise<void> {
  let since = opts.since ?? "";
  let cursor = "";
  const actions = opts.actions ?? "";
  if (since && !isIsoTimestamp(since)) {
    throw new LocalCliError(
      "Invalid --since value. Expected an ISO 8601 timestamp with timezone.",
      "E_CLI_INPUT",
    );
  }

  const sleep = runtime.sleep ?? delay;
  const writeStatus =
    runtime.writeStatus ??
    ((message) => {
      process.stderr.write(message);
    });
  const onEvent =
    runtime.onEvent ??
    ((event) => {
      if (opts.format === "json") {
        console.log(JSON.stringify(event));
      } else {
        printAuditEvent(event);
      }
    });

  writeStatus("Streaming audit events (Ctrl+C to stop)...\n");

  // Reconnection loop -- handles Vercel SSE timeouts and transient network loss.
  while (!runtime.signal?.aborted) {
    try {
      const params = new URLSearchParams();
      if (cursor) {
        params.set("cursor", cursor);
      } else if (since) {
        params.set("since", since);
      }
      if (actions) params.set("actions", actions);
      const limit = opts.limit === false ? MAX_SERVER_LIMIT : opts.limit;
      params.set("limit", String(limit));

      const queryStr = params.toString();
      const path = `/api/v1/audit/tail${queryStr ? `?${queryStr}` : ""}`;
      const response = await client.stream(path);

      await consumeAuditStream(response, (event) => {
        onEvent(event);
        cursor = event.cursor;
        since = "";
      });

      if (runtime.signal?.aborted) return;
      writeStatus("[audit stream closed; reconnecting...]\n");
      await sleep(1000);
    } catch (error) {
      if (!isReconnectableAuditError(error)) throw error;
      if (runtime.signal?.aborted) return;

      // Never echo raw network/provider errors. ApiClient and protocol errors
      // have already been reduced to reviewed, stable customer-safe classes.
      writeStatus("[audit connection lost; reconnecting...]\n");
      const retryAfterMs =
        error instanceof ApiClientError && error.retryAfterSeconds !== undefined
          ? error.retryAfterSeconds * 1000
          : 5000;
      await sleep(retryAfterMs);
    }
  }
}

async function consumeAuditStream(
  response: Response,
  onEvent: (event: AuditEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new LocalCliError(
      "The audit stream returned no response body. Reconnecting may restore the stream.",
      "E_CLI_NETWORK",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "message";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventType = "message";
      return;
    }
    const payload = dataLines.join("\n").trim();
    const dispatchedType = eventType;
    eventType = "message";
    dataLines = [];
    if (payload === "[HEARTBEAT]") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch {
      throw new LocalCliError(
        "The audit stream returned malformed data. Reconnecting may restore the stream.",
        "E_CLI_NETWORK",
      );
    }

    if (dispatchedType === "error") {
      const problem = parseReviewedCustomerProblem(parsed);
      if (!problem) {
        throw new LocalCliError(
          "The audit stream returned an invalid error event. Reconnecting may restore the stream.",
          "E_CLI_NETWORK",
        );
      }
      throw ApiClientError.fromProblem(problem);
    }

    onEvent(parseAuditEvent(parsed));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.length === 0) {
        dispatch();
      } else if (line.startsWith("event:")) {
        eventType = line.slice("event:".length).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0 && buffer.startsWith("data:")) {
    dataLines.push(buffer.slice("data:".length).trimStart());
  }
  dispatch();
}

function isReconnectableAuditError(error: unknown): boolean {
  return (
    (error instanceof LocalCliError && error.code === "E_CLI_NETWORK") ||
    (error instanceof ApiClientError && error.retryable === true)
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseAuditLimit(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new InvalidArgumentError("Audit limit must be a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_SERVER_LIMIT) {
    throw new InvalidArgumentError(
      `Audit limit must be from 1 through ${MAX_SERVER_LIMIT}.`,
    );
  }
  return parsed;
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

export function parseAuditEvent(value: unknown): AuditEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalCliError(
      "The audit stream returned an invalid event. Reconnecting may restore the stream.",
      "E_CLI_NETWORK",
    );
  }
  const event = value as Record<string, unknown>;
  if (
    typeof event.timestamp !== "string" ||
    !isIsoTimestamp(event.timestamp) ||
    typeof event.cursor !== "string" ||
    !/^[A-Za-z0-9_-]{1,400}$/.test(event.cursor) ||
    typeof event.action !== "string" ||
    typeof event.resource_type !== "string"
  ) {
    throw new LocalCliError(
      "The audit stream returned an invalid event. Reconnecting may restore the stream.",
      "E_CLI_NETWORK",
    );
  }
  return {
    cursor: event.cursor,
    timestamp: event.timestamp,
    action: event.action,
    resource_type: event.resource_type,
  } as AuditEvent;
}

function printAuditEvent(event: AuditEvent): void {
  const ts = new Date(event.timestamp).toISOString().replace("T", " ").slice(0, 19);
  const action = event.action.padEnd(24);

  console.log(`${ts}  ${action} ${event.resource_type}`);
}
