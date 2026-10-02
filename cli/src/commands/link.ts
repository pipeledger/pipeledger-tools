/**
 * pl link [name]
 *
 * Links the current folder to a saved profile, so every command run in it,
 * or in a folder inside it, reads that organization's books. It runs on this
 * computer only and makes no request.
 *
 * The link is a small file, `.pipeledger.json`, that names the profile and
 * its organization. It holds no credential. `pl init` links the folder it
 * creates; `pl link` is for a folder that already exists.
 */

import { Command } from "commander";
import { describeSavedProfiles } from "../lib/config";
import { LocalCliError } from "../lib/local-error";
import { FOLDER_MARKER_FILE, writeFolderMarker } from "../lib/profiles";
import { registerWorkspace } from "../lib/workspaces";
import { chooseProfile } from "./init";

export const linkCommand = new Command("link")
  .description(
    `Link the current folder to a saved profile (writes ${FOLDER_MARKER_FILE}, which holds no credential)`
  )
  .argument("[name]", "Saved profile to link this folder to")
  // Read by extractProfileOption before Commander parses; declared here so
  // `pl link --help` shows it.
  .option("--profile <name>", "Same as the name argument")
  .action((name: string | undefined) => {
    if (process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim() || process.env.PIPELEDGER_CONFIG_FILE?.trim()) {
      throw new LocalCliError("Unset PIPELEDGER_CREDENTIAL_SECRET and PIPELEDGER_CONFIG_FILE before linking this folder.", "E_CLI_AUTH_REQUIRED");
    }
    const option = process.env.PIPELEDGER_PROFILE?.trim() || undefined;
    if (name !== undefined && option !== undefined && name !== option) {
      throw new LocalCliError(
        "`pl link` was given two different profiles, as a name and with --profile. Give one. Nothing was changed.",
        "E_CLI_INPUT",
      );
    }
    const profile = chooseProfile(describeSavedProfiles(), name ?? option, "link");
    if (!profile.readable || !profile.organizationId) {
      throw new LocalCliError("This profile cannot be verified locally. Run `pl login` with a new profile name before linking a folder to it.", "E_CLI_AUTH_REQUIRED");
    }

    const marker = writeFolderMarker(process.cwd(), {
      profile: profile.name,
      orgId: profile.organizationId,
    });
    console.log(`This folder is now linked to the profile ${profile.name}.`);
    console.log(`  Organization: ${profile.organizationName ?? "(organization not recorded)"}`);
    console.log(`  Written:      ${marker}`);
    console.log(
      "  The file names the profile and holds no credential. Folders inside this one use it too."
    );
    try {
      registerWorkspace({ orgId: profile.organizationId, path: process.cwd() });
    } catch (error) {
      // The link is written. The list of folders is a convenience, so a
      // failure to update it must not make the link look failed.
      if (!(error instanceof LocalCliError)) throw error;
    }
  });
