import assert from "node:assert/strict";
import fs, {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PipeLedgerCliConfigSchema } from "shared/src/public-client";

import {
  describeCredentialSource,
  describeSavedProfiles,
  loadConfig,
  removeActiveCredentialFile,
  requireConfig,
  saveConfig,
  type CliConfig,
} from "./config";
import {
  FOLDER_MARKER_FILE,
  writeDefaultProfileName,
  writeFolderMarker,
} from "./profiles";
import { LocalCliError } from "./local-error";

const IS_WINDOWS = process.platform === "win32";
const ORIGINAL_ENV = {
  configFile: process.env.PIPELEDGER_CONFIG_FILE,
  credentialSecret: process.env.PIPELEDGER_CREDENTIAL_SECRET,
  apiUrl: process.env.PIPELEDGER_API_URL,
};

const CONFIG: CliConfig = {
  api_url: "https://app.pipeledger.ai",
  credential_secret: `pl_live_${"a".repeat(32)}`,
  org_id: "00000000-0000-4000-8000-000000000001",
  org_name: "Riverside Lumber",
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "pipeledger-cli-config-"));
}

function writeConfig(
  filePath: string,
  mode: number,
  config: unknown = CONFIG,
): void {
  writeFileSync(filePath, JSON.stringify(config, null, 2), { mode });
  fs.chmodSync(filePath, mode);
}

function fileMode(filePath: string): number {
  return statSync(filePath).mode & 0o777;
}

beforeEach(() => {
  delete process.env.PIPELEDGER_CONFIG_FILE;
  delete process.env.PIPELEDGER_CREDENTIAL_SECRET;
  delete process.env.PIPELEDGER_API_URL;
});

afterEach(() => {
  restoreEnv("PIPELEDGER_CONFIG_FILE", ORIGINAL_ENV.configFile);
  restoreEnv("PIPELEDGER_CREDENTIAL_SECRET", ORIGINAL_ENV.credentialSecret);
  restoreEnv("PIPELEDGER_API_URL", ORIGINAL_ENV.apiUrl);
});

