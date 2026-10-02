/**
 * pl switch [name]
 *
 * Chooses which saved credential `pl` uses. It runs on this computer only
 * and makes no request.
 *
 *   pl switch                 List the saved profiles and the one in use here
 *   pl switch <name>          Make <name> the default
 *
 * A folder linked with `pl link` outranks the default, so work in a client's
 * folder always runs against that client, whatever the default is elsewhere.
 */

import { Command } from "commander";
import {
  describeCredentialSource,
  describeSavedProfiles,
  type CredentialSource,
  type DescribedProfile,
} from "../lib/config";
import { LocalCliError } from "../lib/local-error";
import { assertProfileName, writeDefaultProfileName } from "../lib/profiles";
import { workspaceFoldersByOrganization } from "../lib/workspaces";

const SELECTED_BY_TEXT: Record<CredentialSource["selectedBy"], string> = {
  environment: "the PIPELEDGER_CREDENTIAL_SECRET setting",
  config_file: "the PIPELEDGER_CONFIG_FILE setting",
  option: "the --profile option",
  folder: "this folder",
  default: "your default",
  only: "being the only saved profile",
};

export function describeSelection(source: CredentialSource | null): string {
  if (!source) return "none";
  const by = SELECTED_BY_TEXT[source.selectedBy];
  if (source.profile === null) return `set by ${by}`;
  return source.markerFile
    ? `${source.profile} (chosen by ${by}: ${source.markerFile})`
    : `${source.profile} (chosen by ${by})`;
}

function organizationLabel(profile: DescribedProfile): string {
  if (!profile.readable) return "(file could not be read)";
  return profile.organizationName ?? "(organization not recorded)";
}

/**
 * `folders` maps an organization ID to the workspace folders still bound to
 * it. It only helps a person find them; it selects nothing.
 */
export function formatProfileList(
  profiles: readonly DescribedProfile[],
  source: CredentialSource | null,
  folders: ReadonlyMap<string, readonly string[]> = new Map(),
): string {
  if (profiles.length === 0) {
    return "No credential is saved on this computer. Run `pl login` to save one.";
  }
  const nameWidth = Math.max(...profiles.map((profile) => profile.name.length));
  const lines = profiles.flatMap((profile) => {
    const marks = [
      profile.name === source?.profile ? "in use here" : null,
      profile.isDefault ? "default" : null,
    ].filter((mark): mark is string => mark !== null);
    const workspaces = profile.organizationId
      ? (folders.get(profile.organizationId.toLowerCase()) ?? [])
      : [];
    return [
      `  ${profile.name.padEnd(nameWidth)}  ${organizationLabel(profile)}` +
        (marks.length > 0 ? `  [${marks.join(", ")}]` : ""),
      ...workspaces.map((folder) => `  ${"".padEnd(nameWidth)}  folder: ${folder}`),
    ];
  });
  return [
    "Saved profiles:",
    ...lines,
    "",
    `In use here: ${describeSelection(source)}`,
  ].join("\n");
}

function currentSourceOrNull(): CredentialSource | null {
  try {
    return describeCredentialSource();
  } catch (error) {
    // Several profiles and none selected is what `pl switch` exists to fix.
    if (error instanceof LocalCliError) return null;
    throw error;
  }
}

export const switchCommand = new Command("switch")
  .description("Choose which saved credential pl uses, or list them")
  .argument("[name]", "Profile to use")
  .action((name: string | undefined) => {
    const profiles = describeSavedProfiles();

    if (name === undefined) {
      console.log(
        formatProfileList(profiles, currentSourceOrNull(), workspaceFoldersByOrganization()),
      );
      return;
    }

    const wanted = assertProfileName(name);
    const profile = profiles.find((entry) => entry.name === wanted);
    if (!profile) {
      const saved =
        profiles.length > 0
          ? `Saved profiles: ${profiles.map((entry) => entry.name).join(", ")}.`
          : "No credential is saved on this computer.";
      throw new LocalCliError(
        `No saved profile is named "${wanted}". ${saved} Run \`pl login --profile ${wanted}\` to save it.`,
        "E_CLI_INPUT",
      );
    }

    if (!profile.readable || !profile.organizationId) {
      throw new LocalCliError("This profile cannot be verified locally. Run `pl login` with a new profile name before selecting it.", "E_CLI_AUTH_REQUIRED");
    }

    writeDefaultProfileName(profile.name);
    console.log(`Default profile is now ${profile.name}.`);
    console.log(`  Organization: ${organizationLabel(profile)}`);
    const source = currentSourceOrNull();
    if (source && source.profile !== profile.name) {
      console.log(
        `  In this folder \`pl\` still uses ${describeSelection(source)}, which outranks the default.`
      );
    }
  });
