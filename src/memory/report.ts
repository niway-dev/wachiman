/**
 * `wachiman memory report` (layer 7, AC13): what the local history says about how memory changes the
 * reviews. Pure: `command.ts` reads the history and the working tree's memory folder and hands them
 * here. No model is called and nothing is written.
 *
 * A comment is a finding a run posted. It is counted once, in the month of the run that first saw it
 * (the history's own matching decides when the same finding comes back), and by its outcome today:
 * `wrong`, `intentional` or `not-important` when the developer judged it (`wachiman history
 * --verdict`), else `fixed` when the loop settled it as probably fixed, else `unjudged`. A `correct`
 * or `partial` verdict without a fix stays `unjudged`: the finding was right, nothing happened to it yet.
 */
import { UsageError } from "../config";
import { replay } from "../history/match";
import type { HistoryRun, VerdictLine } from "../history/types";
import { parseMemoryFile, type MemoryKind } from "./entries";
import { ARCHIVE_FILE, lineCount, MEMORY_DIR } from "./load";

export const MEMORY_REPORT_FORMAT = "wachiman.memory-report/1";

export interface Outcomes {
  fixed: number;
  wrong: number;
  intentional: number;
  notImportant: number;
  unjudged: number;
}

export interface ReportPeriod {
  /** `YYYY-MM` (UTC), or `total`. */
  period: string;
  comments: number;
  outcomes: Outcomes;
  /** Findings an exception muted in this period's runs, and how many each entry muted. */
  muted: { count: number; byEntry: Record<string, number> };
  /** Lines of memory the period's last run loaded; null when none of its runs recorded memory. */
  memoryLoadedLines: number | null;
}

export interface NeverUsedEntry {
  id: string;
  title: string;
  kind: MemoryKind;
  scope: string;
  file: string;
}

export interface MemoryReport {
  format: typeof MEMORY_REPORT_FORMAT;
  /** The `--since` date, or null. */
  since: string | null;
  /** No run of the history falls in the window. */
  empty: boolean;
  periods: ReportPeriod[];
  total: ReportPeriod;
  /** The working tree's `.wachiman/memory/`, now. */
  memory: { present: boolean; files: number; entries: number; lines: number };
  /** Entries of that folder no run used: see `buildReport`. */
  neverUsed: NeverUsedEntry[];
}

export interface ReportInput {
  runs: HistoryRun[];
  verdicts: Map<string, VerdictLine>;
  /** The text of every `.md` file directly in `.wachiman/memory/`; undefined without the folder. */
  files: Record<string, string> | undefined;
  /** Layer 6's local record of use (`readMemoryUse`): entry id to the date of its last use. The only source for "never used". */
  used: Record<string, string>;
  /** `YYYY-MM-DD`: only runs saved on or after this day count. */
  since?: string;
}

const zero = (): Outcomes => ({ fixed: 0, wrong: 0, intentional: 0, notImportant: 0, unjudged: 0 });
const blank = (period: string): ReportPeriod => ({ period, comments: 0, outcomes: zero(), muted: { count: 0, byEntry: {} }, memoryLoadedLines: null });

/**
 * `neverUsed` reads the layer 6 record of use, not the runs: an entry is used when the record has a
 * last-use date for its id on or after `since` (any date without `since`).
 */
