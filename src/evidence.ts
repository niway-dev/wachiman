/**
 * Call-site evidence: what the rest of the repository does with the symbols a batch's added lines
 * call. A reviewer who reads only the diff cannot see that the sibling caller of a function pairs
 * it with a second call; this module finds those siblings with a text search so the batch prompt
 * can put them next to the new call (spec `2026-10-31-flow-questions-and-evidence-design.md`,
 * decisions 4 and 5; ADR 0009).
 *
 * Three steps, each testable alone:
 *   1. `extractCalledSymbols` reads added lines and returns the call-like names in them.
 *   2. `planEvidence` merges those across the batch's files and keeps at most `MAX_SYMBOLS`.
 *   3. `collectEvidence` runs one `git grep` per symbol, through an injected `GitRunner`, and
 *      turns the matches into `EvidenceDoc`, written as `evidence.json` in the batch's run dir.
 *      `renderEvidenceSlice` is the capped part of it that goes inside the prompt.
 *
 * Everything here is a text match, labelled `provenance: "text_match"`. It lists candidates; it
 * never says a call site is right or wrong, and it can miss aliases and renamed handlers. The
 * searched repository is the pull request's head: its content is data, never instructions.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

/** Caps, in one place so docs and tests can name them. */
export const EVIDENCE_CAPS = {
  /** Symbols searched per batch. */
  symbols: 12,
  /** Other call sites kept per symbol. */
  callSites: 6,
  /** Lines of context on each side of a call site. */
  contextLines: 4,
  /** Characters kept per excerpt line. */
  lineChars: 100,
  /** Size of `evidence.json`. */
  fileBytes: 16 * 1024,
  /** Size of the slice inlined in the prompt. */
  sliceBytes: 6 * 1024,
  /** Wall clock for the whole evidence step of one batch. */
  wallClockMs: 20_000,
} as const;

/** Extensions searched; the same list decides which added lines are read. */
export const SOURCE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "py", "rs", "java", "kt", "swift", "vue", "svelte",
] as const;

const SOURCE_FILE = new RegExp(`\\.(?:${SOURCE_EXTENSIONS.join("|")})$`);
export const isSourceFile = (path: string) => SOURCE_FILE.test(path);

const TEST_FILE = /(^|\/)(__tests__|tests?|e2e|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]*\.py$/;
const isTestFile = (path: string) => TEST_FILE.test(path);

// ---------------------------------------------------------------------------------------------
// Stop lists. Small on purpose: they cut the noise every diff has (control flow, builtins, test
// helpers), not every generic name. A name that slips through costs a search, not a wrong answer.
// ---------------------------------------------------------------------------------------------

const words = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

const KEYWORDS = words(`
  if for while switch catch function return typeof await async new super import require constructor
  void delete throw else do with yield of in instanceof from export default class extends this
  def fn func print len range str int float bool list dict set tuple isinstance super self
  match case loop impl struct trait enum where use mod pub let var const type interface
  println printf make panic append len cap
`);

/** Globals and library objects whose members are never worth a search. */
const BUILTIN_HEADS = words(`
  console Math JSON Object Array Promise Number String Boolean Date Symbol Reflect Intl RegExp
  Error TypeError RangeError Map Set WeakMap WeakSet Buffer URL URLSearchParams process globalThis
  Atomics Proxy BigInt Function structuredClone setTimeout clearTimeout setInterval clearInterval
  queueMicrotask parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent fetch
  expect describe it test beforeEach afterEach beforeAll afterAll vi jest mock spyOn
  render screen waitFor fireEvent userEvent within renderHook act cleanup
  useState useEffect useLayoutEffect useMemo useCallback useRef useContext useReducer useId
  useTransition useDeferredValue useImperativeHandle useSyncExternalStore useInsertionEffect
  createContext forwardRef memo lazy createElement createRoot cloneElement Fragment
  Some None Ok Err Box Vec String vec format assert assert_eq
`);

