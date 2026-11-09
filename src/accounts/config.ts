/**
 * The account store, `<wachiman home>/config.json` (ADR 0029, types spec section 1): named
 * profiles, per-repository bindings and a default. Read strictly, written under a lock.
 *
 * Wachiman stores references here, never credentials. A file that is not exactly what the types
 * describe is `corrupt`, which every caller turns into a usage error: it is never read as
 * "absent", because a silent fallback is how a review would reach the wrong account.
 */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, chmodSync, constants, statSync, unlinkSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { UsageError } from "../config";
import { KEY_PATTERN } from "../history/store";
import { lookupProfileRef, parseProfileRef, PROFILE_NAME } from "./resolve";

/** `^[a-z0-9][a-z0-9-]{0,31}$`; never `default`, and `isolated` only as a managed profile. */
export type ProfileName = string;
/** `default`, `isolated`, `isolated:<name>` or a profile name. */
export type ProfileNameRef = string;
/** `<name>-<8 hex>`, as `repositoryKey` makes it. */
export type RepositoryKey = string;

export type ProfileEntry =
  | {
      kind: "managed";
      /** Always `<home>/claude-<name>`; stored for clarity, recomputed and compared on read. */
      configDir: string;
      createdAt: string;
      note?: string;
    }
  | {
      kind: "external";
      /** Absolute, an existing directory, not under the home. Never listed or opened by Wachiman. */
      configDir: string;
      /** Absolute path to a regular executable file. Absent: `claude` from PATH. */
      binary?: string;
      createdAt: string;
      note?: string;
    };

export interface ProjectBinding {
  profile: ProfileNameRef;
  /** How the key was made, copied from `repositoryKey` so `project show` can explain it. */
  keyedBy: "remote" | "path";
  /** The normalised origin URL without credentials, when `keyedBy === "remote"`. */
  remote?: string;
  /** The repository's basename, for listings. */
  name: string;
  boundAt: string;
  /** The working directory `setup` ran in; informational, never used for resolution. */
  boundFrom: string;
}

/** The whole file. Written only by the `profile`, `setup` and `project` commands, under the lock. */
export interface WachimanConfigV1 {
  version: 1;
  /** Rung 4 of the resolution. */
  defaultProfile?: ProfileNameRef;
  profiles: Record<ProfileName, ProfileEntry>;
  /** Keyed by `HistoryRepository.key`. */
  projects: Record<RepositoryKey, ProjectBinding>;
}

export type ConfigRead =
  | { kind: "absent" }
  | { kind: "ok"; config: WachimanConfigV1; path: string }
  | { kind: "corrupt"; path: string; problem: string };

export interface ConfigIo {
  read: (path: string) => string;
  exists: (path: string) => boolean;
  /** True only when the path itself is missing (ENOENT or ENOTDIR on lstat); a broken link or an unreadable path is not. */
  isAbsent?: (path: string) => boolean;
}

const realIo: ConfigIo = { read: (p) => readFileSync(p, "utf8"), exists: (p) => existsSync(p),
  isAbsent: (p) => {
    try {
      lstatSync(p);
      return false;
    } catch (error) {
      // ENOTDIR: a parent is a plain file, so nothing can exist at the path either.
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" || code === "ENOTDIR";
    }
  },
};

/** A symbolic link whose target is gone (an unmounted volume, a moved dotfiles checkout). */
function danglingLink(path: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
  } catch {
    return false;
  }
  try {
    statSync(path);
    return false;
  } catch {
    return true;
  }
}

/**
 * The directory that holds the config, the managed profiles and the history: `WACHIMAN_HOME` when
 * set (it must be absolute), else `.wachiman` under the user's home directory. `HOME` is not
 * consulted from `env`: `os.homedir()` is what lets Windows work.
 */
export function wachimanHome(env: Record<string, string | undefined>) {
  const set = env.WACHIMAN_HOME;
  if (set === undefined || set === "") return join(homedir(), ".wachiman");
  if (!isAbsolute(set)) throw new UsageError(`WACHIMAN_HOME must be an absolute path, got "${set}".`);
  return set;
}

