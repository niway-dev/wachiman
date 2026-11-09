/**
 * The two public, versioned formats of the review core (spec D15, ADR 0019 decision 9). The JSON
 * Schemas in `docs/formats/` are the contract; these types follow them. Inside `/1` only optional
 * fields are added; removing, renaming or retyping a field is `/2`.
 */
import { UsageError } from "./config";
import type { Contract } from "./contracts";
import type { TokenUsage } from "./cost";
import type { BaseInstructions, BatchReport, Finding, ReviewFile, ReviewOutput, Thread, Unreviewable } from "./engine";
import type { ProviderErrorClass } from "./providers/errors";
import type { ResultVerification } from "./verify";

export const REVIEW_INPUT_FORMAT = "wachiman.review-input/1";
export const REVIEW_RESULT_FORMAT = "wachiman.review-result/1";

export type { ReviewFile };

export interface ReviewChange {
  kind: "pull-request" | "branch";
  /** One sentence for the prompt's first line and every report's headline. */
  describe: string;
  repository: { name: string; url?: string };
  /** `base.sha` for a pull request (ADR 0006); the merge-base for a local branch. */
  base: { sha: string; ref?: string };
  head: { sha: string; ref?: string };
  title?: string;
  description?: string;
  author?: string;
  /** "#479", "!12". */
  identifier?: string;
}

export interface ReviewInput {
  format: typeof REVIEW_INPUT_FORMAT;
  change: ReviewChange;
  files: ReviewFile[];
  /** Read from `change.base.sha` by the connector (ADR 0006). */
  instructions: BaseInstructions;
  /** In memory only, never in a file: the checkout or snapshot of `change.head.sha`. */
  headDir: string;
  /** The words after `review`, or the local paths; empty for the whole change. */
  scope: string[];
  /**
   * Incremental context: the last reviewed commit, whether the change was rebased since, and
   * (optional) the commits since it, oldest first, for the report's headline.
   */
  since?: { sha: string; rebased: boolean; commits?: string[] };
  /** Open threads for the model to answer. */
  conversation?: Thread[];
}

/** Which Claude Code profile ran the review; every GitHub-mode run is "ci". */
export type Profile = "ci" | "default" | "isolated";
export type Stop = "complete" | "budget" | "turns" | "timeout" | "quota" | "error";

export interface ResultFinding extends Finding {
  /** Whether the line is one a diff-anchored comment can target (`commentableLines`). */
  anchor: "diff" | "outside";
  /** Reserved (spec Q7): filled once the model is asked how it verified a finding. */
  verification?: { checked: string; example?: string };
}

export interface ReviewResult {
  format: typeof REVIEW_RESULT_FORMAT;
  change: ReviewChange & { snapshot?: string };
  engine: { version: string };
  provider: { label: string; model: string; effort: string; profile: Profile };
  coverage: {
    /** The files kept for review, after the scope and the excludes. */
    expected: string[];
    reviewed: string[];
    /** Closed skip reasons and the "not reached" entries. */
    skipped: { path: string; reason: string }[];
    /** How many files within the scope the excludes dropped (lockfiles, build output, generated). */
    excluded: number;
    /**
     * Files the engine left out of `expected` because no model can review them (binaries), so
     * they never make a review partial. Absent in a result written before this field existed.
     */
    unreviewable?: Unreviewable[];
    partial: boolean;
  };
  /** After the confidence rule, the ADR notices and dedupe. */
  findings: ResultFinding[];
  contracts: Contract[];
  summary: string;
  batches: BatchReport[];
  /** Empty without a conversation. */
  threadReplies: ReviewOutput["thread_replies"];
  instructionChanges: { files: string[]; baseSha: string };
  execution: {
    /** `total_cost_usd` summed: an API-equivalent estimate, never a bill on a subscription. */
    costUsdEstimate: number;
    usage: TokenUsage;
    /** Provider calls, retries included. */
    calls: number;
    /** Calls (retries included) that returned a review; 0 means nothing was reviewed. */
    callsWithOutput: number;
    turns: number;
    durationMs: number;
    stop: Stop;
    /** The first provider rejection, when a call was refused (`src/providers/errors.ts`). */
    rejection?: { kind: ProviderErrorClass; text: string };
    /** Every warning the core logged. */
    notices: string[];
  };
  /**
   * The verifier's verdicts (ADR 0027), present only when it was turned on. `findings` above is
   * what survived it; a dropped finding is only here.
   */
  verification?: ResultVerification;
}

/** The core refuses a version it does not know (D15). A usage error, not an engine error. */
export function assertReviewInputFormat(input: { format?: unknown }): asserts input is { format: typeof REVIEW_INPUT_FORMAT } {
  if (input.format !== REVIEW_INPUT_FORMAT) {
    throw new UsageError(
      `Unknown review input format ${JSON.stringify(input.format)}; this engine reads ${REVIEW_INPUT_FORMAT}.`,
    );
  }
}
