import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { ApiClient } from "../lib/client";
export const assumptionsCommand = new Command("assumptions").description(
  "Discover and govern organization finance assumptions (canonical decimal values)",
);
assumptionsCommand
  .command("list")
  .requiredOption("--as-of <date>", "Reporting date YYYY-MM-DD")
  .option("--key <key>", "Stable key; includes revision history")
  .option("--after-key <key>", "Continue a discovery page")
  .option("--before-revision <revision>", "Continue value history")
  .option(
    "--before-definition-revision <revision>",
    "Continue definition history",
  )
  .action(
    async (opts: {
      asOf: string;
      key?: string;
      afterKey?: string;
      beforeRevision?: string;
      beforeDefinitionRevision?: string;
    }) => {
      const p = new URLSearchParams({ as_of: opts.asOf });
      if (opts.key) p.set("assumption_key", opts.key);
      if (opts.afterKey) p.set("after_key", opts.afterKey);
      if (opts.beforeDefinitionRevision)
        p.set("before_definition_revision", opts.beforeDefinitionRevision);
      if (opts.beforeRevision) p.set("before_revision", opts.beforeRevision);
      console.log(
        JSON.stringify(
          await new ApiClient().get(`/api/v1/catalog/assumptions?${p}`),
          null,
          2,
        ),
      );
    },
  );
assumptionsCommand
  .command("write")
  .requiredOption(
    "--input-file <path>",
    "JSON create, edit, update_value or submit operation; Owner/Admin decisions happen on the Finance assumptions page; values are raw decimal strings",
  )
  .action(async (opts: { inputFile: string }) => {
    // The service validates the operation and returns field-level errors.
    const operation: unknown = JSON.parse(
      await readFile(opts.inputFile, "utf8"),
    );
    console.log(
      JSON.stringify(
        await new ApiClient().post("/api/v1/catalog/assumptions", operation),
        null,
        2,
      ),
    );
  });
