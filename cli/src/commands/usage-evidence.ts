/**
 * pl usage-evidence [--request-id ID...] [--from ISO --to ISO] [--limit N]
 *
 * This credential's own request-level PipeLedger usage evidence: warehouse
 * billed bytes, FIQ units, and billing-record delivery state, correlated by
 * request id.
 *
 * Thin client over POST /api/v1/usage-evidence, the same capability service the
 * MCP `pl_usage_evidence` tool calls.
 *
 * The terminal has no host session, so a scope must be named. Pass --request-id
 * for exact attempts, or --from/--to for an agent-scoped window (defaults to
 * the last 24 hours). This mirrors the MCP door, which can default to its
 * current host session; what either door may SEE is identical and always
 * self-scoped to this credential.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/client";
import { parseLimitOption } from "../lib/option-parsers";
import {
  formatOutput,
  parseOutputFormat,
  type OutputFormat,
} from "../lib/output";

interface UsageAttempt {
  request_id: string;
  created_at: string;
  tool_name: string;
  status: string;
  billable: boolean;
  warehouse: { bytes_billed: number };
  fiq: { units: number };
  billing_record: { status: string | null; delivery_attempts: number | null };
}

interface UsageEvidenceResponse {
  scope: { mode: string; start_time: string | null; end_time: string | null };
  attempts: UsageAttempt[];
  totals: {
    attempts: number;
    billable_attempts: number;
    warehouse_bytes_billed: number;
    fiq_units: number;
    billing_record_quantity: number;
    undelivered_billing_records: number;
  };
  returned_attempt_count: number;
  matched_attempt_count: number;
  truncated: boolean;
  metering_delay_ms: number;
}

export const usageEvidenceCommand = new Command("usage-evidence")
  .description("Show this credential's own usage and billing evidence")
  .option(
    "-r, --request-id <id...>",
    "Exact request ids; takes precedence over a window"
  )
  .option("--from <iso>", "Window start (ISO 8601)")
  .option("--to <iso>", "Window end (ISO 8601)")
  .option(
    "-l, --limit <n>",
    "Maximum request details to return",
    parseLimitOption,
    50
  )
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table"
  )
  .action(
    async (opts: {
      requestId?: string[];
      from?: string;
      to?: string;
      limit: number;
      format: OutputFormat;
    }) => {
      const client = new ApiClient();

      // No host session at a terminal, so name a scope. Exact ids win;
      // otherwise an agent-scoped window, defaulting to the last 24 hours.
      const body: Record<string, unknown> = {
        limit: opts.limit,
      };
      if (opts.requestId?.length) {
        body.request_ids = opts.requestId;
      } else {
        const end = opts.to ?? new Date().toISOString();
        const start =
          opts.from ??
          new Date(Date.parse(end) - 24 * 60 * 60 * 1000).toISOString();
        body.evaluation_scope = "agent";
        body.start_time = start;
        body.end_time = end;
      }

      const data = await client.post<UsageEvidenceResponse>(
        "/api/v1/usage-evidence",
        body
      );

      if (opts.format === "json") {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(
        formatOutput(
          data.attempts.map((attempt) => ({
            request_id: attempt.request_id,
            at: attempt.created_at,
            tool: attempt.tool_name,
            status: attempt.status,
            billed_bytes: attempt.warehouse.bytes_billed,
            fiq: attempt.fiq.units,
            billing: attempt.billing_record.status ?? "-",
          })),
          opts.format
        )
      );

      const totals = data.totals;
      console.log(
        `\n${data.returned_attempt_count} of ${data.matched_attempt_count} attempts` +
          (data.truncated ? " (truncated)" : "")
      );
      console.log(
        `Totals: ${totals.warehouse_bytes_billed} warehouse billed bytes, ` +
          `${totals.fiq_units} FIQ, ${totals.billable_attempts} billable attempts, ` +
          `${totals.undelivered_billing_records} undelivered billing record(s)`
      );
      console.log(
        `\nAn attempt's own event settles after this snapshot, so this lookup ` +
          `cannot include itself; it appears on the next one.`
      );
    }
  );
