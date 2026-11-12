/**
 * The `local-git` connector (spec "The `local-git` connector", ADR 0019 decision 4): the
 * committed change of a branch in a local clone, `merge-base(base, HEAD) → HEAD`, as a
 * `ReviewInput`. It reads the clone with `git` only, never fetches, and never writes to it; the
 * head the agent reads is a snapshot, so later edits of the working tree change nothing.
 *
 * The snapshot is a `git archive` of the head extracted into a temporary directory, with an index
 * of its own (`git init`, the clone's objects as alternates, `git read-tree`, trimmed to the
 * extracted files, no commit): the evidence step runs `git grep` in the head, and in a plain
 * directory that fails (spec correction 1 of the plan).
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { UsageError } from "../config";
import {
  instructionFileOf,
  instructionsFrom,
  REVIEW_INPUT_FORMAT,
  resolveScope,
  type BaseInstructions,
  type ReviewFile,
  type ReviewInput,
} from "../engine";
import { GIT_BASE_ARGS, gitEnv, spawnGit, type GitRunner } from "../evidence";

const TIMEOUT_MS = 60_000;
/** The whole branch diff is one output; a large branch can be far over the evidence step's 8 MB. */
const DIFF_MAX_BYTES = 512 * 1024 * 1024;
const short = (sha: string) => sha.slice(0, 7);

/** The most commits a local review may span, from its start commit to `HEAD`; `--max-depth` changes it for one run. */
export const DEFAULT_MAX_DEPTH = 50;

/** Which commits a local review spans; without one, the branch against its base (`merge-base(base, HEAD) → HEAD`). */
/** `LocalRefs.baseRef` of a root commit, which has no parent to start from. */
export const EMPTY_TREE_LABEL = "the empty tree";

export interface RangeSelect {
  /** Exactly this commit: `<rev>^ → <rev>`, any commit of the clone, whatever `HEAD` is. */
  commit?: string;
  /** From this commit forward, inclusive: `<rev>^ → HEAD`; it must be an ancestor of `HEAD`. */
  from?: string;
}

export interface LocalRefs {
  /** The base branch; for `commit` and `from`, the short start commit (or "the empty tree"). */
  baseRef: string;
  baseSha: string;
  /** The start of the diff: the merge-base, or the parent of the named commit (the empty tree for a root commit). */
  mergeBase: string;
  /** The branch of `HEAD`; for `commit`, the short sha unless `HEAD` is a branch at that commit. */
  headRef: string;
  headSha: string;
  /** `git rev-list --count mergeBase..headSha` (1 for `commit`). */
  depth: number;
  /** Set for the `commit` and `from` modes only; `rev` is the resolved sha the user named. */
  mode?: { kind: "commit"; rev: string; merge: boolean } | { kind: "from"; rev: string };
}

