import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountClassificationCommand,
  accountClassificationDisplayRows,
  buildAccountClassificationEditBody,
  buildAccountClassificationListPath,
  type AccountClassificationRow,
} from "./catalog";
import {
  financeMetricListRows,
  financeMetricsCommand,
} from "./finance-metrics";

const current: AccountClassificationRow = {
  classification_id: "33333333-3333-4333-8333-333333333333",
  override_id: "44444444-4444-4444-8444-444444444444",
  connector_id: "55555555-5555-4555-8555-555555555555",
  source_erp: "netsuite",
  account_id: "117",
  account_number: "1200",
  account_name: "Accounts Receivable",
  account_type: "Accounts Receivable",
  account_sub_type: "AccountsReceivable",
  account_classification_scope: "financial_statement",
  is_gl_posting_account: true,
  statement_type: "balance_sheet",
  taxonomy_level_1: "Assets",
  taxonomy_level_2: "Current Assets",
  taxonomy_level_3: "Accounts Receivable",
  taxonomy_level_4_catalog: "Trade Receivables",
  taxonomy_level_5_catalog_subcategory: "Domestic",
  gaap_code: "12000",
  framework_account_number: "12000",
  source: "controller_override",
  has_controller_override: true,
  has_unapplied_override: false,
  override_reason: "Preserve reporting taxonomy",
  cash_flow_category: "operating",
  cash_flow_treatment: "working_capital_change",
  cash_flow_standard_detail: "accounts_receivable",
  cash_flow_classification_source: "finance_catalog",
  cash_flow_requires_review: false,
  adjusted_cash_flow_classification: false,
  cash_flow_override_reason: null,
  cash_flow_override_reset_at: null,
  cash_flow_override_reset_reason: null,
  cash_flow_override_reset_by: null,
  has_unapplied_cash_flow_override: false,
};

describe("catalog account-classification command contract", () => {
  it("registers discovery plus explicit cash-flow edit and reset flags", () => {
    const list = accountClassificationCommand.commands.find(
      (command) => command.name() === "list"
    );
    const edit = accountClassificationCommand.commands.find(
      (command) => command.name() === "edit"
    );

    assert.ok(list);
    assert.ok(edit);
    assert.match(list.description(), /stable classification IDs/i);
    assert.ok(
      edit.options.some(
        (option) => option.long === "--cash-flow-treatment"
      )
    );
    assert.ok(
      edit.options.some(
        (option) => option.long === "--clear-cash-flow-override"
      )
    );
    assert.equal(
      edit.options.find(
        (option) => option.long === "--taxonomy-level-1"
      )?.mandatory,
      false
    );
  });

  it("builds filtered, paginated discovery URLs", () => {
    assert.equal(
      buildAccountClassificationListPath({
        limit: 50,
        offset: 100,
        sourceErp: "NetSuite",
        cashFlowCategory: "operating",
        cashFlowRequiresReview: true,
      }),
      "/api/v1/catalog/account-classifications?limit=50&offset=100&source_erp=netsuite&cash_flow_category=operating&cash_flow_requires_review=true"
    );
  });

  it("sends the account name and id filters as the service names them", () => {
    assert.equal(
      buildAccountClassificationListPath({
        limit: 200,
        offset: 0,
        accountNameContains: "  Loan payments (R&D) **  ",
        accountId: " 1150040080 ",
      }),
      "/api/v1/catalog/account-classifications?limit=200&offset=0&account_name_contains=Loan+payments+%28R%26D%29+**&account_id=1150040080"
    );
    const list = accountClassificationCommand.commands.find(
      (command) => command.name() === "list"
    );
    assert.ok(
      list?.options.some(
        (option) => option.long === "--account-name-contains"
      )
    );
    assert.ok(list?.options.some((option) => option.long === "--account-id"));
  });

  it("keeps stable and override ids separate in list output", () => {
    assert.deepEqual(accountClassificationDisplayRows([current]), [
      {
        classification_id: current.classification_id,
        override_id: current.override_id,
        source_erp: "netsuite",
        account_number: "1200",
        account_name: "Accounts Receivable",
        cash_flow_category: "operating",
        cash_flow_treatment: "working_capital_change",
        cash_flow_standard_detail: "accounts_receivable",
        cash_flow_source: "finance_catalog",
        review_required: false,
        override_active: false,
        override_pending: false,
        override_reason: null,
        reset_at: null,
        reset_reason: null,
        reset_by: null,
      },
    ]);
  });
});

