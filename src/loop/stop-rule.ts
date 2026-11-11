/**
 * The stop rule of `wachiman loop` (ADR 0034 decision 5), pure: no filesystem, no git, no model.
 * The command gathers one `LoopFinding` per finding the loop has seen and this module says which
 * of them keep the loop open.
 *
 * The loop stays open while a 🔴 Blocker or 🟠 Fix is new, open, not-repeated (or unknown: the
 * round did not read its file, so nobody has settled it), not refuted by the verifier and not judged
 * `wrong` with a reason. 🟡 Consider and ⚪ Info are listed as notes and never count.
 *
 * `not-repeated` is the history's word for "the file was read, its lines did not change and the run
 * did not report it". A later round only reads the fix commits, so that proves nothing about the
 * lines: the finding is released only when a later round's range changed its lines and that round
 * did not report it again. The command computes that fact (`linesChanged`); a round that did report
 * it again has the status `open`, so `linesChanged` alone never releases a reported finding.
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
  /** The history status after this round. */
  status: LoopStatus;
  /** The verifier dropped this finding with a checked disproof in this round. */
  refuted: boolean;
  /** For a `not-repeated` finding: this round's range changed its lines and the round read the file. */
  linesChanged: boolean;
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
