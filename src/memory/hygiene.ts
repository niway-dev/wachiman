/**
 * Memory hygiene (spec decision 12, ADR 0056 decision 9): Wachiman points at likely problems and
 * never applies a change. Everything here is deterministic: no model is called.
 *
 * - Likely duplicates: two entries of the same kind whose scopes overlap and whose rule text is
 *   near-identical (`similarity` at or above `DUPLICATE_THRESHOLD`). Likely contradictions are not
 *   detected: telling that two rules disagree needs a model.
 * - Archive suggestions: an entry whose last recorded use (or, with none recorded, its `added` date) is
 *   older than `memory.archive_after_days`. Uses are recorded only on the laptop (`recordMemoryUse`).
 *   When the record itself is missing or unreadable, the use of every entry is unknown and none is suggested.
 * - `archiveEntry` is the one function that moves text, and only on the developer's explicit command.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
  /** The date the age is counted from: the last recorded use, else the later of the `added` date and when recording began. */
  since: string;
  /** Whether a use was recorded on or after the entry's added date; false means no use is recorded, not that none happened off this laptop. */
  usedEver: boolean;
  days: number;
}

/** Live entries whose last use is more than `afterDays` days before `today`, oldest first. `recordingSince` is the date the record began (see `MemoryUse`). */
export function archiveSuggestions(entries: MemoryEntry[], lastUse: Record<string, string>, afterDays: number, today: string, recordingSince?: string): ArchiveSuggestion[] {
  return entries
    .filter((e) => e.file !== ARCHIVE_FILE)
    .map((entry) => {
      const used = lastUse[entry.id];
      // A use dated before the entry was added cannot be a use of this entry (an id reused after an archive and re-add): it counts for nothing.
      const usedSince = used !== undefined && used >= entry.added;
      // With no use recorded, the entry is measured from when it was added or when the laptop began recording, whichever is later: before that the record cannot tell.
      const unusedSince = recordingSince !== undefined && recordingSince > entry.added ? recordingSince : entry.added;
      const since = usedSince ? used : unusedSince;
      return { entry, since, usedEver: usedSince, days: daysBetween(since, today) };
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

interface UseRecord {
  used: Record<string, string>;
  /** The date of the first recording; absent in a record written without one. */
  since?: string;
}

/** The parsed record, empty when the file is missing; throws when it exists but cannot be read or is not this format. */
function loadMemoryUse(home: string, key: string): UseRecord {
  const path = memoryUsePath(home, key);
  if (!existsSync(path)) return { used: {} };
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} could not be read (${error instanceof Error ? error.message : error})`);
  }
  if (parsed?.format !== MEMORY_USE_FORMAT || typeof parsed.used !== "object" || parsed.used === null) {
    throw new Error(`${path} is not a ${MEMORY_USE_FORMAT} record`);
  }
  const used = Object.fromEntries(Object.entries(parsed.used).filter(([id, d]) => ID.test(id) && typeof d === "string" && DATE.test(d))) as Record<string, string>;
  return { used, ...(typeof parsed.since === "string" && DATE.test(parsed.since) ? { since: parsed.since } : {}) };
}

/** What the laptop knows about use: the dates by entry id, or why it knows nothing (no record, or one that cannot be read). */
export type MemoryUse = { known: true; used: Record<string, string>; since?: string } | { known: false; reason: string };

/**
 * The record of last use. A missing or unreadable record is `known: false`, never an empty record:
 * "no record" must not be read as "no entry was ever used".
 */
export function readMemoryUse(home: string, key: string): MemoryUse {
  const path = memoryUsePath(home, key);
  if (!existsSync(path)) return { known: false, reason: `no use record at ${path}: no laptop review with history on has loaded memory yet` };
  try {
    return { known: true, ...loadMemoryUse(home, key) };
  } catch (error) {
    return { known: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Writes `text` to `path` through a new, randomly named temporary file in the same directory, then renames it over `path`.
 * The temporary file is created exclusively (it never opens an existing path, so a symbolic link planted at a guessable
 * name is not followed) and the rename replaces `path` itself, even when `path` is a symbolic link, instead of writing through it.
 */
export function writeFileAtomically(path: string, text: string, mode: number): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx", mode);
  try {
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // already gone
    }
    throw error;
  }
}

/**
 * Records that these entries were used on `date`; a later date replaces an earlier one, never the reverse.
 * With no ids it still creates the record when absent: a review that loaded memory and used nothing is
 * knowledge ("not used"), unlike having no record at all ("unknown").
 * Throws, writing nothing, when an existing record cannot be read or is another format: it is never overwritten.
 */
export function recordMemoryUse(home: string, key: string, ids: string[], date: string): void {
  let record: UseRecord;
  try {
    record = loadMemoryUse(home, key);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}; it was left as it is`);
  }
  const used = record.used;
  for (const id of ids) if (!used[id] || used[id] < date) used[id] = date;
  const since = record.since !== undefined && record.since < date ? record.since : date;
  const path = memoryUsePath(home, key);
  for (const dir of [dirname(dirname(path)), dirname(path)]) {
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  writeFileAtomically(path, `${JSON.stringify({ format: MEMORY_USE_FORMAT, since, used }, null, 2)}\n`, 0o600);
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
const FIELD = /^- [a-z][a-z ]*:/;
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The index of the last line that belongs to the entry whose heading is at `start`: the heading, its
 * `- field:` lines and their indented continuations. It stops at the next heading, as the entry parser does,
 * and skips fenced code blocks the way the parser does (a `#` line inside a fence is not a heading). Free prose or
 * a table after the fields, up to the next heading, is not part of the entry and is not returned.
 */
function lastEntryLine(rows: string[], start: number): number {
  let last = start;
  let fence: string | undefined;
  let seenField = false;
  for (let i = start + 1; i < rows.length; i++) {
    const raw = rows[i];
    const opener = FENCE_OPENER.exec(raw);
    if (fence !== undefined) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length && raw.trim() === opener[1]) fence = undefined;
      continue;
    }
    if (opener) {
      fence = opener[1];
      continue;
    }
    if (ANY_HEADING.test(raw)) break;
    if (FIELD.test(raw)) {
      seenField = true;
      last = i;
    } else if (seenField && /^ {2}\S/.test(raw)) last = i;
  }
  return last;
}

