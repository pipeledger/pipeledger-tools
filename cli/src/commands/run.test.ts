import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocalCliError } from "../lib/local-error";
import { checkedRunStatus, pollStatus, terminalRunExitCode } from "./run";

describe("terminalRunExitCode", () => {
  it("returns zero only for a succeeded terminal run", () => {
    assert.equal(terminalRunExitCode("succeeded"), 0);
    assert.equal(terminalRunExitCode("failed"), 1);
    assert.equal(terminalRunExitCode("cancelled"), 1);
  });

  it("does not treat an in-progress status check as a failed API call", () => {
    assert.equal(terminalRunExitCode("queued"), null);
    assert.equal(terminalRunExitCode("transforming"), null);
  });

  it("treats extracted as success only for an extract-only run", () => {
    assert.equal(terminalRunExitCode("extracted", "extract"), 0);
    assert.equal(terminalRunExitCode("extracted", "full"), null);
    assert.equal(terminalRunExitCode("extracted", "transform"), null);
  });
});

describe("pollStatus", () => {
  it("returns immediately when an extract-only run reaches extracted", async () => {
    let calls = 0;
    const run = {
      id: "run-1",
      status: "extracted",
      started_at: "2026-08-05T12:00:00Z",
      completed_at: "2026-08-05T12:01:00Z",
      record_count_out: 42,
      triggered_by: "api",
      triggered_stage: "extract" as const,
      failure: null,
    };
    const result = await pollStatus(
      {
        async get<T>() {
          calls += 1;
          return {run} as T;
        },
      },
      "run-1",
      "extract",
      0,
      2,
    );

    assert.equal(result.status, "extracted");
    assert.equal(calls, 1);
  });

  it("uses a stable timeout code and warns that the run may still be active", async () => {
    await assert.rejects(
      pollStatus(
        {
          async get<T>() {
            return {run: {
              id: "run-1",
              status: "transforming",
              started_at: "2026-08-05T12:00:00Z",
              completed_at: null,
              record_count_out: null,
              triggered_by: "api",
              triggered_stage: "full",
              failure: null,
            }} as T;
          },
        },
        "run-1",
        "full",
        0,
        1,
      ),
      (error: unknown) =>
        error instanceof LocalCliError &&
        error.code === "E_CLI_TIMEOUT" &&
        /may still be in progress/i.test(error.message) &&
        error.message.includes("pl run status run-1"),
    );
  });
});

it("status rejects a mismatched server envelope instead of reporting success", () => {
  assert.throws(() => checkedRunStatus({ status: "failed" } as any), /unsupported pipeline status response/);
  assert.throws(() => checkedRunStatus({ run: {} } as any), /unsupported pipeline status response/);
});
