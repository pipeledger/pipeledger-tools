/**
 * pl unit-register metrics
 * pl unit-register periods [--posting-period YYYY-MM] [--json]
 * pl unit-register validate --file voucher.json [--json]
 * pl unit-register post   --file voucher.json [--validate-only]
 * pl unit-register get    (--voucher-id <id> | --source-ref <ref>)
 * pl unit-register update --file update.json
 * pl unit-register void   --voucher-id <id> [--reason <text>]
 *
 * Unit-register automation over the REST v1 surface:
 *   metrics [list] -> GET  /api/v1/unit-register/metrics  (requires pl_unit_register)
 *   metrics create/update/activate/archive -> POST /api/v1/unit-register/metrics{,/update,/activate,/archive}
 *                                             (SB306; same write grant as post/update/void)
 *   post    -> POST /api/v1/unit-register/vouchers        \
 *   get     -> GET  /api/v1/unit-register/vouchers         } all require
 *   update  -> POST /api/v1/unit-register/vouchers/update  } pl_post_unit_voucher
 *   void    -> POST /api/v1/unit-register/vouchers/void   /  + operator role
 *                                                            + allow_unit_posting
 *
 * Update and void are first-class credential operations; the only business
 * gate is the CFO's unit period lock, enforced by the Postgres RPCs
 * (PERIOD_LOCKED -> HTTP 409). Updating is optimistic-lock gated by an
 * OPAQUE `version` token: fetch the voucher with `get` first and copy its
 * `version` verbatim into the update file (STALE_VOUCHER 409 on any
 * divergence, with the current version in the response -- reload/copy and
 * retry, never blind-overwrite; never construct or modify the token).
 *
 * `get` is a SINGLE-voucher lookup by --voucher-id or --source-ref. A list
 * mode is intentionally absent from the public contract (deferred until a
 * designed pagination surface exists); browse the register in the product
 * UI.
 *
 * Voucher and metric files are validated by the service, which returns
 * field-level errors; the CLI checks only that a file is readable JSON. Use
 * `post --validate-only` to check a voucher without posting it.
 * source_ref is the retry-safe idempotency key for `post`:
 * replaying the exact same file returns the original voucher instead of
 * double-posting.
 *
 * SB313: entries may carry `<slot>_reference_id` (item, project, functional/
 * business/geographic segment), the exact UUID of a value from the org's
 * dimension reference; the server derives the id and label from it. A bare
 * id is still accepted when it resolves to exactly one value. The voucher
 * `legal_entity_source_key` must be an active known entity once the org's
 * entities are synced; single-entity orgs may omit it (defaulted), multi-
 * entity orgs must supply it on post.
 */

import { readFileSync } from "node:fs";
import { LocalCliError } from "../lib/local-error";
import { Command } from "commander";
import { ApiClient } from "../lib/client";
import {
  buildUnitVoucherGetQuery,
  parseUnitVoucherUpdatePayload,
  parseUnitVoucherVoidPayload,
} from "../lib/unit-register";

interface UnitMetric {
  metric_key: string;
  metric_label: string;
  metric_behavior: string | null;
  default_unit_of_measure: string | null;
  direct_entry_allowed?: boolean;
  status: string;
  allowed_movements: string[];
  /** SB306: effective presentation label per admitted movement. */
  movement_labels?: Record<string, string>;
}

interface MetricWriteResponse {
  status: string;
  metric_key: string;
  movement_labels?: Record<string, string>;
  catalog_effect?: string;
  publication_status?: string;
}

interface MetricsResponse {
  metrics: UnitMetric[];
}

interface ValidationReport {
  valid: boolean;
  violations: Array<{
    code: string;
    message: string;
    entry_index: number | null;
  }>;
  duplicate?: { status: string; existing_voucher_id: string | null };
}

interface VoucherPostResponse {
  status: "posted" | "validated";
  voucher_id?: string;
  source_ref: string;
  posting_period: string;
  voucher_type: string;
  entry_count: number;
  idempotency_status?: "created" | "replayed";
  publication_status: string;
  validation?: ValidationReport;
}

