/**
 * A sibling's files at one commit, as a plain directory (ADR 0043, spec "How a run picks its
 * siblings" step 5). The review reads this directory, never the sibling's clone: untracked files,
 * `.git`, uncommitted edits and anything outside the chosen globs are not in it. Symbolic links
 * are dropped and listed, because a link could point out of the tree; submodules are dropped.
 * Nothing is fetched.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tarCommand, snapshotTimeoutMs } from "../connectors/local-git";
import { spawnGit, type GitRunner } from "../evidence";

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
/** A command line this long is safe on every platform that runs Wachiman (Windows allows about 32 KB). */
const ARGS_BUDGET = 24_000;

interface TreeEntry {
  mode: string;
  path: string;
}

function treeOf(git: GitRunner, repoDir: string, sha: string): TreeEntry[] {
  const out = git(["ls-tree", "-r", "-z", "--full-tree", sha], { cwd: repoDir, timeoutMs: 60_000, maxBytes: MAX_BYTES });
  if (out.status !== 0 || out.error || out.outputCut) throw new Error(`git ls-tree ${sha} failed in ${repoDir}: ${out.error ?? out.stderr?.trim() ?? `status ${out.status}`}`);
  const entries: TreeEntry[] = [];
  for (const record of out.stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    entries.push({ mode: record.slice(0, record.indexOf(" ")), path: record.slice(tab + 1) });
  }
  return entries;
}

/** Splits `paths` into groups whose total length fits one command line. */
function chunks(paths: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const path of paths) {
    if (current.length > 0 && size + path.length + 1 > ARGS_BUDGET) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(path);
    size += path.length + 1;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Extracts the tracked files of `sha` in the clone at `memberDir` that `globs` select into a fresh
 * temporary directory. `sha` must be a full commit id (the version rules return one). An empty
 * selection gives an empty directory and no paths. Throws when the commit cannot be read.
 */
export function snapshotSibling(memberDir: string, sha: string, globs: string[], git: GitRunner = spawnGit): SiblingSnapshot {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new Error(`A sibling snapshot needs a full commit id, got "${sha}".`);
  const matchers = globs.map((g) => new Bun.Glob(g));
  const selected: string[] = [];
  const droppedSymlinks: string[] = [];
  const droppedSubmodules: string[] = [];
  for (const { mode, path } of treeOf(git, memberDir, sha)) {
    if (!matchers.some((m) => m.match(path))) continue;
    if (mode === "120000") droppedSymlinks.push(path);
    else if (mode === "160000") droppedSubmodules.push(path);
    else selected.push(path);
  }

  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-sibling-")));
  const tar = `${dir}.tar`;
  const remove = () => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(tar, { force: true });
  };
  try {
    const limit = snapshotTimeoutMs(selected.length);
    for (const group of chunks(selected)) {
      // Literal pathspecs: a file named `*.ts` or `:(top)x` is a name, not a pattern. CRLF conversion is off so the bytes are the committed ones.
      const archive = git(["--literal-pathspecs", "-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=tar", `--output=${tar}`, sha, "--", ...group], {
        cwd: memberDir,
        timeoutMs: limit,
        maxBytes: MAX_BYTES,
      });
      if (archive.status !== 0 || archive.error) throw new Error(`git archive ${sha} failed in ${memberDir}: ${archive.error ?? archive.stderr?.trim() ?? `status ${archive.status}`}`);
      const untar = spawnSync(tarCommand(), ["-xf", tar], { cwd: dir, encoding: "utf8", timeout: limit });
      if (untar.error || untar.status !== 0) throw new Error(`tar -xf failed for the snapshot of ${sha}: ${untar.error?.message ?? untar.stderr}`);
      rmSync(tar, { force: true });
    }
  } catch (error) {
    remove();
    throw error;
  }
  // `export-ignore` in the sibling's .gitattributes can leave a selected path out of the archive.
  const present = selected.filter((p) => {
    try {
      lstatSync(join(dir, p));
      return true;
    } catch {
      return false;
    }
  });
  return { dir, paths: present, droppedSymlinks, droppedSubmodules, remove };
}
