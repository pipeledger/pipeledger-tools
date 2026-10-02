/**
 * `pl report` renders ONE response shape now: the capability service result
 * that MCP and REST also return. These tests pin the rendering rules that
 * carry financial meaning (value_format, percentage points vs relative
 * change, currency threading, the equation control) and the request-shaping
 * rules that decide which governed report runs.
 *
 * Run: pnpm --filter @pipeledger/cli test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balanceSheetCommand,
  cashFlowStatementCommand,
  dryRunAuthorizationLine,
  formatReportCsv,
  formatReportProvenanceSummary,
  formatReportTable,
  formatReportValue,
  formatReportVariance,
  incomeStatementCommand,
  metricReportCommand,
  parseCashFlowFiscalYear,
  parseCashFlowMethod,
  parseDefinitionComparisonRevision,
  parseMetricReportMetricIds,
  reportCommand,
  type ReportResponse,
} from "./report";

function source(mart: string): ReportResponse["sources"][number] {
  return {
    mart,
    run_id: "11111111-1111-4111-8111-111111111111",
    published_at: "2026-08-14T12:00:00.000Z",
    publication_age_seconds: 3600,
    bytes_scanned: 2048,
    release_channel: "public",
    publication_id: null,
    release_at: null,
    is_unreleased_insider: false,
  };
}

const incomeStatement: ReportResponse = {
  org_name: "Riverside Lumber",
  report_type: "income_statement",
  report_label: "Income Statement",
  period: { basis: "activity", label: "FY2026", fiscal_year: 2026 },
  comparison_period: { basis: "activity", label: "FY2025", fiscal_year: 2025 },
  report_coverage: {
    coverage_label: "FY2026: published rows observed in 10 months in the authorized result (Jan 2026, Apr 2026-Dec 2026)",
  },
  comparison_coverage: {
    coverage_label: "FY2025: published rows observed in 10 months in the authorized result (Jan 2025, Apr 2025-Dec 2025)",
  },
  catalog_version: "1.0.0",
  effective_catalog_hash: "catalog-hash",
  reporting_currency: "EUR",
  sections: [
    {
      section_id: "revenue",
      section_label: "Revenue",
      lines: [
        {
          line_type: "metric",
          line_id: "revenue",
          metric_id: "revenue",
          label: "Revenue",
          kind: "atomic",
          value: 1000,
          value_format: "currency",
          comparison_value: 800,
          variance: 200,
          variance_pct: 0.25,
          metric_version: "1.0.0",
          definition_hash: "hash-revenue",
          source_mart: "mart_gl_lines",
          grain: "period_activity",
          drilldown_handle: "pldd4.dd-v4.aaaa.bbbb",
        },
      ],
    },
    {
      section_id: "supplementary",
      section_label: "Supplementary Metrics",
      lines: [
        {
          line_type: "metric",
          line_id: "gross_margin",
          metric_id: "gross_margin",
          label: "Gross Margin",
          kind: "subtotal",
          value: 0.4,
          value_format: "percentage",
          comparison_value: 0.35,
          variance: 0.05,
          variance_pct: 1 / 7,
          metric_version: "1.0.0",
          definition_hash: "hash-margin",
          source_mart: "mart_gl_lines",
          grain: "period_activity",
        },
        {
          line_type: "metric",
          line_id: "current_ratio",
          metric_id: "current_ratio",
          label: "Current Ratio",
          kind: "subtotal",
          value: 1.75,
          value_format: "multiple",
          metric_version: "1.0.0",
          definition_hash: "hash-ratio",
          source_mart: "mart_gl_trial_balance",
          grain: "balance",
        },
        {
          line_type: "metric",
          line_id: "unavailable_metric",
          metric_id: "unavailable_metric",
          label: "Unavailable Metric",
          kind: "atomic",
          value: null,
          value_format: "currency",
        },
      ],
    },
  ],
  sources: [source("mart_gl_lines")],
  caveats: ["General Ledger Lines (FY2026): 10 months with rows observed in the authorized published result. No rows observed in the authorized published result between the observed endpoints for Feb 2026-Mar 2026. Unobserved months may reflect inactivity, missing data, or access and report filters; they do not establish absence in the ERP."],
};

describe("pl report rendering", () => {
  it("renders each value_format correctly and never invents a currency", () => {
    assert.equal(
      formatReportValue({ value: 1000, value_format: "currency" }, "EUR"),
      "1,000.00 EUR"
    );
    assert.equal(
      formatReportValue({ value: 1000, value_format: "currency" }, null),
      "1,000.00"
    );
    // The canonical stored value is the raw quotient; only the human
    // formatter multiplies by 100.
    assert.equal(
      formatReportValue({ value: 0.4, value_format: "percentage" }, "EUR"),
      "40.00%"
    );
    assert.equal(
      formatReportValue({ value: 1.75, value_format: "multiple" }, "EUR"),
      "1.75x"
    );
    assert.equal(
      formatReportValue(
        { value: 12, value_format: "quantity", unit_of_measure: "pallet" },
        "EUR"
      ),
      "12 pallet"
    );
    assert.equal(
      formatReportValue({ value: null, value_format: "currency" }, "EUR"),
      "unavailable"
    );
  });

  it("renders a percentage variance as percentage points, not a second percentage", () => {
    const percentageLine = incomeStatement.sections[1]!.lines[0]!;
    assert.equal(formatReportVariance(percentageLine, "EUR"), "5.00 pp");
    // variance_pct stays relative change and is never re-rendered as points.
    assert.equal(percentageLine.variance_pct, 1 / 7);
    const currencyLine = incomeStatement.sections[0]!.lines[0]!;
    assert.equal(formatReportVariance(currencyLine, "EUR"), "200.00 EUR");
  });

  it("threads the response reporting currency and prints every section", () => {
    const table = formatReportTable(incomeStatement);
    assert.match(table, /Income Statement - Riverside Lumber/);
    assert.match(table, /Period: FY2026 {3}Comparison: FY2025/);
    assert.match(table, /Currency: EUR {3}Catalog: 1\.0\.0/);
    assert.match(table, /Revenue/);
    assert.match(table, /Supplementary Metrics/);
    assert.match(table, /1,000\.00 EUR/);
    assert.match(table, /40\.00%/);
    assert.match(table, /1\.75x/);
    assert.match(table, /unavailable/);
    assert.ok(table.includes(`Coverage: ${incomeStatement.report_coverage!.coverage_label}`));
    assert.ok(table.includes(`Comparison coverage: ${incomeStatement.comparison_coverage!.coverage_label}`));
    assert.match(table, /Note: General Ledger Lines \(FY2026\): 10 months/);
    // Handles are evidence for pl_drilldown, not table output.
    assert.doesNotMatch(table, /pldd4\./);
  });

  it("prints returned coverage without reconstructing dates or inventing absent coverage", () => {
    const withoutCoverage = formatReportTable({
      ...incomeStatement, report_coverage: null, comparison_coverage: null,
    });
    assert.doesNotMatch(withoutCoverage, /Coverage:|Comparison coverage:/);
    const snapshot = formatReportTable({
      ...incomeStatement,
      report_coverage: { coverage_label: "Snapshot as of June 2026" },
      comparison_coverage: undefined,
    });
    assert.match(snapshot, /Coverage: Snapshot as of June 2026/);
    assert.doesNotMatch(snapshot, /Comparison coverage:/);
  });

  it("marks a missing currency unavailable rather than assuming USD", () => {
    const table = formatReportTable({
      ...incomeStatement,
      reporting_currency: null,
    });
    assert.match(table, /Currency: unavailable/);
    assert.doesNotMatch(table, /USD/);
  });

  it("keeps catalog provenance and comparison columns in CSV output", () => {
    const csv = formatReportCsv(incomeStatement);
    const [header, ...rows] = csv.split("\n");
    assert.equal(
      header,
      "section_id,section_label,line_id,metric_id,label,value,value_format,comparison_value,variance,variance_pct,reporting_currency,source_mart,metric_version,definition_hash"
    );
    assert.equal(rows.length, 4);
    assert.match(rows[0]!, /^revenue,Revenue,revenue,revenue,Revenue,1000,currency,800,200,0\.25,EUR,mart_gl_lines,1\.0\.0,hash-revenue$/);
    // A null value is an empty cell, never a zero.
    assert.match(rows[3]!, /,unavailable_metric,Unavailable Metric,,currency,/);
  });

  it("summarizes provenance per contributing source", () => {
    const summary = formatReportProvenanceSummary({
      ...incomeStatement,
      sources: [source("mart_gl_lines"), source("mart_cash_flow_components")],
    });
    assert.match(summary, /mart_gl_lines: run 11111111/);
    assert.match(summary, /mart_cash_flow_components: run 11111111/);
    assert.match(summary, /\(public\)/);
  });

  it("surfaces the Balance Sheet accounting-equation control", () => {
    const table = formatReportTable({
      ...incomeStatement,
      report_type: "balance_sheet",
      report_label: "Balance Sheet",
      equation_check: "FAIL",
      equation_delta: -12.5,
    });
    assert.match(table, /Accounting equation: FAIL \(delta -12\.50 EUR\)/);
  });

  it("names the returned cash-flow method and certification status", () => {
    const table = formatReportTable({
      ...incomeStatement,
      report_type: "cash_flow_statement",
      report_label: "Cash Flow Statement",
      cash_flow_method: "direct",
      cash_flow_certification: { status: "coverage_qualified" },
    });
    assert.match(table, /Method: direct/);
    assert.match(table, /Cash-flow certification: coverage_qualified/);
  });

  it("names the governed Legal Entities actually served", () => {
    const table = formatReportTable({
      ...incomeStatement,
      reporting_legal_entity_id: "le-riverside-1",
      report_scope: {
        current_period: {
          reporting_legal_entities: [
            {
              reporting_legal_entity_id: "le-riverside-1",
              legal_entity_name: "Riverside Lumber GmbH",
            },
          ],
        },
      },
    });
    assert.match(table, /Legal Entity: le-riverside-1/);
    // Human-facing answers use the governed name, not the native key.
    assert.match(table, /Reporting Legal Entities: Riverside Lumber GmbH/);
  });
});

describe("pl report command surface", () => {
  it("never prints bearer-token material in dry-run output", () => {
    assert.equal(dryRunAuthorizationLine(), "  Authorization: Bearer <redacted>");
  });

  it("uses the canonical report names", () => {
    const names = reportCommand.commands.map((command) => command.name());
    assert.deepEqual(new Set(names), new Set([
      "metric-report",
      "income-statement",
      "balance-sheet",
      "cash-flow-statement",
      "load-recipe",
    ]));
    assert.match(
      metricReportCommand.description(),
      /Metrics Report from a saved report definition or ordered governed metrics/
    );
  });

  it("offers comparison, legal entity, and catalog version on every statement", () => {
    for (const command of [
      incomeStatementCommand,
      balanceSheetCommand,
      cashFlowStatementCommand,
      metricReportCommand,
    ]) {
      const flags = command.options.map((option) => option.long);
      assert.ok(flags.includes("--reporting-legal-entity-id"), command.name());
      assert.ok(flags.includes("--catalog-version"), command.name());
      assert.ok(flags.includes("--exclude-intercompany"), command.name());
    }
    assert.ok(
      incomeStatementCommand.options
        .map((option) => option.long)
        .includes("--compare-fiscal-year")
    );
    assert.ok(
      balanceSheetCommand.options
        .map((option) => option.long)
        .includes("--compare-as-of")
    );
    assert.ok(
      cashFlowStatementCommand.options
        .map((option) => option.long)
        .includes("--compare-fiscal-year")
    );
    const metricFlags = metricReportCommand.options.map((option) => option.long);
    assert.ok(metricFlags.includes("--definition-comparison-metric-id"));
    assert.ok(metricFlags.includes("--definition-comparison-baseline-revision"));
    // Not advertised until Run D ships the redeeming verbs.
    assert.ok(!metricFlags.includes("--save-period-policy"));
  });

  it("accepts only supported methods, fiscal years, and revisions", () => {
    assert.equal(parseCashFlowMethod("direct"), "direct");
    assert.throws(() => parseCashFlowMethod("weekly"), /indirect or direct/);
    assert.equal(parseCashFlowFiscalYear("FY2026"), 2026);
    assert.equal(parseCashFlowFiscalYear("2026"), 2026);
    assert.throws(() => parseCashFlowFiscalYear("FY99"), /four-digit year/);
    // A well-formed year outside the range gets the range, not a format hint.
    assert.throws(
      () => parseCashFlowFiscalYear("1999"),
      /between 2000 and 2100/
    );
    assert.equal(parseDefinitionComparisonRevision("3"), 3);
    assert.throws(
      () => parseDefinitionComparisonRevision("0"),
      /positive integer/
    );
  });

  it("requires exactly one Metrics Report selection source", () => {
    assert.deepEqual(parseMetricReportMetricIds(["revenue,cogs"]), [
      "revenue",
      "cogs",
    ]);
    assert.throws(() => parseMetricReportMetricIds([""]), /at least one/);
    assert.throws(
      () => parseMetricReportMetricIds(["revenue,revenue"]),
      /duplicate/
    );
  });
});
