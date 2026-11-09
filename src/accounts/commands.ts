/**
 * The account commands (ADR 0029, command contract sections 5.7, 5.8 and 5.4): `profile list`,
 * `create`, `add`, `login`, `remove`, `default`; `project show` and `unbind`; and the
 * non-interactive path of `setup`.
 *
 * Every function here throws a `UsageError` for what the contract calls exit 2 and returns the
 * exit code otherwise, so the CLI maps both the same way. Nothing opens a file inside a profile's
 * directory, nothing reads a credential, and nothing is written under a reviewed repository: the
 * configuration lives in the Wachiman home. Everything that spawns a process is injected.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdtempSync, readSync, realpathSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { UsageError } from "../config";
import { parseFlags } from "../flags";
import { buildChildEnv } from "../providers/claude-code";
import { DEFAULT_ISOLATED_NAME, setupProfile } from "../profiles";
import { readConfig, updateConfig, wachimanHome, type ConfigRead, type ProfileEntry, type WachimanConfigV1 } from "./config";
import type { SpawnFn, SpawnResult } from "./confirm";
import { buildProfileList, managedDir, refersTo, type ProfileList } from "./profile-list";
import { checkProfileName, lookupProfileRef, parseProfileRef } from "./resolve";

export interface CommandIo {
  /** The result of a command: a list, a document, a report. */
  stdout: (text: string) => void;
  /** Everything else: confirmations, notices, prompts. */
  stderr: (line: string) => void;
}

export type Answer = "yes" | "no" | "cancel";
export type InteractiveSpawn = (
  binary: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; stdio: "inherit" },
) => { status: number | null; error?: Error };

export interface AccountDeps {
  /** Captured subprocesses: the `auth --help` probe of `profile login`, the checks of `setup`. */
  spawn?: SpawnFn;
  /** The one subprocess that gets the terminal: `claude` for `profile create` and `profile login`. */
  interactiveSpawn?: InteractiveSpawn;
  now?: () => string;
  /** What a leading `~` means. Default: `os.homedir()`. */
  userHome?: string;
  /** Whether a person can be asked. Default: stdin and stdout are terminals and `CI` is not set. */
  interactive?: boolean;
  /** Asks one yes/no question. Default: a line read from the terminal. */
  ask?: (question: string, defaultYes: boolean) => Answer;
}

const defaultSpawn: SpawnFn = (binary, args, options): SpawnResult => {
  const run = spawnSync(binary, args, options);
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", error: run.error };
};
const defaultInteractiveSpawn: InteractiveSpawn = (binary, args, opts) => spawnSync(binary, args, opts);

/** `CI=true` and a piped stdin or stdout all turn the prompts off (types spec section 8, invariant 14). */
export function isInteractive(env: Record<string, string | undefined>, tty: { stdin: boolean; stdout: boolean }) {
  if (env.CI === "true" || env.CI === "1") return false;
  return tty.stdin && tty.stdout;
}

/** One line from the terminal, byte by byte so nothing past the newline is consumed; null at end of input. */
function readLine(fd: number): string | null {
  const bytes: number[] = [];
  const one = Buffer.alloc(1);
  for (;;) {
    let n: number;
    try {
      n = readSync(fd, one, 0, 1, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        continue;
      }
      if (code === "EOF") n = 0;
      else throw error;
    }
    if (n === 0) return bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8");
    if (one[0] === 0x0a) return Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
    bytes.push(one[0]);
  }
}

const askOnTerminal = (question: string, defaultYes: boolean): Answer => {
  writeSync(2, `${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `);
  const line = readLine(0);
  if (line === null) return "cancel";
  const answer = line.trim().toLowerCase();
  if (answer === "") return defaultYes ? "yes" : "no";
  return answer === "y" || answer === "yes" ? "yes" : "no";
};

/** A question the person must answer; without a terminal and without `--yes` it is a usage error. */
function confirm(command: string, env: Record<string, string | undefined>, deps: AccountDeps, p: { yes: boolean; question: string; defaultYes: boolean }): Answer {
  if (p.yes) return "yes";
  const interactive = deps.interactive ?? isInteractive(env, { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true });
  if (!interactive) throw new UsageError(`${command} needs --yes when it cannot ask.`);
  return (deps.ask ?? askOnTerminal)(p.question, p.defaultYes);
}

