/**
 * Spend rows read from the index: laptop runs and downloaded ledger entries in the one row shape
 * of `src/spend/report.ts` (ADR 0039). A plain reader; the report itself is a pure function.
 */
import { Database } from "bun:sqlite";
import { weekStart, type Limits, type Range, type SpendCall, type SpendRow } from "../spend/report";

export interface IndexedSpend {
  rows: SpendRow[];
  /** The days the last pull covered, merged over accounts; null when nothing was ever pulled. */
  actions: Range | null;
  limits: Limits | null;
  pulledAt: string | null;
}

export function readSpendRows(indexPath: string): IndexedSpend {
  const db = new Database(indexPath, { readonly: true });
  try {
    const rows: SpendRow[] = [];
    const laptop = db
      .query(
        `SELECT u.repo_key AS key, COALESCE(r.name, u.repo_key) AS name, u.saved_at, u.day, u.head_sha, u.model, u.effort, u.profile, u.cost_usd
         FROM runs u LEFT JOIN repositories r ON r.key = u.repo_key ORDER BY u.saved_at`,
      )
      .all() as { key: string; name: string; saved_at: string; day: string; head_sha: string; model: string; effort: string; profile: string; cost_usd: number }[];
    for (const r of laptop) {
      rows.push({
        source: "laptop",
        state: "settled",
        day: r.day,
        week: weekStart(r.day),
        repositoryKey: r.key,
        repository: r.name,
        pr: null,
        runId: `${r.key}@${r.saved_at}`,
        profile: r.profile,
        costUsd: r.cost_usd,
        reservedUsd: 0,
        // A local run is on the signed-in Claude Code: an API-equivalent estimate, not a bill (ADR 0019).
        calls: [{ model: r.effort ? `${r.model} (${r.effort})` : r.model, auth: "subscription", costUsd: r.cost_usd, costKnown: true }],
      });
    }

    const calls = new Map<string, SpendCall[]>();
    for (const c of db.query("SELECT account, entry_id, model, auth, cost_usd, cost_known FROM ledger_calls ORDER BY rowid").all() as {
      account: string;
      entry_id: string;
      model: string;
      auth: string;
      cost_usd: number;
      cost_known: number;
    }[]) {
      const k = `${c.account}\n${c.entry_id}`;
      calls.set(k, [...(calls.get(k) ?? []), { model: c.model, auth: c.auth, costUsd: c.cost_usd, costKnown: c.cost_known === 1 }]);
    }
    for (const e of db.query("SELECT account, id, day, week, repository, pr, run_id, state, reserved_usd, settled_usd FROM ledger_entries ORDER BY day, id").all() as {
      account: string;
      id: string;
      day: string;
      week: string;
      repository: string;
      pr: number | null;
      run_id: string | null;
      state: "reserved" | "settled" | "unsettled" | "unreserved";
      reserved_usd: number;
      settled_usd: number | null;
    }[]) {
      const finished = e.state === "settled" || e.state === "unreserved";
      rows.push({
        source: "actions",
        state: e.state,
        day: e.day,
        week: e.week,
        repositoryKey: e.repository,
        repository: e.repository,
        pr: e.pr,
        runId: e.run_id ?? e.id,
        profile: "",
        costUsd: finished ? (e.settled_usd ?? 0) : 0,
        reservedUsd: finished ? 0 : e.reserved_usd,
        calls: finished ? (calls.get(`${e.account}\n${e.id}`) ?? []) : [],
      });
    }

    const pulls = db.query("SELECT pulled_at, from_day, to_day, daily_limit_usd, weekly_limit_usd FROM ledger_pulls ORDER BY account").all() as {
      pulled_at: string;
      from_day: string;
      to_day: string;
      daily_limit_usd: number | null;
      weekly_limit_usd: number | null;
    }[];
    if (pulls.length === 0) return { rows, actions: null, limits: null, pulledAt: null };
    return {
      rows,
      actions: { from: pulls.map((p) => p.from_day).sort()[0], to: pulls.map((p) => p.to_day).sort().at(-1)! },
      // One account is the normal case; with several, the first one's limits are shown.
      limits: { dailyUsd: pulls[0].daily_limit_usd, weeklyUsd: pulls[0].weekly_limit_usd },
      pulledAt: pulls.map((p) => p.pulled_at).sort().at(-1)!,
    };
  } finally {
    db.close();
  }
}
