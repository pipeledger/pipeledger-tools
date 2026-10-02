/**
 * Saved credentials ("profiles") and the rule that selects one.
 *
 * A person who works for several organizations keeps one saved credential
 * for each. The CLI never guesses between them: a command runs against the
 * profile named by `--profile`, else the one bound to the working folder,
 * else the default chosen with `pl switch`, else the only one saved. When
 * several are saved and none is selected, the command stops.
 *
 * Secrets live only in the user's own configuration directory. A folder
 * marker names a profile and its organization; it never holds a credential,
 * so a client folder can be synced, shared, or read by an agent.
 *
 * This module only finds and selects files. Reading and writing credential
 * contents, with their permission checks, stays in config.ts.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  lstatSync,
  renameSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { dirname, join, parse, resolve } from "path";
import {
  CLI_PROFILE_NAME_PATTERN,
  cliProfileNameFromOrganization,
} from "shared/src/public-client";
import { LocalCliError } from "./local-error";

export const FOLDER_MARKER_FILE = ".pipeledger.json";
const DEFAULT_PROFILE_FILE = "default-profile";
const ORGANIZATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_NAME_PATTERN = CLI_PROFILE_NAME_PATTERN;

export interface SavedProfile {
  name: string;
  file: string;
}

export interface FolderMarker {
  file: string;
  profile: string;
  orgId: string | null;
}

export type ProfileSelectedBy = "option" | "folder" | "default" | "only";

export type CredentialSelection =
  | { kind: "file"; file: string }
  | {
      kind: "profile";
      profile: SavedProfile;
      selectedBy: ProfileSelectedBy;
      marker: FolderMarker | null;
    }
  | { kind: "none" };

export function homeConfigDir(): string {
  return join(homedir(), ".pipeledger");
}

export function profilesDir(): string {
  return join(homeConfigDir(), "profiles");
}

export function profileFile(name: string): string {
  return join(profilesDir(), `${assertProfileName(name)}.json`);
}

export function assertProfileName(name: string): string {
  const trimmed = name.trim();
  if (!PROFILE_NAME_PATTERN.test(trimmed)) {
    throw new LocalCliError(
      "A profile name uses lowercase letters, digits, and hyphens, starts with a letter or digit, and is at most 63 characters. Example: riverside-lumber.",
      "E_CLI_INPUT",
    );
  }
  return trimmed;
}

export function profileNameFromOrganization(organizationName: string): string {
  return cliProfileNameFromOrganization(organizationName);
}

function listDirectory(directory: string): string[] {
  try {
    return readdirSync(directory).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new LocalCliError("Could not list saved profiles. Check your configuration directory permissions; no other profile was selected.", "E_CLI_CONFIG_SECURITY");
  }
}

/**
 * Every saved credential. A profile is one file in the profiles directory,
 * named after the profile. No other location is read.
 */
export function listSavedProfiles(): SavedProfile[] {
  const directory = profilesDir();
  return listDirectory(directory).flatMap((entry) => {
    if (!entry.endsWith(".json")) return [];
    const name = entry.slice(0, -".json".length);
    return PROFILE_NAME_PATTERN.test(name)
      ? [{ name, file: join(directory, entry) }]
      : [];
  });
}

function defaultProfilePath(): string {
  return join(homeConfigDir(), DEFAULT_PROFILE_FILE);
}

