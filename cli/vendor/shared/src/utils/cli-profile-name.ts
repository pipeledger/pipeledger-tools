/**
 * Names for saved CLI credentials ("profiles").
 *
 * The CLI saves one file for each profile, named after it, and the web
 * application offers a credential file to download under the same name. Both
 * derive the name here so the downloaded file is already named the way the
 * CLI expects.
 *
 * Ships inside the public CLI package through `public-client.ts`.
 */

export const CLI_PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** "Riverside Lumber Co." becomes "riverside-lumber-co". */
export function cliProfileNameFromOrganization(organizationName: string): string {
  const slug = organizationName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return CLI_PROFILE_NAME_PATTERN.test(slug) ? slug : "organization";
}