/** The configuration, strictly; a corrupt file is a usage error, never "absent". */
export function loadConfig(home: string, structural = false): WachimanConfigV1 | undefined {
  const read: ConfigRead = readConfig(home, undefined, { structural });
  if (read.kind === "corrupt") throw new UsageError(`${read.path} is corrupt (${read.problem}); fix or remove it.`);
  return read.kind === "ok" ? read.config : undefined;
}

// ---------------------------------------------------------------------------------------------
// profile

export type ProfileCommand =
  | { kind: "help" }
  | { kind: "list"; json: boolean }
  | { kind: "create"; name: string }
  | { kind: "add"; name: string; configDir: string; binary?: string; note?: string }
  | { kind: "login"; profile: string }
  | { kind: "remove"; name: string; deleteDir: boolean; yes: boolean }
  | { kind: "default"; profile: string | null };

export const profileUsage = `wachiman profile list [--json]
wachiman profile create [<name>]
wachiman profile add <name> --config-dir <abs> [--binary <abs>] [--note <text>]
wachiman profile login <name>
wachiman profile remove <name> [--delete-dir] [--yes]
wachiman profile default <name> | --none`;

const PROFILE_SUBCOMMANDS = ["list", "create", "add", "login", "remove", "default"];

/** The arguments after `profile`. */
export function parseProfileArgs(argv: string[]): ProfileCommand {
  const [sub, ...rest] = argv;
  if (sub === undefined) throw new UsageError(`profile needs a subcommand: ${PROFILE_SUBCOMMANDS.join(", ")}.`);
  if (sub === "--help" || sub === "-h" || rest.includes("--help")) return { kind: "help" };
  if (!PROFILE_SUBCOMMANDS.includes(sub)) throw new UsageError(`Unknown profile subcommand "${sub}".`);
  const command = `profile ${sub}`;
  const one = (positionals: string[], what: string) => {
    if (positionals.length !== 1) throw new UsageError(`${command} needs ${what}.`);
    return positionals[0];
  };
  const none = (positionals: string[]) => {
    if (positionals.length > 0) throw new UsageError(`${command} takes no argument "${positionals[0]}".`);
  };
  switch (sub) {
    case "list": {
      const { positionals, booleans } = parseFlags(rest, { values: [], booleans: ["--json"] }, command);
      none(positionals);
      return { kind: "list", json: booleans["--json"] === true };
    }
    case "create": {
      const { positionals } = parseFlags(rest, { values: [], booleans: [] }, command);
      if (positionals.length > 1) throw new UsageError("profile create takes at most one profile name.");
      return { kind: "create", name: positionals[0] ?? DEFAULT_ISOLATED_NAME };
    }
    case "add": {
      const { positionals, values } = parseFlags(rest, { values: ["--config-dir", "--binary", "--note"], booleans: [] }, command);
      const name = one(positionals, "a profile name");
      const configDir = values["--config-dir"];
      if (configDir === undefined) throw new UsageError("profile add needs --config-dir <absolute directory>.");
      return { kind: "add", name, configDir, ...(values["--binary"] ? { binary: values["--binary"] } : {}), ...(values["--note"] ? { note: values["--note"] } : {}) };
    }
    case "login": {
      const { positionals } = parseFlags(rest, { values: [], booleans: [] }, command);
      return { kind: "login", profile: one(positionals, "a profile name") };
    }
    case "remove": {
      const { positionals, booleans } = parseFlags(rest, { values: [], booleans: ["--delete-dir", "--yes"] }, command);
      return { kind: "remove", name: one(positionals, "a profile name"), deleteDir: booleans["--delete-dir"] === true, yes: booleans["--yes"] === true };
    }
    default: {
      const { positionals, booleans } = parseFlags(rest, { values: [], booleans: ["--none"] }, command);
      if (booleans["--none"]) {
        none(positionals);
        return { kind: "default", profile: null };
      }
      return { kind: "default", profile: one(positionals, "a profile name, or --none") };
    }
  }
}

const WINDOWS_SHIMS = /\.(cmd|bat|ps1)$/i;