/** Atomic replacement prevents concurrent readers from observing a truncated selection. */
export function writeSelectionFile(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    try {
      if (!lstatSync(file).isFile()) throw new Error("not a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function readDefaultProfileName(): string | null {
  try {
    if (!lstatSync(defaultProfilePath()).isFile()) throw new Error("not a file");
    const name = readFileSync(defaultProfilePath(), "utf-8").trim();
    if (!PROFILE_NAME_PATTERN.test(name)) throw new Error("invalid name");
    return name;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new LocalCliError("The saved default cannot be read. Run `pl switch <name>` to choose it again. No other profile was selected.", "E_CLI_CONFIG_SECURITY");
  }
}

export function writeDefaultProfileName(name: string): void {
  const directory = homeConfigDir();
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeSelectionFile(defaultProfilePath(), `${assertProfileName(name)}\n`);
  } catch (error) {
    if (error instanceof LocalCliError) throw error;
    throw new LocalCliError(
      "Could not save the default profile. Check that you own your PipeLedger configuration directory.",
      "E_CLI_CONFIG_WRITE",
    );
  }
}

function parseFolderMarker(file: string): FolderMarker {
  const invalid = new LocalCliError(
    `The folder marker ${JSON.stringify(file)} is not valid. It must be JSON with a "profile" name and an organization UUID ("org_id"). Run \`pl link <name>\` in that folder to rewrite it.`,
    "E_CLI_FILE_JSON",
  );
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    throw invalid;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid;
  const fields = raw as Record<string, unknown>;
  if (
    typeof fields.profile !== "string" ||
    !PROFILE_NAME_PATTERN.test(fields.profile) ||
    typeof fields.org_id !== "string" ||
    !ORGANIZATION_ID_PATTERN.test(fields.org_id)
  ) {
    throw invalid;
  }
  return {
    file,
    profile: fields.profile,
    orgId: typeof fields.org_id === "string" ? fields.org_id : null,
  };
}

/** The marker in exactly this folder, ignoring the folders above it. */
export function readFolderMarkerAt(directory: string): FolderMarker | null {
  const candidate = join(resolve(directory), FOLDER_MARKER_FILE);
  try {
    if (!lstatSync(candidate).isFile()) {
      throw new LocalCliError("The folder marker must be a regular file, not a link or directory.", "E_CLI_CONFIG_SECURITY");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof LocalCliError) throw error;
    throw new LocalCliError("Could not inspect the folder link. Nothing was changed.", "E_CLI_CONFIG_SECURITY");
  }
  return parseFolderMarker(candidate);
}

/** The nearest marker at or above the working folder. */
export function findFolderMarker(startDirectory: string): FolderMarker | null {
  let directory = resolve(startDirectory);
  const root = parse(directory).root;
  for (;;) {
    const candidate = join(directory, FOLDER_MARKER_FILE);
    try {
      if (!lstatSync(candidate).isFile()) {
        throw new LocalCliError("The folder marker must be a regular file, not a link or directory.", "E_CLI_CONFIG_SECURITY");
      }
      return parseFolderMarker(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof LocalCliError) throw error;
        throw new LocalCliError("Could not inspect the folder link. No default was selected.", "E_CLI_CONFIG_SECURITY");
      }
    }
    if (directory === root) return null;
    directory = dirname(directory);
  }
}

export function writeFolderMarker(
  directory: string,
  marker: { profile: string; orgId: string | null },
): string {
  if (!marker.orgId || !ORGANIZATION_ID_PATTERN.test(marker.orgId)) {
    throw new LocalCliError("This profile has no valid organization ID. Run `pl login` with a new profile name before linking a folder to it.", "E_CLI_AUTH_REQUIRED");
  }
  const file = join(resolve(directory), FOLDER_MARKER_FILE);
  const contents = {
    profile: assertProfileName(marker.profile),
    org_id: marker.orgId,
  };
  try {
    writeSelectionFile(file, `${JSON.stringify(contents, null, 2)}\n`);
  } catch {
    throw new LocalCliError(
      `Could not write ${JSON.stringify(file)}. Check that you can write to this folder.`,
      "E_CLI_CONFIG_WRITE",
    );
  }
  return file;
}

/**
 * Write the marker only when the folder has none. Returns null when one is
 * already there, so two initializers can never both believe they bound it.
 */
