/**
 * `wachiman history`: lists the findings the local history tracks, records the developer's
 * verdict on one, and forgets what was kept. It reads files and local git metadata only (`git rev-parse`
 * and `git remote get-url` in `--repo-dir`, to find the key): no `claude`, no GitHub.
 */
import { UsageError } from "../config";
import { SEVERITY, TOPIC } from "../engine";
import { location, sha7 } from "../sinks/common";
import { replay, type Replayed, type ReplayedFinding } from "./match";
import { appendVerdict, forget, historyRoot, listKeys, readRuns, readVerdicts, repositoryKey } from "./store";
import { VERDICT_WORDS, type HistoryRun, type VerdictWord } from "./types";

export const HISTORY_STATE_FORMAT = "wachiman.history-state/1";

export const historyUsage = `wachiman history [--repo-dir <dir>] [--since <n>d] [--all-repos] [--json]
                 [--verdict <id> correct|partial|wrong [--reason <text>]]
                 [--forget [--all]]`;

export interface HistoryArgs {
  sinceDays?: number;
  allRepos: boolean;
  json: boolean;
  forget: boolean;
  all: boolean;
  verdict?: { id: string; word: VerdictWord };
  reason?: string;
}

/** The arguments after `history` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseHistoryArgs(argv: string[]): HistoryArgs {
  const args: HistoryArgs = { allRepos: false, json: false, forget: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new UsageError(`history takes no argument "${arg}".`);
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
    if (name === "--all-repos") (flag(), (args.allRepos = true));
    else if (name === "--json") (flag(), (args.json = true));
    else if (name === "--forget") (flag(), (args.forget = true));
    else if (name === "--all") (flag(), (args.all = true));
    else if (name === "--reason") args.reason = value();
    else if (name === "--since") {
      const v = value();
      if (!/^\d+d$/.test(v)) throw new UsageError(`--since takes a number of days such as 7d, got "${v}".`);
      args.sinceDays = Number.parseInt(v, 10);
    } else if (name === "--verdict") {
      const id = value();
      const word = argv[++i];
      if (!(VERDICT_WORDS as readonly string[]).includes(word ?? "")) {
        throw new UsageError(`A verdict is one of ${VERDICT_WORDS.join(", ")}; got "${word ?? ""}".`);
      }
      args.verdict = { id, word: word as VerdictWord };
    } else throw new UsageError(`Unknown option ${name} for history.`);
  }
  if (args.all && !args.forget) throw new UsageError("--all only goes with --forget.");
  if (args.reason !== undefined && !args.verdict) throw new UsageError("--reason only goes with --verdict.");
  if (args.verdict && (args.forget || args.json || args.allRepos || args.sinceDays !== undefined)) {
    throw new UsageError("--verdict records one verdict and lists nothing: it takes no other option than --repo-dir and --reason.");
  }
  if (args.forget && (args.json || args.allRepos || args.sinceDays !== undefined)) {
    throw new UsageError("--forget takes only --all and --repo-dir (--all, not --all-repos, forgets every repository).");
  }
  return args;
}

const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - text.length));
const day = (iso: string) => iso.slice(0, 10);

interface Listed {
  key: string;
  runs: HistoryRun[];
  state: Replayed;
}

function describe(f: ReplayedFinding) {
  return `${location(f)}  ${SEVERITY[f.severity].word} · ${TOPIC[f.topic].word}  ${f.title.replace(/\s+/g, " ")}`;
}

function table(l: Listed) {
  const last = l.runs.at(-1)!;
  const header = `${l.key}  ${last.repository.path}  (${l.runs.length} runs, ${day(l.runs[0].savedAt)} → ${day(last.savedAt)})`;
  const rows = l.state.findings.map((f) => ({
    status: f.status,
    first: sha7(f.firstHead),
    last: sha7(f.lastHead),
    runs: String(f.runs),
    id: f.firstId,
    text: describe(f),
    verdict: f.verdict ? `   verdict: ${f.verdict.verdict}` : "",
  }));
  const w = (pick: (r: (typeof rows)[number]) => string, title: string) => Math.max(title.length, ...rows.map((r) => pick(r).length));
  const [ws, wf, wl, wr, wi] = [w((r) => r.status, "status"), w((r) => r.first, "first"), w((r) => r.last, "last"), w((r) => r.runs, "runs"), w((r) => r.id, "id")];
  const lines = [header, `  ${pad("status", ws)}  ${pad("first", wf)}  ${pad("last", wl)}  ${pad("runs", wr)}  ${pad("id", wi)}  finding`];
  for (const r of rows) {
    lines.push(`  ${pad(r.status, ws)}  ${pad(r.first, wf)}  ${pad(r.last, wl)}  ${pad(r.runs, wr)}  ${pad(r.id, wi)}  ${r.text}${r.verdict}`);
  }
  const c = l.state.counts;
  lines.push(`verdicts: ${c.correct} correct, ${c.partial} partial, ${c.wrong} wrong, ${c.unjudged} unjudged`);
  return lines.join("\n");
}

export function runHistory(
  args: HistoryArgs,
  repoDir: string,
  env: Record<string, string | undefined>,
  io: { stdout: (text: string) => void; stderr: (line: string) => void; now?: () => Date },
): number {
  const home = env.HOME;
  if (!home) throw new UsageError("HOME is not set, so the history cannot be found.");
  const root = historyRoot(home);
  const warn = io.stderr;

  if (args.forget) {
    const removed = args.all ? forget(root) : forget(root, repositoryKey(repoDir).key);
    io.stdout(removed.length > 0 ? `${removed.map((p) => `removed ${p}`).join("\n")}\n` : "Nothing to remove.\n");
    return 0;
  }

  if (args.verdict) {
    const { key } = repositoryKey(repoDir);
    const { id, word } = args.verdict;
    const known = replay(readRuns(root, key, warn), new Map()).findings.some((f) => f.firstId === id);
    if (!known) throw new UsageError(`No finding with id ${id} in the history of ${key}; \`wachiman history\` lists the ids.`);
    appendVerdict(root, key, { at: (io.now?.() ?? new Date()).toISOString(), firstId: id, verdict: word, ...(args.reason ? { reason: args.reason } : {}) });
    io.stdout(`Recorded: ${id} is ${word}.\n`);
    return 0;
  }

  const keys = args.allRepos ? listKeys(root) : [repositoryKey(repoDir).key];
  const cutoff = args.sinceDays === undefined ? undefined : (io.now?.() ?? new Date()).getTime() - args.sinceDays * 86_400_000;
  const listed: Listed[] = [];
  for (const key of keys) {
    const runs = readRuns(root, key, warn);
    if (runs.length === 0) continue;
    const state = replay(runs, readVerdicts(root, key));
    if (cutoff !== undefined) {
      state.findings = state.findings.filter((f) => Date.parse(f.lastSeenAt) >= cutoff);
      state.counts = { correct: 0, partial: 0, wrong: 0, unjudged: 0 };
      for (const f of state.findings) state.counts[f.verdict?.verdict ?? "unjudged"]++;
    }
    listed.push({ key, runs, state });
  }

  if (args.json) {
    const repositories = listed.map((l) => {
      const last = l.runs.at(-1)!;
      return {
        key: l.key,
        name: last.repository.name,
        path: last.repository.path,
        ...(last.repository.remote ? { remote: last.repository.remote } : {}),
        runs: l.runs.length,
        firstRunAt: l.runs[0].savedAt,
        lastRunAt: last.savedAt,
        findings: l.state.findings.map((f) => ({ ...f, id: f.firstId })),
        counts: l.state.counts,
      };
    });
    io.stdout(`${JSON.stringify({ format: HISTORY_STATE_FORMAT, repositories }, null, 2)}\n`);
    return 0;
  }
  if (listed.length === 0) {
    io.stdout("No history yet: run `wachiman local --history` to start one.\n");
    return 0;
  }
  io.stdout(`${listed.map(table).join("\n\n")}\n`);
  return 0;
}
