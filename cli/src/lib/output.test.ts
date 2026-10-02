import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatOutput,
  parseJsonOrTableFormat,
  parseOutputFormat,
} from "./output";

describe("formatOutput", () => {
  it("keeps empty JSON machine-readable", () => {
    assert.equal(formatOutput([], "json"), "[]");
    assert.deepEqual(JSON.parse(formatOutput([], "json")), []);
  });

  it("keeps empty table output explanatory", () => {
    assert.equal(formatOutput([], "table"), "No results.");
  });
});

describe("output format parsers", () => {
  it("accepts only implemented formats", () => {
    assert.equal(parseOutputFormat("csv"), "csv");
    assert.equal(parseJsonOrTableFormat("json"), "json");
    assert.throws(() => parseOutputFormat("yaml"), /Invalid output format/);
    assert.throws(() => parseJsonOrTableFormat("csv"), /Valid: json, table/);
  });
});
