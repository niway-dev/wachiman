/**
 * The short PR Confidence result the review comment carries (ADR 0033 decision 14: the review body
 * is the record, the description holds a mirror). One line. A reason can hold a claim's text, which
 * comes from the author, so each reason is made inert here: one line, no markup, no mention.
 */
import type { Fidelity } from "./types";

const A_MEANS = "Every claim has cited evidence and no change is unexplained";

const inert = (text: string) =>
  text.replace(/\s+/g, " ").trim().replaceAll("<", "&lt;").replaceAll("@", "@\u200b");

export function fidelitySummary(f: Fidelity): string {
  const label = f.trial ? `${f.grade} (trial)` : f.grade;
  const why = f.grade === "A" ? [A_MEANS] : f.reasons.map(inert);
  return `**PR Confidence: ${label}.**${why.length > 0 ? ` ${why.join("; ")}.` : ""}`;
}