export function buildReport(input: ReportInput): MemoryReport {
  const inWindow = (run: HistoryRun) => input.since === undefined || run.savedAt.slice(0, 10) >= input.since;
  const runs = input.runs.filter(inWindow);
  const state = replay(input.runs, input.verdicts);
  const stateOf = new Map(state.findings.map((f) => [f.firstId, f]));

  const periods = new Map<string, ReportPeriod>();
  const total = blank("total");
  const periodOf = (run: HistoryRun) => {
    const key = run.savedAt.slice(0, 7);
    let p = periods.get(key);
    if (!p) periods.set(key, (p = blank(key)));
    return p;
  };

  const counted = new Set<string>();
  for (const run of input.runs) {
    const p = inWindow(run) ? periodOf(run) : undefined;
    run.result.findings.forEach((_, i) => {
      const t = run.tracking[i];
      if (!t || counted.has(t.firstId)) return;
      counted.add(t.firstId);
      if (!p) return;
      const found = stateOf.get(t.firstId);
      const word = found?.verdict?.verdict;
      const key: keyof Outcomes = word === "wrong" ? "wrong" : word === "intentional" ? "intentional" : word === "not-important" ? "notImportant" : found?.status === "probably-fixed" ? "fixed" : "unjudged";
      for (const target of [p, total]) {
        target.comments++;
        target.outcomes[key]++;
      }
    });
    if (!p) continue;
    for (const m of run.result.muted ?? []) {
      for (const target of [p, total]) {
        target.muted.count++;
        target.muted.byEntry[m.entry] = (target.muted.byEntry[m.entry] ?? 0) + 1;
      }
    }
    if (run.result.memory) {
      p.memoryLoadedLines = run.result.memory.budget.loadedLines;
      total.memoryLoadedLines = run.result.memory.budget.loadedLines;
    }
  }

  // archive.md is never loaded into a review, so it is not live memory: it is left out of the size and the never-used list.
  const names = Object.keys(input.files ?? {}).filter((name) => name !== ARCHIVE_FILE);
  const entries = [...names]
    .sort()
    .flatMap((name) => parseMemoryFile(name, input.files![name]).entries);
  const neverUsed: NeverUsedEntry[] = entries
    .filter((e) => input.used[e.id] === undefined || (input.since !== undefined && input.used[e.id] < input.since))
    .map((e) => ({ id: e.id, title: e.title, kind: e.kind, scope: e.scope, file: e.file }));

  return {
    format: MEMORY_REPORT_FORMAT,
    since: input.since ?? null,
    empty: runs.length === 0,
    periods: [...periods.values()].sort((a, b) => (a.period < b.period ? -1 : 1)),
    total,
    memory: { present: input.files !== undefined, files: names.length, entries: entries.length, lines: names.reduce((n, name) => n + lineCount(input.files![name]), 0) },
    neverUsed: runs.length === 0 ? [] : neverUsed,
  };
}

const pad = (text: string, width: number) => text.padEnd(width);

export function renderReport(report: MemoryReport): string {
  if (report.empty) {
    const window = report.since ? ` since ${report.since}` : "";
    return `No review history${window} for this repository: run \`wachiman local --history\` to start one.\n`;
  }
  const head = ["period", "comments", "fixed", "wrong", "intentional", "not important", "unjudged", "muted", "memory lines"];
  const row = (p: ReportPeriod) => [p.period, p.comments, p.outcomes.fixed, p.outcomes.wrong, p.outcomes.intentional, p.outcomes.notImportant, p.outcomes.unjudged, p.muted.count, p.memoryLoadedLines ?? "-"].map(String);
  const rows = [...report.periods, report.total].map(row);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? pad(c, widths[i]) : c.padStart(widths[i]))).join("  ").trimEnd();
  const out = [line(head), ...rows.map(line), ""];

  const muters = Object.entries(report.total.muted.byEntry).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  out.push(muters.length === 0 ? "Muted by memory: nothing." : `Muted by memory, by entry: ${muters.map(([id, n]) => `${id}: ${n}`).join(", ")}`);
  const m = report.memory;
  out.push(m.present ? `Memory now (${MEMORY_DIR}/ in the working tree): ${m.files} files, ${m.entries} entries, ${m.lines} lines.` : `Memory now: no ${MEMORY_DIR}/ folder in the working tree.`);
  if (report.neverUsed.length === 0) out.push("Entries never used: none.");
  else {
    out.push(`Entries never used (${report.neverUsed.length}):`);
    for (const e of report.neverUsed) out.push(`  ${e.id}  ${e.kind}  ${e.scope}  ${e.title}  (${e.file})`);
  }
  out.push("memory lines = lines of memory the period's last review loaded; a - means no review in it recorded memory.");
  return `${out.join("\n")}\n`;
}

export interface ReportArgs {
  since?: string;
  format: "terminal" | "json";
}

const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The arguments after `report` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseReportArgs(argv: string[]): ReportArgs {
  const args: ReportArgs = { format: "terminal" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new UsageError(`wachiman memory report takes no argument, got "${arg}".`);
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = () => {
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined || v === "" || (eq === -1 && v.startsWith("--"))) throw new UsageError(`${name} needs a value.`);
      return v;
    };
    if (name === "--since") {
      const v = value();
      let ok = false;
      try {
        ok = validDay(v);
      } catch {
        ok = false;
      }
      if (!ok) throw new UsageError(`--since takes a date such as 2026-11-01, got "${v}".`);
      args.since = v;
    } else if (name === "--format") {
      const v = value();
      if (v !== "terminal" && v !== "json") throw new UsageError(`--format must be terminal or json, got "${v}".`);
      args.format = v;
    } else throw new UsageError(`Unknown option "${name}" for wachiman memory report.`);
  }
  return args;
}
