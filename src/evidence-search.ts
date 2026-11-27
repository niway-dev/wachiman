/**
 * The ripgrep backend of the call-site evidence step.
 *
 * The `git grep` backend runs one search per symbol per batch: on a head of 32,000 files each takes
 * about 0.65 s, so a pull request of 156 batches spent 17 minutes searching, and `spawnSync` kept
 * the batches from overlapping. This backend plans the evidence of every batch first, takes the
 * union of the names, and runs ONE `rg` for all of them (a 475-name search took about 1 s). Each
 * batch then reads its matches from the result and applies the same per-batch rules as before
 * (`collectEvidence` in `evidence.ts`), so the `evidence.json` it writes is the same.
 *
 * What makes the two backends agree:
 *   - `rg` is told to search what `git grep -n -I -w -F` searches: hidden files, no ignore files,
 *     the same extensions and exclusions, `.git` skipped, and `-w` word
 *     boundaries that are ASCII (`--no-unicode`), because `git grep` runs with `LC_ALL=C`.
 *   - Binary files: `git grep -I` skips a file with a NUL in its first 8000 bytes and searches the
 *     whole of any other, while `rg` stops at the first NUL wherever it is, losing the matches after
 *     it. So `rg` runs with `--text`, and `binaryFiles` then decides for each file that has a match:
 *     the `diff` attribute first (one `git check-attr` for all files), and a NUL in the first 8000
 *     bytes (`looksBinary`, one 8 KB read per file) when the attribute does not say.
 *   - Matches are attributed to names by this module, not by `rg`: a line that holds several names
 *     counts for each of them. `rg` only says the line holds at least one.
 *   - Matches of a name are sorted by path, then line, the order of `git grep` (index order is the
 *     byte order of the path), which the ranking uses as its tie-break.
 *
 * Output format: `--null`. With it `rg` prints `path NUL line:text`, so a path can hold spaces,
 * colons or anything else except NUL and newline without an ambiguity a `path:line:` split would
 * have, and no per-match JSON has to be parsed (output can reach 150 MB). `--json` would also
 * hand over the submatch offsets, which cannot be used: `rg` reports non-overlapping matches, and
 * `foo` inside `foo.bar` would be lost.
 *
 * One quirk is kept on purpose: the git backend never keeps a matching line that holds a CR or
 * U+2028/9 (its row parser's `.` stops at them), so this backend drops those rows too. Fixing it
 * belongs to a change that touches both.
 *
 * Tracked files only: `rg` walks the whole directory (`--hidden --no-ignore`), which can hold files
 * `git grep` never reads (a nested checkout such as the CI job's `.ci-main/`, a submodule, an
 * untracked file), so its matches are kept only in files `git ls-files` lists. If that list cannot
 * be read the search counts as failed and the review uses `git grep`.
 *
 * Known difference from `git grep`: there is no 8 MB output
 * limit per name: `git grep` stops a name with a very common word (`get`) at about 8 MB of output
 * and the engine then says its list is partial, while this backend lists every match (the count and
 * that note then differ).
 *
 * The text of a matching line is kept whole, however long. The ranking and the definition guess
 * read it with regular expressions, and a minified bundle can hold the only call of a name 1.5 MB
 * into one line; cutting the text would change which sites are picked. Memory is bounded by the
 * output of the one search, and a normal row is about 100 characters.
 */
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXCLUDED_DIRS,
  EXCLUDED_FILES,
  SOURCE_EXTENSIONS,
  addedLinesOf,
  planEvidence,
  spawnGit,
  type GitRunner,
  type EvidenceFileInput,
  type Match,
  type SymbolSearch,
} from "./evidence";
import { rejectionReasons, type RipgrepFound, type RipgrepResolution } from "./ripgrep";

/** Wall clock of the one search a review makes (the git backend gives each batch 20 s for its own). */
export const SEARCH_WALL_CLOCK_MS = 60_000;

