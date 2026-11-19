/**
 * Personal memory (ADR 0056, spec decision 16): the same entry format as `.wachiman/memory/`, kept
 * outside the repository at `<wachiman home>/memory/<host>/<owner>/<repository>/`, for a developer
 * whose team has not adopted Wachiman. Nothing here is ever committed or pushed, so nothing appears
 * in `git status`.
 *
 * The folder is keyed by the URL of the remote named `origin`: every worktree and clone of a
 * repository shares it and no other repository sees it. A clone with no `origin` has none.
 * Only a laptop review loads it (`localMemory`); a review in Actions never does.
 */
import { type Dirent, chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { instructionFileOf, MAX_INSTRUCTION_BYTES } from "../engine";
import { spawnGit, type GitRunner } from "../evidence";
import { normaliseRemote } from "../history/store";
import { candidateProblem, CANDIDATE_FORMAT, type Candidate } from "./candidates";
import { parseMemoryFile } from "./entries";
import { ARCHIVE_FILE, cutMemoryNote, type MemorySource } from "./load";
import { applyCandidate, introducedProblems, Refused, type ProposeIo, type ProposeResult } from "./propose";

const GIT_TIMEOUT_MS = 30_000;

/** A path segment that cannot climb out of its folder or hide: only letters, digits, `.`, `_`, `-`. */
const segment = (text: string) => text.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "");

/**
 * The URL of `origin` as configured (`remote.origin.url`), or undefined when the clone has none.
 * Not `git remote get-url`: that applies `insteadOf` rewrites, so one repository would get a
 * different key on a machine that rewrites https to ssh.
 */
function originOf(repoDir: string, git: GitRunner): string | undefined {
  const r = git(["config", "--get", "remote.origin.url"], { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });
  const raw = r.status === 0 ? r.stdout.trim() : "";
  return raw === "" ? undefined : raw;
}

/**
 * `<home>/memory/<host>/<owner>.../<repository>` (one folder per owner part, as GitLab nests groups) for the repository at `repoDir`, or undefined when it
 * has no `origin`, or one whose URL does not name a host, an owner and a repository. `home` is the
 * Wachiman home itself (`wachimanHome(env)`).
 */
export function personalMemoryDir(home: string, repoDir: string, git: GitRunner = spawnGit): string | undefined {
  const raw = originOf(repoDir, git);
  if (raw === undefined) return undefined;
  const { text, parsed } = normaliseRemote(raw);
  if (!parsed) return undefined;
  const url = new URL(text);
  const parts = url.pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts.length < 2) return undefined;
  const host = segment(`${url.hostname}${url.port ? `-${url.port}` : ""}`);
  // Each owner part is its own folder, so GitLab's `group-sub/repo` and `group/sub/repo` do not share one.
  const owners = parts.slice(0, -1).map(segment);
  const repository = segment(parts[parts.length - 1]);
  if (host === "" || owners.includes("") || repository === "") return undefined;
  return join(home, "memory", host, ...owners, repository);
}

/**
 * The plain `.md` files directly inside `dir`: not links, not hidden. Without `warn`, a file or
 * folder that cannot be read throws (a write must never start from a partial picture). With
 * `warn`, it is named there and left out, so a review goes on without it, and a file over the size
 * cap of committed memory is cut at it with the same notice. Without `warn` a file is never cut:
 * a write must not save a partial copy.
 */
export function readPersonalFiles(dir: string, warn?: (line: string) => void): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  const skip = (path: string, error: unknown) => {
    if (!warn) throw error;
    warn(`personal memory: ${path} could not be read (${error instanceof Error ? error.message : String(error)}), so it is left out of this review.`);
  };
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    skip(dir, error);
  }
  for (const e of entries) {
    if (!(e.isFile() && !e.isSymbolicLink() && !e.name.startsWith(".") && e.name.endsWith(".md"))) continue;
    try {
      const bytes = readFileSync(join(dir, e.name));
      if (!warn) {
        out[e.name] = bytes.toString("utf8");
        continue;
      }
      const file = instructionFileOf(e.name, bytes);
      if (file.truncated) warn(cutMemoryNote(e.name, MAX_INSTRUCTION_BYTES / 1024));
      out[e.name] = file.content;
    } catch (error) {
      skip(join(dir, e.name), error);
    }
  }
  return out;
}

/**
 * The personal folder as a `MemorySource`, so a review loads it with the same reader as committed
 * memory. Read once, on first use; a problem is reported through `warn` and never throws.
 */
export function personalMemorySource(dir: string, warn: (line: string) => void = () => {}): MemorySource {
  let files: Record<string, string> | undefined;
  const all = () => (files ??= readPersonalFiles(dir, warn));
  return {
    list: () => Object.keys(all()),
    read: (name) => (Object.hasOwn(all(), name) ? all()[name] : null),
    // Personal memory has no settings of its own: the budget is the repository's.
    settings: () => undefined,
  };
}

/** The personal source of `repoDir`, or undefined when it has none or its folder is empty. */
export function personalSourceFor(home: string, repoDir: string, git: GitRunner = spawnGit, warn?: (line: string) => void): MemorySource | undefined {
  const dir = personalMemoryDir(home, repoDir, git);
  if (dir === undefined) return undefined;
  const source = personalMemorySource(dir, warn);
  return source.list().length > 0 ? source : undefined;
}

function privateDirs(home: string, dir: string) {
  const rel = dir.slice(home.length).split(sep).filter(Boolean);
  let at = home;
  for (const part of ["", ...rel]) {
    at = part === "" ? home : join(at, part);
    if (existsSync(at)) continue;
    mkdirSync(at, { mode: 0o700 });
    chmodSync(at, 0o700);
  }
}

