/**
 * One spend report for laptop runs and GitHub Actions runs (ADR 0039). Pure: rows in, report out. No
 * file, no network, no Bun-only API, so a web page can reuse it. Dollars are never summed across the
 * credential split without the split travelling with them: every figure is a `Split`.
 *
 * Spend is the dollars of finished runs (`settled`). Reservations that never settled and runs that
 * were not reserved are reported as their own lines (`aside`), not as spend. A period outside what was
 * downloaded is `known: false`, never zero.
 */
export type Source = "laptop" | "actions";
export const SOURCES: readonly Source[] = ["laptop", "actions"];
export type RowState = "settled" | "reserved" | "unsettled" | "unreserved";
export type Credential = "billed" | "estimated" | "unknown";
export const CREDENTIALS: readonly Credential[] = ["billed", "estimated", "unknown"];

/** `api-key` is billed; a subscription token or login gives an API-price estimate, not a charge. */
export function credentialOf(auth: string): Credential {
  if (auth === "api-key") return "billed";
  if (auth === "oauth-token" || auth === "subscription") return "estimated";
  return "unknown";
}

export interface SpendCall {
  model: string;
  auth: string;
  costUsd: number;
  costKnown: boolean;
}

export interface SpendRow {
  source: Source;
  state: RowState;
  /** UTC `YYYY-MM-DD`. */
  day: string;
  /** The Monday of the row's week, UTC. */
  week: string;
  repositoryKey: string;
  repository: string;
  pr: number | null;
  runId: string;
  profile: string;
  /** Dollars the run spent: for `settled` and `unreserved` rows; 0 for the others. */
  costUsd: number;
  /** Dollars held by a reservation (`reserved`, `unsettled`), else 0. */
  reservedUsd: number;
  calls: SpendCall[];
}

export interface Money {
  runs: number;
  calls: number;
  usd: number;
}
export interface Split {
  total: Money;
  bySource: Record<Source, Money>;
  byCredential: Record<Credential, Money>;
}
export interface Aside {
  runs: number;
  /** Dollars the run itself recorded (`unreserved`). */
  usd: number;
  /** Dollars held by reservations (`reserved`, `unsettled`). */
  reservedUsd: number;
}
export interface AsideLines {
  unreserved: Aside;
  unsettled: Aside;
  reserved: Aside;
}
export interface Range {
  from: string;
  to: string;
}
export interface Limits {
  dailyUsd: number | null;
  weeklyUsd: number | null;
}
export interface Bucket {
  key: string;
  /** Per source: whether the downloaded or kept data covers this period at all. */
  known: Record<Source, boolean>;
  /** The period is only partly inside the data of some source that covers it. */
  partial: boolean;
  spend: Split;
  aside: AsideLines;
  /** Actions only: settled + unreserved + reserved/unsettled holds, what the limit counts. Null without Actions data. */
  countedAgainstLimitUsd: number | null;
}
export interface Group {
  key: string;
  label: string;
  split: Split;
}
export type GroupBy = "day" | "week" | "repo" | "pr" | "model" | "profile" | "source";

export interface Report {
  filters: { sources: Source[] };
  coverage: Record<Source, Range | null>;
  pulledAt: string | null;
  limits: Limits | null;
  totals: Split;
  aside: AsideLines;
  days: Bucket[];
  weeks: Bucket[];
  groups: { repository: Group[]; pr: Group[]; model: Group[] };
  /** Calls whose dollar cost is unknown (counted as 0 in the figures). */
  unknownCostCalls: number;
}

const zero = (): Money => ({ runs: 0, calls: 0, usd: 0 });
const emptySplit = (): Split => ({
  total: zero(),
  bySource: { laptop: zero(), actions: zero() },
  byCredential: { billed: zero(), estimated: zero(), unknown: zero() },
});
const emptyAside = (): AsideLines => ({ unreserved: { runs: 0, usd: 0, reservedUsd: 0 }, unsettled: { runs: 0, usd: 0, reservedUsd: 0 }, reserved: { runs: 0, usd: 0, reservedUsd: 0 } });

