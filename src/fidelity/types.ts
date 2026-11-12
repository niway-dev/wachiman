/**
 * The shapes of PR Confidence (ADR 0033, spec section 3). Pure data: nothing here reads a file,
 * a repository or a model. The model proposes claims; the engine checks them and computes the
 * grade from the checked facts.
 */
import type { Severity } from "../engine";

export const CLAIM_STATUSES = ["confirmed", "contradicted", "unverified", "vague"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** A place in the new side of the change that a claim rests on. `endLine` makes a range. */
export interface Evidence {
  path: string;
  line: number;
  endLine?: number;
}

/** One statement in the pull request title or body (decision 8). */
export interface Claim {
  text: string;
  status: ClaimStatus;
  evidence: Evidence[];
}

/** Says which claim a changed file serves; `claim` is an index into the claims array (decision 9). */
export interface Assignment {
  path: string;
  claim: number;
}

/** A changed file as the engine sees it. `patch` is the unified diff of the file when it is known. */
export interface ChangedFile {
  path: string;
  patch?: string;
}

export const GRADES = ["cannot say", "C", "B", "A-", "A"] as const;
export type Grade = (typeof GRADES)[number];

/** A finding still open at the end of the review, as far as the grade needs it. */
export interface OpenFinding {
  severity: Severity;
  path: string;
  /** 0 for a finding about the whole file. */
  line: number;
  title: string;
}

export type AttentionKind =
  | "contradicted-claim"
  | "unexplained"
  | "finding"
  | "risk-fact"
  | "judgement";

/** One place that needs a person. `line` is absent when the whole file is meant. */
export interface Attention {
  kind: AttentionKind;
  path: string;
  line?: number;
  text: string;
  /** Only for a finding: how serious it is, so the block can say which place to look at first. */
  severity?: Severity;
}

/** The places that need attention in one file. */
export interface AttentionGroup {
  path: string;
  items: Attention[];
}

/** What the engine records about a pull request review (result field `fidelity`, `/2` only). */
export interface Fidelity {
  claims: Claim[];
  unexplainedFiles: string[];
  grade: Grade;
  /** Why the grade is not higher, most important first. Empty for an A. */
  reasons: string[];
  /** True for every A and A- until the owner has judged enough A-graded pull requests (decision 16). */
  trial: boolean;
  /** How many A-graded pull requests the owner has judged so far. */
  judgedAGrades: number;
  /**
   * Every place that needs a person, ordered by file then line. The judgement items are capped at
   * three upstream (buildRiskMap), so at most three of those are listed.
   */
  questions: Attention[];
  /** Paths the risk map marks as sensitive. */
  sensitivePaths: string[];
  /** Digest of the author's text (title and body without Wachiman's block) the claims were read from. */
  digest: string;
  reviewedCommit: string;
}
