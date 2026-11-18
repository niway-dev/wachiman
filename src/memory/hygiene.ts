/**
 * Memory hygiene (spec decision 12, ADR 0056 decision 9): Wachiman points at likely problems and
 * never applies a change. Everything here is deterministic: no model is called.
 *
 * - Likely duplicates: two entries of the same kind whose scopes overlap and whose rule text is
 *   near-identical (`similarity` at or above `DUPLICATE_THRESHOLD`). Likely contradictions are not
 *   detected: telling that two rules disagree needs a model.
 * - Archive suggestions: an entry whose last recorded use (or, with none, its `added` date) is older
 *   than `memory.archive_after_days`. Uses are recorded only on the laptop (`recordMemoryUse`).
 * - `archiveEntry` is the one function that moves text, and only on the developer's explicit command.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { historyRoot } from "../history/store";
import { parseMemoryFile, type MemoryEntry } from "./entries";
import { ARCHIVE_FILE, globsOf, matchesGlob, type MemoryLoad } from "./load";

/** Jaccard overlap of the normalised word sets at or above which two rules are called near-identical. */
export const DUPLICATE_THRESHOLD = 0.8;

const tokens = (text: string): Set<string> => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** Size of the intersection over the size of the union of the two rules' lowercase word sets; 1 for two empty rules. */
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 && y.size === 0) return 1;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

/** The literal directory segments of a glob before its first wildcard segment. */
const literalPrefix = (glob: string): string[] => {
  const out: string[] = [];
  for (const s of glob.split("/")) {
    if (/[*?[\]{}!]/.test(s)) break;
    out.push(s);
  }
  return out;
};

/**
 * Whether two scopes can reach the same path, judged from their literal prefixes: one prefix
 * contains the other (`src/**` and `src/api/*.ts` overlap, `src/**` and `docs/**` do not).
 * Conservative on purpose: it may say two scopes overlap when no real path matches both.
 */
export function scopesOverlap(a: string, b: string): boolean {
  return globsOf(a).some((x) =>
    globsOf(b).some((y) => {
      const p = literalPrefix(x);
      const q = literalPrefix(y);
      const n = Math.min(p.length, q.length);
      return p.slice(0, n).every((s, i) => s === q[i]);
    }),
  );
}

export interface DuplicatePair {
  a: MemoryEntry;
  b: MemoryEntry;
  similarity: number;
}

/** Pairs of live entries (not those in `archive.md`) of the same kind with overlapping scopes and near-identical rules. */
export function findDuplicates(entries: MemoryEntry[]): DuplicatePair[] {
  const live = entries.filter((e) => e.file !== ARCHIVE_FILE);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (a.id === b.id || a.kind !== b.kind || !scopesOverlap(a.scope, b.scope)) continue;
      const s = similarity(a.rule, b.rule);
      if (s >= DUPLICATE_THRESHOLD) pairs.push({ a, b, similarity: s });
    }
  }
  return pairs;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export interface ArchiveSuggestion {
  entry: MemoryEntry;
  /** The date the age is counted from: the last recorded use, else the `added` date. */
  since: string;
  usedEver: boolean;
  days: number;
}

/** Live entries whose last use is more than `afterDays` days before `today`, oldest first. */
export function archiveSuggestions(entries: MemoryEntry[], lastUse: Record<string, string>, afterDays: number, today: string): ArchiveSuggestion[] {
  return entries
    .filter((e) => e.file !== ARCHIVE_FILE)
    .map((entry) => {
      const used = lastUse[entry.id];
      const since = used && used > entry.added ? used : entry.added;
      return { entry, since, usedEver: used !== undefined, days: daysBetween(since, today) };
    })
    .filter((s) => s.days > afterDays)
    .sort((a, b) => b.days - a.days || a.entry.id.localeCompare(b.entry.id));
}

// ---- Last use: a small local record, per repository, under the Wachiman home. ----

export const MEMORY_USE_FORMAT = "wachiman.memory-use/1";
const ID = /^[0-9a-f]{7}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `<home>/history/<repo key>/memory-use.json`: the local history store; it never exists in Actions. */
export const memoryUsePath = (home: string, key: string) => join(historyRoot(home), key, "memory-use.json");

