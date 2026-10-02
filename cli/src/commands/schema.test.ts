import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidArgumentError } from "commander";
import {
  buildSchemaPath,
  formatSchemaSummary,
  parseSchemaColumns,
  parseSchemaDetail,
  schemaCommand,
  toSchemaDisplayRows,
} from "./schema";

const schemaFixture: Parameters<typeof formatSchemaSummary>[0] = {
  mart: "gl_lines",
  warehouse_table: "mart_gl_lines",
  description: "GL accounting lines.",
  grain: "One row per GL accounting line per posting period.",
  aggregation_supported: true,
  catalog_version: "1.0.0",
  effective_catalog_hash: "abc",
  detail: "concise",
  fiscal_calendar: {
    fiscal_year_start_month: 7,
    fiscal_year_end_month: 6,
    label_convention: "FY labelled by ending year.",
  },
  columns: [
    {
      column_name: "reporting_amount",
      data_type: "NUMERIC",
      filterable: false,
      groupable: false,
      column_group: "Amounts",
      masked_by_governance: false,
    },
    {
      column_name: "customer_name",
      data_type: "STRING",
      filterable: false,
      groupable: true,
      column_group: "Customer",
      masked_by_governance: true,
    },
  ],
  column_count: 40,
  returned_column_count: 2,
  allowed_time_buckets: ["ytd"],
  period_dimensions: {
    native: ["posting_period", "fiscal_year"],
    via_dim_date_join_future: [],
  },
  recommended_metrics: [
    {
      metric_id: "revenue",
      display_name: "Revenue",
      description: "Top-line revenue.",
      kind: "atomic",
      report_section: "revenue",
      grain: "period_activity",
      metric_version: "1.0.0",
      definition_hash: "def",
    },
  ],
  whoami: {
    organization: { id: "org-1", name: null },
    credential: { id: "cred-1", label: "Riverside Lumber agent", connection_instance_id: null, expires_at: null },
    credential_role: "viewer" as const,
    allowed_tools: ["pl_query", "pl_schema", "pl_whoami"],
    operator_grants: {
      allow_auto_approve: false,
      allow_catalog_write_access: false,
      allow_catalog_activation: false,
      allow_business_identity_governance: false,
      allow_organization_report_write_access: false,
      allow_unit_posting: false,
      allow_unit_metric_management: false,
    },
    clearance: "standard",
    insider_cleared: false,
    scope: { ledger: "unrestricted", dimensions: [], row_filter_columns: [] },
    allowed_marts: ["gl_lines"],
    ledger: { complete: true, detail_complete: true, reasons: [] },
    guidance: "This credential sees the whole organization.",
  },
  caveats: ["fiscal_year is FY-prefixed (FY2026)."],
};

describe("pl schema argument handling", () => {
  it("registers as the top-level schema command with the shared flags", () => {
    assert.equal(schemaCommand.name(), "schema");
    const flags = schemaCommand.options.map((option) => option.long);
    assert.deepEqual(flags, ["--detail", "--columns", "--format"]);
  });

  it("accepts only the shared detail values", () => {
    assert.equal(parseSchemaDetail("concise"), "concise");
    assert.equal(parseSchemaDetail("full"), "full");
    assert.throws(
      () => parseSchemaDetail("verbose"),
      (error: unknown) => error instanceof InvalidArgumentError,
    );
  });

  it("parses a bounded, de-duplicated column selector", () => {
    assert.deepEqual(parseSchemaColumns(" reporting_amount, account_name,reporting_amount "), [
      "reporting_amount",
      "account_name",
    ]);
    assert.throws(
      () => parseSchemaColumns(" , "),
      (error: unknown) => error instanceof InvalidArgumentError,
    );
    assert.throws(
      () =>
        parseSchemaColumns(
          Array.from({ length: 51 }, (_, index) => `column_${index}`).join(","),
        ),
      (error: unknown) => error instanceof InvalidArgumentError,
    );
  });

  it("builds the REST path with the shared query parameters", () => {
    assert.equal(buildSchemaPath("gl_lines", {}), "/api/v1/schema/gl_lines");
    assert.equal(
      buildSchemaPath("trial_balance", {
        detail: "full",
        columns: ["reporting_amount", "account_name"],
      }),
      "/api/v1/schema/trial_balance?detail=full&columns=reporting_amount%2Caccount_name",
    );
    assert.equal(
      buildSchemaPath("bad mart", {}),
      "/api/v1/schema/bad%20mart",
    );
  });
});