/** The arguments of the one `rg` call, patterns read from `patternFile` so the command line stays short. */
export const ripgrepArgs = (patternFile: string): string[] => [
  "--no-config", // never read the user's RIPGREP_CONFIG_PATH
  "--no-unicode", // ASCII word boundaries, as `git grep -w` under LC_ALL=C
  "--encoding",
  "none", // no BOM sniffing: a UTF-16 file stays bytes, and has NULs
  "--text", // rg's own binary rule (stop at the first NUL anywhere) is not git's; `looksBinary` applies git's
  "--hidden",
  "--no-ignore",
  "--null",
  "--line-number",
  "--no-heading",
  "--color",
  "never",
  "--word-regexp",
  "--fixed-strings",
  "--file",
  patternFile,
  // Later globs win: the extensions first, then the exclusions, the way the pathspecs read.
  ...SOURCE_EXTENSIONS.flatMap((e) => ["--glob", `*.${e}`]),
  ...[...EXCLUDED_DIRS, ".git"].flatMap((d) => ["--glob", `!${d}/`]),
  ...EXCLUDED_FILES.flatMap((f) => ["--glob", `!${f}`]),
  ".",
];

// ---------------------------------------------------------------------------------------------
// Parsing the stream
// ---------------------------------------------------------------------------------------------

const LINE_TERMINATOR = /[\r\u2028\u2029]/;

function parseWholeRow(row: string): Match | undefined {
  const nul = row.indexOf("\0");
  if (nul < 1) return undefined;
  const colon = row.indexOf(":", nul + 1);
  if (colon < 0) return undefined;
  const line = Number(row.slice(nul + 1, colon));
  if (!Number.isInteger(line) || line < 1) return undefined;
  const path = row.slice(0, nul);
  const text = row.slice(colon + 1);
  // `parseMatches` in `evidence.ts` reads git's rows with a regex whose `.` does not match a line
  // terminator, so a line with a CR (a CRLF file) or U+2028/9 is dropped on that backend. The same
  // rows are dropped here so both backends give one evidence.json.
  if (LINE_TERMINATOR.test(text) || LINE_TERMINATOR.test(path)) return undefined;
  return { file: path.startsWith("./") ? path.slice(2) : path, line, text };
}

/** One output row, `./path NUL line:text`, or `undefined` when it is not one (a stray message). */
export function parseRipgrepRow(row: string): Match | undefined {
  return parseWholeRow(row);
}

/** Feeds on chunks of any size and calls `onRow` once per complete line, so no stdout string is ever whole in memory. */
export class RowSplitter {
  private decoder = new TextDecoder("utf-8");
  private rest = "";
  constructor(private onRow: (row: string) => void) {}

  push(chunk: Uint8Array) {
    this.rest += this.decoder.decode(chunk, { stream: true });
    let from = 0;
    for (;;) {
      const end = this.rest.indexOf("\n", from);
      if (end < 0) break;
      this.onRow(this.rest.slice(from, end));
      from = end + 1;
    }
    this.rest = this.rest.slice(from);
  }

  finish() {
    this.rest += this.decoder.decode();
    if (this.rest !== "") this.onRow(this.rest);
    this.rest = "";
  }
}

// ---------------------------------------------------------------------------------------------
// Attribution: which of the searched names a line holds
// ---------------------------------------------------------------------------------------------

/** Word characters as `git grep -w` sees them under `LC_ALL=C`. Not `$`, not any non-ASCII letter. */
const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/** Whether `text` holds `name` with no word character right before or right after it. */
export function holdsWord(text: string, name: string): boolean {
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + name.length])) return true;
  }
  return false;
}

interface Candidate {
  name: string;
  /** Where the first run of word characters of the name starts inside it (1 for `$foo`). */
  offset: number;
}

/**
 * Finds the names of a line without trying every name on every line: the line is cut into runs of
 * word characters, and a run is looked up by the first run of each name, so a line costs its
 * length, not the number of names. A name with no word character at all (`$`) is checked directly.
 */
