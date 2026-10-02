#!/usr/bin/env node
/**
 * PipeLedger CLI (pl)
 *
 * A thin client for the PipeLedger REST API. The service validates every
 * request; the CLI builds requests and renders responses. Runtime imports
 * from the workspace come only from shared/src/public-client, because this
 * file is published to npm (see docs/cli-public-distribution.md).
 *
 * Commands:
 *   pl login [--stdin]              Authenticate and save the credential as a profile
 *   pl switch [name]                Choose the saved profile to use, or list them
 *   pl link [name]                  Link the current folder to a saved profile
 *   pl init [name]                  Create the working folder for an organization
 *   pl logout                       Remove the saved credential from this computer
 *   pl schema <mart>                Inspect a mart's policy-filtered schema
 *   pl query <table>                Query mart tables (JSON/CSV/table output)
 *   pl report metric-report --metrics ...  Configurable Metrics Report
 *   pl report income-statement     Income Statement
 *   pl report balance-sheet        Balance Sheet
 *   pl report cash-flow-statement US GAAP Cash Flow Statement
 *   pl published-status             Show public vs insider publication status
 *   pl run trigger <pipeline-id>    Trigger/scopes a pipeline run
 *   pl run status <run-id>          Check pipeline run status
 *   pl unit-register metrics        List active unit metrics + movement grammar
 *   pl unit-register periods        Inspect posting-period locks
 *   pl unit-register post           Post a unit voucher from a JSON file
 *   pl catalog account-classification edit <id>
 *                                      Edit catalog account classification
 *   pl catalog metrics list            Inspect governed finance metrics
 *   pl audit tail                   Stream real-time audit events
 *   pl whoami                       Show current auth context
 */

import { Command } from "commander";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { switchCommand } from "./commands/switch";
import { initCommand } from "./commands/init";
import { linkCommand } from "./commands/link";
import { queryCommand } from "./commands/query";
import { schemaCommand } from "./commands/schema";
import { runCommand } from "./commands/run";
import { auditCommand } from "./commands/audit";
import { whoamiCommand } from "./commands/whoami";
import { reportCommand } from "./commands/report";
import { dataQualityCommand } from "./commands/data-quality";
import { publishedStatusCommand } from "./commands/published-status";
import { resolveCommand } from "./commands/resolve";
import { drilldownCommand } from "./commands/drilldown";
import { reportLibraryCommand } from "./commands/report-library";
import { usageEvidenceCommand } from "./commands/usage-evidence";
import { catalogCommand } from "./commands/catalog";
import { unitRegisterCommand } from "./commands/unit-register";
import { applyCliErrorContract, handleCliFailure } from "./lib/cli-runner";
import { extractProfileOption } from "./lib/profile-option";
import { PIPELEDGER_CLI_VERSION } from "./lib/version";

const program = new Command()
  .name("pl")
  .description("PipeLedger CLI -- financial data infrastructure")
  .version(PIPELEDGER_CLI_VERSION)
  // Shown in help only. extractProfileOption reads it from anywhere on the
  // command line before Commander parses, so it works after a subcommand.
  .option(
    "--profile <name>",
    "Use this saved profile for one command (or set PIPELEDGER_PROFILE)"
  );

program.addCommand(loginCommand);
program.addCommand(switchCommand);
program.addCommand(initCommand);
program.addCommand(linkCommand);
program.addCommand(logoutCommand);
program.addCommand(schemaCommand);
program.addCommand(queryCommand);
program.addCommand(reportCommand);
program.addCommand(dataQualityCommand);
program.addCommand(publishedStatusCommand);
program.addCommand(resolveCommand);
program.addCommand(drilldownCommand);
program.addCommand(reportLibraryCommand);
program.addCommand(usageEvidenceCommand);
program.addCommand(runCommand);
program.addCommand(unitRegisterCommand);
program.addCommand(catalogCommand);
program.addCommand(auditCommand);
program.addCommand(whoamiCommand);

// After every command is attached: usage errors from any of them are thrown
// instead of printed, so they are masked and honor --format json like every
// other failure.
applyCliErrorContract(program);

const argv = [...process.argv];
if (argv[2] === "--") {
  argv.splice(2, 1);
}

async function main(): Promise<void> {
  try {
    const { argv: commandArgv, profile } = extractProfileOption(argv);
    if (profile !== null) process.env.PIPELEDGER_PROFILE = profile;
    await program.parseAsync(commandArgv);
  } catch (error) {
    process.exitCode = handleCliFailure(error, argv);
  }
}

void main();