/** Runs git in the clone and returns stdout; a non-zero exit throws with the command and stderr. */
function run(git: GitRunner, cwd: string, args: string[], maxBytes?: number) {
  const out = git(args, { cwd, timeoutMs: TIMEOUT_MS, maxBytes });
  if (out.status !== 0 || out.error || out.outputCut) {
    const why = out.outputCut ? "output too large" : (out.error ?? out.stderr?.trim() ?? `status ${out.status}`);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${why}`);
  }
  return out.stdout;
}

/** True when git exits 0: for the `--verify`/`-q` probes, whose failure is an answer. */
const ok = (git: GitRunner, cwd: string, args: string[]) => git(args, { cwd, timeoutMs: TIMEOUT_MS }).status === 0;

/**
 * The base, its merge-base with `HEAD`, and the head. The base defaults to the upstream's default
 * branch (`origin/HEAD`) when it resolves, else `main`. A detached or unborn `HEAD`, a base that is
 * not a commit and a base with no common ancestor are usage errors. No fetch, ever.
 *
 * The start commit is the merge-base. Without `--base`, a `HEAD` on the base branch itself (or one
 * with no commit past the base) has no branch to review and is refused. Either way the range may
 * not exceed `maxDepth` commits, checked here, before any snapshot or provider call.
 */
export function resolveRefs(
  repoDir: string,
  base: string | undefined,
  git: GitRunner = spawnGit,
  maxDepth: number = DEFAULT_MAX_DEPTH,
  select: RangeSelect = {},
): LocalRefs {
  if (select.commit !== undefined) return resolveCommit(repoDir, select.commit, git);
  if (select.from !== undefined) return resolveFrom(repoDir, select.from, git, maxDepth);
  if (base !== undefined && (base === "" || base.startsWith("-"))) throw new UsageError(`--base "${base}" is not a ref.`);
  const symbolic = git(["symbolic-ref", "-q", "--short", "HEAD"], { cwd: repoDir, timeoutMs: TIMEOUT_MS });
  if (symbolic.status !== 0) throw new UsageError("HEAD is detached; check out a branch, or pass --input");
  const headRef = symbolic.stdout.trim();
  if (!ok(git, repoDir, ["rev-parse", "--verify", "-q", "HEAD"])) {
    throw new UsageError(`HEAD (${headRef}) has no commit yet; commit the change first, or pass --input`);
  }
  let baseRef = base;
  if (baseRef === undefined) {
    const upstream = git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { cwd: repoDir, timeoutMs: TIMEOUT_MS });
    if (upstream.status === 0 && upstream.stdout.trim() !== "") baseRef = upstream.stdout.trim();
    else if (ok(git, repoDir, ["rev-parse", "--verify", "-q", "main^{commit}"])) baseRef = "main";
    else throw new UsageError("No base branch found; pass --base <ref>");
  }
  if (!ok(git, repoDir, ["rev-parse", "--verify", "-q", `${baseRef}^{commit}`])) {
    throw new UsageError(`--base ${baseRef} is not a commit in this clone.`);
  }
  const baseSha = run(git, repoDir, ["rev-parse", "--verify", `${baseRef}^{commit}`]).trim();
  const headSha = run(git, repoDir, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const mb = git(["merge-base", baseSha, headSha], { cwd: repoDir, timeoutMs: TIMEOUT_MS });
  if (mb.status !== 0 || mb.stdout.trim() === "") throw new UsageError(`\`${baseRef}\` and HEAD have no common ancestor`);
  const mergeBase = mb.stdout.trim();
  // `origin/main` and `main` are the same branch for this purpose.
  if (base === undefined && (headRef === baseRef || `origin/${headRef}` === baseRef || mergeBase === headSha)) {
    const branch = headRef === baseRef || `origin/${headRef}` === baseRef ? headRef : baseRef;
    throw new UsageError(
      `HEAD is on ${branch}, which is the base: there is no branch to review. Check out your branch, or pass --base <commit> to review from that commit.`,
    );
  }
  const depth = Number(run(git, repoDir, ["rev-list", "--count", `${mergeBase}..${headSha}`]).trim());
  if (depth > maxDepth) {
    throw new UsageError(
      `The range from ${short(mergeBase)} to ${short(headSha)} is ${depth} commits, more than the maximum depth of ${maxDepth}. Pass a closer --base <commit>, or raise the limit with --max-depth <n>.`,
    );
  }
  return { baseRef, baseSha, mergeBase, headRef, headSha, depth };
}

/** The commit `rev` names, as a sha; a usage error when it is not a commit of this clone. */
function commitOf(git: GitRunner, repoDir: string, flag: string, rev: string) {
  if (rev === "" || rev.startsWith("-") || !ok(git, repoDir, ["rev-parse", "--verify", "-q", `${rev}^{commit}`])) {
    throw new UsageError(`${flag} ${rev} is not a commit in this clone.`);
  }
  return run(git, repoDir, ["rev-parse", "--verify", `${rev}^{commit}`]).trim();
}

/** Where a commit's review starts: its first parent, or the empty tree for a root commit. */
function startOf(git: GitRunner, repoDir: string, sha: string) {
  const [, ...parents] = run(git, repoDir, ["rev-list", "--parents", "-n", "1", sha]).trim().split(" ");
  if (parents.length > 0) return { start: parents[0], baseRef: short(parents[0]), merge: parents.length > 1 };
  // Not written to the repository: `-w` is absent. The empty tree differs in a SHA-256 clone.
  const empty = run(git, repoDir, ["hash-object", "-t", "tree", "/dev/null"]).trim();
  return { start: empty, baseRef: EMPTY_TREE_LABEL, merge: false };
}

function branchOfHead(git: GitRunner, repoDir: string) {
  const symbolic = git(["symbolic-ref", "-q", "--short", "HEAD"], { cwd: repoDir, timeoutMs: TIMEOUT_MS });
  return symbolic.status === 0 ? symbolic.stdout.trim() : undefined;
}

