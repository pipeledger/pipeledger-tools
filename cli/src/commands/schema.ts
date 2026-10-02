/**
 * pl schema <mart> [--detail concise|full] [--columns a,b] [--format table|json|csv]
 *
 * Policy-filtered schema discovery for one published mart: the same
 * `pl_schema` capability the MCP tool and REST GET /api/v1/schema/{mart}
 * serve. This is a thin client over REST; the CLI only parses flags into the
 * shared request contract and renders the response.
 */

import { Command, InvalidArgumentError } from "commander";
import type { PlSchemaRequest, PlSchemaResult } from "capabilities";
import { ApiClient } from "../lib/client";
import {
  formatOutput,
  parseOutputFormat,
  type OutputFormat,
} from "../lib/output";

export type SchemaDetail = NonNullable<PlSchemaRequest["detail"]>;

export function parseSchemaDetail(value: string): SchemaDetail {
  if (value === "concise" || value === "full") return value;
  throw new InvalidArgumentError(
    `Invalid detail "${value}". Valid: concise, full.`,
  );
}

/** Split a comma list into a bounded, de-duplicated column selector. */
export function parseSchemaColumns(value: string): string[] {
  const columns = Array.from(
    new Set(
      value
        .split(",")
        .map((column) => column.trim())
        .filter((column) => column.length > 0),
    ),
  );
  if (columns.length === 0) {
    throw new InvalidArgumentError(
      "--columns must name at least one column, for example --columns reporting_amount,account_name.",
    );
  }
  if (columns.length > 50) {
    throw new InvalidArgumentError("--columns accepts at most 50 columns.");
  }
  return columns;
}

export function buildSchemaPath(
  mart: string,
  options: { detail?: SchemaDetail; columns?: readonly string[] },
): string {
  const params = new URLSearchParams();
  if (options.detail) params.set("detail", options.detail);
  if (options.columns && options.columns.length > 0) {
    params.set("columns", options.columns.join(","));
  }
  const query = params.toString();
  return `/api/v1/schema/${encodeURIComponent(mart)}${query ? `?${query}` : ""}`;
}

type SchemaColumnRow = PlSchemaResult["columns"][number];

export function toSchemaDisplayRows(
  columns: readonly SchemaColumnRow[],
): Record<string, string | boolean | null>[] {
  // Operator-profile columns render only when at least one returned column
  // carries a profile, so table and CSV headers stay stable per response
  // instead of varying row by row. `pl query` currently expresses scalar
  // equality and `in` for these fields; the rendered profile is the shared
  // capability surface, not a promise of every legacy CLI flag shape.
  const hasSemanticProfiles = columns.some(
    (column) => column.filter_kind !== undefined,
  );
  // filter_behavior renders only when at least one returned column carries it,
  // following the same stable-header rule as the semantic profile columns:
  // "refused" masks reject predicates; "confidential_rows_omitted" masks
  // accept them and omit the protected accounts' rows with disclosure.
  const hasFilterBehavior = columns.some(
    (column) => column.filter_behavior !== undefined,
  );
  return columns.map((column) => ({
    column: column.column_name,
    type: column.data_type,
    filterable: column.filterable,
    groupable: column.groupable,
    group: column.column_group,
    masked: column.masked_by_governance,
    ...(hasFilterBehavior
      ? { filter_behavior: column.filter_behavior ?? "" }
      : {}),
    ...(hasSemanticProfiles
      ? {
          kind: column.filter_kind ?? "",
          row_ops: column.filter_operators?.row.join("|") ?? "",
          agg_ops: column.filter_operators?.aggregation.join("|") ?? "",
        }
      : {}),
    ...("is_nullable" in column ? { nullable: column.is_nullable } : {}),
    ...("description" in column
      ? { description: column.description ?? "" }
      : {}),
  }));
}

export function formatSchemaSummary(schema: PlSchemaResult): string {
  const who = schema.whoami;
  const operatorGrantSummary = who.operator_grants
    ? Object.entries(who.operator_grants)
        .map(([grant, enabled]) => `${grant}=${enabled}`)
        .join(", ")
    : "unavailable (the server did not return effective grants)";
  const lines = [
    `Mart:          ${schema.mart} (${schema.warehouse_table})`,
    `Grain:         ${schema.grain}`,
    `Columns:       ${schema.returned_column_count} returned of ${schema.column_count} visible (${schema.detail})`,
    `Aggregation:   ${schema.aggregation_supported ? "supported" : "row mode only"}`,
    `Catalog:       ${schema.catalog_version}`,
    `Fiscal year:   starts month ${schema.fiscal_calendar.fiscal_year_start_month}, ends month ${schema.fiscal_calendar.fiscal_year_end_month}`,
    `Credential:    role=${who.credential_role}; clearance=${who.clearance}; scope=${who.scope.ledger}; ledger ${who.ledger.complete ? "complete" : "partial"}`,
    `Tools:         ${who.allowed_tools.join(", ") || "none"}`,
    `Op grants:     ${operatorGrantSummary}`,
  ];
  if (schema.recommended_metrics.length > 0) {
    lines.push(
      `Metrics:       ${schema.recommended_metrics.map((metric) => metric.metric_id).join(", ")}`,
    );
  }
  if (schema.period_dimensions.native.length > 0) {
    lines.push(`Period dims:   ${schema.period_dimensions.native.join(", ")}`);
  }
  if (schema.caveats.length > 0) {
    lines.push("", "Caveats:", ...schema.caveats.map((caveat) => `- ${caveat}`));
  }
  return lines.join("\n");
}

export const schemaCommand = new Command("schema")
  .description(
    "Inspect a mart's policy-filtered schema: columns, filters, metrics, fiscal calendar",
  )
  .argument("<mart>", "Mart short name, for example gl_lines")
  .option(
    "--detail <detail>",
    "Column detail: concise (default) or full",
    parseSchemaDetail,
  )
  .option(
    "--columns <a,b>",
    "Comma-separated exact column selector (max 50)",
    parseSchemaColumns,
  )
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table",
  )
  .action(
    async (
      mart: string,
      opts: { detail?: SchemaDetail; columns?: string[]; format: OutputFormat },
    ) => {
      const client = new ApiClient();
      const schema = await client.get<PlSchemaResult>(
        buildSchemaPath(mart, { detail: opts.detail, columns: opts.columns }),
      );

      if (opts.format === "json") {
        console.log(JSON.stringify(schema, null, 2));
        return;
      }
      if (opts.format === "csv") {
        console.log(formatOutput(toSchemaDisplayRows(schema.columns), "csv"));
        return;
      }
      console.log(formatSchemaSummary(schema));
      console.log("");
      console.log(formatOutput(toSchemaDisplayRows(schema.columns), "table"));
    },
  );
