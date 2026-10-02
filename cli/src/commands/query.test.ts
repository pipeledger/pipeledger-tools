import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatConfidentialOmissionNotice } from "./query";

/**
 * Text/CLI disclosure equivalence (security review round 2, finding 6): the
 * CLI prints the confidential-omission notice whenever the REST response
 * carries the structured note, with the SAME sentence every other text
 * surface renders (mart-query's describeConfidentialOmission is the wording
 * source of truth; this pin fails if either side drifts).
 */
describe("pl query confidential-omission notice", () => {
  it("renders the shared disclosure sentence for the structured note", () => {
    assert.equal(
      formatConfidentialOmissionNotice({
        filter_columns: ["po_number", "vendor_id"],
        rows_omitted_for_confidentiality: true,
      }),
      "Rows from confidentiality-protected accounts were omitted from this filtered result because the query referenced po_number, vendor_id; unfiltered queries still show those rows with protected fields masked."
    );
  });

  it("prints nothing when the note is absent or empty", () => {
    assert.equal(formatConfidentialOmissionNotice(undefined), null);
    assert.equal(
      formatConfidentialOmissionNotice({
        filter_columns: [],
        rows_omitted_for_confidentiality: true,
      }),
      null
    );
  });
});
