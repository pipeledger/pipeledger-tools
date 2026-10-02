import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildResolveRequestBody,
  formatBlockedNotice,
  formatDirectoryCount,
  formatEntityContextNotice,
  formatReviewPage,
  formatServingPublicationNotice,
  resolveCommand,
  toResolveDisplayRows,
  type ResolveResponse,
} from "./resolve";

function response(over: Partial<ResolveResponse> = {}): ResolveResponse {
  return {
    action: "search",
    query: "castilian",
    catalog_version: null,
    resolver_version: "semantic-objects-v5",
    serving_publication: {
      mart: "semantic_objects",
      run_id: "run-1",
      published_at: "2026-08-15T00:00:00Z",
      release_channel: "public",
    },
    candidates: [],
    directory_entries: [],
    review_entries: [],
    object_type_status: [{ object_type: "vendor", supported: true }],
    resolution: {
      ambiguous: false,
      clarification_recommended: false,
      guidance: "",
    },
    ...over,
  };
}

describe("pl resolve request", () => {
  it("sends the same shape the MCP tool input takes", () => {
    assert.deepEqual(
      buildResolveRequestBody("castilian", {
        objectType: "vendor",
        action: "search",
        limit: 10,
      }),
      { object_type: "vendor", action: "search", query: "castilian", limit: 10 },
    );
  });

  it("omits query for a directory listing rather than sending an empty string", () => {
    const body = buildResolveRequestBody(undefined, {
      objectType: "vendor",
      action: "list",
      limit: 25,
    });
    assert.equal("query" in body, false);
    assert.equal(body.limit, 25);
  });

  it("sends a review cursor and only populated review filters", () => {
    assert.deepEqual(
      buildResolveRequestBody(undefined, {
        objectType: "vendor",
        action: "review",
        limit: 50,
        cursor: "plrr1.opaque",
        availabilityStates: "current,current",
        advisoryRoles: "contractor, supplier",
        evidenceBasisQuery: "1099",
      }),
      {
        object_type: "vendor",
        action: "review",
        limit: 50,
        cursor: "plrr1.opaque",
        review_filters: {
          availability_states: ["current"],
          activity_evidence_states: [],
          governed_role_states: [],
          governed_roles: [],
          advisory_role_evidence_states: [],
          advisory_roles: ["contractor", "supplier"],
          business_identity_states: [],
          source_erps: [],
          evidence_basis_query: "1099",
        },
      },
    );
  });
});

describe("pl resolve policy blocks", () => {
  /**
   * The governance-visible branch. A policy-limited kind is an ANSWER: the
   * command prints why and exits 0. Reporting it as an error would tell an
   * operator the tool is broken when the organization's delivery policy is
   * working exactly as configured.
   */
  it("renders an unsupported object kind as an answer carrying its reason", () => {
    const notice = formatBlockedNotice(
      response({
        object_type_status: [
          {
            object_type: "vendor",
            supported: false,
            reason:
              "Vendor plaintext name search is unavailable under this credential's identity-tokenization policy.",
          },
        ],
        resolution: {
          ambiguous: false,
          clarification_recommended: false,
          guidance: "Use pl resolve action=list to enumerate with tokens.",
        },
      }),
    );

    assert.ok(notice);
    assert.match(notice, /vendor: not available for this credential/);
    assert.match(notice, /identity-tokenization policy/);
    assert.match(notice, /action=list to enumerate with tokens/);
  });

  it("returns null when every requested kind is supported", () => {
    assert.equal(formatBlockedNotice(response()), null);
  });
});

describe("pl resolve serving publication", () => {
  it("names the approved snapshot that answered", () => {
    assert.equal(
      formatServingPublicationNotice(response().serving_publication),
      "Business Object Directory publication: run-1, published 2026-08-15T00:00:00Z, public channel.",
    );
  });

  it("stays silent for metric resolution, which reads no publication", () => {
    assert.equal(formatServingPublicationNotice(null), null);
  });
});

