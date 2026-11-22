/**
 * `.git-blame-ignore-revs` as the marker of formatting commits (ADR 0063). Repositories already
 * list their formatter commits there for `git blame --ignore-revs-file` and for GitHub's blame
 * view. A file whose every commit in the review range is listed is reviewed by the cheaper
 * `format_model`; a file also touched by an unlisted commit is reviewed as today.
 *
 * Everything here is pure: the connectors read the file and the range's commits (the GitHub API in
 * a pull request run, one `git log` in a local run) and hand the results to these functions. Nothing
 * in the file is ever an error: a line that is not a hash, a hash outside the range and an
 * ambiguous abbreviation are each skipped, which sends the file to the main model.
 */

/** The only file the engine reads for this; `blame.ignoreRevsFile` from git config is not read. */
export const IGNORE_REVS_PATH = ".git-blame-ignore-revs";

/** An abbreviation shorter than this is not matched: it names too many commits to mean one. */
const MIN_ABBREV = 7;

/** The commits one commit of the range changed, as the paths it touched (the new name of a rename). */
export interface CommitTouch {
  sha: string;
  paths: string[];
}

/**
 * The hashes in the file's text, lowercased, in file order. A `#` starts a comment, also after a
 * hash, as git reads it. A line that is not 7 to 40 hex characters is skipped.
 */
export function parseIgnoreRevs(text: string): string[] {
  const hashes: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim().toLowerCase();
    if (line.length >= MIN_ABBREV && line.length <= 40 && /^[0-9a-f]+$/.test(line)) hashes.push(line);
  }
  return hashes;
}

/**
 * The commits of `range` (full hashes) that the file lists. A full hash must be in the range; an
 * abbreviation is resolved against it, and one that matches two commits of the range is not
 * guessed at. A hash outside the range names a commit this review does not cover and is ignored.
 */
export function listedCommitsIn(hashes: readonly string[], range: readonly string[]): Set<string> {
  const listed = new Set<string>();
  const lowered = range.map((sha) => sha.toLowerCase());
  for (const hash of new Set(hashes)) {
    const matches = lowered.filter((sha) => sha.startsWith(hash));
    if (matches.length === 1) listed.add(matches[0]);
  }
  return listed;
}

/**
 * The paths of `files` that go to the cheaper model: at least one commit of the range touches the
 * path and every commit that touches it is in `listed` (full hashes, from `listedCommitsIn`). A path
 * no commit is seen touching, which a merge or a truncated log can leave, is never format-only.
 */
export function formatOnlyPaths(files: readonly string[], touches: readonly CommitTouch[], listed: ReadonlySet<string>): string[] {
  const touched = new Map<string, { listed: boolean; unlisted: boolean }>();
  for (const { sha, paths } of touches) {
    const isListed = listed.has(sha.toLowerCase());
    for (const path of paths) {
      const seen = touched.get(path) ?? { listed: false, unlisted: false };
      if (isListed) seen.listed = true;
      else seen.unlisted = true;
      touched.set(path, seen);
    }
  }
  return files.filter((path) => {
    const seen = touched.get(path);
    return seen !== undefined && seen.listed && !seen.unlisted;
  });
}