/** `--commit <rev>`: `<rev>^ → <rev>`. Needs no branch and no `HEAD`; depth is 1 whatever the cap. */
function resolveCommit(repoDir: string, rev: string, git: GitRunner): LocalRefs {
  const headSha = commitOf(git, repoDir, "--commit", rev);
  const { start, baseRef, merge } = startOf(git, repoDir, headSha);
  const branch = branchOfHead(git, repoDir);
  const onBranch = branch !== undefined && git(["rev-parse", "-q", "--verify", "HEAD"], { cwd: repoDir, timeoutMs: TIMEOUT_MS }).stdout.trim() === headSha;
  return {
    baseRef,
    baseSha: start,
    mergeBase: start,
    headRef: onBranch ? branch : short(headSha),
    headSha,
    depth: 1,
    mode: { kind: "commit", rev: headSha, merge },
  };
}

/** `--from <rev>`: `<rev>^ → HEAD`, `HEAD` a branch, `<rev>` one of its ancestors, the range within `maxDepth`. */
function resolveFrom(repoDir: string, rev: string, git: GitRunner, maxDepth: number): LocalRefs {
  const headRef = branchOfHead(git, repoDir);
  if (headRef === undefined) throw new UsageError("HEAD is detached; check out a branch, or pass --input");
  if (!ok(git, repoDir, ["rev-parse", "--verify", "-q", "HEAD"])) {
    throw new UsageError(`HEAD (${headRef}) has no commit yet; commit the change first, or pass --input`);
  }
  const from = commitOf(git, repoDir, "--from", rev);
  const headSha = run(git, repoDir, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!ok(git, repoDir, ["merge-base", "--is-ancestor", from, headSha])) {
    throw new UsageError(`--from ${short(from)} is not an ancestor of HEAD (${headRef}, ${short(headSha)}); pick a commit of this branch.`);
  }
  const { start, baseRef } = startOf(git, repoDir, from);
  // A root start has no commit to exclude: the range is the whole history of HEAD.
  const range = baseRef === EMPTY_TREE_LABEL ? [headSha] : [`${start}..${headSha}`];
  const depth = Number(run(git, repoDir, ["rev-list", "--count", ...range]).trim());
  if (depth > maxDepth) {
    throw new UsageError(
      `The range from ${short(from)} to ${short(headSha)} is ${depth} commits, more than the maximum depth of ${maxDepth}. Pass a closer --from <commit>, or raise the limit with --max-depth <n>.`,
    );
  }
  return { baseRef, baseSha: start, mergeBase: start, headRef, headSha, depth, mode: { kind: "from", rev: from } };
}

/**
 * `git diff` with every option a developer's configuration could change pinned to git's default,
 * so the patches are the same on every machine: rename detection, the inter-hunk context GitHub
 * uses, three lines of context, `a/` and `b/` prefixes, no colour, no external diff or textconv,
 * the default algorithm, and no order file.
 */
const DIFF = [
  "-c",
  "diff.suppressBlankEmpty=false",
  "diff",
  "-M",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--no-relative",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--diff-algorithm=default",
  "--indent-heuristic",
  "-O/dev/null",
];
/** Only for the patch run: both options imply `--patch`, which would append patches to `--raw`. */
const PATCH = ["--inter-hunk-context=1", "-U3"];

export interface PatchSection {
  /** The `diff --git …` line. */
  header: string;
  /** From the first `@@` line to the end of the section, without the final newline: GitHub's shape. */
  patch: string | undefined;
}

/**
 * Splits one `git diff` output into its file sections, in order. A section without an `@@` line
 * (binary, a pure rename, a mode change, an empty new file) has no patch. Inside a section every
 * line starts with a space, `+`, `-`, `\` or `@@`, so a `diff --git ` line always starts one.
 */
export function splitPatches(diff: string): PatchSection[] {
  const sections: PatchSection[] = [];
  const lines = diff.split("\n");
  let current: { header: string; body: string[] } | null = null;
  const close = () => {
    if (!current) return;
    const at = current.body.findIndex((l) => l.startsWith("@@"));
    const patch = at === -1 ? undefined : current.body.slice(at).join("\n").replace(/\n+$/, "");
    sections.push({ header: current.header, patch });
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      close();
      current = { header: line, body: [] };
    } else if (current) current.body.push(line);
  }
  close();
  return sections;
}

