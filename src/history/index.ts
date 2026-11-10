/**
 * What `local` and the `history` command use of the history (ADR 0020). `review()` and the engine
 * never import this module: GitHub mode has no path to the store.
 */
import { spawnGit, type GitRunner } from "../evidence";
import type { ReviewInput, ReviewResult } from "../engine";
import type { HistoryAnnotation } from "../sinks/common";
import { lineHashOf, readHeadFileLines, stripWhitespace, titleKey } from "./fingerprint";
import { reconcile, replay } from "./match";
import { HISTORY_RUN_FORMAT, prune, readRuns, readVerdicts, repositoryKey, writeRun } from "./store";

export { historyRoot, historySettings } from "./store";

export interface SaveRunParams {
  root: string;
  repoDir: string;
  input: ReviewInput;
  result: ReviewResult;
  engineVersion: string;
  days: number;
  warn: (line: string) => void;
  now?: () => Date;
  git?: GitRunner;
}

/**
 * Compares the finished run with the repository's earlier runs, saves it, prunes old ones and
 * returns what the report should say. Reads the snapshot (`input.headDir`), which must still exist.
 */
export function saveRun(p: SaveRunParams): HistoryAnnotation {
  const now = p.now ?? (() => new Date());
  const git = p.git ?? spawnGit;
  const repository = repositoryKey(p.repoDir, git);
  const runs = readRuns(p.root, repository.key, p.warn);
  const verdicts = readVerdicts(p.root, repository.key);
  const blobOf = (path: string) => p.input.files.find((f) => f.filename === path)?.sha;

  const head = p.result.change.head.sha;
  const ancestors = new Map<string, boolean>();
  const treeHeads = new Set(runs.filter(r => r.result.change.kind === "working-tree").map(r => r.result.change.head.sha));
  // Exit 0 = ancestor (or the same commit); 1 = not; anything else (an unknown commit) cannot be proven.
  const isAncestor = (lastHead: string) => {
    // Fingerprints still match; missing findings on ephemeral trees stay unknown.
    if (p.result.change.kind === "working-tree" || treeHeads.has(lastHead)) return false;
    let known = ancestors.get(lastHead);
    if (known === undefined) {
      known = git(["merge-base", "--is-ancestor", lastHead, head], { cwd: p.repoDir, timeoutMs: 30_000 }).status === 0;
      ancestors.set(lastHead, known);
    }
    return known;
  };

  const out = reconcile({
    isAncestor,
    open: replay(runs, verdicts).findings,
    result: p.result,
    files: p.input.files,
    key: repository.key,
    fingerprint: (f) => {
      const line = lineHashOf(p.input.headDir, f.path, f.line);
      return { titleKey: titleKey(f.title), lineHash: line?.hash, lineText: line?.text, blobSha: blobOf(f.path) };
    },
    // The cited line is gone from the file; without a line hash (line 0, a short or repeated
    // line) the file's blob is all there is to compare, so any edit counts.
    regionChanged: (path, t) => {
      if (t.lineText !== undefined) {
        const lines = readHeadFileLines(p.input.headDir, path);
        return !lines || !lines.some((l) => stripWhitespace(l) === t.lineText);
      }
      const blob = blobOf(path);
      return blob === undefined || t.blobSha === undefined || blob !== t.blobSha;
    },
  });

  const savedAt = now().toISOString();
  writeRun(p.root, {
    format: HISTORY_RUN_FORMAT,
    savedAt,
    engine: { version: p.engineVersion },
    repository,
    result: p.result,
    tracking: out.tracking,
    settled: out.settled,
    unknown: out.unknown,
    unknownIds: out.unknownIds,
  });
  // The run is already saved: a pruning failure must not turn it into "not saved" or drop the annotation.
  try {
    prune(p.root, repository.key, p.days, now);
  } catch (error) {
    p.warn(`history: old runs could not be pruned (${error instanceof Error ? error.message : error})`);
  }

  const last = runs.at(-1);
  return {
    byIndex: new Map(
      out.tracking.map((t, i) => [
        i,
        { status: t.status, firstHead: t.firstHead, runs: t.runs, id: t.firstId, verdict: verdicts.get(t.firstId)?.verdict },
      ]),
    ),
    settled: out.settled,
    unknown: out.unknown,
    lastRun: last ? { head: last.result.change.head.sha, savedAt: last.savedAt } : undefined,
  };
}
