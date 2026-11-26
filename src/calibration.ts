/**
 * Calibration maths for the finding priority (layer 2): pure functions, no I/O. Outcomes are
 * counted per severity x confidence cell, a Wilson interval says how sure a rate is, and a word
 * moves only when that interval leaves its band.
 */
import type { Priority } from "./priority";

type Word = Exclude<Priority, "must">;
type Severity = "blocker" | "fix" | "consider" | "info";
type Confidence = "high" | "medium" | "low";

/** z for a 90% two-sided interval. */
const Z90 = 1.6448536269514722;
const WORDS: readonly Word[] = ["fyi", "could", "should"];

/** Wilson score interval for a proportion, clamped to [0, 1]. No data means no information: [0, 1]. */
export function wilsonInterval(successes: number, n: number, z = Z90): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** Rank bands (0-100): at least 60 is Should, 25 up to 60 is Could, below 25 is FYI. */
export function bandOf(rank: number): Word {
  if (rank >= 60) return "should";
  if (rank >= 25) return "could";
  return "fyi";
}

/**
 * A word keeps its band until its 90% interval leaves it. Eligible only with at least 20 judged
 * findings from at least 5 distinct pull requests; otherwise the word stays and is not measured.
 */
export function movedWord(current: Word, judgedYes: number, judgedN: number, distinctPrs: number): { word: Word; measured: boolean } {
  if (judgedN < 20 || distinctPrs < 5) return { word: current, measured: false };
  const { low, high } = wilsonInterval(judgedYes, judgedN);
  const at = WORDS.indexOf(current);
  const up = WORDS.indexOf(bandOf(100 * low));
  const down = WORDS.indexOf(bandOf(100 * high));
  if (up > at) return { word: WORDS[up], measured: true };
  if (down < at) return { word: WORDS[down], measured: true };
  return { word: current, measured: true };
}

/** One judged finding: the author's reply on its thread ("none" is unanswered) and its PR number. */
export type Finding = { severity: Severity; confidence: Confidence | undefined; reply: "fixed" | "declined" | "none"; pr: number };

/** Counts for one cell. An undefined confidence means "not measured" and is never merged with medium. */
export type CellCount = {
  severity: Severity;
  confidence: Confidence | undefined;
  answered: number;
  fixed: number;
  declined: number;
  unanswered: number;
  prs: number;
};

const SEVERITIES: readonly Severity[] = ["blocker", "fix", "consider", "info"];
const CONFIDENCES: readonly (Confidence | undefined)[] = ["high", "medium", "low", undefined];

export function aggregateCells(findings: Finding[]): CellCount[] {
  const cells = new Map<string, { row: CellCount; prs: Set<number> }>();
  for (const f of findings) {
    const key = `${f.severity}|${f.confidence ?? "unmeasured"}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        row: { severity: f.severity, confidence: f.confidence, answered: 0, fixed: 0, declined: 0, unanswered: 0, prs: 0 },
        prs: new Set(),
      };
      cells.set(key, cell);
    }
    if (f.reply === "fixed") cell.row.fixed++;
    else if (f.reply === "declined") cell.row.declined++;
    else cell.row.unanswered++;
    cell.row.answered = cell.row.fixed + cell.row.declined;
    cell.prs.add(f.pr);
  }
  return [...cells.values()]
    .map(({ row, prs }) => ({ ...row, prs: prs.size }))
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        CONFIDENCES.indexOf(a.confidence) - CONFIDENCES.indexOf(b.confidence),
    );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const percent = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`);

/** Plain-text table, one row per cell. Percentages are shares of the answered findings. */
export function formatCellTable(rows: CellCount[]): string {
  const header = ["Severity · confidence", "Answered", "Fixed", "Declined", "Unanswered"];
  const body = rows.map((r) => [
    `${capital(r.severity)} · ${r.confidence ?? "not measured"}`,
    String(r.answered),
    percent(r.fixed, r.answered),
    percent(r.declined, r.answered),
    String(r.unanswered),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cols: string[]) =>
    cols
      .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join("  ")
      .trimEnd();
  return [line(header), ...body.map(line)].join("\n");
}
