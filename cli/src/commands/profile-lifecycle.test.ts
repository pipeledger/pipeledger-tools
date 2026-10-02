import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

it("runs login, client isolation, replacement refusal, and logout through the CLI", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pl-profile-lifecycle-"));
  const work = join(root, "work");
  mkdirSync(work);
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
      org_name: first ? "First Client" : "Second Client",
      label: "Test credential",
    }));
  });
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(root, { recursive: true, force: true }); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, ".config") };
  for (const key of Object.keys(env)) if (key.startsWith("PIPELEDGER_")) delete env[key];
  const entry = join(__dirname, "..", "index.ts");
  async function run(args: string[], input = "", overrides: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, ["--import", require.resolve("tsx"), entry, ...args], {
      cwd: work, env: { ...env, ...overrides }, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.stdin.end(input);
    const [code] = await once(child, "close");
    assert.ok(!output.includes(firstKey) && !output.includes(secondKey), "never prints a credential");
    return { code, output };
  }
  const loginArgs = ["login", "--stdin", "--api-url", apiUrl];
  assert.equal((await run(loginArgs, firstKey)).code, 0);
  assert.equal((await run(loginArgs, secondKey)).code, 0);
  const profileFile = join(root, ".pipeledger", "profiles", "first-client.json");
  const original = readFileSync(profileFile, "utf-8");
  const replacement = await run([...loginArgs, "--profile", "first-client"], secondKey);
  assert.notEqual(replacement.code, 0);
  assert.match(replacement.output, /Nothing was saved/);
  assert.equal(readFileSync(profileFile, "utf-8"), original);

  writeFileSync(join(root, ".pipeledger", "default-profile"), "");
  assert.equal((await run(["switch", "first-client"])).code, 0);
  const environmentIdentity = await run(["whoami"], "", {
    PIPELEDGER_CREDENTIAL_SECRET: secondKey, PIPELEDGER_API_URL: apiUrl,
  });
  assert.equal(environmentIdentity.code, 0);
  assert.match(environmentIdentity.output, /none \(environment credential\)/);
  assert.equal((await run(["link", "first-client"])).code, 0);
  const identity = await run(["whoami"]);
  assert.equal(identity.code, 0);
  assert.match(identity.output, /First Client/);

  requests.length = 0;
  const conflict = await run(["whoami", "--profile", "first-client"], "", { PIPELEDGER_CREDENTIAL_SECRET: secondKey });
  assert.notEqual(conflict.code, 0);
  assert.deepEqual(requests, []);

  const tampered = { ...JSON.parse(original), credential_secret: secondKey };
  writeFileSync(profileFile, JSON.stringify(tampered), { mode: 0o600 });
  const wrongClient = await run(["published-status", "--format", "json"]);
  assert.notEqual(wrongClient.code, 0);
  assert.match(wrongClient.output, /authenticated organization/);
  assert.deepEqual(requests, ["/api/v1/auth/validate"]);
  writeFileSync(profileFile, original, { mode: 0o600 });

  assert.equal((await run(["logout"])).code, 0);
  requests.length = 0;
  assert.notEqual((await run(["whoami"])).code, 0);
  assert.deepEqual(requests, []);
});
