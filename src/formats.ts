/**
 * The public, versioned formats of the review core (spec D15, ADR 0019 decision 9). The JSON
 * Schemas in `docs/formats/` are the contract; these types follow them. Inside a version only
 * optional fields are added; removing, renaming or retyping a field, or adding a field a closed
 * object does not allow, is the next version. The review input is `/1`; the review result is `/2`
 * inside the core and `/1` on the wire by default for committed changes (ADR 0030).
 */
import { UsageError } from "./config";
import type { Contract } from "./contracts";
import type { TokenUsage } from "./cost";
import type { Fidelity } from "./fidelity/types";
import type {
  BaseInstructions,
  BatchReport,
  Finding,
  ReviewFile,
  ReviewOutput,
  Severity,
  Thread,
  Topic,
  Unreviewable,
} from "./engine";
import type { ProviderErrorClass } from "./providers/errors";
import type { RiskMap } from "./risk";

export const REVIEW_INPUT_FORMAT = "wachiman.review-input/1";
export const REVIEW_INPUT_V2 = "wachiman.review-input/2";
/** The result as committed-change JSON consumers know it: closed root, no verification block. */
export const REVIEW_RESULT_V1 = "wachiman.review-result/1";
/** The result the core produces: `/1` plus origin, per-finding verification and the verification record. */
export const REVIEW_RESULT_V2 = "wachiman.review-result/2";

export type { ReviewFile };

