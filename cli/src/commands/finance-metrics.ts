import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { FinanceCatalogMetricDraftInput } from "shared";
import { ApiClient } from "../lib/client";
import { LocalCliError } from "../lib/local-error";
import { formatOutput, type OutputFormat } from "../lib/output";

interface CatalogReadResponse {
  data: Record<string, unknown>;
  meta: { summary: string } & Record<string, string | number>;
}

interface CatalogWriteResponse {
  data: {
    action: "create" | "edit" | "activate" | "archive";
    status: "draft" | "active" | "archived";
    id: string;
    metric_id: string;
    metric_family: "adjusted" | "custom";
    definition_hash: string;
    message: string;
    metric: Record<string, unknown>;
  };
}

interface FormatOptions {
  format: OutputFormat;
}

export const financeMetricsCommand = new Command("metrics").description(
  "Inspect and administer governed Finance Catalog metrics"
);

financeMetricsCommand
  .command("list")
  .description("List canonical metrics and organization-authored definition rows")
  .option("--catalog-version <version>", "Inspect a supported catalog version")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "table")
  .action(async (options: FormatOptions & { catalogVersion?: string }) => {
    const client = new ApiClient();
    const params = new URLSearchParams({ action: "list" });
    if (options.catalogVersion) {
      params.set("catalog_version", options.catalogVersion);
    }
    const result = await client.get<CatalogReadResponse>(catalogPath(params));
    printCatalogList(result, options.format);
  });

financeMetricsCommand
  .command("get")
  .description("Inspect one effective metric or one stored organization definition")
  .argument("<selector>", "metric_id by default, or a definition UUID with --definition-id")
  .option("--definition-id", "Treat selector as a stored definition UUID", false)
  .option("--catalog-version <version>", "Resolve an effective metric in this edition")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "json")
  .action(
    async (
      selector: string,
      options: FormatOptions & { definitionId: boolean; catalogVersion?: string }
    ) => {
      const client = new ApiClient();
      const params = new URLSearchParams({ action: "get" });
      params.set(options.definitionId ? "id" : "metric_id", selector);
      if (options.catalogVersion) {
        params.set("catalog_version", options.catalogVersion);
      }
      const result = await client.get<CatalogReadResponse>(catalogPath(params));
      printValue(result.data.metric, options.format);
    }
  );

financeMetricsCommand
  .command("history")
  .description("Show the governed revision history for an organization-authored metric")
  .argument("<metric-id>", "Organization-authored metric_id")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "table")
  .action(async (metricId: string, options: FormatOptions) => {
    const client = new ApiClient();
    const params = new URLSearchParams({
      action: "history",
      metric_id: metricId,
    });
    const result = await client.get<CatalogReadResponse>(catalogPath(params));
    printRows(result.data.metric_history, options.format);
  });

financeMetricsCommand
  .command("versions")
  .description("List immutable PipeLedger Finance Catalog releases")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "table")
  .action(async (options: FormatOptions) => {
    const client = new ApiClient();
    const result = await client.get<CatalogReadResponse>(
      catalogPath(new URLSearchParams({ action: "versions" }))
    );
    printRows(result.data.releases, options.format);
  });

financeMetricsCommand
  .command("compare")
  .description("Compare two supported PipeLedger Finance Catalog releases")
  .argument("<from-version>", "Source catalog version")
  .argument("<to-version>", "Target catalog version")
  .option("--metric-id <metric-id>", "Narrow comparison to one metric")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "json")
  .action(
    async (
      fromVersion: string,
      toVersion: string,
      options: FormatOptions & { metricId?: string }
    ) => {
      const client = new ApiClient();
      const params = new URLSearchParams({
        action: "compare",
        from_version: fromVersion,
        to_version: toVersion,
      });
      if (options.metricId) params.set("metric_id", options.metricId);
      const result = await client.get<CatalogReadResponse>(catalogPath(params));
      if (options.format === "json") {
        printValue(result.data.comparison, "json");
        return;
      }
      const comparison = asRecord(result.data.comparison);
      printRows(comparison.changes, options.format);
    }
  );

financeMetricsCommand
  .command("preview")
  .description("Dry-run a stored or local definition against the active catalog")
  .option("--id <definition-id>", "Stored organization definition UUID")
  .option("--file <path>", "JSON file containing an unsaved metric definition")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "json")
  .action(
    async (options: FormatOptions & { id?: string; file?: string }) => {
      if (Boolean(options.id) === Boolean(options.file)) {
        throw new InvalidArgumentError("Provide exactly one of --id or --file.");
      }
      const client = new ApiClient();
      const body = options.file
        ? { action: "preview", definition: readMetricDefinition(options.file) }
        : { action: "preview", id: options.id };
      const result = await client.post<CatalogReadResponse>(CATALOG_PATH, body);
      printValue(result.data.preview, options.format);
    }
  );