export const unitRegisterCommand = new Command("unit-register").description(
  "Unit register automation (requires pl_unit_register / pl_post_unit_voucher)"
);

/**
 * `pl unit-register metrics` is a group: `list` (the default, so the bare
 * command keeps listing), `create`, `update`, `activate`, `archive` (SB306).
 * The write subcommands need the separate unit metric management grant
 * (pl_post_unit_voucher + operator + allow_unit_metric_management, SB307;
 * posting alone does not cover them), backstopped by the
 * accountable human's owner/admin role in Postgres, and validate their JSON
 * file with the SAME shared schemas the REST routes use.
 */
const metricsCommand = new Command("metrics").description(
  "Atomic Unit Metric registry: list (default), create, update, activate, archive"
);
unitRegisterCommand.addCommand(metricsCommand);

function formatMovementLabels(metric: UnitMetric): string {
  const labels = metric.movement_labels ?? {};
  return metric.allowed_movements
    .map((movement) => {
      const label = labels[movement];
      return label && label.toLowerCase() !== movement.replace(/_/g, " ")
        ? `${movement}=${JSON.stringify(label)}`
        : movement;
    })
    .join(", ");
}

metricsCommand
  .command("list", { isDefault: true })
  .description(
    "List the org's active unit metrics, movement grammar, and movement names (requires pl_unit_register)"
  )
  .option("--json", "Output raw JSON", false)
  .action(async (opts: { json: boolean }) => {
    const client = new ApiClient();
    const data = await client.get<MetricsResponse>(
      "/api/v1/unit-register/metrics"
    );
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (data.metrics.length === 0) {
      console.log(
        "No active unit metrics. Create one with `pl unit-register metrics create -f metric.json` (requires the unit metric management grant) or on the Unit Register page."
      );
      return;
    }
    for (const metric of data.metrics) {
      console.log(
        `${metric.metric_key}  [${metric.metric_behavior ?? "unconfirmed"}]` +
          `  uom=${metric.default_unit_of_measure ?? "-"}` +
          (metric.direct_entry_allowed === undefined ? "" : `  direct_entry=${metric.direct_entry_allowed ? "yes" : "no"}`)
      );
      console.log(`  ${metric.metric_label}`);
      console.log(`  movements: ${formatMovementLabels(metric)}`);
    }
  });

interface UnitPeriodStatus {
  posting_period: string;
  locked: boolean;
  locked_at: string | null;
}

unitRegisterCommand.command("periods")
  .description("Inspect unit posting-period locks (requires posting access)")
  .option("--posting-period <YYYY-MM>", "Check one period; omit to list locked periods")
  .option("--json", "Output raw JSON", false)
  .action(async (opts: { postingPeriod?: string; json: boolean }) => {
    const query = new URLSearchParams({ action: "get_period_status" });
    if (opts.postingPeriod !== undefined) query.set("posting_period", opts.postingPeriod);
    const data = await new ApiClient().get<{
      period_status?: UnitPeriodStatus;
      locked_periods?: UnitPeriodStatus[];
    }>(`/api/v1/unit-register/metrics?${query}`);
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const periods = data.period_status ? [data.period_status] : data.locked_periods ?? [];
    if (periods.length === 0) {
      console.log("No unit posting periods are locked.");
      return;
    }
    for (const period of periods) {
      console.log(`${period.posting_period}  ${period.locked ? "LOCKED" : "open"}` +
        (period.locked_at ? `  locked at ${period.locked_at}` : ""));
    }
    console.log("Voucher validation still applies.");
  });

