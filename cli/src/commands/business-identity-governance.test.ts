import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessIdentityGovernanceCommand } from "./business-identity-governance";

describe("catalog business-identity command contract", () => {
  it("requires review before commit and the same operation file on both steps", () => {
    const review = businessIdentityGovernanceCommand.commands.find(
      (command) => command.name() === "review",
    );
    const commit = businessIdentityGovernanceCommand.commands.find(
      (command) => command.name() === "commit",
    );
    assert.ok(review);
    assert.ok(commit);
    assert.equal(
      review.options.find((option) => option.long === "--operation-file")
        ?.mandatory,
      true,
    );
    assert.equal(
      commit.options.find((option) => option.long === "--operation-file")
        ?.mandatory,
      true,
    );
    assert.equal(
      commit.options.find((option) => option.long === "--review-token")
        ?.mandatory,
      true,
    );
    assert.match(commit.description(), /unchanged, reviewed operation/i);
  });
});
