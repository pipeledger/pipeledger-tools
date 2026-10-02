/**
 * Echo protection for PipeLedger credential material.
 *
 * This is NOT a security boundary. The boundary is not printing secrets at
 * all, plus 0600 config files and server-side revocation. This exists because
 * secrets still reach stdout by accident -- a debug dump, an error that
 * serializes its config, a support transcript, an agent inspecting a config
 * file. On 2026-08-18 exactly that happened: a redactor keyed on the field
 * NAMES "key"/"secret"/"token" missed a field called `credential`, and a live
 * service credential landed in a session log.
 *
 * So this matches on the VALUE's format, never on the field name. Format
 * matching cannot be defeated by renaming a field, and because every pattern
 * is an exact PipeLedger credential shape it cannot mangle unrelated output.
 */

/**
 * Every issued PipeLedger credential prefix.
 *
 * - `pl_live_`  service credential / agent bearer (32 hex)
 * - `pl_csec_`  organization credential secret (32 hex)
 * - `pkc_`      organization credential public client id (32 hex)
 * - `dcr_`      dynamically registered OAuth client id (32 hex)
 *
 * `pkc_` and `dcr_` are identifiers rather than secrets, but they are still
 * connection-linking material and cost nothing to mask in casual output.
 */
export const PIPELEDGER_CREDENTIAL_PREFIXES = [
  "pl_live_",
  "pl_csec_",
  "pkc_",
  "dcr_",
] as const;

/**
 * Matches a prefix plus at least 16 hex characters. The real bodies are 32,
 * but accepting 16+ keeps a truncated paste from slipping through, and the
 * hex-only body is what keeps this from matching ordinary prose.
 */
const CREDENTIAL_PATTERN = new RegExp(
  `(${PIPELEDGER_CREDENTIAL_PREFIXES.join("|")})[0-9a-fA-F]{16,}`,
  "g"
);

/**
 * How many characters of the body survive. Enough to correlate two mentions
 * of the same credential in a log, far too few to use one.
 */
const RETAINED_BODY_CHARS = 4;

/**
 * Replace every PipeLedger credential in `text` with a masked form that keeps
 * the prefix and the first few body characters:
 *
 *   pl_live_f946<28 more hex characters> -> pl_live_f946...redacted
 *
 * Returns non-string input untouched so callers can pass it through freely.
 */
export function redactCredentials(text: string): string {
  return text.replace(CREDENTIAL_PATTERN, (match, prefix: string) => {
    const body = match.slice(prefix.length);
    return `${prefix}${body.slice(0, RETAINED_BODY_CHARS)}...redacted`;
  });
}

/**
 * Deep-redact any value by serializing it, masking, and returning a string.
 * Use for error payloads and config dumps, where the secret can be nested at
 * an unknown depth and the caller only wants something printable.
 */
export function redactCredentialsDeep(value: unknown): string {
  if (typeof value === "string") return redactCredentials(value);
  try {
    return redactCredentials(JSON.stringify(value) ?? String(value));
  } catch {
    // Circular or otherwise unserializable: fall back to the primitive form
    // rather than throwing inside an error path.
    return redactCredentials(String(value));
  }
}

/** True when `text` still contains anything shaped like a credential. */
export function containsCredential(text: string): boolean {
  // Fresh lastIndex: CREDENTIAL_PATTERN is global and therefore stateful.
  return new RegExp(CREDENTIAL_PATTERN.source).test(text);
}
