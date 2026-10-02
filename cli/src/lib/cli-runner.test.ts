import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { Command } from "commander";

import { applyCliErrorContract, handleCliFailure } from "./cli-runner";
import { LocalCliError } from "./local-error";

const SYNTHETIC_CREDENTIAL = `pl_live_${"a1b2c3d4".repeat(4)}`;

/** A root with one attached command, wired the way src/index.ts wires `pl`. */
function programUnderContract(): Command {
  const program = new Command().name("pl");
  program.addCommand(
    new Command("schema")
      .argument("<mart>", "Mart short name")
      .option("--format <fmt>", "Output format", "table")
      .action(() => {}),
  );
  applyCliErrorContract(program);
  return program;
}

async function runCapturingOutput(
  args: string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let stderr = "";
  let stdout = "";
  const originalStderrWrite = process.stderr.write;
  const originalStdoutWrite = process.stdout.write;
  process.stderr.write = ((value: string | Uint8Array) => {
    stderr += String(value);
    return true;
  }) as typeof process.stderr.write;
  process.stdout.write = ((value: string | Uint8Array) => {
    stdout += String(value);
    return true;
  }) as typeof process.stdout.write;
  const argv = ["node", "pl", ...args];
  let exitCode = 0;
  try {
    await programUnderContract().parseAsync(argv);
  } catch (error) {
    exitCode = handleCliFailure(error, argv);
  } finally {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
  }
  return { exitCode, stderr, stdout };
}

describe("usage errors follow the same contract as command failures", () => {
  it("masks a credential pasted where an option was expected", async () => {
    const result = await runCapturingOutput([
      "schema",
      "gl_lines",
      `--${SYNTHETIC_CREDENTIAL}`,
    ]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unknown option/);
    assert.equal(result.stderr.includes(SYNTHETIC_CREDENTIAL), false);
  });

  it("masks a credential passed as an unknown command", async () => {
    const result = await runCapturingOutput([SYNTHETIC_CREDENTIAL]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.includes(SYNTHETIC_CREDENTIAL), false);
  });

  it("reports a missing argument as JSON when JSON was requested", async () => {
    const result = await runCapturingOutput(["schema", "--format", "json"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    const parsed = JSON.parse(result.stderr) as { error: string; code: string };
    assert.equal(parsed.code, "E_CLI_INPUT");
    assert.match(parsed.error, /missing required argument 'mart'/);
  });

  it("reports a missing argument as one plain line otherwise", async () => {
    const result = await runCapturingOutput(["schema"]);
    assert.equal(result.exitCode, 1);
    assert.equal(
      result.stderr.trim(),
      "error: missing required argument 'mart'",
    );
  });

  it("prints help once and does not report it as a failure", async () => {
    const help = await runCapturingOutput(["schema", "--help"]);
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /Usage: pl schema/);
    assert.equal(help.stderr, "");

    // No command at all: Commander shows help on stderr and exits 1.
    const bare = await runCapturingOutput([]);
    assert.equal(bare.exitCode, 1);
    assert.match(bare.stderr, /Usage: pl/);
    assert.doesNotMatch(bare.stderr, /outputHelp/);
  });
});

describe("CLI entry-point error channel and exit contract", () => {
  it("writes typed failures only to stderr and returns exit 1", () => {
    let stderr = "";
    let stdout = "";
    const originalStderrWrite = process.stderr.write;
    const originalStdoutWrite = process.stdout.write;
    process.stderr.write = ((value: string | Uint8Array) => {
      stderr += String(value);
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((value: string | Uint8Array) => {
      stdout += String(value);
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = handleCliFailure(
        new LocalCliError(
          "Could not read the voucher file. Check the path and file permissions.",
          "E_CLI_FILE_READ",
        ),
        ["node", "pl", "unit-register", "post"],
      );
      assert.equal(exitCode, 1);
      assert.equal(stdout, "");
      assert.match(stderr, /Check the path and file permissions/);
      assert.doesNotMatch(stderr, /LocalCliError|ENOENT|\n\s*at\s/);
    } finally {
      process.stderr.write = originalStderrWrite;
      process.stdout.write = originalStdoutWrite;
    }
  });

  it("keeps command and config modules free of direct process termination", () => {
    for (const file of [
      "src/lib/config.ts",
      "src/commands/whoami.ts",
      "src/commands/login.ts",
      "src/commands/unit-register.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.doesNotMatch(source, /process\.exit\s*\(/, file);
    }
  });
});
