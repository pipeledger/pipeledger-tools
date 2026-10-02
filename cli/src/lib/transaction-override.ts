/**
 * Pure argument/payload helpers for `pl catalog transaction-override`,
 * extracted from the commander actions so they are unit-testable with the
 * same idiom as src/lib/unit-register.ts (no network, no filesystem).
 *
 * Payload files and lookups are validated by the service, which owns the
 * domain schemas and returns field-level errors. The CLI checks only what it
 * needs to build a request: a known domain name, a JSON object, and the
 * either/or choice between a review finding and a transaction lookup.
 * `--domain` always defaults to cash_flow_classification but is echoed in
 * output so the generic framing stays visible.
 */

import {
  TRANSACTION_OVERRIDE_DOMAIN_VALUES,
  isTransactionOverrideDomain,
  type TransactionOverrideDomain,
} from "shared/src/public-client";

/** Lookup selectors the candidates endpoint accepts, in request order. */
export const TRANSACTION_OVERRIDE_CANDIDATE_LOOKUP_KEYS = [
  "transaction_id",
  "source_erp",
  "connector_id",
  "gl_line_id",
  "cash_flow_line_identity",
  "transaction_type",
] as const;

export type TransactionOverrideCandidateLookupInput = Partial<
  Record<
    (typeof TRANSACTION_OVERRIDE_CANDIDATE_LOOKUP_KEYS)[number],
    string | null
  >
>;

export const DEFAULT_TRANSACTION_OVERRIDE_DOMAIN: TransactionOverrideDomain =
  "cash_flow_classification";

export type TransactionOverrideParseResult =
  | { ok: true; domain: TransactionOverrideDomain; payload: Record<string, unknown> }
  | { ok: false; issues: string[] };

export function parseTransactionOverrideDomain(
  value: string
): TransactionOverrideDomain | { error: string } {
  const trimmed = value.trim();
  if (!isTransactionOverrideDomain(trimmed)) {
    return {
      error: `Unsupported transaction-override domain '${trimmed}'. Supported domains: ${TRANSACTION_OVERRIDE_DOMAIN_VALUES.join(", ")}.`,
    };
  }
  return trimmed;
}

/**
 * Accept an edit/void payload file for submission. The domain schema lives in
 * the service; `kind` is kept so callers state which request they are
 * building.
 */
export function parseTransactionOverridePayload(args: {
  domain: string;
  kind: "edit" | "void";
  json: unknown;
}): TransactionOverrideParseResult {
  const domain = parseTransactionOverrideDomain(args.domain);
  if (typeof domain !== "string") {
    return { ok: false, issues: [domain.error] };
  }
  if (
    !args.json ||
    typeof args.json !== "object" ||
    Array.isArray(args.json)
  ) {
    return { ok: false, issues: ["payload: must be one JSON object"] };
  }
  return {
    ok: true,
    domain,
    payload: args.json as Record<string, unknown>,
  };
}

export function buildTransactionOverrideListPath(opts: {
  domain: TransactionOverrideDomain;
  transactionId?: string;
  accountId?: string;
  sourceErp?: string;
  limit?: number;
  offset?: number;
}): string {
  const params = new URLSearchParams({ domain: opts.domain });
  if (opts.transactionId?.trim()) {
    params.set("transaction_id", opts.transactionId.trim());
  }
  if (opts.accountId?.trim()) {
    params.set("account_id", opts.accountId.trim());
  }
  if (opts.sourceErp?.trim()) {
    params.set("source_erp", opts.sourceErp.trim().toLowerCase());
  }
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  return `/api/v1/catalog/transaction-overrides?${params.toString()}`;
}

export interface TransactionOverrideCandidateSelectors
  extends TransactionOverrideCandidateLookupInput {
  verificationItemId?: string | null;
}

/**
 * Candidates path for either basis. A verification item id (review finding)
 * and a transaction lookup (BI/ERP reference) are mutually exclusive. Lookup
 * values are trimmed and sent as typed; the service normalizes and validates
 * them.
 */
