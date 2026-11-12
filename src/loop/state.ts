/**
 * What `wachiman loop` keeps per branch beside the history (ADR 0034): the base the loop started
 * from, the head of every round and the findings it has seen. It is read at the start of a call
 * and rewritten at its end; the review itself is saved by the history, not here.
 */
import { UsageError } from "../config";
import { SEVERITY, TOPIC } from "../engine";
import { readLoopFile, writeLoopFile } from "../history/store";
import type { LoopStatus } from "./stop-rule";

export const LOOP_STATE_FORMAT = "wachiman.loop-state/1";

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
  linesChanged: boolean;
}

export interface LoopRound {
  round: number;
  /** The full sha of HEAD when the round ran. */
  head: string;
  at: string;
}

export interface LoopState {
  format: typeof LOOP_STATE_FORMAT;
  branch: string;
  /** The ref the loop started from, as typed after `--base`. */
  base: string;
  /** `open` until a round converges. */
  status: "open" | "converged";
  rounds: LoopRound[];
  ledger: LedgerEntry[];
  /**
   * The names of the history run files the loop's own rounds saved. The loop replays only these, so a
   * review outside the loop (another branch, `wachiman local`) cannot settle its findings. A state
   * written before this field existed has none: its runs are not known, and the ledger carries on.
   */
  runs?: string[];
}

const STATUSES: readonly string[] = ["new", "open", "probably-fixed", "not-repeated", "unknown"];

function valid(s: any, branch: string): s is LoopState {
  return (
    s &&
    typeof s === "object" &&
    s.format === LOOP_STATE_FORMAT &&
    s.branch === branch &&
    typeof s.base === "string" &&
    (s.status === "open" || s.status === "converged") &&
    (s.runs === undefined || (Array.isArray(s.runs) && s.runs.every((n: unknown) => typeof n === "string"))) &&
    Array.isArray(s.rounds) &&
    s.rounds.every((r: any) => r && Number.isInteger(r.round) && typeof r.head === "string" && typeof r.at === "string") &&
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
        typeof e.linesChanged === "boolean",
    )
  );
}

/** The branch's loop, or undefined when none was started. A file that does not read as a loop state is a usage error naming what to do. */
export function readLoop(root: string, key: string, branch: string): LoopState | undefined {
  const raw = readLoopFile(root, key, branch);
  if (raw === undefined) return undefined;
  if (!valid(raw, branch)) throw new UsageError(`The loop state of ${branch} is not readable by this version; start a new loop with \`wachiman loop --base <ref>\`.`);
  return raw;
}

export const writeLoop = (root: string, key: string, state: LoopState) => writeLoopFile(root, key, state.branch, state);
