/**
 * Output formatting utilities for CLI responses.
 */

import { InvalidArgumentError } from "commander";

export type OutputFormat = "json" | "table" | "csv";
export type JsonOrTableFormat = Exclude<OutputFormat, "csv">;

export function parseOutputFormat(value: string): OutputFormat {
  if (value === "json" || value === "table" || value === "csv") {
    return value;
  }
  throw new InvalidArgumentError(
    `Invalid output format "${value}". Valid: json, table, csv.`,
  );
}

export function parseJsonOrTableFormat(value: string): JsonOrTableFormat {
  if (value === "json" || value === "table") return value;
  throw new InvalidArgumentError(
    `Invalid output format "${value}". Valid: json, table.`,
  );
}

export function formatOutput(
  rows: Record<string, unknown>[],
  format: OutputFormat
): string {
  if (rows.length === 0) {
    if (format === "json") return "[]";
    if (format === "csv") return "";
    return "No results.";
  }

  switch (format) {
    case "json":
      return JSON.stringify(rows, null, 2);
    case "csv":
      return formatCsv(rows);
    case "table":
      return formatTable(rows);
    default:
      return JSON.stringify(rows, null, 2);
  }
}

function formatCsv(rows: Record<string, unknown>[]): string {
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const lines = rows.map((row) =>
    keys.map((k) => {
      const val = row[k];
      if (val === null || val === undefined) return "";
      const str = String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")
  );
  return [header, ...lines].join("\n");
}

function formatTable(rows: Record<string, unknown>[]): string {
  const keys = Object.keys(rows[0]);

  // Calculate column widths
  const widths = keys.map((k) => {
    const maxVal = Math.max(...rows.map((r) => String(r[k] ?? "").length));
    return Math.max(k.length, maxVal);
  });

  const divider = widths.map((w) => "-".repeat(w + 2)).join("+");
  const headerRow = keys
    .map((k, i) => ` ${k.padEnd(widths[i])} `)
    .join("|");
  const dataRows = rows.map((row) =>
    keys
      .map((k, i) => ` ${String(row[k] ?? "").padEnd(widths[i])} `)
      .join("|")
  );

  return [headerRow, divider, ...dataRows].join("\n");
}