/** Member names that belong to builtin types and test libraries. */
const BUILTIN_METHODS = words(`
  map filter forEach reduce reduceRight find findIndex findLast some every push pop shift unshift
  slice splice join split concat sort reverse fill flat flatMap includes indexOf lastIndexOf
  keys values entries then catch finally replace replaceAll trim trimStart trimEnd toString
  toLowerCase toUpperCase startsWith endsWith padStart padEnd charAt charCodeAt substring match
  matchAll test exec call apply bind assign freeze from of isArray stringify parse now floor ceil
  round min max abs random log warn error info debug trace mockReturnValue mockResolvedValue
  mockRejectedValue mockImplementation mockImplementationOnce mockReturnValueOnce mockClear
  mockReset mockRestore fn spyOn resolves rejects not hasOwnProperty valueOf addEventListener
  removeEventListener preventDefault stopPropagation querySelector querySelectorAll getElementById
  getByRole getByText getByTestId getByLabelText queryByRole queryByText queryByTestId findByRole
  findByText closest appendChild removeChild setAttribute getAttribute
`);

/** Generic verbs: skipped on a short chain (`store.get(`), allowed on a long one. */
const GENERIC_METHODS = words(`
  get set has add delete clear close open start stop run reset remove update load save read write
  next done emit send on once off invoke handle dispatch init create destroy
`);

/** Call names whose first string argument can be an event or IPC channel. */
const CHANNEL_CALLEES = words(`
  invoke handle handleOnce send sendSync sendTo on once off emit addListener removeListener
  removeAllListeners postMessage publish subscribe listen dispatchEvent
`);

// ---------------------------------------------------------------------------------------------
// Step 1: symbols
// ---------------------------------------------------------------------------------------------

export interface CalledSymbol {
  name: string;
  /** `call` is an identifier followed by `(`; `channel` is a string literal that names an event. */
  kind: "call" | "channel";
  /** A member call (`window.electronAPI.startFileDrag(`): a connection to code from elsewhere. */
  qualified: boolean;
  /** The first chain it was seen as, for display: `window.electronAPI.startFileDrag`. */
  qualifier?: string;
  /** Occurrences in the lines given. */
  count: number;
}

const IDENT = "[A-Za-z_$][\\w$]*";
/** `a.b.c(`, `a?.b(`, `a!.b(`, `a::b(` and a leading-dot `.b(`; generics between name and paren allowed. */
const CALL_RE = new RegExp(
  `(?<![\\w$])(\\.?${IDENT}(?:!?(?:\\?\\.|\\.|::)${IDENT})*)(?:<[^<>()]*>)?\\(`,
  "g",
);
const CHANNEL_SHAPE = "[A-Za-z][\\w]*(?:[-:.][\\w]+)+";
/** `ipcRenderer.invoke("recording-ready:show"` and `const SHOW_CHANNEL = "recording-ready:show"`. */
const CHANNEL_ARG_RE = new RegExp(`(${IDENT})\\s*\\(\\s*(["'])(${CHANNEL_SHAPE})\\2`, "g");
const CHANNEL_CONST_RE = new RegExp(`\\b\\w*(?:channel|event)\\w*\\s*[:=]\\s*(["'])(${CHANNEL_SHAPE})\\1`, "gi");
const STRING_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

