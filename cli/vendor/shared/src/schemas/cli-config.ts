import { z } from "zod";
import { canonicalPipeLedgerAppOrigin } from "../auth/app-origin.js";

/**
 * Shape of a saved CLI credential (`~/.pipeledger/profiles/<name>.json`).
 *
 * Lives in its own module because it ships inside the public CLI package
 * through `public-client.ts`. Keep its imports limited to other modules on
 * that allowlist; the credential authorization schemas must not follow it
 * into the published bundle.
 */
export const PipeLedgerCliConfigSchema = z
  .object({
    api_url: z
      .string()
      .url()
      .transform((value) => canonicalPipeLedgerAppOrigin(value)),
    /**
     * Named `credential_secret`, not `credential`, so that ordinary redaction
     * tooling catches it. Log scrubbers, CI masking, and agents key on the
     * substring "secret"/"key"/"token" in a field name; "credential" matches
     * none of them, and on 2026-08-18 a live key was echoed for exactly that
     * reason. The value's `pl_live_` prefix is the format-level defence.
     */
    credential_secret: z.string().startsWith("pl_live_"),
    /**
     * Optional because an environment-sourced config carries only the secret
     * and the API URL; the server resolves the organization from the
     * credential itself. The downloaded file always sets both.
     */
    org_id: z.string().uuid().optional(),
    org_name: z.string().min(1).optional(),
  })
  .strict();

export type PipeLedgerCliConfig = z.infer<typeof PipeLedgerCliConfigSchema>;
