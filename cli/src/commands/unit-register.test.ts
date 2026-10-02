import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

test("period discovery renders open, locked, empty and JSON responses through REST", async (t) => {
  const requests: string[] = [];
  let payload: Record<string, unknown> = { locked_periods: [] };
  const server = createServer((request, response) => {
    requests.push(request.url!);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload));
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  async function run(...args: string[]) {
    const child = spawn(process.execPath, ["--import", require.resolve("tsx"),
      join(__dirname, "..", "index.ts"), "unit-register", "periods", ...args], {
      env: {
        ...process.env,
        PIPELEDGER_CREDENTIAL_SECRET: `pl_live_${"a".repeat(40)}`,
        PIPELEDGER_API_URL: apiUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { errors += chunk; });
    const [code] = await once(child, "close");
    assert.equal(code, 0, errors);
    return output;
  }
  assert.match(await run(), /No unit posting periods are locked/);
  payload = { period_status: { posting_period: "2026-09", locked: false, locked_at: null } };
  assert.match(await run("--posting-period", "2026-09"), /2026-09  open/);
  assert.equal(requests.at(-1), "/api/v1/unit-register/metrics?action=get_period_status&posting_period=2026-09");
  payload = { locked_periods: [{ posting_period: "2026-08", locked: true, locked_at: "2026-09-01T00:00:00Z" }] };
  assert.match(await run(), /2026-08  LOCKED  locked at 2026-09-01/);
  assert.deepEqual(JSON.parse(await run("--json")), payload);
});

test("voucher dry run reports authorization separately and never sends a real post", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "unit-validation-"));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const file = join(dir,"voucher.json");
  await writeFile(file,JSON.stringify({voucher_date:"2026-09-30",posting_period:"2026-09",voucher_type:"activity",source_ref:"test",entries:[{metric_key:"token_usage",movement_type:"usage",quantity_signed:1,unit_of_measure:"token"}]}));
  let posted: Record<string,unknown> | undefined;
  let requestPath = "";
  const server = createServer(async (request,response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    posted = JSON.parse(body);
    requestPath = request.url!;
    response.setHeader("Content-Type","application/json");
    response.end(JSON.stringify({summary:"Voucher validation passed. Nothing was posted. Posting permission is not satisfied.",validation:{valid:true,posting_eligibility:{allowed:false},violations:[]}}));
  });
  t.after(() => {server.closeAllConnections();server.close();});
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const child = spawn(process.execPath,["--import",require.resolve("tsx"),join(__dirname,"..","index.ts"),"unit-register","post","--file",file,"--validate-only"],{
    env:{...process.env,PIPELEDGER_CREDENTIAL_SECRET:`pl_live_${"a".repeat(40)}`,PIPELEDGER_API_URL:`http://127.0.0.1:${address.port}`},stdio:["ignore","pipe","pipe"],
  });
  let output = "";
  child.stdout.on("data", c => {output += c;});
  child.stderr.on("data", c => {output += c;});
  const [code] = await once(child,"close");
  assert.equal(code,0);
  assert.match(output,/Voucher validation passed/);
  assert.match(output,/Posting permission is not satisfied/);
  assert.match(output,/Nothing was posted/);
  assert.equal("validate_only" in posted!, false);
  assert.equal(requestPath, "/api/v1/unit-register/vouchers/validate");
});
