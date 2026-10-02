// The wire token prefix string value "pl_live_" MUST NOT change (it is the
// literal prefix of every issued credential); only the identifier names around
// it carry the credential concept.
export const CREDENTIAL_TOKEN_PREFIX = "pl_live_";
export const CREDENTIAL_TOKEN_PREFIX_LENGTH = 16;
export const MIN_CREDENTIAL_TOKEN_LENGTH = 40;

export type CredentialUsageSurface = "rest" | "mcp" | "cli" | "oauth" | "terminal";

export function deriveCredentialPrefix(rawKey: string): string | null {
  if (
    !rawKey.startsWith(CREDENTIAL_TOKEN_PREFIX) ||
    rawKey.length < MIN_CREDENTIAL_TOKEN_LENGTH
  ) {
    return null;
  }

  return rawKey.slice(0, CREDENTIAL_TOKEN_PREFIX_LENGTH);
}

export function isCredentialExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!expiresAt) return false;

  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return true;

  return expiresMs <= now.getTime();
}

export function normalizeAllowedMarts(
  allowedMarts: readonly string[] | null | undefined,
  options: { nullMeansWildcard: boolean }
): string[] {
  if (allowedMarts && allowedMarts.length > 0) {
    return [...allowedMarts];
  }

  return options.nullMeansWildcard ? ["*"] : [];
}
