import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocalCliError } from "./local-error";
import { extractProfileOption } from "./profile-option";
import { profileNameFromOrganization } from "./profiles";

const NODE = ["node", "pl"];

describe("the --profile option", () => {
  it("is accepted after the subcommand", () => {
    assert.deepEqual(
      extractProfileOption([...NODE, "whoami", "--profile", "riverside-lumber", "--json"]),
      { argv: [...NODE, "whoami", "--json"], profile: "riverside-lumber" },
    );
  });

  it("is accepted before the subcommand and with an equals sign", () => {
    assert.deepEqual(
      extractProfileOption([...NODE, "--profile=castilian-holding", "report", "balance-sheet"]),
      { argv: [...NODE, "report", "balance-sheet"], profile: "castilian-holding" },
    );
  });

  it("leaves the command line alone when it is absent", () => {
    const argv = [...NODE, "query", "gl_lines", "--limit", "5"];
    assert.deepEqual(extractProfileOption(argv), { argv, profile: null });
  });

  it("does not read past the -- separator", () => {
    const argv = [...NODE, "resolve", "--", "--profile", "x"];
    assert.deepEqual(extractProfileOption(argv), { argv, profile: null });
  });

  it("rejects a missing or malformed name without echoing a credential", () => {
    const pasted = `pl_live_${"a".repeat(32)}`;
    for (const argv of [
      [...NODE, "whoami", "--profile"],
      [...NODE, "whoami", "--profile", "--json"],
      [...NODE, "whoami", "--profile", "../../etc/passwd"],
      [...NODE, "whoami", "--profile", pasted],
    ]) {
      assert.throws(
        () => extractProfileOption(argv),
        (error: unknown) =>
          error instanceof LocalCliError &&
          error.code === "E_CLI_INPUT" &&
          !error.message.includes(pasted),
      );
    }
  });
});

describe("profile names derived from an organization", () => {
  it("turns an organization name into a profile name", () => {
    assert.equal(profileNameFromOrganization("Riverside Lumber Co."), "riverside-lumber-co");
    assert.equal(profileNameFromOrganization("  Åre & Søn AS "), "are-s-n-as");
    assert.equal(profileNameFromOrganization("!!!"), "organization");
    assert.equal(profileNameFromOrganization("a".repeat(90)).length, 63);
  });
});


it("rejects repeated profile flags instead of silently choosing the last", () => {
  assert.throws(() => extractProfileOption(["node", "pl", "--profile", "first", "whoami", "--profile=second"]), /only once/);
});
