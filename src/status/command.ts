/**
 * `wachiman status`: what this laptop knows about its own local runs, and what they cost. It reads
 * the history files (`local --history`) and local git metadata only: no `claude`, no GitHub, no
 * network. Damaged history files are moved aside with a warning. Runs made by the GitHub Actions workflow
 * are not in these files and are not counted, unless the user connected a ledger and pulled it (ADR 0039):
 * then the pulled day files are read directly (never the index, so `status` answers even when the index
 * cannot be written) and one report covers both sources.
 */
import { UsageError } from "../config";
import { wachimanHome } from "../accounts/config";
import { historySettings, historyRoot, listKeys, readRuns, repositoryKey } from "../history/store";
import type { HistoryRun } from "../history/types";
import { readLedgerFromFiles } from "../ledger-read/rows";
import { buildReport, deriveCoverage, group as groupRows, limitUse, SOURCES, weekStart, type GroupBy, type LimitUse, type Report, type Source, type SpendRow } from "../spend/report";

export const STATUS_FORMAT = "wachiman.status/1";

export const statusUsage = `wachiman status [--json] [--since <n>d] [--all-repos] [--repo <name|key>] [--model <text>]
                 [--profile <name>] [--by day|week|repo|pr|model|profile|source] [--source laptop|actions|all]
                 [--refresh] [--repo-dir <dir>]`;

export const GROUPS = ["day", "week", "repo", "pr", "model", "profile", "source"] as const;
export type Group = (typeof GROUPS)[number];

export interface StatusArgs {
  json: boolean;
  allRepos: boolean;
  sinceDays?: number;
  repo?: string;
  model?: string;
  profile?: string;
  by: Group;
  source: Source | "all";
  /** Download the ledger first (the only request `status` can make). */
  refresh: boolean;
}

/** The arguments after `status` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseStatusArgs(argv: string[]): StatusArgs | { help: true } {
  const args: StatusArgs = { json: false, allRepos: false, by: "day", source: "all", refresh: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!arg.startsWith("--")) throw new UsageError(`status takes no argument "${arg}".`);
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = () => {
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined || v === "" || (eq === -1 && v.startsWith("--"))) throw new UsageError(`${name} needs a value.`);
      return v;
    };
    const flag = () => {
      if (eq !== -1) throw new UsageError(`${name} takes no value.`);
    };
    if (name === "--json") (flag(), (args.json = true));
    else if (name === "--all-repos") (flag(), (args.allRepos = true));
    else if (name === "--refresh") (flag(), (args.refresh = true));
    else if (name === "--source") {
      const v = value();
      if (v !== "all" && !(SOURCES as readonly string[]).includes(v)) throw new UsageError(`--source is one of laptop, actions, all; got "${v}".`);
      args.source = v as Source | "all";
    }
    else if (name === "--repo") args.repo = value();
    else if (name === "--model") args.model = value();
    else if (name === "--profile") args.profile = value();
    else if (name === "--since") {
      const v = value();
      if (!/^\d+d$/.test(v)) throw new UsageError(`--since takes a number of days such as 7d, got "${v}".`);
      args.sinceDays = Number.parseInt(v, 10);
    } else if (name === "--by") {
      const v = value();
      if (!(GROUPS as readonly string[]).includes(v)) throw new UsageError(`--by is one of ${GROUPS.join(", ")}; got "${v}".`);
      args.by = v as Group;
    } else throw new UsageError(`Unknown option ${name} for status.`);
  }
  if (args.repo !== undefined && args.allRepos) throw new UsageError("--repo and --all-repos cannot be used together: --repo already names the repository.");
  return args;
}

/** One local run, flattened to the attributes a developer filters and groups by. */
export interface StatusRun {
  at: string;
  repositoryKey: string;
  repository: string;
  change: string;
  head: string;
  model: string;
  effort: string;
  profile: string;
  engineVersion: string;
  costUsdEstimate: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  findings: number;
}

