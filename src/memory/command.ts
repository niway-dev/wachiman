/**
 * `wachiman memory <subcommand>`: the one entry that `src/cli.ts` calls. `check` (layer 1) reads
 * `.wachiman/memory/` from the working tree and reports every defect with its file and line: a malformed entry, an entry id that is not its digest, a glob that
 * matches no file, an index row that names a missing file, an area file the index does not list, and
 * a budget overrun. No model is called and nothing is written. Exit 0 when clean, 1 on problems.
 * `candidates`, `add`, `show` and `propose` (layer 3, laptop capture) are in `capture.ts`.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../config";
import { spawnGit } from "../evidence";
import { commandHelp } from "../help";
import { parseRepoSettings, SETTINGS_PATH } from "../repo-settings";
import { type MemoryProblem } from "./entries";
import { inspectMemory, type CheckInput, type CheckResult } from "./inspect";
import { CAPTURE_SUBCOMMANDS, runCapture, type CaptureContext } from "./capture";
import { repositoryRoot } from "./settings";
import { MEMORY_DIR } from "./load";

export { inspectMemory, type CheckInput, type CheckResult };

export const MEMORY_SUBCOMMANDS = ["check", ...CAPTURE_SUBCOMMANDS] as const;

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
  if (result.problems.length > 0) {
    io.stdout(`memory check: ${result.problems.length} problem${result.problems.length === 1 ? "" : "s"} in ${MEMORY_DIR}/\n`);
    return 1;
  }
  io.stdout(`memory ok: ${Object.keys(files).length} file${Object.keys(files).length === 1 ? "" : "s"}, ${result.entries} entr${result.entries === 1 ? "y" : "ies"}\n`);
  return 0;
}
