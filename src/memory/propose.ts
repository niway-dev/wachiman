/**
 * `wachiman memory propose <id>`: the laptop write path of repository memory (ADR 0056 decision 6,
 * spec decision 8 and "The write path, step by step").
 *
 * The developer's checkout is never used. The command fetches, builds one commit in a temporary
 * worktree on the head of `origin/wachiman/memory` (or of the remote default branch when that branch
 * does not exist, or was already merged), pushes it without force, and removes the worktree in every
 * outcome. The entry is inserted as a structured block, not merged as text, so a rejected push is
 * answered by fetching and applying the same entry on the new head: an entry whose id is already
 * there is not written twice, the proposer's evidence is appended to it instead.
 *
 * No git hook of the developer's runs for the worktree, the commit or the push (`core.hooksPath`
 * points at an empty folder for those calls): the commit touches only `.wachiman/memory/`, a
 * temporary worktree has none of the checkout's installed tooling, and a hook that rewrites files
 * would break "written as shown". What stands in for them is `memory check` run on the result
 * before committing; the remote's own rules (branch protection, required checks on the pull
 * request) still apply.
 *
 * Only paths under `.wachiman/memory/` can be written. "recorded" is printed only after the push.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { renderEntry, evidenceLine, type Candidate } from "./candidates";
import { parseRepoSettings, SETTINGS_PATH } from "../repo-settings";
import { inspectMemory } from "./command";
import { parseMemoryFile } from "./entries";
import { INDEX_FILE, MEMORY_DIR } from "./load";

export const MEMORY_BRANCH = "wachiman/memory";
export const PULL_REQUEST_TITLE = "chore(wachiman): memory";
const MAX_ATTEMPTS = 5;

export interface PullRequest {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
}

/** The two GitHub calls the command makes. Tests pass a fake; the default shells out to `gh`. */
export interface PullRequests {
  /** Every pull request, open or not, whose head is `head`. Throws when it cannot say. */
  list(head: string, cwd: string): PullRequest[];
  /** Opens a draft pull request and returns its URL. */
  createDraft(input: { head: string; base: string; title: string; body: string }, cwd: string): string;
}

export interface ProposeDeps {
  pulls?: PullRequests;
}

export interface ProposeIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

