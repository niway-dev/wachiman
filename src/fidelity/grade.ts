/**
 * The PR Confidence grade (ADR 0033, spec section 3), a pure function: the model proposes claims
 * and facts, the engine decides the letter. The first matching row of the table wins, so an
 * incomplete run is `cannot say` whatever else is true, and no row ever depends on a number the
 * model states. There are no plus signs yet (slice 2c).
 *
 * | Grade      | When                                                                                   |
 * | cannot say | the run did not finish, files unread, a new commit not reviewed, the text changed      |
 * | C          | no checkable claim; a contradicted claim; an open Blocker                              |
 * | B          | an unverified claim; an unexplained file; an open Fix; a risk level of high            |
 * | A-         | a medium risk fact, a dropped risk fact, a place that needs a person, an open Consider |
 * | A          | none of the above                                                                      |
 */
import type { RiskKind, RiskLevel, RiskMap } from "../risk";
import { unexplainedFiles } from "./claims";
import type {
  Assignment,
  Attention,
  AttentionGroup,
  ChangedFile,
  Claim,
  Fidelity,
  Grade,
  OpenFinding,
} from "./types";

/**
 * The level each risk fact kind sets. A copy of `KIND_LEVEL` in `risk.ts`, kept here so this module
 * loads no runtime code from the engine; a test fails if the two drift apart.
 */
export const FACT_LEVEL: Record<RiskKind, RiskLevel> = {
  "data-migration": "high",
  irreversible: "high",
  auth: "high",
  money: "high",
  concurrency: "medium",
  "public-contract": "medium",
  "config-or-ci": "medium",
  dependency: "low",
};

/** What the grade reads from the risk map (ADR 0031). */
export type GradeRisk = Pick<RiskMap, "level" | "facts" | "judgement" | "pathReasons" | "droppedFacts">;

/** How the run ended and what it read. Every field is required, so a caller cannot forget one and get a letter. */
export interface RunState {
  finished: boolean;
  /** Set when the engine stopped the run on its own limit. */
  stoppedBy?: "spend-ceiling" | "depth-cap";
  unreadFiles: number;
  /** The claims call read only the start of the title and body: claims after the cut were never judged. */
  textTruncated?: boolean;
  /** The commit this review read. */
  reviewedCommit: string;
  /** The commit the pull request has now. Different from `reviewedCommit`: the review of the new one is not done. */
  headCommit: string;
  /** Digest of the author's text when the claims were read. */
  digestAtRead: string;
  /** Digest of the author's text at the moment the block is written. */
  digestAtWrite: string;
}

export interface GradeInput {
  claims: Claim[];
  assignments: Assignment[];
  changedFiles: ChangedFile[];
  /** Findings of this review that are still open. */
  openFindings: OpenFinding[];
  riskMap: GradeRisk;
  run: RunState;
  /** How many A-graded pull requests the owner has judged (decision 16). Default 0. */
  judgedAGrades?: number;
}

export type GradeResult = Pick<
  Fidelity,
  "grade" | "reasons" | "trial" | "judgedAGrades" | "questions" | "unexplainedFiles" | "sensitivePaths"
>;

const SEVERITY_WORD = { blocker: "Blocker", fix: "Fix", consider: "Consider", info: "Info" } as const;
const SEVERITY_EMOJI = { blocker: "🔴", fix: "🟠", consider: "🟡", info: "⚪" } as const;

const count = (n: number, one: string, many: string) => (n === 1 ? `One ${one}` : `${n} ${many}`);

const byPathThenLine = (a: Attention, b: Attention) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0);

/**
 * The places that need a person, one entry each, ordered by file then line. Nothing here caps the
 * list, but the judgement items arrive already cut to three by buildRiskMap (src/risk.ts), so at
 * most three of them appear here and count in the A- reason.
 */
function placesNeedingAttention(input: GradeInput, unexplained: string[]): Attention[] {
  const places: Attention[] = [];
  for (const c of input.claims) {
    const at = c.status === "contradicted" ? c.evidence[0] : undefined;
    if (at) {
      places.push({ kind: "contradicted-claim", path: at.path, line: at.line, text: `claim contradicted: ${c.text}` });
    }
  }
  for (const path of unexplained) {
    places.push({ kind: "unexplained", path, text: "no claim in the pull request explains this change." });
  }
  for (const f of input.openFindings) {
    if (f.severity === "info") continue;
    const place: Attention = {
      kind: "finding",
      path: f.path,
      severity: f.severity,
      text: `${SEVERITY_EMOJI[f.severity]} ${SEVERITY_WORD[f.severity]}: ${f.title}`,
    };
    if (f.line > 0) place.line = f.line;
    places.push(place);
  }
  for (const f of input.riskMap.facts) {
    if (FACT_LEVEL[f.kind] === "low") continue;
    places.push({ kind: "risk-fact", path: f.path, line: f.line, text: `${f.kind}: ${f.why}` });
  }
  for (const j of input.riskMap.judgement) {
    places.push({ kind: "judgement", path: j.path, line: j.line, text: `needs a person (${j.kind}): ${j.why}` });
  }
  return places.sort(byPathThenLine);
}

