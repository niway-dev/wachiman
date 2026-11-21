/**
 * Reading repository memory for a review (ADR 0056 decisions 1, 2 and 8): which files of
 * `.wachiman/memory/` a review loads, within what budget, and what it records about it.
 *
 * The files are read from the base commit through a `MemorySource`, never from the head, so the
 * pull request under review cannot change the rules it is reviewed under. `index.md` is always
 * loaded; an area file is loaded only when a glob that `index.md` maps to it matches a changed
 * path; `archive.md` and any file the index does not list are never loaded. Over the budget, the
 * most specific globs go first and the rest are named as left out.
 *
 * This layer loads, selects, budgets and records. It does not put anything into a prompt and does
 * not mute anything: `MemoryLoad.entries` is what the review prompt consumes for conventions, and
 * what the engine's matching step consumes after discovery to mute Consider and Info findings that
 * an in-scope exception covers.
 */
import { UsageError } from "../config";
import { ignoredSettingsNote, resolveMemorySettings, type MemorySettings, type RepoSettings } from "../repo-settings";
import { parseIndexMap, parseMemoryFile, type MemoryEntry } from "./entries";

/** Where memory lives, from the repository root. Fixed: a pull request cannot repoint it. */
export const MEMORY_DIR = ".wachiman/memory";
export const INDEX_FILE = "index.md";
export const ARCHIVE_FILE = "archive.md";

/** The memory folder and the settings file at one commit. Implemented by each connector. */
export interface MemorySource {
  /** The names of the files directly inside `.wachiman/memory/`; empty when the folder does not exist. */
  list(): string[];
  /** One file's text (cut at the connector's size limit), or null when it is not there. */
  read(name: string): string | null;
  /** `.wachiman.yml` at the same commit, parsed; undefined when absent. A broken file throws `UsageError`. */
  settings(): RepoSettings | undefined;
}

export interface LoadedMemoryFile {
  /** Repository path, such as `.wachiman/memory/index.md`. */
  path: string;
  /** Lines of the file that were loaded. */
  lines: number;
  /** Set when the file was longer than the budget allowed and only its first lines were loaded. */
  truncated?: boolean;
  /** Set on a file of the personal folder; its `path` is then `personal:<name>`, never a repository path. */
  personal?: true;
}

/** What a review recorded about its memory; the `memory` field of the review result. */
export interface MemoryRecord {
  /** The base commit the memory was read at. */
  revision: string;
  /** Loaded files in load order: the index first, then area files from most to least specific. */
  files: LoadedMemoryFile[];
  /** Area files that matched a changed path and did not fit the budget. */
  leftOut: string[];
  /** The loaded memory did not fit: files were left out, the index was cut, or the index is over `max_index_lines`. */
  overBudget: boolean;
  /** `index.md` is longer than `memory.max_index_lines`. */
  indexOverBudget: boolean;
  budget: { maxIndexLines: number; maxLoadedLines: number; loadedLines: number };
  /** The ids of the loaded entries that came from the developer's personal memory (laptop reviews only). Absent when none did. */
  personalEntries?: string[];
}

export interface MemoryLoad extends MemoryRecord {
  /** The entries of the loaded text, in file order. */
  entries: MemoryEntry[];
}

export const memoryRecord = ({ entries: _entries, ...record }: MemoryLoad): MemoryRecord => record;

/** What a review says when a memory file was longer than a connector can read, so only its start is memory. */
export const cutMemoryNote = (name: string, kb: number) =>
  `${MEMORY_DIR}/${name} is longer than ${kb} KB and was read only up to there; the rest of it is not memory for this review. Split it into area files.`;

const WILDCARD = /[*?[\]{}!]/;

/**
 * The globs of a `scope` or an index row: one, or several separated by commas. A comma inside
 * braces (`src/{a,b}/**`) belongs to the glob; with unbalanced braces every comma separates.
 */
