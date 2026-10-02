/**
 * pl catalog transaction-override candidates --verification-item-id <id> [--domain <d>]
 * pl catalog transaction-override list       [--domain <d>] [--transaction-id <id>] [--account-id <id>]
 * pl catalog transaction-override set        --file <path> --confirm [--domain <d>]
 * pl catalog transaction-override void       --file <path> --confirm [--domain <d>]
 *
 * Transaction-detail override authoring over the REST v1 surface:
 *   candidates -> GET  /api/v1/catalog/transaction-overrides/candidates
 *   list       -> GET  /api/v1/catalog/transaction-overrides
 *   set        -> POST /api/v1/catalog/transaction-overrides
 *   void       -> POST /api/v1/catalog/transaction-overrides/void
 *
 * All four require a broad pl_catalog_admin credential: operator role,
 * catalog-write access, full Highly Restricted account clearance,
 * unrestricted dimensions, and no row filters.
 *
 * `--domain` defaults to cash_flow_classification and is always echoed in
 * the output so the generic framing stays visible. Workflow: run
 * `candidates` for a verification item, copy one candidate's `payload`
 * template into a file, edit ONLY the classification fields plus the
 * required 10-500 character override_reason, then `set --file ... --confirm`.
 * `void` uses a `void_payload` template: from `candidates` while the
 * originating review item is still published, or from
 * `list --format json` at ANY point in the override's lifetime (each listed
 * override carries a template keyed on its id + stored evidence
 * fingerprint, so voiding stays possible after the review item resolves).
 * Both mutating subcommands refuse without --confirm (printing the payload
 * plus the publication disclosure and exiting non-zero) and never touch
 * amounts: an override records a controller decision about presentation
 * category only. The service validates the payload on submission and
 * returns field-level errors.
 */

import { readFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import {
  TRANSACTION_OVERRIDE_DISCLOSURE as DISCLOSURE,
  type TransactionOverrideDomain,
} from "shared/src/public-client";
import { ApiClient } from "../lib/client";
import { LocalCliError } from "../lib/local-error";
import { formatOutput, type OutputFormat } from "../lib/output";
import {
  buildTransactionOverrideCandidatesPath,
  buildTransactionOverrideListPath,
  DEFAULT_TRANSACTION_OVERRIDE_DOMAIN,
  parseTransactionOverrideDomain,
  parseTransactionOverridePayload,
  selectTransactionOverrideCandidate,
  transactionOverrideCandidateDisplayRows,
  transactionOverrideDisplayRows,
  type TransactionOverrideCandidateSelectors,
} from "../lib/transaction-override";

interface CandidatesResponse {
  data: {
    domain: string;
    authoring_basis: "review_item" | "transaction_lookup";
    verification_item_id: string | null;
    lookup: Record<string, string | null> | null;
    candidates: Array<Record<string, unknown>>;
    count: number;
    truncated: boolean;
  };
}

interface LookupOptions {
  verificationItemId?: string;
  transactionId?: string;
  glLineId?: string;
  lineIdentity?: string;
  sourceErp?: string;
  connectorId?: string;
  transactionType?: string;
}

function selectorsFromOptions(
  opts: LookupOptions
): TransactionOverrideCandidateSelectors {
  return {
    verificationItemId: opts.verificationItemId ?? null,
    transaction_id: opts.transactionId ?? null,
    gl_line_id: opts.glLineId ?? null,
    cash_flow_line_identity: opts.lineIdentity ?? null,
    source_erp: opts.sourceErp ?? null,
    connector_id: opts.connectorId ?? null,
    transaction_type: opts.transactionType ?? null,
  };
}

function addLookupOptions(command: Command): Command {
  return command
    .option(
      "--verification-item-id <id>",
      "Review-finding basis: 32-hex verification item id from the published Data Review verification items"
    )
    .option(
      "--transaction-id <id>",
      "Transaction basis: ERP transaction id copied from a BI GL movement row (a search key; several lines can share it)"
    )
    .option("--gl-line-id <id>", "Transaction basis: exact PipeLedger GL line id")
    .option(
      "--line-identity <hex>",
      "Transaction basis: 64-hex canonical cash_flow_line_identity of the exact line"
    )
    .option("--source-erp <erp>", "Narrow a transaction lookup to one ERP family")
    .option("--connector-id <uuid>", "Narrow a transaction lookup to one connector")
    .option(
      "--transaction-type <type>",
      "Narrow to one ERP-native transaction type (dates, amounts, and accounts are `pl query` filters: find the line there and pass --gl-line-id)"
    );
}

async function fetchCandidates(
  client: ApiClient,
  domain: TransactionOverrideDomain,
  selectors: TransactionOverrideCandidateSelectors
): Promise<CandidatesResponse["data"]> {
  const built = buildTransactionOverrideCandidatesPath({ domain, selectors });
  if (!built.ok) {
    throw new LocalCliError(built.error, "E_CLI_INPUT");
  }
  const result = await client.get<CandidatesResponse>(built.path);
  return result.data;
}

interface ListResponse {
  data: {
    domain: string;
    transaction_overrides: Array<Record<string, unknown>>;
    count: number;
    limit: number;
    offset: number;
  };
}

interface WriteResponse {
  domain: string;
  status: string;
  override_id: string;
  result: Record<string, unknown>;
  applies_on: string;
  publication_status: string;
  accountable_user_source?: string;
}

function parseDomainOption(value: string): TransactionOverrideDomain {
  const parsed = parseTransactionOverrideDomain(value);
  if (typeof parsed !== "string") {
    throw new InvalidArgumentError(parsed.error);
  }
  return parsed;
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === "table" || value === "json" || value === "csv") {
    return value;
  }
  throw new InvalidArgumentError("Format must be table, json, or csv.");
}

function readJsonFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new LocalCliError(
      "Could not read the payload file. Check the path and file permissions.",
      "E_CLI_FILE_READ",
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new LocalCliError(
      "The payload file is not valid JSON.",
      "E_CLI_FILE_JSON",
    );
  }
}

/** Rendered centrally by the CLI entry point; exits non-zero without a network call. */
function refuseWithoutConfirm(
  action: "set" | "void",
  domain: string,
  payload: Record<string, unknown>
): never {
  const payloadBlock = JSON.stringify(payload, null, 2)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  throw new LocalCliError(
    [
      `Refusing to ${action === "set" ? "save" : "remove"} a transaction override without --confirm.`,
      `  Domain: ${domain}`,
      "  Payload:",
      payloadBlock,
      `  ${DISCLOSURE}`,
      "Re-run with --confirm to submit exactly this payload.",
    ].join("\n"),
    "E_CLI_INPUT",
  );
}

export const transactionOverrideCommand = new Command(
  "transaction-override"
).description(
  "Author transaction-detail overrides such as exact GL-line cash-flow reclassification (requires broad pl_catalog_admin authorization)"
);

addLookupOptions(
  transactionOverrideCommand
    .command("candidates")
    .description(
      "List override-eligible GL lines with ready-to-submit payload templates, from a review finding (--verification-item-id) or from a transaction reference copied from BI (--transaction-id / --gl-line-id / --line-identity)"
    )
)
  .option(
    "--domain <domain>",
    "Transaction-override domain",
    parseDomainOption,
    DEFAULT_TRANSACTION_OVERRIDE_DOMAIN
  )
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table"
  )
  .action(
    async (
      opts: LookupOptions & {
        domain: TransactionOverrideDomain;
        format: OutputFormat;
      }
    ) => {
      const client = new ApiClient();
      const data = await fetchCandidates(
        client,
        opts.domain,
        selectorsFromOptions(opts)
      );
      if (opts.format === "json") {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(
          formatOutput(
            transactionOverrideCandidateDisplayRows(data.candidates),
            opts.format
          )
        );
      }
      const scope =
        data.authoring_basis === "review_item"
          ? `item ${data.verification_item_id}`
          : `lookup ${JSON.stringify(
              Object.fromEntries(
                Object.entries(data.lookup ?? {}).filter(
                  ([, value]) => value !== null
                )
              )
            )}`;
      process.stderr.write(
        `\n--- domain ${data.domain}; ${data.count} candidate line(s) for ${scope}${data.truncated ? " (TRUNCATED: narrow the lookup before choosing)" : ""} ---\n` +
          "--- Copy a candidate's payload template (see --format json) into a file, edit the classification fields plus override_reason, then run `set --file <path> --confirm`; or run `set` with the lookup flags, --line-identity, --cash-flow-treatment and --reason. Each template carries expected_override_version; a stale one is refused. ---\n" +
          (data.authoring_basis === "transaction_lookup" && data.count > 1
            ? "--- Several lines share this reference: choose the exact line by --line-identity; the first match is never chosen for you. Check account_context first: a dedicated account with a wrong default wants an account override, not a line override. ---\n"
            : "")
      );
    }
  );