export function flatten(run: HistoryRun): StatusRun {
  const { result } = run;
  const usage = result.execution?.usage;
  return {
    at: run.savedAt,
    repositoryKey: run.repository.key,
    repository: run.repository.name,
    change: result.change?.head?.ref ?? result.change?.title ?? "",
    head: result.change?.head?.sha ?? "",
    model: result.provider?.model ?? "",
    effort: result.provider?.effort ?? "",
    profile: (result.format === "wachiman.review-result/2" ? result.provider.account?.name : undefined) ?? result.provider?.profile ?? "",
    engineVersion: run.engine.version,
    costUsdEstimate: result.execution?.costUsdEstimate ?? 0,
    tokens: { input: usage?.input ?? 0, output: usage?.output ?? 0, cacheRead: usage?.cacheRead ?? 0, cacheWrite: usage?.cacheWrite ?? 0 },
    findings: result.findings?.length ?? 0,
  };
}

export interface StatusGroup {
  key: string;
  runs: number;
  costUsdEstimate: number;
}

/** A laptop run in the row shape of the spend report. A local run is an API-equivalent estimate (ADR 0019). */
export function toRow(r: StatusRun): SpendRow {
  const day = r.at.slice(0, 10);
  return {
    source: "laptop",
    state: "settled",
    day,
    week: weekStart(day),
    repositoryKey: r.repositoryKey,
    repository: r.repository,
    pr: null,
    runId: `${r.repositoryKey}@${r.at}`,
    profile: r.profile,
    costUsd: r.costUsdEstimate,
    reservedUsd: 0,
    calls: [{ model: r.effort ? `${r.model} (${r.effort})` : r.model, auth: "subscription", costUsd: r.costUsdEstimate, costKnown: true }],
  };
}

/** Groups laptop runs through the spend report; kept for the callers that group `StatusRun`s. */
export function group(runs: StatusRun[], by: Group): StatusGroup[] {
  return groupRows(runs.map(toRow), by as GroupBy).map((g) => ({ key: g.key, runs: g.split.total.runs, costUsdEstimate: g.split.total.usd }));
}

export function filterRuns(runs: StatusRun[], args: StatusArgs, now: Date): StatusRun[] {
  const cutoff = args.sinceDays === undefined ? undefined : now.getTime() - args.sinceDays * 86_400_000;
  return runs.filter(
    (r) =>
      (cutoff === undefined || Date.parse(r.at) >= cutoff) &&
      (args.repo === undefined || r.repository === args.repo || r.repositoryKey === args.repo) &&
      (args.model === undefined || r.model.includes(args.model)) &&
      (args.profile === undefined || r.profile === args.profile),
  );
}

export const LOCAL_ONLY = "Local runs only: those kept by `wachiman local --history`. Runs by the GitHub Actions workflow are not counted.";
export const WITH_LEDGER = "Laptop runs kept by `wachiman local --history` and GitHub Actions runs downloaded from the ledger. The ledger limit is best-effort and counts Actions runs only.";

export interface StatusIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  now?: () => Date;
  version: string;
}

/** `owner/name` of the clone's `origin`, lower case, when it has one. */
function remoteSlug(remote: string | undefined): string | undefined {
  return remote?.match(/\/([^/]+\/[^/]+)$/)?.[1]?.toLowerCase();
}

/** Ledger rows kept by the same filters as the laptop runs; `slug` scopes them to one repository. */
function filterLedgerRows(rows: SpendRow[], args: StatusArgs, now: Date, slug: string | undefined, all: StatusRun[]): SpendRow[] {
  const cutoff = args.sinceDays === undefined ? undefined : now.getTime() - args.sinceDays * 86_400_000;
  const tail = (r: SpendRow) => r.repository.split("/").at(-1);
  const repoMatches = (r: SpendRow) => {
    if (args.repo !== undefined) return r.repository.toLowerCase() === args.repo.toLowerCase() || tail(r) === args.repo || all.some((l) => l.repositoryKey === args.repo && l.repository === tail(r));
    return args.allRepos || (slug !== undefined && r.repository.toLowerCase() === slug);
  };
  return rows.filter(
    (r) =>
      r.source === "actions" &&
      (cutoff === undefined || Date.parse(`${r.day}T23:59:59Z`) >= cutoff) &&
      repoMatches(r) &&
      (args.model === undefined || r.calls.some((c) => c.model.includes(args.model!))) &&
      args.profile === undefined,
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - text.length));

