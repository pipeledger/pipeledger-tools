/**
 * pl catalog business-identity review|commit --operation-file <path>
 *
 * The operation file contains the same object accepted by pl_catalog_admin's
 * business_identity_governance field. Commit deliberately reads that object
 * again: the service verifies its fingerprint against the reviewed payload.
 */

import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { ApiClient } from "../lib/client";
import { LocalCliError } from "../lib/local-error";

interface GovernanceResponse {
  status: "reviewed" | "committed";
  operation_type: string;
  operation_id: string;
  review_token?: string;
  review_expires_at?: string;
  idempotent_replay?: boolean;
  record_count: number;
  summary: string;
  result?: Record<string, unknown>;
}

async function loadOperation(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new LocalCliError(
      `Could not read business identity operation file: ${path}`,
      "E_CLI_FILE_READ"
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LocalCliError(
      `Business identity operation file is not valid JSON: ${path}`,
      "E_CLI_FILE_JSON"
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalCliError(
      `Business identity operation file must contain one JSON object: ${path}`,
      "E_CLI_FILE_JSON"
    );
  }
  // The service validates the operation and returns field-level errors.
  return parsed as Record<string, unknown>;
}

async function send(input: {
  action: "review" | "commit";
  operationFile: string;
  reviewToken?: string;
  json?: boolean;
}): Promise<void> {
  const operation = await loadOperation(input.operationFile);
  const response = await new ApiClient().post<GovernanceResponse>(
    "/api/v1/catalog/business-identity-governance",
    {
      action: input.action,
      operation,
      ...(input.reviewToken ? { review_token: input.reviewToken } : {}),
    }
  );
  if (input.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  console.log(response.summary);
  console.log(`Operation: ${response.operation_id}`);
  if (response.review_token) {
    console.log(`Review token: ${response.review_token}`);
    console.log(`Expires: ${response.review_expires_at}`);
  }
  if (response.idempotent_replay) console.log("Idempotent replay: yes");
}

export const businessIdentityGovernanceCommand = new Command("business-identity")
  .description("Review and commit governed business identity and role changes")
  .addHelpText(
    "after",
    "\nThe JSON file is one assert_role, link_identity, retract_role, or unlink_identity operation.\n" +
      "Review first, inspect the summary, then commit the unchanged file with the returned token.\n"
  );

businessIdentityGovernanceCommand
  .command("review")
  .description("Review an operation without mutating governance state")
  .requiredOption("--operation-file <path>", "JSON file containing one governance operation")
  .option("--json", "Print the complete response as JSON")
  .action(async (options: { operationFile: string; json?: boolean }) => {
    await send({ action: "review", ...options });
  });

businessIdentityGovernanceCommand
  .command("commit")
  .description("Commit an unchanged, reviewed operation")
  .requiredOption("--operation-file <path>", "The same JSON operation file used for review")
  .requiredOption("--review-token <token>", "Short-lived token returned by review")
  .option("--json", "Print the complete response as JSON")
  .action(
    async (options: { operationFile: string; reviewToken: string; json?: boolean }) => {
      await send({ action: "commit", ...options });
    }
  );
