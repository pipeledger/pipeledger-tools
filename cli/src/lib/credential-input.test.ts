import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";

import {
  MAX_CREDENTIAL_INPUT_BYTES,
  promptForCredential,
  readCredentialFromStdin,
  resolveCredentialInputMode,
  type CredentialInputStream,
} from "./credential-input";
import { loginCommand } from "../commands/login";
import { LocalCliError } from "./local-error";

const CREDENTIAL = `pl_live_${"a1b2c3d4".repeat(4)}`;

function terminal(): {
  input: CredentialInputStream & PassThrough;
  prompt: PassThrough;
  rawModes: boolean[];
  shown: () => string;
} {
  const rawModes: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (mode: boolean) => {
      rawModes.push(mode);
    },
  });
  const prompt = new PassThrough();
  const written: Buffer[] = [];
  prompt.on("data", (chunk: Buffer) => written.push(chunk));
  return {
    input,
    prompt,
    rawModes,
    shown: () => Buffer.concat(written).toString("utf8"),
  };
}

test("login takes no credential argument", () => {
  assert.deepEqual(loginCommand.registeredArguments, []);
  assert.ok(loginCommand.options.some((option) => option.long === "--stdin"));
});

test("a terminal prompts and a pipe requires --stdin", () => {
  assert.equal(
    resolveCredentialInputMode({ useStdin: false, inputIsTty: true }),
    "prompt",
  );
  assert.equal(
    resolveCredentialInputMode({ useStdin: true, inputIsTty: false }),
    "stdin",
  );

  // Piped input without the flag is refused: reading stdin must be deliberate.
  assert.throws(
    () => resolveCredentialInputMode({ useStdin: false, inputIsTty: false }),
    (error: unknown) =>
      error instanceof LocalCliError &&
      error.code === "E_CLI_AUTH_REQUIRED" &&
      /--stdin/.test(error.message) &&
      /PIPELEDGER_CREDENTIAL_SECRET/.test(error.message),
  );
  assert.throws(
    () => resolveCredentialInputMode({ useStdin: true, inputIsTty: true }),
    (error: unknown) =>
      error instanceof LocalCliError && error.code === "E_CLI_INPUT",
  );
});

test("stdin yields the first non-empty line, trimmed", async () => {
  assert.equal(
    await readCredentialFromStdin(Readable.from([`\n  ${CREDENTIAL}  \r\n`])),
    CREDENTIAL,
  );
  assert.equal(
    await readCredentialFromStdin(
      Readable.from([CREDENTIAL.slice(0, 10), CREDENTIAL.slice(10), "\nextra"]),
    ),
    CREDENTIAL,
  );
});

test("stdin refuses empty and oversized input", async () => {
  await assert.rejects(
    readCredentialFromStdin(Readable.from(["\n  \n"])),
    /No credential was received/,
  );
  await assert.rejects(
    readCredentialFromStdin(
      Readable.from(["x".repeat(MAX_CREDENTIAL_INPUT_BYTES + 1)]),
    ),
    /too large/,
  );
});

test("the prompt never echoes what is typed and restores the terminal", async () => {
  const io = terminal();
  const pending = promptForCredential(io);
  // A paste arrives as one chunk; a correction arrives as a delete.
  io.input.write(`${CREDENTIAL}x`);
  io.input.write("\u007f");
  io.input.write("\r");

  assert.equal(await pending, CREDENTIAL);
  assert.deepEqual(io.rawModes, [true, false]);
  assert.equal(io.shown().includes(CREDENTIAL), false);
  assert.match(io.shown(), /input hidden/);
});

test("the prompt can be cancelled and refuses an empty entry", async () => {
  const cancelled = terminal();
  const cancelPending = promptForCredential(cancelled);
  cancelled.input.write("pl_live_partial\u0003");
  await assert.rejects(cancelPending, /Login cancelled/);
  assert.deepEqual(cancelled.rawModes, [true, false]);

  const empty = terminal();
  const emptyPending = promptForCredential(empty);
  empty.input.write("\n");
  await assert.rejects(emptyPending, /No credential was entered/);
});

test("a terminal that cannot hide input is refused", async () => {
  const input: CredentialInputStream = Object.assign(new PassThrough(), {
    isTTY: true,
  });
  await assert.rejects(
    promptForCredential({ input, prompt: new PassThrough() }),
    /cannot hide input/,
  );
});