export class NameIndex {
  private byRun = new Map<string, Candidate[]>();
  private wordless: string[] = [];

  constructor(names: Iterable<string>) {
    for (const name of names) {
      const run = name.match(/[A-Za-z0-9_]+/);
      if (!run) {
        this.wordless.push(name);
        continue;
      }
      const list = this.byRun.get(run[0]) ?? [];
      list.push({ name, offset: run.index! });
      this.byRun.set(run[0], list);
    }
  }

  /** The names that occur in `text` as whole words (several can, and several occurrences count once). */
  namesIn(text: string): string[] {
    const found: string[] = [];
    const runs = /[A-Za-z0-9_]+/g;
    for (let m = runs.exec(text); m; m = runs.exec(text)) {
      const candidates = this.byRun.get(m[0]);
      if (!candidates) continue;
      for (const { name, offset } of candidates) {
        if (found.includes(name)) continue;
        const start = m.index - offset;
        if (start < 0 || !text.startsWith(name, start)) continue;
        if (isWordChar(text[start - 1]) || isWordChar(text[start + name.length])) continue;
        found.push(name);
      }
    }
    for (const name of this.wordless) if (!found.includes(name) && holdsWord(text, name)) found.push(name);
    return found;
  }
}

/**
 * Collects the rows into one list of matches per name, in `git grep` order. Files that are binary
 * for git are removed afterwards with `drop(binaryFiles(...))`, once all rows are in.
 */
export class MatchCollector {
  private lists = new Map<string, Match[]>();
  /** Lines kept, whatever names they hold. */
  lines = 0;
  private index: NameIndex;
  private perFile = new Map<string, number>();

  constructor(names: string[]) {
    this.index = new NameIndex(names);
    for (const name of names) this.lists.set(name, []);
  }

  add(row: string) {
    const whole = parseWholeRow(row);
    if (!whole) return;
    const names = this.index.namesIn(whole.text);
    if (names.length === 0) return;
    this.lines += 1;
    this.perFile.set(whole.file, (this.perFile.get(whole.file) ?? 0) + 1);
    // One object for the line, shared by every name that holds it.
    for (const name of names) this.lists.get(name)!.push(whole);
  }

  /** The files that have at least one kept line. */
  files(): string[] {
    return [...this.perFile.keys()];
  }

  /** Removes every line of `files`: the files `git grep -I` would have skipped as binary. */
  drop(files: Set<string>) {
    if (files.size === 0) return;
    for (const [name, list] of this.lists)
      this.lists.set(
        name,
        list.filter((m) => !files.has(m.file)),
      );
    for (const file of files) {
      this.lines -= this.perFile.get(file) ?? 0;
      this.perFile.delete(file);
    }
  }

  /** The matches of each name sorted by path (byte order, as the git index), then line. */
  result(): Map<string, Match[]> {
    for (const list of this.lists.values()) {
      list.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    }
    return this.lists;
  }
}

// ---------------------------------------------------------------------------------------------
// Running ripgrep
// ---------------------------------------------------------------------------------------------

export type RipgrepRun =
  | { ok: true; byName: Map<string, Match[]>; lines: number; ms: number }
  | { ok: false; timedOut: true; ms: number }
  | { ok: false; timedOut?: false; failed: string; ms: number };

/** How many leading bytes `git grep -I` looks at for a NUL: git's `FIRST_FEW_BYTES`. */
export const BINARY_PROBE_BYTES = 8000;

