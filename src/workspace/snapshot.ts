/**
 * A sibling's files at one commit, as a plain directory (ADR 0043, spec "How a run picks its
 * siblings" step 5). The review reads this directory, never the sibling's clone: untracked files,
 * `.git`, uncommitted edits and anything outside the chosen globs are not in it. Symbolic links
 * are dropped and listed, because a link could point out of the tree; submodules are dropped.
 * Each file is the blob stored in the commit, written by Wachiman: `git archive` is not used,
 * because it applies `export-ignore` and `export-subst` from attributes the sibling controls.
 * Nothing is fetched.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { snapshotTimeoutMs } from "../connectors/local-git";
import { GIT_BASE_ARGS, type GitRunner } from "../evidence";
import { isMissingObject, MISSING_OBJECT_MESSAGE, workspaceGit, workspaceGitEnv } from "./git";

export interface SiblingSnapshot {
  /** A fresh temporary directory with no `.git`. */
  dir: string;
  /** The tracked paths that were extracted, relative to `dir`. */
  paths: string[];
  /** Paths the globs selected that are symbolic links; not extracted. */
  droppedSymlinks: string[];
  /** Paths the globs selected that are submodules; not extracted. */
  droppedSubmodules: string[];
  /** Deletes `dir`. */
  remove(): void;
}

const MAX_BYTES = 512 * 1024 * 1024;

interface TreeEntry {
  mode: string;
  oid: string;
  path: string;
}

function treeOf(git: GitRunner, repoDir: string, sha: string): TreeEntry[] {
  const out = git(["ls-tree", "-r", "-z", "--full-tree", sha], { cwd: repoDir, timeoutMs: 60_000, maxBytes: MAX_BYTES });
  if (out.status !== 0 || out.error || out.outputCut)
    throw new Error(`git ls-tree ${sha} failed in ${repoDir}: ${out.error ?? out.stderr?.trim() ?? `status ${out.status}`}`);
  const entries: TreeEntry[] = [];
  for (const record of out.stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, , oid] = record.slice(0, tab).split(" ");
    entries.push({ mode: mode ?? "", oid: oid ?? "", path: record.slice(tab + 1) });
  }
  return entries;
}

/** Defensive: a tree entry that could write outside the snapshot directory is refused. */
function assertInside(path: string) {
  if (isAbsolute(path) || /^([\\/]|[A-Za-z]:)/.test(path) || path.split(/[\\/]/).includes(".."))
    throw new Error(`Refusing the tree entry "${path}": it is absolute or has a ".." segment.`);
}

/** The contents of each blob, by id, from one `git cat-file --batch`; throws when one is absent locally. */
function readBlobs(memberDir: string, oids: string[], timeoutMs: number): Buffer[] {
  if (oids.length === 0) return [];
  const run = spawnSync("git", [...GIT_BASE_ARGS, "cat-file", "--batch"], {
    cwd: memberDir,
    input: `${oids.join("\n")}\n`,
    timeout: Math.max(1, Math.floor(timeoutMs)),
    maxBuffer: MAX_BYTES,
    env: workspaceGitEnv(),
  });
  const stderr = run.stderr?.toString("utf8") ?? "";
  if (run.error || run.status !== 0) {
    if (isMissingObject(stderr)) throw new Error(`${MISSING_OBJECT_MESSAGE}: a blob is absent in ${memberDir}.`);
    throw new Error(`git cat-file --batch failed in ${memberDir}: ${run.error?.message ?? (stderr.trim() || `status ${run.status}`)}`);
  }
  const out = run.stdout;
  const blobs: Buffer[] = [];
  let at = 0;
  for (const oid of oids) {
    const eol = out.indexOf(10, at);
    if (eol < 0) throw new Error(`git cat-file --batch answered too little in ${memberDir}.`);
    const header = out.toString("utf8", at, eol).split(" ");
    if (header[1] === "missing") throw new Error(`${MISSING_OBJECT_MESSAGE}: blob ${oid} is absent in ${memberDir}.`);
    const size = Number(header[2]);
    if (header[0] !== oid || header[1] !== "blob" || !Number.isInteger(size))
      throw new Error(`git cat-file --batch gave "${header.join(" ")}" for ${oid} in ${memberDir}.`);
    blobs.push(out.subarray(eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
  return blobs;
}

/**
 * Writes the tracked files of `sha` in the clone at `memberDir` that `globs` select into a fresh
 * temporary directory, as the bytes of the committed blobs. `sha` must be a full commit id (the
 * version rules return one). An empty selection gives an empty directory and no paths. Throws when
 * the commit cannot be read, or a blob is not present locally.
 */
export function snapshotSibling(memberDir: string, sha: string, globs: string[], git: GitRunner = workspaceGit): SiblingSnapshot {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new Error(`A sibling snapshot needs a full commit id, got "${sha}".`);
  const matchers = globs.map((g) => new Bun.Glob(g));
  const selected: TreeEntry[] = [];
  const droppedSymlinks: string[] = [];
  const droppedSubmodules: string[] = [];
  for (const entry of treeOf(git, memberDir, sha)) {
    if (!matchers.some((m) => m.match(entry.path))) continue;
    if (entry.mode === "120000") droppedSymlinks.push(entry.path);
    else if (entry.mode === "160000") droppedSubmodules.push(entry.path);
    else if (entry.mode === "100644" || entry.mode === "100755") {
      assertInside(entry.path);
      selected.push(entry);
    }
  }

  const blobs = readBlobs(
    memberDir,
    selected.map((e) => e.oid),
    snapshotTimeoutMs(selected.length),
  );
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-sibling-")));
  const remove = () => rmSync(dir, { recursive: true, force: true });
  try {
    selected.forEach((entry, i) => {
      const target = join(dir, entry.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, blobs[i]!);
      chmodSync(target, entry.mode === "100755" ? 0o755 : 0o644);
    });
  } catch (error) {
    remove();
    throw error;
  }
  return { dir, paths: selected.map((e) => e.path), droppedSymlinks, droppedSubmodules, remove };
}
