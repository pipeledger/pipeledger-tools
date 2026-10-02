const PIPELEDGER_APEX_HOSTS = new Set([
  "pipeledger.ai",
  "www.pipeledger.ai",
]);

export const PIPELEDGER_APP_HOST = "app.pipeledger.ai";
export const PIPELEDGER_APP_ORIGIN = `https://${PIPELEDGER_APP_HOST}`;

function hostnameOnly(host: string): string {
  return host.split(":")[0]?.toLowerCase() ?? "";
}

/**
 * Normalize application and API origins without rewriting local or preview
 * hosts. Production marketing hosts always resolve to the canonical app host.
 */
export function canonicalPipeLedgerAppOrigin(input: string | URL): string {
  const url = new URL(input);
  if (PIPELEDGER_APEX_HOSTS.has(hostnameOnly(url.host))) {
    url.hostname = PIPELEDGER_APP_HOST;
  }
  return url.origin;
}
