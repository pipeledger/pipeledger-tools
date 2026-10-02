/**
 * pl whoami
 *
 * Displays the current authentication context and the shared `whoami`
 * description of this credential: exact tools, effective operator grants,
 * clearance, scope, allowed marts, and whether its results describe a complete
 * ledger. The object comes from
 * `POST /api/v1/auth/validate` and is the same one MCP `pl_schema` embeds;
 * the CLI only prints it.
 */

import { Command } from "commander";
import type { Whoami } from "shared";
import {
  checkConfigSecurity,
  configPath,
  describeCredentialSource,
  requireConfig,
} from "../lib/config";
import { ApiClient } from "../lib/client";
import { describeSelection } from "./switch";

interface ValidateResponse {
  org_id: string;
  org_name: string;
  label: string;
  whoami?: Whoami;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 14;

/**
 * The end date with the time left, and a prompt to act inside the last two
 * weeks. A credential that stops working mid-close is found out by an agent
 * failing; this line is where a person finds out first. `undefined` comes
 * from a service that predates the field, and is not reported as "no end
 * date", which would be a claim.
 */
export function describeExpiry(
  expiresAt: string | null | undefined,
  now: Date,
): string {
  if (expiresAt === undefined) return "not reported by the service";
  if (expiresAt === null) return "no end date set";
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "not reported by the service";

  const date = end.toISOString().slice(0, 10);
  const remainingMs = end.getTime() - now.getTime();
  if (remainingMs <= 0) return `${date} (ended)`;
  const days = Math.floor(remainingMs / DAY_MS);
  const left =
    days === 0 ? "less than a day left" : `${days} day${days === 1 ? "" : "s"} left`;
  return days < EXPIRY_WARNING_DAYS
    ? `${date} (${left}; ask an Owner or Admin to extend it or issue a new credential)`
    : `${date} (${left})`;
}

export function formatWhoami(
  data: ValidateResponse,
  apiUrl: string,
  configFile: string,
  profile?: string,
  now: Date = new Date(),
): string {
  const lines = [
    `Organization:  ${data.org_name}`,
    `Org ID:        ${data.org_id}`,
    `Credential:    ${data.label}`,
    `API URL:       ${apiUrl}`,
    ...(profile ? [`Profile:       ${profile}`] : []),
    `Config file:   ${configFile}`,
  ];
  const who = data.whoami;
  if (!who) return lines.join("\n");

  // Counts, not values: scope values are source keys, which identify nothing
  // to a reader. The names come from `pl resolve`; the keys stay in --json.
  const scoped = who.scope.dimensions.length > 0;
  const scopeSummary = scoped
    ? who.scope.dimensions
        .map(
          (entry) =>
            `${entry.dimension}: ${entry.values.length} value${entry.values.length === 1 ? "" : "s"}`,
        )
        .join("; ")
    : "all rows";
  lines.push(
    "",
    `Connection ID: ${who.credential.connection_instance_id ?? "no access grant bound"}`,
    `Access ends:   ${describeExpiry(who.credential.expires_at, now)}`,
    `Role:          ${who.credential_role}`,
    `Clearance:     ${who.clearance}${who.insider_cleared ? " (insider cleared)" : ""}`,
    `Scope:         ${who.scope.ledger} (${scopeSummary})`,
  );
  if (scoped) {
    lines.push(
      "Scope detail:  `pl whoami --json` lists the values; `pl resolve --object-type legal_entity --action list` shows entity names",
    );
  }
  if (who.scope.row_filter_columns.length > 0) {
    lines.push(`Row filters:   ${who.scope.row_filter_columns.join(", ")}`);
  }
  const operatorGrantSummary = who.operator_grants
    ? Object.entries(who.operator_grants)
        .map(([grant, enabled]) => `${grant}=${enabled}`)
        .join(", ")
    : "unavailable (the server did not return effective grants)";
  lines.push(
    `Tools:         ${who.allowed_tools.join(", ") || "none"}`,
    `Operator grants: ${operatorGrantSummary}`,
    `Marts:         ${who.allowed_marts.join(", ") || "none"}`,
    `Ledger:        ${who.ledger.complete ? "complete" : "partial"}` +
      (who.ledger.reasons.length > 0 ? ` (${who.ledger.reasons.join(", ")})` : ""),
    "",
    who.guidance,
  );
  return lines.join("\n");
}

export const whoamiCommand = new Command("whoami")
  .description("Show exact credential role, tools, grants, clearance, and scope")
  .option("--json", "Print the raw whoami object as JSON")
  .action(async (options: { json?: boolean }) => {
    // requireConfig, not a local copy of the check: it is the one place that
    // can tell "never authenticated" apart from "config file uses a retired
    // field name". whoami is the command people run when something is wrong,
    // so it is the worst place to give the vaguer of the two answers.
    const config = requireConfig();

    checkConfigSecurity();

    const client = new ApiClient(config);
    const data = await client.post<ValidateResponse>("/api/v1/auth/validate", {});

    if (options.json) {
      console.log(JSON.stringify(data.whoami ?? data, null, 2));
      return;
    }
    console.log(
      formatWhoami(
        data,
        config.api_url,
        configPath(),
        describeSelection(describeCredentialSource()),
      ),
    );
  });
