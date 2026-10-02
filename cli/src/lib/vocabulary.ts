/**
 * Published names printed in `--help`, so a person or agent can form a valid
 * command without a round trip.
 *
 * These lists are documentation, never enforcement. The service validates
 * every request, and an installed CLI may be older than the service it talks
 * to: rejecting a name locally would refuse values the service accepts.
 *
 * They are literals on purpose. Importing them from `shared` would pull the
 * registries that own them into the published bundle. `vocabulary.test.ts`
 * fails when a list here differs from its owner.
 */

export const QUERYABLE_MART_NAMES = [
  "gl_lines",
  "cash_flow_components",
  "trial_balance",
  "project_financial_position",
  "project_overview",
  "project_overview_real_estate",
  "chart_of_accounts",
  "unit_movements",
  "unit_rollforward",
] as const;

export const MART_PACKAGE_NAMES = [
  "core",
  "projects",
  "units",
  "business_intelligence",
  "cash_flow",
  "entity_context",
] as const;

export const CASH_FLOW_CATEGORY_NAMES = [
  "operating",
  "investing",
  "financing",
] as const;

export const CASH_FLOW_TREATMENT_NAMES = [
  "cash_and_cash_equivalents",
  "working_capital_change",
  "non_cash_adjustment",
  "operating_cash_counterpart",
  "investing_cash_counterpart",
  "financing_cash_counterpart",
  "excluded",
  "unclassified",
] as const;

/**
 * Short names that are not the table name without its `mart_` prefix.
 *
 * Reports name their source by table (`mart_gl_trial_balance`), while the
 * service takes a short name (`trial_balance`) as a request parameter.
 * Stripping the prefix is right for every mart except the ones listed here.
 */
export const IRREGULAR_MART_SHORT_NAMES: Readonly<Record<string, string>> = {
  mart_gl_trial_balance: "trial_balance",
};

export function martShortNameForTable(tableName: string): string {
  return (
    IRREGULAR_MART_SHORT_NAMES[tableName] ?? tableName.replace(/^mart_/, "")
  );
}
