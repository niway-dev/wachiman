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
import { REVIEW_RESULT_V1, REVIEW_RESULT_V2, type ReviewResultV2 } from "../formats";
import { annotateUnverified } from "../verify";
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

/** `wachimanHome` is the Wachiman home itself (`wachimanHome(env)`): `WACHIMAN_HOME`, else `~/.wachiman`. */
export const historyRoot = (wachimanHome: string) => join(wachimanHome, "history");

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const GIT_TIMEOUT_MS = 30_000;

/**
 * Userinfo (`user:token@`) is stripped before anything is parsed, hashed or stored, so no URL shape
 * can carry a credential through the fallback. The host is lowercased; no `.git`, no trailing `/`.
 * `parsed` is false when the stripped text is not a URL: it still keys the history, but is not stored.
 */
function normaliseRemote(raw: string): { text: string; parsed: boolean } {
  let url = raw.trim();
  const scheme = url.match(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i);
  if (scheme) url = scheme[1] + url.slice(scheme[0].length);
  else if (!url.includes("://")) url = url.replace(/^[^@/\s]*@/, "");
  const scp = url.match(/^([^@/:\s]+):(?!\/\/)(.*)$/);
  if (scp) url = `ssh://${scp[1]}/${scp[2].replace(/^\/+/, "")}`;
  let text: string;
  let parsed = true;
  try {
    const u = new URL(url);
    if (!u.hostname || /^[a-z][a-z0-9+.-]*:\/\/\//i.test(url)) throw new Error("no host");
    const port = u.port ? `:${u.port}` : "";
    text = `${u.protocol}//${u.hostname.toLowerCase()}${port}${u.pathname}`;
  } catch {
    text = url;
    parsed = false;
  }
  return { text: text.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, ""), parsed };
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
    const { text, parsed } = normaliseRemote(raw);
    const name = safeName(basename(text));
    return { key: `${name}-${sha256(text).slice(0, 8)}`, name, keyedBy: "remote", ...(parsed ? { remote: text } : {}), path };
  }
  const name = safeName(basename(path));
  return { key: `${name}-${sha256(commonDir).slice(0, 8)}`, name, keyedBy: "path", path };
}

export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const assertKey = (key: string) => {
  if (!KEY_PATTERN.test(key)) throw new Error(`"${key}" is not a history key.`);
};

/** Creates the missing `dirs` (parents first) at 0700; an existing one is left as it is. */
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
  // Tighten what an older version, an `mkdir -p` or a umask left open; only under the history root.
  for (const dir of [root, keyDir(root, key), runsDir(root, key)]) chmodSync(dir, 0o700);
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

/** A run file written by another version of the tool: not damaged, so never moved. */
class ForeignFormat extends Error {}

function parseRun(path: string): HistoryRun {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("not an object");
  if (parsed.format !== HISTORY_RUN_FORMAT) {
    const message = `format ${JSON.stringify(parsed.format)}`;
    throw typeof parsed.format === "string" && parsed.format.startsWith("wachiman.history-run/") ? new ForeignFormat(message) : new Error(message);
  }
  const resultFormat = parsed.result?.format;
  if (typeof resultFormat === "string" && resultFormat.startsWith("wachiman.review-result/") && resultFormat !== REVIEW_RESULT_V1 && resultFormat !== REVIEW_RESULT_V2) {
    throw new ForeignFormat(`result format ${JSON.stringify(resultFormat)}`);
  }
  if (resultFormat !== REVIEW_RESULT_V1 && resultFormat !== REVIEW_RESULT_V2) throw new Error("result is not a review result");
  const { result } = parsed;
  if (typeof parsed.savedAt !== "string" || !Array.isArray(parsed.tracking) || !Array.isArray(result.findings)) {
    throw new Error("missing savedAt or tracking");
  }
  if (!Array.isArray(parsed.settled)) throw new Error("missing settled");
  if (typeof result.change?.head?.sha !== "string") throw new Error("missing head sha");
  if (!Array.isArray(result.coverage?.reviewed) || !Array.isArray(result.coverage?.expected)) throw new Error("missing coverage");
  if (!parsed.tracking.every((t: unknown) => t && typeof t === "object" && typeof (t as { firstId?: unknown }).firstId === "string")) {
    throw new Error("malformed tracking");
  }
  if (!parsed.settled.every((t: unknown) => t && typeof t === "object" && typeof (t as { firstId?: unknown }).firstId === "string")) {
    throw new Error("malformed settled");
  }
  if (parsed.unknownIds === undefined) parsed.unknownIds = [];
  else if (!Array.isArray(parsed.unknownIds)) throw new Error("malformed unknownIds");
  // A run saved before result /2 has no verification fields: read it as unverified, origin unknown, so every sink sees one shape.
  if (resultFormat === REVIEW_RESULT_V1) {
    const upgraded = annotateUnverified(result.findings);
    parsed.result = {
      ...result,
      format: REVIEW_RESULT_V2,
      findings: result.findings.map((f: { anchor?: "diff" | "outside" }, i: number) => ({ ...upgraded[i], anchor: f.anchor ?? "outside" })),
    } satisfies Partial<ReviewResultV2>;
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
 * Every readable run of a repository in `savedAt` order. A file that is not JSON or is structurally invalid
 * is renamed `<name>.unreadable-<unix-seconds>`, with one warning, and skipped. A file of another
 * format version is skipped with a warning and left alone: a downgrade must not lose history.
 */
export function readRuns(root: string, key: string, warn: (line: string) => void): HistoryRun[] {
  const runs: HistoryRun[] = [];
  for (const path of runFiles(root, key)) {
    try {
      runs.push(parseRun(path));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof ForeignFormat) {
        warn(`history: ${path} skipped (${reason}); it was written by another version and is left in place`);
        continue;
      }
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