transactionOverrideCommand
  .command("list")
  .description("List existing transaction-detail overrides with audit notes")
  .option(
    "--domain <domain>",
    "Transaction-override domain",
    parseDomainOption,
    DEFAULT_TRANSACTION_OVERRIDE_DOMAIN
  )
  .option("--transaction-id <id>", "Filter to one source transaction id")
  .option("--account-id <id>", "Filter to one source account id")
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table"
  )
  .action(
    async (opts: {
      domain: TransactionOverrideDomain;
      transactionId?: string;
      accountId?: string;
      format: OutputFormat;
    }) => {
      const client = new ApiClient();
      const result = await client.get<ListResponse>(
        buildTransactionOverrideListPath(opts)
      );
      const rows = result.data.transaction_overrides;
      if (opts.format === "json") {
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.log(
          formatOutput(transactionOverrideDisplayRows(rows), opts.format)
        );
      }
      process.stderr.write(
        `\n--- domain ${result.data.domain}; ${rows.length} of ${result.data.count} overrides; offset ${result.data.offset} ---\n` +
          "--- Each row in --format json carries a ready void_payload (override id + stored evidence fingerprint), valid for the override's whole lifetime. ---\n" +
          `--- ${DISCLOSURE} ---\n`
      );
    }
  );

addLookupOptions(
  transactionOverrideCommand
    .command("set")
    .description(
      "Save one transaction override: from a payload file (--file, start from a `candidates` template) OR from a transaction reference plus --line-identity, --cash-flow-treatment and --reason (requires --confirm)"
    )
)
  .option(
    "-f, --file <path>",
    "Payload JSON file (start from a `candidates` template)"
  )
  .option(
    "--cash-flow-treatment <treatment>",
    "Lookup path: working_capital_change | investing_cash_counterpart | financing_cash_counterpart"
  )
  .option(
    "--cash-flow-standard-detail <key>",
    "Lookup path: governed standard detail compatible with the treatment"
  )
  .option("--reason <text>", "Lookup path: 10-500 character controller rationale")
  .option(
    "--domain <domain>",
    "Transaction-override domain",
    parseDomainOption,
    DEFAULT_TRANSACTION_OVERRIDE_DOMAIN
  )
  .option("--confirm", "Actually submit the override", false)
  .action(
    async (
      opts: LookupOptions & {
        file?: string;
        cashFlowTreatment?: string;
        cashFlowStandardDetail?: string;
        reason?: string;
        domain: TransactionOverrideDomain;
        confirm: boolean;
      }
    ) => {
      let json: unknown;
      if (opts.file) {
        json = readJsonFile(opts.file);
      } else {
        if (!opts.cashFlowTreatment || !opts.reason) {
          throw new LocalCliError(
            "Without --file, `set` needs a transaction lookup (--transaction-id, --gl-line-id, or --line-identity), --cash-flow-treatment, and --reason.",
            "E_CLI_INPUT"
          );
        }
        const client = new ApiClient();
        const data = await fetchCandidates(
          client,
          opts.domain,
          selectorsFromOptions({ ...opts, verificationItemId: undefined })
        );
        const selected = selectTransactionOverrideCandidate({
          candidates: data.candidates,
          truncated: data.truncated,
          lineIdentity: opts.lineIdentity ?? null,
        });
        if (!selected.ok) {
          throw new LocalCliError(selected.error, "E_CLI_INPUT");
        }
        const template = (selected.candidate.payload ?? {}) as Record<
          string,
          unknown
        >;
        json = {
          ...template,
          cash_flow_treatment: opts.cashFlowTreatment,
          cash_flow_standard_detail: opts.cashFlowStandardDetail ?? null,
          override_reason: opts.reason,
        };
        process.stderr.write(
          `--- Selected line ${String(selected.candidate.cash_flow_line_identity)}: ${String(selected.candidate.account_name ?? "")} ${String(selected.candidate.transaction_date ?? "")} ${String(selected.candidate.reporting_amount ?? "")} ${String(selected.candidate.reporting_currency ?? "")} ---\n`
        );
      }
      const parsed = parseTransactionOverridePayload({
        domain: opts.domain,
        kind: "edit",
        json,
      });
      if (!parsed.ok) {
        throw new LocalCliError(
          `Payload could not be submitted:\n${parsed.issues.join("\n")}`,
          "E_CLI_INPUT",
        );
      }
      if (!opts.confirm) {
        refuseWithoutConfirm("set", parsed.domain, parsed.payload);
      }

      const client = new ApiClient();
      const data = await client.post<WriteResponse>(
        "/api/v1/catalog/transaction-overrides",
        { domain: parsed.domain, payload: parsed.payload }
      );
      console.log(
        data.status === "unchanged"
          ? "Transaction override already identical (audited resend; nothing changed)."
          : "Transaction override saved."
      );
      console.log(`  Domain:      ${data.domain}`);
      console.log(`  Override ID: ${data.override_id}`);
      console.log(`  Status:      ${data.status}`);
      console.log(
        `  Publication: ${data.publication_status} (${DISCLOSURE})`
      );
    }
  );