describe("POSIX CLI config security", () => {
  it("repairs a copied 0644 config before loading it", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "downloaded-config.json");
    writeConfig(file, 0o644);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    const notices: string[] = [];
    t.mock.method(console, "error", (message: string) => notices.push(message));

    assert.deepEqual(loadConfig(), CONFIG);
    assert.equal(fileMode(file), 0o600);
    assert.equal(notices.length, 1);
    assert.match(notices[0] ?? "", /owner-only permissions \(0600\)/);
  });

  it("leaves an already owner-only config unchanged", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "read-only-config.json");
    writeConfig(file, 0o400);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    const notices: string[] = [];
    t.mock.method(console, "error", (message: string) => notices.push(message));

    assert.deepEqual(loadConfig(), CONFIG);
    assert.equal(fileMode(file), 0o400);
    assert.deepEqual(notices, []);
  });

  it("fails closed when chmod reports success but leaves broad access", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "unsupported-permissions.json");
    writeConfig(file, 0o644);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    t.mock.method(fs, "fchmodSync", () => undefined);

    assert.throws(
      () => loadConfig(),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_CONFIG_SECURITY");
        assert.match(error.message, /could not be restricted/);
        assert.match(error.message, /chmod 600/);
        return true;
      },
    );
    assert.equal(fileMode(file), 0o644);
  });

  it("rejects a group-writable config without trying to repair it", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "writable-config.json");
    writeConfig(file, 0o664);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    let chmodCalls = 0;
    t.mock.method(fs, "fchmodSync", () => {
      chmodCalls += 1;
    });

    assert.throws(
      () => loadConfig(),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_CONFIG_SECURITY");
        assert.match(error.message, /writable by another user/);
        return true;
      },
    );
    assert.equal(chmodCalls, 0);
    assert.equal(fileMode(file), 0o664);
  });

  it("requires the config file to belong to the current user", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "other-owner.json");
    writeConfig(file, 0o600);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    const originalFstat = fs.fstatSync;
    t.mock.method(fs, "fstatSync", (descriptor: number) => {
      const stats = originalFstat(descriptor);
      Object.defineProperty(stats, "uid", { value: stats.uid + 1 });
      return stats;
    });

    assert.throws(
      () => loadConfig(),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_CONFIG_SECURITY");
        assert.match(error.message, /must be owned by the current user/);
        return true;
      },
    );
  });

  it("reports remediation when the config cannot be opened", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "unreadable-config.json");
    writeConfig(file, 0o600);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    t.mock.method(fs, "openSync", () => {
      const error = new Error("permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    });

    assert.throws(
      () => loadConfig(),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_CONFIG_SECURITY");
        assert.match(error.message, /could not safely open/);
        assert.match(error.message, /chmod 600/);
        assert.match(error.message, /unreadable-config\.json/);
        return true;
      },
    );
  });

  it("reads the verified inode even if its path is replaced during repair", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "config.json");
    const movedFile = join(root, "original-config.json");
    writeConfig(file, 0o644);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    const originalFchmod = fs.fchmodSync;
    t.mock.method(console, "error", () => undefined);
    t.mock.method(fs, "fchmodSync", (descriptor: number, mode: number) => {
      originalFchmod(descriptor, mode);
      renameSync(file, movedFile);
      writeConfig(file, 0o600, {
        ...CONFIG,
        api_url: "https://collector.example",
      });
    });

    assert.deepEqual(loadConfig(), CONFIG);
    assert.equal(fileMode(movedFile), 0o600);
  });

  it("rejects a symlink without changing its target", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const target = join(root, "target.json");
    const link = join(root, "config.json");
    writeConfig(target, 0o644);
    symlinkSync(target, link);
    process.env.PIPELEDGER_CONFIG_FILE = link;

    assert.throws(
      () => loadConfig(),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_CONFIG_SECURITY");
        assert.match(error.message, /symbolic link/);
        return true;
      },
    );
    assert.equal(fileMode(target), 0o644);
  });

  it("rejects a directory in place of the credential file", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, "config.json");
    mkdirSync(directory);
    process.env.PIPELEDGER_CONFIG_FILE = directory;

    assert.throws(
      () => loadConfig(),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_CONFIG_SECURITY");
        assert.match(error.message, /must be a regular file/);
        return true;
      },
    );
  });

  it("creates a new config and directory with owner-only access", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const configDirectory = join(root, "nested", "pipeledger");
    const file = join(configDirectory, "config.json");
    process.env.PIPELEDGER_CONFIG_FILE = file;

    saveConfig(CONFIG);

    assert.equal(fileMode(configDirectory), 0o700);
    assert.equal(fileMode(file), 0o600);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), CONFIG);
  });

  it("atomically replaces and secures an existing 0644 config", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "config.json");
    const oldConfig = { ...CONFIG, org_name: "Old organization" };
    writeConfig(file, 0o644, oldConfig);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    const oldDescriptor = fs.openSync(file, "r");
    t.after(() => fs.closeSync(oldDescriptor));
    t.mock.method(console, "error", () => undefined);

    saveConfig(CONFIG);

    assert.equal(fileMode(file), 0o600);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), CONFIG);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(oldDescriptor, "utf-8")),
      oldConfig,
    );
  });

  it("does not truncate an existing config when permission repair fails", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "unrepairable-config.json");
    const originalContents = JSON.stringify({ ...CONFIG, org_name: "Original" });
    writeFileSync(file, originalContents, { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    t.mock.method(fs, "fchmodSync", () => undefined);

    assert.throws(
      () => saveConfig(CONFIG),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_CONFIG_SECURITY");
        return true;
      },
    );
    assert.equal(readFileSync(file, "utf-8"), originalContents);
    assert.equal(fileMode(file), 0o644);
  });
});