/** Why `path` cannot be a stored `claude` binary, or undefined when it can. Checked at write time and again at run time. */
function binaryProblem(path: string): string | undefined {
  if (!isAbsolute(path) && !/^[A-Za-z]:[\\/]/.test(path)) return "is not an absolute path";
  if (WINDOWS_SHIMS.test(path)) {
    return "is a script shim (`claude.cmd` is an npm shim that starts Node); give the path of `claude.exe`, which `claude doctor` prints";
  }
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return "does not exist";
  }
  if (!stat.isFile()) return "is not a regular file";
  if (process.platform === "win32") return /\.exe$/i.test(path) ? undefined : "is not an .exe file";
  try {
    accessSync(path, constants.X_OK);
  } catch {
    return "is not executable";
  }
  return undefined;
}

function expandHome(path: string, userHome: string) {
  if (path === "~") return userHome;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(userHome, path.slice(2));
  return path;
}

const isUnder = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const realOrResolved = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

function addProfile(cmd: Extract<ProfileCommand, { kind: "add" }>, env: Record<string, string | undefined>, io: CommandIo, deps: AccountDeps) {
  const home = wachimanHome(env);
  const { name } = cmd;
  if (name === "default" || name === DEFAULT_ISOLATED_NAME) {
    throw new UsageError(`"${name}" is reserved (${name === "default" ? "the built-in profile" : "the managed profile of that name"}); choose another name.`);
  }
  checkProfileName(name);
  if (existsSync(managedDir(home, name))) {
    throw new UsageError(`${managedDir(home, name)} is the managed directory of a profile named "${name}"; choose another name.`);
  }
  const expanded = expandHome(cmd.configDir, deps.userHome ?? homedir());
  if (!isAbsolute(expanded)) throw new UsageError(`--config-dir must be an absolute path (a leading ~ is expanded), got "${cmd.configDir}".`);
  const configDir = resolve(expanded);
  let stat;
  try {
    stat = statSync(configDir);
  } catch {
    throw new UsageError(`--config-dir ${configDir} does not exist.`);
  }
  if (!stat.isDirectory()) throw new UsageError(`--config-dir ${configDir} is not a directory.`);
  if (isUnder(configDir, resolve(home)) || isUnder(realOrResolved(configDir), realOrResolved(home))) {
    throw new UsageError(`--config-dir ${configDir} is under the Wachiman home ${home}, which holds the managed profiles; use \`wachiman profile create\` for those.`);
  }
  if (cmd.binary !== undefined) {
    const problem = binaryProblem(cmd.binary);
    if (problem) throw new UsageError(`--binary ${cmd.binary} ${problem}.`);
  }
  const entry: ProfileEntry = {
    kind: "external",
    configDir,
    ...(cmd.binary ? { binary: cmd.binary } : {}),
    createdAt: (deps.now ?? (() => new Date().toISOString()))(),
    ...(cmd.note ? { note: cmd.note } : {}),
  };
  updateConfig({ home }, (current) => {
    if (Object.hasOwn(current.profiles, name)) throw new UsageError(`"${name}" is already registered; run \`wachiman profile remove ${name}\` first to register it again.`);
    return { ...current, profiles: { ...current.profiles, [name]: entry } };
  });
  io.stderr(`registered external profile ${name} (${configDir}${cmd.binary ? `, binary ${cmd.binary}` : ", claude from PATH"}).`);
  io.stderr(`Sign in with \`wachiman profile login ${name}\` if it is not signed in; check with \`wachiman doctor --profile ${name}\`.`);
  return 0;
}

function renderProfileList(list: ProfileList, home: string) {
  if (list.profiles.length === 0) {
    return [
      `No profiles registered in ${home}.`,
      "Create a managed one with `wachiman profile create`, or register your own Claude configuration directory with `wachiman profile add`.",
      "The built-in profile `default` (your own claude, as is) is always available.",
      "",
    ].join("\n");
  }
  const width = Math.max(...list.profiles.map((p) => p.name.length));
  const lines = list.profiles.map((p) => {
    const parts = [`${p.name.padEnd(width)}  ${p.kind.padEnd(8)}  ${p.configDir ?? ""}`];
    if (p.kind === "external") parts.push(p.binary ? `binary ${p.binary}` : "claude from PATH");
    if (!p.registered) parts.push("unregistered");
    if (p.usedBy.length > 0) parts.push(`used by ${p.usedBy.join(", ")}`);
    if (list.defaultProfile !== undefined && refersTo(list.defaultProfile, p.name)) parts.push("(default)");
    return parts.join("  ");
  });
  return [`Profiles in ${home}${list.defaultProfile ? ` (default: ${list.defaultProfile})` : ""}:`, ...lines.map((l) => `  ${l}`), ""].join("\n");
}

