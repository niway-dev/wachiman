/**
 * What the dashboard shows, read from the index with plain queries. Everything here is a figure the
 * run files record; a figure they do not record is marked `not recorded` rather than guessed.
 */
import { Database } from "bun:sqlite";
import { GRADES, type Grade } from "../fidelity/types";
import { VERDICT_WORDS } from "../history/types";

export const SEVERITY_ORDER = ["blocker", "fix", "consider", "info"] as const;
export const LOOP_STATUSES = ["new", "open", "probably-fixed", "not-repeated", "unknown"] as const;
const NOT_RECORDED = "not recorded";

export interface SpendDay {
  day: string;
  runs: number;
  costUsdEstimate: number;
}
export interface SpendRepository {
  key: string;
  name: string;
  runs: number;
  costUsdEstimate: number;
}
export interface LoopBranch {
  repositoryKey: string;
  repository: string;
  branch: string;
  base: string;
  outcome: "open" | "converged";
  /** The loop state keeps only open or converged; why a loop stopped is printed by `loop` and never saved. */
  exitReason: typeof NOT_RECORDED;
  rounds: number;
  firstRoundAt?: string;
  lastRoundAt?: string;
  ledger: { total: number; byStatus: Record<(typeof LOOP_STATUSES)[number], number> };
}

export type PrConfidence =
  | { status: typeof NOT_RECORDED; note: string }
  | { status: "recorded"; gradedRuns: number; byGrade: Record<Grade, number> };

export interface Figures {
  totals: { repositories: number; runs: number; costUsdEstimate: number };
  spend: { byDay: SpendDay[]; byRepository: SpendRepository[] };
  findings: {
    total: number;
    bySeverity: Record<(typeof SEVERITY_ORDER)[number], number>;
    byVerdict: Record<"correct" | "partial" | "wrong" | "unjudged", number>;
  };
  loops: {
    branches: LoopBranch[];
    totals: { branches: number; rounds: number; converged: number; open: number };
  };
  prConfidence: PrConfidence;
}

/** Dollars are summed as floating point; six decimals hide the noise and lose no cent. */
const money = (n: number) => Math.round(n * 1e6) / 1e6;

export function readFigures(indexPath: string): Figures {
  const db = new Database(indexPath, { readonly: true });
  try {
    const all = <T>(sql: string, ...params: string[]) => db.query(sql).all(...params) as T[];

    const totals = db.query("SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost FROM runs").get() as { runs: number; cost: number };
    const repositories = (db.query("SELECT COUNT(*) AS n FROM repositories").get() as { n: number }).n;

    const byDay = all<{ day: string; runs: number; cost: number }>("SELECT day, COUNT(*) AS runs, SUM(cost_usd) AS cost FROM runs GROUP BY day ORDER BY day").map(
      (r): SpendDay => ({ day: r.day, runs: r.runs, costUsdEstimate: money(r.cost) }),
    );
    const byRepository = all<{ key: string; name: string; runs: number; cost: number }>(
      `SELECT r.key AS key, r.name AS name, COUNT(u.repo_key) AS runs, COALESCE(SUM(u.cost_usd), 0) AS cost
       FROM repositories r LEFT JOIN runs u ON u.repo_key = r.key GROUP BY r.key ORDER BY cost DESC, r.key`,
    ).map((r): SpendRepository => ({ key: r.key, name: r.name, runs: r.runs, costUsdEstimate: money(r.cost) }));

    const bySeverity = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Figures["findings"]["bySeverity"];
    for (const r of all<{ severity: string; n: number }>("SELECT severity, COUNT(*) AS n FROM findings GROUP BY severity")) {
      if (r.severity in bySeverity) bySeverity[r.severity as keyof typeof bySeverity] = r.n;
    }
    const byVerdict = { correct: 0, partial: 0, wrong: 0, unjudged: 0 };
    for (const r of all<{ verdict: string | null; n: number }>("SELECT verdict, COUNT(*) AS n FROM findings GROUP BY verdict")) {
      const word = r.verdict ?? "unjudged";
      if (word === "unjudged" || (VERDICT_WORDS as readonly string[]).includes(word)) byVerdict[word as keyof typeof byVerdict] = r.n;
    }
    const findingsTotal = (db.query("SELECT COUNT(*) AS n FROM findings").get() as { n: number }).n;

    const ledgerRows = all<{ repo_key: string; branch: string; status: string; count: number }>("SELECT repo_key, branch, status, count FROM loop_ledger");
    const branches = all<{
      repo_key: string;
      name: string;
      branch: string;
      base: string;
      outcome: "open" | "converged";
      rounds: number;
      first_round_at: string | null;
      last_round_at: string | null;
    }>(
      `SELECT l.repo_key, COALESCE(r.name, l.repo_key) AS name, l.branch, l.base, l.outcome, l.rounds, l.first_round_at, l.last_round_at
       FROM loops l LEFT JOIN repositories r ON r.key = l.repo_key ORDER BY l.repo_key, l.branch`,
    ).map((l): LoopBranch => {
      const byStatus = Object.fromEntries(LOOP_STATUSES.map((s) => [s, 0])) as LoopBranch["ledger"]["byStatus"];
      let total = 0;
      for (const e of ledgerRows) {
        if (e.repo_key !== l.repo_key || e.branch !== l.branch) continue;
        total += e.count;
        if (e.status in byStatus) byStatus[e.status as keyof typeof byStatus] += e.count;
      }
      return {
        repositoryKey: l.repo_key,
        repository: l.name,
        branch: l.branch,
        base: l.base,
        outcome: l.outcome,
        exitReason: NOT_RECORDED,
        rounds: l.rounds,
        ...(l.first_round_at ? { firstRoundAt: l.first_round_at } : {}),
        ...(l.last_round_at ? { lastRoundAt: l.last_round_at } : {}),
        ledger: { total, byStatus },
      };
    });

    const grades = all<{ grade: string; n: number }>("SELECT grade, COUNT(*) AS n FROM runs WHERE grade IS NOT NULL GROUP BY grade");
    let prConfidence: PrConfidence;
    if (grades.length === 0) {
      prConfidence = {
        status: NOT_RECORDED,
        note: "not recorded: only GitHub pull request reviews compute a grade, and they do not write the local review history, so no run file here carries one.",
      };
    } else {
      const byGrade = Object.fromEntries(GRADES.map((g) => [g, 0])) as Record<Grade, number>;
      for (const g of grades) byGrade[g.grade as Grade] = g.n;
      prConfidence = { status: "recorded", gradedRuns: grades.reduce((n, g) => n + g.n, 0), byGrade };
    }

    return {
      totals: { repositories, runs: totals.runs, costUsdEstimate: money(totals.cost) },
      spend: { byDay, byRepository },
      findings: { total: findingsTotal, bySeverity, byVerdict },
      loops: {
        branches,
        totals: {
          branches: branches.length,
          rounds: branches.reduce((n, b) => n + b.rounds, 0),
          converged: branches.filter((b) => b.outcome === "converged").length,
          open: branches.filter((b) => b.outcome === "open").length,
        },
      },
      prConfidence,
    };
  } finally {
    db.close();
  }
}
