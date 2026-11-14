/**
 * The two tools `check` and `risk` shell out to, `git` and `gh`, behind one injectable runner.
 * Every command is an argument array run without a shell, so nothing from a PR (a title, a branch
 * name, a path) is ever parsed as shell text. Tests pass a fake runner.
 */
import { spawnSync } from "node:child_process";
import { parsePatch, type ChangedFile } from "./pr-risk";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `cmd[0]` with the rest as arguments. Never throws for a failing command: it returns its exit code. */
export type CommandRunner = (cmd: string[], cwd?: string) => CommandResult;

/** A tool is missing, failed or answered something unreadable. `check` and `risk` exit 2 on it. */
export class ToolError extends Error {}

/**
 * Runs the tools with `LC_ALL=C`, so their messages are in English whatever the user's locale. The
 * git helpers decide nothing from a message (see `gitFileAt`); `ghFileAt` reads the HTTP status
 * text of `gh api`, which the locale does not change. The setting also keeps the text that `check`
 * shows when a tool fails in English.
 */
export const defaultRunner: CommandRunner = (cmd, cwd) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } });
  if (r.error) return { code: 127, stdout: "", stderr: `cannot run ${cmd[0]}: ${r.error.message}` };
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

const firstLine = (text: string) => text.trim().split("\n")[0] || "no message";

/** The command as a person would name it: `git diff`, `gh pr view`. Leading `-c key=value` options of git are not part of the name. */
function commandName(cmd: string[]): string {
  const words = [cmd[0]!];
  let i = 1;
  while (cmd[0] === "git" && cmd[i] === "-c" && i + 1 < cmd.length) i += 2;
  words.push(...cmd.slice(i, i + (cmd[0] === "git" ? 1 : 2)));
  return words.join(" ");
}

/** stdout of a command that must succeed. */
export function runOrThrow(run: CommandRunner, cmd: string[], cwd?: string): string {
  const r = run(cmd, cwd);
  if (r.code !== 0) throw new ToolError(`${commandName(cmd)} failed: ${firstLine(r.stderr)}`);
  return r.stdout;
}

// --------------------------------------------------------------------------- git

const git = (run: CommandRunner, cwd: string, args: string[]) => runOrThrow(run, ["git", "-c", "core.quotepath=false", ...args], cwd);

export function gitHead(run: CommandRunner, cwd: string): string {
  return git(run, cwd, ["rev-parse", "HEAD"]).trim();
}

/** What the branch changed since it left `base`: the diff from the merge base, one entry per file with its hunk lines. */
export function changesFromGit(run: CommandRunner, cwd: string, base: string): { mergeBase: string; changes: ChangedFile[] } {
  const mergeBase = git(run, cwd, ["merge-base", base, "HEAD"]).trim();
  const patch = git(run, cwd, ["diff", "-M", "-U0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", mergeBase, "HEAD"]);
  return { mergeBase, changes: parsePatch(patch) };
}

/** The message of every commit in `base..HEAD`. */
export function commitMessagesFromGit(run: CommandRunner, cwd: string, base: string): string[] {
  const out = git(run, cwd, ["log", "--format=%B%x00", `${base}..HEAD`]);
  return out.split("\0").map((m) => m.trim()).filter((m) => m !== "");
}

/**
 * A file as it is at `ref`, or null when the commit has no such file. Absence is decided by the
 * tree, not by git's error text (which changes with the locale): `git ls-tree` answers an empty
 * list for a path the commit lacks, and fails for a bad ref or a broken repository. A path that is
 * a directory or a submodule is not a file, so it is absent too.
 */
