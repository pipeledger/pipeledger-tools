/**
 * pl logout [--profile <name>]
 *
 * Removes the saved credential file `pl` is reading. It runs on this computer
 * only: it needs no valid credential, makes no request, and revokes nothing.
 * Revocation stays an Owner or Admin decision in PipeLedger.
 */

import { Command } from "commander";
import {
  describeCredentialSource,
  removeActiveCredentialFile,
  type CredentialSource,
} from "../lib/config";
import { LocalCliError } from "../lib/local-error";
import { describeSelection } from "./switch";

/** What `pl` uses after the removal. Null when nothing is selected. */
function sourceAfterRemoval(): CredentialSource | null {
  // `--profile` named the profile to remove. It is gone now, so it must not
  // also decide what is reported as in use afterwards.
  delete process.env.PIPELEDGER_PROFILE;
  try {
    const source = describeCredentialSource();
    return source?.selectedBy === "environment" ? null : source;
  } catch (error) {
    if (error instanceof LocalCliError) return null;
    throw error;
  }
}

export const logoutCommand = new Command("logout")
  .description("Remove the saved service credential from this computer")
  // Read by extractProfileOption before Commander parses; declared here so
  // `pl logout --help` shows it.
  .option("--profile <name>", "Remove this profile instead of the one in use")
  .action(() => {
    const result = removeActiveCredentialFile();

    if (!result.removed) {
      console.log("No saved credential found. Nothing was removed.");
    } else {
      console.log("Signed out on this computer.");
      if (result.profile) console.log(`  Profile:  ${result.profile}`);
      console.log(`  Removed:  ${result.removed}`);
      const next = sourceAfterRemoval();
      if (result.remaining.length > 0) {
        console.log(`  Still saved: ${result.remaining.join(", ")}`);
      }
      if (next) {
        console.log(`  Now in use:  ${describeSelection(next)}`);
        console.log(
          "  Run `pl whoami` to see what it is, or `pl switch <name>` to choose another."
        );
      } else if (result.remaining.length > 0) {
        console.log(
          "  None of them is selected. Run `pl switch <name>` to choose one."
        );
      } else {
        console.log("  No saved credential remains. Run `pl login` to sign in again.");
      }
    }

    if (result.environmentCredential) {
      console.log(
        "PIPELEDGER_CREDENTIAL_SECRET is set, so `pl` still has a credential in this session. Remove that setting to sign out fully."
      );
    }
    if (result.removed) {
      console.log(
        "The credential itself stays valid until an Owner or Admin revokes it in PipeLedger."
      );
    }
  });
