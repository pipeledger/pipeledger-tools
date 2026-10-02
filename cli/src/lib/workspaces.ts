/**
 * Client workspaces: the folders `pl init` creates, and the registry that
 * remembers where they are.
 *
 * A workspace is an ordinary folder for one organization: the instructions
 * an agent reads first, the reference material, the notes, the reports, and
 * the folder marker that names which books it reads. It holds no credential.
 *
 * The registry is a locator only. It lets `pl switch` show where an
 * organization's folders are. Which books a command reads is still decided
 * by the folder marker and the authenticated organization check, so a stale
 * or edited registry can never point a command at another organization.
 *
 * Everything written here is written once. An existing file is never
 * replaced, so instructions a person has edited survive every later run.
 */

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { CLI_PROFILE_NAME_PATTERN } from "shared/src/public-client";
import { LocalCliError } from "./local-error";
import {
  FOLDER_MARKER_FILE,
  createFolderMarker,
  findFolderMarker,
  homeConfigDir,
  readFolderMarkerAt,
  writeSelectionFile,
  type FolderMarker,
} from "./profiles";

const REGISTRY_FILE = "workspaces.json";
const REGISTRY_VERSION = 1;
const ORGANIZATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CLIENTS_FOLDER = "clients";
export const METHODS_FOLDER = "methods";
const CLIENT_FILES = ["AGENTS.md", "CLAUDE.md", FOLDER_MARKER_FILE] as const;
const CLIENT_SUBFOLDERS = ["reference", "notes", "reports"] as const;
const METHODS_SUBFOLDERS = ["procedures", "templates"] as const;

export interface RegisteredWorkspace {
  orgId: string;
  path: string;
}

export interface WorkspaceRegistry {
  /** The folder that holds `clients/` and `methods/`. Null until chosen. */
  root: string | null;
  workspaces: RegisteredWorkspace[];
}

export function workspaceRegistryFile(): string {
  return join(homeConfigDir(), REGISTRY_FILE);
}

/**
 * Where workspaces go when the person has not chosen: `Documents/PipeLedger`
 * in the home folder when a Documents folder exists there, otherwise
 * `PipeLedger` in the home folder. The home folder is the one of the system
 * `pl` runs in, so under WSL it is the Linux home, not the Windows one.
 */
export function defaultWorkspaceRoot(): string {
  const documents = join(homedir(), "Documents");
  try {
    if (lstatSync(documents).isDirectory()) return join(documents, "PipeLedger");
  } catch {
    // No Documents folder here.
  }
  return join(homedir(), "PipeLedger");
}

function invalidRegistry(): LocalCliError {
  return new LocalCliError(
    `The workspace list ${JSON.stringify(workspaceRegistryFile())} is not valid. It holds folder locations only, no credential. Delete it and run \`pl init\` again to rebuild it. Nothing was changed.`,
    "E_CLI_FILE_JSON",
  );
}

export function readWorkspaceRegistry(): WorkspaceRegistry {
  const file = workspaceRegistryFile();
  let text: string;
  try {
    if (!lstatSync(file).isFile()) throw invalidRegistry();
    text = readFileSync(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { root: null, workspaces: [] };
    }
    if (error instanceof LocalCliError) throw error;
    throw new LocalCliError("Could not read the workspace list. Check your configuration directory permissions. Nothing was changed.", "E_CLI_CONFIG_SECURITY");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalidRegistry();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidRegistry();
  const fields = raw as Record<string, unknown>;
  if (fields.version !== REGISTRY_VERSION || !Array.isArray(fields.workspaces)) {
    throw invalidRegistry();
  }
  if (fields.root !== null && (typeof fields.root !== "string" || !isAbsolute(fields.root))) {
    throw invalidRegistry();
  }
  const workspaces = fields.workspaces.map((entry): RegisteredWorkspace => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidRegistry();
    const item = entry as Record<string, unknown>;
    if (
      typeof item.org_id !== "string" ||
      !ORGANIZATION_ID_PATTERN.test(item.org_id) ||
      typeof item.path !== "string" ||
      !isAbsolute(item.path)
    ) {
      throw invalidRegistry();
    }
    return { orgId: item.org_id, path: item.path };
  });
  return { root: fields.root, workspaces };
}

function writeWorkspaceRegistry(registry: WorkspaceRegistry): void {
  const contents = {
    version: REGISTRY_VERSION,
    root: registry.root,
    workspaces: registry.workspaces.map((workspace) => ({
      org_id: workspace.orgId,
      path: workspace.path,
    })),
  };
  try {
    mkdirSync(homeConfigDir(), { recursive: true, mode: 0o700 });
    writeSelectionFile(workspaceRegistryFile(), `${JSON.stringify(contents, null, 2)}\n`);
  } catch {
    throw new LocalCliError(
      "Could not save the workspace list. Check that you own your PipeLedger configuration directory.",
      "E_CLI_CONFIG_WRITE",
    );
  }
}

