/**
 * A fixture history for the local index and the dashboard: two repositories, four runs, four
 * distinct findings, two verdicts and two loops, written with the same store functions the product uses.
 * Illustrative data, not recorded from a real review. The expected figures are in `EXPECTED`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendVerdict, historyRoot, writeLoopFile, writeRun } from "../../src/history/store";
import { HISTORY_RUN_FORMAT, type HistoryRun } from "../../src/history/types";

export const ALPHA = { key: "alpha-1a2b3c4d", name: "alpha" };
export const BETA = { key: "beta-5e6f7a8b", name: "beta" };

const temps: string[] = [];
export const removeFixtureHomes = () => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
};

const sha = (c: string) => c.repeat(40);

export interface FixtureOptions {
  /** Replaces the name of the second repository, its loop's branch and the title of its finding. */
  hostile?: string;
  /** Adds a PR Confidence grade to the last alpha run. */
  grade?: "A" | "B" | "C" | "A-" | "cannot say";
}

function run(
  repo: { key: string; name: string },
  savedAt: string,
  head: string,
  cost: number,
  findings: { path: string; line: number; title: string; severity: string; topic: string; firstId: string; status?: "new" | "open" }[],
  settled: { firstId: string; path: string; line: number; title: string }[] = [],
  extra: Record<string, unknown> = {},
): HistoryRun {
  return {
    format: HISTORY_RUN_FORMAT,
    savedAt,
    engine: { version: "1.12.0" },
    repository: { key: repo.key, name: repo.name, keyedBy: "remote", remote: `https://github.com/o/${repo.name}`, path: `/work/${repo.name}` },
    result: {
      format: "wachiman.review-result/2",
      change: { head: { sha: head, ref: "feat/x" }, title: "feat/x" },
      provider: { label: "L", model: "claude-opus-5-5", effort: "high", profile: "isolated" },
      execution: { costUsdEstimate: cost, usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
      coverage: { expected: [], reviewed: [], skipped: [] },
      findings: findings.map((f) => ({ path: f.path, line: f.line, title: f.title, severity: f.severity, topic: f.topic, body: "b", anchor: "diff" })),
      ...extra,
    },
    tracking: findings.map((f) => ({ id: f.firstId, status: f.status ?? "new", firstId: f.firstId, firstHead: head, runs: 1, reopened: 0, titleKey: f.firstId })),
    settled: settled.map((s) => ({ ...s, status: "probably-fixed", lastHead: head })),
    unknown: 0,
    unknownIds: [],
  } as unknown as HistoryRun;
}

/**
 * alpha: 2026-11-01 runs of $0.50 and $0.25 (a blocker and a fix, then the blocker settles), 2026-11-02 a
 * run of $1.00 with a consider. beta: 2026-11-02 a run of $0.75 with an info.
 * Verdicts: a1 correct, b1 wrong. Loops: alpha feat/x converged in 2 rounds, beta's branch open after 3.
 */
export const EXPECTED = {
  spendByDay: [
    { day: "2026-11-01", runs: 2, costUsdEstimate: 0.75 },
    { day: "2026-11-02", runs: 2, costUsdEstimate: 1.75 },
  ],
  spendByRepository: [
    { key: ALPHA.key, name: ALPHA.name, runs: 3, costUsdEstimate: 1.75 },
    { key: BETA.key, name: BETA.name, runs: 1, costUsdEstimate: 0.75 },
  ],
  totals: { repositories: 2, runs: 4, costUsdEstimate: 2.5 },
  findings: { total: 4, bySeverity: { blocker: 1, fix: 1, consider: 1, info: 1 }, byVerdict: { correct: 1, partial: 0, wrong: 1, unjudged: 2 } },
  loops: { totals: { branches: 2, rounds: 5, converged: 1, open: 1 } },
};

/** A temporary HOME holding `.wachiman/history`; returns its paths. */
export function fixtureHome(opts: FixtureOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), "wachiman-dash-home-"));
  temps.push(home);
  const wachiman = join(home, ".wachiman");
  const root = historyRoot(wachiman);
  const beta = { ...BETA, name: opts.hostile ?? BETA.name };
  const branch = opts.hostile ?? "fix/y";

  writeRun(root, run(ALPHA, "2026-11-01T10:00:00.000Z", sha("a"), 0.5, [
    { path: "src/a.ts", line: 12, title: "Off-by-one in the loop", severity: "fix", topic: "bug", firstId: "a1a1a1a1a1" },
    { path: "src/b.ts", line: 40, title: "Unchecked cast", severity: "blocker", topic: "security", firstId: "b1b1b1b1b1" },
  ]));
  writeRun(root, run(ALPHA, "2026-11-01T15:00:00.000Z", sha("b"), 0.25, [
    { path: "src/a.ts", line: 12, title: "Off-by-one in the loop", severity: "fix", topic: "bug", firstId: "a1a1a1a1a1", status: "open" },
  ], [{ firstId: "b1b1b1b1b1", path: "src/b.ts", line: 40, title: "Unchecked cast" }]));
  writeRun(root, run(ALPHA, "2026-11-02T08:00:00.000Z", sha("c"), 1.0, [
    { path: "src/c.ts", line: 3, title: "Rebuilds the list twice", severity: "consider", topic: "perf", firstId: "c1c1c1c1c1" },
  ], [], opts.grade ? { fidelity: { grade: opts.grade, claims: [], unexplainedFiles: [], reasons: [], trial: true, judgedAGrades: 0, questions: [], sensitivePaths: [], digest: "d", reviewedCommit: sha("c") } } : {}));
  writeRun(root, run(beta, "2026-11-02T09:00:00.000Z", sha("d"), 0.75, [
    { path: "docs/x.md", line: 1, title: opts.hostile ? `${opts.hostile} typo` : "Typo", severity: "info", topic: "docs", firstId: "d1d1d1d1d1" },
  ]));

  appendVerdict(root, ALPHA.key, { at: "2026-11-02T10:00:00.000Z", firstId: "a1a1a1a1a1", verdict: "correct" });
  appendVerdict(root, ALPHA.key, { at: "2026-11-02T10:01:00.000Z", firstId: "b1b1b1b1b1", verdict: "wrong", reason: "guarded upstream" });

  const loop = (key: string, branchName: string, status: "open" | "converged", heads: string[]) => ({
    format: "wachiman.loop-state/1",
    branch: branchName,
    base: "main",
    status,
    rounds: heads.map((h, i) => ({ round: i + 1, head: sha(h), at: `2026-11-0${i + 1}T12:00:00.000Z` })),
    ledger: [{ id: "a1a1a1a1a1", path: "src/a.ts", line: 12, severity: "fix", topic: "bug", title: "t", status: status === "converged" ? "probably-fixed" : "open", refuted: false }],
  });
  writeLoopFile(root, ALPHA.key, "feat/x", loop(ALPHA.key, "feat/x", "converged", ["a", "b"]));
  writeLoopFile(root, beta.key, branch, loop(beta.key, branch, "open", ["a", "b", "c"]));

  return { home, wachiman, root, index: join(wachiman, "index.sqlite"), env: { HOME: home } };
}
