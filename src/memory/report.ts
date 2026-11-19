/**
 * `wachiman memory report` (layer 7, AC13): what the local history says about how memory changes the
 * reviews. Pure: `command.ts` reads the history and the working tree's memory folder and hands them
 * here. No model is called. The command writes nothing except what every history read does: a run file that cannot be read is set aside under a new name, with a warning.
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
import type { MemoryUse } from "./hygiene";

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

/** An entry of the developer's personal memory for this repository: it lives outside the repository and is never counted as repository memory. */
export interface PersonalEntry {
  id: string;
  title: string;
  kind: MemoryKind;
  scope: string;
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
  /** The entries of the personal memory folder of this repository (layer 8), listed apart from `memory`; empty when there are none. */
  personal: PersonalEntry[];
  /** Entries of that folder no run used: see `buildReport`. Null when no use was recorded at all, so none can be called unused. */
  neverUsed: NeverUsedEntry[] | null;
  /** `no-use-recorded` when `neverUsed` is null (no record of use, or one that cannot be read), else null. */
  neverUsedReason: "no-use-recorded" | null;
  /** The day this laptop began recording use (the record's first date), or null when unknown or the record predates it. "Never used" cannot cover days before it. */
  useRecordedSince: string | null;
}

export interface ReportInput {
  runs: HistoryRun[];
  verdicts: Map<string, VerdictLine>;
  /** The text of every `.md` file directly in `.wachiman/memory/`; undefined without the folder. */
  files: Record<string, string> | undefined;
  /** The text of every `.md` file of the personal memory folder for this repository; undefined without one. */
  personalFiles?: Record<string, string>;
  /** Layer 6's local record of use (`readMemoryUse`): entry id to the date of its last use, or why none is known. The only source for "never used". */
  use: MemoryUse;
  /** `YYYY-MM-DD`: only runs saved on or after this day count. */
  since?: string;
}

const zero = (): Outcomes => ({ fixed: 0, wrong: 0, intentional: 0, notImportant: 0, unjudged: 0 });
const blank = (period: string): ReportPeriod => ({ period, comments: 0, outcomes: zero(), muted: { count: 0, byEntry: {} }, memoryLoadedLines: null });

/**
 * `neverUsed` reads the layer 6 record of use, not the runs: an entry is used when the record has a
 * last-use date for its id on or after `since` (any date without `since`) and not before the entry was
 * added (an id reused after an archive and re-add; the same rule as `memory check`). A missing or
 * unreadable record is unknown, never "no entry was used"; a readable record with no dates is a real "none used".
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
    // The last run wins, and a run that recorded no memory resets the value to null instead of keeping an earlier run's.
    const loaded = run.result.memory ? run.result.memory.budget.loadedLines : null;
    p.memoryLoadedLines = loaded;
    total.memoryLoadedLines = loaded;
  }

  // archive.md is never loaded into a review, so it is not live memory: it is left out of the size and the never-used list.
  const names = Object.keys(input.files ?? {}).filter((name) => name !== ARCHIVE_FILE);
  const entries = [...names]
    .sort()
    .flatMap((name) => parseMemoryFile(name, input.files![name]).entries);
  // A missing or unreadable record means use is unknown: that is not "no entry was used".
  const unknown = !input.use.known;
  const lastUse = input.use.known ? input.use.used : {};
  const neverUsed: NeverUsedEntry[] = entries
    .filter((e) => {
      const used = lastUse[e.id];
      return used === undefined || used < e.added || (input.since !== undefined && used < input.since);
    })
    .map((e) => ({ id: e.id, title: e.title, kind: e.kind, scope: e.scope, file: e.file }));

  // Personal entries are listed apart: they are not in the repository, so they never enter the size or the never-used list.
  const personalFiles = input.personalFiles ?? {};
  const personal: PersonalEntry[] = Object.keys(personalFiles)
    .filter((name) => name !== ARCHIVE_FILE)
    .sort()
    .flatMap((name) => parseMemoryFile(name, personalFiles[name]).entries)
    .map((e) => ({ id: e.id, title: e.title, kind: e.kind, scope: e.scope }));

  return {
    format: MEMORY_REPORT_FORMAT,
    since: input.since ?? null,
    empty: runs.length === 0,
    periods: [...periods.values()].sort((a, b) => (a.period < b.period ? -1 : 1)),
    total,
    memory: { present: input.files !== undefined, files: names.length, entries: entries.length, lines: names.reduce((n, name) => n + lineCount(input.files![name]), 0) },
    personal,
    neverUsed: runs.length === 0 ? [] : unknown ? null : neverUsed,
    neverUsedReason: runs.length > 0 && unknown ? "no-use-recorded" : null,
    useRecordedSince: input.use.known ? (input.use.since ?? null) : null,
  };
}

const pad = (text: string, width: number) => text.padEnd(width);

const personalLines = (report: MemoryReport) =>
  report.personal.length === 0
    ? []
    : [`Personal memory (outside the repository, not counted above) (${report.personal.length}):`, ...report.personal.map((e) => `  ${e.id}  ${e.kind}  ${e.scope}  ${e.title}`)];

export function renderReport(report: MemoryReport): string {
  if (report.empty) {
    const window = report.since ? ` since ${report.since}` : "";
    return `No review history${window} for this repository: run \`wachiman local --history\` to start one.\n${personalLines(report).join("\n")}${report.personal.length > 0 ? "\n" : ""}`;
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
  out.push(...personalLines(report));
  if (report.neverUsed === null) out.push("Entries never used: unknown, this laptop has no readable record of use (run `wachiman local --history` to start recording it).");
  else if (report.neverUsed.length === 0) out.push("Entries never used: none.");
  else {
    out.push(`Entries never used (${report.neverUsed.length})${report.useRecordedSince ? `, counting only from ${report.useRecordedSince}, when this laptop began recording use` : ""}:`);
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