export function globsOf(scope: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < scope.length; i++) {
    const c = scope[i];
    if (c === "{") depth++;
    else if (c === "}" && depth > 0) depth--;
    else if (c === "," && depth === 0) {
      parts.push(scope.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(scope.slice(start));
  const split = depth === 0 ? parts : scope.split(",");
  return split.map((g) => g.trim()).filter(Boolean);
}

const compiled = new Map<string, Bun.Glob>();
const globFor = (glob: string) => {
  let g = compiled.get(glob);
  if (!g) compiled.set(glob, (g = new Bun.Glob(glob)));
  return g;
};

/** Whether `path` is matched by any glob of `scope`. */
export function matchesGlob(scope: string, path: string): boolean {
  return globsOf(scope).some((glob) => globFor(glob).match(path));
}

/**
 * How narrow a glob is: the number of literal directories before its first wildcard, then the
 * length of that literal part. `apps/desktop/src/**` beats `apps/desktop/**`, which beats `**`.
 */
export function globSpecificity(scope: string): number {
  let best = 0;
  for (const glob of globsOf(scope)) {
    const segments = glob.split("/");
    const wild = segments.findIndex((s) => WILDCARD.test(s));
    const literal = wild === -1 ? segments : segments.slice(0, wild);
    best = Math.max(best, literal.length * 10_000 + Math.min(literal.join("/").length, 9_999));
  }
  return best;
}

/** Lines of a text, not counting the empty piece after a final newline. */
export const lineCount = (text: string) => (text === "" ? 0 : text.replace(/\n$/, "").split("\n").length);

const firstLines = (text: string, n: number) => text.split("\n").slice(0, n).join("\n");

/** A plain file name inside the folder: no directory part, so an index row cannot reach outside it. */
const isPlainName = (name: string) => /^[^/\\]+\.md$/.test(name) && !name.startsWith(".");

interface Side {
  files: LoadedMemoryFile[];
  texts: { name: string; text: string }[];
  leftOut: string[];
  used: number;
  indexLines: number;
  indexTruncated: boolean;
}

/** The label a file of the personal folder carries in a record: it is not a repository path. */
const PERSONAL_PREFIX = "personal:";

/**
 * One folder's share of a load: its `index.md`, then the area files the changed paths select, from
 * the most specific glob, while the lines already `used` plus these fit `budget`. Committed memory
 * goes first with nothing used; personal memory gets what is left.
 */
function loadSide(
  source: MemorySource,
  names: string[],
  indexText: string,
  budget: MemorySettings,
  used: number,
  changedPaths: string[],
  personal: boolean,
): Side {
  const label = (name: string) => (personal ? `${PERSONAL_PREFIX}${name}` : `${MEMORY_DIR}/${name}`);
  const mark = personal ? ({ personal: true } as const) : {};
  const files: LoadedMemoryFile[] = [];
  const texts: { name: string; text: string }[] = [];
  const leftOut: string[] = [];
  const indexLines = lineCount(indexText);
  const room = Math.max(budget.maxLoadedLines - used, 0);
  const indexTruncated = indexLines > room;
  if (personal && room === 0) {
    // Nothing is left for personal memory: the whole folder is left out.
    return { files, texts, leftOut: [label(INDEX_FILE)], used, indexLines, indexTruncated: false };
  }
  const indexLoaded = indexTruncated ? room : indexLines;
  files.push({ path: label(INDEX_FILE), lines: indexLoaded, ...(indexTruncated ? { truncated: true } : {}), ...mark });
  texts.push({ name: INDEX_FILE, text: indexTruncated ? firstLines(indexText, room) : indexText });
  used += indexLoaded;

  // The files the changed paths select, each with the sharpest glob that selected it.
  const selected = new Map<string, number>();
  for (const row of parseIndexMap(indexText)) {
    if (!isPlainName(row.file) || row.file === INDEX_FILE || row.file === ARCHIVE_FILE || !names.includes(row.file)) continue;
    if (!changedPaths.some((p) => matchesGlob(row.glob, p))) continue;
    selected.set(row.file, Math.max(selected.get(row.file) ?? 0, globSpecificity(row.glob)));
  }
  const ordered = [...selected].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);

  let full = false;
  for (const name of ordered) {
    if (full) {
      leftOut.push(label(name));
      continue;
    }
    const text = source.read(name);
    if (text === null) continue;
    const n = lineCount(text);
    if (used + n > budget.maxLoadedLines) {
      // Stop at the first file that does not fit: a less specific file never takes the place of a more specific one.
      full = true;
      leftOut.push(label(name));
      continue;
    }
    files.push({ path: label(name), lines: n, ...mark });
    texts.push({ name, text });
    used += n;
  }
  return { files, texts, leftOut, used, indexLines, indexTruncated };
}

/**
 * The memory a review of `changedPaths` loads from `source`, read at `revision`, or undefined when
 * the repository has no memory folder (the review is then exactly what it was before memory).
 * Settings problems are reported through `warn` and never stop a review.
 *
 * `personal` is the developer's own folder for this repository (a laptop review only). It is loaded
 * after the committed memory, inside the same budget, with its entries marked; an entry already
 * committed under the same id is not loaded twice. Without a committed folder it is loaded alone.
 */
export function loadMemory(
  source: MemorySource,
  revision: string,
  changedPaths: string[],
  warn: (line: string) => void,
  personal?: MemorySource,
): MemoryLoad | undefined {
  const names = source.list();
  const personalNames = personal?.list() ?? [];
  if (names.length === 0 && personalNames.length === 0) return undefined;

  let fileSettings: RepoSettings | undefined;
  try {
    fileSettings = source.settings();
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    warn(ignoredSettingsNote(error.message, `the base commit ${revision.slice(0, 7)}`));
  }
  const resolved = resolveMemorySettings(fileSettings);
  for (const notice of resolved.notices) warn(notice);
  const budget: MemorySettings = resolved.settings;
  const empty = (): MemoryLoad => ({
    revision,
    files: [],
    leftOut: [],
    overBudget: false,
    indexOverBudget: false,
    budget: { maxIndexLines: budget.maxIndexLines, maxLoadedLines: budget.maxLoadedLines, loadedLines: 0 },
    entries: [],
  });

  let committed: Side | undefined;
  if (names.length > 0) {
    const indexText = names.includes(INDEX_FILE) ? source.read(INDEX_FILE) : null;
    if (indexText === null) {
      // The source may have said why a listed index could not be read; this note says what it means.
      warn(
        names.includes(INDEX_FILE)
          ? `${MEMORY_DIR}/${INDEX_FILE} could not be read, so no memory is loaded.`
          : `${MEMORY_DIR} has no ${INDEX_FILE}, so no memory is loaded.`,
      );
    } else {
      committed = loadSide(source, names, indexText, budget, 0, changedPaths, false);
    }
  }

  let own: Side | undefined;
  if (personal && personalNames.length > 0) {
    const indexText = personalNames.includes(INDEX_FILE) ? personal.read(INDEX_FILE) : null;
    if (indexText === null) warn(`personal memory has no ${INDEX_FILE}, so it is not loaded.`);
    else own = loadSide(personal, personalNames, indexText, budget, committed?.used ?? 0, changedPaths, true);
  }
  if (!committed && !own) return empty();

  const sides = [committed, own].filter((x): x is Side => x !== undefined);
  const files = sides.flatMap((x) => x.files);
  const leftOut = sides.flatMap((x) => x.leftOut);
  const used = sides[sides.length - 1].used;
  const indexOverBudget = sides.some((x) => x.indexLines > budget.maxIndexLines);
  const overBudget = sides.some((x) => x.indexTruncated) || indexOverBudget || leftOut.length > 0;
  const entriesOf = (side: Side | undefined) => (side ? side.texts.flatMap(({ name, text }) => parseMemoryFile(name, text).entries) : []);
  const committedEntries = entriesOf(committed);
  const known = new Set(committedEntries.map((e) => e.id));
  const personalEntries = entriesOf(own)
    .filter((e) => !known.has(e.id))
    .map((e): MemoryEntry => ({ ...e, personal: true }));
  return {
    revision,
    files,
    leftOut,
    overBudget,
    indexOverBudget,
    budget: { maxIndexLines: budget.maxIndexLines, maxLoadedLines: budget.maxLoadedLines, loadedLines: used },
    entries: [...committedEntries, ...personalEntries],
    ...(personalEntries.length > 0 ? { personalEntries: personalEntries.map((e) => e.id) } : {}),
  };
}

/** How the summary paragraph about memory that did not fit starts; the review format finds the notices by it. */
export const MEMORY_OVER_BUDGET = "⚠️ **Memory over budget";

/** The sentence a review's summary carries when its memory did not fit, or undefined. */
export function memoryNotice(record: MemoryRecord): string | undefined {
  if (!record.overBudget) return undefined;
  const parts: string[] = [];
  const cut = record.files.filter((f) => f.truncated === true);
  const doesNotFit = record.leftOut.length > 0 || cut.length > 0;
  if (!doesNotFit) {
    return `${MEMORY_OVER_BUDGET}**: \`index.md\` is over its ${record.budget.maxIndexLines}-line budget. Trim it, or raise \`memory.max_index_lines\` in \`.wachiman.yml\`.`;
  }
  if (record.leftOut.length > 0) parts.push(`left out for lack of room: ${record.leftOut.map((p) => `\`${p}\``).join(", ")}`);
  for (const f of cut) parts.push(`\`${f.path}\` was cut to its first ${f.lines} lines`);
  if (record.indexOverBudget) parts.push(`\`index.md\` is over its ${record.budget.maxIndexLines}-line budget`);
  // Name whose memory it is: personal files carry the `personal:` prefix in the record.
  const personal = [...record.leftOut, ...cut.map((f) => f.path)].filter((p) => p.startsWith(PERSONAL_PREFIX)).length;
  const team = record.leftOut.length + cut.length - personal;
  const whose =
    personal > 0 && team > 0
      ? "the repository's memory and your personal memory"
      : personal > 0
        ? "your personal memory"
        : "the repository's memory";
  return `${MEMORY_OVER_BUDGET}**: ${whose} does not fit in ${record.budget.maxLoadedLines} lines for this review (${parts.join("; ")}). Trim it, or raise \`memory.max_loaded_lines\` in \`.wachiman.yml\`.`;
}
