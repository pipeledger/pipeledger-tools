/**
 * Pure argument/payload helpers for `pl unit-register get|update|void`,
 * extracted from the commander actions so they can be unit-tested with the
 * same idiom as src/lib/query.ts (no network, no filesystem).
 *
 * Contract notes mirrored from the REST v1 surface:
 *   - get is a SINGLE-voucher lookup: exactly one of --voucher-id /
 *     --source-ref (list mode was removed from the public contract;
 *     deferred until a designed pagination surface exists).
 *   - update files carry the OPAQUE `version` token copied verbatim from
 *     get; the CLI never constructs, parses, or increments it. memo is
 *     tri-state: omitted preserves, null clears, string replaces -- the
 *     helper passes all three states through untouched.
 */

import type {
  UnitVoucherUpdateRequestInput,
  UnitVoucherVoidInput,
} from "shared";

export type UnitRegisterParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; issues: string[] };

/**
 * Build the query string for the single-voucher GET. Exactly one of
 * voucherId/sourceRef is required; both or neither is a usage error the CLI
 * reports without a request.
 */
export function buildUnitVoucherGetQuery(opts: {
  voucherId?: string;
  sourceRef?: string;
}): { ok: true; query: string } | { ok: false; error: string } {
  const voucherId = opts.voucherId?.trim();
  const sourceRef = opts.sourceRef?.trim();
  if (voucherId && sourceRef) {
    return {
      ok: false,
      error: "Provide --voucher-id OR --source-ref, not both.",
    };
  }
  if (!voucherId && !sourceRef) {
    return {
      ok: false,
      error:
        "Provide --voucher-id or --source-ref. `pl unit-register get` is a single-voucher lookup (a list mode is deferred).",
    };
  }
  const params = new URLSearchParams();
  if (voucherId) params.set("voucher_id", voucherId);
  if (sourceRef) params.set("source_ref", sourceRef);
  return { ok: true, query: `?${params.toString()}` };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Pass an update file through to the service, which validates it and returns
 * field-level errors. Only the file's shape is checked here. The memo
 * tri-state (absent stays absent, null stays null) and the opaque `version`
 * token reach the service exactly as written.
 */
export function parseUnitVoucherUpdatePayload(
  json: unknown
): UnitRegisterParseResult<UnitVoucherUpdateRequestInput> {
  if (!isJsonObject(json)) {
    return { ok: false, issues: ["payload: must be one JSON object"] };
  }
  return { ok: true, data: json as UnitVoucherUpdateRequestInput };
}

/** Build the void request; the service validates the id and the reason. */
export function parseUnitVoucherVoidPayload(opts: {
  voucherId: string;
  reason?: string;
}): UnitRegisterParseResult<UnitVoucherVoidInput> {
  const voucherId = opts.voucherId?.trim();
  if (!voucherId) {
    return { ok: false, issues: ["voucher_id: required"] };
  }
  return {
    ok: true,
    data: {
      voucher_id: voucherId,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    } as UnitVoucherVoidInput,
  };
}
