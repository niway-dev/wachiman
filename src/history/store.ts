/**
 * The on-laptop store of local review runs (ADR 0020). The only module that touches `~`: one
 * immutable file per run under `<root>/<repo-key>/runs/`, an append-only `verdicts.jsonl` beside
 * it, directories 0700 and files 0600. A file that cannot be read is moved aside, never deleted.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { UsageError } from "../config";
import { spawnGit, type GitRunner } from "../evidence";
import { REVIEW_RESULT_FORMAT } from "../formats";
import {
  HISTORY_RUN_FORMAT,
  VERDICT_WORDS,
  type HistoryRepository,
  type HistoryRun,
  type VerdictLine,
} from "./types";

export { HISTORY_RUN_FORMAT };

export const DEFAULT_HISTORY_DAYS = 30;

export interface HistorySettings {
  enabled: boolean;
  days: number;
}

/**
 * Whether the history is on (`--history` or `AGENT_REVIEW_HISTORY=1`) and how long it is kept.
 * Read here, not in `loadConfig`: that one rejects `0`, and GitHub mode must not see the variable.
 * A bad `AGENT_REVIEW_HISTORY_DAYS` is checked only when the history is on.
 */
export function historySettings(env: Record<string, string | undefined>, flag: boolean): HistorySettings {
  const enabled = flag || env.AGENT_REVIEW_HISTORY === "1";
  const raw = env.AGENT_REVIEW_HISTORY_DAYS;
  if (!enabled || raw === undefined || raw === "") return { enabled, days: DEFAULT_HISTORY_DAYS };
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`AGENT_REVIEW_HISTORY_DAYS must be 0 (keep forever) or a whole number of days, got "${raw}".`);
  }
  return { enabled, days: Number(raw) };
}

export const historyRoot = (home: string) => join(home, ".wachiman", "history");

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const GIT_TIMEOUT_MS = 30_000;

/** `user:token@` never reaches the hash input or the file; the host is lowercased; no `.git`, no trailing `/`. */
function normaliseRemote(raw: string): string {
  let url = raw.trim();
  const scp = url.match(/^([^@/:\s]+)@([^:/\s]+):(?!\/\/)(.*)$/);
  if (scp) url = `ssh://${scp[1]}@${scp[2]}/${scp[3].replace(/^\/+/, "")}`;
  let text: string;
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : "";
    text = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}${parsed.pathname}`;
  } catch {
    text = url;
  }
  return text.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "") || "repo";

/**
 * `<basename>-<hash8>` of the credential-stripped `origin` URL, so every clone and worktree of
 * one repository shares a history; without `origin`, of the common git directory's real path.
 */
export function repositoryKey(repoDir: string, git: GitRunner = spawnGit): HistoryRepository {
  const common = git(["rev-parse", "--git-common-dir"], { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });
  if (common.status !== 0) throw new UsageError(`${repoDir} is not a git repository.`);
  const commonDir = realpathSync(resolve(repoDir, common.stdout.trim()));
  const path = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
  const origin = git(["remote", "get-url", "origin"], { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });
  const raw = origin.status === 0 ? origin.stdout.trim() : "";
  if (raw !== "") {
    const remote = normaliseRemote(raw);
    const name = safeName(basename(remote));
    return { key: `${name}-${sha256(remote).slice(0, 8)}`, name, keyedBy: "remote", remote, path };
  }
  const name = safeName(basename(path));
  return { key: `${name}-${sha256(commonDir).slice(0, 8)}`, name, keyedBy: "path", path };
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const assertKey = (key: string) => {
  if (!KEY_PATTERN.test(key)) throw new Error(`"${key}" is not a history key.`);
};

/** Creates `dirs` (parents first) at 0700; only a directory this call made is chmodded. */
function privateDirs(...dirs: string[]) {
  for (const dir of dirs) {
    if (existsSync(dir)) continue;
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
  }
}

const keyDir = (root: string, key: string) => {
  assertKey(key);
  return join(root, key);
};
const runsDir = (root: string, key: string) => join(keyDir(root, key), "runs");
const verdictsPath = (root: string, key: string) => join(keyDir(root, key), "verdicts.jsonl");

function ensureKeyDirs(root: string, key: string) {
  privateDirs(dirname(root), root, keyDir(root, key), runsDir(root, key));
}

/** Writes `text` to `path` 0600 through a temporary name in the same directory: all or nothing. */
function writeAtomic(path: string, text: string) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Writes one immutable run file and returns its path. */
export function writeRun(root: string, run: HistoryRun): string {
  const { key } = run.repository;
  ensureKeyDirs(root, key);
  const stamp = run.savedAt.replace(/[:.]/g, "-");
  const sha7 = run.result.change.head.sha.slice(0, 7);
  const dir = runsDir(root, key);
  let path = join(dir, `${stamp}-${sha7}.json`);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${stamp}-${sha7}-${n}.json`);
  writeAtomic(path, `${JSON.stringify(run, null, 2)}\n`);
  return path;
}

