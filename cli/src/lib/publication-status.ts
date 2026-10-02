import { ApiClient } from "./client";
import type { PublicationCertification, SourceDataRecency } from "shared";

export interface PublicationSourceProvenance {
  certified_by?: "PipeLedger";
  certification?: PublicationCertification;
  run_id?: string;
  published_at?: string;
  publication_age_seconds?: number | null;
  source_data_recency?: SourceDataRecency;
  mart?: string;
  release_channel?: "public" | "insider";
  publication_id?: string | null;
  release_at?: string | null;
  is_unreleased_insider?: boolean;
  staleness_warning?: string;
}

export interface ActiveInsiderPublication {
  id: string;
  status: string;
  pipeline_run_id: string;
  mart_sync_status_id: string | null;
  release_at: string | null;
  published_to_insider_at: string | null;
  hold_reason: string | null;
}

export interface PublicWindow {
  public_before: string | null;
  released_through: string | null;
}

export interface RequestedPeriod {
  calendar_month: string;
  is_public: boolean;
  insider_restricted: boolean;
  insider_release_at: string | null;
}

export interface PublishedStatusMart {
  mart_name: string;
  short_name: string | null;
  last_published_at: string | null;
  last_published_run: string | null;
  latest_certified_run: string | null;
  is_certified: boolean | null;
  is_stale: boolean | null;
  user_approved_at: string | null;
  active_insider_publication: ActiveInsiderPublication | null;
  public_window: PublicWindow | null;
  requested_period: RequestedPeriod | null;
}

export interface PublishedStatusResponse {
  filtered_by_allowed_marts?: boolean;
  marts: PublishedStatusMart[];
}

export async function fetchPublishedStatusMart(args: {
  client: ApiClient;
  mart: string;
  calendarMonth?: string;
}): Promise<PublishedStatusMart | null> {
  const params = new URLSearchParams({ mart: args.mart });
  if (args.calendarMonth) {
    params.set("calendar_month", args.calendarMonth);
  }

  const data = await args.client.get<PublishedStatusResponse>(
    `/api/v1/published-status?${params.toString()}`
  );
  return data.marts[0] ?? null;
}

export function formatPublicationNotice(args: {
  martLabel: string;
  status: PublishedStatusMart | null;
  sourceProvenance?: PublicationSourceProvenance | null;
}): string | null {
  const provenance = args.sourceProvenance;
  if (provenance?.is_unreleased_insider) {
    const release = provenance.release_at
      ? ` before ${formatDateTime(provenance.release_at)}`
      : "";
    return `Insider channel: ${args.martLabel} uses a pre-release snapshot. Do not share externally${release}.`;
  }

  const period = args.status?.requested_period;
  const window = formatPublicWindow(args.status?.public_window ?? null);
  const active = args.status?.active_insider_publication;

  if (period?.insider_restricted) {
    const release = active?.release_at
      ? ` Release: ${formatDateTime(active.release_at)}.`
      : "";
    return `Publication note: ${args.martLabel} ${period.calendar_month} is insider-restricted on the public channel. Public data is ${window}.${release}`;
  }

  if (!active) return null;

  const release = active.release_at ? ` Release: ${formatDateTime(active.release_at)}.` : "";

  return `Publication note: ${args.martLabel} has an active Corporate Insider publication. Public data is ${window}.${release}`;
}

export async function writePublicationNotice(args: {
  client: ApiClient;
  mart: string;
  martLabel: string;
  calendarMonth?: string;
  sourceProvenance?: PublicationSourceProvenance | null;
}): Promise<void> {
  const certification = formatPublicationCertificationNotice(
    args.sourceProvenance?.certification
  );
  if (certification) {
    process.stderr.write(`\n--- ${args.martLabel}: ${certification} ---\n`);
  }
  try {
    const status = await fetchPublishedStatusMart({
      client: args.client,
      mart: args.mart,
      calendarMonth: args.calendarMonth,
    });
    const notice = formatPublicationNotice({
      martLabel: args.martLabel,
      status,
      sourceProvenance: args.sourceProvenance,
    });
    if (notice) {
      process.stderr.write(`\n--- ${notice} ---\n`);
    }
  } catch {
    // Best-effort context only. A report result should never fail because
    // the metadata endpoint is temporarily unavailable or not yet deployed.
  }
}

export function formatPublicationCertificationNotice(
  certification: PublicationCertification | null | undefined
): string | null {
  if (!certification) return null;
  const tests = certification.runtime_tests?.direct_mart;
  const documentation = certification.schema_documentation;
  if (!tests || !documentation) {
    return "Certified by PipeLedger; detailed runtime-test and schema-documentation counts were not recorded for this legacy publication.";
  }
  const releaseScenarios = certification.release_scenarios;
  const releaseEvidence = releaseScenarios
    ? `; deterministic model scenarios ${releaseScenarios.passed}/${releaseScenarios.selected} passed for the attested transform release`
    : "";
  return (
    `Certified by PipeLedger; direct mart tests ${tests.passed} passed, ` +
    `${tests.warned} warned, ${tests.failed} failed of ${tests.executed} executed; ` +
    `schema documentation ${documentation.documented_delivered_columns}/${documentation.delivered_columns} ` +
    `(${documentation.coverage_percent}%)${releaseEvidence}.`
  );
}

export function calendarMonthFromDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? `${match[1]}-${match[2]}-01` : undefined;
}

function formatPublicWindow(window: PublicWindow | null): string {
  if (!window) return "public-only";

  const parts: string[] = [];
  if (window.public_before) parts.push(`before ${window.public_before}`);
  if (window.released_through) parts.push(`through ${window.released_through}`);
  return parts.length > 0 ? parts.join("; ") : "not released for scheduled periods";
}

function formatDateTime(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}
