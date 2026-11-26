/**
 * The finding priority (ADR 0059, spec 2026-11-18): a word the engine derives from severity,
 * confidence and topic through a versioned calibration table. The model never supplies it, the
 * rank is recorded but not used to order findings yet, and nothing gates on either. Layer 1 ships
 * table v1, seeded and not measured.
 */
import { createHash } from "node:crypto";
import type { Confidence, Severity, Topic } from "./engine";

export type Priority = "must" | "should" | "could" | "fyi";

/** Lowest first, so a higher index is the stronger word. */
const ORDER: readonly Priority[] = ["fyi", "could", "should", "must"];

/** The rank a seed gives each word, and the rank a floor or a cap falls back to. */
const SEED_RANK: Record<Priority, number> = { must: 90, should: 70, could: 40, fyi: 10 };

/** Where a cell's word came from: set by hand, or fitted to outcomes (layer 2 fills the counts). */
export type Provenance = { basis: "seed" } | { basis: "calibrated"; n: number; prs: number; model: string; promptVersion: string };

/** One severity x confidence cell. The rank (0-100) is recorded for each finding, not used to order findings yet, and never displayed. */
export interface Cell {
  priority: Priority;
  rank: number;
  provenance: Provenance;
}

export interface CalibrationTable {
  version: string;
  cells: Record<Severity, Record<Confidence, Cell>>;
}

const seed = (priority: Priority): Cell => ({ priority, rank: SEED_RANK[priority], provenance: { basis: "seed" } });
const row = (high: Priority, medium: Priority, low: Priority): Record<Confidence, Cell> => ({
  high: seed(high),
  medium: seed(medium),
  low: seed(low),
});

/** Spec decision 4. Seeds are set, not computed from fix rates: a fix rate measures compliance. */
export const TABLE_V1: CalibrationTable = {
  version: "v1",
  cells: {
    blocker: row("must", "must", "could"),
    fix: row("should", "should", "could"),
    consider: row("should", "could", "could"),
    info: row("fyi", "fyi", "fyi"),
  },
};

/** Topics where a missed fix is a defect: their Fix is at least Should (decision 10). */
const DEFECT_TOPICS: readonly Topic[] = ["bug", "security", "perf"];

export interface PriorityResult {
  priority: Priority;
  rank: number;
  basis: Provenance["basis"];
  tableVersion: string;
}

const stronger = (a: Priority, b: Priority) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
const weaker = (a: Priority, b: Priority) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

/**
 * The priority of a finding as it will be posted (after verification). Precedence, decision 10:
 * a low-confidence Blocker or Fix is a question and at most Could; Info is FYI; every other
 * Blocker is Must; every other Fix on a defect topic is at least Should. The table's cell can
 * raise a word above its floor, never lower it. A finding without confidence uses the medium cell.
 */
export function priorityOf(
  f: { severity: Severity; topic: Topic; confidence?: Confidence },
  table: CalibrationTable = TABLE_V1,
): PriorityResult {
  const confidence = f.confidence ?? "medium";
  const cell = table.cells[f.severity][confidence];
  const demanding = f.severity === "blocker" || f.severity === "fix";
  let priority = cell.priority;
  if (f.severity === "info") priority = "fyi";
  else if (demanding && confidence === "low") priority = weaker(priority, "could");
  else if (f.severity === "blocker") priority = stronger(priority, "must");
  else if (f.severity === "fix" && DEFECT_TOPICS.includes(f.topic)) priority = stronger(priority, "should");
  return {
    priority,
    // A word the rule moved takes that word's seed rank; otherwise the cell's own.
    rank: priority === cell.priority ? cell.rank : SEED_RANK[priority],
    basis: cell.provenance.basis,
    tableVersion: table.version,
  };
}

export const PRIORITY_WORD: Record<Priority, string> = { must: "Must", should: "Should", could: "Could", fyi: "FYI" };

/** What each word asks of the reader, shown beside it in the inline table. */
export const PRIORITY_GLOSS: Record<Priority, string> = {
  must: "blocks the merge",
  should: "a change is expected; answer if you disagree",
  could: "worth a look; change on the merits",
  fyi: "context, no code decision",
};

/** Which word a pull request's comments show during the trial (ADR 0059 decision 10). */
export type Arm = "word" | "priority";

/**
 * The arm of a pull request: the parity of the first byte of `sha256("<repo>#<number>")`. Pure, so a push
 * never changes it and nothing is stored; the repository is in the key so two repositories do not move together.
 */
export function armFor(repo: string, prNumber: number): Arm {
  const first = createHash("sha256").update(`${repo}#${prNumber}`).digest()[0];
  return first % 2 === 0 ? "word" : "priority";
}
