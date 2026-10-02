import { assumptionsCommand } from "./assumptions";
/**
 * pl catalog account-classification list
 * pl catalog account-classification edit <classification-id>
 * pl catalog transaction-override candidates|list|set|void
 *
 * Classification discovery/edits and transaction-detail override authoring
 * require a broad pl_catalog_admin credential: operator role, catalog-write
 * access, full account clearance, unrestricted dimensions, and no row
 * filters.
 */

import { Command, InvalidArgumentError } from "commander";
import type {
  CashFlowCategory,
  CashFlowTreatment,
  TaxonomyMappingUpdate,
} from "shared";
import {
  CASH_FLOW_CATEGORY_NAMES,
  CASH_FLOW_TREATMENT_NAMES,
} from "../lib/vocabulary";
import { ApiClient } from "../lib/client";
import { formatCliError } from "../lib/cli-error";
import { LocalCliError } from "../lib/local-error";
import { formatOutput, type OutputFormat } from "../lib/output";
import { financeMetricsCommand } from "./finance-metrics";
import { transactionOverrideCommand } from "./transaction-override";
import { businessIdentityGovernanceCommand } from "./business-identity-governance";

export interface AccountClassificationRow {
  classification_id: string;
  override_id: string | null;
  connector_id: string | null;
  source_erp: string | null;
  account_id: string | null;
  account_number: string | null;
  account_name: string | null;
  account_type: string | null;
  account_sub_type: string | null;
  account_classification_scope: string | null;
  is_gl_posting_account: boolean | null;
  statement_type: string | null;
  taxonomy_level_1: string | null;
  taxonomy_level_2: string | null;
  taxonomy_level_3: string | null;
  taxonomy_level_4_catalog: string | null;
  taxonomy_level_5_catalog_subcategory: string | null;
  gaap_code: string | null;
  framework_account_number: string | null;
  source: string | null;
  has_controller_override: boolean | null;
  has_unapplied_override: boolean | null;
  override_reason: string | null;
  cash_flow_category: CashFlowCategory | null;
  cash_flow_treatment: CashFlowTreatment | null;
  cash_flow_standard_detail: string | null;
  cash_flow_classification_source: string | null;
  cash_flow_requires_review: boolean | null;
  adjusted_cash_flow_classification: boolean | null;
  cash_flow_override_reason: string | null;
  cash_flow_override_reset_at: string | null;
  cash_flow_override_reset_reason: string | null;
  cash_flow_override_reset_by: string | null;
  has_unapplied_cash_flow_override: boolean | null;
}

interface AccountClassificationListResponse {
  data: {
    account_classifications: AccountClassificationRow[];
    count: number;
    limit: number;
    offset: number;
  };
}

interface AccountClassificationGetResponse {
  data: {
    account_classification: AccountClassificationRow;
  };
}

interface AccountClassificationEditResponse {
  data: {
    resource: "account_classification";
    action: "edit";
    status: "updated" | "reverted";
    id: string;
    classification_id: string;
    override_id: string | null;
    has_controller_override: boolean;
    account_classification?: Record<string, unknown>;
  };
}

export interface EditOptions {
  taxonomyLevel1?: string;
  taxonomyLevel2?: string;
  taxonomyLevel3?: string;
  taxonomyLevel4Catalog?: string;
  taxonomyLevel5CatalogSubcategory?: string;
  gaapCode?: string;
  clearGaapCode?: boolean;
  cashFlowCategory?: CashFlowCategory;
  cashFlowTreatment?: CashFlowTreatment;
  cashFlowStandardDetail?: string;
  cashFlowReason?: string;
  clearCashFlowOverride?: boolean;
  reason: string;
  json?: boolean;
}

interface ListOptions {
  limit: number;
  offset: number;
  accountNameContains?: string;
  accountId?: string;
  sourceErp?: string;
  cashFlowCategory?: CashFlowCategory | "unclassified";
  cashFlowRequiresReview?: boolean;
  format: OutputFormat;
}

