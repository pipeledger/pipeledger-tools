/**
 * pl resolve <query> [--object-type customer] [--action search|list|review] [--limit N]
 *
 * Resolves natural language to governed business objects and finance metrics.
 * Thin client over POST /api/v1/resolve, the same capability service the MCP
 * `pl_resolve` tool calls, so all three doors return the same candidates and
 * the same policy decisions.
 *
 * Two behaviours worth knowing at the terminal:
 *
 *   - A policy block is a normal response, not an error. When an object kind is
 *     policy-limited the command prints the reason and exits 0, because the
 *     answer ("this kind is limited for this credential, here is why") is
 *     itself the result.
 *   - Under an identity-tokenization policy, `--action list` still enumerates
 *     the directory with deterministic token labels while a plaintext search is
 *     refused. Preserve the tokens exactly: they are the same values reports
 *     and drilldowns deliver, so they are safe to group, compare, and cite.
 *
 * The rendering decisions are exported as pure functions so they are testable
 * without a live API, matching `pl schema` and `pl report`.
 */

import { Command } from "commander";
import { ApiClient } from "../lib/client";
import { parseLimitOption } from "../lib/option-parsers";
import {
  formatOutput,
  parseOutputFormat,
  type OutputFormat,
} from "../lib/output";

interface ResolveCandidate {
  object_type: string;
  id: string;
  label: string;
  confidence: number;
  calculation?: string | null;
  flow_window?: string | null;
  result_unit?: string | null;
  canonical_object_id?: string;
}

/**
 * One governed object in a directory listing. `display_label` is the name a
 * person recognizes (or a privacy token when identities are tokenized);
 * `reporting_object_id` is the value to pass to a report filter.
 */
interface DirectoryEntry {
  display_name: string;
  display_label: string;
  reporting_object_id: string;
  source_binding_count: number;
}

interface ReviewEntry {
  label: string;
  source_erp: string;
  source_record_id: string;
  business_role: string | null;
  business_role_state: string;
  business_role_evidence_candidate: string | null;
  business_role_evidence_state: string;
  business_identity_state: string;
  activity_evidence_state: string;
  availability_state: string;
  evidence_basis: string;
}

export interface ServingPublication {
  mart: string;
  run_id: string;
  published_at: string;
  release_channel: string;
}

export interface ResolveResponse {
  action: "search" | "list" | "review" | "context";
  entity_context?: {
    entries: Array<{
      business_identity_id: string;
      display_name: string;
      identity_kind: string;
      profiles: Array<{
        legal_form: string | null;
        tax_classification: string | null;
        tax_regime?: string | null;
        tax_jurisdiction_country_code?: string | null;
        effective_from?: string | null;
        effective_to?: string | null;
      }>;
      owners: Array<{
        owner_display_name: string;
        ownership_share: string;
        effective_from: string | null;
        effective_to: string | null;
      }>;
      memberships: Array<{
        group_name: string;
        effective_from: string | null;
        effective_to: string | null;
      }>;
    }>;
    next_cursor?: string;
    as_of?: string | null;
    period?: { start: string; end: string } | null;
    source_directory_publication_run_id?: string;
  };
  query: string;
  catalog_version: string | null;
  resolver_version: string;
  /**
   * Null for metric resolution (no warehouse read) and when policy blocks
   * semantic access before publication lookup. Its timestamp describes the
   * directory snapshot, not accounting-period coverage.
   */
  serving_publication: ServingPublication | null;
  candidates: ResolveCandidate[];
  directory_entries: DirectoryEntry[];
  review_entries: ReviewEntry[];
  directory_count?: {
    authorized_object_count: number;
    returned_object_count: number;
    truncated: boolean;
  };
  review_page?: {
    authorized_record_count: number;
    page_offset: number;
    returned_record_count: number;
    truncated: boolean;
    next_cursor?: string;
  };
  object_type_status: Array<{
    object_type: string;
    supported: boolean;
    reason?: string;
  }>;
  resolution: {
    ambiguous: boolean;
    clarification_recommended: boolean;
    guidance: string;
  };
}

export interface ResolveOptions {
  objectType: string;
  action: string;
  limit: number;
  format: OutputFormat;
  cursor?: string;
  availabilityStates?: string;
  activityEvidenceStates?: string;
  governedRoleStates?: string;
  governedRoles?: string;
  advisoryRoleEvidenceStates?: string;
  advisoryRoles?: string;
  businessIdentityStates?: string;
  sourceErps?: string;
  evidenceBasisQuery?: string;
  context?: string;
}

