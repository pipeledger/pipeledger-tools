/**
 * `--limit abc` used to reach the server. Number.parseInt returned NaN, which
 * serialized to null, and the terminal showed a 400 from the API for a mistake
 * the CLI could name locally. These pin the local refusal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidArgumentError } from "commander";
import { parseBoundedInteger, parseLimitOption } from "./option-parsers";

describe("pl --limit", () => {
  it("accepts a whole number inside the range", () => {
    assert.equal(parseLimitOption("25"), 25);
    assert.equal(parseLimitOption(" 25 "), 25);
    assert.equal(parseLimitOption("1"), 1);
    assert.equal(parseLimitOption("100"), 100);
  });

  it("refuses non-numeric input locally instead of sending NaN", () => {
    assert.throws(
      () => parseLimitOption("abc"),
      (error: unknown) => {
        assert.ok(error instanceof InvalidArgumentError);
        assert.match(error.message, /whole number between 1 and 100/);
        return true;
      }
    );
  });

  it("refuses a trailing-garbage number rather than silently truncating it", () => {
    // Number.parseInt("10abc") is 10, so this would have been accepted as a
    // valid limit and the typo never reported.
    assert.throws(() => parseLimitOption("10abc"), InvalidArgumentError);
    assert.throws(() => parseLimitOption("2.5"), InvalidArgumentError);
    assert.throws(() => parseLimitOption("-5"), InvalidArgumentError);
    assert.throws(() => parseLimitOption(""), InvalidArgumentError);
  });

  it("reports the bound it broke, not just that it is invalid", () => {
    assert.throws(
      () => parseLimitOption("500"),
      (error: unknown) => {
        assert.match(String(error), /between 1 and 100. Received 500/);
        return true;
      }
    );
  });

  it("names the flag it is parsing so the message is actionable", () => {
    assert.throws(
      () => parseBoundedInteger("0", { name: "--rows", min: 1, max: 10 }),
      (error: unknown) => {
        assert.match(String(error), /--rows/);
        return true;
      }
    );
  });
});
