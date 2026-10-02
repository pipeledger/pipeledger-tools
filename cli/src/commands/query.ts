/**
 * pl query <mart> [--filter key=value] [--select col1,col2] [--limit N]
 *
 * High-speed JSON egress from BigQuery mart tables.
 * Respects RLS rules enforced server-side -- the CLI cannot bypass them.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/client";
import { formatOutput, parseOutputFormat } from "../lib/output";
import {
  buildQueryRequestBody,
  queryableMartList,
  type QueryRequestBody,
} from "../lib/query";
import type { PublicationSourceProvenance } from "../lib/publication-status";
import { formatPublicationCertificationNotice } from "../lib/publication-status";

interface QueryResponse {
  mode?: "rows" | "aggregated";
  rows: Record<string, unknown>[];
  result_count:
    | { unit: "rows"; returned_row_count: number }
    | { unit: "groups"; returned_group_count: number };
  catalog_version?: string;
  effective_catalog_hash?: string;
  metrics_requested?: string[];
  atomic_columns_used?: string[];
  group_by?: string[];
  source_provenance?: PublicationSourceProvenance & {
    /** The one location bytes are reported; there is no top-level copy. */
    bytes_scanned?: number;
    certified_by?: string;
    run_id?: string | null;
    published_at?: string | null;
    publication_age_seconds?: number;
    mart?: string;
    period_resolved?: {
      label: string;
      start: string;
      end: string;
    };
    staleness_warning?: string;
  };
  notes?: {
    group_by_coverage?: Array<{
      column: string;
      non_null_groups: number;
      null_groups: number;
      split_available: boolean;
    }>;
    truncation?: {
      returned: number;
      limit_applied: number;
      limit_source: "delivery_policy" | "request";
    };
    empty_result?: { hint: string };
    confidential_rows_omitted?: {
      filter_columns: string[];
      rows_omitted_for_confidentiality: true;
    };
  } & Record<string, unknown>;
  clarification_recommended?: boolean;
}

export const queryCommand = new Command("query")
  .description("Query PipeLedger mart tables")
  .argument("<mart>", `Mart short name: ${queryableMartList()}`)
  .option(
    "-f, --filter <filters...>",
    "Filters as key=value pairs. Operators: key.gte=value, key.lt=value, key.in=a,b, key.like=pattern, key.contains_ci=text"
  )
  .option(
    "-s, --select <columns...>",
    "Columns to project, comma-separated or repeated"
  )
  .option(
    "--statement-type <type>",
    "income_statement, balance_sheet, or all. Row-mode only; REST defaults GL/TB row queries to income_statement."
  )
  .option(
    "--time-bucket <bucket>",
    "Semantic period such as current_month, last_month, ytd, trailing_12_months"
  )
  .option(
    "--metrics <metrics...>",
    "Aggregation mode: single-mart finance-catalog metric IDs, comma-separated or repeated; temporal_ratio metrics run through `pl report metric-report`"
  )
  .option(
    "--group-by <columns...>",
    "Aggregation mode: group-by columns, comma-separated or repeated"
  )
  .option(
    "--order-by <column>",
    "Order rows. Row mode: any policy-visible mart column (stable row keys append as tiebreakers). Aggregation mode: a group-by column or any requested metric id (server-side top-N by computed value)"
  )
  .option(
    "--order-direction <dir>",
    "ASC or DESC for --order-by. Defaults to ASC; taxonomy sort keys use ASC for statement order"
  )
  .option("-l, --limit <n>", "Max rows to return (default: 100)", "100")
  .option("--no-limit", "Return all rows (use with caution)")
  .option("-o, --offset <n>", "Offset for pagination", "0")
  .option(
    "--format <fmt>",
    "Output format: json, csv, table",
    parseOutputFormat,
    "json"
  )
  .action(async (mart: string, opts) => {
    const client = new ApiClient();

    // --no-limit sets opts.limit to false (commander boolean negation)
    const limit = opts.limit === false ? undefined : parseInt(opts.limit, 10);
    const body: QueryRequestBody = buildQueryRequestBody({
      mart,
      filters: opts.filter as string[] | undefined,
      select: opts.select as string[] | undefined,
      statementType: opts.statementType as string | undefined,
      timeBucket: opts.timeBucket as string | undefined,
      metrics: opts.metrics as string[] | undefined,
      groupBy: opts.groupBy as string[] | undefined,
      orderBy: opts.orderBy as string | undefined,
      orderDirection: opts.orderDirection as string | undefined,
      ...(limit !== undefined ? { limit } : {}),
      offset: parseInt(opts.offset, 10),
    });

    // REST and MCP both use `mart` as the canonical request field.
    const data = await client.post<QueryResponse>("/api/v1/query", body);

    const output = formatOutput(data.rows, opts.format);
    console.log(output);

    const returnedCount =
      data.result_count.unit === "rows"
        ? data.result_count.returned_row_count
        : data.result_count.returned_group_count;
    const returnedUnit = data.result_count.unit;

    // Print metadata to stderr so it doesn't pollute piped output
    process.stderr.write(
      `\n--- ${returnedCount} ${returnedUnit} returned | ${formatBytes(data.source_provenance?.bytes_scanned ?? 0)} scanned${formatProvenance(data.source_provenance)} ---\n`
    );
    const caveat = formatInsiderCaveat(data.source_provenance);
    if (caveat) process.stderr.write(`--- ${caveat} ---\n`);
    if (data.source_provenance?.staleness_warning) {
      process.stderr.write(
        `--- ${data.source_provenance.staleness_warning} ---\n`
      );
    }
    const certification = formatPublicationCertificationNotice(
      data.source_provenance?.certification
    );
    if (certification) process.stderr.write(`--- ${certification} ---\n`);
    const splitNotice = formatUnavailableSplits(
      data.notes?.group_by_coverage,
      returnedCount
    );
    if (splitNotice) process.stderr.write(`--- ${splitNotice} ---\n`);
    const truncation = data.notes?.truncation;
    if (truncation) {
      const detail =
        truncation.limit_source === "delivery_policy"
          ? `result filled the delivery policy's row cap (${truncation.limit_applied}), tighter than the requested limit — raising --limit cannot help; narrow filters or use --offset`
          : `result filled the requested limit (${truncation.limit_applied}); use --offset / --limit`;
      process.stderr.write(
        `--- Possibly incomplete: ${detail}; more rows may exist. ---\n`
      );
    }
    if (data.notes?.empty_result) {
      process.stderr.write(`--- ${data.notes.empty_result.hint} ---\n`);
    }
    const omissionNotice = formatConfidentialOmissionNotice(
      data.notes?.confidential_rows_omitted
    );
    if (omissionNotice) process.stderr.write(`--- ${omissionNotice} ---\n`);
  });

