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
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnGit, type GitRunner } from "../evidence";
import { normaliseRemote } from "../history/store";
import { type Candidate } from "./candidates";
import { type MemorySource } from "./load";
import { applyCandidate, introducedProblems, Refused, type ProposeIo, type ProposeResult } from "./propose";

const GIT_TIMEOUT_MS = 30_000;

/** A path segment that cannot climb out of its folder or hide: only letters, digits, `.`, `_`, `-`. */
const segment = (text: string) => text.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "");

/** The URL of `origin` without credentials, or undefined when the clone has none. */
function originOf(repoDir: string, git: GitRunner): string | undefined {
  const r = git(["remote", "get-url", "origin"], { cwd: repoDir, timeoutMs: GIT_TIMEOUT_MS });
  const raw = r.status === 0 ? r.stdout.trim() : "";
  return raw === "" ? undefined : raw;
}

/**
 * `<home>/memory/<host>/<owner>/<repository>` for the repository at `repoDir`, or undefined when it
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
  const owner = segment(parts.slice(0, -1).join("-"));
  const repository = segment(parts[parts.length - 1]);
  if (host === "" || owner === "" || repository === "") return undefined;
  return join(home, "memory", host, owner, repository);
}

/** The plain `.md` files directly inside `dir`: not links, not hidden. */
export function readPersonalFiles(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && !e.isSymbolicLink() && !e.name.startsWith(".") && e.name.endsWith(".md")) out[e.name] = readFileSync(join(dir, e.name), "utf8");
  }
  return out;
}

/** The personal folder as a `MemorySource`, so a review loads it with the same reader as committed memory. */
export function personalMemorySource(dir: string): MemorySource {
  return {
    list: () => Object.keys(readPersonalFiles(dir)),
    read: (name) => {
      const files = readPersonalFiles(dir);
      return Object.hasOwn(files, name) ? files[name] : null;
    },
    // Personal memory has no settings of its own: the budget is the repository's.
    settings: () => undefined,
  };
}

/** The personal source of `repoDir`, or undefined when it has none or its folder is empty. */
export function personalSourceFor(home: string, repoDir: string, git: GitRunner = spawnGit): MemorySource | undefined {
  const dir = personalMemoryDir(home, repoDir, git);
  if (dir === undefined) return undefined;
  const source = personalMemorySource(dir);
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
