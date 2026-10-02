/**
 * pl published-status [--mart gl_lines] [--calendar-month 2026-04]
 *
 * Shows which certified mart snapshot is currently public, plus any active
 * Corporate Insider publication window. This is intentionally metadata-only:
 * it does not scan BigQuery or inspect individual GL rows.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/client";
import {
  formatOutput,
  parseOutputFormat,
  type OutputFormat,
} from "../lib/output";
import type {
  PublicWindow,
  PublishedStatusMart,
  PublishedStatusResponse,
  RequestedPeriod,
} from "../lib/publication-status";

export const publishedStatusCommand = new Command("published-status")
  .description("Show public vs Corporate Insider publication status")
  .option("-m, --mart <mart>", "Mart short name")
  .option(
    "--calendar-month <month>",
    "Check whether YYYY-MM or YYYY-MM-01 is public"
  )
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table",
  )
  .action(
    async (opts: {
      mart?: string;
      calendarMonth?: string;
      format: OutputFormat;
    }) => {
      const client = new ApiClient();
      const params = new URLSearchParams();
      if (opts.mart) params.set("mart", opts.mart);
      if (opts.calendarMonth) params.set("calendar_month", opts.calendarMonth);

      const path = `/api/v1/published-status${
        params.size > 0 ? `?${params.toString()}` : ""
      }`;

      const data = await client.get<PublishedStatusResponse>(path);
      const format = opts.format;

      if (format === "json") {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.marts.length === 0) {
        console.log("No published marts found.");
        return;
      }

      console.log(formatOutput(toDisplayRows(data.marts), format));
      if (data.filtered_by_allowed_marts) {
        process.stderr.write(
          "\n--- filtered to this credential's allowed marts ---\n"
        );
      }
    }
  );

function toDisplayRows(
  marts: PublishedStatusMart[]
): Record<string, string | boolean | null>[] {
  return marts.map((mart) => ({
    mart: mart.short_name ?? mart.mart_name,
    last_published: formatDateTime(mart.last_published_at),
    latest_run: shortId(mart.latest_certified_run),
    published_run: shortId(mart.last_published_run),
    stale: Boolean(mart.is_stale),
    insider_status: mart.active_insider_publication?.status ?? null,
    public_window: formatPublicWindow(mart.public_window),
    requested_period: formatRequestedPeriod(mart.requested_period),
  }));
}

function formatPublicWindow(window: PublicWindow | null): string | null {
  if (!window) return null;
  if (!window.public_before && !window.released_through) return "none released";
  const parts: string[] = [];
  if (window.public_before) parts.push(`before ${window.public_before}`);
  if (window.released_through) parts.push(`through ${window.released_through}`);
  return parts.join("; ");
}

function formatRequestedPeriod(period: RequestedPeriod | null): string | null {
  if (!period) return null;
  if (period.is_public) return `${period.calendar_month}: public`;
  const release = period.insider_release_at
    ? ` until ${formatDateTime(period.insider_release_at)}`
    : "";
  return `${period.calendar_month}: insider-restricted${release}`;
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function shortId(value: string | null): string | null {
  return value ? value.slice(0, 8) : null;
}