describe("CLI config source and schema behavior", () => {
  it("rejects competing environment and file credentials without inspecting the file", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "stale-config.json");
    writeConfig(file, 0o644);
    process.env.PIPELEDGER_CONFIG_FILE = file;
    process.env.PIPELEDGER_CREDENTIAL_SECRET = `pl_live_${"b".repeat(32)}`;
    process.env.PIPELEDGER_API_URL = "https://pipeledger.ai";

    assert.throws(() => loadConfig(), /Credential settings conflict/);
    assert.equal(fileMode(file), 0o644);
  });

  it("preserves retired-field remediation without reopening the file", { skip: IS_WINDOWS }, (t) => {
    const root = createTempRoot();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "retired-config.json");
    writeConfig(file, 0o600, {
      api_url: CONFIG.api_url,
      credential: CONFIG.credential_secret,
    });
    process.env.PIPELEDGER_CONFIG_FILE = file;

    assert.throws(
      () => requireConfig(),
      (error: unknown) => {
        assert.ok(error instanceof LocalCliError);
        assert.equal(error.code, "E_CLI_AUTH_REQUIRED");
        assert.match(error.message, /retired `credential` field/);
        assert.match(error.message, /credential_secret/);
        return true;
      },
    );
  });

  it("keeps the checked-in manual config example schema-valid", () => {
    const example = JSON.parse(
      readFileSync(resolve(process.cwd(), "config.example.json"), "utf-8"),
    );
    assert.equal(PipeLedgerCliConfigSchema.safeParse(example).success, true);
  });
});