export const catalogCommand = new Command("catalog").description(
  "Catalog administration commands"
);

export const accountClassificationCommand = new Command(
  "account-classification"
).description("Discover and administer effective account classifications");

accountClassificationCommand
  .command("list")
  .description(
    "List stable classification IDs and effective cash-flow mappings (requires broad pl_catalog_admin authorization)"
  )
  .option(
    "-l, --limit <n>",
    "Maximum rows to return (1-500)",
    parseListLimit,
    200
  )
  .option(
    "-o, --offset <n>",
    "Pagination offset",
    parseListOffset,
    0
  )
  .option(
    "--account-name-contains <text>",
    "Filter to accounts whose name contains this text, matched literally and without regard to case"
  )
  .option(
    "--account-id <id>",
    "Filter to one exact ERP account id"
  )
  .option(
    "--source-erp <erp>",
    "Filter to one source ERP, for example quickbooks or netsuite"
  )
  .option(
    "--cash-flow-category <category>",
    "Filter by Statement section: operating, investing, financing, or unclassified",
    parseCashFlowListCategory
  )
  .option(
    "--cash-flow-requires-review <boolean>",
    "Filter by effective cash-flow review status",
    parseBoolean
  )
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table"
  )
  .action(async (opts: ListOptions) => {
    const client = new ApiClient();
    const result = await client.get<AccountClassificationListResponse>(
      buildAccountClassificationListPath(opts)
    );
    const rows = result.data.account_classifications;
    if (opts.format === "json") {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(
        formatOutput(accountClassificationDisplayRows(rows), opts.format)
      );
    }
    process.stderr.write(
      `\n--- ${rows.length} of ${result.data.count} classifications; offset ${result.data.offset} ---\n`
    );
  });

