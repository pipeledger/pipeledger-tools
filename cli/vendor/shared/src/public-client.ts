/**
 * Public client surface.
 *
 * Everything exported here is compiled into `@pipeledger/cli`, which is
 * distributed on the public npm registry. Treat each export as published
 * source: anyone who installs the CLI can read it.
 *
 * Rules (see docs/cli-public-distribution.md):
 *
 *   - Export only what a client needs to talk to the service: configuration,
 *     credential echo protection, the customer problem contract, and wording
 *     that must not drift between surfaces.
 *   - Never export request schemas, registries, classification rules, mart
 *     column contracts, or anything that imports them. The service validates
 *     every request; the CLI renders the service's answer.
 *   - Adding a module here also means adding it to the bundle allowlist in
 *     apps/cli/scripts/verify-package.mjs. That check fails the build when an
 *     unlisted module reaches the published file.
 */
export {
  PIPELEDGER_APP_HOST,
  PIPELEDGER_APP_ORIGIN,
  canonicalPipeLedgerAppOrigin,
} from "./auth/app-origin.js";
export {
  CREDENTIAL_TOKEN_PREFIX,
  deriveCredentialPrefix,
} from "./auth/credential.js";
export { redactCredentials } from "./utils/secret-redaction.js";
export {
  CUSTOMER_PROBLEM_CATALOG,
  CUSTOMER_PROBLEM_SAFE_CONTEXT_KEYS,
  CustomerProblemSchema,
  type CustomerProblem,
  type CustomerProblemCode,
  type CustomerRecovery,
} from "./errors/customer-problem.js";
export {
  PipeLedgerCliConfigSchema,
  type PipeLedgerCliConfig,
} from "./schemas/cli-config.js";
export {
  CLI_PROFILE_NAME_PATTERN,
  cliProfileNameFromOrganization,
} from "./utils/cli-profile-name.js";
export { QUERY_TEXT_FILTER_MAX_LENGTH } from "./constants/query-filters.js";
export {
  TRANSACTION_OVERRIDE_DISCLOSURE,
  TRANSACTION_OVERRIDE_DOMAIN_VALUES,
  isTransactionOverrideDomain,
  type TransactionOverrideDomain,
} from "./constants/transaction-override-domains.js";