export const configPath = (home: string) => join(home, "config.json");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first problem with `parsed`, naming the field; undefined when it is a well-formed config. */
function problemOf(home: string, parsed: unknown, exists: (path: string) => boolean, structural: boolean): string | undefined {
  if (!isRecord(parsed)) return "the file must hold a JSON object";
  if (parsed.version !== 1) return `version must be 1, got ${JSON.stringify(parsed.version)}`;
  if (!isRecord(parsed.profiles)) return "profiles must be an object";
  if (!isRecord(parsed.projects)) return "projects must be an object";
  const profiles = parsed.profiles as Record<string, unknown>;
  for (const [name, entry] of Object.entries(profiles)) {
    const at = `profiles.${name}`;
    if (!PROFILE_NAME.test(name) || name === "default") return `${at}: not a valid profile name`;
    if (!isRecord(entry)) return `${at} must be an object`;
    if (entry.kind !== "managed" && entry.kind !== "external") return `${at}.kind must be "managed" or "external"`;
    if (typeof entry.configDir !== "string" || !isAbsolute(entry.configDir)) return `${at}.configDir must be an absolute path`;
    if (entry.kind === "managed" && entry.configDir !== join(home, `claude-${name}`)) {
      return `${at}.configDir must be ${join(home, `claude-${name}`)}`;
    }
    if (entry.kind === "external") {
      if (name === "isolated") return `${at}: "isolated" is reserved for the managed profile of that name`;
      if (entry.binary !== undefined && (typeof entry.binary !== "string" || !isAbsolute(entry.binary))) {
        return `${at}.binary must be an absolute path`;
      }
    }
  }
  const lookup = { profiles: profiles as Record<string, ProfileEntry>, home, managedDirExists: (n: string) => exists(join(home, `claude-${n}`)) };
  const reference = (value: unknown, at: string) => {
    if (typeof value !== "string") return `${at} must be a profile name`;
    try {
      parseProfileRef(value);
    } catch (error) {
      return `${at}: ${error instanceof Error ? error.message : error}`;
    }
    if (structural) return undefined;
    const found = lookupProfileRef(value, lookup);
    return found.ok ? undefined : `${at} "${value}" does not resolve (dangling): ${found.problem}`;
  };
  for (const [key, binding] of Object.entries(parsed.projects as Record<string, unknown>)) {
    const at = `projects.${key}`;
    if (!KEY_PATTERN.test(key)) return `${at}: not a valid repository key`;
    if (!isRecord(binding)) return `${at} must be an object`;
    const bad = reference(binding.profile, `${at}.profile`);
    if (bad) return bad;
  }
  if (parsed.defaultProfile !== undefined) return reference(parsed.defaultProfile, "defaultProfile");
  return undefined;
}

/** Every dangling reference of a structurally valid config, keyed by where it is and what it names. */
function danglingOf(home: string, config: WachimanConfigV1, exists: (path: string) => boolean): Map<string, string> {
  const lookup = { profiles: config.profiles, home, managedDirExists: (n: string) => exists(join(home, `claude-${n}`)) };
  const found = new Map<string, string>();
  const check = (value: string, at: string) => {
    const r = lookupProfileRef(value, lookup);
    if (!r.ok) found.set(`${at}=${value}`, `${at} "${value}" does not resolve (dangling): ${r.problem}`);
  };
  for (const [key, binding] of Object.entries(config.projects)) check(binding.profile, `projects.${key}.profile`);
  if (config.defaultProfile !== undefined) check(config.defaultProfile, "defaultProfile");
  return found;
}

/**
 * Strict read. `structural` skips only the "does this reference resolve" checks, for the recovery
 * commands that remove a broken reference; the shape and path rules still apply.
 */