/** True when the folder still carries a marker for this organization. */
function stillBound(workspace: RegisteredWorkspace): boolean {
  try {
    return readFolderMarkerAt(workspace.path)?.orgId?.toLowerCase() === workspace.orgId.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The folders registered for an organization that are still bound to it. A
 * folder that was moved, deleted, or rebound to another organization is left
 * out: the registry only helps find folders, it never vouches for one.
 */
export function workspaceFoldersByOrganization(): Map<string, string[]> {
  let registry: WorkspaceRegistry;
  try {
    registry = readWorkspaceRegistry();
  } catch (error) {
    // A broken locator must not stop `pl switch` from listing credentials.
    if (error instanceof LocalCliError) return new Map();
    throw error;
  }
  const folders = new Map<string, string[]>();
  for (const workspace of registry.workspaces) {
    if (!stillBound(workspace)) continue;
    const key = workspace.orgId.toLowerCase();
    folders.set(key, [...(folders.get(key) ?? []), workspace.path]);
  }
  return folders;
}

/**
 * Record a bound folder, and the workspace root when one is given. Entries
 * whose folder is no longer bound to their organization are dropped.
 */
export function registerWorkspace(
  workspace: RegisteredWorkspace,
  root?: string,
): void {
  const registry = readWorkspaceRegistry();
  const path = resolve(workspace.path);
  const kept = registry.workspaces.filter(
    (entry) => resolve(entry.path) !== path && stillBound(entry),
  );
  writeWorkspaceRegistry({
    root: root ?? registry.root,
    workspaces: [...kept, { orgId: workspace.orgId, path }].sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
  });
}

/**
 * Where a path really is: links in the part that already exists are
 * followed, and the part still to be created is kept as written. A guard
 * that compared the path as typed would accept a link into the place it
 * guards.
 */
function realLocation(path: string): string {
  let existing = resolve(path);
  const pending: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(existing), ...pending);
    } catch (error) {
      const parent = dirname(existing);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === existing) {
        throw new LocalCliError(
          `Could not inspect ${JSON.stringify(path)}. Check that you can read that location. Nothing was changed.`,
          "E_CLI_CONFIG_WRITE",
        );
      }
      pending.unshift(basename(existing));
      existing = parent;
    }
  }
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function assertWorkspaceFolderName(name: string): string {
  const trimmed = name.trim();
  if (!CLI_PROFILE_NAME_PATTERN.test(trimmed)) {
    throw new LocalCliError(
      "A workspace folder name uses lowercase letters, digits, and hyphens, starts with a letter or digit, and is at most 63 characters. Example: riverside-lumber-co.",
      "E_CLI_INPUT",
    );
  }
  return trimmed;
}

export function agentInstructions(input: {
  organizationName: string;
  orgId: string;
  methodsFolder: string;
}): string {
  return `# ${input.organizationName}

## About this workspace

This workspace is for ${input.organizationName} only.

- Read this workspace and the methods folder at \`${input.methodsFolder}\`.
- Save client work only inside this workspace.
- Do not access other clients' folders.
- Consult the reference material in \`reference/\` that is relevant to the task.
- Record confirmed client decisions in \`notes/\`. Propose changes to these
  instructions for my review; do not change them yourself.
- Save requested deliverables in \`reports/\`.

## Reading the books

- Run \`pl\` from inside this workspace, so the folder chooses the books.
- Start with \`pl whoami\`. It must report the organization
  ${input.organizationName} with Org ID \`${input.orgId}\`. If it reports anything
  else, stop and tell me. Do not read figures for another organization.
- Use \`pl\` for ledger figures. Do not answer from memory.
- Label your own calculations and assumptions separately from figures that
  came from \`pl\`.

## The client

Describe the business here: what it does, its legal entities, its reporting
calendar, and who reads the reports.

## How I want work done

Describe your standards here: the level of detail, the evidence to show, and
anything the agent must never do.
`;
}

/** Claude reads CLAUDE.md. It points to the one set of instructions. */
const CLAUDE_POINTER = `The instructions for this workspace are in AGENTS.md.

@AGENTS.md
`;

const METHODS_README = `# Your methods

Your own methods, reused for every client: written procedures in \`procedures/\`, document
templates in \`templates/\`.

Keep this folder free of client information. Anything that names a client or
holds a client's figures belongs in that client's workspace.
`;

export interface CreatedWorkspace {
  root: string;
  folder: string;
  methodsFolder: string;
  markerFile: string;
  /** Names relative to the workspace folder, in the order they were handled. */
  created: string[];
  kept: string[];
  /** The profile an existing marker names, when it is not the requested one. */
  boundToOtherProfile: string | null;
}

/**
 * A name the workspace needs must be free, or already be what it should be.
 * A folder where a file belongs, or a link that leads nowhere, would be
 * "kept" by an exclusive create and leave the workspace unusable.
 */
