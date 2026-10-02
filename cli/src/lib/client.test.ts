import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiClient, ApiClientError } from "./client";
import { formatCliError } from "./cli-error";
import { LocalCliError } from "./local-error";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ApiClient", () => {
  it("maps a fetch rejection to the fixed customer-safe network error", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed SECRET_NETWORK_SENTINEL");
    };
    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(client.get("/api/v1/query"), (error: unknown) => {
      assert.ok(error instanceof LocalCliError);
      assert.equal(error.code, "E_CLI_NETWORK");
      assert.doesNotMatch(error.message, /SECRET_NETWORK_SENTINEL|fetch failed/);
      return true;
    });
  });

  it("preserves RFC Problem Details as a structured ApiClientError", async () => {
    const problem = {
      type: "urn:pipeledger:problem:dependency-unavailable",
      title: "Service temporarily unavailable",
      status: 503,
      detail: "A service required for this operation is temporarily unavailable. Try again later.",
      instance:
        "urn:pipeledger:request:11111111-1111-4111-8111-111111111111",
      code: "E_DEPENDENCY_UNAVAILABLE",
      correlation_id: "11111111-1111-4111-8111-111111111111",
      fault_domain: "platform",
      recovery: "retry",
      retryable: true,
      retry_after_seconds: 15,
    } as const;
    globalThis.fetch = async () =>
      new Response(JSON.stringify(problem), {
        status: 503,
        headers: { "content-type": "application/problem+json" },
      });
    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(client.get("/api/v1/query"), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.deepEqual(error.toJSON(), problem);
      assert.equal(error.recovery, "retry");
      assert.equal(error.retryAfterSeconds, 15);
      return true;
    });
  });

  it("rejects schema-valid problems outside the reviewed catalog contract", async () => {
    const bodyCorrelationId = "22222222-2222-4222-8222-222222222222";
    const headerCorrelationId = "77777777-7777-4777-8777-777777777777";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          type: "urn:pipeledger:problem:riverside-lumber",
          title: "SECRET_TITLE_SENTINEL",
          status: 503,
          detail: "SECRET_DETAIL_SENTINEL",
          instance: `urn:pipeledger:request:${bodyCorrelationId}`,
          code: "E_RIVERSIDE_LUMBER",
          correlation_id: bodyCorrelationId,
          fault_domain: "platform",
          recovery: "retry",
          retryable: true,
        }),
        {
          status: 503,
          headers: { "x-correlation-id": headerCorrelationId },
        },
      );

    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(client.get("/api/v1/query"), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "E_DEPENDENCY_UNAVAILABLE");
      assert.equal(error.correlationId, headerCorrelationId);
      assert.equal(
        error.customerDetail,
        "A service required for this operation is temporarily unavailable. Try again later.",
      );
      assert.doesNotMatch(
        `${error.message}\n${formatCliError(error, "json")}`,
        /RIVERSIDE_LUMBER|SECRET_TITLE|SECRET_DETAIL|22222222/,
      );
      return true;
    });
  });

  it("rejects disallowed context and mismatched response correlation", async () => {
    const bodyCorrelationId = "88888888-8888-4888-8888-888888888888";
    const headerCorrelationId = "99999999-9999-4999-8999-999999999999";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          type: "urn:pipeledger:problem:dependency-unavailable",
          title: "Service temporarily unavailable",
          status: 503,
          detail: "UNREVIEWED_DETAIL_SENTINEL",
          instance: `urn:pipeledger:request:${bodyCorrelationId}`,
          code: "E_DEPENDENCY_UNAVAILABLE",
          correlation_id: bodyCorrelationId,
          fault_domain: "platform",
          recovery: "retry",
          retryable: true,
          safe_context: { raw_sql: "UNREVIEWED_SQL_SENTINEL" },
        }),
        {
          status: 503,
          headers: { "x-correlation-id": headerCorrelationId },
        },
      );

    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(client.get("/api/v1/query"), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.code, "E_DEPENDENCY_UNAVAILABLE");
      assert.equal(error.correlationId, headerCorrelationId);
      const rendered = `${formatCliError(error, "table")}\n${formatCliError(error, "json")}`;
      assert.doesNotMatch(
        rendered,
        /UNREVIEWED_DETAIL|UNREVIEWED_SQL|88888888|raw_sql/,
      );
      return true;
    });
  });

  it("replaces an unreviewed legacy body with the fixed status policy", async () => {
    const headerCorrelationId = "33333333-3333-4333-8333-333333333333";
    const bodyCorrelationId = "44444444-4444-4444-8444-444444444444";
    const sentinels = [
      "SECRET_DETAIL_SENTINEL",
      "SECRET_ERROR_SENTINEL",
      "SECRET_TITLE_SENTINEL",
      "E_UNREVIEWED_SENTINEL",
      bodyCorrelationId,
      "SECRET_REMEDIATION_SENTINEL",
      "SECRET_CONTEXT_SENTINEL",
    ];
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: "SECRET_DETAIL_SENTINEL",
          error: "SECRET_ERROR_SENTINEL",
          title: "SECRET_TITLE_SENTINEL",
          code: "E_UNREVIEWED_SENTINEL",
          correlation_id: bodyCorrelationId,
          remediation: "SECRET_REMEDIATION_SENTINEL",
          recovery: "request_access",
          retryable: false,
          retry_after_seconds: 7_777,
          safe_context: { provider_response: "SECRET_CONTEXT_SENTINEL" },
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/json",
            "x-correlation-id": headerCorrelationId,
            "retry-after": "17",
          },
        }
      );

    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(
      client.post("/api/v1/query", { mart: "gl_lines" }),
      (error: unknown) => {
        assert.ok(error instanceof ApiClientError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, "E_DEPENDENCY_UNAVAILABLE");
        assert.equal(error.correlationId, headerCorrelationId);
        assert.equal(error.remediation, undefined);
        assert.equal(error.retryable, true);
        assert.equal(error.recovery, "retry");
        assert.equal(error.retryAfterSeconds, 17);
        assert.equal(
          error.customerDetail,
          "A service required for this operation is temporarily unavailable. Try again later.",
        );

        const renderedTable = formatCliError(error, "table");
        const renderedJson = formatCliError(error, "json");
        assert.match(renderedTable, /Code: E_DEPENDENCY_UNAVAILABLE/);
        assert.match(
          renderedTable,
          new RegExp(`Reference: ${headerCorrelationId}`),
        );
        assert.match(renderedTable, /Next step: Try the command again\./);
        assert.match(renderedTable, /Retry after: 17 seconds/);
        for (const sentinel of sentinels) {
          assert.equal(error.message.includes(sentinel), false);
          assert.equal(renderedTable.includes(sentinel), false);
          assert.equal(renderedJson.includes(sentinel), false);
        }
        return true;
      }
    );
  });

  it("uses a valid response-header correlation ID when the body is unreviewed", async () => {
    const correlationId = "55555555-5555-4555-8555-555555555555";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId,
        },
      });

    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(
      client.get("/api/v1/published-status"),
      (error: unknown) => {
        assert.ok(error instanceof ApiClientError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.correlationId, correlationId);
        assert.equal(
          error.customerDetail.includes("Service unavailable"),
          false,
        );
        return true;
      }
    );
  });

  it("maps an unreviewed HTTP 402 response to the governed usage-limit problem", async () => {
    const correlationId = "88888888-8888-4888-8888-888888888888";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "SECRET_PROVIDER_BILLING_DETAIL",
          code: "usage_billing_blocked",
        }),
        {
          status: 402,
          headers: { "x-correlation-id": correlationId },
        },
      );

    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(client.get("/api/v1/query"), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.statusCode, 402);
      assert.equal(error.code, "E_USAGE_BILLING_LIMIT_REACHED");
      assert.equal(error.correlationId, correlationId);
      assert.equal(
        error.customerDetail,
        "The organization's usage limit was reached. Add prepaid credits, upgrade the plan, or contact billing to continue.",
      );
      assert.doesNotMatch(
        `${error.message}\n${formatCliError(error, "json")}`,
        /SECRET_PROVIDER_BILLING_DETAIL|usage_billing_blocked/,
      );
      return true;
    });
  });

  it("rejects malformed correlation and retry headers on an unreviewed body", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: "SECRET_BODY_DETAIL",
          correlation_id: "66666666-6666-4666-8666-666666666666",
          retry_after_seconds: 42,
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json",
            "x-correlation-id": "../../SECRET_HEADER_REFERENCE",
            "retry-after": "42",
          },
        },
      );

    const client = new ApiClient({
      api_url: "https://app.pipeledger.ai",
      credential_secret: `pl_live_${"a".repeat(32)}`,
      org_id: "00000000-0000-4000-8000-000000000002",
      org_name: "Riverside Lumber",
    });

    await assert.rejects(client.get("/api/v1/query"), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "E_INVALID_INPUT");
      assert.equal(error.correlationId, undefined);
      assert.equal(error.retryAfterSeconds, undefined);
      const rendered = formatCliError(error, "table");
      assert.doesNotMatch(
        rendered,
        /SECRET_BODY_DETAIL|66666666|SECRET_HEADER_REFERENCE|Retry after/,
      );
      return true;
    });
  });
});


