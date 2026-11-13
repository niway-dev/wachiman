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
import { listLedgerAccounts, readDayFile } from "../ledger-read/files";

/** Bump when a table or a column changes: an index of another version is rebuilt, never read. */
export const INDEX_SCHEMA_VERSION = 2;

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
  effort TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL DEFAULT '',
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
CREATE TABLE verdicts (repo_key TEXT NOT NULL, first_id TEXT NOT NULL, at TEXT, verdict TEXT NOT NULL);
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
CREATE TABLE ledger_pulls (account TEXT PRIMARY KEY, pulled_at TEXT NOT NULL, from_day TEXT NOT NULL, to_day TEXT NOT NULL, daily_limit_usd REAL, weekly_limit_usd REAL);
CREATE TABLE ledger_entries (
  account TEXT NOT NULL,
  id TEXT NOT NULL,
  day TEXT NOT NULL,
  week TEXT NOT NULL,
  repository TEXT NOT NULL,
  pr INTEGER,
  run_id TEXT,
  run_attempt INTEGER,
  trigger TEXT NOT NULL,
  state TEXT NOT NULL,
  reserved_usd REAL NOT NULL,
  settled_usd REAL
);
CREATE TABLE ledger_calls (account TEXT NOT NULL, entry_id TEXT NOT NULL, model TEXT NOT NULL, auth TEXT NOT NULL, cost_usd REAL NOT NULL, cost_known INTEGER NOT NULL);
`;

const vanished = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Runs `fn`; when a file or directory it listed was removed meanwhile (a prune, a forget, another dashboard), once more. */
function retryOnce<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!vanished(error)) throw error;
    return fn();
  }
}

/**
 * Stat of every file the index is built from: when it equals the one stored in the index, nothing
 * was added, edited or removed since, and the index is reused. Size and modification time in
 * nanoseconds; no file is read. A file that vanishes between the listing and the stat is absent.
 */
function sourceSignature(root: string, afterListing?: () => void): string {
  const listed: { name: string; path: string }[] = [];
  for (const key of listKeys(root)) {
    for (const [sub, names] of [["runs", runFiles(root, key)], ["loops", loopFiles(root, key)]] as const) {
      for (const path of names) listed.push({ name: `${key}/${sub}/${basename(path)}`, path });
    }
    const verdicts = join(root, key, "verdicts.jsonl");
    if (existsSync(verdicts)) listed.push({ name: `${key}/verdicts.jsonl`, path: verdicts });
  }
  for (const account of listLedgerAccounts(dirname(root))) {
    for (const path of [account.pullFile, ...account.dayFiles]) listed.push({ name: `ledger/${account.account}/${basename(path)}`, path });
  }
  afterListing?.();
  const lines: string[] = [];
  for (const { name, path } of listed) {
    try {
      const s = statSync(path, { bigint: true });
      lines.push(`${name}\t${s.size}\t${s.mtimeNs}`);
    } catch (error) {
      if (!vanished(error)) throw error;
    }
  }
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

/** One probe per table: it fails when the table or any column the figures read is missing. */
const PROBES = [
  "SELECT key, value FROM meta LIMIT 0",
  "SELECT key, name FROM repositories LIMIT 0",
  "SELECT repo_key, saved_at, day, head_sha, model, effort, profile, cost_usd, findings, grade FROM runs LIMIT 0",
  "SELECT repo_key, first_id, severity, topic, status, verdict, last_seen_at FROM findings LIMIT 0",
  "SELECT repo_key, first_id, at, verdict FROM verdicts LIMIT 0",
  "SELECT repo_key, branch, base, outcome, rounds, first_round_at, last_round_at FROM loops LIMIT 0",
  "SELECT repo_key, branch, status, count FROM loop_ledger LIMIT 0",
  "SELECT account, pulled_at, from_day, to_day, daily_limit_usd, weekly_limit_usd FROM ledger_pulls LIMIT 0",
  "SELECT account, id, day, week, repository, pr, run_id, run_attempt, trigger, state, reserved_usd, settled_usd FROM ledger_entries LIMIT 0",
  "SELECT account, entry_id, model, auth, cost_usd, cost_known FROM ledger_calls LIMIT 0",
];

/** Whether the file at `path` is a readable index of this schema version built from sources that look like `signature`. */
function upToDate(path: string, signature: string): boolean {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== INDEX_SCHEMA_VERSION) return false;
    const check = db.query("PRAGMA quick_check").get() as { quick_check: string };
    if (check.quick_check !== "ok") return false;
    for (const probe of PROBES) db.query(probe).all();
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

/**
 * A loop state file read leniently: only the fields the index stores. Undefined when its content is
 * not a loop state (it does not parse or has the wrong shape; the caller warns and skips it). Null
 * when the file vanished while it was read, which counts as absent (read once more first). Any other
 * read error (permissions, I/O) is thrown, not reported as "not a loop state".
 */
function readLoopRecord(path: string): LoopRecord | undefined | null {
  let text: string;
  try {
    text = retryOnce(() => readFileSync(path, "utf8"));
  } catch (error) {
    if (vanished(error)) return null;
    throw error;
  }
  try {
    const s = JSON.parse(text);
    if (!s || typeof s !== "object" || s.format !== "wachiman.loop-state/1") return undefined;
    if (typeof s.branch !== "string" || typeof s.base !== "string" || (s.status !== "open" && s.status !== "converged")) return undefined;
    if (!Array.isArray(s.rounds) || !s.rounds.every((r: any) => r && typeof r.at === "string")) return undefined;
    const ledger = Array.isArray(s.ledger) ? s.ledger.filter((e: any) => e && typeof e.status === "string") : [];
    return { branch: s.branch, base: s.base, outcome: s.status, rounds: s.rounds, ledger };
  } catch {
    return undefined;
  }
}

/** Fills the tables; returns how many loop files were skipped because their content is not a loop state. */
function fill(db: Database, root: string, warn: (line: string) => void): number {
  let skipped = 0;
  const repo = db.prepare("INSERT INTO repositories (key, name) VALUES (?, ?)");
  const run = db.prepare("INSERT INTO runs (repo_key, saved_at, day, head_sha, model, effort, profile, cost_usd, findings, grade) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const finding = db.prepare("INSERT INTO findings (repo_key, first_id, severity, topic, status, verdict, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const verdict = db.prepare("INSERT INTO verdicts (repo_key, first_id, at, verdict) VALUES (?, ?, ?, ?)");
  const loop = db.prepare("INSERT INTO loops (repo_key, branch, base, outcome, rounds, first_round_at, last_round_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const ledger = db.prepare("INSERT INTO loop_ledger (repo_key, branch, status, count) VALUES (?, ?, ?, ?)");

  for (const key of listKeys(root)) {
    const runs = readRuns(root, key, warn);
    const verdicts = readVerdicts(root, key);
    const loops = loopFiles(root, key).flatMap((path) => {
      const record = readLoopRecord(path);
      if (record === undefined) {
        skipped++;
        warn(`dashboard: ${path} is not a loop state; skipped`);
      }
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
        r.result.provider?.effort ?? "",
        (r.result.format === "wachiman.review-result/2" ? r.result.provider.account?.name : undefined) ?? r.result.provider?.profile ?? "",
        typeof cost === "number" && Number.isFinite(cost) ? cost : 0,
        r.result.findings.length,
        typeof grade === "string" && (GRADES as readonly string[]).includes(grade) ? grade : null,
      );
    }
    for (const f of replay(runs, verdicts).findings) {
      finding.run(key, f.firstId, f.severity, f.topic, f.status, f.verdict?.verdict ?? null, f.lastSeenAt);
    }
    for (const v of verdicts.values()) verdict.run(key, v.firstId, typeof v.at === "string" ? v.at : null, v.verdict);
    for (const l of loops) {
      loop.run(key, l.branch, l.base, l.outcome, l.rounds.length, l.rounds[0]?.at ?? null, l.rounds.at(-1)?.at ?? null);
      const counts = new Map<string, number>();
      for (const e of l.ledger) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
      for (const [status, count] of counts) ledger.run(key, l.branch, status, count);
    }
  }
  fillLedger(db, root, warn);
  return skipped;
}

/** The downloaded ledger entries (ADR 0039): one row per entry and per call, from the day files. */
function fillLedger(db: Database, root: string, warn: (line: string) => void) {
  const pull = db.prepare("INSERT INTO ledger_pulls (account, pulled_at, from_day, to_day, daily_limit_usd, weekly_limit_usd) VALUES (?, ?, ?, ?, ?, ?)");
  const entry = db.prepare(
    "INSERT INTO ledger_entries (account, id, day, week, repository, pr, run_id, run_attempt, trigger, state, reserved_usd, settled_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const call = db.prepare("INSERT INTO ledger_calls (account, entry_id, model, auth, cost_usd, cost_known) VALUES (?, ?, ?, ?, ?, ?)");
  for (const a of listLedgerAccounts(dirname(root))) {
    pull.run(a.account, a.meta.pulledAt, a.meta.from, a.meta.to, a.meta.limits.dailyUsd, a.meta.limits.weeklyUsd);
    const seen = new Set<string>();
    for (const path of a.dayFiles) {
      const entries = readDayFile(path);
      if (!entries) {
        warn(`dashboard: ${path} is not a ledger day file; skipped`);
        continue;
      }
      for (const e of entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        entry.run(a.account, e.id, e.day, e.week, e.repository, e.pr, e.run_id === null ? null : String(e.run_id), e.run_attempt, e.trigger, e.state, e.reservedUsd, e.settledUsd);
        for (const c of e.calls) call.run(a.account, e.id, c.model, c.auth, c.cost_usd ?? 0, c.costKnown ? 1 : 0);
      }
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

export interface RefreshHooks {
  /** For tests: runs after the signature was taken and before the replay reads the files. */
  beforeReplay?: () => void;
  /** For tests: runs between the listing of the source files and their stat. */
  afterListing?: () => void;
  /** Rebuild even when the index looks current. */
  force?: boolean;
}

/**
 * Makes `<home>/index.sqlite` current and returns its path; `rebuilt` says whether the file was
 * written. Reading the run files has the side effects `history` has: a damaged one is moved aside
 * with a warning. The signature of the sources is taken before the replay and stored with it, so a
 * file written while the index is being built makes the next call rebuild. The old index is replaced
 * by the rename and not before: a rebuild that fails leaves it where it was. A missing-file error
 * (ENOENT) that escapes the scan or the replay, for example a history directory forgotten while it
 * is listed, makes the whole refresh run once more. A run or loop file removed between the listing
 * and the parse does not reach that retry: a loop file counts as absent, a run file is skipped with a
 * warning, and the next call rebuilds because the sources no longer match the stored signature. A loop file that cannot be read for another reason
 * (permissions, I/O) makes the refresh throw. A loop file whose content is not a loop state is skipped
 * with a warning, and the index is stored with a signature that never matches, so every later call
 * rebuilds and warns again until the file is fixed or removed. A run file that readRuns leaves in
 * place (another format version, kept so a downgrade loses no history, or one that could not be
 * moved aside) is warned about only by the call that rebuilt the index: it does not force a rebuild
 * on every later call.
 */
export function refreshIndex(wachimanHome: string, warn: (line: string) => void, hooks: RefreshHooks = {}): { path: string; rebuilt: boolean } {
  const root = historyRoot(wachimanHome);
  const path = indexPath(wachimanHome);
  return retryOnce(() => {
    const signature = sourceSignature(root, hooks.afterListing);
    if (!hooks.force && existsSync(path) && upToDate(path, signature)) return { path, rebuilt: false };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    sweepStaleTemporaries(dirname(path));
    const tmp = `${path}.tmp-${process.pid}`;
    removeAll(tmp);
    // Created 0600 before SQLite writes a byte; an empty file is a valid new database.
    closeSync(openSync(tmp, "w", 0o600));
    chmodSync(tmp, 0o600);
    const db = new Database(tmp);
    try {
      hooks.beforeReplay?.();
      db.run(SCHEMA);
      const skipped = db.transaction(() => fill(db, root, warn))();
      // An index that left a loop file out must not look current: a stored value that no computed
      // signature equals makes the next call rebuild, and warn again, until the file is fixed.
      db.prepare("INSERT INTO meta (key, value) VALUES ('signature', ?)").run(skipped > 0 ? `incomplete:${signature}` : signature);
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
  });
}