/** Six decimals hide floating-point noise and lose no cent. */
export const roundUsd = (n: number) => Math.round(n * 1e6) / 1e6;

/** The spend of a row broken down by credential; dollars no call accounts for go to `unknown`. */
function creditBreakdown(row: SpendRow): { credential: Credential; calls: number; usd: number }[] {
  const out = new Map<Credential, { credential: Credential; calls: number; usd: number }>();
  const add = (credential: Credential, calls: number, usd: number) => {
    const e = out.get(credential) ?? { credential, calls: 0, usd: 0 };
    e.calls += calls;
    e.usd += usd;
    out.set(credential, e);
  };
  let itemised = 0;
  for (const c of row.calls) {
    add(credentialOf(c.auth), 1, c.costUsd);
    itemised += c.costUsd;
  }
  const rest = row.costUsd - itemised;
  if (rest > 1e-9) add("unknown", 0, rest);
  return [...out.values()];
}

function addSpend(split: Split, row: SpendRow) {
  const calls = row.calls.length;
  for (const m of [split.total, split.bySource[row.source]]) {
    m.runs++;
    m.calls += calls;
    m.usd += row.costUsd;
  }
  for (const b of creditBreakdown(row)) {
    const m = split.byCredential[b.credential];
    m.runs++;
    m.calls += b.calls;
    m.usd += b.usd;
  }
}

function roundSplit(split: Split): Split {
  for (const m of [split.total, ...Object.values(split.bySource), ...Object.values(split.byCredential)]) m.usd = roundUsd(m.usd);
  return split;
}

function addAside(aside: AsideLines, row: SpendRow) {
  if (row.state === "settled") return;
  const line = aside[row.state];
  line.runs++;
  line.usd += row.state === "unreserved" ? row.costUsd : 0;
  line.reservedUsd += row.reservedUsd;
}

const roundAside = (a: AsideLines): AsideLines => {
  for (const l of Object.values(a)) {
    l.usd = roundUsd(l.usd);
    l.reservedUsd = roundUsd(l.reservedUsd);
  }
  return a;
};

/** What the ledger limit counts for one Actions row: spend, a reservation hold, or a late record. */
const counted = (row: SpendRow) => (row.source !== "actions" ? 0 : row.state === "settled" || row.state === "unreserved" ? row.costUsd : row.reservedUsd);

/** The Monday (UTC) of the week that contains `day`. */
export function weekStart(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function modelOf(call: SpendCall) {
  return call.model === "" ? "(unknown model)" : call.model;
}

/** Groups rows. `model` groups by call: a run with two models appears in both, with only that model's calls and dollars. */
export function group(rows: SpendRow[], by: GroupBy): Group[] {
  const map = new Map<string, Group>();
  const get = (key: string, label: string) => {
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, label, split: emptySplit() }));
    return g;
  };
  for (const row of rows) {
    if (row.state !== "settled") continue;
    if (by === "model") {
      const byModel = new Map<string, SpendRow>();
      const itemised = row.calls.reduce((n, c) => n + c.costUsd, 0);
      for (const c of row.calls) {
        const key = modelOf(c);
        const part = byModel.get(key) ?? { ...row, calls: [], costUsd: 0 };
        part.calls = [...part.calls, c];
        part.costUsd += c.costUsd;
        byModel.set(key, part);
      }
      if (row.costUsd - itemised > 1e-9) byModel.set("(not itemised)", { ...row, calls: [], costUsd: row.costUsd - itemised });
      if (byModel.size === 0) byModel.set("(no calls recorded)", row);
      for (const [key, part] of byModel) addSpend(get(key, key).split, part);
      continue;
    }
    const [key, label] =
      by === "day"
        ? [row.day, row.day]
        : by === "week"
          ? [row.week, row.week]
          : by === "repo"
            ? [row.repositoryKey, row.repository]
            : by === "pr"
              ? row.pr !== null
                ? [`${row.repositoryKey}#${row.pr}`, `${row.repository} #${row.pr}`]
                : row.source === "laptop"
                  ? [`${row.repositoryKey}#local`, `${row.repository} (local branch)`]
                  : [`${row.repositoryKey}#none`, `${row.repository} (no pull request)`]
              : by === "profile"
                ? [row.profile || "(none)", row.profile || "(none)"]
                : [row.source, row.source === "actions" ? "GitHub Actions" : "Laptop"];
    addSpend(get(key, label).split, row);
  }
  const groups = [...map.values()];
  for (const g of groups) roundSplit(g.split);
  return groups.sort((a, b) => (by === "day" || by === "week" ? b.key.localeCompare(a.key) : b.split.total.usd - a.split.total.usd || a.key.localeCompare(b.key)));
}

