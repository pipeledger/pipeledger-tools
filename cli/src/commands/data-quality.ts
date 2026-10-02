/**
 * pl data-quality [--mart gl_lines]
 *
 * Whether each enabled mart is ready, awaiting approval, blocked, or not yet
 * materialized. Omitting --mart is scan-free by contract: readiness comes from
 * control-plane evidence and costs zero BigQuery bytes. Naming a mart adds at
 * most one policy-scoped diagnostic scan.
 *
 * Thin client over GET /api/v1/data-quality, which is the same capability
 * service the MCP `pl_data_quality` tool calls, so all three doors report the
 * same readiness.
 *
 * For public vs Corporate Insider publication windows, use `pl
 * published-status`: that is a different question (when insider data becomes
 * public) and remains its own surface.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/client";
import {
  formatOutput,
  parseOutputFormat,
  type OutputFormat,
} from "../lib/output";

interface DataQualityMartRow {
  mart: string;
  label: string;
  status: string;
  status_reason: string;
  issues: Array<{ code: string; severity: string; summary: string }>;
}

interface DataQualityResponse {
  mode: "targeted" | "overview";
  overall_status: string;
  quality_statement: string;
  summary: {
    evaluated_mart_count: number;
    status_counts: Record<string, number>;
  };
  marts: DataQualityMartRow[];
  diagnostic_execution: {
    mart_scan_performed: boolean;
    query_count: number;
    bytes_processed: number;
  };
  targeted_diagnostics: {
    available: boolean;
    unavailable_reason: string | null;
    authorized_row_count: number | null;
    signals: Array<{ code: string; label: string; value: number; unit: string }>;
  } | null;
}

export const dataQualityCommand = new Command("data-quality")
  .description("Check whether enabled marts are ready to use")
  .option("-m, --mart <mart>", "Mart short name for a scoped diagnostic scan")
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table"
  )
  .action(async (opts: { mart?: string; format: OutputFormat }) => {
    const client = new ApiClient();
    const params = new URLSearchParams();
    if (opts.mart) params.set("mart", opts.mart);
    const path = `/api/v1/data-quality${
      params.size > 0 ? `?${params.toString()}` : ""
    }`;

    const data = await client.get<DataQualityResponse>(path);

    if (opts.format === "json") {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const rows = data.marts.map((mart) => ({
      mart: mart.mart,
      status: mart.status,
      issues: mart.issues.length,
      reason: mart.status_reason,
    }));
    console.log(formatOutput(rows, opts.format));

    console.log(`\nOverall: ${data.overall_status}`);
    if (data.targeted_diagnostics?.available) {
      const diagnostics = data.targeted_diagnostics;
      console.log(
        `Authorized rows: ${diagnostics.authorized_row_count ?? "n/a"}`
      );
      for (const signal of diagnostics.signals) {
        console.log(`  ${signal.label}: ${signal.value}`);
      }
    } else if (data.targeted_diagnostics) {
      console.log(
        `Scoped diagnostics unavailable: ${data.targeted_diagnostics.unavailable_reason}`
      );
    }
    if (data.diagnostic_execution.mart_scan_performed) {
      console.log(
        `Scan: ${data.diagnostic_execution.query_count} query, ${data.diagnostic_execution.bytes_processed} bytes`
      );
    }
    console.log(`\n${data.quality_statement}`);
  });
