import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import type { DescribedProfile } from "../lib/config";
import {
  agentInstructions,
  claimWorkspaceFolder,
  createClientWorkspace,
} from "../lib/workspaces";
import { chooseProfile } from "./init";
import { formatProfileList } from "./switch";

function profile(name: string, organizationName: string): DescribedProfile {
  return {
    name,
    file: `/home/user/.pipeledger/profiles/${name}.json`,
    organizationId: "00000000-0000-4000-8000-00000000000a",
    organizationName,
    readable: true,
    isDefault: false,
  };
}

describe("pl init profile choice", () => {
  const riverside = profile("riverside-lumber-co", "Riverside Lumber Co.");
  const ledgerlabs = profile("ledgerlabs-inc", "LedgerLabs Inc.");

  it("uses the only saved profile without being told", () => {
    assert.equal(chooseProfile([riverside], undefined), riverside);
  });

  it("never guesses between several saved profiles", () => {
    assert.throws(
      () => chooseProfile([riverside, ledgerlabs], undefined),
      /Several credentials are saved.*riverside-lumber-co, ledgerlabs-inc/,
    );
  });

  it("sends a new user to pl login", () => {
    assert.throws(() => chooseProfile([], undefined), /Run `pl login` first/);
  });

  it("names the saved profiles when the requested one is missing", () => {
    assert.throws(
      () => chooseProfile([riverside], "ledgerlabs-inc"),
      /No saved profile is named "ledgerlabs-inc"\. Saved profiles: riverside-lumber-co\./,
    );
  });
});

