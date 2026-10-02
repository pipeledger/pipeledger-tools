import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransactionOverrideCandidatesPath,
  selectTransactionOverrideCandidate,
  buildTransactionOverrideListPath,
  DEFAULT_TRANSACTION_OVERRIDE_DOMAIN,
  parseTransactionOverrideDomain,
  parseTransactionOverridePayload,
  transactionOverrideCandidateDisplayRows,
  transactionOverrideDisplayRows,
} from "./transaction-override";

const VALID_EDIT_PAYLOAD = {
  verification_item_id: "0123456789abcdef0123456789abcdef",
  verification_evidence_line_id: "fedcba9876543210fedcba9876543210",
  evidence_fingerprint: "0f".repeat(32),
  connector_id: "6b1f0d9e-3f7a-4a6e-9c1e-2f8b4d5a6c7d",
  source_erp: "quickbooks",
  cash_flow_line_identity: "ab".repeat(32),
  source_gl_line_id: "JournalEntry:123:0:d",
  transaction_id: "123",
  transaction_type: "JournalEntry",
  transaction_line_id: "0",
  accounting_line_id: null,
  account_id: "45",
  source_legal_entity_key:
    "source:LegalEntity:11111111-1111-1111-1111-111111111111:quickbooks:6b1f0d9e-3f7a-4a6e-9c1e-2f8b4d5a6c7d:1",
  accounting_book_id: null,
  transaction_date: "2026-06-30",
  statement_type: "balance_sheet",
  cash_flow_line_role: "counterpart",
  cash_flow_treatment: "financing_cash_counterpart",
  cash_flow_standard_detail: "debt_proceeds_and_repayments",
  override_reason:
    "Loan principal draw was mapped as working capital; reclassify to financing.",
  expected_override_version: null,
};

const VALID_VOID_PAYLOAD = {
  verification_item_id: VALID_EDIT_PAYLOAD.verification_item_id,
  verification_evidence_line_id:
    VALID_EDIT_PAYLOAD.verification_evidence_line_id,
  evidence_fingerprint: VALID_EDIT_PAYLOAD.evidence_fingerprint,
  cash_flow_transaction_override_id:
    "9d3b2a10-5c4e-4f6d-8a7b-1c2d3e4f5a6b",
  expected_override_version: 1,
  reset_reason:
    "Controller confirmed the account-level mapping is right after review.",
};

test("the default domain is cash_flow_classification and unknown domains are refused", () => {
  assert.equal(DEFAULT_TRANSACTION_OVERRIDE_DOMAIN, "cash_flow_classification");
  assert.equal(
    parseTransactionOverrideDomain(" cash_flow_classification "),
    "cash_flow_classification"
  );
  const rejected = parseTransactionOverrideDomain("revenue_recognition");
  assert.ok(typeof rejected === "object");
  assert.match(rejected.error, /cash_flow_classification/);
});

test("edit and void payloads pass through unchanged for the service to validate", () => {
  const edit = parseTransactionOverridePayload({
    domain: "cash_flow_classification",
    kind: "edit",
    json: VALID_EDIT_PAYLOAD,
  });
  assert.ok(edit.ok);
  assert.equal(edit.domain, "cash_flow_classification");
  assert.deepEqual(edit.payload, VALID_EDIT_PAYLOAD);

  const voided = parseTransactionOverridePayload({
    domain: "cash_flow_classification",
    kind: "void",
    json: VALID_VOID_PAYLOAD,
  });
  assert.ok(voided.ok);
  assert.deepEqual(voided.payload, VALID_VOID_PAYLOAD);

  // The domain schema lives in the service. A short reason is refused there
  // with a field-level error; the CLI must not drop or repair the field.
  const shortNote = parseTransactionOverridePayload({
    domain: "cash_flow_classification",
    kind: "edit",
    json: { ...VALID_EDIT_PAYLOAD, override_reason: "short" },
  });
  assert.ok(shortNote.ok);
  assert.equal(shortNote.payload.override_reason, "short");
});

test("a payload must be one JSON object", () => {
  for (const json of [null, [], "text", 7]) {
    const parsed = parseTransactionOverridePayload({
      domain: "cash_flow_classification",
      kind: "edit",
      json,
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.deepEqual(parsed.issues, ["payload: must be one JSON object"]);
    }
  }
});

test("an unknown domain fails payload parsing with the supported list", () => {
  const parsed = parseTransactionOverridePayload({
    domain: "revenue_recognition",
    kind: "edit",
    json: VALID_EDIT_PAYLOAD,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.issues.join("\n"), /cash_flow_classification/);
  }
});

test("list path always carries the domain and normalizes filters", () => {
  assert.equal(
    buildTransactionOverrideListPath({ domain: "cash_flow_classification" }),
    "/api/v1/catalog/transaction-overrides?domain=cash_flow_classification"
  );
  const filtered = buildTransactionOverrideListPath({
    domain: "cash_flow_classification",
    transactionId: " 123 ",
    accountId: "45",
    sourceErp: "QuickBooks",
    limit: 50,
    offset: 10,
  });
  const url = new URL(`https://app.pipeledger.ai${filtered}`);
  assert.equal(url.searchParams.get("domain"), "cash_flow_classification");
  assert.equal(url.searchParams.get("transaction_id"), "123");
  assert.equal(url.searchParams.get("account_id"), "45");
  assert.equal(url.searchParams.get("source_erp"), "quickbooks");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("offset"), "10");
});