describe("catalog account-classification edit payload", () => {
  it("preserves the complete taxonomy ladder during a cash-flow-only edit", () => {
    const body = buildAccountClassificationEditBody(current, {
      cashFlowCategory: "investing",
      cashFlowTreatment: "investing_cash_counterpart",
      cashFlowStandardDetail: "capital_expenditures",
      reason: "Controller mapped capital spending",
    });

    assert.equal(body.taxonomy_level_1, "Assets");
    assert.equal(body.taxonomy_level_2, "Current Assets");
    assert.equal(body.taxonomy_level_3, "Accounts Receivable");
    assert.equal(body.taxonomy_level_4_catalog, "Trade Receivables");
    assert.equal(body.taxonomy_level_5_catalog_subcategory, "Domestic");
    assert.equal(body.gaap_code, undefined);
    assert.equal(body.override_reason, undefined);
    assert.equal(body.cash_flow_category, "investing");
    assert.equal(
      body.cash_flow_treatment,
      "investing_cash_counterpart"
    );
    assert.equal(body.cash_flow_standard_detail, "capital_expenditures");
    assert.equal(
      body.cash_flow_override_reason,
      "Controller mapped capital spending"
    );
  });

  it("clears category intent for category-free treatments", () => {
    const body = buildAccountClassificationEditBody(current, {
      cashFlowTreatment: "cash_and_cash_equivalents",
      cashFlowStandardDetail: "",
      reason: "Treasury confirmed this account is cash",
    });

    assert.equal(body.cash_flow_category, null);
    assert.equal(body.cash_flow_treatment, "cash_and_cash_equivalents");
    assert.equal(body.cash_flow_standard_detail, null);
  });

  it("resets only the cash-flow override while preserving taxonomy intent", () => {
    const body = buildAccountClassificationEditBody(current, {
      clearCashFlowOverride: true,
      reason: "Return to the finance-catalog default",
    });

    assert.equal(body.clear_cash_flow_override, true);
    assert.equal(
      body.cash_flow_override_reason,
      "Return to the finance-catalog default"
    );
    assert.equal(body.cash_flow_category, undefined);
    assert.equal(body.cash_flow_treatment, undefined);
    assert.equal(body.cash_flow_standard_detail, undefined);
    assert.equal(body.taxonomy_level_4_catalog, "Trade Receivables");
    assert.equal(body.override_reason, undefined);
  });

  it("preserves omitted taxonomy fields during a taxonomy edit", () => {
    const body = buildAccountClassificationEditBody(current, {
      taxonomyLevel5CatalogSubcategory: "International",
      reason: "Separate international receivables",
    });

    assert.equal(body.taxonomy_level_1, "Assets");
    assert.equal(body.taxonomy_level_4_catalog, "Trade Receivables");
    assert.equal(body.taxonomy_level_5_catalog_subcategory, "International");
    assert.equal(
      body.override_reason,
      "Separate international receivables"
    );
  });

  it("rejects ambiguous resets and no-op invocations before PATCH", () => {
    assert.throws(
      () =>
        buildAccountClassificationEditBody(current, {
          clearCashFlowOverride: true,
          cashFlowTreatment: "excluded",
          reason: "Conflicting request",
        }),
      /by itself/
    );
    assert.throws(
      () =>
        buildAccountClassificationEditBody(current, {
          reason: "No requested field",
        }),
      /at least one/
    );
  });

  it("leaves statement-type rules to the service", () => {
    // Whether a calculation basis suits the account's statement type is the
    // service's decision, returned as a field-level error. The CLI sends the
    // requested classification exactly as given.
    const body = buildAccountClassificationEditBody(current, {
      cashFlowCategory: "operating",
      cashFlowTreatment: "non_cash_adjustment",
      cashFlowStandardDetail: "",
      reason: "Invalid for a balance-sheet account",
    });
    assert.equal(body.cash_flow_category, "operating");
    assert.equal(body.cash_flow_treatment, "non_cash_adjustment");
    assert.equal(body.cash_flow_standard_detail, null);
  });
});

describe("catalog finance metrics command contract", () => {
  it("mirrors pl_catalog reads and pl_catalog_admin lifecycle actions", () => {
    assert.deepEqual(
      financeMetricsCommand.commands.map((command) => command.name()),
      [
        "list",
        "get",
        "history",
        "versions",
        "compare",
        "preview",
        "create",
        "edit",
        "activate",
        "archive",
      ]
    );

    const preview = financeMetricsCommand.commands.find(
      (command) => command.name() === "preview"
    );
    assert.ok(preview?.options.some((option) => option.long === "--id"));
    assert.ok(preview?.options.some((option) => option.long === "--file"));
  });

  it("presents canonical and organization definitions in one ownership-aware list", () => {
    assert.deepEqual(
      financeMetricListRows({
        canonical_metrics: [
          {
            metric_id: "revenue",
            display_name: "Revenue",
            kind: "atomic",
            report_section: "revenue",
            source_mart: "mart_gl_lines",
            definition_hash: "canonical-hash",
          },
        ],
        org_metrics: [
          {
            metric_id: "product_engineering_spend_ratio",
            display_name: "Product Engineering Spend as % of Revenue",
            metric_kind: "ratio",
            source_mart: "mart_gl_lines",
            status: "active",
            metric_revision: 2,
            definition_hash: "org-hash",
            metric: { report_section: "supplementary" },
          },
          {
            metric_id: "roce",
            display_name: "Return on Capital Employed",
            metric_kind: "temporal_ratio",
            source_mart: null,
            status: "draft",
            metric_revision: 1,
            definition_hash: "temporal-hash",
            metric: { report_section: "supplementary" },
          },
        ],
      }),
      [
        {
          metric_id: "product_engineering_spend_ratio",
          display_name: "Product Engineering Spend as % of Revenue",
          kind: "ratio",
          report_section: "supplementary",
          source_mart: "mart_gl_lines",
          ownership: "Organization",
          status: "active",
          revision: 2,
          definition_hash: "org-hash",
        },
        {
          metric_id: "revenue",
          display_name: "Revenue",
          kind: "atomic",
          report_section: "revenue",
          source_mart: "mart_gl_lines",
          ownership: "PipeLedger",
          status: "locked",
          revision: "",
          definition_hash: "canonical-hash",
        },
        {
          metric_id: "roce",
          display_name: "Return on Capital Employed",
          kind: "temporal_ratio",
          report_section: "supplementary",
          source_mart: "Operand sources (Metrics Report)",
          ownership: "Organization",
          status: "draft",
          revision: 1,
          definition_hash: "temporal-hash",
        },
      ]
    );
  });
});
