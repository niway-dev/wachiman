/**
 * The stop rule of `wachiman loop` (ADR 0034 decision 5), pure: no filesystem, no git, no model.
 * The command gathers one `LoopFinding` per finding the loop has seen and this module says which
 * of them keep the loop open.
 *
 * The loop stays open while a 🔴 Blocker or 🟠 Fix is new, open or not-repeated, not refuted by the
 * verifier and not judged `wrong` with a reason. 🟡 Consider and ⚪ Info are listed as notes and
 * never count.
 *
 * The command sets the status from the round's own result and the code, not from the history: a
 * finding the round reported again is `open`; in a file the round read, one it did not report is
 * `probably-fixed` when its cited line is gone and `not-repeated` (still counts) when the line is
 * still there; a file the round did not read keeps the previous status, so an `unknown` Blocker or
 * Fix from a state written by the first version stays open until its file is read. When the cited
 * line is short, repeated or line 0, the file's blob is fingerprinted instead and any edit to the
 * file releases the finding. `linesChanged` exists only in states written by the first version.
 */
import type { Severity, Topic } from "../engine";
import type { VerdictWord } from "../history/types";

export type LoopStatus = "new" | "open" | "probably-fixed" | "not-repeated" | "unknown";

export interface LoopFinding {
  /** The history id, the finding's first id. */
  id: string;
  path: string;
  line: number;
  severity: Severity;
  topic: Topic;
  title: string;
  /** The status after this round, decided by the loop. */
  status: LoopStatus;
  /** The verifier dropped this finding with a checked disproof in this round. */
  refuted: boolean;
  /** Only from a state written by the first version of the loop: a `not-repeated` finding whose lines changed counts as released. */
  linesChanged?: boolean;
  verdict?: { verdict: VerdictWord; reason?: string };
}

export type ReleaseWhy = "probably-fixed" | "refuted" | "judged wrong";

export interface OpenFinding extends LoopFinding {
  /** Judged `wrong` with no reason: it is listed and still counts. */
  unreasonedWrong?: true;
}

export interface Released {
  finding: LoopFinding;
  why: ReleaseWhy;
  /** The reason the developer or agent gave, for `judged wrong`. */
  reason?: string;
}

export interface Decision {
  open: OpenFinding[];
  released: Released[];
  /** 🟡 and ⚪ that are not released: listed, never counted. */
  notes: LoopFinding[];
  converged: boolean;
}

const COUNTS: readonly Severity[] = ["blocker", "fix"];

export function evaluate(findings: LoopFinding[]): Decision {
  const open: OpenFinding[] = [];
  const released: Released[] = [];
  const notes: LoopFinding[] = [];
  for (const f of findings) {
    const reason = f.verdict?.verdict === "wrong" ? f.verdict.reason?.trim() : undefined;
    if (!COUNTS.includes(f.severity)) {
      // A note a verdict, the verifier or a fix already settled is not worth listing again.
      if (f.status === "probably-fixed" || f.refuted || reason) continue;
      notes.push(f);
    } else if (reason) released.push({ finding: f, why: "judged wrong", reason });
    else if (f.refuted) released.push({ finding: f, why: "refuted" });
    else if (f.status === "probably-fixed" || (f.status === "not-repeated" && f.linesChanged)) released.push({ finding: f, why: "probably-fixed" });
    else open.push(f.verdict?.verdict === "wrong" ? { ...f, unreasonedWrong: true } : f);
  }
  return { open, released, notes, converged: open.length === 0 };
}

/** A loop that already ran `max` rounds stops before another one: three by default. */
export const roundCapReached = (roundsRun: number, max: number) => roundsRun >= max;

/**
 * Whether a candidate the verifier dropped with a checked disproof is a finding the loop already
 * tracks. A dropped candidate has no history id (it was never reported), so it is matched the way
 * the history matches a title: the same file and the same title key, or the same file, topic and
 * line.
 */
export function isRefutedBy(
  dropped: { path: string; line: number; topic: Topic; titleKey: string },
  tracked: { path: string; line: number; topic: Topic; titleKey: string },
): boolean {
  if (dropped.path !== tracked.path) return false;
  return dropped.titleKey === tracked.titleKey || (dropped.topic === tracked.topic && dropped.line === tracked.line);
}
