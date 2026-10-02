import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCustomerProblem } from "shared/src/errors/customer-problem";

import { ApiClientError } from "./client";
import { formatCliError, outputFormatFromArgv } from "./cli-error";
import { LocalCliError } from "./local-error";

describe("CLI error rendering", () => {
  it("preserves the complete server problem in JSON mode", () => {
    const problem = createCustomerProblem("E_DEPENDENCY_UNAVAILABLE", {
      correlationId: "11111111-1111-4111-8111-111111111111",
      retryAfterSeconds: 30,
    });
    const rendered = formatCliError(ApiClientError.fromProblem(problem), "json");
    assert.deepEqual(JSON.parse(rendered), problem);
    assert.equal(rendered.includes("ApiClientError"), false);
    assert.equal(rendered.includes("at "), false);
  });

  it("renders a reviewed server 400 in table mode with recovery evidence", () => {
    const problem = createCustomerProblem("E_INVALID_INPUT", {
      correlationId: "22222222-2222-4222-8222-222222222222",
      publicDetail: "The requested stage is not supported.",
    });
    const rendered = formatCliError(
      ApiClientError.fromProblem(problem),
      "table",
    );

    assert.match(rendered, /^The requested stage is not supported\./);
    assert.match(rendered, /Code: E_INVALID_INPUT/);
    assert.match(
      rendered,
      /Reference: 22222222-2222-4222-8222-222222222222/,
    );
    assert.match(rendered, /Next step: Correct the command input and try again\./);
    assert.doesNotMatch(rendered, /CLI could not complete|ApiClientError|HTTP 400/);
  });

  it("renders bounded field guidance in default table mode", () => {
    const problem = createCustomerProblem("E_INVALID_INPUT", {
      correlationId: "33333333-3333-4333-8333-333333333333",
      fieldErrors: [
        {
          path: ["method"],
          message: 'Expected "indirect" or "direct".',
          code: "invalid_enum_value",
        },
        {
          path: ["metric_ids", 2],
          message: "Select a governed metric.\u001b[31m",
          code: "custom",
        },
      ],
    });

    const rendered = formatCliError(
      ApiClientError.fromProblem(problem),
      "table",
    );
    assert.match(rendered, /Invalid fields:/);
    assert.match(rendered, /- method: Expected "indirect" or "direct"\./);
    assert.match(rendered, /- metric_ids\[2\]: Select a governed metric\./);
    assert.doesNotMatch(rendered, /\u001b/);
  });

  it("recognizes query's default JSON mode and explicit formats", () => {
    assert.equal(outputFormatFromArgv(["node", "pl", "query", "gl_lines"]), "json");
    assert.equal(
      outputFormatFromArgv(["node", "pl", "report", "income-statement", "--format=json"]),
      "json",
    );
    assert.equal(outputFormatFromArgv(["node", "pl", "run", "status", "run-1"]), "table");
  });

  it("does not relay an untyped local exception in JSON mode", () => {
    const sentinel = "SECRET_SENTINEL /srv/private.ts SQLSTATE 42P01";
    const rendered = formatCliError(new Error(sentinel), "json");
    assert.deepEqual(JSON.parse(rendered), {
      error:
        "PipeLedger CLI could not complete the command. Review the command and try again; if the problem continues, contact PipeLedger support.",
      code: "E_CLI_INTERNAL",
    });
    assert.equal(rendered.includes(sentinel), false);
  });

  it("does not relay an untyped local exception in human mode", () => {
    const sentinel = "SECRET_SENTINEL /srv/private.ts internal.db";
    const rendered = formatCliError(new Error(sentinel), "table");
    assert.equal(
      rendered,
      "PipeLedger CLI could not complete the command. Review the command and try again; if the problem continues, contact PipeLedger support.",
    );
    assert.equal(rendered.includes(sentinel), false);
  });

  it("does not stringify a thrown non-Error value", () => {
    const sentinel = "BEARER_TOKEN_SENTINEL";
    const rendered = formatCliError({ provider_body: sentinel }, "table");
    assert.equal(rendered.includes(sentinel), false);
  });

  it("preserves typed local error codes without a stack", () => {
    const rendered = formatCliError(
      new LocalCliError("Could not read the voucher file.", "E_CLI_FILE_READ"),
      "json",
    );
    assert.deepEqual(JSON.parse(rendered), {
      error: "Could not read the voucher file.",
      code: "E_CLI_FILE_READ",
    });
    assert.doesNotMatch(rendered, /LocalCliError|\bat\s+\S/);
  });
});
