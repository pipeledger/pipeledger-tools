/**
 * Credential entry for `pl login`.
 *
 * A credential is never accepted as a command argument: arguments are saved
 * in shell history and are visible in process listings. It arrives either
 * through a prompt that does not echo, or through stdin when the caller asks
 * for that explicitly with --stdin.
 */

import { LocalCliError } from "./local-error";

/** Far above any issued credential; bounds what an accidental pipe can feed in. */
export const MAX_CREDENTIAL_INPUT_BYTES = 4096;

export interface CredentialInputStream extends NodeJS.ReadableStream {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
}

export interface CredentialInputIo {
  input: CredentialInputStream;
  /** Prompts go to stderr so stdout stays clean for piped output. */
  prompt: NodeJS.WritableStream;
}

export type CredentialInputMode = "prompt" | "stdin";

/** Decide how the credential arrives, or explain what the caller should do. */
export function resolveCredentialInputMode(args: {
  useStdin: boolean;
  inputIsTty: boolean;
}): CredentialInputMode {
  if (args.useStdin) {
    if (args.inputIsTty) {
      throw new LocalCliError(
        "--stdin reads the credential from a pipe or file, for example: `pl login --stdin < credential.txt`. Run `pl login` without --stdin to paste it at a prompt.",
        "E_CLI_INPUT",
      );
    }
    return "stdin";
  }
  if (!args.inputIsTty) {
    throw new LocalCliError(
      "No terminal is attached, so the credential cannot be prompted for. Pipe it with `pl login --stdin`, or skip login and set PIPELEDGER_CREDENTIAL_SECRET.",
      "E_CLI_AUTH_REQUIRED",
    );
  }
  return "prompt";
}

/** First non-empty line of piped input, trimmed. */
export async function readCredentialFromStdin(
  input: NodeJS.ReadableStream,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const buffer =
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_CREDENTIAL_INPUT_BYTES) {
      throw new LocalCliError(
        "The input is too large to be a PipeLedger credential. Pipe only the credential.",
        "E_CLI_INPUT",
      );
    }
    chunks.push(buffer);
  }
  const credential = Buffer.concat(chunks)
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!credential) {
    throw new LocalCliError(
      "No credential was received on stdin.",
      "E_CLI_INPUT",
    );
  }
  return credential;
}

/** Prompt on a terminal without echoing what is typed or pasted. */
export function promptForCredential(io: CredentialInputIo): Promise<string> {
  const { input, prompt } = io;
  if (typeof input.setRawMode !== "function") {
    return Promise.reject(
      new LocalCliError(
        "This terminal cannot hide input. Pipe the credential with `pl login --stdin` instead.",
        "E_CLI_INPUT",
      ),
    );
  }
  const setRawMode = input.setRawMode.bind(input);

  return new Promise((resolve, reject) => {
    let value = "";

    const finish = (outcome: () => void): void => {
      input.removeListener("data", onData);
      setRawMode(false);
      input.pause();
      prompt.write("\n");
      outcome();
    };

    const onData = (chunk: Buffer | string): void => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          const credential = value.trim();
          finish(() =>
            credential
              ? resolve(credential)
              : reject(
                  new LocalCliError("No credential was entered.", "E_CLI_INPUT"),
                ),
          );
          return;
        }
        if (char === "\u0003") {
          finish(() =>
            reject(new LocalCliError("Login cancelled.", "E_CLI_INPUT")),
          );
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (value.length >= MAX_CREDENTIAL_INPUT_BYTES) {
          finish(() =>
            reject(
              new LocalCliError(
                "The input is too large to be a PipeLedger credential.",
                "E_CLI_INPUT",
              ),
            ),
          );
          return;
        }
        value += char;
      }
    };

    prompt.write("Service credential (input hidden): ");
    setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

export async function readCredential(
  mode: CredentialInputMode,
  io: CredentialInputIo,
): Promise<string> {
  return mode === "stdin"
    ? readCredentialFromStdin(io.input)
    : promptForCredential(io);
}
