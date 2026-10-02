/**
 * `pl report` - the CLI face of `pl_report`.
 *
 * All four subcommands post to their `/api/v1/reports/*` path and render ONE
 * response shape: the capability service result. There is no CLI-side report
 * logic, no per-report response type, and no second formatter family; a
 * statement rendered here has the same lines, provenance, certification, and
 * caveats an MCP host sees.
 *
 * Handles (`drilldown_handle`, `save_handle`) are returned by every door and
 * are printed only by `--format json`; the table format is a human read, and
 * `pl drilldown` / `pl report-library` are a later run.
 */

import { Command, InvalidArgumentError } from "commander";
import { requireConfig } from "../lib/config";
import { ApiClient } from "../lib/client";
import { parseOutputFormat, type OutputFormat } from "../lib/output";
import { martShortNameForTable } from "../lib/vocabulary";
import {
  calendarMonthFromDate,
  writePublicationNotice,
} from "../lib/publication-status";

// ─── Response shape (one per door) ───────────────────────────────────────────

export interface ReportLine {
  line_type: "metric" | "modeled_statement_line";
  line_id: string;
  metric_id?: string;
  label: string;
  kind: string;
  value: number | null;
  value_format: "currency" | "multiple" | "percentage" | "quantity";
  unit_of_measure?: string | null;
  reporting_currency?: string | null;
  comparison_value?: number | null;
  variance?: number | null;
  variance_pct?: number | null;
  metric_version?: string;
  definition_hash?: string;
  source_mart?: string | null;
  source_execution_id?: string | null;
  grain?: string;
  period_context?: { basis: string; period_label: string };
  temporal_ratio_calculation?: {
    calculation:
      | "activity_over_average_balance"
      | "ending_balance_over_activity"
      | "activity_over_ending_balance";
    flow_window: string;
    annualization: "none";
    numerator: {
      metric_id: string;
      definition_hash: string;
      basis: "activity_window" | "opening_closing_average" | "ending_balance";
      value: number;
      source_execution_id: string;
    };
    denominator: {
      metric_id: string;
      definition_hash: string;
      basis: "activity_window" | "opening_closing_average" | "ending_balance";
      value: number;
      source_execution_id: string;
    };
    balance_snapshots:
      | {
          basis: "opening_closing_average";
          operand: "numerator" | "denominator";
          opening: { as_of: string; value: number };
          closing: { as_of: string; value: number };
          average: number;
        }
      | {
          basis: "ending_balance";
          operand: "numerator" | "denominator";
          ending: { as_of: string; value: number };
        };
    calculation_status: "calculated" | "denominator_zero";
  };
  drilldown_handle?: string;
  supported_target_grains?: readonly string[];
}

export interface ReportSection {
  section_id: string;
  section_label: string;
  lines: ReportLine[];
}

export interface ReportSourceProvenance {
  mart: string;
  run_id: string;
  published_at: string;
  publication_age_seconds: number;
  bytes_scanned: number;
  release_channel: "public" | "insider";
  publication_id: string | null;
  release_at: string | null;
  is_unreleased_insider: boolean;
  certification?: { outcome?: string };
}

export interface ReportPeriod {
  basis: string;
  label: string;
  fiscal_year?: number;
  as_of?: string;
}

export interface ReportResponse {
  org_name: string;
  report_type: string;
  report_label: string;
  period: ReportPeriod;
  comparison_period?: ReportPeriod;
  report_coverage?: { coverage_label: string } | null;
  comparison_coverage?: { coverage_label: string } | null;
  catalog_version: string;
  effective_catalog_hash: string;
  sections: ReportSection[];
  sources: ReportSourceProvenance[];
  reporting_currency: string | null;
  accounting_book?: { book_id?: string | null; book_name?: string | null };
  reporting_legal_entity_id?: string;
  report_scope?: {
    current_period: {
      reporting_legal_entities: Array<{
        reporting_legal_entity_id: string;
        legal_entity_name: string | null;
      }>;
    };
    comparison_period?: {
      reporting_legal_entities: Array<{
        reporting_legal_entity_id: string;
        legal_entity_name: string | null;
      }>;
    };
  };
  cash_flow_method?: "indirect" | "direct";
  cash_flow_certification?: {
    status: string;
    method?: string;
    direct_method_preview?: boolean;
    quality_details_withheld?: boolean;
    reasons?: readonly string[];
  };
  equation_check?: string;
  equation_delta?: number;
  modeled_total_assets?: number;
  modeled_total_liabilities_and_equity?: number;
  definition_comparison?: {
    metric_id: string;
    baseline: { metric_revision: number };
    target: { metric_revision: number };
    delta: {
      direction: string;
      absolute_change: number | null;
      percentage_point_change: number | null;
      relative_change: number | null;
    };
  };
  save_handle?: string;
  caveats: string[];
}

