/**
 * Checking the claims the model proposed and deciding which changed files they explain (ADR 0033
 * decisions 1, 2, 9 and 13). Pure: the caller says which lines exist.
 */
import { explainedByRule } from "./rules";
import { CLAIM_STATUSES, type Assignment, type ChangedFile, type Claim, type Evidence } from "./types";

/**
 * Drops evidence whose path or line does not exist at the head, and a range end that does not exist
 * or lies before its start. A claim marked confirmed that is left with no evidence becomes
 * unverified: the model said it proved the claim and nothing it cited survives. A contradiction
 * keeps its status, since losing it would raise the grade. An unknown status is unverified. A claim
 * with no text is dropped.
 */
export function checkClaims(claims: Claim[], lineExists: (path: string, line: number) => boolean): Claim[] {
  const out: Claim[] = [];
  for (const raw of claims) {
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (text === "") continue;
    const evidence: Evidence[] = [];
    for (const e of raw.evidence ?? []) {
      if (!Number.isInteger(e.line) || !lineExists(e.path, e.line)) continue;
      const rangeOk =
        e.endLine !== undefined && Number.isInteger(e.endLine) && e.endLine > e.line && lineExists(e.path, e.endLine);
      evidence.push(rangeOk ? { path: e.path, line: e.line, endLine: e.endLine } : { path: e.path, line: e.line });
    }
    let status = CLAIM_STATUSES.includes(raw.status) ? raw.status : "unverified";
    if (status === "confirmed" && evidence.length === 0) status = "unverified";
    out.push({ text, status, evidence });
  }
  return out;
}

/** A claim that can explain a file: a vague claim counts as no claim, a contradicted one explains nothing. */
const explains = (claim: Claim | undefined): claim is Claim =>
  claim !== undefined && claim.status !== "vague" && claim.status !== "contradicted";

/**
 * The changed files nothing explains, in the order given, each once. A file is explained when it is
 * assigned to a claim that is confirmed or unverified, or when a fixed rule covers it. The test rule
 * reads only claims that are confirmed: a test is explained when its source is.
 */
export function unexplainedFiles(
  changedFiles: ChangedFile[],
  assignments: Assignment[],
  claims: Claim[],
): string[] {
  const changed = new Set(changedFiles.map((f) => f.path));
  const explained = new Set<string>();
  const confirmed = new Set<string>();
  for (const a of assignments) {
    if (!changed.has(a.path)) continue;
    const claim = Number.isInteger(a.claim) ? claims[a.claim] : undefined;
    if (!explains(claim)) continue;
    explained.add(a.path);
    if (claim.status === "confirmed") confirmed.add(a.path);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const file of changedFiles) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    if (explained.has(file.path)) continue;
    if (explainedByRule(file, { confirmedPaths: confirmed })) continue;
    out.push(file.path);
  }
  return out;
}