/**
 * The memory files after entry `id` moves from its file to `archive.md`. The entry's own lines are moved
 * as they are written; nothing else is rewritten or removed. Pure: the caller writes the files.
 */
export function archiveEntry(current: Record<string, string>, id: string): ArchiveResult {
  const archived = current[ARCHIVE_FILE] !== undefined && parseMemoryFile(ARCHIVE_FILE, current[ARCHIVE_FILE]).entries.some((e) => e.id === id);
  for (const [name, text] of Object.entries(current)) {
    if (name === ARCHIVE_FILE) continue;
    const entry = parseMemoryFile(name, text).entries.find((e) => e.id === id);
    if (!entry) continue;
    const rows = text.split("\n");
    const start = entry.line - 1;
    const contentEnd = lastEntryLine(rows, start) + 1;
    const block = `${rows.slice(start, contentEnd).join("\n")}\n`;
    // Only the entry's own lines go, with the one blank line that separated it; the rest of the file keeps every byte.
    let rest: string;
    if (rows.slice(contentEnd).every((r) => r.trim() === "")) {
      const from = start > 0 && rows[start - 1] === "" ? start - 1 : start;
      rest = [...rows.slice(0, from), ...(text.endsWith("\n") ? [""] : [])].join("\n");
    } else {
      const cut = rows[contentEnd] === "" ? contentEnd + 1 : contentEnd;
      rest = [...rows.slice(0, start), ...rows.slice(cut)].join("\n");
    }
    const archive = current[ARCHIVE_FILE];
    const next = archive === undefined ? `# Wachiman memory archive\n\nEntries moved here are never loaded by a review.\n\n${block}` : `${archive.replace(/\n*$/, "\n")}\n${block}`;
    return { ok: true, from: name, files: { [name]: rest, [ARCHIVE_FILE]: next } };
  }
  return { ok: false, reason: archived ? `entry ${id} is already in ${ARCHIVE_FILE}.` : `no entry ${id} in .wachiman/memory/.` };
}
