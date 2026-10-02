/**
 * pl init [name] [--folder <name>] [--root <path>]
 *
 * Creates the working folder for one organization, ready for a person and an
 * AI agent to work in: the instructions an agent reads first, folders for
 * reference material, notes and reports, and the link that names which
 * books the folder reads. It runs on this computer only and makes no request.
 *
 *   pl init                       When exactly one profile is saved
 *   pl init <name>                For the saved profile <name>
 *   pl init <name> --root <path>  Choose where workspaces are kept; remembered
 *
 * Nothing that exists is replaced. Running it again completes a workspace
 * and leaves edited files as they are.
 */

import { resolve } from "path";
import { Command } from "commander";
import { describeSavedProfiles, type DescribedProfile } from "../lib/config";
import { LocalCliError } from "../lib/local-error";
import { assertProfileName } from "../lib/profiles";
import {
  createClientWorkspace,
  defaultWorkspaceRoot,
  readWorkspaceRegistry,
  registerWorkspace,
  type CreatedWorkspace,
} from "../lib/workspaces";

function describeSaved(profiles: readonly DescribedProfile[]): string {
  return profiles.length > 0
    ? `Saved profiles: ${profiles.map((entry) => entry.name).join(", ")}.`
    : "No credential is saved on this computer.";
}

/** The profile a workspace is created for. Never a guess between several. */
export function chooseProfile(
  profiles: readonly DescribedProfile[],
  requested: string | undefined,
  command: "init" | "link" = "init",
): DescribedProfile {
  if (requested === undefined) {
    if (profiles.length === 1) return profiles[0];
    throw new LocalCliError(
      profiles.length === 0
        ? `No credential is saved on this computer. Run \`pl login\` first, then \`pl ${command}\`.`
        : `Several credentials are saved, so \`pl ${command}\` needs the profile to use. ${describeSaved(profiles)} Example: \`pl ${command} ${profiles[0].name}\`.`,
      profiles.length === 0 ? "E_CLI_AUTH_REQUIRED" : "E_CLI_INPUT",
    );
  }
  const wanted = assertProfileName(requested);
  const profile = profiles.find((entry) => entry.name === wanted);
  if (!profile) {
    throw new LocalCliError(
      `No saved profile is named "${wanted}". ${describeSaved(profiles)} Run \`pl login --profile ${wanted}\` to save it.`,
      "E_CLI_INPUT",
    );
  }
  return profile;
}

export function formatInitResult(
  result: CreatedWorkspace,
  profile: DescribedProfile,
  rootWasChosenNow: boolean,
): string {
  const organization = profile.organizationName ?? profile.name;
  const lines = [
    result.created.length > 0
      ? "Workspace ready."
      : "This workspace was already complete. Nothing was changed.",
    `  Organization: ${organization}`,
    `  Folder:       ${result.folder}`,
  ];
  if (result.created.length > 0) lines.push(`  Created:      ${result.created.join(", ")}`);
  if (result.kept.length > 0 && result.created.length > 0) {
    lines.push(`  Kept:         ${result.kept.join(", ")} (already there, left unchanged)`);
  }
  lines.push(`  Methods:      ${result.methodsFolder} (your own procedures and templates, no client data)`);
  if (rootWasChosenNow) {
    lines.push(
      `  Workspaces are kept in ${result.root}. To keep them elsewhere, run \`pl init <name> --root <path>\`.`,
    );
  }
  if (result.boundToOtherProfile) {
    lines.push(
      `  This folder stays linked to the profile ${result.boundToOtherProfile}, for the same organization. Run \`pl link ${profile.name}\` in it to change that.`,
    );
  }
  lines.push(
    "",
    "Next:",
    "  1. Open your agent on the folder above, one session for this client only.",
    "  2. Fill in \"The client\" and \"How I want work done\" in AGENTS.md.",
    "The folder holds no credential, so it can be synced or shared with people who may see this client's material.",
  );
  return lines.join("\n");
}

export const initCommand = new Command("init")
  .description("Create the working folder for an organization, for you and your AI agent")
  .argument("[name]", "Saved profile to create the workspace for")
  .option("--folder <name>", "Folder name inside clients/ (default: the profile name)")
  .option("--root <path>", "Folder that holds clients/ and methods/; remembered for next time")
  // Read by extractProfileOption before Commander parses; declared here so
  // `pl init --help` shows it.
  .option("--profile <name>", "Same as the name argument")
  .action((name: string | undefined, options: { folder?: string; root?: string }) => {
    if (process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim() || process.env.PIPELEDGER_CONFIG_FILE?.trim()) {
      throw new LocalCliError(
        "Unset PIPELEDGER_CREDENTIAL_SECRET and PIPELEDGER_CONFIG_FILE before creating a workspace. A workspace is linked to a saved profile.",
        "E_CLI_AUTH_REQUIRED",
      );
    }
    const option = process.env.PIPELEDGER_PROFILE?.trim() || undefined;
    if (name !== undefined && option !== undefined && name !== option) {
      throw new LocalCliError(
        "`pl init` was given two different profiles, as a name and with --profile. Give one. Nothing was changed.",
        "E_CLI_INPUT",
      );
    }
    const profile = chooseProfile(describeSavedProfiles(), name ?? option);
    if (!profile.readable || !profile.organizationId) {
      throw new LocalCliError(
        "This profile cannot be verified locally. Run `pl login` with a new profile name before creating its workspace.",
        "E_CLI_AUTH_REQUIRED",
      );
    }

    const registry = readWorkspaceRegistry();
    const root = options.root?.trim()
      ? resolve(options.root.trim())
      : (registry.root ?? defaultWorkspaceRoot());
    const result = createClientWorkspace({
      root,
      folderName: options.folder ?? profile.name,
      profile: profile.name,
      orgId: profile.organizationId,
      organizationName: profile.organizationName ?? profile.name,
    });
    registerWorkspace({ orgId: profile.organizationId, path: result.folder }, result.root);

    console.log(formatInitResult(result, profile, registry.root !== result.root));
  });