test("candidates path accepts a review item OR a transaction lookup, never both", () => {
  const byItem = buildTransactionOverrideCandidatesPath({
    domain: "cash_flow_classification",
    selectors: { verificationItemId: "0123456789abcdef0123456789abcdef" },
  });
  assert.ok(byItem.ok);
  assert.equal(
    byItem.path,
    "/api/v1/catalog/transaction-overrides/candidates?domain=cash_flow_classification&verification_item_id=0123456789abcdef0123456789abcdef"
  );

  const badItem = buildTransactionOverrideCandidatesPath({
    domain: "cash_flow_classification",
    selectors: { verificationItemId: "not-hex" },
  });
  assert.ok(!badItem.ok);
  assert.match(badItem.error, /32-character hex/);

  const byLookup = buildTransactionOverrideCandidatesPath({
    domain: "cash_flow_classification",
    selectors: {
      transaction_id: " JE-10248 ",
      source_erp: "NetSuite",
      transaction_type: "JournalEntry",
    },
  });
  assert.ok(byLookup.ok);
  assert.equal(
    byLookup.path,
    "/api/v1/catalog/transaction-overrides/candidates?domain=cash_flow_classification&transaction_id=JE-10248&source_erp=NetSuite&transaction_type=JournalEntry"
  );

  const narrowingOnly = buildTransactionOverrideCandidatesPath({
    domain: "cash_flow_classification",
    selectors: { source_erp: "netsuite" },
  });
  assert.ok(!narrowingOnly.ok);
  assert.match(narrowingOnly.error, /--transaction-id, --gl-line-id, or --line-identity/);

  const both = buildTransactionOverrideCandidatesPath({
    domain: "cash_flow_classification",
    selectors: {
      verificationItemId: "0123456789abcdef0123456789abcdef",
      transaction_id: "5",
    },
  });
  assert.ok(!both.ok);
  assert.match(both.error, /not both/);

  const neither = buildTransactionOverrideCandidatesPath({
    domain: "cash_flow_classification",
    selectors: {},
  });
  assert.ok(!neither.ok);
  assert.match(neither.error, /--verification-item-id/);
});

test("lookup-driven set never chooses the first match implicitly", () => {
  const a = { cash_flow_line_identity: "a".repeat(64), account_name: "Clearing" };
  const b = { cash_flow_line_identity: "b".repeat(64), account_name: "Clearing" };

  const single = selectTransactionOverrideCandidate({
    candidates: [a],
    truncated: false,
  });
  assert.ok(single.ok);
  assert.equal(single.candidate, a);

  const several = selectTransactionOverrideCandidate({
    candidates: [a, b],
    truncated: false,
  });
  assert.ok(!several.ok);
  assert.match(several.error, /--line-identity|--gl-line-id/);
  assert.match(several.error, new RegExp("b".repeat(64)));

  const explicit = selectTransactionOverrideCandidate({
    candidates: [a, b],
    truncated: false,
    lineIdentity: "B".repeat(64),
  });
  assert.ok(explicit.ok);
  assert.equal(explicit.candidate, b);

  const missing = selectTransactionOverrideCandidate({
    candidates: [a, b],
    truncated: false,
    lineIdentity: "c".repeat(64),
  });
  assert.ok(!missing.ok);

  const truncated = selectTransactionOverrideCandidate({
    candidates: [a],
    truncated: true,
  });
  assert.ok(!truncated.ok);
  assert.match(truncated.error, /Narrow|pl query/);

  const none = selectTransactionOverrideCandidate({
    candidates: [],
    truncated: false,
  });
  assert.ok(!none.ok);
});

test("display rows project compact override and candidate tables", () => {
  const [row] = transactionOverrideDisplayRows([
    {
      id: "o-1",
      source_erp: "quickbooks",
      transaction_id: "123",
      account_id: "45",
      transaction_date: "2026-06-30",
      cash_flow_category: "financing",
      cash_flow_treatment: "financing_cash_counterpart",
      cash_flow_standard_detail: "debt_proceeds_and_repayments",
      override_reason: "Reclassify loan draw.",
      updated_at: "2026-08-01T00:00:00Z",
      cash_flow_line_identity: "ab".repeat(32),
    },
  ]);
  assert.equal(row!.id, "o-1");
  assert.equal(row!.cash_flow_treatment, "financing_cash_counterpart");
  assert.equal("cash_flow_line_identity" in row!, false);

  const [candidate] = transactionOverrideCandidateDisplayRows([
    {
      verification_evidence_line_id: "line-1",
      account_name: "Long-term Debt",
      transaction_id: "123",
      transaction_date: "2026-06-30",
      reporting_amount: "2500",
      current_classification: {
        cash_flow_treatment: "working_capital_change",
        cash_flow_standard_detail: "other_operating_liabilities",
        transaction_override: null,
      },
      payload: {},
    },
  ]);
  assert.equal(candidate!.current_treatment, "working_capital_change");
  assert.equal(candidate!.override_active, false);
});