describe("pl resolve rows", () => {
  it("renders directory entries with their governed reporting id", () => {
    const rows = toResolveDisplayRows(
      response({
        action: "list",
        directory_entries: [
          {
            display_name: "VEND_S41DDPTF",
            display_label: "VEND_S41DDPTF",
            reporting_object_id: "canonical:Vendor:vendor-1",
            source_binding_count: 2,
          },
        ],
      }),
    );
    assert.deepEqual(rows, [
      {
        label: "VEND_S41DDPTF",
        reporting_id: "canonical:Vendor:vendor-1",
        sources: 2,
      },
    ]);
  });

  it("renders search candidates with confidence", () => {
    const rows = toResolveDisplayRows(
      response({
        candidates: [
          {
            object_type: "vendor",
            id: "vendor-1",
            label: "Castilian Supply",
            confidence: 0.9123,
          },
        ],
      }),
    );
    assert.deepEqual(rows, [
      {
        id: "vendor-1",
        label: "Castilian Supply",
        confidence: "0.91",
        type: "vendor",
      },
    ]);
  });

  it("renders temporal metric calculation, activity window, and result unit", () => {
    const rows = toResolveDisplayRows(
      response({
        candidates: [
          {
            object_type: "metric",
            id: "roce",
            label: "Return on Capital Employed",
            confidence: 1,
            calculation: "activity_over_average_balance",
            flow_window: "trailing_12_months",
            result_unit: "percentage",
          },
        ],
      }),
    );
    assert.deepEqual(rows, [
      {
        id: "roce",
        label: "Return on Capital Employed",
        confidence: "1.00",
        type: "metric",
        calculation: "activity_over_average_balance",
        flow_window: "trailing_12_months",
        result_unit: "percentage",
      },
    ]);
  });

  it("reports truncation against the exact authorized population", () => {
    assert.equal(
      formatDirectoryCount(
        response({
          action: "list",
          directory_count: {
            authorized_object_count: 120,
            returned_object_count: 25,
            truncated: true,
          },
        }),
      ),
      "25 of 120 governed objects (truncated)",
    );
    assert.equal(formatDirectoryCount(response()), null);
  });

  it("renders exact review records and the continuation cursor", () => {
    const review = response({
      action: "review",
      review_entries: [
        {
          label: "Riverside Electrical",
          source_erp: "quickbooks",
          source_record_id: "42",
          business_role: null,
          business_role_state: "unmapped",
          business_role_evidence_candidate: "contractor",
          business_role_evidence_state: "source_field_evidence",
          business_identity_state: "unmapped",
          activity_evidence_state: "fact_observed",
          availability_state: "current",
          evidence_basis: "quickbooks_vendor_1099_tracking",
        },
      ],
      review_page: {
        authorized_record_count: 626,
        page_offset: 0,
        returned_record_count: 1,
        truncated: true,
        next_cursor: "plrr1.next",
      },
    });

    assert.deepEqual(toResolveDisplayRows(review), [
      {
        label: "Riverside Electrical",
        source: "quickbooks:42",
        governed_role: "unmapped",
        advisory_role: "contractor",
        identity: "unmapped",
        activity: "fact_observed",
        availability: "current",
        evidence: "quickbooks_vendor_1099_tracking",
      },
    ]);
    assert.equal(
      formatReviewPage(review),
      "1 records on this page; 1 of 626 filtered source records reviewed\nnext_cursor: plrr1.next",
    );
    assert.equal(formatReviewPage(response()), null);
  });
});

describe("pl resolve command wiring", () => {
  it("defaults to a metric search and exposes directory and review controls", () => {
    assert.equal(resolveCommand.name(), "resolve");
    const options = resolveCommand.options.map((option) => option.long);
    assert.ok(options.includes("--object-type"));
    assert.ok(options.includes("--action"));
    assert.ok(options.includes("--cursor"));
    assert.ok(options.includes("--advisory-roles"));
    assert.ok(options.includes("--evidence-basis-query"));
    assert.ok(options.includes("--format"));
  });
});

