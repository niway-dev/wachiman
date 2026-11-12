/**
 * The short PR Confidence result the review comment carries (ADR 0033 decision 14: the review body
 * is the record, the description holds a mirror). One line. A reason can hold a claim's text, which
 * comes from the author, so each reason goes through `inertText`: one line that cannot open a
 * link, a code span, a tag, an autolink or a mention.
 */
import { inertText } from "./inert";
import type { Fidelity } from "./types";

const A_MEANS = "Every claim has cited evidence and no change is unexplained";

export function fidelitySummary(f: Fidelity): string {
  const label = f.trial ? `${f.grade} (trial)` : f.grade;
  const why = f.grade === "A" ? [A_MEANS] : f.reasons.map(inertText);
  return `**PR Confidence: ${label}.**${why.length > 0 ? ` ${why.join("; ")}.` : ""}`;
}