export function buildTransactionOverrideCandidatesPath(opts: {
  domain: TransactionOverrideDomain;
  selectors: TransactionOverrideCandidateSelectors;
}): { ok: true; path: string } | { ok: false; error: string } {
  const verificationItemId = opts.selectors.verificationItemId?.trim() ?? "";
  const lookupInput: Record<string, string> = {};
  for (const key of TRANSACTION_OVERRIDE_CANDIDATE_LOOKUP_KEYS) {
    const value = opts.selectors[key];
    if (typeof value === "string" && value.trim() !== "") {
      lookupInput[key] = value.trim();
    }
  }
  const hasLookup = Object.keys(lookupInput).length > 0;
  if (verificationItemId && hasLookup) {
    return {
      ok: false,
      error:
        "Use either --verification-item-id (a review finding) or a transaction lookup (--transaction-id, --gl-line-id, --line-identity and narrowing flags), not both.",
    };
  }
  const params = new URLSearchParams({ domain: opts.domain });
  if (verificationItemId) {
    if (!/^[a-f0-9]{32}$/.test(verificationItemId)) {
      return {
        ok: false,
        error:
          "--verification-item-id must be the 32-character hex id of a published verification item (see the Data Review page or the verification API).",
      };
    }
    params.set("verification_item_id", verificationItemId);
  } else if (hasLookup) {
    if (
      !lookupInput.transaction_id &&
      !lookupInput.gl_line_id &&
      !lookupInput.cash_flow_line_identity
    ) {
      return {
        ok: false,
        error:
          "A transaction lookup needs --transaction-id, --gl-line-id, or --line-identity; --source-erp, --connector-id, and --transaction-type only narrow it.",
      };
    }
    for (const key of TRANSACTION_OVERRIDE_CANDIDATE_LOOKUP_KEYS) {
      const value = lookupInput[key];
      if (value !== undefined) params.set(key, value);
    }
  } else {
    return {
      ok: false,
      error:
        "Provide --verification-item-id (a review finding) or a transaction lookup: --gl-line-id, --line-identity, or --transaction-id, optionally narrowed by --source-erp, --connector-id, --transaction-type. Dates, amounts, and accounts are `pl query` filters.",
    };
  }
  return {
    ok: true,
    path: `/api/v1/catalog/transaction-overrides/candidates?${params.toString()}`,
  };
}

/**
 * Pick exactly one candidate for a lookup-driven `set`. Conservative by
 * design: an explicit --line-identity always wins; without it, only a single
 * complete candidate on a non-truncated page is accepted. The first match is
 * never chosen implicitly.
 */
export function selectTransactionOverrideCandidate(args: {
  candidates: Array<Record<string, unknown>>;
  truncated: boolean;
  lineIdentity?: string | null;
}): { ok: true; candidate: Record<string, unknown> } | { ok: false; error: string } {
  const wanted = args.lineIdentity?.trim().toLowerCase() ?? "";
  if (wanted) {
    const matches = args.candidates.filter(
      (candidate) =>
        String(candidate.cash_flow_line_identity ?? "").toLowerCase() === wanted
    );
    if (matches.length === 1) return { ok: true, candidate: matches[0]! };
    return {
      ok: false,
      error:
        matches.length === 0
          ? "No candidate carries that --line-identity. Run `candidates --format json` and copy cash_flow_line_identity from the intended line."
          : "More than one candidate carries that line identity; refusing to guess.",
    };
  }
  if (args.truncated) {
    return {
      ok: false,
      error:
        "The lookup matched more lines than one page holds. Narrow it (--connector-id, --transaction-type) or find the exact line with `pl query`, then pass --gl-line-id or --line-identity.",
    };
  }
  if (args.candidates.length === 1) {
    return { ok: true, candidate: args.candidates[0]! };
  }
  if (args.candidates.length === 0) {
    return {
      ok: false,
      error:
        "No eligible line matched. Only Balance Sheet counterpart lines of cash-backed activity can be overridden; check the reference, --source-erp, and --connector-id.",
    };
  }
  const identities = args.candidates
    .map(
      (candidate) =>
        `  ${String(candidate.cash_flow_line_identity ?? "?")}  ${String(candidate.account_name ?? "")}  ${String(candidate.transaction_date ?? "")}  ${String(candidate.reporting_amount ?? "")}`
    )
    .join("\n");
  return {
    ok: false,
    error: `Several eligible lines share this reference; pass --line-identity for the exact one:\n${identities}`,
  };
}

export function transactionOverrideDisplayRows(
  rows: Array<Record<string, unknown>>
): Record<string, unknown>[] {
  return rows.map((row) => ({
    id: row.id,
    source_erp: row.source_erp,
    transaction_id: row.transaction_id,
    account_id: row.account_id,
    transaction_date: row.transaction_date,
    cash_flow_category: row.cash_flow_category,
    cash_flow_treatment: row.cash_flow_treatment,
    cash_flow_standard_detail: row.cash_flow_standard_detail,
    override_reason: row.override_reason,
    updated_at: row.updated_at,
  }));
}

/** Compact table projection for `transaction-override candidates`. */
export function transactionOverrideCandidateDisplayRows(
  candidates: Array<Record<string, unknown>>
): Record<string, unknown>[] {
  return candidates.map((candidate) => {
    const current = (candidate.current_classification ?? {}) as Record<
      string,
      unknown
    >;
    const override = current.transaction_override as Record<
      string,
      unknown
    > | null;
    const context = (candidate.account_context ?? null) as Record<
      string,
      unknown
    > | null;
    return {
      cash_flow_line_identity: candidate.cash_flow_line_identity,
      account_name: candidate.account_name,
      transaction_id: candidate.transaction_id,
      transaction_date: candidate.transaction_date,
      reporting_amount: candidate.reporting_amount,
      current_treatment: current.cash_flow_treatment,
      current_cash_flow_standard_detail: current.cash_flow_standard_detail,
      override_active: Boolean(override),
      account_override_active: context
        ? Boolean(context.has_account_cash_flow_override)
        : null,
      override_version: override ? (override.override_version ?? null) : null,
    };
  });
}