function removeProfile(cmd: Extract<ProfileCommand, { kind: "remove" }>, env: Record<string, string | undefined>, io: CommandIo, deps: AccountDeps) {
  const home = wachimanHome(env);
  const { name } = cmd;
  if (name === "default") throw new UsageError("`default` is the built-in profile; there is nothing to remove.");
  checkProfileName(name);
  // Structural: a dangling reference must stay removable by name, so a broken store can be repaired.
  const config = loadConfig(home, true);
  const entry = config && Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
  if (cmd.deleteDir && entry?.kind === "external") {
    throw new UsageError(`--delete-dir deletes the directory of a managed profile only; ${entry.configDir} belongs to you, so \`wachiman profile remove ${name}\` leaves it alone.`);
  }
  const bound = Object.entries(config?.projects ?? {}).filter(([, b]) => refersTo(b.profile, name));
  const isDefault = config?.defaultProfile !== undefined && refersTo(config.defaultProfile, name);
  const dir = managedDir(home, name);
  const dirExists = existsSync(dir);
  const managedTarget = entry?.kind === "managed" || (entry === undefined && dirExists);
  if (!entry && bound.length === 0 && !isDefault && !(cmd.deleteDir && dirExists)) {
    throw new UsageError(`profile "${name}" is not registered${dirExists ? `; its directory ${dir} is unregistered, and \`--delete-dir\` removes it` : ""}. Run \`wachiman profile list\`.`);
  }
  const deleteTarget = cmd.deleteDir && managedTarget && dirExists;
  if (deleteTarget && lstatSync(dir).isSymbolicLink()) {
    throw new UsageError(`${dir} is a symbolic link; Wachiman does not delete through links. Remove it yourself.`);
  }

  const changes: string[] = [];
  if (entry) changes.push(`removes the profile entry "${name}" from ${home}/config.json`);
  if (bound.length > 0) changes.push(`removes the binding of ${bound.map(([key, b]) => `${key} (${b.name})`).join(", ")}`);
  if (isDefault) changes.push("clears the default profile");
  changes.push(entry?.kind === "external" ? `leaves ${entry.configDir} alone` : deleteTarget ? "" : `leaves ${dir} in place`);
  const first = confirm("profile remove", env, deps, {
    yes: cmd.yes,
    defaultYes: false,
    question: `Remove profile ${name}?\n${changes.filter(Boolean).map((c) => `  - ${c}`).join("\n")}`,
  });
  if (first !== "yes") return first === "no" ? 0 : 130;
  const keychain =
    "The sign-in may also be stored in the macOS Keychain, which Wachiman does not touch; remove the Claude Code entry there with Keychain Access if you want it gone.";
  if (deleteTarget) {
    const second = confirm("profile remove", env, deps, {
      yes: cmd.yes,
      defaultYes: false,
      question: `Delete the directory ${dir} and everything in it? ${keychain}`,
    });
    if (second !== "yes") return second === "no" ? 0 : 130;
  }

  if (entry || bound.length > 0 || isDefault) {
    updateConfig({ home }, (current) => {
      const next: WachimanConfigV1 = {
        ...current,
        profiles: Object.fromEntries(Object.entries(current.profiles).filter(([n]) => n !== name)),
        projects: Object.fromEntries(Object.entries(current.projects).filter(([, b]) => !refersTo(b.profile, name))),
      };
      if (next.defaultProfile !== undefined && refersTo(next.defaultProfile, name)) delete next.defaultProfile;
      return next;
    });
    io.stderr(`removed profile ${name} from the configuration${bound.length > 0 ? ` and ${bound.length} binding(s)` : ""}.`);
  }
  if (deleteTarget) {
    rmSync(dir, { recursive: true, force: true });
    io.stderr(`deleted ${dir}.`);
    io.stderr(keychain);
  }
  return 0;
}

