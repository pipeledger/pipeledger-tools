/**
 * pl run trigger <pipeline-id> [--stage <stage>] [--sync-mode <mode>]
 *   [--marts <ids>] [--mart-packages <ids>] [--force] [--auto-approve] [--wait]
 * pl run status <run-id>
 *
 * Pipeline management commands.
 * Non-zero exit code on failure for CI/CD integration.
 */

import { Command } from "commander";
import { MART_PACKAGE_NAMES } from "../lib/vocabulary";
import { ApiClient } from "../lib/client";
import { LocalCliError } from "../lib/local-error";
import { parseJsonOrTableFormat, type JsonOrTableFormat } from "../lib/output";

const STAGES = ["full", "extract", "transform"] as const;
const SYNC_MODES = [
  "incremental",
  "deep_90d",
  "deep_fiscal_year",
  "full_refresh",
] as const;
const SOURCE_TYPES = ["quickbooks", "netsuite"] as const;

interface RunStatus {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  record_count_out: number | null;
  triggered_by: string;
  triggered_stage?: "full" | "extract" | "transform" | null;
  failure: {
    code:
      | "PIPELINE_USAGE_LIMIT_REACHED"
      | "PIPELINE_LOCAL_BLOCKER"
      | "PIPELINE_SYSTEM_FAILURE"
      | "PIPELINE_RUN_FAILED";
    category:
      | "billing_action_required"
      | "organization_action_required"
      | "platform_failure"
      | "unclassified_failure";
    detail: string;
    recovery: string;
    reference: string;
  } | null;
  fcu_quantity?: number | null;
  fcu_settlement?: "charged" | "not_charged" | "pending" | "unavailable";
}

export const runCommand = new Command("run").description(
  "Pipeline run management (requires pl_run)",
);