const isCommentLine = (line: string) => /^\s*(?:\/\/|\/\*|\*|#)/.test(line);

/** Names the given added lines define: functions, classes, variables, methods and parameters. */
export function definedSymbols(addedLines: string[]): Set<string> {
  const defined = new Set<string>();
  const add = (name: string | undefined) => {
    if (name) defined.add(name);
  };
  for (const raw of addedLines) {
    if (isCommentLine(raw)) continue;
    const line = raw.replace(STRING_RE, '""');
    for (const m of line.matchAll(new RegExp(`\\b(?:function\\*?|class|interface|type|enum|def|fn|func|struct|trait)\\s+(${IDENT})`, "g")))
      add(m[1]);
    for (const m of line.matchAll(new RegExp(`\\b(?:const|let|var|val)\\s+(${IDENT})`, "g"))) add(m[1]);
    for (const m of line.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) {
        const name = part.split(":").pop()?.split("=")[0].trim();
        if (name && new RegExp(`^${IDENT}$`).test(name)) add(name);
      }
    }
    // A method or a property function: `startDrag(path) {`, `startDrag: (path) =>`, `async load() {`.
    const method = line.match(
      new RegExp(
        `^\\s*(?:(?:public|private|protected|static|async|override|readonly|get|set|export|default)\\s+)*\\*?\\s*(${IDENT})\\s*(?:<[^>()]*>)?\\([^)]*\\)\\s*(?::\\s*[^={;]+)?\\{\\s*$`,
      ),
    );
    if (method && !KEYWORDS.has(method[1])) add(method[1]);
    const prop = line.match(new RegExp(`^\\s*(${IDENT})\\s*:\\s*(?:async\\s*)?(?:\\(|function\\b|${IDENT}\\s*=>)`));
    if (prop) add(prop[1]);
    // Parameters of a function or arrow on this line: calling one is calling a local.
    for (const m of line.matchAll(/\(([^()]*)\)\s*(?::\s*[^=>{]+)?\s*(?:=>|\{)/g)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().replace(/^\.\.\./, "").match(new RegExp(`^(${IDENT})`))?.[1];
        add(name);
      }
    }
  }
  return defined;
}

/**
 * The call-like names in `addedLines`, minus keywords, builtins and names those lines define.
 * Order of first appearance; counts are per name.
 */
export function extractCalledSymbols(addedLines: string[]): CalledSymbol[] {
  const defined = definedSymbols(addedLines);
  const found = new Map<string, CalledSymbol>();
  const note = (symbol: Omit<CalledSymbol, "count">) => {
    const key = `${symbol.kind}:${symbol.name}`;
    const known = found.get(key);
    if (!known) {
      found.set(key, { ...symbol, count: 1 });
      return;
    }
    known.count++;
    if (symbol.qualified && !known.qualified) {
      known.qualified = true;
      known.qualifier = symbol.qualifier;
    }
  };

  for (const raw of addedLines) {
    if (isCommentLine(raw)) continue;

    for (const m of raw.matchAll(CHANNEL_ARG_RE)) {
      if (CHANNEL_CALLEES.has(m[1])) note({ name: m[3], kind: "channel", qualified: true });
    }
    for (const m of raw.matchAll(CHANNEL_CONST_RE)) note({ name: m[2], kind: "channel", qualified: true });

    const line = raw.replace(STRING_RE, '""').replace(/\/\/.*$/, "");
    for (const m of line.matchAll(CALL_RE)) {
      const chain = m[1];
      const parts = chain.replace(/^\./, "").split(/!?(?:\?\.|\.|::)/);
      const name = parts[parts.length - 1];
      const head = parts[0];
      const memberOnly = chain.startsWith(".");
      const receiver = parts.length > 1 ? head : undefined;
      const dots = parts.length - 1 + (memberOnly ? 1 : 0);
      if (name.length < 3 || name.length > 64) continue;
      if (KEYWORDS.has(name)) continue;
      if (defined.has(name)) continue;
      if (BUILTIN_HEADS.has(name) && dots === 0) continue;
      if (receiver && BUILTIN_HEADS.has(receiver)) continue;
      if (dots > 0 && BUILTIN_METHODS.has(name)) continue;
      if (dots > 0 && /^to[A-Z]/.test(name)) continue; // test matchers: toBe, toHaveBeenCalledWith
      if (dots > 0 && dots <= 1 && GENERIC_METHODS.has(name)) continue;
      if (dots > 0 && CHANNEL_CALLEES.has(name)) continue; // the channel string is the symbol
      const own = receiver === "this" || receiver === "self" || receiver === "Self" || receiver === "super";
      const qualified = dots > 0 && !own;
      note({ name, kind: "call", qualified, qualifier: qualified ? chain : undefined });
    }
  }
  return [...found.values()];
}

/** The added lines of a unified-diff patch, without their leading `+`. */
export function addedLinesOf(patch: string | undefined): string[] {
  if (!patch) return [];
  const out: string[] = [];
  for (const row of patch.split("\n")) if (row.startsWith("+")) out.push(row.slice(1));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Step 2: the plan
// ---------------------------------------------------------------------------------------------

export interface EvidenceFileInput {
  filename: string;
  addedLines: string[];
}

export interface PlannedSymbol {
  name: string;
  kind: "call" | "channel";
  qualified: boolean;
  qualifier?: string;
  /** The batch's files whose added lines use it. */
  files: string[];
  occurrences: number;
}

export interface EvidencePlan {
  symbols: PlannedSymbol[];
  /** Candidates beyond the cap, in rank order. */
  omitted: string[];
}

/**
 * Merges the symbols of every file of a batch and ranks them: member calls and channel strings
 * first (a connection to code from elsewhere), then by how many of the batch's files use the name,
 * then by files that are not tests, then by occurrences, then by name. A name defined by any
 * added line of the batch is dropped.
 */
export function planEvidence(
  files: EvidenceFileInput[],
  opts: { maxSymbols?: number } = {},
): EvidencePlan {
  const max = opts.maxSymbols ?? EVIDENCE_CAPS.symbols;
  const sources = files.filter((f) => isSourceFile(f.filename));
  const defined = definedSymbols(sources.flatMap((f) => f.addedLines));
  const merged = new Map<string, PlannedSymbol>();
  for (const file of sources) {
    for (const s of extractCalledSymbols(file.addedLines)) {
      if (s.kind === "call" && defined.has(s.name)) continue;
      const key = `${s.kind}:${s.name}`;
      const known = merged.get(key);
      if (!known) {
        merged.set(key, {
          name: s.name,
          kind: s.kind,
          qualified: s.qualified,
          qualifier: s.qualifier,
          files: [file.filename],
          occurrences: s.count,
        });
        continue;
      }
      known.files.push(file.filename);
      known.occurrences += s.count;
      if (s.qualified && !known.qualified) {
        known.qualified = true;
        known.qualifier = s.qualifier;
      }
    }
  }
  const prodFiles = (s: PlannedSymbol) => s.files.filter((f) => !isTestFile(f)).length;
  const ranked = [...merged.values()].sort(
    (a, b) =>
      Number(b.qualified) - Number(a.qualified) ||
      b.files.length - a.files.length ||
      prodFiles(b) - prodFiles(a) ||
      b.occurrences - a.occurrences ||
      a.name.localeCompare(b.name),
  );
  return { symbols: ranked.slice(0, max), omitted: ranked.slice(max).map((s) => s.name) };
}

// ---------------------------------------------------------------------------------------------
// Step 3: the search
// ---------------------------------------------------------------------------------------------

export interface GitResult {
  /** Exit code; `null` when the process did not exit normally. */
  status: number | null;
  stdout: string;
  /** Why it did not run to the end (spawn failure, timeout, output too large). */
  error?: string;
  timedOut?: boolean;
  /** `stdout` was cut at the buffer limit. */
  outputCut?: boolean;
}

export type GitRunner = (args: string[], opts: { cwd: string; timeoutMs: number }) => GitResult;

const GIT_OUTPUT_LIMIT = 8 * 1024 * 1024;

/** Runs `git` with a minimal environment: the checked-out head is untrusted, the engine's token is not its business. */
export const spawnGit: GitRunner = (args, { cwd, timeoutMs }) => {
  const run = spawnSync("git", ["-c", "core.quotepath=off", "-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "utf8",
    timeout: Math.max(1, Math.floor(timeoutMs)),
    maxBuffer: GIT_OUTPUT_LIMIT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    error: run.error ? run.error.message : undefined,
    timedOut: code === "ETIMEDOUT",
    outputCut: code === "ENOBUFS",
  };
};

export interface CallSite {
  file: string;
  line: number;
  /** The matching line, trimmed. */
  text: string;
  /** `<line>| <text>` for each line of context, shared indentation removed, each cut to the cap. */
  excerpt: string[];
}

export interface EvidenceEntry {
  symbol: string;
  kind: "call" | "channel";
  /** How it was written in the batch's added lines, when it was a member call. */
  qualifier?: string;
  /** The batch's files whose added lines use it. */
  used_in: string[];
  provenance: "text_match";
  status: "complete" | "truncated";
  /** Matching lines in other files, before the cap on call sites. */
  total_matches: number;
  /** A line that looks like where the symbol is defined; a guess from text, not a resolution. */
  definition_guess?: { file: string; line: number; text: string };
  call_sites: CallSite[];
}

export interface EvidenceDoc {
  version: 1;
  provenance: "text_match";
  status: "complete" | "truncated";
  caps: {
    symbols: number;
    call_sites_per_symbol: number;
    context_lines: number;
    file_bytes: number;
    wall_clock_ms: number;
  };
  /** The batch's own files, never listed as call sites. */
  batch_files: string[];
  symbols: EvidenceEntry[];
  /** Searched and found nowhere else: probably a library or a builtin the stop lists do not know. */
  no_other_matches: string[];
  /** Candidates not searched: over the symbol cap, over the time box, or dropped to fit the file cap. */
  not_searched: string[];
  /** Why `status` is `truncated`, or what went wrong, in words. */
  notes: string[];
}

export interface EvidenceIo {
  git: GitRunner;
  /** The file's lines at the head, or `null` when it cannot be read as a regular file inside the head. */
  readLines: (repoDir: string, path: string) => string[] | null;
  now: () => number;
}

/** Reads a regular file inside `repoDir`; refuses symlinks that leave it and files over 1 MB. */
export function readHeadLines(repoDir: string, path: string): string[] | null {
  try {
    const full = join(repoDir, path);
    const info = lstatSync(full);
    if (!info.isFile() || info.size > 1024 * 1024) return null;
    const root = realpathSync(repoDir);
    if (!realpathSync(full).startsWith(root + sep)) return null;
    return readFileSync(full, "utf8").split("\n");
  } catch {
    return null;
  }
}

export const defaultEvidenceIo: EvidenceIo = { git: spawnGit, readLines: readHeadLines, now: Date.now };

const EXCLUDED_PATHS = [
  "node_modules/*", "*/node_modules/*", "dist/*", "*/dist/*", "build/*", "*/build/*",
  ".next/*", "*/.next/*", "vendor/*", "*/vendor/*", "*.min.js", "*.d.ts",
];

const grepArgs = (symbol: string) => [
  "grep", "-n", "-I", "-w", "-F", "--no-color", "-e", symbol, "--",
  ...SOURCE_EXTENSIONS.map((e) => `*.${e}`),
  ...EXCLUDED_PATHS.map((p) => `:(exclude)${p}`),
];

interface Match {
  file: string;
  line: number;
  text: string;
}

function parseMatches(stdout: string): Match[] {
  const out: Match[] = [];
  for (const row of stdout.split("\n")) {
    const m = row.match(/^(.+?):(\d+):(.*)$/);
    if (m) out.push({ file: m[1], line: Number(m[2]), text: m[3] });
  }
  return out;
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Best effort: lines that read like the definition of `symbol`. */
function definitionPattern(symbol: string) {
  const s = escapeRe(symbol);
  return new RegExp(
    [
      `\\b(?:function\\*?|class|interface|type|enum|def|fn|func|struct|trait)\\s+${s}\\b`,
      `\\b(?:const|let|var|val)\\s+${s}\\b\\s*[=:]`,
      `^\\s*${s}\\s*:\\s*(?:async\\s*)?(?:\\(|function\\b|${IDENT}\\s*=>)`,
      `^\\s*(?:(?:public|private|protected|static|async|override|readonly|export)\\s+)*\\*?\\s*${s}\\s*(?:<[^>()]*>)?\\([^)]*\\)\\s*(?::\\s*[^={;]+)?\\{\\s*$`,
    ].join("|"),
  );
}

const IMPORT_LINE = /^\s*(?:import\b|export\s*(?:\*|\{[^}]*\})\s*from\b|from\s+\S+\s+import\b|use\s+\S+;)/;

const clip = (text: string) => text.trimEnd().slice(0, EVIDENCE_CAPS.lineChars);

function excerptOf(lines: string[], line: number): string[] {
  const from = Math.max(1, line - EVIDENCE_CAPS.contextLines);
  const to = Math.min(lines.length, line + EVIDENCE_CAPS.contextLines);
  const block = lines.slice(from - 1, to);
  const indent = Math.min(
    ...block.filter((l) => l.trim() !== "").map((l) => l.match(/^\s*/)![0].length),
    Infinity,
  );
  const cut = Number.isFinite(indent) ? indent : 0;
  return block.map((l, i) => `${from + i}| ${clip(l.slice(cut))}`);
}

/**
 * Runs the plan: one `git grep -nwF` per symbol in `repoDir`, then builds the document. It never
 * throws: a failing search is a note, a search past the time box is `not_searched`. Returns the
 * notes also as `warnings` for the engine to print.
 */
export function collectEvidence(
  plan: EvidencePlan,
  ctx: { repoDir: string; batchFiles: string[] },
  io: EvidenceIo = defaultEvidenceIo,
  caps: { wallClockMs?: number; callSites?: number } = {},
): { doc: EvidenceDoc; warnings: string[] } {
  const wallClockMs = caps.wallClockMs ?? EVIDENCE_CAPS.wallClockMs;
  const maxSites = caps.callSites ?? EVIDENCE_CAPS.callSites;
  const started = io.now();
  const deadline = started + wallClockMs;
  const own = new Set(ctx.batchFiles);
  const notes: string[] = [];
  const warnings: string[] = [];
  const entries: EvidenceEntry[] = [];
  const noOther: string[] = [];
  const notSearched = [...plan.omitted];
  if (plan.omitted.length > 0)
    notes.push(`${plan.omitted.length} more candidate symbol(s) beyond the cap of ${EVIDENCE_CAPS.symbols}.`);
  const lineCache = new Map<string, string[] | null>();
  const linesOf = (path: string) => {
    if (!lineCache.has(path)) lineCache.set(path, io.readLines(ctx.repoDir, path));
    return lineCache.get(path)!;
  };

  let stopped = false;
  for (const planned of plan.symbols) {
    if (stopped || io.now() >= deadline) {
      if (!stopped) notes.push(`The ${wallClockMs / 1000} s time box ran out; the remaining symbols were not searched.`);
      stopped = true;
      notSearched.push(planned.name);
      continue;
    }
    const run = io.git(grepArgs(planned.name), { cwd: ctx.repoDir, timeoutMs: Math.max(1, deadline - io.now()) });
    if (run.timedOut) {
      notes.push(`Searching for ${planned.name} timed out; the remaining symbols were not searched.`);
      stopped = true;
      notSearched.push(planned.name);
      continue;
    }
    if (run.status !== 0 && run.status !== 1 && !run.outputCut) {
      const why = run.error ?? `git grep exited with status ${run.status}`;
      warnings.push(`Call-site evidence skipped: ${why}`);
      notes.push(`Search failed (${why}); the remaining symbols were not searched.`);
      stopped = true;
      notSearched.push(planned.name);
      continue;
    }
    const all = parseMatches(run.stdout);
    const defPattern = definitionPattern(planned.name);
    const defMatch = planned.kind === "call" ? all.find((m) => defPattern.test(m.text)) : undefined;
    const others = all.filter(
      (m) =>
        !own.has(m.file) &&
        m !== defMatch &&
        !IMPORT_LINE.test(m.text) &&
        !isCommentLine(m.text),
    );
    if (others.length === 0 && !defMatch) {
      noOther.push(planned.name);
      continue;
    }
    const callRe = new RegExp(`${escapeRe(planned.name)}\\s*\\(`);
    // Production callers before test callers, calls before mere references, then path order.
    const rank = (m: Match) => Number(isTestFile(m.file)) * 2 + Number(!callRe.test(m.text));
    const picked = others
      .map((m, i) => ({ m, i }))
      .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
      .slice(0, maxSites)
      .map((x) => x.m);
    const sites: CallSite[] = picked.map((m) => {
      const lines = linesOf(m.file);
      return {
        file: m.file,
        line: m.line,
        text: clip(m.text.trim()),
        excerpt: lines ? excerptOf(lines, m.line) : [`${m.line}| ${clip(m.text)}`],
      };
    });
    const cutByCap = others.length > sites.length || run.outputCut === true;
    entries.push({
      symbol: planned.name,
      kind: planned.kind,
      ...(planned.qualified && planned.qualifier ? { qualifier: planned.qualifier } : {}),
      used_in: planned.files,
      provenance: "text_match",
      status: cutByCap ? "truncated" : "complete",
      total_matches: others.length,
      ...(defMatch ? { definition_guess: { file: defMatch.file, line: defMatch.line, text: clip(defMatch.text.trim()) } } : {}),
      call_sites: sites,
    });
    if (run.outputCut) notes.push(`The search for ${planned.name} produced more output than the buffer; its list is partial.`);
  }

  const truncated = notes.length > 0 || entries.some((e) => e.status === "truncated") || notSearched.length > 0;
  const doc: EvidenceDoc = {
    version: 1,
    provenance: "text_match",
    status: truncated ? "truncated" : "complete",
    caps: {
      symbols: EVIDENCE_CAPS.symbols,
      call_sites_per_symbol: maxSites,
      context_lines: EVIDENCE_CAPS.contextLines,
      file_bytes: EVIDENCE_CAPS.fileBytes,
      wall_clock_ms: wallClockMs,
    },
    batch_files: ctx.batchFiles,
    symbols: entries,
    no_other_matches: noOther,
    not_searched: notSearched,
    notes,
  };
  return { doc, warnings };
}

/** The document the engine writes when the evidence step could not run at all. */
export function emptyEvidence(batchFiles: string[], reason: string): EvidenceDoc {
  return {
    version: 1,
    provenance: "text_match",
    status: "truncated",
    caps: {
      symbols: EVIDENCE_CAPS.symbols,
      call_sites_per_symbol: EVIDENCE_CAPS.callSites,
      context_lines: EVIDENCE_CAPS.contextLines,
      file_bytes: EVIDENCE_CAPS.fileBytes,
      wall_clock_ms: EVIDENCE_CAPS.wallClockMs,
    },
    batch_files: batchFiles,
    symbols: [],
    no_other_matches: [],
    not_searched: [],
    notes: [reason],
  };
}

// ---------------------------------------------------------------------------------------------
// Output: the file and the prompt slice
// ---------------------------------------------------------------------------------------------

export const serializeEvidence = (doc: EvidenceDoc) => JSON.stringify(doc, null, 1);
const bytesOf = (text: string) => Buffer.byteLength(text, "utf8");

/**
 * Makes the document fit `maxBytes`, losing the least useful detail first: excerpts of call sites
 * after the second, then after the first, then the call sites after the third, then the
 * lowest-ranked symbols. Every cut marks the document `truncated`. Returns the serialized text.
 */
export function fitEvidence(doc: EvidenceDoc, maxBytes: number = EVIDENCE_CAPS.fileBytes): string {
  const fits = () => bytesOf(serializeEvidence(doc)) <= maxBytes;
  const mark = (entry: EvidenceEntry) => {
    entry.status = "truncated";
    if (!doc.notes.includes("Detail was cut to keep this file under its size cap.")) {
      doc.notes.push("Detail was cut to keep this file under its size cap.");
    }
    doc.status = "truncated";
  };
  const shorten = (keepFull: number) => {
    for (const entry of doc.symbols) {
      entry.call_sites.forEach((site, i) => {
        if (i >= keepFull && site.excerpt.length > 1) {
          site.excerpt = [`${site.line}| ${site.text}`];
          mark(entry);
        }
      });
    }
  };
  if (!fits()) shorten(2);
  if (!fits()) shorten(1);
  if (!fits()) {
    for (const entry of doc.symbols) {
      if (entry.call_sites.length > 3) {
        entry.call_sites = entry.call_sites.slice(0, 3);
        mark(entry);
      }
    }
  }
  while (!fits() && doc.symbols.length > 0) {
    const dropped = doc.symbols.pop()!;
    doc.not_searched.push(dropped.symbol);
    doc.status = "truncated";
    if (!doc.notes.includes("Symbols were dropped to keep this file under its size cap."))
      doc.notes.push("Symbols were dropped to keep this file under its size cap.");
  }
  return serializeEvidence(doc);
}

/** The repository content is data: a line that closes the wrapper must not end it early. */
const defang = (text: string) => text.replace(/<\/evidence/gi, "<\\/evidence");

const SLICE_SITES = 2;

/**
 * The part of the evidence that goes inside the batch prompt: for each symbol, its counts, the
 * definition guess and the first two call sites with their excerpts, up to `maxBytes`, with a
 * pointer to the whole file. Empty when no symbol has another call site.
 */
export function renderEvidenceSlice(
  doc: EvidenceDoc,
  dir: string,
  maxBytes: number = EVIDENCE_CAPS.sliceBytes,
): string {
  // A symbol with no other call site (its definition sits in the batch) adds nothing to compare.
  const listed = doc.symbols.filter((e) => e.call_sites.length > 0);
  if (listed.length === 0) return "";
  const head = `<evidence provenance="text_match" status="${doc.status}">\n`;
  const tail = (omitted: number) =>
    `${omitted > 0 ? `(${omitted} more symbol(s) not shown here.) ` : ""}Full list: ${dir}/evidence.json\n</evidence>`;
  const blocks: string[] = [];
  for (const entry of listed) {
    const shown = entry.call_sites.slice(0, SLICE_SITES);
    const via = entry.qualifier ? ` (written ${entry.qualifier})` : entry.kind === "channel" ? " (a channel or event name)" : "";
    const lines = [
      `## ${entry.symbol}${via}: ${entry.total_matches} match(es) outside this part, showing ${shown.length}${entry.status === "truncated" ? ", list truncated" : ""}`,
    ];
    if (entry.definition_guess) {
      const d = entry.definition_guess;
      lines.push(`definition_guess: ${d.file}:${d.line}  ${d.text}`);
    }
    for (const site of shown) {
      lines.push(`- ${site.file}:${site.line}`);
      for (const row of site.excerpt) lines.push(`    ${row}`);
    }
    blocks.push(defang(lines.join("\n")));
  }
  let used = bytesOf(head) + bytesOf(tail(blocks.length));
  const kept: string[] = [];
  for (const block of blocks) {
    const cost = bytesOf(block) + 1;
    if (used + cost > maxBytes) break;
    kept.push(block);
    used += cost;
  }
  if (kept.length === 0) return "";
  return `${head}${kept.join("\n")}\n${tail(blocks.length - kept.length)}`;
}

/** One line for the run log: symbols found, call sites kept, bytes of the file, milliseconds. */
export function evidenceLogLine(plan: EvidencePlan, doc: EvidenceDoc, bytes: number, ms: number) {
  const sites = doc.symbols.reduce((n, e) => n + e.call_sites.length, 0);
  return `evidence: ${plan.symbols.length + plan.omitted.length} symbol(s) found, ${sites} call site(s), ${bytes} bytes, ${ms} ms, ${doc.status}`;
}
