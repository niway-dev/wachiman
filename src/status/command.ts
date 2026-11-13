/**
 * `wachiman status`: what this laptop knows about its own local runs, and what they cost. It reads
 * the history files (`local --history`) and local git metadata only: no `claude`, no GitHub, no
 * network. Damaged history files are moved aside with a warning. Runs made by the GitHub Actions workflow are not in these files and are not counted.
 */
import { UsageError } from "../config";
import { wachimanHome } from "../accounts/config";
import { historySettings, historyRoot, listKeys, readRuns, repositoryKey } from "../history/store";
import type { HistoryRun } from "../history/types";

export const STATUS_FORMAT = "wachiman.status/1";

export const statusUsage = `wachiman status [--json] [--since <n>d] [--all-repos] [--repo <name|key>] [--model <text>]
                 [--profile <name>] [--by day|repo|model|profile] [--repo-dir <dir>]`;

export const GROUPS = ["day", "repo", "model", "profile"] as const;
export type Group = (typeof GROUPS)[number];

export interface StatusArgs {
  json: boolean;
  allRepos: boolean;
  sinceDays?: number;
  repo?: string;
  model?: string;
  profile?: string;
  by: Group;
}

/** The arguments after `status` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseStatusArgs(argv: string[]): StatusArgs | { help: true } {
  const args: StatusArgs = { json: false, allRepos: false, by: "day" };
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

const keyOf: Record<Group, (r: StatusRun) => string> = {
  day: (r) => r.at.slice(0, 10),
  repo: (r) => r.repositoryKey,
  model: (r) => (r.effort ? `${r.model} (${r.effort})` : r.model),
  profile: (r) => r.profile || "(none)",
};

export interface StatusGroup {
  key: string;
  runs: number;
  costUsdEstimate: number;
}

export function group(runs: StatusRun[], by: Group): StatusGroup[] {
  const map = new Map<string, StatusGroup>();
  for (const r of runs) {
    const key = keyOf[by](r);
    const g = map.get(key) ?? { key, runs: 0, costUsdEstimate: 0 };
    g.runs++;
    g.costUsdEstimate += r.costUsdEstimate;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => (by === "day" ? b.key.localeCompare(a.key) : b.costUsdEstimate - a.costUsdEstimate));
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

const usd = (n: number) => `$${n.toFixed(2)}`;
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - text.length));

export const LOCAL_ONLY = "Local runs only: those kept by `wachiman local --history`. Runs by the GitHub Actions workflow are not counted.";

export interface StatusIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  now?: () => Date;
  version: string;
}

export function runStatus(args: StatusArgs, repoDir: string, env: Record<string, string | undefined>, io: StatusIo): number {
  const home = wachimanHome(env);
  const root = historyRoot(home);
  const now = io.now?.() ?? new Date();
  const keys = args.allRepos || args.repo !== undefined ? listKeys(root) : [repositoryKey(repoDir).key];
  const all = keys.flatMap((key) => readRuns(root, key, io.stderr)).map(flatten);
  const retentionDays = historySettings(env, true).days;
  if (args.repo !== undefined && !all.some(r => r.repositoryKey === args.repo)) {
    const matches = [...new Set(all.filter(r => r.repository === args.repo).map(r => r.repositoryKey))];
    if (matches.length > 1) throw new UsageError(`Repository name "${args.repo}" is ambiguous; use a key: ${matches.join(", ")}.`);
  }
  const effectiveArgs = args.repo !== undefined && all.some(r => r.repositoryKey === args.repo) ? { ...args, repo: undefined } : args;
  const scoped = effectiveArgs !== args ? all.filter(r => r.repositoryKey === args.repo) : all;
  const runs = filterRuns(scoped, effectiveArgs, now).sort((a, b) => a.at.localeCompare(b.at));
  const groups = group(runs, args.by);
  const total = runs.reduce((sum, r) => sum + r.costUsdEstimate, 0);
  const filters = {
    scope: args.allRepos ? "all-repos" : args.repo !== undefined ? "repo" : "this-repo",
    ...(args.repo !== undefined ? { repo: args.repo } : {}),
    ...(args.sinceDays !== undefined ? { sinceDays: args.sinceDays } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.profile !== undefined ? { profile: args.profile } : {}),
  };

  if (args.json) {
    const doc = {
      format: STATUS_FORMAT,
      version: io.version,
      home,
      scope: LOCAL_ONLY,
      retentionDays,
      filters,
      by: args.by,
      totals: { runs: runs.length, costUsdEstimate: total },
      groups,
      runs,
    };
    io.stdout(`${JSON.stringify(doc, null, 2)}\n`);
    return 0;
  }

  const lines = [`Wachiman ${io.version}  (home ${home})`, LOCAL_ONLY, ""];
  if (runs.length === 0) {
    lines.push(all.length === 0 ? "No local runs kept yet: run `wachiman local --history` to start. Run `wachiman doctor` to check this machine." : `No run matches the filters (${all.length} kept before filtering).`);
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  }
  const w = Math.max(args.by.length, ...groups.map((g) => g.key.length));
  lines.push(`${runs.length} run${runs.length === 1 ? "" : "s"}, ${usd(total)} estimated (API-equivalent, not a bill), ${runs[0].at.slice(0, 10)} → ${runs.at(-1)!.at.slice(0, 10)}`, "");
  lines.push(`  ${pad(args.by, w)}  runs  cost`);
  for (const g of groups) lines.push(`  ${pad(g.key, w)}  ${pad(String(g.runs), 4)}  ${usd(g.costUsdEstimate)}`);
  lines.push("", retentionDays === 0 ? "New `--history` runs keep all runs (WACHIMAN_HISTORY_DAYS=0). `--json` lists every run with its attributes." : `A new \`--history\` run deletes runs older than ${retentionDays} days (WACHIMAN_HISTORY_DAYS changes that). \`--json\` lists every run with its attributes.`);
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}
