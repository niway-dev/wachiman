/**
 * The ledger as files on the laptop (ADR 0039): `<home>/ledger/<account>/<day>.json` holds the entries
 * of one UTC day, replaced as a whole by each pull, and `pull.json` beside them holds when the pull
 * happened, the days it covered and the limits the ledger reported. These files are the record; the
 * SQLite index is rebuilt from them. No token is ever written here.
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ledgerDir, writePrivateFile } from "./credentials";
import { mergeRanges, type Range } from "../spend/report";
import { ACCOUNT_PATTERN, DAY_PATTERN, parseEntriesResponse, type EntriesResponse, type LedgerEntry, type LedgerLimits } from "./types";

export const PULL_FILE = "pull.json";
export const PULL_FORMAT = "wachiman.ledger-pull/1";
export const DAY_FORMAT = "wachiman.ledger-day/1";

export interface PullMeta {
  account: string;
  /** When the latest pull happened. */
  pulledAt: string;
  /** The days the pulls covered; ranges that overlap or touch are one. Day files outside the latest pull are kept. */
  ranges: Range[];
  limits: LedgerLimits;
}

const STALE_TMP_MS = 3_600_000;

/** Removes `*.tmp-<pid>` files a crashed write left in `dir`, when they are over an hour old. */
export function sweepStaleTemporaries(dir: string) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!/\.tmp-\d+$/.test(name)) continue;
    try {
      if (Date.now() - statSync(join(dir, name)).mtimeMs > STALE_TMP_MS) unlinkSync(join(dir, name));
    } catch {
      // Gone already.
    }
  }
}

export const accountDir = (home: string, account: string) => join(ledgerDir(home), account);

/** Every `YYYY-MM-DD` from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** Stores one pull: each day in the range is replaced by the entries received for it, or removed when none came. Days outside the range stay. */
export function storePull(home: string, response: EntriesResponse, from: string, to: string, pulledAt: string): { daysWritten: number; daysRemoved: number; entries: number } {
  const dir = accountDir(home, response.account);
  sweepStaleTemporaries(ledgerDir(home));
  sweepStaleTemporaries(dir);
  const byDay = new Map<string, LedgerEntry[]>();
  for (const e of response.entries) {
    if (e.day < from || e.day > to) continue;
    byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  }
  let daysRemoved = 0;
  for (const day of daysBetween(from, to)) {
    const entries = byDay.get(day);
    if (entries) writePrivateFile(join(dir, `${day}.json`), `${JSON.stringify({ format: DAY_FORMAT, account: response.account, day, entries }, null, 2)}\n`);
    else if (existsSync(join(dir, `${day}.json`))) {
      unlinkSync(join(dir, `${day}.json`));
      daysRemoved++;
    }
  }
  const earlier = readPullMeta(dir, response.account)?.ranges ?? [];
  const meta = { format: PULL_FORMAT, account: response.account, pulledAt, ranges: mergeRanges([...earlier, { from, to }]), limits: response.limits };
  writePrivateFile(join(dir, PULL_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  return { daysWritten: byDay.size, daysRemoved, entries: [...byDay.values()].reduce((n, e) => n + e.length, 0) };
}

/** `pull.json` of an account directory, or undefined when it is missing or damaged. Older files with `from`/`to` read as one range. */
export function readPullMeta(dir: string, account: string): PullMeta | undefined {
  try {
    const m = JSON.parse(readFileSync(join(dir, PULL_FILE), "utf8"));
    if (!m || typeof m.pulledAt !== "string") return undefined;
    const raw: unknown[] = Array.isArray(m.ranges) ? m.ranges : [{ from: m.from, to: m.to }];
    const ranges = raw.filter((r): r is Range => !!r && typeof (r as Range).from === "string" && typeof (r as Range).to === "string" && DAY_PATTERN.test((r as Range).from) && DAY_PATTERN.test((r as Range).to));
    if (ranges.length === 0) return undefined;
    return {
      account,
      pulledAt: m.pulledAt,
      ranges: mergeRanges(ranges),
      limits: { dailyUsd: typeof m.limits?.dailyUsd === "number" ? m.limits.dailyUsd : null, weeklyUsd: typeof m.limits?.weeklyUsd === "number" ? m.limits.weeklyUsd : null },
    };
  } catch {
    return undefined;
  }
}

export interface LedgerAccountFiles {
  account: string;
  meta: PullMeta;
  /** Day file paths, sorted. */
  dayFiles: string[];
  pullFile: string;
}

/**
 * The account the laptop is connected to: the one pulled last, as a list of zero or one. Directories of
 * accounts pulled earlier stay on disk (a disconnect keeps entries) and are ignored, so the figures and the
 * limit never mix two accounts. A directory without a readable `pull.json` holds nothing the report can use.
 */
export function listLedgerAccounts(home: string): LedgerAccountFiles[] {
  const all = readAllLedgerAccounts(home);
  if (all.length <= 1) return all;
  const newest = [...all].sort((a, b) => b.meta.pulledAt.localeCompare(a.meta.pulledAt) || a.account.localeCompare(b.account))[0];
  return [newest];
}

function readAllLedgerAccounts(home: string): LedgerAccountFiles[] {
  const root = ledgerDir(home);
  if (!existsSync(root)) return [];
  const out: LedgerAccountFiles[] = [];
  for (const account of readdirSync(root).sort()) {
    if (!ACCOUNT_PATTERN.test(account)) continue;
    const dir = join(root, account);
    const pullFile = join(dir, PULL_FILE);
    const meta = readPullMeta(dir, account);
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
