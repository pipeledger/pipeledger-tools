/**
 * Transaction-detail override domains.
 *
 * A transaction override domain is one governed kind of per-GL-line
 * classification exception, authored through the generic
 * `resource='transaction_override'` surface on `pl_catalog_admin`, the
 * `/api/v1/catalog/transaction-overrides` REST routes, and
 * `pl catalog transaction-override`. Adding a domain is one adapter file in
 * `packages/transaction-override-governance` plus one value here; no tool,
 * action, route, or command renames.
 *
 * `cash_flow_classification` overrides the cash-flow
 * Statement section/Calculation basis/Standard cash-flow detail of ONE posted Balance Sheet counterpart GL
 * line (SB150 `cash_flow_transaction_overrides`).
 */
export const TRANSACTION_OVERRIDE_DOMAIN_VALUES = [
  "cash_flow_classification",
] as const;

export type TransactionOverrideDomain =
  (typeof TRANSACTION_OVERRIDE_DOMAIN_VALUES)[number];

export function isTransactionOverrideDomain(
  value: string,
): value is TransactionOverrideDomain {
  return (TRANSACTION_OVERRIDE_DOMAIN_VALUES as readonly string[]).includes(
    value,
  );
}

/**
 * Mandatory publication disclosure for every surface's success response that
 * reports transaction-override state (MCP, REST, CLI, web). Single source of
 * truth: surfaces import this constant, never restate it, so the wording
 * cannot drift. Omitting it lets an agent report a corrected statement that
 * does not exist yet.
 *
 * Defined here, not in `transaction-override-governance`, so the public CLI
 * can carry the wording without bundling the server-side governance service.
 * That package re-exports it for every server surface.
 */
export const TRANSACTION_OVERRIDE_DISCLOSURE =
  "The Data Review catalog reflects this immediately. Published Cash Flow marts and any statement built from them change only after the next successful transform and publication.";
