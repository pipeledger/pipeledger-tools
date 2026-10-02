import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CredentialSource, DescribedProfile } from "../lib/config";
import { describeSelection, formatProfileList } from "./switch";

const PROFILES: DescribedProfile[] = [
  {
    name: "castilian-holding",
    file: "/home/user/.pipeledger/profiles/castilian-holding.json",
    organizationId: "00000000-0000-4000-8000-00000000000b",
    organizationName: "Castilian Holding",
    readable: true,
    isDefault: true,
  },
  {
    name: "riverside-lumber",
    file: "/home/user/.pipeledger/profiles/riverside-lumber.json",
    organizationId: "00000000-0000-4000-8000-00000000000a",
    organizationName: "Riverside Lumber",
    readable: true,
    isDefault: false,
  },
  {
    name: "third-client",
    file: "/home/user/.pipeledger/profiles/third-client.json",
    organizationId: null,
    organizationName: null,
    readable: false,
    isDefault: false,
  },
];

const FOLDER: CredentialSource = {
  selectedBy: "folder",
  profile: "riverside-lumber",
  file: "/home/user/.pipeledger/profiles/riverside-lumber.json",
  markerFile: "/home/user/clients/riverside/.pipeledger.json",
};

describe("pl switch output", () => {
  it("lists every profile with its organization and marks the ones that matter", () => {
    assert.equal(
      formatProfileList(PROFILES, FOLDER),
      [
        "Saved profiles:",
        "  castilian-holding  Castilian Holding  [default]",
        "  riverside-lumber   Riverside Lumber  [in use here]",
        "  third-client       (file could not be read)",
        "",
        "In use here: riverside-lumber (chosen by this folder: /home/user/clients/riverside/.pipeledger.json)",
      ].join("\n"),
    );
  });

  it("says none is in use when several are saved and none is selected", () => {
    assert.match(formatProfileList(PROFILES, null), /In use here: none$/);
  });

  it("tells a new user how to start", () => {
    assert.match(formatProfileList([], null), /Run `pl login`/);
  });

  it("names the setting when no profile is involved", () => {
    assert.equal(
      describeSelection({
        selectedBy: "environment",
        profile: null,
        file: null,
        markerFile: null,
      }),
      "set by the PIPELEDGER_CREDENTIAL_SECRET setting",
    );
  });
});
