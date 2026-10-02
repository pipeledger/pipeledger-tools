import { QUERY_TEXT_FILTER_MAX_LENGTH } from "shared/src/public-client";
import { LocalCliError } from "./local-error";
import { QUERYABLE_MART_NAMES } from "./vocabulary";

type CliFilterValue =
  | string
  | number
  | boolean
  | { in: Array<string | number> }
  | { gte: string | number }
  | { lt: string | number }
  | { gte: string | number; lt: string | number }
  | { like: string }
  | { contains_ci: string };

export interface QueryRequestBody {
  /** Sent as typed; the service owns the list of queryable marts. */
  mart: string;
  filters?: Record<string, CliFilterValue>;
  select?: string[];
  statement_type?: "income_statement" | "balance_sheet" | "all";
  time_bucket?: string;
  metrics?: string[];
  group_by?: string[];
  order_by?: string;
  order_direction?: "ASC" | "DESC";
  limit?: number;
  offset: number;
}

export function normalizeQueryMart(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Help text only; see lib/vocabulary.ts. */
export function queryableMartList(): string {
  return QUERYABLE_MART_NAMES.join(", ");
}

export function parseSelectArgs(values: string[] | undefined): string[] | undefined {
  const columns = splitCommaArgs(values);
  return columns.length > 0 ? [...new Set(columns)] : undefined;
}

export function parseFilterArgs(
  values: string[] | undefined
): Record<string, CliFilterValue> {
  const filters: Record<string, CliFilterValue> = {};
  for (const raw of values ?? []) {
    const eq = raw.indexOf("=");
    if (eq === -1) {
      throw new LocalCliError(
        `Invalid filter "${raw}". Use key=value format.`,
        "E_CLI_INPUT",
      );
    }

    const rawKey = raw.slice(0, eq).trim();
    const rawValue = raw.slice(eq + 1).trim();
    if (!rawKey) {
      throw new LocalCliError(
        `Invalid filter "${raw}". Filter key is empty.`,
        "E_CLI_INPUT",
      );
    }

    const operatorMatch = /^(.+)\.(gte|lt|in|like|contains_ci)$/.exec(rawKey);
    if (!operatorMatch) {
      filters[rawKey] = parseScalar(rawValue);
      continue;
    }

    const [, column, operator] = operatorMatch;
    if (!column) {
      throw new LocalCliError(
        `Invalid filter "${raw}". Filter column is empty.`,
        "E_CLI_INPUT",
      );
    }

    if (operator === "in") {
      const items = rawValue
        .split(",")
        .map((item) => parseInScalar(item.trim()));
      if (items.length === 0) {
        throw new LocalCliError(
          `Invalid filter "${raw}". .in requires at least one value.`,
          "E_CLI_INPUT",
        );
      }
      filters[column] = { in: items };
      continue;
    }

    if (operator === "like" || operator === "contains_ci") {
      if (
        operator === "contains_ci" &&
        (rawValue.length === 0 ||
          rawValue.length > QUERY_TEXT_FILTER_MAX_LENGTH)
      ) {
        throw new LocalCliError(
          `Invalid filter "${raw}". .contains_ci requires 1 through ${QUERY_TEXT_FILTER_MAX_LENGTH} characters.`,
          "E_CLI_INPUT",
        );
      }
      if (
        operator === "like" &&
        rawValue.length > QUERY_TEXT_FILTER_MAX_LENGTH
      ) {
        throw new LocalCliError(
          `Invalid filter "${raw}". .like requires at most ${QUERY_TEXT_FILTER_MAX_LENGTH} characters.`,
          "E_CLI_INPUT",
        );
      }
      filters[column] = { [operator]: rawValue } as CliFilterValue;
      continue;
    }

    const value = parseRangeScalar(rawValue);
    const existing = filters[column];
    if (
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      ("gte" in existing || "lt" in existing)
    ) {
      filters[column] = { ...existing, [operator]: value } as CliFilterValue;
    } else {
      filters[column] = { [operator]: value } as CliFilterValue;
    }
  }
  return filters;
}

export function buildQueryRequestBody(args: {
  mart: string;
  filters?: string[];
  select?: string[];
  statementType?: string;
  timeBucket?: string;
  metrics?: string[];
  groupBy?: string[];
  orderBy?: string;
  orderDirection?: string;
  limit?: number;
  offset: number;
}): QueryRequestBody {
  const mart = normalizeQueryMart(args.mart);
  if (!mart) {
    throw new LocalCliError(
      `A mart name is required, for example: ${queryableMartList()}`,
      "E_CLI_INPUT",
    );
  }

  const statementType = normalizeStatementType(args.statementType);
  const filters = parseFilterArgs(args.filters);
  const select = parseSelectArgs(args.select);
  const metrics = parseMetricArgs(args.metrics);
  const groupBy = parseSelectArgs(args.groupBy);
  const orderDirection = normalizeOrderDirection(args.orderDirection);

  return {
    mart,
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(select ? { select } : {}),
    ...(statementType ? { statement_type: statementType } : {}),
    ...(args.timeBucket ? { time_bucket: args.timeBucket } : {}),
    ...(metrics ? { metrics } : {}),
    ...(groupBy ? { group_by: groupBy } : {}),
    ...(args.orderBy ? { order_by: args.orderBy } : {}),
    ...(orderDirection ? { order_direction: orderDirection } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    offset: args.offset,
  };
}

function parseMetricArgs(values: string[] | undefined): string[] | undefined {
  return parseSelectArgs(values);
}

function normalizeStatementType(
  value: string | undefined
): QueryRequestBody["statement_type"] | undefined {
  if (!value) return undefined;
  if (
    value === "income_statement" ||
    value === "balance_sheet" ||
    value === "all"
  ) {
    return value;
  }
  throw new LocalCliError(
    `Invalid statement type "${value}". Use income_statement, balance_sheet, or all.`,
    "E_CLI_INPUT",
  );
}

function normalizeOrderDirection(
  value: string | undefined
): QueryRequestBody["order_direction"] | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase();
  if (normalized === "ASC" || normalized === "DESC") {
    return normalized;
  }
  throw new LocalCliError(
    `Invalid order direction "${value}". Use ASC or DESC.`,
    "E_CLI_INPUT",
  );
}

function splitCommaArgs(values: string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseScalar(value: string): string | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function parseRangeScalar(value: string): string | number {
  if (/^-?\d+(?:\.\d+)?$/.test(value) && !/^0\d/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseInScalar(value: string): string | number {
  return parseRangeScalar(value);
}