export function readConfig(home: string, io: ConfigIo = realIo, opts: { structural?: boolean } = {}): ConfigRead {
  const path = configPath(home);
  // A home whose link target is gone would otherwise read as "no config" and drop every binding.
  if (danglingLink(home)) return { kind: "corrupt", path: home, problem: "is a symbolic link whose target does not exist" };
  if (io.isAbsent ? io.isAbsent(path) : !io.exists(path)) return { kind: "absent" };
  let text: string;
  try {
    text = io.read(path);
  } catch (error) {
    return { kind: "corrupt", path, problem: `cannot be read (${error instanceof Error ? error.message : error})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { kind: "corrupt", path, problem: `not valid JSON (${error instanceof Error ? error.message : error})` };
  }
  const problem = problemOf(home, parsed, io.exists, opts.structural === true);
  if (problem) return { kind: "corrupt", path, problem };
  return { kind: "ok", config: parsed as WachimanConfigV1, path };
}

export interface ConfigWriteOptions {
  home: string;
  /** How long to wait for another writer's lock. Default 5000. */
  timeoutMs?: number;
}

const LOCK_RETRY_MS = 50;
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lockOwner(lock: string): string {
  try {
    const raw = readFileSync(lock, "utf8");
    const owner = JSON.parse(raw);
    return isRecord(owner) && owner.pid !== undefined ? `pid ${owner.pid}${typeof owner.createdAt === "string" ? `, taken ${owner.createdAt}` : ""}` : `unreadable owner "${raw.slice(0, 40)}"`;
  } catch {
    return "unknown pid";
  }
}

function acquire(lock: string, timeoutMs: number): string {
  const token = randomBytes(8).toString("hex");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (Date.now() >= deadline) {
      throw new UsageError(
        `${lock} is held by ${lockOwner(lock)}. Another wachiman command may be writing the configuration: wait for it. ` +
          `Only after checking that no wachiman process is running, remove ${lock} yourself; Wachiman never removes a lock it does not own.`,
      );
    }
    sleep(LOCK_RETRY_MS);
  }
}

function release(lock: string, token: string) {
  try {
    if (JSON.parse(readFileSync(lock, "utf8")).token === token) unlinkSync(lock);
  } catch {
    // Not ours any more, or already gone: nothing to release.
  }
}

/**
 * Read-modify-write under `config.json.lock`: the lock is created exclusively, the new file is
 * written to a private temp file, flushed, and renamed over `config.json`. A killed writer leaves
 * the old file or the new one, never half of either. `mutate` is pure and may throw a UsageError
 * to abort; the result must be well-formed and must not add a dangling reference. A dangling
 * reference already in the file is tolerated, so the commands can repair it.
 */
export function updateConfig(opts: ConfigWriteOptions, mutate: (current: WachimanConfigV1) => WachimanConfigV1): WachimanConfigV1 {
  const { home } = opts;
  const created = !existsSync(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (created) chmodSync(home, 0o700);
  const path = configPath(home);
  const lock = `${path}.lock`;
  const token = acquire(lock, opts.timeoutMs ?? 5000);
  try {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new UsageError(`${path} is a symbolic link; Wachiman does not write through links.`);
    const read = readConfig(home, realIo, { structural: true });
    if (read.kind === "corrupt") throw new UsageError(`${read.path} is corrupt (${read.problem}); fix or remove it.`);
    const current: WachimanConfigV1 = read.kind === "ok" ? read.config : { version: 1, profiles: {}, projects: {} };
    const next = mutate(current);
    const text = `${JSON.stringify(next, null, 2)}\n`;
    // Shape problems always refuse. A dangling reference refuses only when this mutation introduced
    // it, so a store that already has one can still be repaired.
    const after = JSON.parse(text) as WachimanConfigV1;
    const before = danglingOf(home, current, existsSync);
    const problem = problemOf(home, after, existsSync, true) ?? [...danglingOf(home, after, existsSync)].find(([k]) => !before.has(k))?.[1];
    if (problem) throw new UsageError(`${path} would be left invalid (${problem}); nothing was written.`);
    const temp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      unlinkSync(temp);
      throw error;
    }
    closeSync(fd);
    try {
      renameSync(temp, path);
    } catch (error) {
      unlinkSync(temp);
      throw error;
    }
    try {
      chmodSync(path, 0o600);
    } catch {
      // Modes are not enforced on every platform.
    }
    try {
      const dir = openSync(home, constants.O_RDONLY);
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    } catch {
      // Fsync of a directory is not supported everywhere.
    }
    return next;
  } finally {
    release(lock, token);
  }
}