accountClassificationCommand
  .command("edit")
  .description(
    "Edit one classification's taxonomy, framework-number, or cash-flow override intent (requires pl_catalog_admin)"
  )
  .argument(
    "<classification-id>",
    "Stable classification_id returned by account-classification list"
  )
  .option(
    "--taxonomy-level-1 <value>",
    "Taxonomy Level 1, e.g. Assets"
  )
  .option(
    "--taxonomy-level-2 <value>",
    "Taxonomy Level 2, e.g. Current Assets"
  )
  .option(
    "--taxonomy-level-3 <value>",
    "Taxonomy Level 3, e.g. Accounts Receivable"
  )
  .option(
    "--taxonomy-level-4-catalog <value>",
    "Catalog Category, exposed as taxonomy_level_4_catalog"
  )
  .option(
    "--taxonomy-level-5-catalog-subcategory <value>",
    "Catalog Subcategory, exposed as taxonomy_level_5_catalog_subcategory"
  )
  .option(
    "--gaap-code <value>",
    "Optional framework # override. Omit to preserve existing framework override intent."
  )
  .option(
    "--clear-gaap-code",
    "Clear an existing framework # override while saving taxonomy intent.",
    false
  )
  .option(
    "--cash-flow-category <category>",
    `Statement section: ${CASH_FLOW_CATEGORY_NAMES.join(", ")}`,
    parseCashFlowCategory
  )
  .option(
    "--cash-flow-treatment <treatment>",
    `Calculation basis: ${CASH_FLOW_TREATMENT_NAMES.join(", ")}`,
    parseCashFlowTreatment
  )
  .option(
    "--cash-flow-standard-detail <key>",
    "Stable Standard cash-flow detail key, e.g. accounts_receivable"
  )
  .option(
    "--cash-flow-reason <text>",
    "Cash-flow mapping audit reason; defaults to --reason"
  )
  .option(
    "--clear-cash-flow-override",
    "Reset the account to its finance-catalog cash-flow classification while preserving other override intent.",
    false
  )
  .requiredOption(
    "--reason <text>",
    "Audit reason for the requested classification change"
  )
  .option("--json", "Print raw JSON response", false)
  .action(async (classificationId: string, opts: EditOptions) => {
    if (opts.gaapCode && opts.clearGaapCode) {
      throw new LocalCliError(
        "Use either --gaap-code or --clear-gaap-code, not both.",
        "E_CLI_INPUT",
      );
    }
    if (
      opts.clearCashFlowOverride &&
      (opts.cashFlowCategory !== undefined ||
        opts.cashFlowTreatment !== undefined ||
        opts.cashFlowStandardDetail !== undefined)
    ) {
      throw new LocalCliError(
        "Use --clear-cash-flow-override by itself; do not combine it with cash-flow mapping fields.",
        "E_CLI_INPUT",
      );
    }

    const client = new ApiClient();

    // The PATCH schema deliberately carries the complete taxonomy ladder.
    // Read first and merge omitted flags so a cash-flow-only edit cannot
    // erase existing taxonomy, Catalog Category/Subcategory, or framework
    // override intent.
    const before = await client.get<AccountClassificationGetResponse>(
      `/api/v1/catalog/account-classifications/${classificationId}`
    );
    const body = buildAccountClassificationEditBody(
      before.data.account_classification,
      opts
    );
    const result = await client.patch<AccountClassificationEditResponse>(
      `/api/v1/catalog/account-classifications/${classificationId}`,
      body
    );

    let effective = before.data.account_classification;
    let readbackWarning: string | null = null;
    try {
      const after = await client.get<AccountClassificationGetResponse>(
        `/api/v1/catalog/account-classifications/${classificationId}`
      );
      effective = after.data.account_classification;
    } catch (readbackErr) {
      readbackWarning = formatCliError(readbackErr, "table");
    }

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ...result,
            effective_account_classification: effective,
            ...(readbackWarning
              ? { effective_readback_warning: readbackWarning }
              : {}),
          },
          null,
          2
        )
      );
      return;
    }

    const data = result.data;
    console.log("Account classification updated.");
    console.log(`  Status:     ${data.status}`);
    console.log(`  ID:         ${data.classification_id}`);
    console.log(`  Override:   ${data.override_id ?? "none"}`);
    if (effective.account_name) {
      console.log(`  Account:    ${effective.account_name}`);
    }
    console.log(
      `  Taxonomy:   ${formatTaxonomyPath([
        effective.taxonomy_level_1,
        effective.taxonomy_level_2,
        effective.taxonomy_level_3,
        effective.taxonomy_level_4_catalog,
        effective.taxonomy_level_5_catalog_subcategory,
      ])}`
    );
    console.log(
      `  Cash flow:  ${formatCashFlowClassification(effective)}`
    );
    console.log(
      `  CF source:  ${effective.cash_flow_classification_source ?? "unclassified"}`
    );
    console.log(
      `  CF review:  ${effective.cash_flow_requires_review ? "required" : "not required"}`
    );
    if (readbackWarning) {
      process.stderr.write(
        `--- Edit saved, but effective-state readback failed: ${readbackWarning} ---\n`
      );
    }
  });

catalogCommand.addCommand(accountClassificationCommand);
catalogCommand.addCommand(financeMetricsCommand);
catalogCommand.addCommand(transactionOverrideCommand);
catalogCommand.addCommand(businessIdentityGovernanceCommand);

export function buildAccountClassificationListPath(
  opts: Pick<
    ListOptions,
    | "limit"
    | "offset"
    | "accountNameContains"
    | "accountId"
    | "sourceErp"
    | "cashFlowCategory"
    | "cashFlowRequiresReview"
  >
): string {
  const params = new URLSearchParams({
    limit: String(opts.limit),
    offset: String(opts.offset),
  });
  if (opts.accountNameContains?.trim()) {
    params.set("account_name_contains", opts.accountNameContains.trim());
  }
  if (opts.accountId?.trim()) {
    params.set("account_id", opts.accountId.trim());
  }
  if (opts.sourceErp?.trim()) {
    params.set("source_erp", opts.sourceErp.trim().toLowerCase());
  }
  if (opts.cashFlowCategory) {
    params.set("cash_flow_category", opts.cashFlowCategory);
  }
  if (opts.cashFlowRequiresReview !== undefined) {
    params.set(
      "cash_flow_requires_review",
      String(opts.cashFlowRequiresReview)
    );
  }
  return `/api/v1/catalog/account-classifications?${params.toString()}`;
}