financeMetricsCommand
  .command("create")
  .description("Create a private organization-authored metric draft")
  .requiredOption("--file <path>", "JSON file containing the metric definition")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "table")
  .action(async (options: FormatOptions & { file: string }) => {
    const client = new ApiClient();
    const result = await client.post<CatalogWriteResponse>(CATALOG_PATH, {
      action: "create",
      definition: readMetricDefinition(options.file),
    });
    printWrite(result, options.format);
  });

financeMetricsCommand
  .command("edit")
  .description("Update a draft or fork an active metric into a new draft revision")
  .argument("<definition-id>", "Organization definition UUID")
  .requiredOption("--file <path>", "JSON file containing the complete metric definition")
  .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "table")
  .action(
    async (definitionId: string, options: FormatOptions & { file: string }) => {
      const client = new ApiClient();
      const result = await client.patch<CatalogWriteResponse>(
        `${CATALOG_PATH}/${definitionId}`,
        {
          action: "edit",
          definition: readMetricDefinition(options.file),
        }
      );
      printWrite(result, options.format);
    }
  );

for (const action of ["activate", "archive"] as const) {
  financeMetricsCommand
    .command(action)
    .description(
      action === "activate"
        ? "Activate a draft and supersede its prior active revision"
        : "Archive a draft or active organization definition"
    )
    .argument("<definition-id>", "Organization definition UUID")
    .option("--comment <text>", "Governed change note")
    .option("--format <format>", "Output: table, json, csv", parseOutputFormat, "table")
    .action(
      async (
        definitionId: string,
        options: FormatOptions & { comment?: string }
      ) => {
        const client = new ApiClient();
        const result = await client.patch<CatalogWriteResponse>(
          `${CATALOG_PATH}/${definitionId}`,
          { action, comment: options.comment }
        );
        printWrite(result, options.format);
      }
    );
}

const CATALOG_PATH = "/api/v1/catalog/metrics";

function catalogPath(params: URLSearchParams): string {
  return `${CATALOG_PATH}?${params.toString()}`;
}

export function readMetricDefinition(path: string): FinanceCatalogMetricDraftInput {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    throw new LocalCliError(
      "Could not read the metric definition JSON. Check the path, permissions, and JSON syntax.",
      "E_CLI_FILE_READ",
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LocalCliError(
      "The metric definition file must contain one JSON object.",
      "E_CLI_INPUT",
    );
  }
  // The service validates the definition and returns field-level errors.
  return raw as FinanceCatalogMetricDraftInput;
}

export function financeMetricListRows(
  data: Record<string, unknown>
): Record<string, unknown>[] {
  const canonical = asRows(data.canonical_metrics).map((row) => {
    const kind = row.kind;
    return {
      metric_id: row.metric_id,
      display_name: row.display_name,
      kind,
      report_section: row.report_section,
      source_mart: catalogMetricSource(row.source_mart, kind),
      ownership: "PipeLedger",
      status: "locked",
      revision: "",
      definition_hash: row.definition_hash,
    };
  });
  const organization = asRows(data.org_metrics).map((row) => {
    const kind = row.metric_kind ?? asRecord(row.metric).kind;
    return {
      metric_id: row.metric_id,
      display_name: row.display_name,
      kind,
      report_section:
        asRecord(row.metric).report_section ??
        asRecord(row.definition_json).report_section,
      source_mart: catalogMetricSource(row.source_mart, kind),
      ownership: "Organization",
      status: row.status,
      revision: row.metric_revision,
      definition_hash: row.definition_hash,
    };
  });
  return [...canonical, ...organization].sort((a, b) =>
    String(a.metric_id).localeCompare(String(b.metric_id))
  );
}

function catalogMetricSource(sourceMart: unknown, kind: unknown): unknown {
  if (typeof sourceMart === "string" && sourceMart.length > 0) {
    return sourceMart;
  }
  return kind === "temporal_ratio"
    ? "Operand sources (Metrics Report)"
    : "";
}

function printCatalogList(result: CatalogReadResponse, format: OutputFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.log(formatOutput(financeMetricListRows(result.data), format));
  }
  process.stderr.write(`\n--- ${result.meta.summary} ---\n`);
}

function printWrite(result: CatalogWriteResponse, format: OutputFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }
  console.log(formatOutput([{
    action: result.data.action,
    metric_id: result.data.metric_id,
    status: result.data.status,
    revision: asRecord(result.data.metric).metric_revision,
    definition_id: result.data.id,
    definition_hash: result.data.definition_hash,
  }], format));
}

function printRows(value: unknown, format: OutputFormat): void {
  console.log(formatOutput(asRows(value).map(flattenRow), format));
}

function printValue(value: unknown, format: OutputFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  const record = asRecord(value);
  console.log(formatOutput([flattenRow(record)], format));
}

function flattenRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : value,
    ])
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row)
      )
    : [];
}

function parseOutputFormat(value: string): OutputFormat {
  if (value !== "table" && value !== "json" && value !== "csv") {
    throw new InvalidArgumentError("Format must be table, json, or csv.");
  }
  return value;
}