function commaList(value: string | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

/** The request body, identical in shape to the MCP tool input. */
export function buildResolveRequestBody(
  query: string | undefined,
  opts: Omit<ResolveOptions, "format">,
): Record<string, unknown> {
  const reviewFilters = {
    availability_states: commaList(opts.availabilityStates),
    activity_evidence_states: commaList(opts.activityEvidenceStates),
    governed_role_states: commaList(opts.governedRoleStates),
    governed_roles: commaList(opts.governedRoles),
    advisory_role_evidence_states: commaList(opts.advisoryRoleEvidenceStates),
    advisory_roles: commaList(opts.advisoryRoles),
    business_identity_states: commaList(opts.businessIdentityStates),
    source_erps: commaList(opts.sourceErps),
    ...(opts.evidenceBasisQuery
      ? { evidence_basis_query: opts.evidenceBasisQuery }
      : {}),
  };
  const hasReviewFilters = Object.values(reviewFilters).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );
  return {
    object_type: opts.objectType,
    action: opts.action,
    ...(query ? { query } : {}),
    limit: opts.limit,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(hasReviewFilters ? { review_filters: reviewFilters } : {}),
    ...(opts.context ? { context: JSON.parse(opts.context) as unknown } : {}),
  };
}

/**
 * A policy-limited object kind, rendered as an ANSWER rather than an error.
 * Returns null when nothing is blocked. The caller prints this and stops:
 * there are no candidates to show, and exiting non-zero would misreport a
 * governed policy decision as a failure.
 */
export function formatBlockedNotice(data: ResolveResponse): string | null {
  const blocked = data.object_type_status.find((status) => !status.supported);
  if (!blocked) return null;
  return [
    `${blocked.object_type}: not available for this credential`,
    ...(blocked.reason ? ["", blocked.reason] : []),
    "",
    data.resolution.guidance,
  ].join("\n");
}

/**
 * The approved snapshot that answered. The tool contract promises every
 * successful search and list identifies it; without this a table-format user
 * is the one door that never sees which publication was read.
 */
export function formatServingPublicationNotice(
  publication: ServingPublication | null | undefined,
): string | null {
  if (!publication) return null;
  return (
    `${publication.mart === "entity_context" ? "Entity Context" : "Business Object Directory"} publication: ${publication.run_id}, ` +
    `published ${publication.published_at}, ` +
    `${publication.release_channel} channel.`
  );
}

/** Directory listings and searches render different columns. */
export function toResolveDisplayRows(
  data: ResolveResponse,
): Array<Record<string, string | number>> {
  if (data.action === "context") {
    const interval = (row: {
      effective_from?: string | null;
      effective_to?: string | null;
    }) => `[${row.effective_from ?? "unknown"}, ${row.effective_to ?? "open"})`;
    return (data.entity_context?.entries ?? []).map((entry) => ({
      identity_id: entry.business_identity_id,
      company: entry.display_name,
      identity_kind: entry.identity_kind,
      legal_profiles:
        entry.profiles
          .map(
            (profile) =>
              `${profile.legal_form ?? "Unknown legal form"}; ${profile.tax_classification ?? "Unknown tax classification"}${profile.tax_regime ? ` (${profile.tax_jurisdiction_country_code ?? "Unknown jurisdiction"}: ${profile.tax_regime})` : ""} ${interval(profile)}`,
          )
          .join("; ") || "No dated classification recorded",
      owners:
        entry.owners
          .map(
            (owner) =>
              `${owner.owner_display_name}: ${owner.ownership_share} fraction ${interval(owner)}`,
          )
          .join("; ") || "None recorded",
      groups:
        entry.memberships
          .map(
            (membership) => `${membership.group_name} ${interval(membership)}`,
          )
          .join("; ") || "None recorded",
    }));
  }
  if (data.action === "list") {
    return data.directory_entries.map((entry) => ({
      label: entry.display_label,
      reporting_id: entry.reporting_object_id,
      sources: entry.source_binding_count,
    }));
  }
  if (data.action === "review") {
    return data.review_entries.map((entry) => ({
      label: entry.label,
      source: `${entry.source_erp}:${entry.source_record_id}`,
      governed_role: entry.business_role ?? entry.business_role_state,
      advisory_role:
        entry.business_role_evidence_candidate ??
        entry.business_role_evidence_state,
      identity: entry.business_identity_state,
      activity: entry.activity_evidence_state,
      availability: entry.availability_state,
      evidence: entry.evidence_basis,
    }));
  }
  return data.candidates.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    confidence: candidate.confidence.toFixed(2),
    type: candidate.object_type,
    ...(candidate.object_type === "metric" &&
    (candidate.calculation || candidate.flow_window || candidate.result_unit)
      ? {
          ...(candidate.calculation
            ? { calculation: candidate.calculation }
            : {}),
          flow_window: candidate.flow_window ?? "",
          result_unit: candidate.result_unit ?? "",
        }
      : {}),
  }));
}