function writeFileAtomic(path: string, text: string) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/**
 * `wachiman memory propose <id> --personal`: writes the entry exactly as shown into the personal
 * folder. No commit, no push, no fetch, no pull request. The same rules as the team path apply to
 * the text: an entry already there only gains the evidence it lacks, and an entry that would make
 * `memory check` fail on the personal folder is refused.
 */
export function proposePersonal(candidate: Candidate, repoDir: string, home: string, io: ProposeIo, git: GitRunner = spawnGit): ProposeResult {
  const top = git(["rev-parse", "--show-toplevel"], { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });
  const root = top.status === 0 ? top.stdout.trim() : repoDir;
  try {
    if (originOf(root, git) === undefined) throw new Refused("this repository has no remote named origin, so it has no personal memory (the folder is keyed by that URL); nothing was written.");
    const dir = personalMemoryDir(home, root, git);
    if (dir === undefined) throw new Refused("the URL of origin does not name a host, an owner and a repository, so there is no personal memory folder for it; nothing was written.");
    if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw new Refused(`${dir} is not a plain directory; nothing was written.`);
    const current = readPersonalFiles(dir);
    const applied = applyCandidate(current, candidate);
    if (applied.outcome === "unchanged") {
      io.stdout(`already recorded: ${candidate.id} is in your personal memory with the same evidence; nothing was written.\n`);
      return { recorded: true };
    }
    const introduced = introducedProblems(root, current, applied.files);
    if (introduced.length > 0) throw new Refused(`the entry would make \`wachiman memory check\` fail on your personal memory, so nothing was written:\n${introduced.map((l) => `  ${l}`).join("\n")}`);
    privateDirs(home, dir);
    for (const [name, text] of Object.entries(applied.files)) writeFileAtomic(join(dir, name), text);
    const what = applied.outcome === "inserted" ? `entry ${candidate.id}` : `evidence for entry ${candidate.id}, which was already there,`;
    io.stdout(`recorded: ${what} in your personal memory (${dir}). Nothing was committed or pushed; only your laptop reviews of this repository load it.\n`);
    return { recorded: true };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    io.stderr(`memory propose: ${error.message}`);
    return { recorded: false };
  }
}

export type MemoryChoice = "personal" | "team";
const CHOICE_FORMAT = "wachiman.memory-choice/1";

/** `<home>/memory-choice/<repo key>.json`: where a repository's answer to the first-propose question is kept (the key is `repositoryKey(repoDir).key`). */
const choicePath = (home: string, key: string) => join(home, "memory-choice", `${key}.json`);

/** The stored answer for this repository, or undefined when none was given (or the file is not one). */
export function readMemoryChoice(home: string, key: string): MemoryChoice | undefined {
  try {
    const parsed = JSON.parse(readFileSync(choicePath(home, key), "utf8"));
    return parsed?.format === CHOICE_FORMAT && (parsed.choice === "personal" || parsed.choice === "team") ? parsed.choice : undefined;
  } catch {
    return undefined;
  }
}

export function writeMemoryChoice(home: string, key: string, choice: MemoryChoice, now: Date): void {
  privateDirs(home, join(home, "memory-choice"));
  writeFileAtomic(choicePath(home, key), `${JSON.stringify({ format: CHOICE_FORMAT, choice, at: now.toISOString() }, null, 2)}\n`);
}

/** The words of an answer to the first-propose question: `1`, `p` or `personal`; `2`, `t` or `team`. */
export function parseMemoryChoice(answer: string | undefined): MemoryChoice | undefined {
  const a = (answer ?? "").trim().toLowerCase();
  if (a === "1" || a === "p" || a === "personal") return "personal";
  if (a === "2" || a === "t" || a === "team") return "team";
  return undefined;
}

export const FIRST_PROPOSE_QUESTION = [
  "This repository's default branch has no .wachiman/memory/, so its team has not adopted Wachiman memory.",
  "Where should this entry go?",
  "  1. personal: kept on this machine, never pushed; your laptop reviews of this repository load it",
  "  2. team: proposed as a pull request on this repository's wachiman/memory branch",
  "The answer is remembered for this repository.",
].join("\n");

/**
 * The personal entries of `dir` as candidates for the team path, with their text and evidence lines
 * exactly as they are in personal memory (`Evidence.text`). `only` limits them to those ids; an id
 * that is not there is listed in `unknown`. An entry whose text a terminal could show differently
 * from what would be committed is skipped and named in `skipped`.
 */
export function candidatesFromPersonal(dir: string, only: string[]): { candidates: Candidate[]; unknown: string[]; skipped: string[] } {
  // archive.md is never loaded into a review, so it is not memory to send (the report leaves it out too).
  const entries = Object.entries(readPersonalFiles(dir)).filter(([name]) => name !== ARCHIVE_FILE).flatMap(([name, text]) => parseMemoryFile(name, text).entries);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    if (seen.has(e.id) || (only.length > 0 && !only.includes(e.id))) continue;
    seen.add(e.id);
    const candidate: Candidate = {
      format: CANDIDATE_FORMAT,
      id: e.id,
      title: e.title,
      kind: e.kind,
      scope: e.scope,
      rule: e.rule,
      why: e.why,
      ...(e.holdsWhile ? { holdsWhile: e.holdsWhile } : {}),
      added: e.added,
      evidence: e.evidence.map((text) => ({ date: /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? e.added, source: "instruction" as const, agent: false, branch: "personal", text })),
    };
    const problem = candidateProblem(candidate);
    if (problem) skipped.push(`${e.id}: ${problem}`);
    else candidates.push(candidate);
  }
  const unknown = only.filter((id) => !seen.has(id));
  return { candidates, unknown, skipped };
}