const ZERO = /^0+$/;

/**
 * The changed files of `mergeBase → head`, as GitHub's files list has them: the new name as
 * `filename` and the old one as `previous_filename`, the counts (`-` for a binary file becomes 0),
 * the head blob as `sha` (none for a removed file), and the patch when there is one. Sorted by name.
 * `--raw`, `--numstat` and the patches come from three runs of the same command, so their order is
 * the same; each section's header is checked against its name anyway.
 */
export function localFiles(repoDir: string, mergeBase: string, head: string, git: GitRunner = spawnGit): ReviewFile[] {
  const range = [mergeBase, head];
  const raw = run(git, repoDir, [...DIFF, "--raw", "-z", "--no-abbrev", ...range], DIFF_MAX_BYTES).split("\0");
  const numstat = run(git, repoDir, [...DIFF, "--numstat", "-z", ...range], DIFF_MAX_BYTES).split("\0");
  const rawSections = splitPatches(run(git, repoDir, [...DIFF, ...PATCH, ...range], DIFF_MAX_BYTES));

  const entries: { status: string; dstSha: string; from?: string; to: string }[] = [];
  for (let i = 0; i < raw.length; ) {
    const meta = raw[i++];
    if (meta === "") continue;
    const [, , , dstSha, status] = meta.slice(1).split(" ");
    const two = status.startsWith("R") || status.startsWith("C");
    const from = raw[i++];
    entries.push(two ? { status, dstSha, from, to: raw[i++] } : { status, dstSha, to: from });
  }
  // Git emits a deletion and an addition patch for one raw T (type-change) entry.
  // Keep both hunks: each carries its own old/new line origin, including +0,0
  // for the deleted side. Evidence and head-line annotations can then use them unchanged.
  let sectionIndex = 0;
  const sections = entries.map((e) => {
    const parts = rawSections.slice(sectionIndex, sectionIndex + (e.status === "T" ? 2 : 1));
    sectionIndex += e.status === "T" ? 2 : 1;
    for (const part of parts) {
      if (!part.header.includes('"') && !part.header.endsWith(` b/${e.to}`)) {
        throw new Error(`git diff sections are out of order: expected ${e.to}, got "${part.header}".`);
      }
    }
    const patches = parts.flatMap((p) => p.patch === undefined ? [] : [p.patch]);
    return { header: parts[0]?.header ?? "", patch: patches.length ? patches.join("\n") : undefined };
  });
  const counts: { additions: number; deletions: number }[] = [];
  for (let i = 0; i < numstat.length; ) {
    const meta = numstat[i++];
    if (meta === "") continue;
    const [added, deleted, path] = meta.split("\t");
    // A rename or copy has an empty path here, then the old and the new name.
    if (path === "") i += 2;
    const n = (v: string) => (v === "-" ? 0 : Number(v));
    counts.push({ additions: n(added), deletions: n(deleted) });
  }
  if (counts.length !== entries.length || sectionIndex !== rawSections.length || sections.some((s) => !s.header)) {
    throw new Error(
      `git diff disagreed with itself on ${mergeBase.slice(0, 7)}..${head.slice(0, 7)}: ${entries.length} raw entries, ${counts.length} counts, ${rawSections.length} patches.`,
    );
  }
  const files = entries.map((e, i): ReviewFile => {
    const patch = sections[i].patch;
    return {
      filename: e.to,
      ...counts[i],
      ...(patch !== undefined ? { patch } : {}),
      ...(e.status.startsWith("D") || ZERO.test(e.dstSha) ? {} : { sha: e.dstSha }),
      ...(e.status.startsWith("R") && e.from !== undefined ? { previous_filename: e.from } : {}),
    };
  });
  return files.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
}