describe("workspace starter instructions", () => {
  const text = agentInstructions({
    organizationName: "Riverside Lumber Co.",
    orgId: "00000000-0000-4000-8000-00000000000a",
    methodsFolder: "/home/user/Documents/PipeLedger/methods",
  });

  it("names the client and the methods folder the agent may read", () => {
    assert.match(text, /^# Riverside Lumber Co\.\n/);
    assert.match(text, /methods folder at `\/home\/user\/Documents\/PipeLedger\/methods`/);
    assert.match(text, /Do not access other clients' folders\./);
  });

  it("gives the agent the organization to expect and tells it to stop on any other", () => {
    assert.match(text, /Org ID `00000000-0000-4000-8000-00000000000a`/);
    assert.match(text, /If it reports anything\s+else, stop and tell me/);
  });

  it("does not forbid the methods folder it tells the agent to read", () => {
    assert.doesNotMatch(text, /outside this (folder|workspace)/i);
  });
});

describe("pl switch workspace folders", () => {
  it("shows the folders bound to a profile's organization beneath it", () => {
    const riverside = profile("riverside-lumber-co", "Riverside Lumber Co.");
    assert.equal(
      formatProfileList(
        [riverside],
        null,
        new Map([[riverside.organizationId!, ["/home/user/Documents/PipeLedger/clients/riverside-lumber-co"]]]),
      ),
      [
        "Saved profiles:",
        "  riverside-lumber-co  Riverside Lumber Co.",
        "                       folder: /home/user/Documents/PipeLedger/clients/riverside-lumber-co",
        "",
        "In use here: none",
      ].join("\n"),
    );
  });
});

it("creates, completes, lists, and protects client workspaces through the CLI", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "pl-init-"));
  const work = join(home, "work");
  mkdirSync(work);
  mkdirSync(join(home, "Documents"));
  const firstOrg = "00000000-0000-4000-8000-000000000001";
  const secondOrg = "00000000-0000-4000-8000-000000000002";
  const firstKey = `pl_live_${"a".repeat(40)}`;
  const secondKey = `pl_live_${"b".repeat(40)}`;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    const first = request.headers.authorization === `Bearer ${firstKey}`;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      org_id: first ? firstOrg : secondOrg,
      org_name: first ? "Riverside Lumber Co." : "LedgerLabs Inc.",
      label: "Test credential",
    }));
  });
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(home, { recursive: true, force: true }); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
  for (const key of Object.keys(env)) if (key.startsWith("PIPELEDGER_")) delete env[key];
  const entry = join(__dirname, "..", "index.ts");
  async function run(args: string[], options: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    const child = spawn(process.execPath, ["--import", require.resolve("tsx"), entry, ...args], {
      cwd: options.cwd ?? work, env: { ...env, ...options.env }, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.stdin.end(options.input ?? "");
    const [code] = await once(child, "close");
    assert.ok(!output.includes(firstKey) && !output.includes(secondKey), "never prints a credential");
    return { code, output };
  }

  const root = join(home, "Documents", "PipeLedger");
  const riverside = join(root, "clients", "riverside-lumber-co");
  const ledgerlabs = join(root, "clients", "ledgerlabs-inc");
  const registry = join(home, ".pipeledger", "workspaces.json");

  const loginArgs = ["login", "--stdin", "--api-url", apiUrl];
  assert.equal((await run(loginArgs, { input: firstKey })).code, 0);
  assert.equal((await run(loginArgs, { input: secondKey })).code, 0);

  // Several profiles and no name: stop, create nothing.
  const unnamed = await run(["init"]);
  assert.notEqual(unnamed.code, 0);
  assert.match(unnamed.output, /needs the profile to use/);
  assert.equal(existsSync(root), false);

  // Creating a workspace is local: no request leaves the computer.
  requests.length = 0;
  const created = await run(["init", "riverside-lumber-co"]);
  assert.equal(created.code, 0, created.output);
  assert.deepEqual(requests, []);
  assert.match(created.output, /Workspace ready\.\n {2}Organization: Riverside Lumber Co\.\n/);
  assert.ok(created.output.includes(riverside));
  assert.match(created.output, /Workspaces are kept in/);
  assert.deepEqual(readdirSync(riverside).sort(), [
    ".pipeledger.json", "AGENTS.md", "CLAUDE.md", "notes", "reference", "reports",
  ]);
  assert.deepEqual(readdirSync(join(root, "methods")).sort(), ["README.md", "procedures", "templates"]);
  assert.deepEqual(JSON.parse(readFileSync(join(riverside, ".pipeledger.json"), "utf-8")), {
    profile: "riverside-lumber-co",
    org_id: firstOrg,
  });
  assert.match(readFileSync(join(riverside, "CLAUDE.md"), "utf-8"), /^@AGENTS\.md$/m);
  // The workspace holds no credential.
  for (const name of ["AGENTS.md", "CLAUDE.md", ".pipeledger.json"]) {
    assert.ok(!readFileSync(join(riverside, name), "utf-8").includes("pl_live_"));
  }
  assert.deepEqual(JSON.parse(readFileSync(registry, "utf-8")), {
    version: 1,
    root,
    workspaces: [{ org_id: firstOrg, path: riverside }],
  });

  // The folder decides which books are read, whatever the default is.
  assert.equal((await run(["switch", "ledgerlabs-inc"])).code, 0);
  const identity = await run(["whoami"], { cwd: join(riverside, "reports") });
  assert.equal(identity.code, 0, identity.output);
  assert.match(identity.output, /Riverside Lumber Co\./);

  // A second run replaces nothing a person edited, and restores what is missing.
  writeFileSync(join(riverside, "AGENTS.md"), "my own instructions\n");
  const repeated = await run(["init", "riverside-lumber-co"]);
  assert.equal(repeated.code, 0, repeated.output);
  assert.match(repeated.output, /already complete\. Nothing was changed\./);
  assert.doesNotMatch(repeated.output, /Workspaces are kept in/);
  rmSync(join(riverside, "notes"), { recursive: true });
  const completed = await run(["init", "--profile", "riverside-lumber-co"]);
  assert.equal(completed.code, 0, completed.output);
  assert.match(completed.output, /Created: {6}notes\/\n/);
  assert.equal(readFileSync(join(riverside, "AGENTS.md"), "utf-8"), "my own instructions\n");

  // Another organization can never take over a client's folder.
  const takeover = await run(["init", "ledgerlabs-inc", "--folder", "riverside-lumber-co"]);
  assert.notEqual(takeover.code, 0);
  assert.match(takeover.output, /already linked to another organization/);
  assert.equal(JSON.parse(readFileSync(join(riverside, ".pipeledger.json"), "utf-8")).org_id, firstOrg);

  // Workspaces sit side by side, never one inside another.
  const nested = await run(["init", "ledgerlabs-inc", "--root", join(riverside, "reference")]);
  assert.notEqual(nested.code, 0);
  assert.match(nested.output, /cannot sit inside a linked folder/);
  assert.equal(existsSync(join(riverside, "reference", "clients")), false);

  const amongKeys = await run(["init", "ledgerlabs-inc", "--root", join(home, ".pipeledger", "work")]);
  assert.notEqual(amongKeys.code, 0);
  assert.match(amongKeys.output, /cannot be inside your PipeLedger configuration directory/);

  const ambient = await run(["init", "ledgerlabs-inc"], { env: { PIPELEDGER_CREDENTIAL_SECRET: secondKey } });
  assert.notEqual(ambient.code, 0);
  assert.equal(existsSync(ledgerlabs), false);

  // The remembered root is reused, and `pl switch` shows where each client is.
  assert.equal((await run(["init", "ledgerlabs-inc"])).code, 0);
  assert.ok(existsSync(join(ledgerlabs, "AGENTS.md")));
  const listed = await run(["switch"]);
  assert.ok(listed.output.includes(`folder: ${riverside}`));
  assert.ok(listed.output.includes(`folder: ${ledgerlabs}`));

  // Linking has one name. The earlier flag on `pl switch` is gone.
  assert.notEqual((await run(["switch", "ledgerlabs-inc", "--here"])).code, 0);

  // A folder linked by hand is listed too.
  const byHand = join(home, "elsewhere");
  mkdirSync(byHand);
  assert.equal((await run(["link", "ledgerlabs-inc"], { cwd: byHand })).code, 0);
  assert.ok((await run(["switch"])).output.includes(`folder: ${byHand}`));

  // The list only locates folders. One that moved is no longer shown, and
  // the moved folder still reads its own client's books.
  const moved = join(home, "moved-riverside");
  renameSync(riverside, moved);
  const afterMove = await run(["switch"]);
  assert.ok(!afterMove.output.includes(`folder: ${riverside}`));
  const movedIdentity = await run(["whoami"], { cwd: moved });
  assert.equal(movedIdentity.code, 0, movedIdentity.output);
  assert.match(movedIdentity.output, /Riverside Lumber Co\./);

  // A damaged list never blocks listing credentials, and init says how to fix it.
  writeFileSync(registry, "not json");
  assert.equal((await run(["switch"])).code, 0);
  const damaged = await run(["init", "riverside-lumber-co"]);
  assert.notEqual(damaged.code, 0);
  assert.match(damaged.output, /workspace list .* is not valid/);
});

