/**
 * CLI configuration management.
 * Reads and writes saved credentials: named profiles under
 * ~/.pipeledger/profiles/. profiles.ts decides which one a command uses.
 * Set PIPELEDGER_CONFIG_FILE to point at one specific file instead.
 *
 * Security:
 *  - POSIX: owner-only files, repaired before a file-backed config is read
 *  - Windows: NTFS ACLs via icacls (restrict to current user + SYSTEM)
 */

import fs, {
  existsSync,
  mkdirSync,
  readFileSync,
  type Stats,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { basename, dirname, join } from "path";
import { platform } from "process";
import {
  PipeLedgerCliConfigSchema,
  type PipeLedgerCliConfig,
} from "shared/src/public-client";
import { LocalCliError } from "./local-error";
import {
  assertUnambiguousCredentialSettings,
  writeDefaultProfileName,
  listSavedProfiles,
  profileFile,
  readDefaultProfileName,
  selectCredentialSource,
  type CredentialSelection,
  type SavedProfile,
} from "./profiles";

export type CliConfig = PipeLedgerCliConfig;

const IS_WINDOWS = platform === "win32";
const OWNER_READ_WRITE_MODE = 0o600;
const GROUP_OR_OTHER_MODE_MASK = 0o077;
const GROUP_OR_OTHER_WRITE_MODE_MASK = 0o022;
const POSIX_READ_FLAGS =
  fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const POSIX_CREATE_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_EXCL |
  fs.constants.O_NOFOLLOW |
  fs.constants.O_NONBLOCK;

/** The selection, or null when the selected file does not exist. */
function existingSelection(): CredentialSelection | null {
  const selection = selectCredentialSource();
  if (selection.kind === "none") return null;
  if (selection.kind === "file" && !existsSync(selection.file)) return null;
  return selection;
}

function selectionFile(selection: CredentialSelection | null): string | null {
  if (!selection || selection.kind === "none") return null;
  return selection.kind === "file" ? selection.file : selection.profile.file;
}

function existingConfigFile(): string | null {
  return selectionFile(existingSelection());
}

function configPathLabel(filePath: string): string {
  return JSON.stringify(filePath);
}

function configSecurityError(message: string, filePath: string): LocalCliError {
  return new LocalCliError(
    `${message} Config file: ${configPathLabel(filePath)}.`,
    "E_CLI_CONFIG_SECURITY",
  );
}

function unsafePermissionsError(filePath: string): LocalCliError {
  return configSecurityError(
    "The PipeLedger credential file could not be restricted to owner-only permissions. Run `chmod 600 <config-file>` and retry. If chmod is unsupported, move it to a filesystem that supports POSIX permissions.",
    filePath,
  );
}

function assertSafePosixConfigFile(filePath: string, stats: Stats): void {
  if (!stats.isFile()) {
    throw configSecurityError(
      "The PipeLedger credential path must be a regular file.",
      filePath,
    );
  }

  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  if (currentUid !== undefined && stats.uid !== currentUid) {
    throw configSecurityError(
      "The PipeLedger credential file must be owned by the current user. Change its ownership or move it to your own config directory before retrying.",
      filePath,
    );
  }
}

function openPosixConfigFile(filePath: string, flags: number): number {
  try {
    return fs.openSync(filePath, flags, OWNER_READ_WRITE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ELOOP") {
      throw configSecurityError(
        "The PipeLedger credential path must not be a symbolic link.",
        filePath,
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      throw configSecurityError(
        "The CLI could not safely open the PipeLedger credential file. Ensure you own the file and its config directory, run `chmod 600 <config-file>`, and retry.",
        filePath,
      );
    }
    throw error;
  }
}

function inspectPosixConfigFile(
  filePath: string,
  descriptor: number,
): Stats {
  try {
    return fs.fstatSync(descriptor);
  } catch {
    throw configSecurityError(
      "The CLI could not verify the PipeLedger credential file before using it.",
      filePath,
    );
  }
}

function restrictPosixConfigFile(
  filePath: string,
  descriptor: number,
): void {
  try {
    fs.fchmodSync(descriptor, OWNER_READ_WRITE_MODE);
  } catch {
    throw unsafePermissionsError(filePath);
  }

  const repaired = inspectPosixConfigFile(filePath, descriptor);
  if ((repaired.mode & GROUP_OR_OTHER_MODE_MASK) !== 0) {
    throw unsafePermissionsError(filePath);
  }
}

function reportPermissionRepair(): void {
  console.error(
    "Security notice: PipeLedger restricted the CLI credential file to owner-only permissions (0600). " +
      "If another local user could have accessed it earlier, rotate the credential.",
  );
}

/** Repair a copied POSIX config and read the same verified inode. */
function readPosixConfigFile(filePath: string): string {
  const descriptor = openPosixConfigFile(filePath, POSIX_READ_FLAGS);
  try {
    const initial = inspectPosixConfigFile(filePath, descriptor);
    assertSafePosixConfigFile(filePath, initial);

    if ((initial.mode & GROUP_OR_OTHER_WRITE_MODE_MASK) !== 0) {
      throw configSecurityError(
        "The PipeLedger credential file is writable by another user, so the CLI will not trust or read it. Replace it with a fresh download, set its mode to 0600, and rotate the credential if it may have been exposed. If chmod is unsupported, move it to a filesystem that supports POSIX permissions.",
        filePath,
      );
    }

    if ((initial.mode & GROUP_OR_OTHER_MODE_MASK) !== 0) {
      restrictPosixConfigFile(filePath, descriptor);
      reportPermissionRepair();
    }

    return fs.readFileSync(descriptor, "utf-8");
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Secure an old inode before atomically replacing it with a fresh one. */
function secureExistingPosixConfig(filePath: string): boolean {
  let descriptor: number;
  try {
    descriptor = openPosixConfigFile(filePath, POSIX_READ_FLAGS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw error;
  }

  try {
    const initial = inspectPosixConfigFile(filePath, descriptor);
    assertSafePosixConfigFile(filePath, initial);
    const needsRepair = (initial.mode & 0o777) !== OWNER_READ_WRITE_MODE;
    if (needsRepair) restrictPosixConfigFile(filePath, descriptor);
    return needsRepair;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Write a fresh owner-only inode, then atomically replace the selected path. */
function writePosixConfigFile(filePath: string, contents: string): void {
  const repairedExistingFile = secureExistingPosixConfig(filePath);
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor: number | null = null;
  let temporaryFileExists = false;

  try {
    descriptor = openPosixConfigFile(temporaryPath, POSIX_CREATE_FLAGS);
    temporaryFileExists = true;
    const created = inspectPosixConfigFile(filePath, descriptor);
    assertSafePosixConfigFile(filePath, created);
    if ((created.mode & GROUP_OR_OTHER_MODE_MASK) !== 0) {
      // A reader could retain access even after chmod, so never put a secret
      // into an inode that was initially visible to another user.
      throw unsafePermissionsError(filePath);
    }
    restrictPosixConfigFile(filePath, descriptor);

    fs.writeFileSync(descriptor, contents, "utf-8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;

    fs.renameSync(temporaryPath, filePath);
    temporaryFileExists = false;
    if (repairedExistingFile) reportPermissionRepair();
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (temporaryFileExists) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The original config remains untouched; surface the primary failure.
      }
    }
  }
}

/** Lock a file to the current user + SYSTEM on Windows via NTFS ACLs. */
function lockFilePermissions(filePath: string): void {
  if (!IS_WINDOWS) return;

  try {
    const username = process.env.USERNAME ?? process.env.USER ?? "";
    if (!username) return;

    execFileSync(
      "icacls",
      [
        filePath,
        "/inheritance:r",
        "/grant:r",
        `${username}:(R,W)`,
        "/grant:r",
        "SYSTEM:(R,W)",
      ],
      { stdio: "ignore", windowsHide: true },
    );
  } catch {
    console.error(
      "Warning: Could not restrict config file permissions. " +
        "Ensure the configured credential file is readable only by your user."
    );
  }
}

/** Preserve the existing, explicit Windows ACL warning used by `pl whoami`. */
export function checkConfigSecurity(): void {
  if (!IS_WINDOWS || process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim()) return;
  const file = existingConfigFile();
  if (!file) return;

  try {
    const output = execFileSync("icacls", [file], {
      encoding: "utf-8",
      windowsHide: true,
    });
    const dangerousPatterns =
      /\b(Everyone|BUILTIN\\Users|Authenticated Users)\b/i;
    if (dangerousPatterns.test(output)) {
      console.error(
        "\nSecurity warning: Your config file is readable by other users on this machine.\n" +
          "This file contains your service credential. Run `pl login` again to fix permissions.\n"
      );
    }
  } catch {
    // Preserve the existing non-blocking behavior when icacls is unavailable.
  }
}

function readConfigFile(filePath: string): string {
  return IS_WINDOWS
    ? readFileSync(filePath, "utf-8")
    : readPosixConfigFile(filePath);
}

/** Environment credentials take precedence and require no local config file. */
function loadConfigFromEnv(): CliConfig | null {
  const secret = process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim();
  if (!secret) return null;

  const parsed = PipeLedgerCliConfigSchema.safeParse({
    api_url:
      process.env.PIPELEDGER_API_URL?.trim() || "https://app.pipeledger.ai",
    credential_secret: secret,
  });
  if (parsed.success) return parsed.data;

  throw new LocalCliError(
    "PIPELEDGER_CREDENTIAL_SECRET is set but is not a valid PipeLedger service credential.",
    "E_CLI_INPUT",
  );
}

/** Read and validate one credential file. Null when it holds no valid config. */
function readCredentialFile(file: string): CliConfig | null {
  let raw: string;
  try {
    raw = readConfigFile(file);
  } catch (error) {
    if (error instanceof LocalCliError) throw error;
    return null;
  }

  let unvalidated: unknown;
  try {
    unvalidated = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = PipeLedgerCliConfigSchema.safeParse(unvalidated);
  if (parsed.success) return parsed.data;

  const retiredHint = retiredConfigFieldHint(unvalidated, file);
  if (retiredHint) {
    throw new LocalCliError(retiredHint, "E_CLI_AUTH_REQUIRED");
  }
  return null;
}

/**
 * A folder marker records the organization it was bound to. If the profile
 * of that name now holds another organization's credential, stop: running a
 * client's work against a different client's books is the failure this
 * guards against.
 */
function assertMarkerOrganization(
  selection: CredentialSelection,
  config: CliConfig,
): void {
  if (selection.kind !== "profile") return;
  if (!config.org_id) {
    throw new LocalCliError("The selected profile has no organization ID. Run `pl login` with a new profile name. Nothing was sent.", "E_CLI_AUTH_REQUIRED");
  }
  if (!selection.marker?.orgId || config.org_id === selection.marker.orgId) return;
  throw new LocalCliError(
    `This folder is linked to the profile "${selection.profile.name}" for one organization, and that profile now holds a credential for another` +
      (config.org_name ? ` (${config.org_name})` : "") +
      `. Nothing was sent. Check ${configPathLabel(selection.marker.file)}, then run \`pl link <name>\` in this folder to link it to the right profile.`,
    "E_CLI_AUTH_REQUIRED",
  );
}

export function loadConfig(): CliConfig | null {
  assertUnambiguousCredentialSettings();
  const fromEnv = loadConfigFromEnv();
  if (fromEnv) return fromEnv;

  const selection = existingSelection();
  const file = selectionFile(selection);
  if (!selection || !file) return null;

  const config = readCredentialFile(file);
  if (config) assertMarkerOrganization(selection, config);
  return config;
}

/**
 * Save a credential and return the file written: the file named in
 * PIPELEDGER_CONFIG_FILE when set, otherwise the named profile.
 */
export function saveConfig(
  config: CliConfig,
  options: { profile?: string } = {},
): string {
  let profileLock: string | null = null;
  try {
    const validated = PipeLedgerCliConfigSchema.parse(config);
    const explicit = process.env.PIPELEDGER_CONFIG_FILE?.trim();
    if (!explicit && !options.profile) {
      throw new LocalCliError(
        "A credential is saved under a profile name. Run `pl login`, which names the profile after the organization, or `pl login --profile <name>`.",
        "E_CLI_INPUT",
      );
    }
    const file = explicit || profileFile(options.profile as string);
    const directory = dirname(file);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    if (options.profile && !explicit) {
      const lock = `${file}.lock`;
      try {
        const descriptor = fs.openSync(lock, "wx", OWNER_READ_WRITE_MODE);
        profileLock = lock;
        fs.closeSync(descriptor);
      } catch {
        throw new LocalCliError(
          "This profile is being saved by another process, or its save lock is unavailable. Retry after it finishes. If a login was interrupted, remove the profile's .lock file only after confirming no login is running.",
          "E_CLI_CONFIG_WRITE",
        );
      }
      if (existsSync(file)) {
        const existing = readCredentialFile(file);
        if (!existing?.org_id || existing.org_id !== validated.org_id || existing.api_url !== validated.api_url) {
          throw new LocalCliError(
            "This profile belongs to another organization or API, or cannot be verified. Nothing was saved. Choose a new profile name.",
            "E_CLI_AUTH_REQUIRED",
          );
        }
      }
    }
    const contents = JSON.stringify(validated, null, 2);

    if (IS_WINDOWS) {
      writeFileSync(file, contents, { mode: OWNER_READ_WRITE_MODE });
      lockFilePermissions(file);
    } else {
      writePosixConfigFile(file, contents);
    }
    return file;
  } catch (error) {
    if (error instanceof LocalCliError) throw error;
    throw new LocalCliError(
      "Could not save the CLI configuration. Check the config path and permissions.",
      "E_CLI_CONFIG_WRITE",
    );
  } finally {
    if (profileLock) fs.unlinkSync(profileLock);
  }
}

function retiredConfigFieldHint(
  raw: unknown,
  filePath: string,
): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  if (typeof fields.credential_secret === "string") return null;
  const retired = typeof fields.credential === "string"
    ? "credential"
    : typeof fields.api_key === "string"
      ? "api_key"
      : null;
  if (!retired) return null;
  return (
    `The configuration at ${configPathLabel(filePath)} still uses the retired \`${retired}\` field. ` +
    "The PipeLedger CLI now reads `credential_secret`. Run `pl login` again to " +
    "rewrite it, or rename that one field. Your credential is still valid."
  );
}

export function requireConfig(): CliConfig {
  const config = loadConfig();
  if (!config) {
    throw new LocalCliError(
      "Not authenticated. Run `pl login` first, or set PIPELEDGER_CREDENTIAL_SECRET.",
      "E_CLI_AUTH_REQUIRED",
    );
  }
  return config;
}

export function configPath(): string {
  if (process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim()) return "none (environment credential)";
  return existingConfigFile() ?? "none";
}

export interface CredentialSource {
  /** How the credential in use was chosen. */
  selectedBy:
    | "environment"
    | "config_file"
    | "option"
    | "folder"
    | "default"
    | "only";
  profile: string | null;
  file: string | null;
  /** The folder marker that chose the profile, when one did. */
  markerFile: string | null;
}

/** Where the credential in use comes from, for `pl whoami` and `pl switch`. */
export function describeCredentialSource(): CredentialSource | null {
  assertUnambiguousCredentialSettings();
  if (process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim()) {
    return {
      selectedBy: "environment",
      profile: null,
      file: null,
      markerFile: null,
    };
  }
  const selection = existingSelection();
  if (!selection || selection.kind === "none") return null;
  if (selection.kind === "file") {
    return {
      selectedBy: "config_file",
      profile: null,
      file: selection.file,
      markerFile: null,
    };
  }
  return {
    selectedBy: selection.selectedBy,
    profile: selection.profile.name,
    file: selection.profile.file,
    markerFile: selection.marker?.file ?? null,
  };
}

export interface DescribedProfile extends SavedProfile {
  organizationId: string | null;
  /** Null when the file cannot be read or holds no valid credential. */
  organizationName: string | null;
  readable: boolean;
  isDefault: boolean;
}

/** Every saved profile with the organization it belongs to. No secrets. */
export function describeSavedProfiles(): DescribedProfile[] {
  // Listing must still allow an explicit switch to repair a broken default.
  // This affects display marks only; credential selection remains fail-closed.
  let defaultName: string | null = null;
  try {
    defaultName = readDefaultProfileName();
  } catch (error) {
    if (!(error instanceof LocalCliError)) throw error;
  }
  return listSavedProfiles().map((profile) => {
    let config: CliConfig | null = null;
    try {
      config = readCredentialFile(profile.file);
    } catch {
      config = null;
    }
    return {
      ...profile,
      organizationId: config?.org_id ?? null,
      organizationName: config?.org_name ?? null,
      readable: config !== null,
      isDefault: profile.name === defaultName,
    };
  });
}

export interface RemovedCredentialFile {
  /** The file that was removed, or null when no saved credential existed. */
  removed: string | null;
  /** The profile that file belonged to, when it was a profile. */
  profile: string | null;
  /** Profiles still saved. None of them is selected on the user's behalf. */
  remaining: string[];
  /** True when PIPELEDGER_CREDENTIAL_SECRET still supplies a credential. */
  environmentCredential: boolean;
}

/**
 * Remove the one credential file `pl` is reading. Other saved files are left
 * in place and reported, because a credential is shown once and a file the
 * user placed deliberately cannot be recovered after deletion.
 */
export function removeActiveCredentialFile(): RemovedCredentialFile {
  const environmentCredential = Boolean(
    process.env.PIPELEDGER_CREDENTIAL_SECRET?.trim()
  );
  assertUnambiguousCredentialSettings();
  if (environmentCredential) {
    return { removed: null, profile: null, remaining: [], environmentCredential };
  }
  const selection = existingSelection();
  const file = selectionFile(selection);
  if (!selection || !file) {
    return { removed: null, profile: null, remaining: [], environmentCredential };
  }
  const profile = selection.kind === "profile" ? selection.profile.name : null;
  if (selection.kind === "profile" && selection.marker) {
    const config = readCredentialFile(file);
    if (!config) {
      throw new LocalCliError("The linked profile cannot be verified. Use `pl logout --profile <name>` to explicitly remove that file.", "E_CLI_AUTH_REQUIRED");
    }
    assertMarkerOrganization(selection, config);
  }

  // Keep a missing selected default as a stop marker. Logout must not make
  // the last remaining client's credential active implicitly.
  if (profile !== null && readDefaultProfileName() === null) {
    writeDefaultProfileName(profile);
  }
  try {
    fs.rmSync(file);
  } catch {
    throw new LocalCliError(
      `Could not remove the PipeLedger credential file. Check that you own it, then delete it yourself. Config file: ${configPathLabel(file)}.`,
      "E_CLI_CONFIG_WRITE",
    );
  }
  return {
    removed: file,
    profile,
    remaining:
      selection.kind === "file"
        ? []
        : listSavedProfiles().map((entry) => entry.name),
    environmentCredential,
  };
}