export function createFolderMarker(
  directory: string,
  marker: { profile: string; orgId: string | null },
): string | null {
  if (!marker.orgId || !ORGANIZATION_ID_PATTERN.test(marker.orgId)) {
    throw new LocalCliError("This profile has no valid organization ID. Run `pl login` with a new profile name before linking a folder to it.", "E_CLI_AUTH_REQUIRED");
  }
  const file = join(resolve(directory), FOLDER_MARKER_FILE);
  const contents = {
    profile: assertProfileName(marker.profile),
    org_id: marker.orgId,
  };
  try {
    writeFileSync(file, `${JSON.stringify(contents, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw new LocalCliError(
      `Could not write ${JSON.stringify(file)}. Check that you can write to this folder.`,
      "E_CLI_CONFIG_WRITE",
    );
  }
  return file;
}

function describeProfileNames(profiles: readonly SavedProfile[]): string {
  return profiles.map((profile) => profile.name).join(", ");
}

export function requireSavedProfile(
  name: string,
  reason: string,
): SavedProfile {
  const profiles = listSavedProfiles();
  const profile = profiles.find((entry) => entry.name === name);
  if (profile) return profile;
  const saved =
    profiles.length > 0
      ? `Saved profiles: ${describeProfileNames(profiles)}.`
      : "No credential is saved on this computer.";
  throw new LocalCliError(
    `${reason} ${saved} Run \`pl login --profile ${name}\` to save it, or \`pl switch\` to see what is saved.`,
    "E_CLI_AUTH_REQUIRED",
  );
}

/**
 * Select the credential a command runs against. The caller has already
 * handled PIPELEDGER_CREDENTIAL_SECRET, which needs no file.
 */
export function selectCredentialSource(
  workingDirectory: string = process.cwd(),
): CredentialSelection {
  const explicitFile = process.env.PIPELEDGER_CONFIG_FILE?.trim();
  if (explicitFile) return { kind: "file", file: explicitFile };

  const requested = process.env.PIPELEDGER_PROFILE?.trim();
  if (requested) {
    const name = assertProfileName(requested);
    return {
      kind: "profile",
      profile: requireSavedProfile(name, `No saved profile is named "${name}".`),
      selectedBy: "option",
      marker: null,
    };
  }

  const marker = findFolderMarker(workingDirectory);
  if (marker) {
    return {
      kind: "profile",
      profile: requireSavedProfile(
        marker.profile,
        `This folder is linked to the profile "${marker.profile}" by ${JSON.stringify(marker.file)}, and that profile is not saved on this computer.`,
      ),
      selectedBy: "folder",
      marker,
    };
  }

  const profiles = listSavedProfiles();
  const defaultName = readDefaultProfileName();
  if (defaultName) {
    const profile = requireSavedProfile(defaultName, "The selected default is missing. No other profile was selected.");
    return { kind: "profile", profile, selectedBy: "default", marker: null };
  }

  if (profiles.length === 0) return { kind: "none" };
  if (profiles.length === 1) {
    return {
      kind: "profile",
      profile: profiles[0],
      selectedBy: "only",
      marker: null,
    };
  }

  throw new LocalCliError(
    `Several credentials are saved and none is selected, so \`pl\` will not guess which organization you mean. Saved profiles: ${describeProfileNames(profiles)}. Run \`pl switch <name>\` to choose a default, \`pl link <name>\` to link this folder, or add \`--profile <name>\` to one command.`,
    "E_CLI_AUTH_REQUIRED",
  );
}

/** Ambient credentials must never silently defeat a requested client. */
export function assertUnambiguousCredentialSettings(): void {
  const secret = Boolean(process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim());
  const file = Boolean(process.env.PIPELEDGER_CONFIG_FILE?.trim());
  const profile = Boolean(process.env.PIPELEDGER_PROFILE?.trim());
  const folder = (secret || file) && findFolderMarker(process.cwd()) !== null;
  if ((secret && (file || profile || folder)) || (file && (profile || folder))) {
    throw new LocalCliError(
      "Credential settings conflict. Unset PIPELEDGER_CREDENTIAL_SECRET or PIPELEDGER_CONFIG_FILE before using a profile or linked folder. Nothing was sent or removed.",
      "E_CLI_AUTH_REQUIRED",
    );
  }
}