describe("workspace creation guards", () => {
  const ORG_A = "00000000-0000-4000-8000-00000000000a";
  const ORG_B = "00000000-0000-4000-8000-00000000000b";

  /** A throwaway home folder, so nothing here can reach real credentials. */
  function withHome(t: TestContext): string {
    const home = mkdtempSync(join(tmpdir(), "pl-init-guards-"));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    t.after(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    });
    return home;
  }

  function workspace(root: string, orgId: string, organizationName: string) {
    return { root, folderName: "shared-name", profile: "some-profile", orgId, organizationName };
  }

  it("claims the folder before writing a client's instructions", (t) => {
    const root = join(withHome(t), "work");
    const folder = join(root, "clients", "shared-name");
    mkdirSync(folder, { recursive: true });
    // Another initializer binds the folder after this one looked at it.
    assert.equal(claimWorkspaceFolder(folder, { profile: "first", orgId: ORG_A }).claimed, true);
    assert.throws(
      () => claimWorkspaceFolder(folder, { profile: "second", orgId: ORG_B }),
      /already linked to another organization/,
    );
    assert.equal(JSON.parse(readFileSync(join(folder, ".pipeledger.json"), "utf-8")).org_id, ORG_A);
    // The same organization may come back; its marker is kept, not rewritten.
    const again = claimWorkspaceFolder(folder, { profile: "second", orgId: ORG_A });
    assert.equal(again.claimed, false);
    assert.equal(again.marker.profile, "first");
  });

  it("writes no instructions into a folder another organization holds", (t) => {
    const root = join(withHome(t), "work");
    createClientWorkspace(workspace(root, ORG_A, "Riverside Lumber Co."));
    const instructions = join(root, "clients", "shared-name", "AGENTS.md");
    rmSync(instructions);
    assert.throws(
      () => createClientWorkspace(workspace(root, ORG_B, "LedgerLabs Inc.")),
      /already linked to another organization/,
    );
    assert.equal(existsSync(instructions), false);
  });

  it("refuses a root that only looks outside the credential directory", (t) => {
    const home = withHome(t);
    mkdirSync(join(home, ".pipeledger", "inside"), { recursive: true });
    const alias = join(home, "alias");
    symlinkSync(join(home, ".pipeledger", "inside"), alias);
    assert.throws(
      () => createClientWorkspace(workspace(alias, ORG_A, "Riverside Lumber Co.")),
      /cannot be inside your PipeLedger configuration directory/,
    );
    assert.deepEqual(readdirSync(join(home, ".pipeledger", "inside")), []);
  });

  it("refuses a root that reaches a bound folder through a link", (t) => {
    const home = withHome(t);
    const created = createClientWorkspace(workspace(join(home, "work"), ORG_A, "Riverside Lumber Co."));
    const alias = join(home, "alias");
    symlinkSync(join(created.folder, "reference"), alias);
    assert.throws(
      () => createClientWorkspace(workspace(alias, ORG_B, "LedgerLabs Inc.")),
      /cannot sit inside a linked folder/,
    );
    assert.deepEqual(readdirSync(join(created.folder, "reference")), []);
  });

  it("does not call a workspace ready when its instructions cannot be a file", (t) => {
    const root = join(withHome(t), "work");
    const folder = join(root, "clients", "shared-name");
    mkdirSync(join(folder, "AGENTS.md"), { recursive: true });
    assert.throws(
      () => createClientWorkspace(workspace(root, ORG_A, "Riverside Lumber Co.")),
      /AGENTS\.md.* is not a file/,
    );
    assert.deepEqual(readdirSync(folder), ["AGENTS.md"]);
  });

  it("does not call a workspace ready when a link in it leads nowhere", (t) => {
    const root = join(withHome(t), "work");
    const folder = join(root, "clients", "shared-name");
    mkdirSync(folder, { recursive: true });
    symlinkSync(join(root, "missing"), join(folder, "CLAUDE.md"));
    assert.throws(
      () => createClientWorkspace(workspace(root, ORG_A, "Riverside Lumber Co.")),
      /CLAUDE\.md.* is not a file/,
    );
  });
});

