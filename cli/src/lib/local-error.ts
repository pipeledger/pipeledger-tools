export type LocalCliErrorCode =
  | "E_CLI_INPUT"
  | "E_CLI_INTERNAL"
  | "E_CLI_AUTH_REQUIRED"
  | "E_CLI_CONFIG_SECURITY"
  | "E_CLI_CONFIG_WRITE"
  | "E_CLI_FILE_READ"
  | "E_CLI_FILE_JSON"
  | "E_CLI_NETWORK"
  | "E_CLI_TIMEOUT";

/** A customer-safe local failure rendered centrally by the CLI entry point. */
export class LocalCliError extends Error {
  constructor(
    message: string,
    readonly code: LocalCliErrorCode = "E_CLI_INPUT",
  ) {
    super(message);
    this.name = "LocalCliError";
  }
}