/** Whether `git grep -I` treats the file as binary: a NUL byte in its first 8000 bytes. An unreadable file counts as binary. */
export function looksBinary(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(BINARY_PROBE_BYTES);
    const read = readSync(fd, head, 0, BINARY_PROBE_BYTES, 0);
    return head.subarray(0, read).includes(0);
  } catch {
    return true;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The files among `files` that `git grep -I` would skip as binary. Git decides by the `diff`
 * attribute first: `unset` (`-diff`, `binary`) is binary, `set` (`diff`) is text, and anything
 * else, including a driver name (`diff=cpp`, which is binary only when `diff.<name>.binary` is
 * configured), falls back to a NUL in the first 8000 bytes. One `git check-attr` answers
 * for all files, in `repoDir` as `git grep` runs there; if it cannot run, the NUL heuristic
 * decides for every file.
 */
export function binaryFiles(
  repoDir: string,
  files: string[],
  git: GitRunner = spawnGit,
  log: (line: string) => void = () => {},
): Set<string> {
  const binary = new Set<string>();
  if (files.length === 0) return binary;
  const attr = new Map<string, string>();
  let why: string | undefined;
  try {
    const run = git(["check-attr", "-z", "--stdin", "diff"], {
      cwd: repoDir,
      input: files.join("\0") + "\0",
      timeoutMs: 20_000,
      maxBytes: 256 * 1024 * 1024,
    });
    if (run.timedOut) why = "timed out";
    else if (run.outputCut) why = "output cut";
    else if (run.error) why = run.error;
    else if (run.status !== 0) why = `exit status ${run.status}`;
    else {
      const parts = run.stdout.split("\0");
      for (let i = 0; i + 2 < parts.length; i += 3) attr.set(parts[i], parts[i + 2]);
    }
  } catch (error) {
    why = (error as Error).message;
  }
  if (why !== undefined) log(`evidence: git check-attr failed (${why}); binary files decided by the NUL rule`);
  for (const file of files) {
    const value = attr.get(file);
    if (value === "unset") binary.add(file);
    else if (value === "set") continue;
    else if (looksBinary(join(repoDir, file))) binary.add(file);
  }
  return binary;
}

/**
 * The files among `files` that `git ls-files` does not list in `repoDir`: the ones `git grep`
 * never searches. One `git ls-files -z` for the whole tree; a failure is returned, not guessed.
 */
export function untrackedFiles(repoDir: string, files: string[], git: GitRunner = spawnGit): { files: Set<string> } | { failed: string } {
  if (files.length === 0) return { files: new Set() };
  let why: string;
  try {
    const run = git(["ls-files", "-z"], { cwd: repoDir, timeoutMs: 20_000, maxBytes: 256 * 1024 * 1024 });
    if (!run.timedOut && !run.outputCut && !run.error && run.status === 0) {
      const tracked = new Set(run.stdout.split("\0"));
      return { files: new Set(files.filter((f) => !tracked.has(f))) };
    }
    why = run.timedOut ? "timed out" : run.outputCut ? "output cut" : (run.error ?? `exit status ${run.status}`);
  } catch (error) {
    why = (error as Error).message;
  }
  return { failed: `git ls-files failed (${why}), so ripgrep's matches cannot be limited to tracked files` };
}

/** The environment `rg` gets: no token, no proxy, no configuration file. */
const rgEnv = () => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LC_ALL: "C" });