transactionOverrideCommand
  .command("void")
  .description(
    "Remove one existing transaction override from a void-payload file (requires --confirm)"
  )
  .requiredOption(
    "-f, --file <path>",
    "Void payload JSON file (start from a void_payload template: `candidates` while the review item is live, or `list --format json` any time after)"
  )
  .option(
    "--domain <domain>",
    "Transaction-override domain",
    parseDomainOption,
    DEFAULT_TRANSACTION_OVERRIDE_DOMAIN
  )
  .option("--confirm", "Actually remove the override", false)
  .action(
    async (opts: {
      file: string;
      domain: TransactionOverrideDomain;
      confirm: boolean;
    }) => {
      const parsed = parseTransactionOverridePayload({
        domain: opts.domain,
        kind: "void",
        json: readJsonFile(opts.file),
      });
      if (!parsed.ok) {
        throw new LocalCliError(
          `Void payload could not be submitted:\n${parsed.issues.join("\n")}`,
          "E_CLI_INPUT",
        );
      }
      if (!opts.confirm) {
        refuseWithoutConfirm("void", parsed.domain, parsed.payload);
      }

      const client = new ApiClient();
      const data = await client.post<WriteResponse>(
        "/api/v1/catalog/transaction-overrides/void",
        { domain: parsed.domain, payload: parsed.payload }
      );
      console.log("Transaction override removed.");
      console.log(`  Domain:      ${data.domain}`);
      console.log(`  Override ID: ${data.override_id}`);
      console.log(
        `  Publication: ${data.publication_status} (${DISCLOSURE})`
      );
    }
  );