export interface ReportInput {
  rows: SpendRow[];
  /** Which sources the caller asked for; the others are `known: false`. */
  sources?: Source[];
  /** The days each source's data covers: the pull for Actions, first kept run to today for the laptop. Null: no data. */
  coverage: Record<Source, Range | null>;
  limits?: Limits | null;
  pulledAt?: string | null;
  now: Date;
}

/** The laptop covers from its first kept run to today, whatever the filters; Actions covers what the last pull asked for. */
export function deriveCoverage(allRows: SpendRow[], actions: Range | null, now: Date): Record<Source, Range | null> {
  const days = allRows.filter((r) => r.source === "laptop").map((r) => r.day).sort();
  return { laptop: days.length ? { from: days[0], to: now.toISOString().slice(0, 10) } : null, actions };
}

const MAX_BUCKETS = 120;

function buckets(input: ReportInput, kind: "day" | "week", sources: Source[]): Bucket[] {
  const today = input.now.toISOString().slice(0, 10);
  const ranges = sources.flatMap((s) => (input.coverage[s] ? [input.coverage[s]!] : []));
  if (ranges.length === 0) return [];
  const first = ranges.map((r) => r.from).sort()[0];
  const last = [today, ...ranges.map((r) => r.to)].sort().at(-1)!;
  const step = kind === "day" ? 1 : 7;
  const startKey = kind === "day" ? first : weekStart(first);
  const keys: string[] = [];
  for (let k = startKey; k <= last && keys.length < MAX_BUCKETS; k = addDays(k, step)) keys.push(k);
  const rows = input.rows.filter((r) => sources.includes(r.source));
  return keys.map((key): Bucket => {
    const end = kind === "day" ? key : addDays(key, 6);
    const known = { laptop: false, actions: false } as Record<Source, boolean>;
    let partial = false;
    for (const s of sources) {
      const r = input.coverage[s];
      if (!r || r.to < key || r.from > end) continue;
      known[s] = true;
      if (r.from > key || r.to < (end > today ? today : end)) partial = true;
    }
    const spend = emptySplit();
    const aside = emptyAside();
    let limitUse = 0;
    for (const row of rows) {
      if ((kind === "day" ? row.day : row.week) !== key) continue;
      if (row.state === "settled") addSpend(spend, row);
      addAside(aside, row);
      limitUse += counted(row);
    }
    return { key, known, partial, spend: roundSplit(spend), aside: roundAside(aside), countedAgainstLimitUsd: known.actions ? roundUsd(limitUse) : null };
  });
}

export function buildReport(input: ReportInput): Report {
  const sources = input.sources ?? [...SOURCES];
  const rows = input.rows.filter((r) => sources.includes(r.source));
  const totals = emptySplit();
  const aside = emptyAside();
  let unknownCostCalls = 0;
  for (const row of rows) {
    if (row.state === "settled") addSpend(totals, row);
    addAside(aside, row);
    unknownCostCalls += row.calls.filter((c) => !c.costKnown).length;
  }
  return {
    filters: { sources },
    coverage: { laptop: sources.includes("laptop") ? input.coverage.laptop : null, actions: sources.includes("actions") ? input.coverage.actions : null },
    pulledAt: input.pulledAt ?? null,
    limits: input.limits ?? null,
    totals: roundSplit(totals),
    aside: roundAside(aside),
    days: buckets(input, "day", sources),
    weeks: buckets(input, "week", sources),
    groups: { repository: group(rows, "repo"), pr: group(rows, "pr"), model: group(rows, "model") },
    unknownCostCalls,
  };
}
