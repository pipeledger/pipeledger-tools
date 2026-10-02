import { Command, CommanderError } from "commander";
import { redactCredentials } from "shared/src/public-client";
import { writeCliError } from "./cli-error";

/** Commander outcomes whose output was already written: help and version. */
const ALREADY_RENDERED_CODES: ReadonlySet<string> = new Set([
  "commander.help",
  "commander.helpDisplayed",
  "commander.version",
]);

/**
 * Put every command under one error contract.
 *
 * Commander reports usage errors (a missing argument, an unknown option) by
 * writing to stderr itself and then exiting the process. Left alone, those
 * errors skip credential masking and ignore --format json, and an unknown
 * option is echoed back verbatim even when it is a pasted credential.
 *
 * Commands attached with addCommand() do not inherit the root command's
 * settings, so this walks the whole tree. Usage errors are thrown instead of
 * printed and reach handleCliFailure; help text still prints, masked.
 */
export function applyCliErrorContract(command: Command): void {
  command.exitOverride();
  command.configureOutput({
    writeErr: (value) => {
      process.stderr.write(redactCredentials(value));
    },
    // Rendered centrally by handleCliFailure, never by Commander.
    outputError: () => {},
  });
  for (const subcommand of command.commands) {
    applyCliErrorContract(subcommand);
  }
}

/** Render one command failure through stderr and return its process exit code. */
export function handleCliFailure(
  error: unknown,
  argv: readonly string[],
): number {
  if (error instanceof CommanderError) {
    if (error.exitCode !== 0 && !ALREADY_RENDERED_CODES.has(error.code)) {
      writeCliError(error, argv);
    }
    return error.exitCode;
  }
  writeCliError(error, argv);
  return 1;
}
