import { LocalCliError } from "./local-error";
import { assertProfileName } from "./profiles";

/**
 * Take `--profile <name>` or `--profile=<name>` out of the command line.
 *
 * Commander scopes an option to the command that declares it, so a root
 * option is rejected after a subcommand (`pl whoami --profile x`). People and
 * agents put it where it reads best, so it is accepted anywhere before `--`.
 */
export function extractProfileOption(argv: readonly string[]): {
  argv: string[];
  profile: string | null;
} {
  const remaining: string[] = [];
  let profile: string | null = null;
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    // The first two entries are the runtime and the script.
    if (passthrough || index < 2) {
      remaining.push(value);
      continue;
    }
    if (value === "--") {
      passthrough = true;
      remaining.push(value);
      continue;
    }
    if (value === "--profile") {
      const name = argv[index + 1];
      if (name === undefined || name.startsWith("-")) {
        throw new LocalCliError(
          "`--profile` needs a profile name. Run `pl switch` to see the saved profiles.",
          "E_CLI_INPUT",
        );
      }
      if (profile !== null) throw new LocalCliError("Use --profile only once per command.", "E_CLI_INPUT");
      profile = assertProfileName(name);
      index += 1;
      continue;
    }
    if (value.startsWith("--profile=")) {
      if (profile !== null) throw new LocalCliError("Use --profile only once per command.", "E_CLI_INPUT");
      profile = assertProfileName(value.slice("--profile=".length));
      continue;
    }
    remaining.push(value);
  }
  return { argv: remaining, profile };
}
