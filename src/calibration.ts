/**
 * Calibration maths for the finding priority (layer 2): pure functions, no I/O. A Wilson interval
 * says how sure a rate is, and a word moves only when that interval leaves its band. The outcome
 * counts per cell live in `calibrate/report.ts`.
 */
import type { Priority } from "./priority";

type Word = Exclude<Priority, "must">;

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
