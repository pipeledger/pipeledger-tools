/**
 * pl report-library <action> <report-id> [options]
 *
 * The write companion to `pl report`: save a Metrics Report you just ran into
 * a reusable library, revise it, archive it, or propose a personal report for
 * the organization library.
 *
 * Thin client over POST /api/v1/report-library, the same capability service the
 * MCP `pl_report_library` tool calls. The five actions share one request shape,
 * so this command is one subcommand tree over one route rather than five
 * clients.
 *
 * The authorization split is enforced server-side and is worth knowing at the
 * terminal: `--scope organization` needs an operator credential AND the
 * separate organization-report write grant. Without them, save to your personal
 * library and use `propose` -- an owner or admin decides whether it joins the
 * organization library, and nothing is published in the meantime.
 */

import { readFileSync } from "node:fs";
import type { ReportRecipe } from "shared";
import { Command, InvalidArgumentError } from "commander";
import { ApiClient } from "../lib/client";

const LIBRARY_SCOPES = ["personal", "organization"] as const;

type LibraryScope = (typeof LIBRARY_SCOPES)[number];

interface ReportLibraryResponse {
  action: string;
  idempotent_replay: boolean;
  summary: string;
  report: {
    library_scope: string;
    report_id: string;
    report_revision: number;
    display_name: string;
    status: string;
    definition_hash: string;
    catalog_version_saved: string;
    metric_ids: string[];
    definition_kind?: "report_recipe";
    recipe?: ReportRecipe;
  } | null;
  promotion_request: {
    state: string;
    source_report_id: string;
    display_name: string;
    submitted_at: string;
    note: string | null;
  } | null;
}

function parseScope(value: string): LibraryScope {
  if ((LIBRARY_SCOPES as readonly string[]).includes(value)) {
    return value as LibraryScope;
  }
  throw new InvalidArgumentError(
    `Unknown --scope "${value}". Use one of: ${LIBRARY_SCOPES.join(", ")}.`
  );
}

async function send(body: Record<string, unknown>): Promise<void> {
  const data = await new ApiClient().post<ReportLibraryResponse>(
    "/api/v1/report-library",
    body
  );
  console.log(data.summary);
  if (data.idempotent_replay) {
    console.log(
      "(no change: an identical definition was already active, so this replay stored nothing new)"
    );
  }
  if (data.report) {
    console.log(
      `\n${data.report.display_name} — ${data.report.library_scope}/${data.report.report_id}` +
        ` r${data.report.report_revision} (${data.report.status})`
    );
    console.log(data.report.recipe ? `  recipe: ${data.report.recipe.sections.length} sections; load with pl report load-recipe` : `  metrics: ${data.report.metric_ids.join(", ")}`);
    console.log(`  catalog: ${data.report.catalog_version_saved}`);
    console.log(`  definition: ${data.report.definition_hash.slice(0, 12)}`);
  }
  if (data.promotion_request) {
    console.log(
      `\nProposal ${data.promotion_request.state} for ${data.promotion_request.source_report_id}` +
        ` (submitted ${data.promotion_request.submitted_at})`
    );
    if (data.promotion_request.note) {
      console.log(`  note: ${data.promotion_request.note}`);
    }
  }
}

export const reportLibraryCommand = new Command("report-library")
  .description("Save, revise, archive, or propose Metrics Reports and report recipes")
  .addHelpText(
    "after",
    "\nSave and revise need a save_handle from a Metrics Report that actually ran:\n" +
      "  pl report metric-report --metrics revenue --format json   # returns save_handle\n" +
      "  pl report-library save q4_revenue --name 'Q4 Revenue' --description '...' --save-handle <handle>\n"
  );

reportLibraryCommand
  .command("save <report-id>")
  .description("Store a report you just ran as a new library entry")
  .requiredOption("-n, --name <name>", "Human-readable library name")
  .requiredOption(
    "-d, --description <text>",
    "What this report answers, so it can be discovered later"
  )
  .option(
    "--save-handle <handle>",
    "Signed handle returned by a successful pl report run"
  )
  .option("--recipe-file <path>", "JSON recipe definition; mutually exclusive with --save-handle")
  .option("-s, --scope <scope>", "personal or organization", parseScope, "personal")
  .action(
    async (
      reportId: string,
      opts: {
        name: string;
        description: string;
        saveHandle?: string;
        recipeFile?: string;
        scope: LibraryScope;
      }
    ) => {
      await send({
        action: "save",
        library_scope: opts.scope,
        report_id: reportId,
        display_name: opts.name,
        description: opts.description,
        ...(opts.saveHandle ? { save_handle: opts.saveHandle } : {}),
        ...(opts.recipeFile ? { recipe: JSON.parse(readFileSync(opts.recipeFile, "utf8")) } : {}),
      });
    }
  );

reportLibraryCommand
  .command("revise <report-id>")
  .description("Replace the active definition of an existing library entry")
  .requiredOption("-n, --name <name>", "Human-readable library name")
  .requiredOption("-d, --description <text>", "What this report answers")
  .option(
    "--save-handle <handle>",
    "Signed handle returned by a successful pl report run"
  )
  .option("--recipe-file <path>", "JSON recipe definition; mutually exclusive with --save-handle")
  .option("-s, --scope <scope>", "personal or organization", parseScope, "personal")
  .action(
    async (
      reportId: string,
      opts: {
        name: string;
        description: string;
        saveHandle?: string;
        recipeFile?: string;
        scope: LibraryScope;
      }
    ) => {
      await send({
        action: "revise",
        library_scope: opts.scope,
        report_id: reportId,
        display_name: opts.name,
        description: opts.description,
        ...(opts.saveHandle ? { save_handle: opts.saveHandle } : {}),
        ...(opts.recipeFile ? { recipe: JSON.parse(readFileSync(opts.recipeFile, "utf8")) } : {}),
      });
    }
  );

reportLibraryCommand
  .command("archive <report-id>")
  .description("Retire a library entry")
  .option("-s, --scope <scope>", "personal or organization", parseScope, "personal")
  .action(async (reportId: string, opts: { scope: LibraryScope }) => {
    await send({
      action: "archive",
      library_scope: opts.scope,
      report_id: reportId,
    });
  });

// propose and withdraw always read the PERSONAL library: the organization
// library is the destination they are asking about, not the source. The
// service refuses --scope organization here, so no flag is offered.
reportLibraryCommand
  .command("propose <report-id>")
  .description(
    "Submit a personal report to your owners and admins for review (publishes nothing)"
  )
  .option(
    "-m, --note <text>",
    "Short message to the reviewers: who needs this report and why"
  )
  .action(async (reportId: string, opts: { note?: string }) => {
    await send({
      action: "propose",
      library_scope: "personal",
      report_id: reportId,
      ...(opts.note ? { note: opts.note } : {}),
    });
  });

reportLibraryCommand
  .command("withdraw <report-id>")
  .description("Retract a proposal that has not been decided yet")
  .action(async (reportId: string) => {
    await send({
      action: "withdraw",
      library_scope: "personal",
      report_id: reportId,
    });
  });