/**
 * CLI rendering of the structured confidential_rows_omitted note. Wording
 * mirrors mart-query's describeConfidentialOmission so every text surface
 * says the same thing wherever the structured note appears.
 */
export function formatConfidentialOmissionNotice(
  note:
    | { filter_columns: string[]; rows_omitted_for_confidentiality: true }
    | undefined
): string | null {
  if (!note || note.filter_columns.length === 0) return null;
  return `Rows from confidentiality-protected accounts were omitted from this filtered result because the query referenced ${note.filter_columns.join(", ")}; unfiltered queries still show those rows with protected fields masked.`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatProvenance(
  provenance: QueryResponse["source_provenance"] | undefined
): string {
  if (!provenance) return "";
  const parts: string[] = [];
  if (provenance.published_at) parts.push(`published ${provenance.published_at}`);
  if (provenance.period_resolved?.label) {
    parts.push(`period ${provenance.period_resolved.label}`);
  }
  if (provenance.release_channel) parts.push(`channel ${provenance.release_channel}`);
  return parts.length > 0 ? ` | ${parts.join(" | ")}` : "";
}

function formatUnavailableSplits(
  coverage:
    | Array<{ column: string; split_available: boolean }>
    | undefined,
  totalRows: number | undefined
): string | null {
  if (!Array.isArray(coverage)) return null;
  // Mirror of mart-query's describeUnavailableSplits totalRows guard (the
  // wording source of truth): with zero delivered rows every split is
  // vacuously unavailable and the empty_result hint owns the case —
  // printing both would contradict itself.
  if ((totalRows ?? 0) === 0) return null;
  const unavailable = coverage.filter((entry) => entry.split_available === false);
  if (unavailable.length === 0) return null;
  const columns = unavailable.map((entry) => entry.column).join(", ");
  return `Split unavailable: no delivered rows carry a value for ${columns}; the result is a single unassigned group. Overall totals remain valid.`;
}

function formatInsiderCaveat(
  provenance: QueryResponse["source_provenance"] | undefined
): string | null {
  if (!provenance?.is_unreleased_insider) return null;
  const release = provenance.release_at ? ` before ${provenance.release_at}` : "";
  return `Insider channel: this query used a pre-release snapshot. Do not share externally${release}.`;
}
