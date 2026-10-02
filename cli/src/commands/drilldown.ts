/**
 * pl drilldown <handle> --grain <grain> [--group-by COLUMN] [--limit N]
 *
 * Redeem a drilldown handle for the governed evidence behind a reported
 * number: the supporting rows, or the same handle-bound population aggregated
 * by one authorized dimension.
 *
 * Thin client over POST /api/v1/drilldown, the same capability service the MCP
 * `pl_drilldown` tool calls. Handles are surface-neutral, so a handle copied
 * from an MCP session or a REST report redeems here unchanged -- what the
 * terminal may SEE is decided by this credential's current authorization, not
 * by the credential that issued the handle.
 */

import { Command, InvalidArgumentError } from "commander";
import type { DrilldownTargetGrain } from "capabilities";
import { ApiClient } from "../lib/client";
import {
  formatOutput,
  parseOutputFormat,
  type OutputFormat,
} from "../lib/output";

// Pinned against the shared union type-only: a grain added to the capability
// fails this file at compile time, and nothing from the package reaches the
// CLI bundle.
const TARGET_GRAINS = [
  "account_balance",
  "period_activity",
  "transaction_line",
] as const satisfies readonly DrilldownTargetGrain[];

type TargetGrain = (typeof TARGET_GRAINS)[number];

interface Reconciliation {
  status: string;
  basis: string;
  reported_value?: number;
  supporting_value?: number;
  difference?: number;
  message: string;
}

interface BalanceRollforward {
  status: string;
  opening_trial_balance?: number;
  source_gl_activity?: number;
  modeled_non_source_adjustment?: number;
  ending_trial_balance?: number;
  difference?: number;
  message: string;
}

interface ComponentHandle {
  metric_id: string;
  relationship: string;
  supported_target_grains: string[];
  drilldown_handle: string;
}

interface DrilldownResponse {
  handle_label: string;
  metric_id: string;
  target_grain: string;
  catalog_snapshot_verified: boolean;
  newer_catalog_version_available: boolean;
  staleness: { stale: boolean };
  result:
    | {
        mode: "rows";
        returned_grain: string;
        supporting_detail_complete: boolean;
        row_mart: string;
        rows: Array<Record<string, unknown>>;
        returned_row_count: number;
        truncated: boolean;
        balance_rollforward?: BalanceRollforward;
        reconciliation: Reconciliation;
      }
    | {
        mode: "dimension_aggregate";
        group_by: string[];
        groups: Array<{
          group: Record<string, unknown>;
          supporting_value: number;
        }>;
        returned_group_count: number;
        authorized_group_count: number;
        truncated: boolean;
        reconciliation: Reconciliation;
      }
    | {
        mode: "derived_expansion" | "ratio_components";
        component_handles: ComponentHandle[];
        guidance: string;
      };
}

function parseGrain(value: string): TargetGrain {
  if ((TARGET_GRAINS as readonly string[]).includes(value)) {
    return value as TargetGrain;
  }
  throw new InvalidArgumentError(
    `Unknown --grain "${value}". Use one of: ${TARGET_GRAINS.join(", ")}. Each issued handle advertises the grains it supports.`
  );
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new InvalidArgumentError(
      `--limit must be a whole number from 1 to 1000, got "${value}".`
    );
  }
  return parsed;
}

export const drilldownCommand = new Command("drilldown")
  .description("Show the governed evidence behind a reported number")
  .argument("<handle>", "The opaque drilldown handle, exactly as issued")
  .requiredOption(
    "-g, --grain <grain>",
    `Evidence grain: ${TARGET_GRAINS.join(", ")}`,
    parseGrain
  )
  .option(
    "-b, --group-by <column>",
    "Aggregate the same population by one groupable column instead of returning rows"
  )
  .option("-l, --limit <n>", "Maximum rows or groups to return", parseLimit, 100)
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table"
  )
  .action(
    async (
      handle: string,
      opts: {
        grain: TargetGrain;
        groupBy?: string;
        limit: number;
        format: OutputFormat;
      }
    ) => {
      const client = new ApiClient();
      const data = await client.post<DrilldownResponse>("/api/v1/drilldown", {
        drilldown_handle: handle,
        target_grain: opts.grain,
        limit: opts.limit,
        ...(opts.groupBy ? { group_by: [opts.groupBy] } : {}),
      });

      if (opts.format === "json") {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(`${data.handle_label} (${data.metric_id})`);
      if (data.staleness.stale) {
        console.log(
          "STALE: a newer pipeline run has landed since this handle was issued."
        );
      }
      if (data.newer_catalog_version_available) {
        console.log(
          "A newer registered catalog version exists; this evidence uses the handle's pinned definition."
        );
      }
      console.log();

      const result = data.result;
      if (result.mode === "rows") {
        console.log(formatOutput(result.rows, opts.format));
        console.log(
          `\n${result.returned_row_count} ${result.returned_grain} row(s) from ${result.row_mart}` +
            (result.truncated ? " (truncated; more rows exist)" : "")
        );
        if (!result.supporting_detail_complete) {
          console.log(
            "Supporting detail is incomplete: protected account rows were omitted by policy."
          );
        }
        if (result.balance_rollforward) {
          printRollforward(result.balance_rollforward);
        }
        printReconciliation(result.reconciliation);
        return;
      }

      if (result.mode === "dimension_aggregate") {
        const column = result.group_by[0] ?? "group";
        console.log(
          formatOutput(
            result.groups.map((entry) => ({
              [column]: entry.group[column] ?? "-",
              supporting_value: entry.supporting_value,
            })),
            opts.format
          )
        );
        console.log(
          `\n${result.returned_group_count} of ${result.authorized_group_count} authorized group(s)` +
            (result.truncated ? " (truncated by the response limit)" : "")
        );
        printReconciliation(result.reconciliation);
        return;
      }

      // Derived and ratio metrics expand into component handles rather than
      // rows: one row set would make row attribution ambiguous across terms.
      console.log(
        formatOutput(
          result.component_handles.map((component) => ({
            metric_id: component.metric_id,
            relationship: component.relationship,
            grains: component.supported_target_grains.join(", "),
            handle: component.drilldown_handle,
          })),
          opts.format
        )
      );
      console.log(`\n${result.guidance}`);
    }
  );

function printRollforward(rollforward: BalanceRollforward): void {
  console.log(`\nBalance rollforward: ${rollforward.status}`);
  if (rollforward.status !== "supporting_detail_withheld") {
    console.log(
      `  opening ${rollforward.opening_trial_balance}` +
        ` + source GL activity ${rollforward.source_gl_activity}` +
        ` + modeled/non-source ${rollforward.modeled_non_source_adjustment}` +
        ` = ending ${rollforward.ending_trial_balance}` +
        ` (difference ${rollforward.difference})`
    );
  }
  console.log(`  ${rollforward.message}`);
}

function printReconciliation(reconciliation: Reconciliation): void {
  console.log(`\nReconciliation: ${reconciliation.status}`);
  if (reconciliation.status !== "not_comparable") {
    console.log(
      `  reported ${reconciliation.reported_value};` +
        ` supporting ${reconciliation.supporting_value};` +
        ` difference ${reconciliation.difference}`
    );
  } else {
    console.log(`  basis: ${reconciliation.basis}`);
  }
  console.log(`  ${reconciliation.message}`);
}
