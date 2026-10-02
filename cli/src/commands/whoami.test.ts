import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Whoami } from "shared";
import { describeExpiry, formatWhoami } from "./whoami";

const whoami: Whoami = {
  organization: { id: "org-1", name: "Riverside Lumber" },
  credential: { id: "cred-1", label: "Finance agent", connection_instance_id: null, expires_at: null },
  credential_role: "operator",
  allowed_tools: ["pl_catalog_admin", "pl_whoami"],
  operator_grants: {
    allow_auto_approve: false,
    allow_catalog_write_access: true,
    allow_catalog_activation: false,
    allow_business_identity_governance: false,
    allow_organization_report_write_access: false,
    allow_unit_posting: false,
    allow_unit_metric_management: false,
  },
  clearance: "standard",
  insider_cleared: false,
  scope: {
    ledger: "unrestricted",
    dimensions: [],
    row_filter_columns: [],
  },
  allowed_marts: ["gl_lines"],
  ledger: { complete: true, detail_complete: true, reasons: [] },
  guidance: "This credential sees the whole organization.",
};

function response(runtimeWhoami: Whoami): Parameters<typeof formatWhoami>[0] {
  return {
    org_id: "org-1",
    org_name: "Riverside Lumber",
    label: "Finance agent",
    whoami: runtimeWhoami,
  };
}

describe("formatWhoami", () => {
  it("prints exact role, tools, and effective operator grants", () => {
    const output = formatWhoami(
      response(whoami),
      "https://api.pipeledger.ai",
      "/tmp/pipeledger-config.json",
    );

    assert.match(output, /Role:\s+operator/);
    assert.match(output, /Tools:\s+pl_catalog_admin, pl_whoami/);
    assert.match(output, /allow_catalog_write_access=true/);
    assert.match(output, /allow_unit_posting=false/);
  });

  it("reports a version mismatch instead of crashing when an older server omits grants", () => {
    const legacyWhoami = {
      ...whoami,
      operator_grants: undefined,
    } as unknown as Whoami;

    const output = formatWhoami(
      response(legacyWhoami),
      "https://api.pipeledger.ai",
      "/tmp/pipeledger-config.json",
    );

    assert.match(
      output,
      /Operator grants: unavailable \(the server did not return effective grants\)/,
    );
  });
});

it("prints the server-bound connection instance for host diagnostics", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const output = formatWhoami({ org_id: "org-1", org_name: "Riverside Lumber", label: "Finance agent", whoami: { ...whoami, credential: { ...whoami.credential, connection_instance_id: id } } }, "https://app.pipeledger.ai", "/tmp/config");
  assert.ok(output.includes(`Connection ID: ${id}`));
});

it("describes a missing connection instance as no bound access grant", () => {
  const output = formatWhoami(
    { org_id: "org-1", org_name: "Riverside Lumber", label: "Finance agent", whoami },
    "https://app.pipeledger.ai",
    "/tmp/config"
  );
  assert.match(output, /Connection ID: no access grant bound/);
});

it("summarizes a scoped credential by count and never prints source keys", () => {
  const sourceKey =
    "source:LegalEntity:11111111-1111-4111-8111-111111111111:netsuite:22222222-2222-4222-8222-222222222222:1";
  const output = formatWhoami(
    {
      org_id: "org-1",
      org_name: "Riverside Lumber",
      label: "Finance agent",
      whoami: {
        ...whoami,
        scope: {
          ledger: "legal_entity",
          dimensions: [
            { dimension: "legal_entity_id", values: [sourceKey, `${sourceKey}b`] },
          ],
          row_filter_columns: [],
        },
      },
    },
    "https://app.pipeledger.ai",
    "/tmp/config",
  );
  assert.match(output, /Scope:\s+legal_entity \(legal_entity_id: 2 values\)/);
  assert.match(output, /Scope detail:.*pl whoami --json.*pl resolve/);
  assert.equal(output.includes("source:LegalEntity"), false);
});

it("prints no scope detail line for an unrestricted credential", () => {
  const output = formatWhoami(
    { org_id: "org-1", org_name: "Riverside Lumber", label: "Finance agent", whoami },
    "https://app.pipeledger.ai",
    "/tmp/config",
  );
  assert.match(output, /Scope:\s+unrestricted \(all rows\)/);
  assert.doesNotMatch(output, /Scope detail/);
});

describe("the access end date", () => {
  const NOW = new Date("2026-09-29T12:00:00.000Z");

  it("shows the date and the days left", () => {
    assert.equal(
      describeExpiry("2026-12-20T09:30:00.000Z", NOW),
      "2026-12-20 (81 days left)",
    );
  });

  it("asks for action inside the last two weeks", () => {
    assert.equal(
      describeExpiry("2026-10-12T12:00:00.000Z", NOW),
      "2026-10-12 (13 days left; ask an Owner or Admin to extend it or issue a new credential)",
    );
    assert.equal(
      describeExpiry("2026-10-13T12:00:00.000Z", NOW),
      "2026-10-13 (14 days left)",
    );
    assert.match(describeExpiry("2026-09-30T11:00:00.000Z", NOW), /\(less than a day left; ask/);
    assert.match(describeExpiry("2026-09-30T13:00:00.000Z", NOW), /\(1 day left; ask/);
  });

  it("says when no end date is set or the access has ended", () => {
    assert.equal(describeExpiry(null, NOW), "no end date set");
    assert.equal(describeExpiry("2026-09-29T11:59:59.000Z", NOW), "2026-09-29 (ended)");
  });

  it("does not claim 'no end date' when an older service omits the field", () => {
    assert.equal(describeExpiry(undefined, NOW), "not reported by the service");
    assert.equal(describeExpiry("soon", NOW), "not reported by the service");
  });

  it("prints the line in pl whoami", () => {
    const output = formatWhoami(
      response({
        ...whoami,
        credential: { ...whoami.credential, expires_at: "2026-12-20T09:30:00.000Z" },
      }),
      "https://app.pipeledger.ai",
      "/tmp/config",
      "riverside-lumber (chosen by this folder)",
      NOW,
    );
    assert.ok(output.includes("Access ends:   2026-12-20 (81 days left)"));
    assert.ok(output.includes("Profile:       riverside-lumber (chosen by this folder)"));
  });
});