function parseRun(path: string): HistoryRun {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("not an object");
  if (parsed.format !== HISTORY_RUN_FORMAT) throw new Error(`format ${JSON.stringify(parsed.format)}`);
  if (parsed.result?.format !== REVIEW_RESULT_FORMAT) throw new Error("result is not a review result");
  if (typeof parsed.savedAt !== "string" || !Array.isArray(parsed.tracking) || !Array.isArray(parsed.result.findings)) {
    throw new Error("missing savedAt or tracking");
  }
  return parsed as HistoryRun;
}

const runFiles = (root: string, key: string) => {
  const dir = runsDir(root, key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => join(dir, n));
};

/**
 * Every readable run of a repository in `savedAt` order. A file that is not JSON or has another
 * format is renamed `<name>.unreadable-<unix-seconds>`, with one warning, and skipped.
 */
export function readRuns(root: string, key: string, warn: (line: string) => void): HistoryRun[] {
  const runs: HistoryRun[] = [];
  for (const path of runFiles(root, key)) {
    try {
      runs.push(parseRun(path));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const aside = `${path}.unreadable-${Math.floor(Date.now() / 1000)}`;
      try {
        renameSync(path, aside);
        warn(`history: ${path} cannot be read (${reason}); moved to ${aside}`);
      } catch {
        warn(`history: ${path} cannot be read (${reason}) and could not be moved aside`);
      }
    }
  }
  return runs.sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0));
}

export function listKeys(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => KEY_PATTERN.test(n) && statSync(join(root, n)).isDirectory())
    .sort();
}

/**
 * Deletes the repository's runs older than `days` and the verdicts whose first id no longer
 * resolves in what is left. `0` keeps everything.
 */
export function prune(root: string, key: string, days: number, now: () => Date): { runs: string[]; verdicts: number } {
  const removed = { runs: [] as string[], verdicts: 0 };
  if (days <= 0) return removed;
  const cutoff = now().getTime() - days * 86_400_000;
  const kept = new Set<string>();
  for (const path of runFiles(root, key)) {
    let run: HistoryRun;
    try {
      run = parseRun(path);
    } catch {
      continue; // readRuns moves it aside
    }
    if (Date.parse(run.savedAt) < cutoff) {
      unlinkSync(path);
      removed.runs.push(path);
    } else {
      for (const t of run.tracking) kept.add(t.firstId);
    }
  }
  if (removed.runs.length === 0) return removed;
  const verdicts = verdictsPath(root, key);
  if (existsSync(verdicts)) {
    const lines = readFileSync(verdicts, "utf8").split("\n").filter(Boolean);
    const alive = lines.filter((l) => {
      try {
        return kept.has(JSON.parse(l).firstId);
      } catch {
        return false;
      }
    });
    removed.verdicts = lines.length - alive.length;
    if (removed.verdicts > 0) writeAtomic(verdicts, alive.map((l) => `${l}\n`).join(""));
  }
  return removed;
}

export function appendVerdict(root: string, key: string, v: VerdictLine): void {
  ensureKeyDirs(root, key);
  const path = verdictsPath(root, key);
  appendFileSync(path, `${JSON.stringify(v)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** The last line for a first id wins; a line that is not a verdict is ignored. */
export function readVerdicts(root: string, key: string): Map<string, VerdictLine> {
  const out = new Map<string, VerdictLine>();
  const path = verdictsPath(root, key);
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const v = JSON.parse(line);
      if (typeof v.firstId === "string" && (VERDICT_WORDS as readonly string[]).includes(v.verdict)) out.set(v.firstId, v);
    } catch {
      // A half-written line is not a verdict.
    }
  }
  return out;
}

/** Removes one repository's history, or all of it; returns what was removed. Never leaves `root`. */
export function forget(root: string, key?: string): string[] {
  const target = key === undefined ? root : keyDir(root, key);
  if (!existsSync(target)) return [];
  rmSync(target, { recursive: true, force: true });
  return [target];
}