function loginProfile(cmd: Extract<ProfileCommand, { kind: "login" }>, env: Record<string, string | undefined>, io: CommandIo, deps: AccountDeps) {
  const home = wachimanHome(env);
  if (parseProfileRef(cmd.profile).kind === "default") {
    throw new UsageError("`default` is your own claude: sign in with your own claude (run it and use /login).");
  }
  const config = loadConfig(home);
  const found = lookupProfileRef(cmd.profile, { profiles: config?.profiles ?? {}, home, managedDirExists: (n) => existsSync(managedDir(home, n)) });
  if (!found.ok) throw new UsageError(found.problem);
  const { profile } = found;
  if (profile.kind === "default") throw new UsageError("`default` is your own claude: sign in with your own claude.");
  const stored = profile.kind === "external" ? profile.binary : undefined;
  if (stored !== undefined) {
    const problem = binaryProblem(stored);
    if (problem) throw new UsageError(`The binary of profile "${profile.name}", ${stored}, ${problem}. Register the profile again with \`wachiman profile add\`.`);
  }
  if (!statIsDirectory(profile.configDir)) {
    throw new UsageError(
      `The directory of profile "${profile.name}", ${profile.configDir}, does not exist${profile.kind === "managed" ? `; run \`wachiman profile create ${profile.name}\`` : ""}.`,
    );
  }
  const binary = stored ?? "claude";
  const childEnv = buildChildEnv(env, { auth: "subscription", configDir: profile.configDir });
  const cwd = mkdtempSync(join(tmpdir(), "wachiman-login-"));
  try {
    const probe = (deps.spawn ?? defaultSpawn)(binary, ["auth", "--help"], { cwd, env: childEnv, timeout: 15_000, maxBuffer: 64 * 1024, shell: false, encoding: "utf8" });
    if (probe.error) throw new UsageError(`"${binary}" did not start: ${probe.error.message}. Install Claude Code, or register the profile with the path of its binary.`);
    const hasLogin = probe.status === 0 && /^\s*login\b/m.test(probe.stdout);
    io.stderr(`Signing in profile ${profile.name}: starting ${binary} under ${profile.configDir}.`);
    if (!hasLogin) io.stderr("This claude has no `auth login`: run /login in the session that opens, then /exit.");
    const run = (deps.interactiveSpawn ?? defaultInteractiveSpawn)(binary, hasLogin ? ["auth", "login"] : [], { cwd, env: childEnv, stdio: "inherit" });
    if (run.error) throw new Error(`claude did not start: ${run.error.message}`);
    if (run.status !== null && run.status !== 0) io.stderr(`claude exited with status ${run.status}.`);
    io.stderr(`Wachiman did not read the outcome: run \`wachiman doctor --profile ${cmd.profile}\` to see the sign-in state.`);
    return run.status === 130 ? 130 : 0;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const statIsDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

function setDefault(cmd: Extract<ProfileCommand, { kind: "default" }>, env: Record<string, string | undefined>, io: CommandIo) {
  const home = wachimanHome(env);
  if (cmd.profile !== null) {
    const config = loadConfig(home);
    const found = lookupProfileRef(cmd.profile, { profiles: config?.profiles ?? {}, home, managedDirExists: (n) => existsSync(managedDir(home, n)) });
    if (!found.ok) throw new UsageError(found.problem);
  }
  const profile = cmd.profile;
  updateConfig({ home }, (current) => {
    const next: WachimanConfigV1 = { ...current };
    if (profile === null) delete next.defaultProfile;
    else next.defaultProfile = profile;
    return next;
  });
  io.stderr(profile === null ? "cleared the default profile." : `the default profile is now ${profile}.`);
  return 0;
}

export function runProfile(cmd: ProfileCommand, env: Record<string, string | undefined>, io: CommandIo, deps: AccountDeps = {}): number {
  switch (cmd.kind) {
    case "help":
      io.stdout(`${profileUsage}\n`);
      return 0;
    case "list": {
      const home = wachimanHome(env);
      const list = buildProfileList(home, loadConfig(home));
      io.stdout(cmd.json ? `${JSON.stringify(list, null, 2)}\n` : renderProfileList(list, home));
      return 0;
    }
    case "create": {
      setupProfile({ name: cmd.name, home: wachimanHome(env), env, print: io.stderr, spawn: deps.interactiveSpawn });
      return 0;
    }
    case "add":
      return addProfile(cmd, env, io, deps);
    case "login":
      return loginProfile(cmd, env, io, deps);
    case "remove":
      return removeProfile(cmd, env, io, deps);
    case "default":
      return setDefault(cmd, env, io);
  }
}
