import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnitVoucherGetQuery,
  parseUnitVoucherUpdatePayload,
  parseUnitVoucherVoidPayload,
} from "./unit-register";

const VOUCHER_ID = "77777777-7777-4777-8777-777777777777";

const UPDATE_FILE = {
  voucher_id: VOUCHER_ID,
  voucher_date: "2026-06-30",
  posting_period: "2026-06",
  voucher_type: "activity",
  version: "uvv1_Mi4x",
  entries: [
    {
      metric_key: "token_usage",
      movement_type: "usage",
      quantity_signed: 125000,
      unit_of_measure: "token",
    },
  ],
};

test("buildUnitVoucherGetQuery requires exactly one lookup key", () => {
  const byId = buildUnitVoucherGetQuery({ voucherId: VOUCHER_ID });
  assert.deepEqual(byId, { ok: true, query: `?voucher_id=${VOUCHER_ID}` });

  const byRef = buildUnitVoucherGetQuery({ sourceRef: "usage-2026-06-1" });
  assert.deepEqual(byRef, { ok: true, query: "?source_ref=usage-2026-06-1" });

  const both = buildUnitVoucherGetQuery({
    voucherId: VOUCHER_ID,
    sourceRef: "usage-2026-06-1",
  });
  assert.equal(both.ok, false);
  if (!both.ok) assert.match(both.error, /not both/);

  // Neither: single-voucher lookup only -- the removed list mode must fail
  // client-side with the deferral message, not fall through to a request.
  const neither = buildUnitVoucherGetQuery({});
  assert.equal(neither.ok, false);
  if (!neither.ok) assert.match(neither.error, /single-voucher lookup/);
});

test("buildUnitVoucherGetQuery url-encodes the source_ref", () => {
  const built = buildUnitVoucherGetQuery({ sourceRef: "ref with spaces&x" });
  assert.deepEqual(built, { ok: true, query: "?source_ref=ref+with+spaces%26x" });
});

test("update payload passes the opaque version token through verbatim", () => {
  const ok = parseUnitVoucherUpdatePayload(UPDATE_FILE);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    // The CLI never decodes, edits, or supplies the token.
    assert.equal(ok.data.version, "uvv1_Mi4x");
    assert.deepEqual(ok.data, UPDATE_FILE);
  }
});

test("update payload leaves contract validation to the service", () => {
  // A missing version and a malformed id are the service's to refuse, with
  // field-level errors. The CLI must not invent or repair either.
  const { version, ...withoutVersion } = UPDATE_FILE;
  void version;
  const missing = parseUnitVoucherUpdatePayload(withoutVersion);
  assert.equal(missing.ok, true);
  if (missing.ok) assert.equal("version" in missing.data, false);

  const malformed = parseUnitVoucherUpdatePayload({
    ...UPDATE_FILE,
    voucher_id: "nope",
  });
  assert.equal(malformed.ok, true);
  if (malformed.ok) assert.equal(malformed.data.voucher_id, "nope");
});

test("update payload preserves the memo tri-state", () => {
  // Omitted -> stays omitted (server PRESERVES the stored memo).
  const omitted = parseUnitVoucherUpdatePayload(UPDATE_FILE);
  assert.equal(omitted.ok, true);
  if (omitted.ok) assert.equal("memo" in omitted.data, false);

  // null -> stays null (server CLEARS the memo).
  const cleared = parseUnitVoucherUpdatePayload({ ...UPDATE_FILE, memo: null });
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.data.memo, null);

  // string -> replacement text.
  const replaced = parseUnitVoucherUpdatePayload({
    ...UPDATE_FILE,
    memo: "corrected quantities",
  });
  assert.equal(replaced.ok, true);
  if (replaced.ok) assert.equal(replaced.data.memo, "corrected quantities");
});

test("update payload must be one JSON object", () => {
  for (const value of [null, [], "text", 7]) {
    const bad = parseUnitVoucherUpdatePayload(value);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.deepEqual(bad.issues, ["payload: must be one JSON object"]);
  }
});

test("void payload requires a voucher id and passes reason through", () => {
  const ok = parseUnitVoucherVoidPayload({
    voucherId: ` ${VOUCHER_ID} `,
    reason: "duplicate posting",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.data.voucher_id, VOUCHER_ID);
    assert.equal(ok.data.reason, "duplicate posting");
  }

  const withoutReason = parseUnitVoucherVoidPayload({ voucherId: VOUCHER_ID });
  assert.equal(withoutReason.ok, true);
  if (withoutReason.ok) assert.equal("reason" in withoutReason.data, false);

  const bad = parseUnitVoucherVoidPayload({ voucherId: "  " });
  assert.equal(bad.ok, false);
});
