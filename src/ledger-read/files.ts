/**
 * The ledger as files on the laptop (ADR 0039): `<home>/ledger/<account>/<day>.json` holds the entries
 * of one UTC day, replaced as a whole by each pull, and `pull.json` beside them holds when the pull
 * happened, the days it covered and the limits the ledger reported. These files are the record; the
 * SQLite index is rebuilt from them. No token is ever written here.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ledgerDir, writePrivateFile } from "./credentials";
import { ACCOUNT_PATTERN, DAY_PATTERN, parseEntriesResponse, type EntriesResponse, type LedgerEntry, type LedgerLimits } from "./types";

export const PULL_FILE = "pull.json";
export const PULL_FORMAT = "wachiman.ledger-pull/1";
export const DAY_FORMAT = "wachiman.ledger-day/1";

export interface PullMeta {
  account: string;
  pulledAt: string;
  from: string;
  to: string;
  limits: LedgerLimits;
}

export const accountDir = (home: string, account: string) => join(ledgerDir(home), account);

/** Every `YYYY-MM-DD` from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** Stores one pull: each day in the range is replaced by the entries received for it, or removed when none came. */
export function storePull(home: string, response: EntriesResponse, from: string, to: string, pulledAt: string): { daysWritten: number; entries: number } {
  const dir = accountDir(home, response.account);
  const byDay = new Map<string, LedgerEntry[]>();
  for (const e of response.entries) {
    if (e.day < from || e.day > to) continue;
    byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  }
  for (const day of daysBetween(from, to)) {
    const entries = byDay.get(day);
    if (entries) writePrivateFile(join(dir, `${day}.json`), `${JSON.stringify({ format: DAY_FORMAT, account: response.account, day, entries }, null, 2)}\n`);
    else if (existsSync(join(dir, `${day}.json`))) unlinkSync(join(dir, `${day}.json`));
  }
  const meta: PullMeta & { format: string } = { format: PULL_FORMAT, account: response.account, pulledAt, from, to, limits: response.limits };
  writePrivateFile(join(dir, PULL_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  return { daysWritten: byDay.size, entries: [...byDay.values()].reduce((n, e) => n + e.length, 0) };
}

export interface LedgerAccountFiles {
  account: string;
  meta: PullMeta;
  /** Day file paths, sorted. */
  dayFiles: string[];
  pullFile: string;
}

/** The accounts that have a readable `pull.json`; a directory without one holds nothing the report can use. */
export function listLedgerAccounts(home: string): LedgerAccountFiles[] {
  const root = ledgerDir(home);
  if (!existsSync(root)) return [];
  const out: LedgerAccountFiles[] = [];
  for (const account of readdirSync(root).sort()) {
    if (!ACCOUNT_PATTERN.test(account)) continue;
    const dir = join(root, account);
    const pullFile = join(dir, PULL_FILE);
    let meta: PullMeta | undefined;
    try {
      const m = JSON.parse(readFileSync(pullFile, "utf8"));
      if (m && typeof m.pulledAt === "string" && DAY_PATTERN.test(m.from) && DAY_PATTERN.test(m.to)) {
        meta = {
          account,
          pulledAt: m.pulledAt,
          from: m.from,
          to: m.to,
          limits: {
            dailyUsd: typeof m.limits?.dailyUsd === "number" ? m.limits.dailyUsd : null,
            weeklyUsd: typeof m.limits?.weeklyUsd === "number" ? m.limits.weeklyUsd : null,
          },
        };
      }
    } catch {
      // Missing or damaged: the account has no usable pull.
    }
    if (!meta) continue;
    const dayFiles = readdirSync(dir)
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .sort()
      .map((n) => join(dir, n));
    out.push({ account, meta, dayFiles, pullFile });
  }
  return out;
}

/** The entries of one day file, or undefined (with no throw) when it is not one. */
export function readDayFile(path: string): LedgerEntry[] | undefined {
  try {
    const d = JSON.parse(readFileSync(path, "utf8"));
    return parseEntriesResponse({ account: "x", entries: d?.entries }).entries;
  } catch {
    return undefined;
  }
}