/** The paths the risk map marks as sensitive: a medium or high path rule, or a fact that is not low. */
function sensitivePathsOf(risk: GradeRisk): string[] {
  const paths = new Set<string>();
  for (const r of risk.pathReasons) paths.add(r.path);
  for (const f of risk.facts) if (FACT_LEVEL[f.kind] !== "low") paths.add(f.path);
  return [...paths].sort();
}

function cannotSayReasons(run: RunState): string[] {
  const reasons: string[] = [];
  if (run.stoppedBy === "spend-ceiling") reasons.push("The run stopped at the spend ceiling");
  else if (run.stoppedBy === "depth-cap") reasons.push("The run stopped at the depth cap");
  else if (!run.finished) reasons.push("The run did not finish");
  if (run.textTruncated) reasons.push("The pull request text was too long to read in full");
  if (run.unreadFiles > 0) {
    reasons.push(run.unreadFiles === 1 ? "One file was not read" : `${run.unreadFiles} files were not read`);
  }
  if (run.reviewedCommit !== run.headCommit) reasons.push("The review of the new commit has not finished");
  if (run.digestAtRead !== run.digestAtWrite) reasons.push("The pull request text changed while the review was running");
  return reasons;
}

export function computeGrade(input: GradeInput): GradeResult {
  const { claims, riskMap } = input;
  const unexplained = unexplainedFiles(input.changedFiles, input.assignments, claims);
  const questions = placesNeedingAttention(input, unexplained);
  const judgedAGrades = input.judgedAGrades ?? 0;
  const sensitivePaths = sensitivePathsOf(riskMap);
  const result = (grade: Grade, reasons: string[]): GradeResult => ({
    grade,
    reasons,
    trial: grade === "A" || grade === "A-",
    judgedAGrades,
    questions,
    unexplainedFiles: unexplained,
    sensitivePaths,
  });

  const stopped = cannotSayReasons(input.run);
  if (stopped.length > 0) return result("cannot say", stopped);

  const openOf = (severity: OpenFinding["severity"]) => input.openFindings.filter((f) => f.severity === severity);
  const blockers = openOf("blocker");
  const fixes = openOf("fix");
  const considers = openOf("consider");
  const contradicted = claims.filter((c) => c.status === "contradicted");
  const unverified = claims.filter((c) => c.status === "unverified");
  const checkable = claims.filter((c) => c.status !== "vague");

  const c: string[] = [];
  if (checkable.length === 0) c.push("The pull request does not say what it changes");
  for (const claim of contradicted) c.push(`Claim contradicted: ${claim.text}`);
  if (blockers.length > 0) c.push(count(blockers.length, "open Blocker", "open Blockers"));
  if (c.length > 0) return result("C", c);

  const highFacts = [
    ...new Set(riskMap.facts.filter((f) => FACT_LEVEL[f.kind] === "high").map((f) => f.kind)),
  ];
  const high = riskMap.level === "high" || highFacts.length > 0;
  const b: string[] = [];
  for (const claim of unverified) b.push(`Claim not verified: ${claim.text}`);
  if (unexplained.length > 0) b.push(count(unexplained.length, "unexplained change", "unexplained changes"));
  if (fixes.length > 0) b.push(count(fixes.length, "open Fix", "open Fixes"));
  if (high) b.push(`The risk level is high${highFacts.length > 0 ? `: ${highFacts.join(", ")}` : ""}`);
  if (b.length > 0) return result("B", b);

  const mediumFacts = riskMap.facts.filter((f) => FACT_LEVEL[f.kind] === "medium");
  const aMinus: string[] = [];
  if (mediumFacts.length > 0) aMinus.push(count(mediumFacts.length, "medium-risk fact", "medium-risk facts"));
  if (riskMap.droppedFacts > 0) {
    aMinus.push(
      count(
        riskMap.droppedFacts,
        "risk fact could not be placed in the change",
        "risk facts could not be placed in the change",
      ),
    );
  }
  if (riskMap.judgement.length > 0) {
    aMinus.push(
      riskMap.judgement.length === 1 ? "One place needs a person" : `${riskMap.judgement.length} places need a person`,
    );
  }
  if (considers.length > 0) aMinus.push(count(considers.length, "open Consider finding", "open Consider findings"));
  if (aMinus.length > 0) return result("A-", aMinus);

  return result("A", []);
}

/** The fidelity the engine records for a review: the grade and what it was computed from. */
export function buildFidelity(input: GradeInput): Fidelity {
  return {
    claims: input.claims,
    ...computeGrade(input),
    digest: input.run.digestAtRead,
    reviewedCommit: input.run.reviewedCommit,
  };
}

/** The attention list grouped by file. The order of files and of items within a file is kept. */
export function groupByFile(items: Attention[]): AttentionGroup[] {
  const groups = new Map<string, Attention[]>();
  for (const item of items) {
    const group = groups.get(item.path);
    if (group) group.push(item);
    else groups.set(item.path, [item]);
  }
  return [...groups].map(([path, list]) => ({ path, items: list }));
}

/**
 * The miss rate that `judged` pull requests with no serious miss bound at 95% confidence (decision
 * 16 and spec section 6): 0 misses in 30 gives about 9.5%. Undefined before any is judged.
 */
export function trialBound(judged: number): number | undefined {
  if (!Number.isInteger(judged) || judged <= 0) return undefined;
  return 1 - 0.05 ** (1 / judged);
}
