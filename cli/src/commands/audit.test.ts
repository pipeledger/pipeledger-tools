import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiClientError } from "../lib/client";
import { LocalCliError } from "../lib/local-error";
import { parseAuditEvent, tailAuditEvents, type AuditEvent } from "./audit";

const CURSOR_ONE = "audit_cursor_one";
const CURSOR_TWO = "audit_cursor_two";

function auditStream(event: AuditEvent): Response {
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("parseAuditEvent", () => {
  it("accepts the customer-safe audit projection", () => {
    assert.deepEqual(
      parseAuditEvent({
        cursor: CURSOR_ONE,
        timestamp: "2026-08-05T12:00:00.000Z",
        action: "transform_complete",
        resource_type: "Pipeline run",
        record_count: 42,
        details: { provider_error: "PROTECTED_PROVIDER_ERROR" },
        entity_id: "PROTECTED_ENTITY_ID",
      }),
      {
        cursor: CURSOR_ONE,
        timestamp: "2026-08-05T12:00:00.000Z",
        action: "transform_complete",
        resource_type: "Pipeline run",
      },
    );
  });

  it("fails loudly on malformed stream events", () => {
    assert.throws(
      () => parseAuditEvent({ action: "transform_complete" }),
      (error: unknown) =>
        error instanceof LocalCliError &&
        error.code === "E_CLI_NETWORK" &&
        /invalid event/i.test(error.message),
    );
  });
});

describe("tailAuditEvents", () => {
  it("reconnects after a fetch-style local network failure", async () => {
    const controller = new AbortController();
    const events: AuditEvent[] = [];
    const statuses: string[] = [];
    const delays: number[] = [];
    let calls = 0;

    await tailAuditEvents(
      {
        async stream() {
          calls += 1;
          if (calls === 1) {
            throw new LocalCliError(
              "SECRET_FETCH_FAILURE",
              "E_CLI_NETWORK",
            );
          }
          return auditStream({
            cursor: CURSOR_ONE,
            timestamp: "2026-08-05T12:00:00.000Z",
            action: "transform_complete",
            resource_type: "Pipeline run",
          });
        },
      },
      { limit: 100, format: "json" },
      {
        signal: controller.signal,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
        onEvent: (event) => {
          events.push(event);
          controller.abort();
        },
        writeStatus: (message) => {
          statuses.push(message);
        },
      },
    );

    assert.equal(calls, 2);
    assert.deepEqual(delays, [5000]);
    assert.equal(events.length, 1);
    assert.doesNotMatch(statuses.join(""), /SECRET_FETCH_FAILURE/);
    assert.match(statuses.join(""), /connection lost; reconnecting/i);
  });

  it("preserves a composite SSE cursor across same-timestamp close and retryable HTTP reconnects", async () => {
    const controller = new AbortController();
    const firstTimestamp = "2026-08-05T12:00:00.000Z";
    const paths: string[] = [];
    const events: AuditEvent[] = [];
    const delays: number[] = [];
    const statuses: string[] = [];

    await tailAuditEvents(
      {
        async stream(path) {
          paths.push(path);
          if (paths.length === 1) {
            return auditStream({
              cursor: CURSOR_ONE,
              timestamp: firstTimestamp,
              action: "transform_complete",
              resource_type: "Pipeline run",
            });
          }
          if (paths.length === 2) {
            throw new ApiClientError(
              "SECRET_UPSTREAM_FAILURE",
              429,
              "E_RATE_LIMITED",
              "11111111-1111-4111-8111-111111111111",
              undefined,
              true,
              undefined,
              "wait",
              2,
            );
          }
          return auditStream({
            cursor: CURSOR_TWO,
            timestamp: firstTimestamp,
            action: "report_delivered",
            resource_type: "Report",
          });
        },
      },
      { actions: "transform_complete", limit: 100, format: "table" },
      {
        signal: controller.signal,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
        onEvent: (event) => {
          events.push(event);
          if (events.length === 2) controller.abort();
        },
        writeStatus: (message) => {
          statuses.push(message);
        },
      },
    );

    assert.equal(paths.length, 3);
    const encodedCursor = `cursor=${encodeURIComponent(CURSOR_ONE)}`;
    assert.match(paths[1] ?? "", new RegExp(encodedCursor));
    assert.match(paths[2] ?? "", new RegExp(encodedCursor));
    assert.deepEqual(delays, [1000, 2000]);
    assert.deepEqual(events.map((event) => event.action), [
      "transform_complete",
      "report_delivered",
    ]);
    assert.doesNotMatch(statuses.join(""), /SECRET_UPSTREAM_FAILURE|11111111/);
  });

  it("reconnects after a reviewed retryable SSE dependency problem", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let calls = 0;

    await tailAuditEvents(
      {
        async stream() {
          calls += 1;
          if (calls === 1) {
            const problem = {
              type: "urn:pipeledger:problem:dependency-unavailable",
              title: "Service temporarily unavailable",
              status: 503,
              detail:
                "A service required for this operation is temporarily unavailable. Try again later.",
              instance:
                "urn:pipeledger:request:33333333-3333-4333-8333-333333333333",
              code: "E_DEPENDENCY_UNAVAILABLE",
              correlation_id: "33333333-3333-4333-8333-333333333333",
              fault_domain: "platform",
              recovery: "retry",
              retryable: true,
              retry_after_seconds: 3,
            };
            return new Response(
              `event: error\ndata: ${JSON.stringify(problem)}\n\n`,
              { headers: { "content-type": "text/event-stream" } },
            );
          }
          return auditStream({
            cursor: CURSOR_ONE,
            timestamp: "2026-08-05T12:00:00.000Z",
            action: "transform_complete",
            resource_type: "Pipeline run",
          });
        },
      },
      { limit: 100, format: "json" },
      {
        signal: controller.signal,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
        onEvent: () => controller.abort(),
        writeStatus: () => undefined,
      },
    );

    assert.equal(calls, 2);
    assert.deepEqual(delays, [3000]);
  });

  it("does not reconnect a reviewed non-retryable API problem", async () => {
    const terminal = new ApiClientError(
      "A fixed internal failure.",
      500,
      "E_INTERNAL",
      "44444444-4444-4444-8444-444444444444",
      undefined,
      false,
      undefined,
      "contact_support",
    );
    let calls = 0;

    await assert.rejects(
      tailAuditEvents(
        {
          async stream() {
            calls += 1;
            throw terminal;
          },
        },
        { limit: 100, format: "table" },
        { sleep: async () => assert.fail("terminal errors must not retry") },
      ),
      (error: unknown) => error === terminal,
    );
    assert.equal(calls, 1);
  });

  it("does not hide a programming TypeError behind network retries", async () => {
    const defect = new TypeError("unexpected stream parser defect");
    let calls = 0;

    await assert.rejects(
      tailAuditEvents(
        {
          async stream() {
            calls += 1;
            throw defect;
          },
        },
        { limit: 100, format: "table" },
        { sleep: async () => assert.fail("programming defects must not retry") },
      ),
      (error: unknown) => error === defect,
    );
    assert.equal(calls, 1);
  });

  it("rejects invalid cursors as reviewed CLI input errors", async () => {
    await assert.rejects(
      tailAuditEvents(
        { async stream() { return new Response(); } },
        { since: "yesterday", limit: 100, format: "table" },
      ),
      (error: unknown) =>
        error instanceof LocalCliError && error.code === "E_CLI_INPUT",
    );
  });
});
