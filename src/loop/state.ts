/**
 * What `wachiman loop` keeps per branch beside the history (ADR 0034): the base the loop started
 * from, the head of every round and the findings it has seen. It is read at the start of a call
 * and rewritten at its end; the review itself is saved by the history, not here.
 *
 * Format `/2` (ADR 0054) adds, per round, what the review reported about itself: the range it read,
 * the engine version, the models, the cost and the time. A `/1` state still reads; its rounds
 * simply have none of that, and the summary says `not recorded` for them.
 */
import { UsageError } from "../config";
import { SEVERITY, TOPIC } from "../engine";
import { readLoopFile, writeLoopFile } from "../history/store";
import type { LoopStatus } from "./stop-rule";

export const LOOP_STATE_FORMAT = "wachiman.loop-state/2";
const LOOP_STATE_FORMAT_V1 = "wachiman.loop-state/1";

/** A finding the loop has seen, as of the last round. The verdict is read fresh from the history every time. */
export interface LedgerEntry {
  id: string;
  path: string;
  line: number;
  severity: keyof typeof SEVERITY;
  topic: keyof typeof TOPIC;
  title: string;
  status: LoopStatus;
  /** The verifier dropped it with a checked disproof; stays true until a round reports it again. */
  refuted: boolean;
  /** Only in states written by the first version of the loop: a `not-repeated` entry whose lines changed counted as released. */
  linesChanged?: boolean;
  /** The round that first reported it. Absent in a state written before `/2`. */
  round?: number;
  /** The cited line without whitespace, or the file's blob when there is no such line: what a later round compares. */
  lineText?: string;
  blobSha?: string;
}

/** A model and the effort it ran at. */
export interface ModelUse {
  model: string;
  effort: string;
}

/**
 * What one review round reported about itself, copied from its result and never estimated. A round
 * that made no review call (no new commit) has none.
 */
export interface RoundReview {
  /** The base sha the review actually read: the merge-base of the round's `from` and its head. */
  base: string;
  /** The Wachiman version that ran the review. */
  version: string;
  reviewer: ModelUse;
  /** Absent when verification was off, and when the verifier was skipped or failed (see `verifierStatus`). */
  verifier?: ModelUse;
  /** Only when verification was on but the verifier made no usable call. */
  verifierStatus?: "skipped" | "failed";
  /** API-equivalent dollars the run reported, the verifier call included. */
  costUsd: number;
  durationMs: number;
  /** How many findings the review reported, and how many of them the loop had not seen before. */
  findings: number;
  newFindings: number;
}

export interface LoopRound {
  round: number;
  /** The full sha of HEAD when the round ran. */
  head: string;
  at: string;
  /** Absent in a `/1` state and in a round that made no review call. */
  review?: RoundReview;
}

export interface LoopState {
  format: typeof LOOP_STATE_FORMAT;
  branch: string;
  /** The ref the loop started from, as typed after `--base`. */
  base: string;
  /** `open` until a round converges. */
  status: "open" | "converged";
  /** The round cap of the last call that set it. Absent in a `/1` state. */
  maxRounds?: number;
  /** How many rounds were recorded when the current pass began: 0 or absent from the start, later after a continued convergence. The budget counts rounds since then. */
  passFrom?: number;
  rounds: LoopRound[];
  ledger: LedgerEntry[];
}

const STATUSES: readonly string[] = ["new", "open", "probably-fixed", "not-repeated", "unknown"];

const text = (v: any) => typeof v === "string" && v !== "";
const modelUse = (v: any) => v && text(v.model) && text(v.effort);
const count = (v: any) => Number.isInteger(v) && v >= 0;

function validReview(r: any): boolean {
  return (
    r &&
    text(r.base) &&
    text(r.version) &&
    modelUse(r.reviewer) &&
    (r.verifier === undefined || modelUse(r.verifier)) &&
    (r.verifierStatus === undefined || r.verifierStatus === "skipped" || r.verifierStatus === "failed") &&
    typeof r.costUsd === "number" &&
    r.costUsd >= 0 &&
    typeof r.durationMs === "number" &&
    r.durationMs >= 0 &&
    count(r.findings) &&
    count(r.newFindings)
  );
}

function valid(s: any, branch: string): s is LoopState {
  return (
    s &&
    typeof s === "object" &&
    (s.format === LOOP_STATE_FORMAT || s.format === LOOP_STATE_FORMAT_V1) &&
    s.branch === branch &&
    typeof s.base === "string" &&
    (s.status === "open" || s.status === "converged") &&
    (s.maxRounds === undefined || (Number.isInteger(s.maxRounds) && s.maxRounds > 0)) &&
    (s.passFrom === undefined || (Number.isInteger(s.passFrom) && s.passFrom >= 0)) &&
    Array.isArray(s.rounds) &&
    s.rounds.every(
      (r: any) => r && Number.isInteger(r.round) && typeof r.head === "string" && typeof r.at === "string" && (r.review === undefined || validReview(r.review)),
    ) &&
    Array.isArray(s.ledger) &&
    s.ledger.every(
      (e: any) =>
        e &&
        typeof e.id === "string" &&
        typeof e.path === "string" &&
        typeof e.line === "number" &&
        e.severity in SEVERITY &&
        e.topic in TOPIC &&
        typeof e.title === "string" &&
        STATUSES.includes(e.status) &&
        typeof e.refuted === "boolean" &&
        (e.round === undefined || Number.isInteger(e.round)) &&
        (e.linesChanged === undefined || typeof e.linesChanged === "boolean") &&
        (e.lineText === undefined || typeof e.lineText === "string") &&
        (e.blobSha === undefined || typeof e.blobSha === "string"),
    )
  );
}

/** The branch's loop, or undefined when none was started. A file that does not read as a loop state is a usage error naming what to do. */
export function readLoop(root: string, key: string, branch: string): LoopState | undefined {
  const raw = readLoopFile(root, key, branch);
  if (raw === undefined) return undefined;
  if (!valid(raw, branch)) throw new UsageError(`The loop state of ${branch} is not readable by this version; start a new loop with \`wachiman loop --base <ref>\`.`);
  // A `/1` state is read as it is and written back as `/2`: its rounds just carry no review data.
  return raw.format === LOOP_STATE_FORMAT ? raw : { ...raw, format: LOOP_STATE_FORMAT };
}

export const writeLoop = (root: string, key: string, state: LoopState) => writeLoopFile(root, key, state.branch, state);