function creditLine(report: Report): string {
  const c = report.totals.byCredential;
  const parts = [`${usd(c.billed.usd)} billed (API key)`, `${usd(c.estimated.usd)} estimated (subscription, API-equivalent, not a bill)`];
  if (c.unknown.usd > 0) parts.push(`${usd(c.unknown.usd)} of unknown credential`);
  return parts.join(" + ");
}

/** The ledger limit is per account across every repository, so these figures never see `--repo`, `--model`, `--since` or `--profile`. */
function limitLines(use: { day: LimitUse | null; week: LimitUse | null }, now: Date): string[] {
  const today = now.toISOString().slice(0, 10);
  const one = (label: string, u: LimitUse | null) =>
    u ? [`${label}: ${u.usedUsd === null ? "no data" : `${usd(u.usedUsd)} of ${usd(u.limitUsd)}`} counted against the ledger limit (Actions runs only, whole account, all repositories, best-effort)`] : [];
  return [...one(`Today (${today} UTC)`, use.day), ...one(`This week (Monday ${weekStart(today)} UTC)`, use.week)];
}

function asideLine(report: Report): string[] {
  const a = report.aside;
  const parts: string[] = [];
  if (a.unreserved.runs) parts.push(`${a.unreserved.runs} run${a.unreserved.runs === 1 ? "" : "s"} not reserved (${usd(a.unreserved.usd)} recorded after the fact)`);
  if (a.unsettled.runs) parts.push(`${a.unsettled.runs} reservation${a.unsettled.runs === 1 ? "" : "s"} never settled (${usd(a.unsettled.reservedUsd)} held, not spent)`);
  if (a.reserved.runs) parts.push(`${a.reserved.runs} run${a.reserved.runs === 1 ? "" : "s"} still reserved (${usd(a.reserved.reservedUsd)} held)`);
  return parts.length ? [`Not counted as spend: ${parts.join("; ")}.`] : [];
}

