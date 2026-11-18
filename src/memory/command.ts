/**
 * `wachiman memory <subcommand>`: the one entry that `src/cli.ts` calls. `check` (layer 1) reads
 * `.wachiman/memory/` from the working tree and reports every defect with its file and line: a malformed entry, an entry id that is not its digest, a glob that
 * matches no file, an index row that names a missing file, an area file the index does not list, and
 * a budget overrun. No model is called and nothing is written. Exit 0 when clean, 1 on problems.
 * After the problems, `check` prints hygiene suggestions (likely duplicates, entries not used in
 * `memory.archive_after_days`); they never change the exit code. `archive <id>` (layer 6) moves one
 * entry to `archive.md` in the working tree, only when the developer runs it.
 * `candidates`, `add`, `show` and `propose` (layer 3, laptop capture) are in `capture.ts`.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wachimanHome } from "../accounts/config";
import { UsageError } from "../config";
import { spawnGit } from "../evidence";
import { commandHelp } from "../help";
import { repositoryKey } from "../history/store";
import { parseRepoSettings, resolveMemorySettings, SETTINGS_PATH } from "../repo-settings";
import { parseMemoryFile, type MemoryEntry, type MemoryProblem } from "./entries";
import { inspectMemory, type CheckInput, type CheckResult } from "./inspect";
import { CAPTURE_SUBCOMMANDS, runCapture, type CaptureContext } from "./capture";
import { repositoryRoot } from "./settings";
import { archiveEntry, archiveSuggestions, findDuplicates, readMemoryUse } from "./hygiene";
import { ARCHIVE_FILE, MEMORY_DIR } from "./load";

export { inspectMemory, type CheckInput, type CheckResult };

export const MEMORY_SUBCOMMANDS = ["check", "archive", ...CAPTURE_SUBCOMMANDS] as const;

export interface MemoryIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

/** Every problem of a memory folder, sorted by file and line. Pure: `runMemory` supplies the files. */
export function checkMemory(input: CheckInput): MemoryProblem[] {
  return inspectMemory(input).problems;
}

/** The checked-out tree is untrusted: every git call here has a time limit and the engine's hardened environment. */
const GIT_TIMEOUT_MS = 30_000;

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
export function runMemory(argv: string[], repoDir: string, io: MemoryIo, ctx: CaptureContext = {}): number {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h") return (io.stdout(commandHelp(["memory"])!), 0);
  if (!(MEMORY_SUBCOMMANDS as readonly string[]).includes(first)) throw new UsageError(`Unknown memory subcommand "${first}". Use one of: ${MEMORY_SUBCOMMANDS.join(", ")}.`);
  if (first === "archive") {
    if (rest.includes("--help") || rest.includes("-h")) return (io.stdout(commandHelp(["memory", "archive"])!), 0);
    return runArchive(rest, repoDir, io);
  }
  if (first !== "check") {
    if (rest.includes("--help") || rest.includes("-h")) return (io.stdout(commandHelp(["memory", first])!), 0);
    return runCapture(first as (typeof CAPTURE_SUBCOMMANDS)[number], rest, repoDir, io, ctx);
  }
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
  const resolved = resolveMemorySettings(settings).settings;
  if (result.problems.length > 0) {
    io.stdout(`memory check: ${result.problems.length} problem${result.problems.length === 1 ? "" : "s"} in ${MEMORY_DIR}/\n`);
    printSuggestions(files, resolved, root, io, ctx);
    return 1;
  }
  io.stdout(`memory ok: ${Object.keys(files).length} file${Object.keys(files).length === 1 ? "" : "s"}, ${result.entries} entr${result.entries === 1 ? "y" : "ies"}\n`);
  printSuggestions(files, resolved, root, io, ctx);
  return 0;
}

