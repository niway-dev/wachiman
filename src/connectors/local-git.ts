/**
 * The `local-git` connector (spec "The `local-git` connector", ADR 0019 decision 4): the
 * committed change of a branch in a local clone, `merge-base(base, HEAD) → HEAD`, as a
 * `ReviewInput`. It reads the clone with `git` only, never fetches, and never writes to it; the
 * head the agent reads is a snapshot, so later edits of the working tree change nothing.
 *
 * The snapshot is a `git archive` of the head extracted into a temporary directory, with an index
 * of its own (`git init`, `git add -A -f`, no commit): the evidence step runs `git grep` in the
 * head, and in a plain directory that fails (spec correction 1 of the plan).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

export interface LocalRefs {
  baseRef: string;
  baseSha: string;
  mergeBase: string;
  headRef: string;
  headSha: string;
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
 */
export function resolveRefs(repoDir: string, base: string | undefined, git: GitRunner = spawnGit): LocalRefs {
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
  return { baseRef, baseSha, mergeBase: mb.stdout.trim(), headRef, headSha };
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
  const sections = splitPatches(run(git, repoDir, [...DIFF, ...PATCH, ...range], DIFF_MAX_BYTES));

  const entries: { status: string; dstSha: string; from?: string; to: string }[] = [];
  for (let i = 0; i < raw.length; ) {
    const meta = raw[i++];
    if (meta === "") continue;
    const [, , , dstSha, status] = meta.slice(1).split(" ");
    const two = status.startsWith("R") || status.startsWith("C");
    const from = raw[i++];
    entries.push(two ? { status, dstSha, from, to: raw[i++] } : { status, dstSha, to: from });
  }
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
  if (counts.length !== entries.length || sections.length !== entries.length) {
    throw new Error(
      `git diff disagreed with itself on ${mergeBase.slice(0, 7)}..${head.slice(0, 7)}: ${entries.length} raw entries, ${counts.length} counts, ${sections.length} patches.`,
    );
  }
  const files = entries.map((e, i): ReviewFile => {
    const header = sections[i].header;
    // A quoted header (a name with a tab, a newline or a quote) cannot be checked this simply.
    if (!header.includes('"') && !header.endsWith(` b/${e.to}`)) {
      throw new Error(`git diff sections are out of order: expected ${e.to}, got "${header}".`);
    }
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
 * The committed `head` as a directory: `git archive` extracted with the system `tar`, then an
 * index of its own so `git grep` sees exactly the archived files. `missing` and `extra` compare the
 * snapshot with `git ls-tree` of the head (export-ignore and submodules make them differ).
 */
export function snapshotHead(repoDir: string, head: string, git: GitRunner = spawnGit): { dir: string; missing: string[]; extra: string[] } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-snapshot-")));
  // Beside the snapshot, not inside it: a file of the same name in the head would collide.
  const tar = `${dir}.tar`;
  try {
    run(git, repoDir, ["archive", "--format=tar", `--output=${tar}`, head]);
    const untar = spawnSync("tar", ["-xf", tar], { cwd: dir, encoding: "utf8", timeout: TIMEOUT_MS });
    if (untar.status !== 0) throw new Error(`tar -xf failed: ${untar.stderr || untar.error}`);
    rmSync(tar, { force: true });
    run(git, dir, ["init", "-q", "--template="]);
    // No clean or smudge filter (LFS, git-crypt) runs on the copy: the index only lists the files.
    mkdirSync(join(dir, ".git", "info"), { recursive: true });
    writeFileSync(join(dir, ".git", "info", "attributes"), "* -filter\n");
    run(git, dir, ["add", "-A", "-f"]);
    const tree = new Set(names(run(git, repoDir, ["ls-tree", "-r", "-z", "--name-only", head], DIFF_MAX_BYTES)));
    const copied = new Set(names(run(git, dir, ["ls-files", "-z"], DIFF_MAX_BYTES)));
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

/**
 * The whole connector: refs, files, scope, instructions, the change's metadata, then the snapshot
 * (last, so a refusal before it leaves nothing to remove). The caller removes `snapshotDir`.
 */
export function buildLocalInput(p: {
  repoDir: string;
  base?: string;
  paths: string[];
  log: (line: string) => void;
  warn: (line: string) => void;
  git?: GitRunner;
}): { input: ReviewInput; snapshotDir: string; refs: LocalRefs } {
  const git = p.git ?? spawnGit;
  const refs = resolveRefs(p.repoDir, p.base, git);
  const files = localFiles(p.repoDir, refs.mergeBase, refs.headSha, git);
  const { paths, ignored } = resolveScope(
    p.paths,
    files.map((f) => f.filename),
  );
  if (ignored.length > 0) p.log(`Not paths in this change, ignored: ${ignored.join(" ")}`);
  const instructions = localInstructions(p.repoDir, refs.mergeBase, p.warn, git);
  const top = run(git, p.repoDir, ["rev-parse", "--show-toplevel"]).trim();
  const name = basename(top);
  const subjects = run(git, p.repoDir, ["log", "--reverse", "--format=%s", `${refs.mergeBase}..${refs.headSha}`]).trim();
  const author = run(git, p.repoDir, ["log", "-1", "--format=%an", refs.headSha]).trim();
  const snapshot = snapshotHead(p.repoDir, refs.headSha, git);
  warnSnapshotDifferences(snapshot, p.warn);
  const input: ReviewInput = {
    format: REVIEW_INPUT_FORMAT,
    change: {
      kind: "branch",
      describe: `branch \`${refs.headRef}\` of ${name} against ${refs.baseRef} (merge-base ${short(refs.mergeBase)})`,
      repository: { name },
      base: { sha: refs.mergeBase, ref: refs.baseRef },
      head: { sha: refs.headSha, ref: refs.headRef },
      title: refs.headRef,
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