it("never leaves one client's instructions in a folder bound to another", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "pl-init-overlap-"));
  mkdirSync(join(home, "work"));
  const orgs: Record<string, { id: string; name: string }> = {
    [`pl_live_${"a".repeat(40)}`]: { id: "00000000-0000-4000-8000-000000000001", name: "Riverside Lumber Co." },
    [`pl_live_${"b".repeat(40)}`]: { id: "00000000-0000-4000-8000-000000000002", name: "LedgerLabs Inc." },
  };
  const server = createServer((request, response) => {
    const org = orgs[(request.headers.authorization ?? "").replace("Bearer ", "")];
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ org_id: org.id, org_name: org.name, label: "Test credential" }));
  });
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(home, { recursive: true, force: true }); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
  for (const key of Object.keys(env)) if (key.startsWith("PIPELEDGER_")) delete env[key];
  const entry = join(__dirname, "..", "index.ts");
  async function run(args: string[], input = "") {
    const child = spawn(process.execPath, ["--import", require.resolve("tsx"), entry, ...args], {
      cwd: join(home, "work"), env, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.stdin.end(input);
    const [code] = await once(child, "close");
    return { code, output };
  }
  for (const key of Object.keys(orgs)) {
    assert.equal((await run(["login", "--stdin", "--api-url", `http://127.0.0.1:${address.port}`], key)).code, 0);
  }

  // Two initializers aim at one folder at the same moment. Whatever the
  // interleaving, the instructions and the binding name the same client.
  for (let round = 0; round < 4; round += 1) {
    const root = join(home, `round-${round}`);
    const results = await Promise.all([
      run(["init", "riverside-lumber-co", "--folder", "shared", "--root", root]),
      run(["init", "ledgerlabs-inc", "--folder", "shared", "--root", root]),
    ]);
    const folder = join(root, "clients", "shared");
    const bound = JSON.parse(readFileSync(join(folder, ".pipeledger.json"), "utf-8")).org_id;
    const owner = Object.values(orgs).find((org) => org.id === bound);
    assert.ok(owner, "the folder is bound to one of the two organizations");
    const instructions = readFileSync(join(folder, "AGENTS.md"), "utf-8");
    assert.ok(instructions.startsWith(`# ${owner.name}\n`), `round ${round}: instructions name ${owner.name}`);
    assert.ok(instructions.includes(bound), `round ${round}: instructions carry the bound organization ID`);
    assert.equal(results.filter((result) => result.code === 0).length, 1, `round ${round}: exactly one initializer succeeds`);
  }
});

describe("pl link profile choice", () => {
  it("names its own command when it cannot choose", () => {
    assert.throws(
      () => chooseProfile([profile("riverside-lumber-co", "Riverside Lumber Co."), profile("ledgerlabs-inc", "LedgerLabs Inc.")], undefined, "link"),
      /`pl link` needs the profile to use.*Example: `pl link riverside-lumber-co`/,
    );
    assert.throws(() => chooseProfile([], undefined, "link"), /then `pl link`/);
  });
});
