/**
 * Files the repository itself marks as not worth a review: `linguist-generated` or
 * `linguist-vendored` set in `.gitattributes`. The marks are read from the base commit, never from
 * the head, for the same reason the path rules are (ADR 0058): a change must not be able to mark
 * its own files as generated and so remove them from its own review.
 *
 * One `git check-attr --source=<base>` process answers for every changed path of a run. `--source`
 * needs git 2.40; on an older git nothing is excluded and one line says so. When the base commit is
 * not in the clone (a shallow CI checkout), the caller hands over the base's `.gitattributes` files,
 * read through the GitHub API, and one `check-attr` runs in a throwaway repository that holds only
 * them. No git ever fetches, so no token ever reaches a git process. This never fails a run.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GIT_BASE_ARGS, gitEnv } from "./evidence";

const TIMEOUT_MS = 60_000;
const MAX_BYTES = 64 * 1024 * 1024;

/** `git check-attr --source` arrived in git 2.40. */
export function gitSupportsAttrSource(version: string): boolean {
  const m = /git version (\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 2 || (major === 2 && minor >= 40);
}

/** A `check-attr` value that turns the attribute on: `set` (bare) or `true`. */
const isOn = (value: string) => value === "set" || value === "true";

/** Parses `check-attr -z` output (path, attribute, value triples) into the paths with a mark on. */
export function parseCheckAttr(stdout: string): Set<string> {
  const parts = stdout.split("\0");
  const marked = new Set<string>();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (isOn(parts[i + 2])) marked.add(parts[i]);
  }
  return marked;
}

export interface AttributeFile {
  path: string;
  content: string;
}

export interface LinguistOptions {
  repoDir: string;
  baseSha: string;
  /**
   * The base commit's `.gitattributes` files (repository-relative path and content), for when the
   * clone lacks the base commit. Called at most once; it may throw, which fails open. Local runs omit it.
   */
  readBaseAttributes?: () => AttributeFile[];
  log: (line: string) => void;
}

const git = (repoDir: string, args: string[], input?: string) =>
  spawnSync("git", [...GIT_BASE_ARGS, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    input,
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BYTES,
    env: gitEnv(),
  });

/** Why a git call failed: its stderr, else the spawn error or signal (a timeout leaves stderr empty), else the exit status. */
function failureReason(r: ReturnType<typeof git>): string {
  const why = r.stderr.trim() || r.error?.message || (r.signal ? `killed by ${r.signal}` : `exit status ${r.status}`);
  return why.slice(0, 200);
}

const NOT_APPLIED = "linguist-generated and linguist-vendored are not applied";

/** The marks of `paths` according to attribute files alone, in a throwaway repository. Null when git failed. */
function markedByFiles(files: AttributeFile[], paths: readonly string[], log: (line: string) => void): Set<string> | null {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-attrs-"));
  try {
    const init = git(dir, ["init", "-q"]);
    if (init.status !== 0) {
      log(`${NOT_APPLIED}: git init failed (${failureReason(init)}).`);
      return null;
    }
    for (const f of files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    // Nothing but the base's own files: no user or system attributes file.
    const run = spawnSync("git", [...GIT_BASE_ARGS, "-c", "core.attributesFile=/dev/null", "check-attr", "--stdin", "-z", "linguist-generated", "linguist-vendored"], {
      cwd: dir,
      encoding: "utf8",
      input: paths.join("\0") + "\0",
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BYTES,
      env: { ...gitEnv(), GIT_ATTR_NOSYSTEM: "1" },
    });
    if (run.status !== 0) {
      log(`${NOT_APPLIED}: git check-attr failed (${failureReason(run)}).`);
      return null;
    }
    return parseCheckAttr(run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Of `paths`, those the base commit's `.gitattributes` marks `linguist-generated` or `linguist-vendored`. */
export function linguistExcluded(paths: readonly string[], o: LinguistOptions): Set<string> {
  const none = new Set<string>();
  if (paths.length === 0) return none;
  const report = (marked: Set<string>) => {
    if (marked.size > 0) o.log(`${marked.size} file(s) are marked linguist-generated or linguist-vendored at the base commit and are not reviewed.`);
    return marked;
  };
  try {
    // Changed paths are relative to the repository root, and check-attr reads them relative to its cwd.
    const top = git(o.repoDir, ["rev-parse", "--show-toplevel"]);
    const cwd = top.status === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : o.repoDir;
    // A range that starts at a root commit has the empty tree as its base: a tree, with no marks.
    const type = git(cwd, ["cat-file", "-t", o.baseSha]).stdout.trim();
    if (type === "tree") return none;
    if (type !== "commit") {
      if (!o.readBaseAttributes) {
        o.log(`${NOT_APPLIED}: the base commit ${o.baseSha.slice(0, 7)} is not in the clone.`);
        return none;
      }
      const marked = markedByFiles(o.readBaseAttributes(), paths, o.log);
      return marked ? report(marked) : none;
    }
    const version = git(o.repoDir, ["--version"]);
    if (version.status !== 0 || !gitSupportsAttrSource(version.stdout)) {
      o.log(`${NOT_APPLIED}: this git (${version.stdout.trim() || "unknown version"}) has no check-attr --source (2.40 or newer).`);
      return none;
    }
    const run = git(cwd, ["check-attr", `--source=${o.baseSha}`, "--stdin", "-z", "linguist-generated", "linguist-vendored"], paths.join("\0") + "\0");
    if (run.status !== 0) {
      o.log(`${NOT_APPLIED}: git check-attr failed (${failureReason(run)}).`);
      return none;
    }
    return report(parseCheckAttr(run.stdout));
  } catch (error) {
    o.log(`${NOT_APPLIED}: ${String(error).slice(0, 200)}.`);
    return none;
  }
}