for (const action of ["trigger", "preflight"] as const)
  runCommand
    .command(action)
    .description(
      action === "trigger"
        ? "Queue a pipeline run"
        : "Check a proposed run without queuing",
    )
    .argument("<pipeline-id>", "Pipeline config ID")
    .option(
      "-s, --stage <stage>",
      `Run stage: ${STAGES.join(", ")}. full = extract + transform; it is not full_refresh.`,
      "full",
    )
    .option(
      "-m, --sync-mode <mode>",
      "Extraction depth: incremental (QBO changed-since-last-sync; NetSuite posting-period scoped), deep_90d, deep_fiscal_year, full_refresh (highest cost)",
      "incremental",
    )
    .option(
      "--marts <ids>",
      "Comma-separated explicit mart table ids to build, e.g. mart_balance_sheet_lines",
    )
    .option(
      "--mart-packages <ids>",
      `Comma-separated data-product packages: ${MART_PACKAGE_NAMES.join(", ")}`,
    )
    .option(
      "--source-types <types>",
      `Comma-separated connector source types: ${SOURCE_TYPES.join(", ")}`,
    )
    .option(
      "--force",
      "Force rebuild of the selected transform scope even when inputs are unchanged",
      false,
    )
    .option(
      "--auto-approve",
      "Publish certified marts automatically when this credential is allowed to auto-approve",
      false,
    )
    .option(
      "--bounded",
      "Transform only: refuse queue merges exceeding the requested scope/force/auto-approval",
      false,
    )
    .option("--reason <text>", "Run justification (required for trigger)")
    .option("-w, --wait", "Wait for the run to complete", false)
    .option(
      "--format <fmt>",
      "Output format: table or json",
      parseJsonOrTableFormat,
      "table",
    )
    .addHelpText(
      "after",
      `
Cost discipline:
  --stage full runs extraction followed by transform; it does not imply --sync-mode full_refresh.
  Use --sync-mode incremental for normal QuickBooks month-end/current-month accounting refreshes.
  NetSuite does not have QBO-style DCD; scope it by the intended posting month/period window.
  Use deep_90d for suspected backdated edits in the last quarter, deep_fiscal_year for YTD close
  cleanup, and full_refresh only for initial loads, raw-data repair, connector/import defects,
  material reconciliation gaps, or explicit operator approval.
`,
    )
    .action(
      async (
        pipelineId: string,
        opts: {
          stage: string;
          syncMode: string;
          marts?: string;
          martPackages?: string;
          sourceTypes?: string;
          bounded: boolean;
          reason?: string;
          force: boolean;
          autoApprove: boolean;
          wait: boolean;
          format: JsonOrTableFormat;
        },
      ) => {
        if (action === "preflight" && opts.wait) {
          throw new LocalCliError(
            "--wait applies only to trigger.",
            "E_CLI_INPUT",
          );
        }
        if (!STAGES.includes(opts.stage as (typeof STAGES)[number])) {
          throw new LocalCliError(
            `Invalid stage "${opts.stage}". Valid: ${STAGES.join(", ")}`,
            "E_CLI_INPUT",
          );
        }
        if (
          !SYNC_MODES.includes(opts.syncMode as (typeof SYNC_MODES)[number])
        ) {
          throw new LocalCliError(
            `Invalid sync mode "${opts.syncMode}". Valid: ${SYNC_MODES.join(", ")}`,
            "E_CLI_INPUT",
          );
        }
        const martSelection = parseCsv(opts.marts);
        const martPackages = parseCsv(opts.martPackages);
        const sourceTypes = parseCsv(opts.sourceTypes);

        // Marts and packages are validated by the service, which owns the
        // catalog; an installed CLI may predate a mart the service accepts.
        validateAllowed("source type", sourceTypes, SOURCE_TYPES);

        const client = new ApiClient();

        const body: Record<string, unknown> = {
          stage: opts.stage,
          syncMode: opts.syncMode,
        };
        if (martSelection.length > 0) body.martSelection = martSelection;
        if (martPackages.length > 0) body.martPackages = martPackages;
        if (sourceTypes.length > 0) body.sourceTypes = sourceTypes;
        if (opts.force) body.force = true;
        if (opts.autoApprove) body.auto_approve = true;

        if (opts.bounded) body.bounded = true;
        if (opts.reason) body.reason = opts.reason;
        const result = await client.post<{
          run: RunStatus & {
            settings: {
              stage: string;
              sync_mode: string;
              marts: string[];
              force: boolean;
              auto_approve: boolean;
            };
          };
          reused?: boolean;
        }>(`/api/v1/pipelines/${pipelineId}/${action}`, body);
        if (action === "preflight") {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const data = result.run;

        if (opts.format === "table") {
          console.log(
            result.reused
              ? "Request joined an existing run."
              : "Pipeline run queued.",
          );
          console.log(`  Run ID: ${data.id}`);
          console.log(`  Status: ${data.status}`);
          console.log(`  Stage: ${data.settings.stage}`);
          console.log(`  Sync mode: ${data.settings.sync_mode}`);
          console.log(`  Marts: ${data.settings.marts.join(", ")}`);
          console.log(`  Force: ${data.settings.force}`);
          console.log(
            `  Automatic publication on success: ${data.settings.auto_approve}`,
          );
        }

        if (opts.wait) {
          process.stderr.write("Waiting for completion");
          const finalStatus = await pollStatus(client, data.id, opts.stage);
          process.stderr.write("\n");
          if (opts.format === "json") {
            console.log(
              JSON.stringify({ trigger: data, run: finalStatus }, null, 2),
            );
          } else {
            printRunStatus(finalStatus);
          }

          // A cancelled terminal run is not a successful CI outcome.
          if (
            terminalRunExitCode(
              finalStatus.status,
              finalStatus.triggered_stage ?? opts.stage,
            ) === 1
          ) {
            process.exitCode = 1;
          }
        } else if (opts.format === "json") {
          console.log(JSON.stringify(result, null, 2));
        }
      },
    );

runCommand
  .command("list")
  .description("List pipelines, enabled marts, and recent/in-flight runs")
  .option("--limit <number>", "Maximum per inventory section", "20")
  .action(async (opts: { limit: string }) => {
    const result = await new ApiClient().get(
      `/api/v1/pipelines?limit=${encodeURIComponent(opts.limit)}`,
    );
    console.log(JSON.stringify(result, null, 2));
  });

runCommand
  .command("status")
  .description("Check pipeline run status (requires pl_run)")
  .argument("<run-id>", "Pipeline run ID")
  .option(
    "--format <fmt>",
    "Output format: table or json",
    parseJsonOrTableFormat,
    "table",
  )
  .action(async (runId: string, opts: { format: JsonOrTableFormat }) => {
    const client = new ApiClient();

    const result = await client.get<{
      run: RunStatus;
      fcu_quantity?: number | null;
      fcu_settlement?: RunStatus["fcu_settlement"];
    }>(`/api/v1/pipelines/runs/${runId}`);
    const data = checkedRunStatus(result);
    if (opts.format === "json") {
      console.log(JSON.stringify(data, null, 2));
    } else {
      printRunStatus(data);
    }

    // Non-zero for any unsuccessful terminal result; in-progress status
    // checks remain successful API calls.
    if (terminalRunExitCode(data.status, data.triggered_stage) === 1) {
      process.exitCode = 1;
    }
  });

export function checkedRunStatus(result: {
  run?: RunStatus;
  fcu_quantity?: number | null;
  fcu_settlement?: RunStatus["fcu_settlement"];
}): RunStatus {
  if (
    !result.run ||
    typeof result.run.status !== "string" ||
    !result.run.status
  ) {
    throw new LocalCliError(
      "The server returned an unsupported pipeline status response. Check the CLI/server release versions before retrying; do not trigger another run.",
      "E_CLI_INPUT",
    );
  }
  return {
    ...result.run,
    fcu_quantity: result.fcu_quantity,
    fcu_settlement: result.fcu_settlement,
  };
}

function parseCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function validateAllowed(
  label: string,
  values: string[],
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const invalid = values.filter((value) => !allowedSet.has(value));
  if (invalid.length > 0) {
    throw new LocalCliError(
      `Invalid ${label}${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}. ` +
        `Valid: ${allowed.join(", ")}`,
      "E_CLI_INPUT",
    );
  }
}

export function terminalRunExitCode(
  status: string,
  stage?: string | null,
): 0 | 1 | null {
  if (status === "succeeded") return 0;
  if (status === "extracted" && stage === "extract") return 0;
  if (status === "failed" || status === "cancelled") return 1;
  return null;
}

function printRunStatus(run: RunStatus): void {
  console.log(`  Run ID:     ${run.id}`);
  console.log(`  Status:     ${run.status}`);
  console.log(`  Started:    ${run.started_at}`);
  if (run.completed_at) {
    console.log(`  Completed:  ${run.completed_at}`);
  }
  if (run.record_count_out !== null) {
    console.log(`  Rows out:   ${run.record_count_out}`);
  }
  if (run.fcu_settlement === "charged" && run.fcu_quantity != null) {
    console.log(`  FCU charged: ${run.fcu_quantity.toFixed(2)}`);
  } else if (run.fcu_settlement === "not_charged") {
    console.log(`  FCU charged: 0.00`);
  }
  if (run.failure) {
    console.log(`  Failure:    ${run.failure.detail}`);
    console.log(`  Next step:  ${run.failure.recovery}`);
    console.log(`  Reference:  ${run.failure.reference}`);
  }
}

export async function pollStatus(
  client: Pick<ApiClient, "get">,
  runId: string,
  requestedStage?: string,
  intervalMs = 3000,
  maxAttempts = 200,
): Promise<RunStatus> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await client.get<{
      run: RunStatus;
      fcu_quantity?: number | null;
      fcu_settlement?: RunStatus["fcu_settlement"];
    }>(`/api/v1/pipelines/runs/${runId}`);
    const data = checkedRunStatus(result);

    if (
      terminalRunExitCode(
        data.status,
        data.triggered_stage ?? requestedStage,
      ) !== null
    ) {
      return data;
    }

    // Print progress dot to stderr
    process.stderr.write(".");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new LocalCliError(
    `Timed out waiting for pipeline run ${runId}. The run may still be in progress. ` +
      `Check it with \`pl run status ${runId}\` before triggering another run.`,
    "E_CLI_TIMEOUT",
  );
}