function readJsonFile(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new LocalCliError(
      `Could not read ${path} as JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalCliError(`${path} must contain one JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function printMetricWrite(data: MetricWriteResponse, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(`${data.status.replace(/_/g, " ")}: ${data.metric_key}`);
  if (data.movement_labels && Object.keys(data.movement_labels).length > 0) {
    console.log(
      `  movement names: ${Object.entries(data.movement_labels)
        .map(([movement, label]) => `${movement}=${JSON.stringify(label)}`)
        .join(", ")}`
    );
  }
  console.log(
    "  Live for posting now; label changes reach the published unit marts on the next successful transform."
  );
}

metricsCommand
  .command("create")
  .description(
    "Create a custom Atomic Unit Metric from a JSON file (requires pl_post_unit_voucher + operator role + allow_unit_metric_management)"
  )
  .requiredOption("-f, --file <path>", "Metric JSON file")
  .option("--json", "Output raw JSON", false)
  .addHelpText(
    "after",
    `
Metric file shape (validated by the service):
  {
    "metric_key": "projects_in_progress",
    "metric_label": "Projects in progress",
    "metric_behavior": "balance",            // balance | flow
    "activity_model": "lifecycle",           // balance only: lifecycle | transactions | hybrid
    "default_unit_of_measure": "project",
    "metric_category": "portfolio",          // optional
    "description": "Branded projects ...",   // optional
    "movement_labels": { "new": "Started", "churn": "Sold" }   // optional
  }
Omit movement_labels to let the organization's industry propose the names
(the response shows what was applied); pass {} to keep the global names.`
  )
  .action(async (opts: { file: string; json: boolean }) => {
    const client = new ApiClient();
    const data = await client.post<MetricWriteResponse>(
      "/api/v1/unit-register/metrics",
      readJsonFile(opts.file)
    );
    printMetricWrite(data, opts.json);
  });

metricsCommand
  .command("update")
  .description(
    "Change a metric's display name, description, category, or movement names from a JSON file (requires the unit metric management grant)"
  )
  .requiredOption("-f, --file <path>", "Update JSON file")
  .option("--json", "Output raw JSON", false)
  .addHelpText(
    "after",
    `
Update file shape: metric_key plus any of metric_label, metric_category,
description, movement_labels. movement_labels REPLACES the stored map;
{} restores the global movement names. Grammar (behavior, activity model,
unit) is not editable.
  { "metric_key": "projects_in_progress",
    "movement_labels": { "new": "Started", "churn": "Sold" } }`
  )
  .action(async (opts: { file: string; json: boolean }) => {
    const client = new ApiClient();
    const data = await client.post<MetricWriteResponse>(
      "/api/v1/unit-register/metrics/update",
      readJsonFile(opts.file)
    );
    printMetricWrite(data, opts.json);
  });

metricsCommand
  .command("activate")
  .description(
    "Activate a suggested ERP metric or reactivate an archived one from a JSON file (requires the unit metric management grant)"
  )
  .requiredOption("-f, --file <path>", "Activation JSON file")
  .option("--json", "Output raw JSON", false)
  .addHelpText(
    "after",
    `
Activation file shape: metric_key, metric_label, metric_behavior,
default_unit_of_measure, optional activity_model (balance only),
metric_category, allows_cumulative_balance, movement_labels.`
  )
  .action(async (opts: { file: string; json: boolean }) => {
    const client = new ApiClient();
    const data = await client.post<MetricWriteResponse>(
      "/api/v1/unit-register/metrics/activate",
      readJsonFile(opts.file)
    );
    printMetricWrite(data, opts.json);
  });

metricsCommand
  .command("archive")
  .description(
    "Archive a metric: new postings blocked at once, history kept (requires the unit metric management grant)"
  )
  .requiredOption("-k, --key <metric_key>", "Metric key to archive")
  .option("--json", "Output raw JSON", false)
  .action(async (opts: { key: string; json: boolean }) => {
    const client = new ApiClient();
    const data = await client.post<MetricWriteResponse>(
      "/api/v1/unit-register/metrics/archive",
      { metric_key: opts.key }
    );
    printMetricWrite(data, opts.json);
  });

async function validateVoucher(voucher: Record<string, unknown>, json = false) {
  const input = { ...voucher };
  delete input.validate_only;
  const result = await new ApiClient().post<{
    summary: string; validation: { valid: boolean; posting_eligibility: { allowed: boolean } };
  }>("/api/v1/unit-register/vouchers/validate", input);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(result.summary);
  if (!result.validation.valid) throw new LocalCliError("Voucher validation failed. Nothing was posted.");
}

unitRegisterCommand.command("validate")
  .description("Validate a proposed voucher with Unit Register read access; never posts")
  .requiredOption("-f, --file <path>", "Voucher JSON file")
  .option("--json", "Print the complete validation result")
  .action(async (opts: { file: string; json?: boolean }) => validateVoucher(readJsonFile(opts.file), opts.json));

unitRegisterCommand
  .command("post")
  .description(
    "Post a unit voucher from a JSON file (requires pl_post_unit_voucher + operator role)"
  )
  .requiredOption("-f, --file <path>", "Voucher JSON file")
  .option(
    "--validate-only",
    "Validate through the read-only Unit Register endpoint; no posting permission required.",
    false
  )
  .addHelpText(
    "after",
    `
Voucher file shape (validated by the service).
voucher_type is opening_balance, activity, or correction; source_ref is the
REQUIRED retry-safe idempotency key.
  {
    "voucher_date": "2026-06-30",
    "posting_period": "2026-06",
    "voucher_type": "activity",
    "source_ref": "usage-2026-06-1",
    "entries": [
      { "metric_key": "token_usage", "movement_type": "usage",
        "quantity_signed": 125000, "unit_of_measure": "token" }
    ]
  }
Corrections additionally need "corrects_voucher_id" or "correction_reason".
Retrying the exact same file is safe: the server replays the original voucher.
Entry dimension fields (item_id/item_name, functional/business/geographic
segment id+label, project_id/project_name) must reference REAL dimension ids
from the org's ERP-synced dimension reference once the org has one; unknown
values are rejected as DIMENSION_VALUE_UNKNOWN. Leave them out rather than
guessing.
`
  )
  .action(async (opts: { file: string; validateOnly: boolean }) => {
    let raw: string;
    try {
      raw = readFileSync(opts.file, "utf8");
    } catch {
      throw new LocalCliError(
        "Could not read the voucher file. Check the path and file permissions.",
        "E_CLI_FILE_READ",
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new LocalCliError(
        "The voucher file is not valid JSON.",
        "E_CLI_FILE_JSON",
      );
    }

    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new LocalCliError(
        "The voucher file must contain one JSON object.",
        "E_CLI_FILE_JSON",
      );
    }
    const voucher = json as Record<string, unknown>;
    if (opts.validateOnly || voucher.validate_only === true) {
      await validateVoucher(voucher);
      return;
    }

    const client = new ApiClient();
    const data = await client.post<VoucherPostResponse>(
      "/api/v1/unit-register/vouchers",
      {
        ...voucher,
        // The flag can only ever ADD validation mode; a file that says
        // validate_only: true must never be silently overridden into a post.
        // Any other value in the file is left for the service to reject.
        validate_only: opts.validateOnly ? true : voucher.validate_only,
      }
    );

    if (data.status === "validated") {
      const report = data.validation;
      if (report?.valid) {
        console.log("Validation passed. Nothing was posted (--validate-only).");
        if (report.duplicate?.status === "replay") {
          console.log(
            `Note: this exact payload was already posted as voucher ${report.duplicate.existing_voucher_id}; posting would replay it.`
          );
        }
      } else {
        const violations = (report?.violations ?? []).map((violation) => {
          const where =
            violation.entry_index === null
              ? "voucher"
              : `entries[${violation.entry_index}]`;
          return `[${violation.code}] ${where}: ${violation.message}`;
        });
        throw new LocalCliError(
          `Validation failed with ${violations.length} violation(s):\n${violations.join("\n")}`,
        );
      }
      return;
    }

    console.log(
      data.idempotency_status === "replayed"
        ? "Voucher replayed (this exact payload was already posted)."
        : "Voucher posted."
    );
    console.log(`  Voucher ID:  ${data.voucher_id}`);
    console.log(`  Source ref:  ${data.source_ref}`);
    console.log(`  Period:      ${data.posting_period}`);
    console.log(`  Type:        ${data.voucher_type}`);
    console.log(`  Entries:     ${data.entry_count}`);
    console.log(
      `  Publication: ${data.publication_status} (visible in unit marts after the next transform + publication)`
    );
  });

// ── get / update / void (first-class credential operations) ─────────────────

/** The explicit public DTO the v1 GET returns (voucher metadata stripped). */
interface VoucherGetResponse {
  voucher_id: string;
  /** OPAQUE optimistic-lock token; copy verbatim into update's `version`. */
  version: string;
  voucher_date: string;
  posting_period: string;
  voucher_type: string;
  source_ref: string;
  status: string;
  memo: string | null;
  legal_entity_source_key: string | null;
  corrects_voucher_id: string | null;
  voided_at: string | null;
  entries: Array<
    {
      metric_key: string;
      movement_type: string;
      quantity_signed: number | string;
      unit_of_measure: string;
    } & Record<string, unknown>
  >;
  entry_count: number;
}

interface VoucherUpdateResponse {
  status: string;
  voucher_id: string;
  source_ref: string;
  posting_period: string;
  voucher_type: string;
  entry_count: number;
  /** The NEW opaque basis for a follow-up edit. */
  version: string;
  publication_status: string;
}

interface VoucherVoidResponse {
  status: string;
  voucher_id: string;
  source_ref: string;
  posting_period: string;
  publication_status: string;
}

unitRegisterCommand
  .command("get")
  .description(
    "Load one voucher, the safe-update basis (requires pl_post_unit_voucher + operator role)"
  )
  .option("--voucher-id <id>", "Load one voucher by id (full entries + version)")
  .option("--source-ref <ref>", "Load one voucher by its source_ref")
  .option("--json", "Output raw JSON", false)
  .addHelpText(
    "after",
    `
Single-voucher lookup (exactly one of --voucher-id / --source-ref). Returns
the COMPLETE voucher: header (incl. memo and legal_entity_source_key), every
entry with full attribution, and the OPAQUE \`version\` token that
\`pl unit-register update\` requires. Copy version verbatim; never construct
or modify it. There is no list mode (deferred); browse the register in the
product UI.
`
  )
  .action(
    async (opts: { voucherId?: string; sourceRef?: string; json: boolean }) => {
      const built = buildUnitVoucherGetQuery(opts);
      if (!built.ok) {
        throw new LocalCliError(built.error);
      }

      const client = new ApiClient();
      const data = await client.get<VoucherGetResponse>(
        `/api/v1/unit-register/vouchers${built.query}`
      );
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`  Voucher ID:  ${data.voucher_id}`);
      console.log(`  Source ref:  ${data.source_ref}`);
      console.log(`  Date:        ${data.voucher_date}`);
      console.log(`  Period:      ${data.posting_period}`);
      console.log(`  Type:        ${data.voucher_type}`);
      console.log(`  Status:      ${data.status}`);
      if (data.memo) {
        console.log(`  Memo:        ${data.memo}`);
      }
      if (data.legal_entity_source_key) {
        console.log(`  Legal entity key: ${data.legal_entity_source_key}`);
      }
      if (data.voided_at) {
        console.log(`  Voided at:   ${data.voided_at}`);
      }
      console.log(
        `  Version:     ${data.version} (copy verbatim into the update file)`
      );
      console.log(`  Entries (${data.entry_count}):`);
      for (const entry of data.entries) {
        console.log(
          `    ${entry.metric_key}  ${entry.movement_type}  ` +
            `${entry.quantity_signed} ${entry.unit_of_measure}`
        );
      }
    }
  );

unitRegisterCommand
  .command("update")
  .description(
    "Update a posted voucher from a JSON file (requires pl_post_unit_voucher + operator role)"
  )
  .requiredOption("-f, --file <path>", "Voucher update JSON file")
  .addHelpText(
    "after",
    `
Update file shape (validated with the shared schema before any request).
Editing replaces the header + ALL entries; fetch the current state first:
  pl unit-register get --voucher-id <id>
and copy its \`version\` token VERBATIM into the file (REQUIRED -- the
server rejects an update without it and answers 409 STALE_VOUCHER with the
current version when it no longer matches; never construct or modify the
token).
  {
    "voucher_id": "<uuid>",
    "voucher_date": "2026-06-30",
    "posting_period": "2026-06",
    "voucher_type": "activity",
    "entries": [ ...complete replacement entry list... ],
    "version": "<copied verbatim from get>"
  }
memo is tri-state: OMIT the field to preserve the stored memo, set it to
null to clear it, or set a string to replace it.
source_ref, correction linkage, and client_metadata are NOT editable.
legal_entity_source_key: omit to PRESERVE the stored key; supply a key from
the org's entity list to change it. The CFO's unit period lock gates both
the voucher's current period and the new one (409 PERIOD_LOCKED).
`
  )
  .action(async (opts: { file: string }) => {
    let raw: string;
    try {
      raw = readFileSync(opts.file, "utf8");
    } catch {
      throw new LocalCliError(
        "Could not read the update file. Check the path and file permissions.",
        "E_CLI_FILE_READ",
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new LocalCliError(
        "The update file is not valid JSON.",
        "E_CLI_FILE_JSON",
      );
    }

    const parsed = parseUnitVoucherUpdatePayload(json);
    if (!parsed.ok) {
      throw new LocalCliError(
        `Update file failed validation:\n${parsed.issues.join("\n")}`,
      );
    }

    const client = new ApiClient();
    const data = await client.post<VoucherUpdateResponse>(
      "/api/v1/unit-register/vouchers/update",
      parsed.data
    );
    console.log("Voucher updated.");
    console.log(`  Voucher ID:  ${data.voucher_id}`);
    console.log(`  Source ref:  ${data.source_ref}`);
    console.log(`  Period:      ${data.posting_period}`);
    console.log(`  Type:        ${data.voucher_type}`);
    console.log(`  Entries:     ${data.entry_count}`);
    console.log(
      `  Version:     ${data.version} (the new basis for a follow-up edit)`
    );
    console.log(
      `  Publication: ${data.publication_status} (marts reflect the edit after the next transform + publication)`
    );
  });

unitRegisterCommand
  .command("void")
  .description(
    "Void (soft delete) a posted voucher (requires pl_post_unit_voucher + operator role)"
  )
  .requiredOption("--voucher-id <id>", "Voucher to void")
  .option("--reason <text>", "Why the voucher is being voided (<=500 chars, audited)")
  .addHelpText(
    "after",
    `
Voiding is a soft delete: entries and the audit trail are preserved, marts
exclude the voucher on the next transform, and its source_ref is released
for reuse. Voiding an already-voided voucher answers 409
VOUCHER_ALREADY_VOIDED (already done), and a locked posting period answers
409 PERIOD_LOCKED.
`
  )
  .action(async (opts: { voucherId: string; reason?: string }) => {
    const parsed = parseUnitVoucherVoidPayload(opts);
    if (!parsed.ok) {
      throw new LocalCliError(
        `Void request failed validation:\n${parsed.issues.join("\n")}`,
      );
    }

    const client = new ApiClient();
    const data = await client.post<VoucherVoidResponse>(
      "/api/v1/unit-register/vouchers/void",
      parsed.data
    );
    console.log("Voucher voided.");
    console.log(`  Voucher ID:  ${data.voucher_id}`);
    console.log(`  Source ref:  ${data.source_ref} (released for reuse)`);
    console.log(`  Period:      ${data.posting_period}`);
    console.log(
      `  Publication: ${data.publication_status} (marts exclude the voucher after the next transform + publication)`
    );
  });