export function accountClassificationDisplayRows(
  rows: AccountClassificationRow[]
): Record<string, unknown>[] {
  return rows.map((row) => ({
    classification_id: row.classification_id,
    override_id: row.override_id,
    source_erp: row.source_erp,
    account_number: row.account_number,
    account_name: row.account_name,
    cash_flow_category: row.cash_flow_category,
    cash_flow_treatment: row.cash_flow_treatment,
    cash_flow_standard_detail: row.cash_flow_standard_detail,
    cash_flow_source: row.cash_flow_classification_source,
    review_required: row.cash_flow_requires_review,
    override_active: row.adjusted_cash_flow_classification,
    override_pending: row.has_unapplied_cash_flow_override,
    override_reason: row.cash_flow_override_reason,
    reset_at: row.cash_flow_override_reset_at,
    reset_reason: row.cash_flow_override_reset_reason,
    reset_by: row.cash_flow_override_reset_by,
  }));
}

export function buildAccountClassificationEditBody(
  current: AccountClassificationRow,
  opts: EditOptions
): TaxonomyMappingUpdate {
  const reason = opts.reason.trim();
  if (!reason) {
    throw new LocalCliError("An audit reason is required.", "E_CLI_INPUT");
  }

  const taxonomyOrFrameworkChange =
    opts.taxonomyLevel1 !== undefined ||
    opts.taxonomyLevel2 !== undefined ||
    opts.taxonomyLevel3 !== undefined ||
    opts.taxonomyLevel4Catalog !== undefined ||
    opts.taxonomyLevel5CatalogSubcategory !== undefined ||
    opts.gaapCode !== undefined ||
    opts.clearGaapCode === true;
  const cashFlowChange =
    opts.cashFlowCategory !== undefined ||
    opts.cashFlowTreatment !== undefined ||
    opts.cashFlowStandardDetail !== undefined;

  if (
    !taxonomyOrFrameworkChange &&
    !cashFlowChange &&
    opts.clearCashFlowOverride !== true
  ) {
    throw new LocalCliError(
      "Provide at least one taxonomy, framework-number, cash-flow mapping, or cash-flow reset flag.",
      "E_CLI_INPUT",
    );
  }

  if (opts.gaapCode && opts.clearGaapCode) {
    throw new LocalCliError(
      "Use either --gaap-code or --clear-gaap-code, not both.",
      "E_CLI_INPUT",
    );
  }
  if (opts.clearCashFlowOverride && cashFlowChange) {
    throw new LocalCliError(
      "Use --clear-cash-flow-override by itself; do not combine it with cash-flow mapping fields.",
      "E_CLI_INPUT",
    );
  }

  const taxonomyLevel1 =
    opts.taxonomyLevel1?.trim() || current.taxonomy_level_1?.trim();
  if (!taxonomyLevel1) {
    throw new LocalCliError(
      "The effective classification has no taxonomy_level_1; set --taxonomy-level-1 before editing.",
      "E_CLI_INPUT",
    );
  }

  const body: Record<string, unknown> = {
    taxonomy_level_1: taxonomyLevel1,
    taxonomy_level_2: valueOrCurrent(
      opts.taxonomyLevel2,
      current.taxonomy_level_2
    ),
    taxonomy_level_3: valueOrCurrent(
      opts.taxonomyLevel3,
      current.taxonomy_level_3
    ),
    taxonomy_level_4_catalog: valueOrCurrent(
      opts.taxonomyLevel4Catalog,
      current.taxonomy_level_4_catalog
    ),
    taxonomy_level_5_catalog_subcategory: valueOrCurrent(
      opts.taxonomyLevel5CatalogSubcategory,
      current.taxonomy_level_5_catalog_subcategory
    ),
  };

  if (taxonomyOrFrameworkChange) {
    body.override_reason = reason;
  }
  if (opts.clearGaapCode) {
    body.gaap_code = null;
  } else if (opts.gaapCode !== undefined) {
    body.gaap_code = valueOrNull(opts.gaapCode);
  }

  if (opts.clearCashFlowOverride) {
    body.clear_cash_flow_override = true;
    body.cash_flow_override_reason =
      opts.cashFlowReason?.trim() || reason;
  } else if (cashFlowChange) {
    const treatment =
      opts.cashFlowTreatment ?? current.cash_flow_treatment ?? undefined;
    const category =
      opts.cashFlowTreatment &&
      CATEGORY_FREE_CASH_FLOW_TREATMENTS.has(opts.cashFlowTreatment)
        ? null
        : opts.cashFlowCategory !== undefined
          ? opts.cashFlowCategory
          : current.cash_flow_category;
    const standardDetail =
      opts.cashFlowTreatment === "unclassified" &&
      opts.cashFlowStandardDetail === undefined
        ? null
        : valueOrCurrent(
            opts.cashFlowStandardDetail,
            current.cash_flow_standard_detail
          );

    body.cash_flow_category = category;
    if (treatment !== undefined) {
      body.cash_flow_treatment = treatment;
    }
    body.cash_flow_standard_detail = standardDetail;
    body.cash_flow_override_reason =
      opts.cashFlowReason?.trim() || reason;
  }

  // The service validates the edit and returns field-level errors.
  return body as TaxonomyMappingUpdate;
}