export function formatDirectoryCount(data: ResolveResponse): string | null {
  if (data.action !== "list" || !data.directory_count) return null;
  const count = data.directory_count;
  return (
    `${count.returned_object_count} of ${count.authorized_object_count} governed objects` +
    (count.truncated ? " (truncated)" : "")
  );
}

export function formatReviewPage(data: ResolveResponse): string | null {
  if (data.action !== "review" || !data.review_page) return null;
  const page = data.review_page;
  const pageEnd = page.page_offset + page.returned_record_count;
  return (
    `${page.returned_record_count} records on this page; ` +
    `${pageEnd} of ${page.authorized_record_count} filtered source records reviewed` +
    (page.next_cursor ? `\nnext_cursor: ${page.next_cursor}` : "\nfinal page")
  );
}

/** Keep requested context dates distinct from each published assertion interval. */
export function formatEntityContextNotice(
  data: ResolveResponse,
): string | null {
  if (data.action !== "context" || !data.entity_context) return null;
  const context = data.entity_context;
  return [
    context.as_of
      ? `Context effective on: ${context.as_of}`
      : context.period
        ? `Requested context period: ${context.period.start} to ${context.period.end}`
        : "Context date unavailable",
    ...(context.source_directory_publication_run_id
      ? [
          `Source directory publication: ${context.source_directory_publication_run_id}`,
        ]
      : []),
    ...(context.next_cursor ? [`next_cursor: ${context.next_cursor}`] : []),
  ].join("\n");
}

export const resolveCommand = new Command("resolve")
  .description("Resolve names to governed business objects and finance metrics")
  .argument(
    "[query]",
    "Name or phrase to resolve; optional with --action review and omit with --action list",
  )
  .option(
    "-t, --object-type <type>",
    "metric, customer, vendor, employee, project, legal_entity",
    "metric",
  )
  .option("-a, --action <action>", "search, list, review, or context", "search")
  .option(
    "--context <json>",
    "Context lookup JSON with as_of or period and optional exact identity/group/owner/party selectors",
  )
  .option(
    "-l, --limit <n>",
    "Maximum candidates to return",
    parseLimitOption,
    10,
  )
  .option(
    "--cursor <cursor>",
    "Opaque next_cursor from a prior review or context page",
  )
  .option(
    "--availability-states <list>",
    "Comma-separated review availability states",
  )
  .option(
    "--activity-evidence-states <list>",
    "Comma-separated lifetime activity evidence states",
  )
  .option(
    "--governed-role-states <list>",
    "Comma-separated governed role states",
  )
  .option("--governed-roles <list>", "Comma-separated governed business roles")
  .option(
    "--advisory-role-evidence-states <list>",
    "Comma-separated advisory role evidence states",
  )
  .option("--advisory-roles <list>", "Comma-separated advisory role candidates")
  .option(
    "--business-identity-states <list>",
    "Comma-separated business identity states",
  )
  .option("--source-erps <list>", "Comma-separated source ERP identifiers")
  .option("--evidence-basis-query <value>", "Stable evidence-basis substring")
  .option(
    "--format <fmt>",
    "Output format: table, json, csv",
    parseOutputFormat,
    "table",
  )
  .action(async (query: string | undefined, opts: ResolveOptions) => {
    const client = new ApiClient();
    const data = await client.post<ResolveResponse>(
      "/api/v1/resolve",
      buildResolveRequestBody(query, opts),
    );

    if (opts.format === "json") {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (data.action === "context" && data.entity_context) {
      console.log(formatOutput(toResolveDisplayRows(data), opts.format));
      const contextNotice = formatEntityContextNotice(data);
      if (contextNotice) console.log(`\n${contextNotice}`);
      const publication = formatServingPublicationNotice(
        data.serving_publication,
      );
      if (publication) console.log(`\n${publication}`);
      console.log(`\n${data.resolution.guidance}`);
      return;
    }

    const blocked = formatBlockedNotice(data);
    if (blocked) {
      console.log(blocked);
      return;
    }

    console.log(formatOutput(toResolveDisplayRows(data), opts.format));

    const directoryCount = formatDirectoryCount(data);
    if (directoryCount) console.log(`\n${directoryCount}`);

    const reviewPage = formatReviewPage(data);
    if (reviewPage) console.log(`\n${reviewPage}`);

    const publication = formatServingPublicationNotice(
      data.serving_publication,
    );
    if (publication) console.log(`\n${publication}`);

    if (data.resolution.clarification_recommended) {
      console.log(`\n${data.resolution.guidance}`);
    }
  });