/** One blob's bytes, or null when `<sha>:<path>` is not a regular file (absent, a folder, a link). */
function blobAt(repoDir: string, sha: string, path: string, git: GitRunner): Buffer | null {
  const entry = git(["ls-tree", "-z", sha, "--", path], { cwd: repoDir, timeoutMs: TIMEOUT_MS });
  if (entry.status !== 0) throw new Error(`git ls-tree ${short(sha)} -- ${path} failed: ${entry.stderr ?? entry.error}`);
  // `<mode> <type> <sha>\t<path>`; only the exact path, as a regular file, counts.
  const [meta, name] = entry.stdout.split("\0")[0].split("\t");
  if (name !== path) return null;
  const [mode, type, blob] = meta.split(" ");
  if (type !== "blob" || (mode !== "100644" && mode !== "100755")) return null;
  const out = spawnSync("git", [...GIT_BASE_ARGS, "cat-file", "blob", blob], {
    cwd: repoDir,
    env: gitEnv(),
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) throw new Error(`git cat-file blob ${blob} failed: ${out.stderr?.toString() ?? out.error}`);
  return out.stdout;
}

/**
 * The instruction files at the merge-base, never at the head (ADR 0006): the same paths, fallback,
 * cut and warnings as `readBaseInstructions` on GitHub.
 */
export function localInstructions(
  repoDir: string,
  mergeBase: string,
  warn: (line: string) => void,
  git: GitRunner = spawnGit,
): BaseInstructions {
  return instructionsFrom(
    mergeBase,
    (path) => {
      const bytes = blobAt(repoDir, mergeBase, path, git);
      return bytes ? instructionFileOf(path, bytes) : null;
    },
    warn,
  );
}

const names = (out: string) => out.split("\0").filter(Boolean);

/**
 * The `tar` that extracts the archive. On Windows that is the system's bsdtar: a GNU `tar` earlier
 * on PATH (Git for Windows ships one) reads `C:\dir\x.tar` as a file on a remote host named `C`.
 */
export function tarCommand(platform: string = process.platform, env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync) {
  if (platform !== "win32") return "tar";
  const root = Object.entries(env).find(([name]) => name.toUpperCase() === "SYSTEMROOT")?.[1];
  if (!root) return "tar";
  const system = join(root, "System32", "tar.exe");
  return exists(system) ? system : "tar";
}

/**
 * Time allowed to each snapshot step (archive, tar, read-tree, ls-files, update-index) for a head of
 * `fileCount` files: the old 60 s floor plus 3 ms per file. `tar -xf` was measured at 9 s for 31.9k
 * files / 660 MB (about 0.3 ms per file) on a loaded laptop; 3 ms per file is 10x that rate, so 31.9k
 * files get about 156 s.
 */
export const snapshotTimeoutMs = (fileCount: number) => 60_000 + fileCount * 3;

/** The error for a snapshot step that ran out of time: which step, on how many files, what to do. */
function snapshotTimeout(step: string, ms: number, fileCount: number) {
  return new Error(
    `Snapshot step "${step}" timed out after ${Math.round(ms / 1000)} s on a head of ${fileCount.toLocaleString("en-US")} files. ` +
      `The machine may be busy or the disk slow; retry when it is less loaded, or free space in the temporary directory (${tmpdir()}).`,
  );
}

/**
 * The committed `head` as a directory: `git archive` extracted with the system `tar`, then an index
 * of its own so `git grep` sees exactly the archived files. The index is not built by hashing the
 * files (`git add -A -f` took ~50 s on 32k files): the snapshot borrows the clone's objects through
 * `objects/info/alternates` (read-only; nothing is written to the clone), `git read-tree <head>`
 * fills the index from the tree, and the index is trimmed to what `tar` extracted (read-tree also
 * lists submodule gitlinks and export-ignore paths). If read-tree fails (a partial clone lacks tree
 * objects) the old `git add -A -f` runs instead: slower, same result. `missing` and `extra` compare
 * the snapshot with `git ls-tree` of the head (export-ignore and submodules make them differ).
 * Steps get `snapshotTimeoutMs` of the head's file count.
 */
export function snapshotHead(repoDir: string, head: string, git: GitRunner = spawnGit): { dir: string; missing: string[]; extra: string[] } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-snapshot-")));
  // Beside the snapshot, not inside it: a file of the same name in the head would collide.
  const tar = `${dir}.tar`;
  try {
    const tree = new Set(names(run(git, repoDir, ["ls-tree", "-r", "-z", "--name-only", head], DIFF_MAX_BYTES)));
    const files = tree.size;
    const limit = snapshotTimeoutMs(files);
    const step = (label: string, cwd: string, args: string[]) => {
      const out = git(args, { cwd, timeoutMs: limit, maxBytes: DIFF_MAX_BYTES });
      if (out.timedOut) throw snapshotTimeout(label, limit, files);
      if (out.status !== 0 || out.error || out.outputCut) {
        const why = out.outputCut ? "output too large" : (out.error ?? out.stderr?.trim() ?? `status ${out.status}`);
        throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${why}`);
      }
      return out.stdout;
    };
    // core.autocrlf=true (the Git for Windows default) and core.eol=native with a `text=auto` attribute
    // would both write CRLF into the archive. The snapshot should hold the committed bytes, so both are
    // switched off for this one command (a file with an explicit `eol=crlf` attribute is still converted).
    step("git archive", repoDir, ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=tar", `--output=${tar}`, head]);
    const untar = spawnSync(tarCommand(), ["-xf", tar], { cwd: dir, encoding: "utf8", timeout: limit });
    if ((untar.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") throw snapshotTimeout("tar -xf", limit, files);
    if (untar.status !== 0) throw new Error(`tar -xf failed: ${untar.stderr || untar.error}`);
    rmSync(tar, { force: true });
    step("git init", dir, ["init", "-q", "--template="]);
    // No clean or smudge filter (LFS, git-crypt) runs on the copy: the index only lists the files.
    mkdirSync(join(dir, ".git", "info"), { recursive: true });
    writeFileSync(join(dir, ".git", "info", "attributes"), "* -filter\n");
    // `--git-path objects` is the common dir's objects for a linked worktree, and may be relative to `repoDir`.
    const objects = resolve(repoDir, run(git, repoDir, ["rev-parse", "--git-path", "objects"]).trim());
    const alternates = join(dir, ".git", "objects", "info", "alternates");
    mkdirSync(dirname(alternates), { recursive: true });
    writeFileSync(alternates, `${objects}\n`);
    const read = git(["read-tree", head], { cwd: dir, timeoutMs: limit });
    if (read.timedOut) throw snapshotTimeout("git read-tree", limit, files);
    if (read.status !== 0 || read.error) {
      // Tree objects missing here (a partial clone): hash the files instead. Never fetch.
      rmSync(alternates, { force: true });
      rmSync(join(dir, ".git", "index"), { force: true });
      rmSync(join(dir, ".git", "index.lock"), { force: true });
      step("git add", dir, ["add", "-A", "-f"]);
    } else {
      trimIndex(dir, git, limit, files);
    }
    const copied = new Set(names(step("git ls-files", dir, ["ls-files", "-z"])));
    // Files on disk that the head does not have (what `git add -A -f` used to add): a directory walk, no hashing.
    for (const f of names(step("git ls-files --others", dir, ["ls-files", "-z", "--others"]))) copied.add(f);
    return {
      dir,
      missing: [...tree].filter((f) => !copied.has(f)),
      extra: [...copied].filter((f) => !tree.has(f)),
    };
  } catch (error) {
    removeSnapshot(dir);
    throw error;
  }
}

/**
 * Drops from the snapshot's index what `tar` did not extract as a file or a symlink: submodule
 * gitlinks (mode 160000), export-ignore paths and anything else not on disk.
 */
function trimIndex(dir: string, git: GitRunner, limit: number, files: number) {
  const listing = git(["ls-files", "-s", "-z"], { cwd: dir, timeoutMs: limit, maxBytes: DIFF_MAX_BYTES });
  if (listing.timedOut) throw snapshotTimeout("git ls-files -s", limit, files);
  if (listing.status !== 0 || listing.error || listing.outputCut) throw new Error(`git ls-files -s failed in ${dir}: ${listing.error ?? listing.stderr?.trim() ?? `status ${listing.status}`}`);
  const drop: string[] = [];
  for (const entry of names(listing.stdout)) {
    // `<mode> <sha> <stage>\t<path>`
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    if (entry.startsWith("160000 ")) {
      drop.push(path);
      continue;
    }
    try {
      const stat = lstatSync(join(dir, path));
      if (!stat.isFile() && !stat.isSymbolicLink()) drop.push(path);
    } catch {
      drop.push(path);
    }
  }
  if (drop.length === 0) return;
  const out = spawnSync("git", [...GIT_BASE_ARGS, "update-index", "--force-remove", "-z", "--stdin"], {
    cwd: dir,
    env: gitEnv(),
    input: `${drop.join("\0")}\0`,
    timeout: limit,
    maxBuffer: DIFF_MAX_BYTES,
  });
  if ((out.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") throw snapshotTimeout("git update-index", limit, files);
  if (out.status !== 0) throw new Error(`git update-index --force-remove failed in ${dir}: ${out.stderr?.toString() || out.error}`);
}

export function removeSnapshot(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${dir}.tar`, { force: true });
}

const listed = (paths: string[]) => `${paths.slice(0, 10).join(", ")}${paths.length > 10 ? `, … and ${paths.length - 10} more` : ""}`;

/** Warns when the snapshot is not the head commit's file list; the run goes on (Q5). */
export function warnSnapshotDifferences(snapshot: { missing: string[]; extra: string[] }, warn: (line: string) => void) {
  if (snapshot.missing.length > 0)
    warn(
      `The snapshot lacks ${snapshot.missing.length} file(s) that the head commit has (export-ignore in .gitattributes, or a submodule): ${listed(snapshot.missing)}`,
    );
  if (snapshot.extra.length > 0)
    warn(`The snapshot has ${snapshot.extra.length} file(s) that the head commit does not: ${listed(snapshot.extra)}`);
}

/** The commits whose subjects describe the change: one for `commit`, the range otherwise (all of `HEAD` from a root). */
function subjectRange(refs: LocalRefs) {
  if (refs.mode?.kind === "commit") return ["-1", refs.headSha];
  return refs.baseRef === EMPTY_TREE_LABEL ? [refs.headSha] : [`${refs.mergeBase}..${refs.headSha}`];
}

/** The change's one sentence (the first line of the prompt and every report's headline). */
function describeRange(refs: LocalRefs, name: string) {
  const start = refs.baseRef === EMPTY_TREE_LABEL ? EMPTY_TREE_LABEL : short(refs.mergeBase);
  if (refs.mode?.kind === "commit") return `commit ${short(refs.headSha)} of ${name} against its ${refs.mode.merge ? "first parent" : "parent"} (${start})`;
  if (refs.mode?.kind === "from") return `branch \`${refs.headRef}\` of ${name} from commit ${short(refs.mode.rev)} (start ${start})`;
  return `branch \`${refs.headRef}\` of ${name} against ${refs.baseRef} (merge-base ${start})`;
}

/**
 * The whole connector: refs, files, scope, instructions, the change's metadata, then the snapshot
 * (last, so a refusal before it leaves nothing to remove). The caller removes `snapshotDir`.
 */
export function buildLocalInput(p: {
  repoDir: string;
  base?: string;
  commit?: string;
  from?: string;
  maxDepth?: number;
  paths: string[];
  log: (line: string) => void;
  warn: (line: string) => void;
  git?: GitRunner;
}): { input: ReviewInput; snapshotDir: string; refs: LocalRefs } {
  const git = p.git ?? spawnGit;
  const refs = resolveRefs(p.repoDir, p.base, git, p.maxDepth, { commit: p.commit, from: p.from });
  const files = localFiles(p.repoDir, refs.mergeBase, refs.headSha, git);
  const { paths, ignored } = resolveScope(
    p.paths,
    files.map((f) => f.filename),
  );
  if (ignored.length > 0) p.log(`Not paths in this change, ignored: ${ignored.join(" ")}`);
  const instructions = localInstructions(p.repoDir, refs.mergeBase, p.warn, git);
  const top = run(git, p.repoDir, ["rev-parse", "--show-toplevel"]).trim();
  const name = basename(top);
  const subjects = run(git, p.repoDir, ["log", "--reverse", "--format=%s", ...subjectRange(refs)]).trim();
  const author = run(git, p.repoDir, ["log", "-1", "--format=%an", refs.headSha]).trim();
  const snapshot = snapshotHead(p.repoDir, refs.headSha, git);
  warnSnapshotDifferences(snapshot, p.warn);
  const input: ReviewInput = {
    format: REVIEW_INPUT_FORMAT,
    change: {
      kind: "branch",
      describe: describeRange(refs, name),
      repository: { name },
      base: { sha: refs.mergeBase, ref: refs.baseRef },
      head: { sha: refs.headSha, ref: refs.headRef },
      title: refs.mode?.kind === "commit" ? subjects.split("\n")[0] : refs.headRef,
      description: subjects,
      ...(author ? { author } : {}),
    },
    files,
    instructions,
    headDir: snapshot.dir,
    scope: paths,
  };
  return { input, snapshotDir: snapshot.dir, refs };
}
