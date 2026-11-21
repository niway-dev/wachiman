/**
 * The first line of the review body (spec "Status line", decisions 2, 16 and 18). It is the
 * status, never a verdict: `Verdict:` is the reply a person gives a finding. It is built from
 * parts joined by ` · `:
 *
 *     👮 **Wachiman** · 🟠 **2 to fix in this PR** · 1 question for you · whole PR at `d6f4431`
 *
 * The lead is the first of nine modes that applies, bold, and carries the only colour emoji of the
 * line. The parts after it are plain text and the scope is last. Risk is never on the line: it is a
 * row of the glance table. The line never says the pull request can merge, and has no check mark.
 */
import { countFindingRows, type ReviewView } from "./view";

/** `BRAND` in `engine.ts`; a test holds the two equal. This file imports nothing from the engine (`render.ts` does, see there). */
export const BRAND = "👮 **Wachiman**";

/** 1 Not reviewed (the notice template; the review body never produces it), then 2 to 9 as in the spec's table. */
export type StatusMode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** The colour emoji of each lead: the only one on the line. */
export const MODE_EMOJI: Record<StatusMode, string> = {
  1: "⛔",
  2: "⚠️",
  3: "🔴",
  4: "🟠",
  5: "🔍",
  6: "🟣",
  7: "⏳",
  8: "🟡",
  9: "⚪",
};

export interface Status {
  mode: StatusMode;
  emoji: string;
  /** The words of the bold lead, without the emoji. */
  lead: string;
  /** Plain text, in the order of the spec. */
  parts: string[];
  /** `whole PR at `sha``, always last. */
  scope: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const short = (sha: string) => sha.slice(0, 7);

/** The scope text, always the last part of the line. */
export function scopeText(scope: ReviewView["scope"]): string {
  const head = `\`${short(scope.head)}\``;
  if (scope.since === null) return `whole PR at ${head}`;
  const since = `\`${short(scope.since)}\``;
  return `changes since ${since}${scope.kind === "rebase" ? " (after a rebase)" : ""} at ${head}`;
}

/** The status of a review: the lead of the first mode that applies (2 to 9), the other facts as parts, the scope. */
export function computeStatus(view: ReviewView): Status {
  const counts = countFindingRows(view.findings);
  const notReviewed = view.files.total - view.files.reviewed;
  const questions = view.needsPerson.length + view.contracts.open.length;
  const threads = view.earlierThreads;
  const threadsOpen = threads === "unknown" || threads > 0;
  const holdsClean = threadsOpen || counts.preExistingDemanding > 0;

  let mode: StatusMode;
  let lead: string;
  if (notReviewed > 0) [mode, lead] = [2, `Partial: ${notReviewed} of ${view.files.total} files not reviewed`];
  else if (counts.blockers > 0) [mode, lead] = [3, `${plural(counts.blockers, "blocker", "blockers")} before merge`];
  else if (counts.fixes > 0) [mode, lead] = [4, `${counts.fixes} to fix in this PR`];
  else if (counts.investigate > 0) [mode, lead] = [5, `Needs investigation: ${counts.investigate}`];
  else if (questions > 0) [mode, lead] = [6, plural(questions, "question for you", "questions for you")];
  else if (holdsClean) [mode, lead] = [7, "No new findings to fix"];
  else if (counts.considers > 0) [mode, lead] = [8, `Nothing to fix · ${counts.considers} to consider`];
  else [mode, lead] = [9, "Wachiman found nothing to fix"];

  const v = view.verifier;
  const verifierStopped = v.status === "failed" || v.status === "partial";
  // Each only when it applies and the lead does not already say it (the leads of modes 3 to 6 and 8 carry their count).
  const parts: string[] = [];
  if (counts.blockers > 0 && mode !== 3) parts.push(`${plural(counts.blockers, "blocker", "blockers")} before merge`);
  if (counts.fixes > 0 && mode !== 4) parts.push(`${counts.fixes} to fix in this PR`);
  // Without this part a Fix lead, or a partial one, would hide an inconclusive Blocker (spec, decision 2).
  if (counts.investigate > 0 && mode !== 5) parts.push(`${counts.investigate} to investigate`);
  if (verifierStopped) {
    parts.push(
      v.notChecked > 0 ? `verifier did not finish: ${plural(v.notChecked, "finding", "findings")} not checked` : "verifier did not finish",
    );
  }
  if (counts.preExistingDemanding > 0) {
    parts.push(`${plural(counts.preExistingDemanding, "pre-existing issue", "pre-existing issues")} to fix, not from this PR`);
  }
  if (questions > 0 && mode !== 6) parts.push(plural(questions, "question for you", "questions for you"));
  if (threads === "unknown") parts.push("earlier threads not counted");
  else if (threads > 0) parts.push(plural(threads, "earlier thread open", "earlier threads open"));
  if (counts.considers > 0 && mode !== 8) parts.push(`${counts.considers} to consider`);

  return { mode, emoji: MODE_EMOJI[mode], lead, parts, scope: scopeText(view.scope) };
}

/** The status of a notice that reviewed nothing (mode 1). The notice path calls it; `computeStatus` never returns it. */
export function notReviewedStatus(reason: string, scope: string): Status {
  return { mode: 1, emoji: MODE_EMOJI[1], lead: `Not reviewed: ${reason}`, parts: [], scope };
}

/** `👮 **Wachiman** · <emoji> **<lead>** · part · part · <scope>`: one line, one colour emoji, in the lead. */
export function renderStatusLine(status: Status): string {
  return [BRAND, `${status.emoji} **${status.lead}**`, ...status.parts, status.scope].join(" · ");
}
