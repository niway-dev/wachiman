/**
 * Files the repository itself marks as not worth a review: `linguist-generated` or
 * `linguist-vendored` set in `.gitattributes`. The marks are read from the base commit, never from
 * the head, for the same reason the path rules are (ADR 0058): a change must not be able to mark
 * its own files as generated and so remove them from its own review.
 *
 * One `git check-attr --source=<base>` process answers for every changed path of a run. `--source`
 * needs git 2.40; on an older git, or when the base commit is not in the clone, nothing is
 * excluded and one line says so. This never fails a run.
 */
import { spawnSync } from "node:child_process";
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

export interface LinguistOptions {
  repoDir: string;
  baseSha: string;
  /** Fetch the base commit when a shallow clone (a CI checkout) lacks it. Local runs never fetch. */
  fetchMissingBase?: boolean;
  log: (line: string) => void;
}

/**
 * The token of the run, as a one-off git config in the environment (never in argv, never written to
 * the checkout), for the fetch of a base commit a credential-less shallow checkout lacks.
 */
function fetchEnv(): Record<string, string> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return gitEnv();
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return { ...gitEnv(), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
}

const git = (repoDir: string, args: string[], input?: string, env: Record<string, string> = gitEnv()) =>
  spawnSync("git", [...GIT_BASE_ARGS, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    input,
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BYTES,
    env,
  });

/** Of `paths`, those the base commit's `.gitattributes` marks `linguist-generated` or `linguist-vendored`. */
export function linguistExcluded(paths: readonly string[], o: LinguistOptions): Set<string> {
  const none = new Set<string>();
  if (paths.length === 0) return none;
  try {
    const version = git(o.repoDir, ["--version"]);
    if (version.status !== 0 || !gitSupportsAttrSource(version.stdout)) {
      o.log(`linguist-generated and linguist-vendored are not applied: this git (${version.stdout.trim() || "unknown version"}) has no check-attr --source (2.40 or newer).`);
      return none;
    }
    // Changed paths are relative to the repository root, and check-attr reads them relative to its cwd.
    const top = git(o.repoDir, ["rev-parse", "--show-toplevel"]);
    const cwd = top.status === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : o.repoDir;
    // A range that starts at a root commit has the empty tree as its base: a tree, with no marks.
    if (git(cwd, ["cat-file", "-t", o.baseSha]).stdout.trim() === "tree") return none;
    // `cat-file -t`, not `-e <sha>^{commit}`: a probe in that shape is how callers recognise a stored commit check.
    const has = () => git(cwd, ["cat-file", "-t", o.baseSha]).stdout.trim() === "commit";
    const shallow = () => git(cwd, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
    let fetchNote = "";
    if (!has() && o.fetchMissingBase && shallow()) {
      const fetched = git(cwd, ["fetch", "--no-tags", "--depth=1", "origin", o.baseSha], undefined, fetchEnv());
      if (fetched.status !== 0) fetchNote = ` (fetching it failed: ${fetched.stderr.trim().slice(0, 200)})`;
    }
    if (!has()) {
      o.log(`linguist-generated and linguist-vendored are not applied: the base commit ${o.baseSha.slice(0, 7)} is not in the clone${fetchNote}.`);
      return none;
    }
    const run = git(cwd, ["check-attr", `--source=${o.baseSha}`, "--stdin", "-z", "linguist-generated", "linguist-vendored"], paths.join("\0") + "\0");
    if (run.status !== 0) {
      o.log(`linguist-generated and linguist-vendored are not applied: git check-attr failed (${run.stderr.trim().slice(0, 200)}).`);
      return none;
    }
    const marked = parseCheckAttr(run.stdout);
    if (marked.size > 0) o.log(`${marked.size} file(s) are marked linguist-generated or linguist-vendored at the base commit and are not reviewed.`);
    return marked;
  } catch (error) {
    o.log(`linguist-generated and linguist-vendored are not applied: ${String(error).slice(0, 200)}.`);
    return none;
  }
}
