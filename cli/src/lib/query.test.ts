import assert from "node:assert/strict";
import test from "node:test";
import { QUERY_TEXT_FILTER_MAX_LENGTH } from "shared/src/public-client";

import {
  buildQueryRequestBody,
  normalizeQueryMart,
  parseFilterArgs,
  parseSelectArgs,
} from "./query";

test("normalizeQueryMart trims and leaves the mart list to the service", () => {
  assert.equal(normalizeQueryMart("gl_lines"), "gl_lines");
  assert.equal(normalizeQueryMart("  trial_balance "), "trial_balance");
  // An installed CLI may predate a mart the service accepts, so an unknown
  // name is sent as typed and refused by the service, not here.
  assert.equal(normalizeQueryMart("mart_gl_lines"), "mart_gl_lines");
  assert.equal(normalizeQueryMart("   "), null);
});

test("parseSelectArgs supports repeated and comma-separated values", () => {
  assert.deepEqual(parseSelectArgs(["gl_line_id,account_name", "memo"]), [
    "gl_line_id",
    "account_name",
    "memo",
  ]);
});

test("parseFilterArgs supports scalar and typed operator filters", () => {
  assert.deepEqual(
    parseFilterArgs([
      "account_number=4350",
      "transaction_date.gte=2026-01-01",
      "transaction_date.lt=2026-04-01",
      "amount.gte=100",
      "account_type.in=Income,Other Income",
      "memo.like=%Stripe%",
      "item_name.contains_ci=Subsea Maintenance",
      "is_manual_backfill=false",
    ]),
    {
      account_number: "4350",
      transaction_date: { gte: "2026-01-01", lt: "2026-04-01" },
      amount: { gte: 100 },
      account_type: { in: ["Income", "Other Income"] },
      memo: { like: "%Stripe%" },
      item_name: { contains_ci: "Subsea Maintenance" },
      is_manual_backfill: false,
    }
  );
});

test("parseFilterArgs rejects invalid case-insensitive contains filters", () => {
  for (const value of [
    "",
    "x".repeat(QUERY_TEXT_FILTER_MAX_LENGTH + 1),
  ]) {
    assert.throws(
      () => parseFilterArgs([`memo.contains_ci=${value}`]),
      /\.contains_ci requires 1 through 200 characters/
    );
  }
});

test("parseFilterArgs rejects oversized like filters", () => {
  assert.throws(
    () =>
      parseFilterArgs([
        `memo.like=${"x".repeat(QUERY_TEXT_FILTER_MAX_LENGTH + 1)}`,
      ]),
    /\.like requires at most 200 characters/
  );
});

test("buildQueryRequestBody emits the REST row-query envelope", () => {
  assert.deepEqual(
    buildQueryRequestBody({
      mart: "gl_lines",
      filters: ["fiscal_year=2026"],
      select: ["gl_line_id,reporting_amount"],
      statementType: "income_statement",
      timeBucket: "ytd",
      limit: 25,
      offset: 10,
    }),
    {
      mart: "gl_lines",
      filters: { fiscal_year: "2026" },
      select: ["gl_line_id", "reporting_amount"],
      statement_type: "income_statement",
      time_bucket: "ytd",
      limit: 25,
      offset: 10,
    }
  );
});

test("buildQueryRequestBody emits the REST aggregation envelope", () => {
  assert.deepEqual(
    buildQueryRequestBody({
      mart: "gl_lines",
      filters: ["fiscal_year=2026"],
      metrics: ["revenue,gross_profit", "net_income"],
      groupBy: ["calendar_month_key", "department_leaf"],
      orderBy: "calendar_month_key",
      orderDirection: "desc",
      timeBucket: "ytd",
      limit: 50,
      offset: 0,
    }),
    {
      mart: "gl_lines",
      filters: { fiscal_year: "2026" },
      time_bucket: "ytd",
      metrics: ["revenue", "gross_profit", "net_income"],
      group_by: ["calendar_month_key", "department_leaf"],
      order_by: "calendar_month_key",
      order_direction: "DESC",
      limit: 50,
      offset: 0,
    }
  );
});
