/**
 * `wachiman memory <subcommand>`: the one entry that `src/cli.ts` calls. Layer 1 has one
 * subcommand, `check`, which reads `.wachiman/memory/` from the working tree and reports every
 * defect with its file and line: a malformed entry, an entry id that is not its digest, a glob that
 * matches no file, an index row that names a missing file, an area file the index does not list, and
 * a budget overrun. No model is called and nothing is written. Exit 0 when clean, 1 on problems.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../config";
import { spawnGit } from "../evidence";
import { commandHelp } from "../help";
import { parseRepoSettings, resolveMemorySettings, SETTINGS_PATH, type RepoSettings } from "../repo-settings";
import { parseIndexMap, parseMemoryFile, type MemoryProblem } from "./entries";
import { ARCHIVE_FILE, globsOf, INDEX_FILE, lineCount, matchesGlob, MEMORY_DIR } from "./load";

export const MEMORY_SUBCOMMANDS = ["check"] as const;

export interface MemoryIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

export interface CheckInput {
  /** The text of every file directly in `.wachiman/memory/`, by name. */
  files: Record<string, string>;
  /** Every file of the repository (tracked, and untracked but not ignored), as `/`-separated paths. */
  repoFiles: string[];
  settings: RepoSettings | undefined;
}

export interface CheckResult {
  problems: MemoryProblem[];
  notices: string[];
  entries: number;
}

/** Every problem of a memory folder, sorted by file and line. Pure: `runMemory` supplies the files. */
export function checkMemory(input: CheckInput): MemoryProblem[] {
  return inspectMemory(input).problems;
}

export function inspectMemory(input: CheckInput): CheckResult {
  const { files, repoFiles } = input;
  const resolved = resolveMemorySettings(input.settings);
  const budget = resolved.settings;
  const problems: MemoryProblem[] = [];
  const add = (file: string, line: number, message: string) => problems.push({ file, line, message });
  const names = Object.keys(files).sort();
  const matchesSome = (glob: string) => repoFiles.some((p) => matchesGlob(glob, p));
  let entryCount = 0;

  for (const name of names) {
    const parsed = parseMemoryFile(name, files[name]);
    problems.push(...parsed.problems);
    entryCount += parsed.entries.length;
    for (const entry of parsed.entries) {
      for (const glob of globsOf(entry.scope)) {
        if (!matchesSome(glob)) add(name, entry.line, `scope \`${glob}\` of entry matches no file in the repository`);
      }
    }
  }

  const indexText = files[INDEX_FILE];
  if (indexText === undefined) {
    if (names.length > 0) add(INDEX_FILE, 1, "is missing: without it no review loads any memory");
  } else {
    const rows = parseIndexMap(indexText);
    const listed = new Set<string>();
    for (const row of rows) {
      listed.add(row.file);
      if (!(row.file in files) || row.file === INDEX_FILE) add(INDEX_FILE, row.line, `maps to \`${row.file}\`, which is not in ${MEMORY_DIR}/`);
      for (const glob of globsOf(row.glob)) {
        if (!matchesSome(glob)) add(INDEX_FILE, row.line, `glob \`${glob}\` matches no file in the repository`);
      }
    }
    for (const name of names) {
      if (name !== INDEX_FILE && name !== ARCHIVE_FILE && !listed.has(name)) add(name, 1, "is not listed in index.md, so no review loads it");
    }
    const indexLines = lineCount(indexText);
    if (indexLines > budget.maxIndexLines) add(INDEX_FILE, budget.maxIndexLines + 1, `has ${indexLines} lines, over memory.max_index_lines (${budget.maxIndexLines})`);
    if (indexLines > budget.maxLoadedLines) {
      add(INDEX_FILE, budget.maxLoadedLines + 1, `has ${indexLines} lines, over memory.max_loaded_lines (${budget.maxLoadedLines}): a review loads only its first ${budget.maxLoadedLines}`);
    }
    for (const name of names) {
      if (name === INDEX_FILE || name === ARCHIVE_FILE) continue;
      const n = lineCount(files[name]);
      if (indexLines + n > budget.maxLoadedLines) {
        add(name, 1, `has ${n} lines; with index.md's ${indexLines} it exceeds memory.max_loaded_lines (${budget.maxLoadedLines}), so no review can load it`);
      }
    }
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { problems, notices: resolved.notices, entries: entryCount };
}

/** The checked-out tree is untrusted: every git call here has a time limit and the engine's hardened environment. */
const GIT_TIMEOUT_MS = 30_000;

/** The repository's top level for `dir`, or `dir` when git cannot say. */
function repositoryRoot(dir: string): string {
  const r = spawnGit(["rev-parse", "--show-toplevel"], { cwd: dir, timeoutMs: GIT_TIMEOUT_MS });
  const top = r.status === 0 ? r.stdout.trim() : "";
  return top === "" ? dir : top;
}

/** Tracked files plus untracked files that are not ignored; a plain directory walk when `root` is not a git repository. */
function listRepoFiles(root: string): string[] {
  const r = spawnGit(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, timeoutMs: GIT_TIMEOUT_MS, maxBytes: 256 * 1024 * 1024 });
  if (r.status === 0) return r.stdout.split("\0").filter(Boolean);
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  walk("");
  return out;
}

function readMemoryFolder(root: string): Record<string, string> | undefined {
  const dir = join(root, MEMORY_DIR);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return undefined;
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) files[entry.name] = readFileSync(join(dir, entry.name), "utf8");
  }
  return files;
}

/** `argv` is what follows `memory`. Returns the exit code: 0 clean, 1 problems found; usage errors throw `UsageError` (exit 2). */
export function runMemory(argv: string[], repoDir: string, io: MemoryIo): number {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h") return (io.stdout(commandHelp(["memory"])!), 0);
  if (first !== "check") throw new UsageError(`Unknown memory subcommand "${first}". Use one of: ${MEMORY_SUBCOMMANDS.join(", ")}.`);
  if (rest.includes("--help") || rest.includes("-h")) return (io.stdout(commandHelp(["memory", "check"])!), 0);
  if (rest.length > 0) throw new UsageError(`wachiman memory check takes no arguments, got "${rest[0]}".`);

  const root = repositoryRoot(repoDir);
  const files = readMemoryFolder(root);
  if (files === undefined) {
    io.stdout(`no ${MEMORY_DIR}/ folder in ${root}; nothing to check.\n`);
    return 0;
  }
  // The settings file as the author has it now; a review reads the base commit's copy.
  const settingsPath = join(root, SETTINGS_PATH);
  const settings = existsSync(settingsPath) ? parseRepoSettings(readFileSync(settingsPath, "utf8")) : undefined;
  const result = inspectMemory({ files, repoFiles: listRepoFiles(root), settings });
  for (const notice of result.notices) io.stderr(`note: ${notice}`);
  for (const p of result.problems) io.stderr(`${MEMORY_DIR}/${p.file}:${p.line}: ${p.message}`);
  if (result.problems.length > 0) {
    io.stdout(`memory check: ${result.problems.length} problem${result.problems.length === 1 ? "" : "s"} in ${MEMORY_DIR}/\n`);
    return 1;
  }
  io.stdout(`memory ok: ${Object.keys(files).length} file${Object.keys(files).length === 1 ? "" : "s"}, ${result.entries} entr${result.entries === 1 ? "y" : "ies"}\n`);
  return 0;
}