export type CashFlowMethod = "indirect" | "direct";

// ─── Value formatting ────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string | null): string {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * `value_format` decides the rendering, never the metric's label or section.
 * The canonical stored value for a percentage ratio is the raw quotient
 * (0.40 for 40%); only the human formatter multiplies by 100.
 */
export function formatReportValue(
  line: Pick<ReportLine, "value" | "value_format" | "unit_of_measure">,
  reportingCurrency: string | null
): string {
  if (line.value === null || line.value === undefined) return "unavailable";
  switch (line.value_format) {
    case "percentage":
      return `${(line.value * 100).toFixed(2)}%`;
    case "multiple":
      return `${line.value.toFixed(2)}x`;
    case "quantity":
      return line.unit_of_measure
        ? `${line.value.toLocaleString("en-US")} ${line.unit_of_measure}`
        : line.value.toLocaleString("en-US");
    default:
      return formatCurrency(line.value, reportingCurrency);
  }
}

/**
 * A variance on a percentage line is a percentage-POINT difference, while
 * `variance_pct` stays relative change. Rendering them the same way would
 * misstate both.
 */
export function formatReportVariance(
  line: ReportLine,
  reportingCurrency: string | null
): string {
  if (line.variance === null || line.variance === undefined) return "";
  switch (line.value_format) {
    case "percentage":
      return `${(line.variance * 100).toFixed(2)} pp`;
    case "multiple":
      return `${line.variance.toFixed(2)}x`;
    case "quantity":
      return line.variance.toLocaleString("en-US");
    default:
      return formatCurrency(line.variance, reportingCurrency);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function totalBytesScanned(data: ReportResponse): number {
  return data.sources.reduce((total, source) => total + source.bytes_scanned, 0);
}

export function dryRunAuthorizationLine(): string {
  return "  Authorization: Bearer <redacted>";
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.split('"').join('""')}"` : value;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export function formatReportTable(data: ReportResponse): string {
  const currency = data.reporting_currency;
  const lines: string[] = [];
  lines.push(`${data.report_label} - ${data.org_name}`);
  lines.push(
    `Period: ${data.period.label}` +
      (data.comparison_period
        ? `   Comparison: ${data.comparison_period.label}`
        : "")
  );
  if (data.report_coverage) {
    lines.push(`Coverage: ${data.report_coverage.coverage_label}`);
  }
  if (data.comparison_coverage) {
    lines.push(`Comparison coverage: ${data.comparison_coverage.coverage_label}`);
  }
  if (data.reporting_legal_entity_id) {
    lines.push(`Legal Entity: ${data.reporting_legal_entity_id}`);
  }
  lines.push(
    `Currency: ${currency ?? "unavailable"}   Catalog: ${data.catalog_version}` +
      (data.cash_flow_method ? `   Method: ${data.cash_flow_method}` : "")
  );
  lines.push("");

  const showComparison = data.comparison_period !== undefined;
  const labelWidth = Math.max(
    28,
    ...data.sections.flatMap((section) =>
      section.lines.map((line) => line.label.length)
    )
  );
  for (const section of data.sections) {
    lines.push(section.section_label);
    for (const line of section.lines) {
      const value = formatReportValue(line, currency).padStart(20);
      if (!showComparison) {
        lines.push(`  ${line.label.padEnd(labelWidth)}${value}`);
        continue;
      }
      const comparison =
        line.comparison_value === null || line.comparison_value === undefined
          ? "unavailable"
          : formatReportValue(
              { ...line, value: line.comparison_value },
              currency
            );
      const variance = formatReportVariance(line, currency);
      lines.push(
        `  ${line.label.padEnd(labelWidth)}${value}${comparison.padStart(20)}${variance.padStart(20)}`
      );
    }
    lines.push("");
  }

  if (data.equation_check) {
    lines.push(
      `Accounting equation: ${data.equation_check}` +
        (data.equation_delta !== undefined
          ? ` (delta ${formatCurrency(data.equation_delta, currency)})`
          : "")
    );
  }
  if (data.cash_flow_certification) {
    lines.push(
      `Cash-flow certification: ${data.cash_flow_certification.status}`
    );
  }
  if (data.definition_comparison) {
    const comparison = data.definition_comparison;
    lines.push(
      `Definition impact for ${comparison.metric_id}: revision ${comparison.baseline.metric_revision} vs ${comparison.target.metric_revision} (${comparison.delta.direction})`
    );
  }
  if (data.report_scope) {
    const entities = data.report_scope.current_period.reporting_legal_entities;
    lines.push(
      `Reporting Legal Entities: ${
        entities.length === 0
          ? "none returned"
          : entities
              .map(
                (entity) =>
                  entity.legal_entity_name ?? entity.reporting_legal_entity_id
              )
              .join(", ")
      }`
    );
  }
  for (const caveat of data.caveats) lines.push(`Note: ${caveat}`);
  lines.push("");
  lines.push(
    `${data.sources.length} published source${data.sources.length === 1 ? "" : "s"}; ${formatBytes(totalBytesScanned(data))} scanned`
  );
  return lines.join("\n");
}

export function formatReportCsv(data: ReportResponse): string {
  const rows: string[] = [];
  rows.push(
    [
      "section_id",
      "section_label",
      "line_id",
      "metric_id",
      "label",
      "value",
      "value_format",
      "comparison_value",
      "variance",
      "variance_pct",
      "reporting_currency",
      "source_mart",
      "metric_version",
      "definition_hash",
    ].join(",")
  );
  for (const section of data.sections) {
    for (const line of section.lines) {
      rows.push(
        [
          csvCell(section.section_id),
          csvCell(section.section_label),
          csvCell(line.line_id),
          csvCell(line.metric_id ?? ""),
          csvCell(line.label),
          line.value === null || line.value === undefined
            ? ""
            : String(line.value),
          csvCell(line.value_format),
          line.comparison_value === null || line.comparison_value === undefined
            ? ""
            : String(line.comparison_value),
          line.variance === null || line.variance === undefined
            ? ""
            : String(line.variance),
          line.variance_pct === null || line.variance_pct === undefined
            ? ""
            : String(line.variance_pct),
          csvCell(line.reporting_currency ?? data.reporting_currency ?? ""),
          csvCell(line.source_mart ?? ""),
          csvCell(line.metric_version ?? ""),
          csvCell(line.definition_hash ?? ""),
        ].join(",")
      );
    }
  }
  return rows.join("\n");
}

export function formatReportProvenanceSummary(data: ReportResponse): string {
  return data.sources
    .map(
      (source) =>
        `${source.mart}: run ${source.run_id} published ${source.published_at} (${source.release_channel})`
    )
    .join("\n");
}

// ─── Option parsers ──────────────────────────────────────────────────────────

export function parseCashFlowMethod(value: string): CashFlowMethod {
  if (value !== "indirect" && value !== "direct") {
    throw new InvalidArgumentError("--method must be indirect or direct");
  }
  return value;
}

export function parseReportFiscalYear(value: string): number {
  const match = /^(?:FY\s*)?(\d{4})$/i.exec(value.trim());
  if (!match) {
    throw new InvalidArgumentError(
      "fiscal year must be a four-digit year such as 2026 or FY2026"
    );
  }
  const year = Number.parseInt(match[1]!, 10);
  if (year < 2000 || year > 2100) {
    throw new InvalidArgumentError(
      "fiscal year must be between 2000 and 2100"
    );
  }
  return year;
}

/** Kept name for the existing option wiring and tests. */
export const parseCashFlowFiscalYear = parseReportFiscalYear;

export function parseMetricReportMetricIds(values: string[]): string[] {
  const metricIds = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (metricIds.length === 0) {
    throw new InvalidArgumentError(
      "--metrics requires at least one governed metric ID"
    );
  }
  if (new Set(metricIds).size !== metricIds.length) {
    throw new InvalidArgumentError(
      "--metrics must not contain duplicate metric IDs"
    );
  }
  return metricIds;
}

export function parseDefinitionComparisonRevision(value: string): number {
  const revision = Number.parseInt(value, 10);
  if (!Number.isInteger(revision) || revision <= 0) {
    throw new InvalidArgumentError(
      "--definition-comparison-baseline-revision must be a positive integer"
    );
  }
  return revision;
}

// ─── Shared execution ────────────────────────────────────────────────────────

interface RunReportInput {
  path: string;
  body: Record<string, unknown>;
  dryRun: boolean;
  format: OutputFormat;
  dryRunNote?: string;
}

async function runReport(input: RunReportInput): Promise<void> {
  const config = requireConfig();
  if (input.dryRun) {
    console.log("Dry run -- the following API call would be made:\n");
    console.log(`  POST ${config.api_url}${input.path}`);
    console.log(dryRunAuthorizationLine());
    console.log(`  Body: ${JSON.stringify(input.body)}`);
    if (input.dryRunNote) console.log(`\n  ${input.dryRunNote}`);
    return;
  }

  const client = new ApiClient();
  const data = await client.post<ReportResponse>(input.path, input.body);

  if (input.format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else if (input.format === "csv") {
    console.log(formatReportCsv(data));
  } else {
    console.log(formatReportTable(data));
  }

  // The accounting equation failing is a control failure, not a formatting
  // detail: it goes to stderr so a piped `--format json` consumer still sees it.
  if (data.equation_check === "FAIL") {
    process.stderr.write(
      "\nCRITICAL: the modeled accounting equation does not balance for this Balance Sheet. Do not rely on these positions until the control passes.\n"
    );
  }
  process.stderr.write(`\n${formatReportProvenanceSummary(data)}\n`);
  for (const source of data.sources) {
    const martShortName = martShortNameForTable(source.mart);
    await writePublicationNotice({
      client,
      mart: martShortName,
      martLabel: martShortName.replace(/_/g, " "),
      calendarMonth: calendarMonthFromDate(data.period.as_of),
      sourceProvenance: {
        run_id: source.run_id,
        published_at: source.published_at,
        mart: source.mart,
        release_channel: source.release_channel,
        publication_id: source.publication_id,
        release_at: source.release_at,
        is_unreleased_insider: source.is_unreleased_insider,
      },
    });
  }
}

function comparisonPeriodFrom(opts: {
  compareFiscalYear?: number;
  compareAsOf?: string;
}): Record<string, unknown> | undefined {
  if (opts.compareFiscalYear === undefined && opts.compareAsOf === undefined) {
    return undefined;
  }
  return {
    ...(opts.compareFiscalYear !== undefined
      ? { fiscal_year: opts.compareFiscalYear }
      : {}),
    ...(opts.compareAsOf !== undefined ? { as_of: opts.compareAsOf } : {}),
  };
}

function withSharedOptions(command: Command): Command {
  return command
    .option(
      "--reporting-legal-entity-id <id>",
      "Exact governed reporting Legal Entity id; omit to include every authorized Legal Entity"
    )
    .option("--catalog-version <version>", "Finance catalog version")
    .option("--exclude-intercompany", "Exclude controller-tagged intercompany accounts (supported GL reports only)")
    .option(
      "--format <fmt>",
      "Output format: table, json, csv",
      parseOutputFormat,
      "table"
    )
    .option("--dry-run", "Show the API call without executing");
}

function sharedBody(opts: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(opts.excludeIntercompany === true ? { exclude_intercompany: true } : {}),
    ...(opts.reportingLegalEntityId !== undefined
      ? { reporting_legal_entity_id: opts.reportingLegalEntityId as string }
      : {}),
    ...(opts.catalogVersion !== undefined
      ? { catalog_version: opts.catalogVersion as string }
      : {}),
  };
}

// ─── Commands ────────────────────────────────────────────────────────────────

export const incomeStatementCommand = withSharedOptions(
  new Command("income-statement")
    .description("Income Statement for a fiscal year")
    .option("--fiscal-year <year>", "Activity fiscal year", parseReportFiscalYear)
    .option(
      "--compare-fiscal-year <year>",
      "Comparison activity fiscal year",
      parseReportFiscalYear
    )
).action(async (opts) => {
  const comparison = comparisonPeriodFrom(opts);
  await runReport({
    path: "/api/v1/reports/income-statement",
    body: {
      ...(opts.fiscalYear !== undefined
        ? { fiscal_year: opts.fiscalYear as number }
        : {}),
      ...(comparison ? { comparison_period: comparison } : {}),
      ...sharedBody(opts),
    },
    dryRun: Boolean(opts.dryRun),
    format: opts.format as OutputFormat,
  });
});

export const balanceSheetCommand = withSharedOptions(
  new Command("balance-sheet")
    .description("Balance Sheet as of a month-end date")
    .option("--as-of <date>", "Point-in-time date in YYYY-MM-DD format")
    .option(
      "--compare-as-of <date>",
      "Comparison point-in-time date in YYYY-MM-DD format"
    )
).action(async (opts) => {
  const comparison = comparisonPeriodFrom(opts);
  await runReport({
    path: "/api/v1/reports/balance-sheet",
    body: {
      ...(opts.asOf !== undefined ? { as_of: opts.asOf as string } : {}),
      ...(comparison ? { comparison_period: comparison } : {}),
      ...sharedBody(opts),
    },
    dryRun: Boolean(opts.dryRun),
    format: opts.format as OutputFormat,
  });
});

export const cashFlowStatementCommand = withSharedOptions(
  new Command("cash-flow-statement")
    .description("Cash Flow Statement for a fiscal year")
    .option("--fiscal-year <year>", "Activity fiscal year", parseReportFiscalYear)
    .option(
      "--compare-fiscal-year <year>",
      "Comparison activity fiscal year",
      parseReportFiscalYear
    )
    .option(
      "--method <method>",
      "Presentation method: indirect or direct",
      parseCashFlowMethod
    )
).action(async (opts) => {
  const comparison = comparisonPeriodFrom(opts);
  await runReport({
    path: "/api/v1/reports/cash-flow-statement",
    body: {
      ...(opts.fiscalYear !== undefined
        ? { fiscal_year: opts.fiscalYear as number }
        : {}),
      ...(opts.method !== undefined
        ? { method: opts.method as CashFlowMethod }
        : {}),
      ...(comparison ? { comparison_period: comparison } : {}),
      ...sharedBody(opts),
    },
    dryRun: Boolean(opts.dryRun),
    format: opts.format as OutputFormat,
  });
});

export const metricReportCommand = withSharedOptions(
  new Command("metric-report")
    .description(
      "Metrics Report from a saved report definition or ordered governed metrics"
    )
    .option(
      "--metrics <metric-ids...>",
      "Ordered metric IDs, comma-separated or repeated"
    )
    .option(
      "--report-id <report-id>",
      "Stable active saved Metrics Report ID from pl catalog list"
    )
    .option(
      "--library-scope <scope>",
      "Saved report library: personal or organization"
    )
    .option("--fiscal-year <year>", "Activity fiscal year", parseReportFiscalYear)
    .option("--as-of <date>", "Point-in-time date in YYYY-MM-DD format")
    .option(
      "--compare-fiscal-year <year>",
      "Comparison activity fiscal year",
      parseReportFiscalYear
    )
    .option(
      "--compare-as-of <date>",
      "Comparison point-in-time date in YYYY-MM-DD format"
    )
    .option(
      "--method <method>",
      "Cash-flow method when selected metrics require it: indirect or direct",
      parseCashFlowMethod
    )
    .option(
      "--definition-comparison-metric-id <metric-id>",
      "Governed metric whose definition revision impact is measured"
    )
    .option(
      "--definition-comparison-baseline-revision <n>",
      "Previously-active revision to evaluate as the baseline",
      parseDefinitionComparisonRevision
    )
).action(async (opts) => {
  const hasMetrics = Array.isArray(opts.metrics) && opts.metrics.length > 0;
  const hasReportId =
    typeof opts.reportId === "string" && opts.reportId.trim().length > 0;
  if (hasMetrics === hasReportId) {
    throw new InvalidArgumentError(
      "Provide exactly one of --report-id or --metrics"
    );
  }
  const metricIds = hasMetrics
    ? parseMetricReportMetricIds(opts.metrics as string[])
    : undefined;
  const reportId = hasReportId ? (opts.reportId as string).trim() : undefined;
  const libraryScope =
    typeof opts.libraryScope === "string" ? opts.libraryScope.trim() : undefined;
  if (hasReportId && !["personal", "organization"].includes(libraryScope ?? "")) {
    throw new InvalidArgumentError(
      "--library-scope must be personal or organization when --report-id is used"
    );
  }
  if (!hasReportId && libraryScope) {
    throw new InvalidArgumentError(
      "--library-scope is accepted only with --report-id"
    );
  }
  const definitionMetricId = opts.definitionComparisonMetricId as
    | string
    | undefined;
  const definitionRevision = opts.definitionComparisonBaselineRevision as
    | number
    | undefined;
  if ((definitionMetricId === undefined) !== (definitionRevision === undefined)) {
    throw new InvalidArgumentError(
      "--definition-comparison-metric-id and --definition-comparison-baseline-revision must be provided together"
    );
  }
  const comparison = comparisonPeriodFrom(opts);
  await runReport({
    path: "/api/v1/reports/metric-report",
    body: {
      ...(metricIds ? { metric_ids: metricIds } : {}),
      ...(reportId
        ? {
            report_id: reportId,
            report_library_scope: libraryScope as "personal" | "organization",
          }
        : {}),
      ...(opts.fiscalYear !== undefined
        ? { fiscal_year: opts.fiscalYear as number }
        : {}),
      ...(opts.asOf !== undefined ? { as_of: opts.asOf as string } : {}),
      ...(comparison ? { comparison_period: comparison } : {}),
      ...(opts.method !== undefined
        ? { method: opts.method as CashFlowMethod }
        : {}),
      ...(definitionMetricId !== undefined && definitionRevision !== undefined
        ? {
            definition_comparison: {
              metric_id: definitionMetricId,
              baseline_revision: definitionRevision,
            },
          }
        : {}),
      ...sharedBody(opts),
    },
    dryRun: Boolean(opts.dryRun),
    format: opts.format as OutputFormat,
    dryRunNote:
      "Required marts, clocks, and query count are derived from the ordered governed metrics.",
  });
});

export const reportCommand = new Command("report")
  .description("Financial reports (server-side aggregation)")
  .action(function (this: Command) {
    this.outputHelp();
  })
  .addCommand(metricReportCommand)
  .addCommand(incomeStatementCommand)
  .addCommand(balanceSheetCommand)
  .addCommand(cashFlowStatementCommand);


reportCommand
  .command("load-recipe <report-id>")
  .description("Load a saved recipe definition; no financial steps execute")
  .requiredOption("--scope <scope>", "personal or organization", (value: string) => {
    if (value !== "personal" && value !== "organization") throw new InvalidArgumentError("Use personal or organization.");
    return value;
  })
  .action(async (reportId: string, opts: { scope: string }) => {
    const result = await new ApiClient().post("/api/v1/reports/load-recipe", { report_id: reportId, report_library_scope: opts.scope });
    console.log(JSON.stringify(result, null, 2));
  });
