/**
 * The shapes of the history files. The run file is internal and versioned
 * (`wachiman.history-run/1`); the `ReviewResult` it embeds is the public format, unchanged.
 */
import type { ReviewResult } from "../engine";

export const HISTORY_RUN_FORMAT = "wachiman.history-run/1";

/** What a run decided about each of its own findings. */
export interface Tracking {
  id: string;
  status: "new" | "open";
  firstId: string;
  /** The full sha of the first sighting. */
  firstHead: string;
  /** Sightings so far, this one included. */
  runs: number;
  reopened: number;
  titleKey: string;
  lineHash?: string;
  /** The cited line without whitespace; a hash cannot be searched for, the text can. */
  lineText?: string;
  blobSha?: string;
  matchedBy?: "line" | "title";
}

/** An earlier finding this run decided about. */
export interface Settled {
  firstId: string;
  status: "probably-fixed" | "not-repeated";
  path: string;
  line: number;
  title: string;
  lastHead: string;
}

export interface HistoryRepository {
  key: string;
  name: string;
  keyedBy: "remote" | "path";
  /** Credentials stripped; absent when keyed by path or when the URL did not parse. */
  remote?: string;
  path: string;
}

export interface HistoryRun {
  format: typeof HISTORY_RUN_FORMAT;
  savedAt: string;
  engine: { version: string };
  repository: HistoryRepository;
  result: ReviewResult;
  /** One per `result.findings[i]`, same order. */
  tracking: Tracking[];
  settled: Settled[];
  /** How many open findings sit in files this run did not review. */
  unknown: number;
  /** The first ids of those findings, so a replay can say which ones are unsettled. */
  unknownIds: string[];
}

export type VerdictWord = "correct" | "partial" | "wrong";
export const VERDICT_WORDS: readonly VerdictWord[] = ["correct", "partial", "wrong"];

export interface VerdictLine {
  at: string;
  firstId: string;
  verdict: VerdictWord;
  reason?: string;
}