const CATEGORY_FREE_CASH_FLOW_TREATMENTS = new Set<CashFlowTreatment>([
  "cash_and_cash_equivalents",
  "excluded",
  "unclassified",
]);

function valueOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function valueOrCurrent(
  provided: string | undefined,
  current: string | null
): string | null {
  return provided === undefined ? current : valueOrNull(provided);
}

function formatTaxonomyPath(values: unknown[]): string {
  const path = values
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .map((value) => value.trim());
  return path.length > 0 ? path.join(" > ") : "(none)";
}

function formatCashFlowClassification(
  row: AccountClassificationRow
): string {
  const parts = [
    row.cash_flow_category,
    row.cash_flow_treatment,
    row.cash_flow_standard_detail,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0
  );
  return parts.length > 0 ? parts.join(" > ") : "unclassified";
}

// Statement section and calculation basis are sent as typed. The service
// owns both vocabularies; the names in --help are documentation only.
function parseCashFlowCategory(value: string): CashFlowCategory {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new InvalidArgumentError(
      `Statement section is required, for example: ${CASH_FLOW_CATEGORY_NAMES.join(", ")}.`
    );
  }
  return trimmed as CashFlowCategory;
}

function parseCashFlowListCategory(
  value: string
): CashFlowCategory | "unclassified" {
  if (value === "unclassified") return value;
  return parseCashFlowCategory(value);
}

function parseCashFlowTreatment(value: string): CashFlowTreatment {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new InvalidArgumentError(
      `Calculation basis is required, for example: ${CASH_FLOW_TREATMENT_NAMES.join(", ")}.`
    );
  }
  return trimmed as CashFlowTreatment;
}

function parseListLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new InvalidArgumentError(
      "Limit must be an integer between 1 and 500."
    );
  }
  return parsed;
}

function parseListOffset(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError(
      "Offset must be a non-negative integer."
    );
  }
  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidArgumentError("Value must be true or false.");
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === "table" || value === "json" || value === "csv") {
    return value;
  }
  throw new InvalidArgumentError("Format must be table, json, or csv.");
}

catalogCommand.addCommand(assumptionsCommand);