export interface ProposeResult {
  recorded: boolean;
  pullRequestFailed?: boolean;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `git` with the developer's own environment (credentials, ssh agent), minus the variables that would redirect it to another repository. */
function git(cwd: string, args: string[]): Run {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete env[name];
  const r = spawnSync("git", ["-c", "core.quotepath=off", ...args], { cwd, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? ` ${r.error.message}` : "") };
}

class Refused extends Error {}

const must = (r: Run, what: string): string => {
  if (r.status !== 0) throw new Refused(`${what} failed: ${r.stderr.trim() || `exit ${r.status}`}`);
  return r.stdout.trim();
};

const realPulls: PullRequests = {
  list(head, cwd) {
    const r = spawnSync("gh", ["pr", "list", "--head", head, "--state", "all", "--limit", "50", "--json", "number,state,url"], { cwd, encoding: "utf8", timeout: 60_000 });
    if (r.error || r.status !== 0) throw new Error(r.error?.message ?? (r.stderr.trim() || `gh exited ${r.status}`));
    const rows = JSON.parse(r.stdout) as PullRequest[];
    return rows.filter((x) => x && Number.isInteger(x.number) && ["OPEN", "CLOSED", "MERGED"].includes(x.state));
  },
  createDraft(input, cwd) {
    const r = spawnSync("gh", ["pr", "create", "--draft", "--head", input.head, "--base", input.base, "--title", input.title, "--body", input.body], { cwd, encoding: "utf8", timeout: 60_000 });
    if (r.error || r.status !== 0) throw new Error(r.error?.message ?? (r.stderr.trim() || `gh exited ${r.status}`));
    return r.stdout.trim().split("\n").pop() ?? "";
  },
};

/** Throws unless every path is a file directly under `.wachiman/memory/`. */
export function assertMemoryPaths(paths: string[]): void {
  for (const p of paths) {
    if (!/^\.wachiman\/memory\/[^/\\]+$/.test(p) || p.includes("..")) throw new Refused(`refusing to write ${p}: only files under ${MEMORY_DIR}/ may be written.`);
  }
}

const ANY_HEADING_RE = /^#{1,6}\s/;
const squash = (t: string) => t.replace(/\s+/g, " ").trim();

export interface Applied {
  /** What was written, by file name inside `.wachiman/memory/`. */
  files: Record<string, string>;
  outcome: "inserted" | "evidence-added" | "unchanged";
  file: string;
}

/**
 * The memory files after `candidate` is applied. An entry with the candidate's id already in any
 * file only gains the evidence lines it lacks; otherwise the exact text of `renderEntry` is appended
 * to `index.md`, which is created when absent.
 */
export function applyCandidate(current: Record<string, string>, candidate: Candidate): Applied {
  for (const [name, text] of Object.entries(current)) {
    const entry = parseMemoryFile(name, text).entries.find((e) => e.id === candidate.id);
    if (!entry) continue;
    const have = new Set(entry.evidence.map(squash));
    const lines = candidate.evidence.map(evidenceLine).filter((l) => !have.has(squash(l)));
    if (lines.length === 0) return { files: {}, outcome: "unchanged", file: name };
    const rows = text.split("\n");
    const headingIndex = entry.line - 1;
    let end = rows.length;
    for (let i = headingIndex + 1; i < rows.length; i++) {
      if (ANY_HEADING_RE.test(rows[i])) {
        end = i;
        break;
      }
    }
    const evidenceAt = rows.findIndex((r, i) => i > headingIndex && i < end && r.trim() === "- evidence:");
    if (evidenceAt === -1) throw new Refused(`entry ${candidate.id} in ${MEMORY_DIR}/${name} has no evidence list to extend.`);
    let last = evidenceAt;
    for (let i = evidenceAt + 1; i < end && /^ {2}\S/.test(rows[i]); i++) last = i;
    rows.splice(last + 1, 0, ...lines.map((l) => `  - ${l}`));
    return { files: { [name]: rows.join("\n") }, outcome: "evidence-added", file: name };
  }
  const block = renderEntry(candidate);
  const index = current[INDEX_FILE];
  const next = index === undefined ? `# Wachiman memory\n\n${block}` : `${index.replace(/\n*$/, "\n")}\n${block}`;
  return { files: { [INDEX_FILE]: next }, outcome: "inserted", file: INDEX_FILE };
}

export function readMemoryFiles(worktree: string): Record<string, string> {
  const dir = join(worktree, MEMORY_DIR);
  for (const part of [join(worktree, ".wachiman"), dir]) {
    let st;
    try {
      st = lstatSync(part);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; // does not exist yet
      throw new Refused(`cannot read ${part.slice(worktree.length + 1)} (${(error as Error).message}); nothing was written.`);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Refused(`${part.slice(worktree.length + 1)} is not a plain directory; nothing was written.`);
  }
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Refused(`${MEMORY_DIR}/${e.name} is a symbolic link; nothing was written.`);
    if (e.isFile() && e.name.endsWith(".md")) out[e.name] = readFileSync(join(dir, e.name), "utf8");
  }
  return out;
}

/** The problems `memory check` would report after `next` replaces the memory files, minus those the base already had. */
function introducedProblems(worktree: string, current: Record<string, string>, next: Record<string, string>): string[] {
  const listed = git(worktree, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const repoFiles = listed.status === 0 ? listed.stdout.split("\0").filter(Boolean) : [];
  const settingsPath = join(worktree, SETTINGS_PATH);
  let settings;
  try {
    settings = existsSync(settingsPath) ? parseRepoSettings(readFileSync(settingsPath, "utf8")) : undefined;
  } catch {
    settings = undefined; // the defaults; a broken settings file is reported by `wachiman doctor`, not by this command
  }
  const known = new Set(inspectMemory({ files: current, repoFiles, settings }).problems.map((p) => `${p.file}: ${p.message}`));
  return inspectMemory({ files: { ...current, ...next }, repoFiles, settings })
    .problems.filter((p) => !known.has(`${p.file}: ${p.message}`))
    .map((p) => `${MEMORY_DIR}/${p.file}:${p.line}: ${p.message}`);
}

interface Remote {
  defaultBranch: string;
  defaultHead: string;
  memoryHead?: string;
}

/** Fetches the default branch and, when it exists, the memory branch; no other ref of the developer's is touched. */
function fetchRemote(root: string): Remote {
  const ls = must(git(root, ["ls-remote", "--symref", "origin", "HEAD", `refs/heads/${MEMORY_BRANCH}`]), "git ls-remote origin");
  const defaultBranch = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(ls)?.[1];
  if (!defaultBranch) throw new Refused("cannot tell which branch is origin's default; nothing was written.");
  const hasMemory = new RegExp(`\\trefs/heads/${MEMORY_BRANCH}$`, "m").test(ls);
  const specs = [`+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`, ...(hasMemory ? [`+refs/heads/${MEMORY_BRANCH}:refs/remotes/origin/${MEMORY_BRANCH}`] : [])];
  must(git(root, ["fetch", "--no-tags", "origin", ...specs]), "git fetch origin");
  const defaultHead = must(git(root, ["rev-parse", "--verify", `refs/remotes/origin/${defaultBranch}^{commit}`]), "reading origin's default branch");
  const memoryHead = hasMemory ? must(git(root, ["rev-parse", "--verify", `refs/remotes/origin/${MEMORY_BRANCH}^{commit}`]), "reading origin/wachiman/memory") : undefined;
  return { defaultBranch, defaultHead, ...(memoryHead ? { memoryHead } : {}) };
}

const isAncestor = (root: string, a: string, b: string) => git(root, ["merge-base", "--is-ancestor", a, b]).status === 0;

/** The commit to build on: the memory branch, or the default branch when there is none or the memory branch is already part of it. */
const baseOf = (root: string, r: Remote) => (r.memoryHead && !isAncestor(root, r.memoryHead, r.defaultHead) ? r.memoryHead : r.defaultHead);

function commitMessage(c: Candidate, outcome: Applied["outcome"]): string {
  const title = squash(c.title).slice(0, 60);
  return outcome === "inserted" ? `chore(wachiman): memory ${c.id} ${title}` : `chore(wachiman): add evidence to memory ${c.id}`;
}

const PR_BODY = [
  "Memory entries proposed by `wachiman memory propose`, one commit per entry. Each entry was shown to the person who proposed it and written as shown.",
  "",
  "Nothing here is active until a person merges this pull request: reviews read `.wachiman/memory/` from the base commit. Edit, drop or refine entries on this branch before merging.",
].join("\n");

const rejected = (stderr: string) => /rejected|non-fast-forward|fetch first|failed to update ref|cannot lock ref/i.test(stderr);

export function proposeCandidate(candidate: Candidate, repoDir: string, io: ProposeIo, deps: ProposeDeps = {}): ProposeResult {
  const pulls = deps.pulls ?? realPulls;
  const top = git(repoDir, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new UsageError(`${repoDir} is not a git repository.`);
  const root = top.stdout.trim();
  let worktree: string | undefined;
  const hooks = mkdtempSync(join(tmpdir(), "wachiman-nohooks-"));
  /** `git` with none of the developer's hooks (see the header). */
  const quiet = (cwd: string, args: string[]) => git(cwd, ["-c", `core.hooksPath=${hooks}`, ...args]);
  try {
    if (git(root, ["remote", "get-url", "origin"]).status !== 0) throw new Refused("this repository has no remote named origin; nothing was written.");

    let remote = fetchRemote(root);
    // A closed pull request is the team saying no; a merged one whose branch was not deleted cannot be continued without a force-push.
    if (remote.memoryHead) {
      let found: PullRequest[];
      try {
        found = pulls.list(MEMORY_BRANCH, root);
      } catch (error) {
        throw new Refused(`cannot read the pull requests of ${MEMORY_BRANCH} (${error instanceof Error ? error.message : error}), so nothing was written.`);
      }
      const latest = [...found].sort((a, b) => b.number - a.number)[0];
      const open = found.some((p) => p.state === "OPEN");
      if (!open && latest?.state === "CLOSED") {
        throw new Refused(`the pull request #${latest.number} for ${MEMORY_BRANCH} was closed without merging, so nothing was written. Reopen it or delete the branch to propose again.`);
      }
      if (!open && latest?.state === "MERGED" && !isAncestor(root, remote.memoryHead, remote.defaultHead)) {
        throw new Refused(`the pull request #${latest.number} for ${MEMORY_BRANCH} was merged but the branch still holds commits the default branch lacks, so nothing was written. Delete the branch ${MEMORY_BRANCH} on origin to start a new one.`);
      }
    }

    let sha: string | undefined;
    let outcome: Applied["outcome"] = "inserted";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      worktree = mkdtempSync(join(tmpdir(), "wachiman-memory-"));
      must(quiet(root, ["worktree", "add", "--detach", worktree, baseOf(root, remote)]), "git worktree add");
      const current = readMemoryFiles(worktree);
      const applied = applyCandidate(current, candidate);
      outcome = applied.outcome;
      if (applied.outcome === "unchanged") {
        // Nothing to write, but an earlier run may have stopped before the pull request was opened.
        sha = must(git(worktree, ["rev-parse", "HEAD"]), "git rev-parse");
        break;
      }
      const introduced = introducedProblems(worktree, current, applied.files);
      if (introduced.length > 0) {
        throw new Refused(`the entry would make \`wachiman memory check\` fail on ${MEMORY_BRANCH}, so nothing was written:\n${introduced.map((l) => `  ${l}`).join("\n")}`);
      }
      const paths = Object.keys(applied.files).map((n) => `${MEMORY_DIR}/${n}`);
      assertMemoryPaths(paths);
      mkdirSync(join(worktree, MEMORY_DIR), { recursive: true });
      for (const [name, text] of Object.entries(applied.files)) writeFileSync(join(worktree, MEMORY_DIR, name), text);
      must(git(worktree, ["add", "--", ...paths]), "git add");
      assertMemoryPaths(must(git(worktree, ["diff", "--cached", "--name-only"]), "git diff").split("\n").filter(Boolean));
      must(quiet(worktree, ["commit", "-q", "-m", commitMessage(candidate, applied.outcome)]), "git commit");
      const push = quiet(worktree, ["push", "origin", `HEAD:refs/heads/${MEMORY_BRANCH}`]);
      if (push.status === 0) {
        sha = must(git(worktree, ["rev-parse", "HEAD"]), "git rev-parse");
        break;
      }
      if (!rejected(push.stderr) || attempt === MAX_ATTEMPTS) {
        throw new Refused(`the push to ${MEMORY_BRANCH} failed${rejected(push.stderr) ? ` ${MAX_ATTEMPTS} times because colleagues kept pushing first` : ""}: ${push.stderr.trim()}`);
      }
      // A colleague pushed first: start again from the new head with the same entry.
      removeWorktree(root, worktree);
      worktree = undefined;
      remote = fetchRemote(root);
    }
    if (!sha) throw new Refused("the push did not complete.");

    const what = outcome === "inserted" ? `entry ${candidate.id}` : `evidence for entry ${candidate.id}, which was already there,`;
    const recordedLine = (tail: string) =>
      outcome === "unchanged"
        ? `already recorded: ${candidate.id} is on ${MEMORY_BRANCH} with the same evidence; nothing was written.${tail}\n`
        : `recorded: ${what} on ${MEMORY_BRANCH} (${sha!.slice(0, 7)}).${tail}\n`;
    let url: string | undefined;
    try {
      const open = pulls.list(MEMORY_BRANCH, root).find((p) => p.state === "OPEN");
      url = open ? open.url : pulls.createDraft({ head: MEMORY_BRANCH, base: remote.defaultBranch, title: PULL_REQUEST_TITLE, body: PR_BODY }, root);
    } catch (error) {
      io.stdout(recordedLine(""));
      io.stderr(`memory propose: the draft pull request could not be opened (${error instanceof Error ? error.message : error}). Open it from ${MEMORY_BRANCH} with the title "${PULL_REQUEST_TITLE}".`);
      return { recorded: true, pullRequestFailed: true };
    }
    io.stdout(recordedLine(` Draft pull request: ${url}`));
    return { recorded: true };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    io.stderr(`memory propose: ${error.message}`);
    return { recorded: false };
  } finally {
    if (worktree) removeWorktree(root, worktree);
    rmSync(hooks, { recursive: true, force: true });
  }
}

function removeWorktree(root: string, worktree: string) {
  git(root, ["worktree", "remove", "--force", worktree]);
  rmSync(worktree, { recursive: true, force: true });
  git(root, ["worktree", "prune"]);
}