export function gitFileAt(run: CommandRunner, cwd: string, ref: string, path: string): string | null {
  const listing = run(["git", "ls-tree", "-z", "--full-tree", ref, "--", path], cwd);
  if (listing.code !== 0) throw new ToolError(`git ls-tree ${ref} -- ${path} failed: ${firstLine(listing.stderr)}`);
  const entry = listing.stdout.split("\0").find((e) => e.slice(e.indexOf("\t") + 1) === path && e.includes("\t"));
  if (entry === undefined || !/^\d+ blob /.test(entry)) return null;
  const r = run(["git", "show", `${ref}:${path}`], cwd);
  if (r.code !== 0) throw new ToolError(`git show ${ref}:${path} failed: ${firstLine(r.stderr)}`);
  return r.stdout;
}

// --------------------------------------------------------------------------- gh

export interface PrInfo {
  title: string;
  body: string;
  /** The head commit. */
  headSha: string;
  /** The base branch name. */
  baseRef: string;
  /** `owner/name` of the repository the PR is in, and of the one its head branch lives in (a fork's own). */
  baseRepo: string;
  headRepo: string;
  commitMessages: string[];
  /** Every path the PR changes. */
  paths: string[];
}

const repoFlag = (repo: string | undefined) => (repo ? ["--repo", repo] : []);

/** Title, body, head, commits and changed paths of a PR, through `gh pr view`. */
export function ghPrView(run: CommandRunner, number: number, repo?: string): PrInfo {
  const text = runOrThrow(run, [
    "gh", "pr", "view", String(number), "--json",
    "title,body,headRefOid,baseRefName,commits,files,url,isCrossRepository,headRepository,headRepositoryOwner",
    ...repoFlag(repo),
  ]);
  let info: Record<string, any>;
  try {
    info = JSON.parse(text);
  } catch {
    throw new ToolError("gh pr view did not answer JSON");
  }
  if (typeof info.headRefOid !== "string" || typeof info.baseRefName !== "string") throw new ToolError("gh pr view answered no head commit or base branch");
  const fromUrl = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\//.exec(String(info.url ?? ""))?.[1];
  const baseRepo = repo ?? fromUrl;
  if (!baseRepo) throw new ToolError("cannot tell which repository the PR is in; pass --repo <owner/name>");
  const owner = info.headRepositoryOwner?.login;
  const name = info.headRepository?.name;
  const headRepo = info.isCrossRepository && owner && name ? `${owner}/${name}` : baseRepo;
  return {
    title: String(info.title ?? ""),
    body: String(info.body ?? ""),
    headSha: info.headRefOid,
    baseRef: info.baseRefName,
    baseRepo,
    headRepo,
    commitMessages: ((info.commits ?? []) as Record<string, string>[]).map((c) => `${c.messageHeadline ?? ""}\n${c.messageBody ?? ""}`.trim()),
    paths: ((info.files ?? []) as Record<string, string>[]).map((f) => String(f.path)),
  };
}

/** The PR's diff, through `gh pr diff`. Fails for a diff GitHub will not serve (too large). */
export function ghPrDiff(run: CommandRunner, number: number, repo?: string): ChangedFile[] {
  return parsePatch(runOrThrow(run, ["gh", "pr", "diff", String(number), ...repoFlag(repo)]));
}

/**
 * A file of a repository at a commit or branch, through the contents API. Null only when the file
 * is absent: a 404 also answers an unreachable repository or ref, so after one the commit is
 * looked up through the same API family, and if that fails too the error is raised.
 */
export function ghFileAt(run: CommandRunner, repo: string, path: string, ref: string): string | null {
  const cmd = ["gh", "api", "-H", "Accept: application/vnd.github.raw+json", `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`];
  const r = run(cmd);
  if (r.code === 0) return r.stdout;
  if (!/\b404\b|not found/i.test(r.stderr)) throw new ToolError(`gh api ${repo}/${path}@${ref} failed: ${firstLine(r.stderr)}`);
  const reach = run(["gh", "api", `repos/${repo}/commits/${encodeURIComponent(ref)}`]);
  if (reach.code !== 0) {
    throw new ToolError(`gh api ${repo}/${path}@${ref} failed: ${repo}@${ref} cannot be reached (${firstLine(reach.stderr)})`);
  }
  return null;
}