describe("pl resolve entity context", () => {
  it("forwards exact context selectors and opaque cursor without converting IDs or decimal strings", () => {
    const context = {
      period: { start: "2026-01-01", end: "2026-12-31" },
      party_references: [
        {
          object_kind: "vendor",
          reporting_object_id: "canonical:Vendor:00042",
          connector_id: "connector",
          source_erp: "quickbooks",
        },
      ],
    };
    assert.deepEqual(
      buildResolveRequestBody(undefined, {
        objectType: "legal_entity",
        action: "context",
        limit: 20,
        context: JSON.stringify(context),
        cursor: "context-cursor",
      }),
      {
        object_type: "legal_entity",
        action: "context",
        limit: 20,
        cursor: "context-cursor",
        context,
      },
    );
    assert.throws(
      () =>
        buildResolveRequestBody(undefined, {
          objectType: "legal_entity",
          action: "context",
          limit: 20,
          context: "{broken",
        }),
      SyntaxError,
    );
    assert.ok(
      resolveCommand.options.some((option) => option.long === "--context"),
    );
  });

  it("retains dated legal profiles and exact ownership fractions in human output", () => {
    const data = response({
      action: "context",
      entity_context: {
        entries: [
          {
            business_identity_id: "company-id",
            display_name: "LedgerLabs LLC",
            identity_kind: "organization",
            profiles: [
              {
                legal_form: "llc",
                tax_classification: "partnership",
                tax_regime: "us_federal_income_tax",
                tax_jurisdiction_country_code: "US",
                effective_from: "2026-01-01",
                effective_to: "2026-07-01",
              },
              {
                legal_form: "llc",
                tax_classification: "s_corporation",
                tax_regime: "us_federal_income_tax",
                tax_jurisdiction_country_code: "US",
                effective_from: "2026-07-01",
                effective_to: null,
              },
            ],
            owners: [
              {
                owner_display_name: "Owner",
                ownership_share: "0.123456789012345678",
                effective_from: "2026-04-01",
                effective_to: null,
              },
            ],
            memberships: [
              {
                group_name: "Group",
                effective_from: "2026-05-01",
                effective_to: "2026-12-01",
              },
            ],
          },
        ],
        period: { start: "2026-01-01", end: "2026-12-31" },
        source_directory_publication_run_id: "directory-run",
        next_cursor: "continue-here",
      },
    });
    const [row] = toResolveDisplayRows(data);
    assert.equal(row.identity_id, "company-id");
    assert.match(
      String(row.legal_profiles),
      /partnership .*\[2026-01-01, 2026-07-01\)/,
    );
    assert.match(
      String(row.legal_profiles),
      /s_corporation .*\[2026-07-01, open\)/,
    );
    assert.match(String(row.legal_profiles), /US: us_federal_income_tax/);
    assert.equal(
      row.owners,
      "Owner: 0.123456789012345678 fraction [2026-04-01, open)",
    );
    assert.equal(row.groups, "Group [2026-05-01, 2026-12-01)");
    assert.equal(
      formatEntityContextNotice(data),
      "Requested context period: 2026-01-01 to 2026-12-31\nSource directory publication: directory-run\nnext_cursor: continue-here",
    );
  });

  it("does not invent classification or ownership and identifies context publication separately", () => {
    const data = response({
      action: "context",
      entity_context: {
        entries: [
          {
            business_identity_id: "id",
            display_name: "Company",
            identity_kind: "organization",
            profiles: [],
            owners: [],
            memberships: [],
          },
        ],
        as_of: "2026-10-01",
      },
      serving_publication: {
        mart: "entity_context",
        run_id: "context-run",
        published_at: "2026-10-01T12:00:00Z",
        release_channel: "public",
      },
    });
    assert.equal(
      toResolveDisplayRows(data)[0].legal_profiles,
      "No dated classification recorded",
    );
    assert.equal(toResolveDisplayRows(data)[0].owners, "None recorded");
    assert.equal(
      formatEntityContextNotice(data),
      "Context effective on: 2026-10-01",
    );
    assert.equal(
      formatServingPublicationNotice(data.serving_publication),
      "Entity Context publication: context-run, published 2026-10-01T12:00:00Z, public channel.",
    );
    assert.equal(formatEntityContextNotice(response()), null);
  });
});