describe("pl schema rendering", () => {
  it("renders concise columns as a table without inventing description columns", () => {
    const rows = toSchemaDisplayRows(schemaFixture.columns);
    assert.deepEqual(rows[0], {
      column: "reporting_amount",
      type: "NUMERIC",
      filterable: false,
      groupable: false,
      group: "Amounts",
      masked: false,
    });
    assert.equal("description" in rows[0]!, false);
  });

  it("renders kind and mode-separated operator profiles when any column carries one", () => {
    const rows = toSchemaDisplayRows([
      {
        column_name: "cash_flow_category",
        data_type: "STRING",
        filterable: true,
        groupable: true,
        column_group: "Cash Flow",
        masked_by_governance: false,
        filter_kind: "enum",
        filter_operators: {
          row: ["scalar_equality", "in"],
          aggregation: ["scalar_equality", "in"],
        },
      },
      {
        column_name: "memo",
        data_type: "STRING",
        filterable: true,
        groupable: false,
        column_group: "Narrative",
        masked_by_governance: false,
      },
    ]);
    assert.equal(rows[0]!["kind"], "enum");
    assert.equal(rows[0]!["row_ops"], "scalar_equality|in");
    assert.equal(rows[0]!["agg_ops"], "scalar_equality|in");
    // Same headers on every row so table and CSV output stay rectangular.
    assert.equal(rows[1]!["kind"], "");
    assert.equal(rows[1]!["row_ops"], "");
  });

  it("omits the profile columns entirely when no returned column has one", () => {
    const rows = toSchemaDisplayRows(schemaFixture.columns);
    assert.equal("kind" in rows[0]!, false);
    assert.equal("row_ops" in rows[0]!, false);
  });

  it("renders full columns with nullability and description", () => {
    const rows = toSchemaDisplayRows([
      {
        column_name: "memo",
        data_type: "STRING",
        is_nullable: true,
        description: "Line memo.",
        filterable: false,
        groupable: false,
        column_group: "Narrative",
        masked_by_governance: true,
      },
    ]);
    assert.deepEqual(rows[0], {
      column: "memo",
      type: "STRING",
      filterable: false,
      groupable: false,
      group: "Narrative",
      masked: true,
      nullable: true,
      description: "Line memo.",
    });
  });

  it("summarizes the mart, credential, metrics, and caveats", () => {
    const summary = formatSchemaSummary(schemaFixture);
    assert.match(summary, /Mart:\s+gl_lines \(mart_gl_lines\)/);
    assert.match(summary, /2 returned of 40 visible \(concise\)/);
    assert.match(summary, /starts month 7, ends month 6/);
    assert.match(
      summary,
      /role=viewer; clearance=standard; scope=unrestricted; ledger complete/,
    );
    assert.match(summary, /Tools:\s+pl_query, pl_schema, pl_whoami/);
    assert.match(
      summary,
      /Op grants:\s+allow_auto_approve=false, allow_catalog_write_access=false, allow_catalog_activation=false, allow_business_identity_governance=false, allow_organization_report_write_access=false, allow_unit_posting=false/,
    );
    assert.match(summary, /Metrics:\s+revenue/);
    assert.match(summary, /Period dims:\s+posting_period, fiscal_year/);
    assert.match(summary, /- fiscal_year is FY-prefixed/);
  });

  it("explains missing effective grants from an older schema endpoint", () => {
    const { operator_grants: _operatorGrants, ...legacyWhoami } =
      schemaFixture.whoami;
    const summary = formatSchemaSummary({
      ...schemaFixture,
      whoami: legacyWhoami,
    } as Parameters<typeof formatSchemaSummary>[0]);

    assert.match(
      summary,
      /Op grants:\s+unavailable \(the server did not return effective grants\)/,
    );
  });
});