const where = (e: MemoryEntry) => `${e.file}:${e.line}`;
const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * Hygiene suggestions, printed after the problems on stdout. They never change the exit code and
 * nothing is applied. Duplicates are found by the text of two rules; contradictions are not found
 * at all (that needs a model). Archive suggestions need the laptop's record of last use, so they are
 * not made in GitHub Actions, where no record persists, and need history on to be recorded (ADR 0020).
 */
function printSuggestions(files: Record<string, string>, settings: { archiveAfterDays: number }, root: string, io: MemoryIo, ctx: CaptureContext) {
  const env = ctx.env ?? process.env;
  const entries = Object.keys(files).sort().flatMap((name) => parseMemoryFile(name, files[name]).entries);
  const lines: string[] = [];
  for (const { a, b, similarity } of findDuplicates(entries)) {
    lines.push(`suggestion: ${a.id} and ${b.id} look like duplicates (same kind, overlapping scopes, rules ${Math.round(similarity * 100)}% alike): "${a.title}" (${where(a)}) and "${b.title}" (${where(b)}). Keep one; \`wachiman memory archive <id>\` moves the other to ${ARCHIVE_FILE}.`);
  }
  if (env.GITHUB_ACTIONS !== "true") {
    let used: Record<string, string> = {};
    try {
      used = readMemoryUse(wachimanHome(env), repositoryKey(root).key);
    } catch {
      // no repository key: every entry is measured from its added date
    }
    const date = (ctx.now ?? (() => new Date()))().toISOString().slice(0, 10);
    for (const s of archiveSuggestions(entries, used, settings.archiveAfterDays, date)) {
      const last = s.usedEver ? `last used ${s.since}` : `never used in a review since it was added ${s.since}`;
      lines.push(`suggestion: ${s.entry.id} ${last} (${plural(s.days)} ago), over memory.archive_after_days (${settings.archiveAfterDays}): "${s.entry.title}" (${where(s.entry)}). \`wachiman memory archive ${s.entry.id}\` moves it to ${ARCHIVE_FILE}.`);
    }
  }
  if (lines.length === 0) return;
  io.stdout(`${lines.join("\n")}\nsuggestions only: nothing was changed. Only likely duplicates are detected without a model; contradictions are not. Use is recorded on this laptop only.\n`);
}

/** `wachiman memory archive <id>`: moves the entry to archive.md in the working tree. Nothing is committed or pushed. */
function runArchive(rest: string[], repoDir: string, io: MemoryIo): number {
  const flag = rest.find((a) => a.startsWith("-"));
  if (flag !== undefined) throw new UsageError(`Unknown option "${flag}" for wachiman memory archive.`);
  if (rest.length !== 1) throw new UsageError("wachiman memory archive takes one entry id.");
  const root = repositoryRoot(repoDir);
  const files = readMemoryFolder(root);
  if (files === undefined) {
    io.stderr(`memory archive: no ${MEMORY_DIR}/ folder in ${root}; nothing was changed.`);
    return 1;
  }
  const moved = archiveEntry(files, rest[0]);
  if (!moved.ok) {
    io.stderr(`memory archive: ${moved.reason} Nothing was changed.`);
    return 1;
  }
  for (const part of [join(root, ".wachiman"), join(root, MEMORY_DIR), join(root, MEMORY_DIR, ARCHIVE_FILE)]) {
    if (existsSync(part) && lstatSync(part).isSymbolicLink()) {
      io.stderr(`memory archive: ${part.slice(root.length + 1)} is a symbolic link; nothing was changed.`);
      return 1;
    }
  }
  // archive.md first, then the source: a failure in between leaves the entry in both files, never in neither.
  for (const [name, text] of Object.entries(moved.files).sort(([a], [b]) => Number(b === ARCHIVE_FILE) - Number(a === ARCHIVE_FILE))) {
    const path = join(root, MEMORY_DIR, name);
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
  }
  io.stdout(`archived: ${rest[0]} moved from ${moved.from} to ${ARCHIVE_FILE} in ${MEMORY_DIR}/ (working tree only, not committed). Commit it, or leave it out of the change.\n`);
  return 0;
}