/** One asynchronous `rg` for all `names` in `repoDir`. Never throws. */
export async function runRipgrep(
  binary: string,
  names: string[],
  repoDir: string,
  opts: { timeoutMs?: number; now?: () => number; log?: (line: string) => void; git?: GitRunner } = {},
): Promise<RipgrepRun> {
  const now = opts.now ?? Date.now;
  const started = now();
  let dir: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "wachiman-rg-patterns-"));
    const patternFile = join(dir, "patterns");
    writeFileSync(patternFile, names.join("\n") + "\n");
    const proc = Bun.spawn([binary, ...ripgrepArgs(patternFile)], {
      cwd: repoDir,
      env: rgEnv(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    timer = setTimeout(
      () => {
        timedOut = true;
        proc.kill();
      },
      Math.max(1, opts.timeoutMs ?? SEARCH_WALL_CLOCK_MS),
    );
    const collector = new MatchCollector(names);
    const splitter = new RowSplitter((row) => collector.add(row));
    const stderrText = new Response(proc.stderr).text();
    for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) splitter.push(chunk);
    splitter.finish();
    const code = await proc.exited;
    const stderr = (await stderrText).trim();
    if (timedOut) return { ok: false, timedOut: true, ms: now() - started };
    const ms = () => now() - started;
    // 0: matches, 1: none. 2 means an error, possibly after partial output: not trusted.
    if (code !== 0 && code !== 1)
      return {
        ok: false,
        failed: `ripgrep exited with status ${code}${stderr ? `: ${stderr.split("\n")[0].slice(0, 200)}` : ""}`,
        ms: ms(),
      };
    const untracked = untrackedFiles(repoDir, collector.files(), opts.git);
    if ("failed" in untracked) return { ok: false, failed: untracked.failed, ms: ms() };
    collector.drop(untracked.files);
    // The attribute check and the file reads are part of the search step: counted in `ms`.
    collector.drop(binaryFiles(repoDir, collector.files(), opts.git, opts.log));
    return { ok: true, byName: collector.result(), lines: collector.lines, ms: ms() };
  } catch (error) {
    return { ok: false, failed: `ripgrep could not run: ${(error as Error).message}`, ms: now() - started };
  } finally {
    if (timer) clearTimeout(timer);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// The search of one review
// ---------------------------------------------------------------------------------------------

/** What the evidence step of a whole review did, for the one summary line at its end. */
export interface EvidenceTally {
  backend: "ripgrep" | "git grep";
  searches: number;
  ms: number;
}

/**
 * Holds what ripgrep found for the names of a review. `ensure` searches the names it does not
 * know yet (the first call covers every batch; a retry batch can need a name the plan of the
 * whole did not, and gets one more search), `search` answers `collectEvidence` from memory.
 */
export class EvidenceSearcher {
  private found = new Map<string, Match[]>();
  private queue: Promise<void> = Promise.resolve();
  /** Set when ripgrep failed: from then on the engine uses `git grep`. */
  failure?: string;

  constructor(
    readonly binary: RipgrepFound,
    private repoDir: string,
    private log: (line: string) => void,
    readonly tally: EvidenceTally,
    private opts: { timeoutMs?: number; now?: () => number; git?: GitRunner } = {},
  ) {}

  get usable() {
    return this.failure === undefined;
  }

  /** Searches, once, every name of `names` not searched yet. Calls are served one at a time. */
  ensure(names: string[]): Promise<void> {
    const next = this.queue.then(() => this.searchMissing(names));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async searchMissing(names: string[]) {
    // Names already searched are served from memory even after a failure; only the others need a search.
    if (!this.usable) return;
    const missing = [...new Set(names)].filter((n) => !this.found.has(n));
    if (missing.length === 0) return;
    const run = await runRipgrep(this.binary.path, missing, this.repoDir, { ...this.opts, log: this.log });
    this.tally.searches += 1;
    this.tally.ms += run.ms;
    if (run.ok) {
      for (const [name, matches] of run.byName) this.found.set(name, matches);
      this.log(`evidence: ripgrep ${this.binary.version} searched ${missing.length} name(s) in ${run.ms} ms (${run.lines} matching lines)`);
    } else if (run.timedOut) {
      // Like a failed rg: each batch then searches with git grep, in its own smaller time box.
      this.failure = "ripgrep ran out of its time box";
      this.log(
        `evidence: ripgrep ran out of its ${(this.opts.timeoutMs ?? SEARCH_WALL_CLOCK_MS) / 1000} s time box after ${run.ms} ms; using git grep (slower)`,
      );
    } else {
      this.failure = run.failed;
      this.log(`evidence: ${run.failed}; using git grep (slower)`);
    }
  }

  /** The `SymbolSearch` that `collectEvidence` calls: from memory, never a process. */
  readonly search: SymbolSearch = (symbol) => {
    const matches = this.found.get(symbol);
    return matches ? { matches } : { failed: `${symbol} was not searched` };
  };

  /**
   * The search a batch uses once ripgrep may have failed: a name ripgrep already answered is served
   * from memory, and only a name it never searched goes to `fallback` (`git grep`). `onFallback`
   * is called once per such name.
   */
  withFallback(fallback: SymbolSearch, onFallback: () => void = () => {}): SymbolSearch {
    return (symbol, timeoutMs) => {
      if (this.found.has(symbol)) return this.search(symbol, timeoutMs);
      onFallback();
      return fallback(symbol, timeoutMs);
    };
  }
}

// ---------------------------------------------------------------------------------------------
// The evidence step of a whole review
// ---------------------------------------------------------------------------------------------

export interface EvidenceRun {
  /** Absent when the review uses `git grep` from the start. */
  searcher?: EvidenceSearcher;
  tally: EvidenceTally;
}

/** The warning when no ripgrep qualifies. It says what to do, and why a candidate was skipped when it existed. */
export function ripgrepMissingLine(tried: string[]): string {
  const reasons = rejectionReasons(tried);
  return `evidence: ripgrep not found, using git grep (slower); run \`wachiman setup\`${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}`;
}

/**
 * Starts the evidence step of a review: plans the evidence of every batch, and with ripgrep
 * searches the union of their names in one call before the first batch starts. With a fake `git`
 * (tests) or no ripgrep it starts nothing and each batch searches with `git grep` as before.
 * Never throws: evidence helps a review and is never a condition of it, so an error here only
 * sends the batches to `git grep`.
 */
export async function startEvidenceRun(args: Parameters<typeof startEvidenceRunUnguarded>[0]): Promise<EvidenceRun> {
  try {
    return await startEvidenceRunUnguarded(args);
  } catch (error) {
    args.log(`evidence: could not start the search (${(error as Error).message}); using git grep (slower)`);
    return { tally: { backend: "git grep", searches: 0, ms: 0 } };
  }
}

async function startEvidenceRunUnguarded(args: {
  repoDir: string;
  batches: { filename: string; patch?: string }[][];
  /** The runner a test injected: then ripgrep is not used, so the test's fake sees every search. */
  customGit: boolean;
  ripgrep: () => RipgrepResolution;
  log: (line: string) => void;
  timeoutMs?: number;
}): Promise<EvidenceRun> {
  const git: EvidenceRun = { tally: { backend: "git grep", searches: 0, ms: 0 } };
  if (args.customGit) return git;
  const names = new Set<string>();
  for (const batch of args.batches) {
    try {
      const inputs: EvidenceFileInput[] = batch.map((f) => ({ filename: f.filename, addedLines: addedLinesOf(f.patch) }));
      for (const symbol of planEvidence(inputs).symbols) names.add(symbol.name);
    } catch {
      // The batch plans again when it runs, and reports the failure there.
    }
  }
  // A review with nothing to search says nothing about the backend.
  if (names.size === 0) return git;
  const resolved = args.ripgrep();
  if (!resolved.found) {
    args.log(ripgrepMissingLine(resolved.tried));
    return git;
  }
  if (resolved.skipped) args.log(`evidence: ${resolved.skipped.join("; ")}; using ripgrep ${resolved.version} (${resolved.path}) instead`);
  const tally: EvidenceTally = { backend: "ripgrep", searches: 0, ms: 0 };
  const searcher = new EvidenceSearcher(resolved, args.repoDir, args.log, tally, { timeoutMs: args.timeoutMs });
  await searcher.ensure([...names]);
  return { searcher, tally };
}

/** The line printed once when the evidence steps of a review are done. */
export const evidenceSummaryLine = (t: EvidenceTally) => `evidence: backend ${t.backend}, ${t.searches} search(es), ${t.ms} ms in total`;