/** The parsed record, `{}` when the file is missing; throws when it exists but cannot be read or is not this format. */
function loadMemoryUse(home: string, key: string): Record<string, string> {
  const path = memoryUsePath(home, key);
  if (!existsSync(path)) return {};
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} could not be read (${error instanceof Error ? error.message : error}); it was left as it is`);
  }
  if (parsed?.format !== MEMORY_USE_FORMAT || typeof parsed.used !== "object" || parsed.used === null) {
    throw new Error(`${path} is not a ${MEMORY_USE_FORMAT} record; it was left as it is`);
  }
  return Object.fromEntries(Object.entries(parsed.used).filter(([id, d]) => ID.test(id) && typeof d === "string" && DATE.test(d))) as Record<string, string>;
}

/** Entry id to the date of its last recorded use. A missing or unreadable record is empty. */
export function readMemoryUse(home: string, key: string): Record<string, string> {
  try {
    return loadMemoryUse(home, key);
  } catch {
    return {};
  }
}

/**
 * Records that these entries were used on `date`; a later date replaces an earlier one, never the reverse.
 * Throws, writing nothing, when an existing record cannot be read or is another format: it is never overwritten.
 */
export function recordMemoryUse(home: string, key: string, ids: string[], date: string): void {
  if (ids.length === 0) return;
  const used = loadMemoryUse(home, key);
  for (const id of ids) if (!used[id] || used[id] < date) used[id] = date;
  const path = memoryUsePath(home, key);
  for (const dir of [dirname(dirname(path)), dirname(path)]) {
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, `${JSON.stringify({ format: MEMORY_USE_FORMAT, used }, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/**
 * The entries a review used: every loaded convention whose scope matches a changed path (it was in
 * the prompt for that diff), and every exception that muted a finding.
 */
export function entriesUsed(memory: MemoryLoad | undefined, changedPaths: string[], muted: { entry: string }[]): string[] {
  const ids = new Set<string>(muted.map((m) => m.entry));
  for (const e of memory?.entries ?? []) {
    if (e.kind === "convention" && changedPaths.some((p) => matchesGlob(e.scope, p))) ids.add(e.id);
  }
  return [...ids];
}

// ---- Archiving ----

export type ArchiveResult = { ok: true; from: string; files: Record<string, string> } | { ok: false; reason: string };

const ANY_HEADING = /^#{1,6}\s/;

/**
 * The memory files after entry `id` moves from its file to `archive.md`. The entry's text is moved
 * as it is written; nothing is rewritten. Pure: the caller writes the files.
 */
export function archiveEntry(current: Record<string, string>, id: string): ArchiveResult {
  const archived = current[ARCHIVE_FILE] !== undefined && parseMemoryFile(ARCHIVE_FILE, current[ARCHIVE_FILE]).entries.some((e) => e.id === id);
  for (const [name, text] of Object.entries(current)) {
    if (name === ARCHIVE_FILE) continue;
    const entry = parseMemoryFile(name, text).entries.find((e) => e.id === id);
    if (!entry) continue;
    const rows = text.split("\n");
    const start = entry.line - 1;
    let end = rows.length;
    for (let i = start + 1; i < rows.length; i++) {
      if (ANY_HEADING.test(rows[i])) {
        end = i;
        break;
      }
    }
    const block = rows.slice(start, end).join("\n").replace(/\n+$/, "\n");
    const rest = [...rows.slice(0, start), ...rows.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
    const archive = current[ARCHIVE_FILE];
    const next = archive === undefined ? `# Wachiman memory archive\n\nEntries moved here are never loaded by a review.\n\n${block}` : `${archive.replace(/\n*$/, "\n")}\n${block}`;
    return { ok: true, from: name, files: { [name]: rest, [ARCHIVE_FILE]: next } };
  }
  return { ok: false, reason: archived ? `entry ${id} is already in ${ARCHIVE_FILE}.` : `no entry ${id} in .wachiman/memory/.` };
}