export function runStatus(args: StatusArgs, repoDir: string, env: Record<string, string | undefined>, io: StatusIo): number {
  const home = wachimanHome(env);
  const root = historyRoot(home);
  const now = io.now?.() ?? new Date();
  const repo = args.allRepos || args.repo !== undefined ? undefined : repositoryKey(repoDir);
  const keys = args.allRepos || args.repo !== undefined ? listKeys(root) : [repo!.key];
  const all = keys.flatMap((key) => readRuns(root, key, io.stderr)).map(flatten);
  const retentionDays = historySettings(env, true).days;
  if (args.repo !== undefined && !all.some(r => r.repositoryKey === args.repo)) {
    const matches = [...new Set(all.filter(r => r.repository === args.repo).map(r => r.repositoryKey))];
    if (matches.length > 1) throw new UsageError(`Repository name "${args.repo}" is ambiguous; use a key: ${matches.join(", ")}.`);
  }
  const effectiveArgs = args.repo !== undefined && all.some(r => r.repositoryKey === args.repo) ? { ...args, repo: undefined } : args;
  const scoped = effectiveArgs !== args ? all.filter(r => r.repositoryKey === args.repo) : all;
  const laptopRuns = filterRuns(scoped, effectiveArgs, now).sort((a, b) => a.at.localeCompare(b.at));

  // The ledger is read only from files the user pulled; with none, everything below is the local-only status.
  const ledger = readLedgerFromFiles(home, io.stderr);
  const hasLedger = ledger.pulledAt !== null;
  if (!hasLedger && args.source === "actions") throw new UsageError("--source actions needs a pulled ledger: run `wachiman ledger connect`, then `wachiman ledger pull`.");
  const actionsRows = hasLedger ? filterLedgerRows(ledger.rows, args, now, remoteSlug(repo?.remote), all) : [];
  const sources: Source[] = args.source === "all" ? [...SOURCES] : [args.source];
  const useLaptop = sources.includes("laptop");
  const rows = [...(useLaptop ? laptopRuns.map(toRow) : []), ...(sources.includes("actions") ? actionsRows : [])];
  const report = buildReport({
    rows,
    sources: hasLedger ? sources : ["laptop"],
    coverage: deriveCoverage(scoped.map(toRow), ledger.ranges, now),
    limits: ledger.limits,
    pulledAt: ledger.pulledAt,
    now,
  });
  // The limit figures come from every ledger row of the account, whatever the filters say.
  const limitReport = buildReport({ rows: ledger.rows, sources: ["actions"], coverage: { laptop: [], actions: ledger.ranges }, limits: ledger.limits, pulledAt: ledger.pulledAt, now });
  const limits = limitUse(limitReport, now);
  const groups = groupRows(rows, args.by as GroupBy);
  const settled = rows.filter((r) => r.state === "settled");
  const total = report.totals.total.usd;
  const filters = {
    scope: args.allRepos ? "all-repos" : args.repo !== undefined ? "repo" : "this-repo",
    ...(args.repo !== undefined ? { repo: args.repo } : {}),
    ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.profile !== undefined ? { profile: args.profile } : {}),
    ...(hasLedger ? { source: args.source } : {}),
  };
  const legacyGroups = groups.map((g) => ({ key: g.key, runs: g.split.total.runs, costUsdEstimate: g.split.total.usd }));

  if (args.json) {
    const doc = {
      format: STATUS_FORMAT,
      version: io.version,
      home,
      scope: hasLedger ? WITH_LEDGER : LOCAL_ONLY,
      retentionDays,
      filters,
      by: args.by,
      totals: { runs: settled.length, costUsdEstimate: total },
      groups: hasLedger ? groups.map((g, i) => ({ ...legacyGroups[i], label: g.label, split: g.split })) : legacyGroups,
      runs: useLaptop ? laptopRuns : [],
      ...(hasLedger ? { report, limitUse: limits } : {}),
    };
    io.stdout(`${JSON.stringify(doc, null, 2)}\n`);
    return 0;
  }

  const lines = [`Wachiman ${io.version}  (home ${home})`, hasLedger ? WITH_LEDGER : LOCAL_ONLY, ""];
  if (settled.length === 0 && !hasLedger) {
    lines.push(all.length === 0 ? "No local runs kept yet: run `wachiman local --history` to start. Run `wachiman doctor` to check this machine." : `No run matches the filters (${all.length} kept before filtering).`);
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  }
  if (settled.length === 0) {
    lines.push(all.length === 0 && actionsRows.length === 0 ? "No run to show: no local run is kept and no ledger entry matches. Run `wachiman ledger pull` to refresh the ledger." : "No run matches the filters.");
    lines.push(...asideLine(report), ...limitLines(limits, now));
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  }
  const w = Math.max(args.by.length, ...groups.map((g) => g.key.length));
  const days = settled.map((r) => r.day).sort();
  if (hasLedger) {
    lines.push(`${settled.length} run${settled.length === 1 ? "" : "s"}, ${creditLine(report)}, ${days[0]} → ${days.at(-1)}`);
    lines.push(...limitLines(limits, now), ...asideLine(report), "");
    lines.push(`  ${pad(args.by, w)}  runs  calls  billed  estimated`);
    for (const g of groups) lines.push(`  ${pad(g.key, w)}  ${pad(String(g.split.total.runs), 4)}  ${pad(String(g.split.total.calls), 5)}  ${pad(usd(g.split.byCredential.billed.usd), 6)}  ${usd(g.split.byCredential.estimated.usd + g.split.byCredential.unknown.usd)}`);
  } else {
    lines.push(`${settled.length} run${settled.length === 1 ? "" : "s"}, ${usd(total)} estimated (API-equivalent, not a bill), ${laptopRuns[0].at.slice(0, 10)} → ${laptopRuns.at(-1)!.at.slice(0, 10)}`, "");
    lines.push(`  ${pad(args.by, w)}  runs  cost`);
    for (const g of legacyGroups) lines.push(`  ${pad(g.key, w)}  ${pad(String(g.runs), 4)}  ${usd(g.costUsdEstimate)}`);
  }
  lines.push("", retentionDays === 0 ? "New `--history` runs keep all runs (AGENT_REVIEW_HISTORY_DAYS=0). `--json` lists every run with its attributes." : `A new \`--history\` run deletes runs older than ${retentionDays} days (AGENT_REVIEW_HISTORY_DAYS changes that). \`--json\` lists every run with its attributes.`);
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}
