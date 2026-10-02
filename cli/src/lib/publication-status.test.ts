import assert from "node:assert/strict";
import test from "node:test";
import type { PublicationCertification } from "shared";

import {
  calendarMonthFromDate,
  formatPublicationCertificationNotice,
  formatPublicationNotice,
  type PublishedStatusMart,
} from "./publication-status";

const LEGACY_CERTIFICATION = {
  authority: "PipeLedger",
  policy: { id: "pipeledger_governed_mart_publication", version: 1 },
  outcome: "certified",
  evidence_version: null,
  evidence_completeness: "legacy_partial",
  gates: {
    materialization: "passed",
    financial_integrity: "passed",
    physical_schema_contract: "passed",
  },
  runtime_tests: null,
  release_scenarios: null,
  schema_documentation: null,
  test_evidence: null,
} as const satisfies PublicationCertification;

const baseStatus: PublishedStatusMart = {
  mart_name: "mart_gl_lines",
  short_name: "gl_lines",
  last_published_at: "2026-04-15T13:00:00.000Z",
  last_published_run: "run-public",
  latest_certified_run: "run-latest",
  is_certified: true,
  is_stale: true,
  user_approved_at: "2026-04-15T12:00:00.000Z",
  active_insider_publication: null,
  public_window: null,
  requested_period: null,
};

test("calendarMonthFromDate normalizes date-like values to month starts", () => {
  assert.equal(calendarMonthFromDate("2026-04-30"), "2026-04-01");
  assert.equal(calendarMonthFromDate("2026-04-30T12:00:00Z"), "2026-04-01");
  assert.equal(calendarMonthFromDate(null), undefined);
});

test("formatPublicationNotice returns null when no insider context exists", () => {
  assert.equal(
    formatPublicationNotice({
      martLabel: "General Ledger Lines",
      status: baseStatus,
    }),
    null
  );
});

test("formatPublicationNotice warns for public-channel active insider windows", () => {
  const notice = formatPublicationNotice({
    martLabel: "General Ledger Lines",
    status: {
      ...baseStatus,
      active_insider_publication: {
        id: "pub-1",
        status: "insider_published",
        pipeline_run_id: "run-insider",
        mart_sync_status_id: "sync-1",
        release_at: "2026-07-15T13:00:00.000Z",
        published_to_insider_at: "2026-04-10T13:00:00.000Z",
        hold_reason: null,
      },
      public_window: {
        public_before: "2026-01-01",
        released_through: "2026-03-31",
      },
    },
  });

  assert.match(notice ?? "", /active Corporate Insider publication/);
  assert.match(notice ?? "", /through 2026-03-31/);
});

test("formatPublicationNotice warns more specifically for restricted requested periods", () => {
  const notice = formatPublicationNotice({
    martLabel: "Trial balance",
    status: {
      ...baseStatus,
      active_insider_publication: {
        id: "pub-1",
        status: "insider_published",
        pipeline_run_id: "run-insider",
        mart_sync_status_id: "sync-1",
        release_at: "2026-07-15T13:00:00.000Z",
        published_to_insider_at: "2026-04-10T13:00:00.000Z",
        hold_reason: null,
      },
      public_window: {
        public_before: "2026-01-01",
        released_through: "2026-03-31",
      },
      requested_period: {
        calendar_month: "2026-04-01",
        is_public: false,
        insider_restricted: true,
        insider_release_at: "2026-07-15T13:00:00.000Z",
      },
    },
  });

  assert.match(notice ?? "", /2026-04-01 is insider-restricted/);
});

test("formatPublicationNotice warns for restricted periods without exposing hidden insider details", () => {
  const notice = formatPublicationNotice({
    martLabel: "Trial balance",
    status: {
      ...baseStatus,
      active_insider_publication: null,
      public_window: {
        public_before: "2026-01-01",
        released_through: "2026-03-31",
      },
      requested_period: {
        calendar_month: "2026-04-01",
        is_public: false,
        insider_restricted: true,
        insider_release_at: null,
      },
    },
  });

  assert.match(notice ?? "", /2026-04-01 is insider-restricted/);
  assert.match(notice ?? "", /through 2026-03-31/);
  assert.doesNotMatch(notice ?? "", /Release:/);
});

test("formatPublicationNotice warns when the report itself used insider channel", () => {
  const notice = formatPublicationNotice({
    martLabel: "General Ledger Lines",
    status: baseStatus,
    sourceProvenance: {
      release_channel: "insider",
      is_unreleased_insider: true,
      release_at: "2026-07-15T13:00:00.000Z",
    },
  });

  assert.match(notice ?? "", /Insider channel/);
  assert.match(notice ?? "", /Do not share externally/);
});

test("formatPublicationCertificationNotice names PipeLedger and bounded per-mart evidence", () => {
  const notice = formatPublicationCertificationNotice({
    ...LEGACY_CERTIFICATION,
    evidence_version: 1,
    evidence_completeness: "complete",
    runtime_tests: {
      direct_mart: {
        selected: 10,
        executed: 9,
        passed: 8,
        warned: 1,
        failed: 0,
        skipped: 1,
        missing_required: 0,
      },
      selected_run_graph: {
        selected: 40,
        executed: 40,
        passed: 40,
        warned: 0,
        failed: 0,
        skipped: 0,
        missing_required: 0,
      },
    },
    release_scenarios: {
      status: "passed",
      selected: 35,
      passed: 35,
    },
    schema_documentation: {
      documented_delivered_columns: 20,
      delivered_columns: 20,
      coverage_percent: 100,
    },
    test_evidence: {
      runtime_pipeline_run_id: "11111111-1111-4111-8111-111111111111",
      change_aware: {
        mode: "executed",
        evidence_pipeline_run_id: "11111111-1111-4111-8111-111111111111",
        runtime_tests: {
          selected: 2,
          executed: 2,
          passed: 2,
          warned: 0,
          failed: 0,
          skipped: 0,
          missing_required: 0,
        },
      },
    },
  });

  assert.match(notice ?? "", /^Certified by PipeLedger;/);
  assert.match(notice ?? "", /direct mart tests 8 passed, 1 warned, 0 failed of 9 executed/);
  assert.match(notice ?? "", /schema documentation 20\/20 \(100%\)/);
  assert.match(
    notice ?? "",
    /deterministic model scenarios 35\/35 passed for the attested transform release/,
  );
  assert.doesNotMatch(notice ?? "", /semantic coverage|Dagster|a{8}/i);
});

test("formatPublicationCertificationNotice qualifies legacy counts", () => {
  const notice = formatPublicationCertificationNotice(
    LEGACY_CERTIFICATION
  );

  assert.match(notice ?? "", /Certified by PipeLedger/);
  assert.match(notice ?? "", /not recorded for this legacy publication/);
});