describe("authenticated organization guard", () => {
  const expectedOrg = "00000000-0000-4000-8000-000000000002";
  const config = {
    api_url: "https://app.pipeledger.ai",
    credential_secret: `pl_live_${"a".repeat(32)}`,
    org_id: expectedOrg,
  };

  for (const mode of ["get", "post", "patch", "stream"] as const) {
    it(`blocks ${mode} before any financial call when the key authenticates to another organization`, async () => {
      const paths: string[] = [];
      globalThis.fetch = async (input) => {
        paths.push(String(input));
        return Response.json({ org_id: "00000000-0000-4000-8000-000000000003" });
      };
      await assert.rejects(new ApiClient(config)[mode]("/api/v1/financial-operation"), /authenticated organization does not match/);
      assert.deepEqual(paths, ["https://app.pipeledger.ai/api/v1/auth/validate"]);
    });
  }

  it("shares a single identity check across concurrent calls and pins the credential", async () => {
    const paths: string[] = [];
    const mutable = { ...config };
    const client = new ApiClient(mutable);
    mutable.credential_secret = "CHANGED_SENTINEL";
    globalThis.fetch = async (input, init) => {
      paths.push(String(input));
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${config.credential_secret}`);
      assert.equal(init?.redirect, "error");
      return Response.json({ org_id: expectedOrg });
    };
    await Promise.all([client.get("/one"), client.post("/two"), client.patch("/three"), client.stream("/four")]);
    assert.equal(paths.filter((path) => path.endsWith("/auth/validate")).length, 1);
    assert.equal(paths.length, 5);
  });

  it("does not accept an absent authenticated organization or retry a financial write", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({}); };
    const client = new ApiClient(config);
    await assert.rejects(client.post("/write"), /authenticated organization/);
    await assert.rejects(client.post("/write"), /authenticated organization/);
    assert.equal(calls, 1);
  });

  it("checks whoami itself without recursively calling it", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ org_id: "another" }); };
    await assert.rejects(new ApiClient(config).post("/api/v1/auth/validate", {}), /authenticated organization/);
    assert.equal(calls, 1);
  });
});
