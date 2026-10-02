import { CommanderError } from "commander";
import { ApiClientError } from "./client";
import { LocalCliError } from "./local-error";
import type { OutputFormat } from "./output";
import { redactCredentials } from "shared/src/public-client";

const UNKNOWN_CLI_ERROR_MESSAGE =
  "PipeLedger CLI could not complete the command. Review the command and try again; if the problem continues, contact PipeLedger support.";

export function outputFormatFromArgv(argv: readonly string[]): OutputFormat {
  if (argv.includes("--json")) return "json";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--format") {
      const next = argv[index + 1];
      if (next === "json" || next === "csv" || next === "table") return next;
    }
    if (value?.startsWith("--format=")) {
      const format = value.slice("--format=".length);
      if (format === "json" || format === "csv" || format === "table") {
        return format;
      }
    }
  }

  // `pl query` defaults to JSON; all other current commands default to a
  // human presentation unless they explicitly opt into JSON.
  return argv[2] === "query" ? "json" : "table";
}

export function formatCliError(
  error: unknown,
  format: OutputFormat,
): string {
  if (error instanceof ApiClientError) {
    if (format === "json") {
      return JSON.stringify(error.toJSON(), null, 2);
    }
    return formatApiClientError(error);
  }

  const isReviewedLocalError =
    error instanceof LocalCliError || error instanceof CommanderError;
  const message = isReviewedLocalError
    ? error.message
    : UNKNOWN_CLI_ERROR_MESSAGE;
  if (format === "json") {
    return JSON.stringify(
      {
        error: message,
        code:
          error instanceof LocalCliError
            ? error.code
            : error instanceof CommanderError
              ? "E_CLI_INPUT"
              : "E_CLI_INTERNAL",
      },
      null,
      2,
    );
  }
  return message;
}

function formatApiClientError(error: ApiClientError): string {
  const lines = [terminalLine(error.customerDetail)];
  if (error.code) lines.push(`Code: ${error.code}`);
  if (error.correlationId) lines.push(`Reference: ${error.correlationId}`);

  const fieldErrors = error.problem?.field_errors ?? [];
  if (fieldErrors.length > 0) {
    lines.push("Invalid fields:");
    for (const fieldError of fieldErrors.slice(0, 10)) {
      const path = formatFieldPath(fieldError.path);
      lines.push(`- ${path}: ${terminalLine(fieldError.message)}`);
    }
    if (fieldErrors.length > 10) {
      lines.push(`- …and ${fieldErrors.length - 10} more`);
    }
  }

  const nextStep =
    error.remediation ??
    recoveryInstruction(error.recovery) ??
    (error.statusCode === 401
      ? "Run `pl login` to authenticate again."
      : undefined);
  if (nextStep) lines.push(`Next step: ${terminalLine(nextStep)}`);
  if (error.retryAfterSeconds !== undefined) {
    lines.push(`Retry after: ${error.retryAfterSeconds} seconds`);
  }
  return lines.join("\n");
}

function formatFieldPath(path: Array<string | number>): string {
  if (path.length === 0) return "request";
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${segment}]`
        : `${index === 0 ? "" : "."}${terminalLine(segment)}`,
    )
    .join("");
}

function terminalLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recoveryInstruction(recovery: ApiClientError["recovery"]): string | null {
  switch (recovery) {
    case "correct_input":
      return "Correct the command input and try again.";
    case "retry":
      return "Try the command again.";
    case "wait":
      return "Wait for the current operation, then check its status.";
    case "reconnect":
      return "Reconnect or authenticate again, then retry.";
    case "request_access":
      return "Request access from an organization owner or administrator.";
    case "admin_action":
      return "Ask an organization administrator to resolve the configuration.";
    case "contact_support":
      return "Contact PipeLedger support with the reference above.";
    case "none":
    case undefined:
      return null;
  }
}

export function writeCliError(
  error: unknown,
  argv: readonly string[],
): void {
  const format = outputFormatFromArgv(argv);
  // Every CLI error leaves through here, which makes it the one place worth
  // masking. Error paths are where secrets escape: a serialized config, a
  // request echoed back with its Authorization header, a stack frame holding
  // the client. This is echo protection, not a boundary -- the boundary is
  // not putting the secret in the message in the first place.
  process.stderr.write(`${redactCredentials(formatCliError(error, format))}\n`);
}
