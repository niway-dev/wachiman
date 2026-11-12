/**
 * The local index (ADR 0035): one SQLite file under the Wachiman home, filled by replaying the history
 * run files, `verdicts.jsonl` and the loop state files. It holds nothing that cannot be rebuilt from
 * them, and no other command reads it: `wachiman dashboard` is the only reader. A missing, outdated or
 * unreadable index is deleted and built again, never repaired; it is written to a temporary file and
 * renamed, so a reader sees all of it or none, at 0600. Bun's built-in `bun:sqlite`: no dependency.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GRADES } from "../fidelity/types";
import { historyRoot, listKeys, loopFiles, readRuns, readVerdicts, runFiles } from "../history/store";
import { replay } from "../history/match";

/** Bump when a table or a column changes: an index of another version is rebuilt, never read. */
export const INDEX_SCHEMA_VERSION = 1;

export const INDEX_FILE = "index.sqlite";
export const indexPath = (wachimanHome: string) => join(wachimanHome, INDEX_FILE);

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE repositories (key TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE runs (
  repo_key TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  day TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  findings INTEGER NOT NULL,
  grade TEXT
);
CREATE TABLE findings (
  repo_key TEXT NOT NULL,
  first_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE verdicts (repo_key TEXT NOT NULL, first_id TEXT NOT NULL, at TEXT NOT NULL, verdict TEXT NOT NULL);
CREATE TABLE loops (
  repo_key TEXT NOT NULL,
  branch TEXT NOT NULL,
  base TEXT NOT NULL,
  outcome TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  first_round_at TEXT,
  last_round_at TEXT
);
CREATE TABLE loop_ledger (repo_key TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL, count INTEGER NOT NULL);
`;

/**
 * Stat of every file the index is built from: when it equals the one stored in the index, nothing
 * was added, edited or removed since, and the index is reused. Size and modification time in
 * nanoseconds; no file is read.
 */
function sourceSignature(root: string): string {
  const lines: string[] = [];
  const stat = (key: string, path: string, name: string) => {
    const s = statSync(path, { bigint: true });
    lines.push(`${key}/${name}\t${s.size}\t${s.mtimeNs}`);
  };
  for (const key of listKeys(root)) {
    for (const [sub, names] of [["runs", runFiles(root, key)], ["loops", loopFiles(root, key)]] as const) {
      for (const path of names) stat(key, path, `${sub}/${basename(path)}`);
    }
    const verdicts = join(root, key, "verdicts.jsonl");
    if (existsSync(verdicts)) stat(key, verdicts, "verdicts.jsonl");
  }
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

/** Whether the file at `path` is a readable index of this schema version built from sources that look like `signature`. */
function upToDate(path: string, signature: string): boolean {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== INDEX_SCHEMA_VERSION) return false;
    const check = db.query("PRAGMA quick_check").get() as { quick_check: string };
    if (check.quick_check !== "ok") return false;
    const row = db.query("SELECT value FROM meta WHERE key = 'signature'").get() as { value: string } | null;
    return row?.value === signature;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

interface LoopRecord {
  branch: string;
  base: string;
  outcome: "open" | "converged";
  rounds: { at: string }[];
  ledger: { status: string }[];
}

/** A loop state file read leniently: only the fields the index stores. Undefined when it is not a loop state. */
function readLoopRecord(path: string): LoopRecord | undefined {
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    if (!s || typeof s !== "object" || s.format !== "wachiman.loop-state/1") return undefined;
    if (typeof s.branch !== "string" || typeof s.base !== "string" || (s.status !== "open" && s.status !== "converged")) return undefined;
    if (!Array.isArray(s.rounds) || !s.rounds.every((r: any) => r && typeof r.at === "string")) return undefined;
    const ledger = Array.isArray(s.ledger) ? s.ledger.filter((e: any) => e && typeof e.status === "string") : [];
    return { branch: s.branch, base: s.base, outcome: s.status, rounds: s.rounds, ledger };
  } catch {
    return undefined;
  }
}

function fill(db: Database, root: string, warn: (line: string) => void) {
  const repo = db.prepare("INSERT INTO repositories (key, name) VALUES (?, ?)");
  const run = db.prepare("INSERT INTO runs (repo_key, saved_at, day, head_sha, model, cost_usd, findings, grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const finding = db.prepare("INSERT INTO findings (repo_key, first_id, severity, topic, status, verdict, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const verdict = db.prepare("INSERT INTO verdicts (repo_key, first_id, at, verdict) VALUES (?, ?, ?, ?)");
  const loop = db.prepare("INSERT INTO loops (repo_key, branch, base, outcome, rounds, first_round_at, last_round_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const ledger = db.prepare("INSERT INTO loop_ledger (repo_key, branch, status, count) VALUES (?, ?, ?, ?)");

  for (const key of listKeys(root)) {
    const runs = readRuns(root, key, warn);
    const verdicts = readVerdicts(root, key);
    const loops = loopFiles(root, key).flatMap((path) => {
      const record = readLoopRecord(path);
      if (!record) warn(`dashboard: ${path} is not a loop state; skipped`);
      return record ? [record] : [];
    });
    if (runs.length === 0 && loops.length === 0) continue;
    repo.run(key, runs.at(-1)?.repository.name ?? key);
    for (const r of runs) {
      const cost = r.result.execution?.costUsdEstimate;
      const grade = (r.result as { fidelity?: { grade?: unknown } }).fidelity?.grade;
      run.run(
        key,
        r.savedAt,
        r.savedAt.slice(0, 10),
        r.result.change.head.sha,
        r.result.provider?.model ?? "",
        typeof cost === "number" && Number.isFinite(cost) ? cost : 0,
        r.result.findings.length,
        typeof grade === "string" && (GRADES as readonly string[]).includes(grade) ? grade : null,
      );
    }
    for (const f of replay(runs, verdicts).findings) {
      finding.run(key, f.firstId, f.severity, f.topic, f.status, f.verdict?.verdict ?? null, f.lastSeenAt);
    }
    for (const v of verdicts.values()) verdict.run(key, v.firstId, v.at, v.verdict);
    for (const l of loops) {
      loop.run(key, l.branch, l.base, l.outcome, l.rounds.length, l.rounds[0]?.at ?? null, l.rounds.at(-1)?.at ?? null);
      const counts = new Map<string, number>();
      for (const e of l.ledger) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
      for (const [status, count] of counts) ledger.run(key, l.branch, status, count);
    }
  }
}

const unlinkQuiet = (path: string) => {
  try {
    unlinkSync(path);
  } catch {
    // Not there.
  }
};
/** A database file and the journal files SQLite may keep beside it. */
const removeAll = (path: string) => [path, `${path}-journal`, `${path}-wal`, `${path}-shm`].forEach(unlinkQuiet);

const STALE_TMP_MS = 86_400_000;

/** Temporary files a crashed rebuild left behind: `index.sqlite.tmp-<pid>` untouched for a day. */
function sweepStaleTemporaries(home: string) {
  for (const name of readdirSync(home)) {
    if (!name.startsWith(`${INDEX_FILE}.tmp-`)) continue;
    try {
      if (Date.now() - statSync(join(home, name)).mtimeMs > STALE_TMP_MS) removeAll(join(home, name));
    } catch {
      // Gone already.
    }
  }
}

/**
 * Makes `<home>/index.sqlite` current and returns its path; `rebuilt` says whether the file was
 * written. Reading the run files has the side effects `history` has: a damaged one is moved aside
 * with a warning. The signature of the sources is taken before the replay and stored with it, so a
 * file written while the index is being built makes the next call rebuild. The old index is replaced
 * by the rename and not before: a rebuild that fails leaves it where it was. `beforeReplay` is for tests.
 */
export function refreshIndex(wachimanHome: string, warn: (line: string) => void, beforeReplay?: () => void): { path: string; rebuilt: boolean } {
  const root = historyRoot(wachimanHome);
  const path = indexPath(wachimanHome);
  const signature = sourceSignature(root);
  if (existsSync(path) && upToDate(path, signature)) return { path, rebuilt: false };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  sweepStaleTemporaries(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  removeAll(tmp);
  // Created 0600 before SQLite writes a byte; an empty file is a valid new database.
  closeSync(openSync(tmp, "w", 0o600));
  chmodSync(tmp, 0o600);
  const db = new Database(tmp);
  try {
    beforeReplay?.();
    db.run(SCHEMA);
    db.transaction(() => fill(db, root, warn))();
    db.prepare("INSERT INTO meta (key, value) VALUES ('signature', ?)").run(signature);
    db.run(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`);
    db.close();
    renameSync(tmp, path);
  } catch (error) {
    try {
      db.close();
    } catch {
      // Already closed.
    }
    removeAll(tmp);
    throw error;
  }
  // Journal files of the index that was just replaced belong to it, not to the new one.
  for (const stale of [`${path}-journal`, `${path}-wal`, `${path}-shm`]) unlinkQuiet(stale);
  return { path, rebuilt: true };
}