export interface CommittedReviewChange {
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

export type ReviewChange =
  | CommittedReviewChange
  | (Omit<CommittedReviewChange, "kind"> & {
      kind: "working-tree";
      workingTree: { mode: "staged" | "all"; baseCommit: string; tree: string };
    });

export interface ReviewInput {
  format: typeof REVIEW_INPUT_FORMAT | typeof REVIEW_INPUT_V2;
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

/** A finding as `/1` carries it. */
export interface ResultFindingV1 extends Finding {
  /** Whether the line is one a diff-anchored comment can target (`commentableLines`). */
  anchor: "diff" | "outside";
  /** Reserved (spec Q7): filled once the model is asked how it verified a finding. */
  verification?: { checked: string; example?: string };
}

type Coverage = {
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

type Execution = {
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

/** `wachiman.review-result/1`: the closed shape committed-change JSON keeps by default. */
export interface ReviewResultV1 {
  format: typeof REVIEW_RESULT_V1;
  change: CommittedReviewChange & { snapshot?: string };
  engine: { version: string };
  provider: { label: string; model: string; effort: string; profile: Profile };
  coverage: Coverage;
  /** After the confidence rule, the ADR notices and dedupe. */
  findings: ResultFindingV1[];
  contracts: Contract[];
  summary: string;
  batches: BatchReport[];
  /** Empty without a conversation. */
  threadReplies: ReviewOutput["thread_replies"];
  instructionChanges: { files: string[]; baseSha: string };
  execution: Execution;
}

/** Where a profile came from (types spec section 1.4); a label, never a path. */
export type ResultRung = "flag" | "binding" | "env" | "configDefault" | "builtIn";

/** Whether the repository's origin of a finding is known: unknown unless evidence establishes it. */
export type Origin = "introduced" | "pre-existing" | "unknown";
export type VerificationStatus = "supported" | "refuted" | "inconclusive" | "unverified";
/** A line the verifier read, in the snapshot it names: the base commit or the head. */
export interface Citation {
  snapshot: "base" | "head";
  /** A repository-relative, forward-slash path inside that snapshot. */
  path: string;
  /** Positive: line 0 is not evidence. */
  line: number;
}
export type Claimed = "supported" | "refuted" | "inconclusive" | "none";
export type Tier = "Important" | "Nit" | "Pre-existing";

export interface FindingVerification {
  /** Absent when the finding was not selected for verification. */
  candidateId?: string;
  status: VerificationStatus;
  /** A short rationale tied to the evidence, not hidden reasoning. */
  reason: string;
  checked: Citation[];
  /** Required for an accepted `refuted`; a refuted finding with one is dropped, so it is never posted. */
  disproof?: Citation;
  /** What the verifier said when the engine acted on something else (invalid evidence, a duplicate id). */
  claimed?: Claimed;
  /** Set only by code, when the verifier never reached this candidate; the reason is then `not verified: ...`. */
  unreached?: true;
}

/** The fields verification adds to a finding. */
export interface VerifiedFields {
  /** Unknown unless base or head evidence establishes it. */
  origin: Origin;
  originReason?: string;
  originEvidence?: Citation[];
  verification: FindingVerification;
  /** Derived by `tierWord`, never trusted from a model. */
  tier: Tier;
}

export interface ResultFindingV2 extends Finding, VerifiedFields {
  /** Whether the line is one a diff-anchored comment can target (`commentableLines`). */
  anchor: "diff" | "outside";
  /**
   * The finding's history id, the one `wachiman history --verdict` takes (ADR 0034). Only a
   * `local` JSON `/2` written with history on carries it; the core never sets it.
   */
  id?: string;
}

export interface VerificationEntryV2 {
  id: string;
  path: string;
  line: number;
  title: string;
  topic: Topic;
  severity: Severity;
  status: VerificationStatus;
  claimed?: Claimed;
  origin: Origin;
  originReason?: string;
  originEvidence?: Citation[];
  reason: string;
  checked: Citation[];
  disproof?: Citation;
  /** Set only by code, when the verifier never reached this candidate. */
  unreached?: true;
  outcome: "dropped" | "kept" | "degraded" | "moved";
  /** For `moved`: the severity the finding is posted at. */
  severityAfter?: Severity;
}

/** Why the verifier call ended before it answered everything. */
export interface VerifierStop {
  kind: "budget" | "turns" | "timeout" | "quota" | "error";
  detail: string;
}

export interface ResultVerificationV2 {
  /** `verified` means every candidate got a usable verdict, not that every bug was proved. */
  status: "verified" | "partial" | "failed" | "nothing" | "skipped";
  model: string;
  effort: string;
  label?: string;
  /** API-equivalent on a subscription, not a separate bill. */
  costUsd: number;
  stop?: VerifierStop;
  /** One per selected candidate, including the dropped and the never answered. */
  entries: VerificationEntryV2[];
  dropped: number;
  inconclusive: number;
}

export interface ProviderV2 {
  label: string;
  model: string;
  effort: string;
  profile: Profile;
  /** A label, a kind and the rung that chose it: no directory, executable, account e-mail or URL. */
  account?: { name: string; kind: "default" | "managed" | "external"; rung: ResultRung };
}

/** `wachiman.review-result/2`: what the core produces and every sink renders. */
export interface ReviewResultV2 {
  format: typeof REVIEW_RESULT_V2;
  change: ReviewChange & { snapshot?: string };
  engine: { version: string };
  provider: ProviderV2;
  coverage: Coverage;
  findings: ResultFindingV2[];
  contracts: Contract[];
  summary: string;
  /** The risk map (ADR 0031). Only `/2` has it: `toResultV1` leaves it out. */
  riskMap?: RiskMap;
  /**
   * PR Confidence (ADR 0033): the claims, the unexplained files and the grade. Only the `/2` result
   * of a GitHub pull request review has it; a local review never does, and `toResultV1` leaves it out.
   */
  fidelity?: Fidelity;
  batches: BatchReport[];
  threadReplies: ReviewOutput["thread_replies"];
  instructionChanges: { files: string[]; baseSha: string };
  /** Totals include the coverage calls and the verifier call. */
  execution: Execution;
  /** Absent when verification was off. */
  verification?: ResultVerificationV2;
}

/** What the core returns and every sink renders: the `/2` result. `toResultV1` makes the `/1` form. */
export type ReviewResult = ReviewResultV2;
export type ResultFinding = ResultFindingV2;

/** The core refuses a version it does not know (D15). A usage error, not an engine error. */
export function assertReviewInputFormat(input: { format?: unknown }): asserts input is {
  format: typeof REVIEW_INPUT_FORMAT | typeof REVIEW_INPUT_V2;
} {
  if (input.format !== REVIEW_INPUT_FORMAT && input.format !== REVIEW_INPUT_V2) {
    throw new UsageError(
      `Unknown review input format ${JSON.stringify(input.format)}; this engine reads ${REVIEW_INPUT_FORMAT} and ${REVIEW_INPUT_V2}.`,
    );
  }
}

/**
 * The version of a result a reader was handed, for a reader that accepts both `/1` and `/2`
 * (the history store, any consumer of a saved result). Any other version is a usage error here;
 * a caller that must keep a file written by a later version tells the two cases apart itself.
 */
export function readReviewResultFormat(result: { format?: unknown }): typeof REVIEW_RESULT_V1 | typeof REVIEW_RESULT_V2 {
  if (result.format === REVIEW_RESULT_V1 || result.format === REVIEW_RESULT_V2) return result.format;
  throw new UsageError(
    `Unknown review result format ${JSON.stringify(result.format)}; this engine reads ${REVIEW_RESULT_V1} and ${REVIEW_RESULT_V2}.`,
  );
}

/** One sentence for `execution.notices`: what the verifier did, since `/1` has no place for it. */
function verificationNotice(result: ReviewResultV2, v: ResultVerificationV2) {
  const who = v.label ?? v.model;
  const head = {
    verified: `verified by ${who}`,
    partial: `partly verified by ${who}, stopped on ${v.stop?.kind ?? "an error"}`,
    failed: `verification by ${who} failed${v.stop ? ` (${v.stop.kind})` : ""}`,
    skipped: `verification skipped${v.stop ? ` (${v.stop.kind})` : ""}`,
    nothing: `nothing to verify (${who})`,
  }[v.status];
  const preExisting = result.findings.filter((f) => f.origin === "pre-existing").length;
  return `Verification (not carried in result /1): ${head}; ${v.dropped} dropped, ${v.inconclusive} inconclusive, ${preExisting} pre-existing; $${v.costUsd.toFixed(2)}.`;
}

/**
 * The `/1` form of a result, for committed-change JSON (ADR 0030). Pure. It keeps the surviving
 * findings and every `/1` field, drops what `/1` has no place for (the account, the root
 * verification, each finding's origin, verification and tier) and says in one notice what the
 * verifier did. A working-tree result has no `/1` form: its head is a tree id, and a tree id must
 * never pass for a commit.
 */
export function toResultV1(result: ReviewResultV2): ReviewResultV1 {
  if ((result.change as { kind: string }).kind === "working-tree") {
    throw new UsageError("A working-tree review has no result /1: its head is a tree id, not a commit. Use --result-version 2.");
  }
  const { account: _account, ...provider } = result.provider;
  const { verification, riskMap: _riskMap, fidelity: _fidelity, ...rest } = result;
  return {
    ...rest,
    format: REVIEW_RESULT_V1,
    change: result.change as CommittedReviewChange & { snapshot?: string },
    provider,
    findings: result.findings.map((f) => ({
      path: f.path,
      line: f.line,
      severity: f.severity,
      topic: f.topic,
      ...(f.confidence ? { confidence: f.confidence } : {}),
      title: f.title,
      body: f.body,
      anchor: f.anchor,
    })),
    execution: {
      ...result.execution,
      notices: verification ? [...result.execution.notices, verificationNotice(result, verification)] : result.execution.notices,
    },
  };
}
