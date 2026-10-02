/**
 * pl login [--stdin] [--profile <name>]
 *
 *  1. An Owner or Admin mints a service credential in Access control
 *  2. `pl login` prompts for it without echoing; `pl login --stdin` reads it
 *     from a pipe for unattended setup
 *  3. CLI validates the credential and receives its organization context
 *  4. Stores { api_url, credential_secret, org_id, org_name } as a profile in
 *     ~/.pipeledger/profiles/<name>.json (mode 0600) and makes it the default.
 *     The name is `--profile`, or is derived from the organization's name.
 *
 * The credential is never a command argument: arguments are saved in shell
 * history and are visible in process listings.
 */

import { Command } from "commander";
import {
  PIPELEDGER_APP_ORIGIN,
  canonicalPipeLedgerAppOrigin,
  deriveCredentialPrefix,
} from "shared/src/public-client";
import { describeSavedProfiles, saveConfig } from "../lib/config";
import { ApiClient } from "../lib/client";
import {
  readCredential,
  resolveCredentialInputMode,
} from "../lib/credential-input";
import { LocalCliError } from "../lib/local-error";
import {
  assertProfileName,
  assertUnambiguousCredentialSettings,
  profileNameFromOrganization,
  writeDefaultProfileName,
} from "../lib/profiles";

interface ValidateResponse {
  org_id: string;
  org_name: string;
  label: string;
}

export const loginCommand = new Command("login")
  .description("Authenticate with a PipeLedger service credential")
  .option(
    "--stdin",
    "Read the credential from stdin instead of prompting (for automation and AI agents)",
    false
  )
  // Read by extractProfileOption before Commander parses; declared here so
  // `pl login --help` shows it.
  .option(
    "--profile <name>",
    "Save under this profile name instead of one derived from the organization"
  )
  .option(
    "--api-url <url>",
    "API base URL",
    PIPELEDGER_APP_ORIGIN
  )
  .allowExcessArguments(true)
  .action(async (opts: { stdin: boolean; apiUrl: string }, command: Command) => {
    if (command.args.length > 0) {
      // Never echo the argument: it may be a live credential.
      throw new LocalCliError(
        "`pl login` does not take the credential as an argument, because arguments are saved in shell history. Run `pl login` and paste it at the prompt, or pipe it with `pl login --stdin`. If you just typed a live credential, remove it from your shell history.",
        "E_CLI_INPUT",
      );
    }

    assertUnambiguousCredentialSettings();
    const mode = resolveCredentialInputMode({
      useStdin: opts.stdin,
      inputIsTty: Boolean(process.stdin.isTTY),
    });
    const credential = await readCredential(mode, {
      input: process.stdin,
      prompt: process.stderr,
    });

    if (!deriveCredentialPrefix(credential)) {
      throw new LocalCliError(
        "Invalid credential format. Credentials start with pl_live_ and include the full token.",
      );
    }

    const baseUrl = canonicalPipeLedgerAppOrigin(opts.apiUrl);
    const client = new ApiClient({
      api_url: baseUrl,
      credential_secret: credential,
    });
    const data = await client.post<ValidateResponse>("/api/v1/auth/validate", {});

    const explicitFile = process.env.PIPELEDGER_CONFIG_FILE?.trim();
    const requestedProfile = process.env.PIPELEDGER_PROFILE?.trim();
    const profile = explicitFile
      ? null
      : requestedProfile
        ? assertProfileName(requestedProfile)
        : profileNameFromOrganization(data.org_name);

    // A derived name that already holds another organization's credential
    // would silently replace it. Replacing the same organization's
    // credential is the ordinary case: a rotated or reissued credential.
    const savedProfiles = profile ? describeSavedProfiles() : [];
    const existing = savedProfiles.find((entry) => entry.name === profile);
    if (
      existing &&
      (!existing.readable || existing.organizationId !== data.org_id)
    ) {
      throw new LocalCliError(
        `The profile "${profile}" already holds a credential for ${existing.organizationName ?? "another organization"}. Nothing was saved. Run \`pl login --profile <name>\` with a name of your choice.`,
        "E_CLI_INPUT",
      );
    }

    const file = saveConfig(
      {
        api_url: baseUrl,
        credential_secret: credential,
        org_id: data.org_id,
        org_name: data.org_name,
      },
      profile ? { profile } : {},
    );

    console.log(`Authenticated successfully.`);
    console.log(`  Organization: ${data.org_name}`);
    console.log(`  Credential:   ${data.label}`);
    if (profile) {
      const previousDefault = savedProfiles.find((entry) => entry.isDefault)?.name;
      writeDefaultProfileName(profile);
      console.log(
        `  Profile:      ${profile}` +
          (existing ? " (replaced the credential saved under this name)" : ""),
      );
      console.log(
        previousDefault && previousDefault !== profile
          ? `  Default:      ${profile} (was ${previousDefault})`
          : `  Default:      ${profile}`,
      );
    }
    console.log(`  Config saved: ${file}`);
  });
