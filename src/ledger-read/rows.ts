/**
 * Ledger entries as spend rows (ADR 0039), read straight from the pulled day files. `status` uses this,
 * so it never depends on the index; the index holds the same entries for the dashboard.
 */
import { mergeRanges, weekStart, type Limits, type Range, type SpendRow } from "../spend/report";
import { listLedgerAccounts, readDayFile } from "./files";
import type { LedgerEntry } from "./types";

/** A finished run keeps its calls and its dollars; a hold (`reserved`, `unsettled`) is not spend and has no calls. */
export function entryToRow(e: LedgerEntry): SpendRow {
  const finished = e.state === "settled" || e.state === "unreserved";
  return {
    source: "actions",
    state: e.state,
    day: e.day,
    week: e.week || weekStart(e.day),
    repositoryKey: e.repository,
    repository: e.repository,
    pr: e.pr,
    runId: e.run_id === null ? e.id : String(e.run_id),
    profile: "",
    costUsd: finished ? (e.settledUsd ?? 0) : 0,
    reservedUsd: finished ? 0 : e.reservedUsd,
    calls: finished ? e.calls.map((c) => ({ model: c.model, auth: c.auth, costUsd: c.cost_usd ?? 0, costKnown: c.costKnown })) : [],
  };
}

export interface LedgerFromFiles {
  rows: SpendRow[];
  /** The days the pulls covered, merged over accounts. */
  ranges: Range[];
  limits: Limits | null;
  pulledAt: string | null;
}

export function readLedgerFromFiles(home: string, warn: (line: string) => void): LedgerFromFiles {
  const accounts = listLedgerAccounts(home);
  const rows: SpendRow[] = [];
  for (const a of accounts) {
    const seen = new Set<string>();
    for (const path of a.dayFiles) {
      const entries = readDayFile(path);
      if (!entries) {
        warn(`status: ${path} is not a ledger day file; skipped`);
        continue;
      }
      for (const e of entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        rows.push(entryToRow(e));
      }
    }
  }
  return {
    rows,
    ranges: mergeRanges(accounts.flatMap((a) => a.meta.ranges)),
    limits: accounts.length ? accounts[0].meta.limits : null,
    pulledAt: accounts.length ? accounts.map((a) => a.meta.pulledAt).sort().at(-1)! : null,
  };
}