function assertUsable(path: string, kind: "file" | "folder"): void {
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  let usable = false;
  try {
    const stats = statSync(path);
    usable = kind === "file" ? stats.isFile() : stats.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (usable) return;
  throw new LocalCliError(
    `${JSON.stringify(path)} exists and is not a ${kind}. Move it, then run \`pl init\` again. Nothing was changed.`,
    "E_CLI_CONFIG_WRITE",
  );
}

function boundElsewhere(folder: string): LocalCliError {
  return new LocalCliError(
    `${JSON.stringify(folder)} is already linked to another organization by its ${FOLDER_MARKER_FILE}. Its link and instructions were left as they are. Choose another folder name with \`--folder\`.`,
    "E_CLI_INPUT",
  );
}

/**
 * Bind the folder to the organization, or confirm it already is. This is the
 * claim: it happens before any client file is written, and it never replaces
 * a marker, so when two initializers reach one folder only one of them can
 * go on to write instructions there.
 */
export function claimWorkspaceFolder(
  folder: string,
  wanted: { profile: string; orgId: string },
): { marker: FolderMarker; claimed: boolean } {
  const file = createFolderMarker(folder, wanted);
  if (file !== null) {
    return { marker: { file, profile: wanted.profile, orgId: wanted.orgId }, claimed: true };
  }
  const marker = readFolderMarkerAt(folder);
  if (!marker || marker.orgId?.toLowerCase() !== wanted.orgId.toLowerCase()) {
    throw boundElsewhere(folder);
  }
  return { marker, claimed: false };
}

function writeOnce(file: string, contents: string): boolean {
  try {
    writeFileSync(file, contents, { flag: "wx", mode: 0o644 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function makeFolder(directory: string): boolean {
  assertUsable(directory, "folder");
  try {
    lstatSync(directory);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mkdirSync(directory, { recursive: true });
    return true;
  }
}

/**
 * Create, or complete, the workspace folder for one organization. Existing
 * files and folders are kept as they are.
 */
export function createClientWorkspace(input: {
  root: string;
  folderName: string;
  profile: string;
  orgId: string;
  organizationName: string;
}): CreatedWorkspace {
  const root = resolve(input.root);
  if (isInside(realLocation(homeConfigDir()), realLocation(root))) {
    throw new LocalCliError(
      "The workspace root cannot be inside your PipeLedger configuration directory, which holds your credentials. Choose another folder with `--root`.",
      "E_CLI_INPUT",
    );
  }
  const clients = join(root, CLIENTS_FOLDER);
  const folder = join(clients, assertWorkspaceFolderName(input.folderName));
  const methodsFolder = join(root, METHODS_FOLDER);

  // Checked first so the usual refusals change nothing at all. The claim
  // below repeats the first one where it cannot be raced.
  const found = readFolderMarkerAt(folder);
  if (found && found.orgId?.toLowerCase() !== input.orgId.toLowerCase()) {
    throw boundElsewhere(folder);
  }
  const above = findFolderMarker(realLocation(dirname(folder)));
  if (above) {
    throw new LocalCliError(
      `A workspace cannot sit inside a linked folder, and ${JSON.stringify(above.file)} links a folder above ${JSON.stringify(folder)}. Nothing was changed. Choose another location with \`--root\`.`,
      "E_CLI_INPUT",
    );
  }

  const created: string[] = [];
  const kept: string[] = [];
  const record = (name: string, isNew: boolean) => (isNew ? created : kept).push(name);

  let claim: ReturnType<typeof claimWorkspaceFolder>;
  try {
    assertUsable(methodsFolder, "folder");
    for (const name of METHODS_SUBFOLDERS) assertUsable(join(methodsFolder, name), "folder");
    assertUsable(join(methodsFolder, "README.md"), "file");
    assertUsable(folder, "folder");
    for (const name of CLIENT_FILES) assertUsable(join(folder, name), "file");
    for (const name of CLIENT_SUBFOLDERS) assertUsable(join(folder, name), "folder");

    makeFolder(methodsFolder);
    for (const name of METHODS_SUBFOLDERS) makeFolder(join(methodsFolder, name));
    writeOnce(join(methodsFolder, "README.md"), METHODS_README);

    makeFolder(folder);
    claim = claimWorkspaceFolder(folder, { profile: input.profile, orgId: input.orgId });
    record(
      "AGENTS.md",
      writeOnce(
        join(folder, "AGENTS.md"),
        agentInstructions({
          organizationName: input.organizationName,
          orgId: input.orgId,
          methodsFolder,
        }),
      ),
    );
    record("CLAUDE.md", writeOnce(join(folder, "CLAUDE.md"), CLAUDE_POINTER));
    for (const name of CLIENT_SUBFOLDERS) record(`${name}/`, makeFolder(join(folder, name)));
  } catch (error) {
    if (error instanceof LocalCliError) throw error;
    throw new LocalCliError(
      `Could not create the workspace in ${JSON.stringify(folder)}. Check that you can write there, or choose another location with \`--root\`.`,
      "E_CLI_CONFIG_WRITE",
    );
  }

  record(FOLDER_MARKER_FILE, claim.claimed);

  return {
    root,
    folder,
    methodsFolder,
    markerFile: claim.marker.file,
    created,
    kept,
    boundToOtherProfile:
      claim.marker.profile !== input.profile ? claim.marker.profile : null,
  };
}