describe("several saved credentials", () => {
  const ORIGINAL = {
    home: process.env.HOME,
    userProfile: process.env.USERPROFILE,
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
    profile: process.env.PIPELEDGER_PROFILE,
    cwd: process.cwd(),
  };
  const FIRST: CliConfig = {
    ...CONFIG,
    org_id: "00000000-0000-4000-8000-00000000000a",
    org_name: "Riverside Lumber",
  };
  const SECOND: CliConfig = {
    ...CONFIG,
    org_id: "00000000-0000-4000-8000-00000000000b",
    org_name: "Castilian Holding",
  };

  // Point every location at a temporary folder. These tests write and delete
  // credential files, so they must never resolve to the real home directory.
  function useTempHome(t: { after: (fn: () => void) => void }): string {
    const root = fs.realpathSync(createTempRoot());
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    process.env.XDG_CONFIG_HOME = join(root, ".config");
    delete process.env.PIPELEDGER_PROFILE;
    mkdirSync(join(root, "work"), { recursive: true });
    process.chdir(join(root, "work"));
    t.after(() => {
      process.chdir(ORIGINAL.cwd);
      restoreEnv("HOME", ORIGINAL.home);
      restoreEnv("USERPROFILE", ORIGINAL.userProfile);
      restoreEnv("XDG_CONFIG_HOME", ORIGINAL.xdgConfigHome);
      restoreEnv("PIPELEDGER_PROFILE", ORIGINAL.profile);
      rmSync(root, { recursive: true, force: true });
    });
    return root;
  }

  function saveTwoProfiles(): void {
    saveConfig(FIRST, { profile: "riverside-lumber" });
    saveConfig(SECOND, { profile: "castilian-holding" });
  }

  it("uses the only saved credential without being told", (t) => {
    const root = useTempHome(t);
    const file = saveConfig(FIRST, { profile: "riverside-lumber" });

    assert.equal(file, join(root, ".pipeledger", "profiles", "riverside-lumber.json"));
    assert.equal(fileMode(file), IS_WINDOWS ? fileMode(file) : 0o600);
    assert.equal(loadConfig()?.org_name, "Riverside Lumber");
    assert.equal(describeCredentialSource()?.selectedBy, "only");
  });

  it("refuses to guess when several are saved and none is selected", (t) => {
    useTempHome(t);
    saveTwoProfiles();

    assert.throws(
      () => loadConfig(),
      (error: unknown) =>
        error instanceof LocalCliError &&
        error.code === "E_CLI_AUTH_REQUIRED" &&
        /will not guess/.test(error.message) &&
        /castilian-holding, riverside-lumber/.test(error.message) &&
        !error.message.includes("pl_live_"),
    );
  });

  it("uses the default chosen with pl switch", (t) => {
    useTempHome(t);
    saveTwoProfiles();
    writeDefaultProfileName("castilian-holding");

    assert.equal(loadConfig()?.org_name, "Castilian Holding");
    assert.equal(describeCredentialSource()?.selectedBy, "default");
  });

  it("lets a folder binding outrank the default, in subfolders too", (t) => {
    const root = useTempHome(t);
    saveTwoProfiles();
    writeDefaultProfileName("castilian-holding");
    const client = join(root, "clients", "riverside");
    mkdirSync(join(client, "reports", "2026"), { recursive: true });
    const marker = writeFolderMarker(client, {
      profile: "riverside-lumber",
      orgId: FIRST.org_id ?? null,
    });
    assert.equal(readFileSync(marker, "utf-8").includes("pl_live_"), false);

    process.chdir(join(client, "reports", "2026"));

    assert.equal(loadConfig()?.org_name, "Riverside Lumber");
    assert.deepEqual(describeCredentialSource(), {
      selectedBy: "folder",
      profile: "riverside-lumber",
      file: join(root, ".pipeledger", "profiles", "riverside-lumber.json"),
      markerFile: join(client, FOLDER_MARKER_FILE),
    });
  });

  it("lets --profile outrank the folder binding", (t) => {
    const root = useTempHome(t);
    saveTwoProfiles();
    const client = join(root, "clients", "riverside");
    mkdirSync(client, { recursive: true });
    writeFolderMarker(client, { profile: "riverside-lumber", orgId: FIRST.org_id! });
    process.chdir(client);
    process.env.PIPELEDGER_PROFILE = "castilian-holding";

    assert.equal(loadConfig()?.org_name, "Castilian Holding");
    assert.equal(describeCredentialSource()?.selectedBy, "option");
  });

  it("stops when a bound folder's profile now holds another organization", (t) => {
    const root = useTempHome(t);
    saveTwoProfiles();
    const client = join(root, "clients", "riverside");
    mkdirSync(client, { recursive: true });
    writeFolderMarker(client, {
      profile: "riverside-lumber",
      orgId: FIRST.org_id ?? null,
    });
    writeConfig(join(root, ".pipeledger", "profiles", "riverside-lumber.json"), 0o600, SECOND);
    process.chdir(client);

    assert.throws(
      () => loadConfig(),
      (error: unknown) =>
        error instanceof LocalCliError &&
        error.code === "E_CLI_AUTH_REQUIRED" &&
        /Nothing was sent/.test(error.message) &&
        /Castilian Holding/.test(error.message),
    );
    assert.throws(() => removeActiveCredentialFile(), /Nothing was sent/);
    assert.equal(describeSavedProfiles().length, 2);
  });

  it("stops when a folder is bound to a profile that is not saved", (t) => {
    const root = useTempHome(t);
    saveConfig(FIRST, { profile: "riverside-lumber" });
    const client = join(root, "clients", "castilian");
    mkdirSync(client, { recursive: true });
    writeFolderMarker(client, { profile: "castilian-holding", orgId: SECOND.org_id! });
    process.chdir(client);

    assert.throws(
      () => loadConfig(),
      (error: unknown) =>
        error instanceof LocalCliError &&
        /linked to the profile "castilian-holding"/.test(error.message),
    );
  });

  it("reads profiles from one place and ignores every other location", (t) => {
    const root = useTempHome(t);
    mkdirSync(join(root, ".pipeledger"), { recursive: true, mode: 0o700 });
    writeConfig(join(root, ".pipeledger", "config.json"), 0o600, FIRST);
    const elsewhere = join(root, ".config", "pipeledger");
    mkdirSync(elsewhere, { recursive: true, mode: 0o700 });
    writeConfig(
      join(elsewhere, "pipeledger-castilian-holding-cli-config.json"),
      0o600,
      SECOND,
    );

    assert.deepEqual(describeSavedProfiles(), []);
    assert.equal(loadConfig(), null);

    const file = saveConfig(FIRST, { profile: "riverside-lumber" });
    assert.deepEqual(
      describeSavedProfiles().map((profile) => [profile.name, profile.file]),
      [["riverside-lumber", file]],
    );
    assert.equal(loadConfig()?.org_name, "Riverside Lumber");
  });

  it("saves only under a profile name or an explicitly named file", (t) => {
    useTempHome(t);

    assert.throws(
      () => saveConfig(FIRST),
      (error: unknown) =>
        error instanceof LocalCliError && error.code === "E_CLI_INPUT",
    );
    assert.deepEqual(describeSavedProfiles(), []);
  });

  it("keeps PIPELEDGER_CONFIG_FILE above every profile rule", (t) => {
    const root = useTempHome(t);
    saveTwoProfiles();
    const selected = join(root, "selected-cli-config.json");
    writeConfig(selected, 0o600, { ...CONFIG, org_name: "Selected By File" });
    process.env.PIPELEDGER_CONFIG_FILE = selected;

    assert.equal(loadConfig()?.org_name, "Selected By File");
    assert.equal(describeCredentialSource()?.selectedBy, "config_file");
  });

  it("removes the selected profile and preserves a missing default to prevent fallback", (t) => {
    const root = useTempHome(t);
    saveTwoProfiles();
    saveConfig(CONFIG, { profile: "third" });
    writeDefaultProfileName("castilian-holding");

    assert.deepEqual(removeActiveCredentialFile(), {
      removed: join(root, ".pipeledger", "profiles", "castilian-holding.json"),
      profile: "castilian-holding",
      remaining: ["riverside-lumber", "third"],
      environmentCredential: false,
    });
    assert.throws(() => loadConfig(), /selected default is missing/);
  });

  it("removes only the file named in PIPELEDGER_CONFIG_FILE", (t) => {
    const root = useTempHome(t);
    const saved = saveConfig(FIRST, { profile: "riverside-lumber" });
    const selected = join(root, "selected-cli-config.json");
    writeConfig(selected, 0o600);
    process.env.PIPELEDGER_CONFIG_FILE = selected;

    assert.deepEqual(removeActiveCredentialFile(), {
      removed: selected,
      profile: null,
      remaining: [],
      environmentCredential: false,
    });
    assert.equal(fs.existsSync(saved), true);
  });

  it("removes nothing when no credential is saved", (t) => {
    useTempHome(t);

    assert.deepEqual(removeActiveCredentialFile(), {
      removed: null,
      profile: null,
      remaining: [],
      environmentCredential: false,
    });
  });

  it("reports a credential that the environment still supplies", (t) => {
    useTempHome(t);
    saveConfig(FIRST, { profile: "riverside-lumber" });
    process.env.PIPELEDGER_CREDENTIAL_SECRET = CONFIG.credential_secret;

    const result = removeActiveCredentialFile();

    assert.equal(result.environmentCredential, true);
    assert.equal(result.profile, null);
    assert.equal(describeSavedProfiles().length, 1);
    assert.notEqual(loadConfig(), null);
  });

  it("removes a symbolic link without touching its target", { skip: IS_WINDOWS }, (t) => {
    const root = useTempHome(t);
    const target = join(root, "target-config.json");
    writeConfig(target, 0o600);
    const link = join(root, "linked-config.json");
    symlinkSync(target, link);
    process.env.PIPELEDGER_CONFIG_FILE = link;

    assert.equal(removeActiveCredentialFile().removed, link);
    assert.equal(fs.existsSync(target), true);
  });
  it("never falls through a stale or corrupted default to the only remaining client", (t) => {
    const root = useTempHome(t);
    saveConfig(FIRST, { profile: "first" });
    writeDefaultProfileName("deleted");
    assert.throws(() => loadConfig(), /selected default is missing/);
    writeFileSync(join(root, ".pipeledger", "default-profile"), "");
    assert.throws(() => loadConfig(), /saved default cannot be read/);
  });

  it("does not activate the last remaining client after logout", (t) => {
    useTempHome(t);
    saveTwoProfiles();
    writeDefaultProfileName("castilian-holding");
    removeActiveCredentialFile();
    assert.throws(() => loadConfig(), /selected default is missing/);
  });

  it("rejects ambient credentials that conflict with a profile or folder", (t) => {
    const root = useTempHome(t);
    saveTwoProfiles();
    process.env.PIPELEDGER_PROFILE = "riverside-lumber";
    process.env.PIPELEDGER_CREDENTIAL_SECRET = SECOND.credential_secret;
    assert.throws(() => loadConfig(), /Credential settings conflict/);
    assert.throws(() => removeActiveCredentialFile(), /Credential settings conflict/);
    assert.equal(describeSavedProfiles().length, 2);
    delete process.env.PIPELEDGER_PROFILE;
    writeFolderMarker(join(root, "work"), { profile: "riverside-lumber", orgId: FIRST.org_id! });
    assert.throws(() => loadConfig(), /Credential settings conflict/);
    delete process.env.PIPELEDGER_CREDENTIAL_SECRET;
    process.env.PIPELEDGER_CONFIG_FILE = join(root, "other.json");
    assert.throws(() => loadConfig(), /Credential settings conflict/);
  });

  it("stops when the default's profile is gone, even if another remains", (t) => {
    useTempHome(t);
    const first = saveConfig(FIRST, { profile: "riverside-lumber" });
    saveConfig(SECOND, { profile: "castilian-holding" });
    writeDefaultProfileName("riverside-lumber");
    rmSync(first);

    assert.deepEqual(
      describeSavedProfiles().map((profile) => profile.name),
      ["castilian-holding"],
    );
    assert.throws(() => loadConfig(), /selected default is missing/);

    writeDefaultProfileName("castilian-holding");
    assert.equal(loadConfig()?.org_id, SECOND.org_id);
  });

  it("rejects missing organization metadata and non-file folder markers", (t) => {
    const root = useTempHome(t);
    saveConfig({ api_url: FIRST.api_url, credential_secret: FIRST.credential_secret }, { profile: "first" });
    const work = join(root, "work");
    const marker = writeFolderMarker(work, { profile: "first", orgId: FIRST.org_id! });
    assert.throws(() => loadConfig(), /Nothing was sent/);
    writeFileSync(marker, JSON.stringify({ profile: "first" }));
    assert.throws(() => loadConfig(), /not valid/);
    rmSync(marker);
    mkdirSync(marker);
    assert.throws(() => loadConfig(), /regular file/);
  });

  it("refuses linked selection files and preserves their targets", { skip: IS_WINDOWS }, (t) => {
    const root = useTempHome(t);
    saveConfig(FIRST, { profile: "first" });
    const target = join(root, "target");
    writeFileSync(target, "original");
    const defaultFile = join(root, ".pipeledger", "default-profile");
    symlinkSync(target, defaultFile);
    assert.throws(() => loadConfig(), /saved default cannot be read/);
    assert.throws(() => writeDefaultProfileName("first"), /Could not save/);
    symlinkSync(target, join(root, "work", FOLDER_MARKER_FILE));
    assert.throws(() => writeFolderMarker(join(root, "work"), { profile: "first", orgId: FIRST.org_id! }), /Could not write/);
    assert.equal(readFileSync(target, "utf-8"), "original");
  });

  it("serializes profile replacement and refuses changing the organization or API", (t) => {
    useTempHome(t);
    const file = saveConfig(FIRST, { profile: "first" });
    const contents = readFileSync(file, "utf-8");
    assert.throws(() => saveConfig(SECOND, { profile: "first" }), /Nothing was saved/);
    assert.throws(() => saveConfig({ ...FIRST, api_url: "https://another.example" }, { profile: "first" }), /Nothing was saved/);
    writeFileSync(`${file}.lock`, "");
    assert.throws(() => saveConfig(FIRST, { profile: "first" }), /another process/);
    assert.equal(readFileSync(file, "utf-8"), contents);
    rmSync(`${file}.lock`);
    saveConfig({ ...FIRST, credential_secret: `pl_live_${"c".repeat(40)}` }, { profile: "first" });
    assert.notEqual(readFileSync(file, "utf-8"), contents);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  });

});
