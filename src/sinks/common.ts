/**
 * What the local sinks share: the lines that must read the same in the terminal and in the
 * Markdown report. Every sink reads only the `ReviewResult` and computes no anchor.
 */
import { neutralise, oneLine, SEVERITY, TOPIC, type Finding, type Profile, type ReviewResult } from "../engine";

export const sha7 = (sha: string) => sha.slice(0, 7);

/** `🟠🐛 Fix · bug: <title> (confidence high)`: `label` without the Markdown bold. */
export const plainLabel = (f: Finding) =>
  `${SEVERITY[f.severity].emoji}${TOPIC[f.topic].emoji} ${SEVERITY[f.severity].word} · ${TOPIC[f.topic].word}: ${neutralise(f.title)}${f.confidence ? ` (confidence ${f.confidence})` : ""}`;

/** `path:line`, or the path alone for a finding about a whole file (line 0). */
export const location = (f: { path: string; line: number }) => neutralise(f.line > 0 ? `${f.path}:${f.line}` : f.path);

/** Every line of `text` after `prefix`; empty lines stay empty. */
export const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map((l) => (l === "" ? "" : `${prefix}${l}`))
    .join("\n");

/** The expected files that no batch reviewed, with the reason a batch or the core gave. */
export function notReviewed(result: ReviewResult) {
  const reviewed = new Set(result.coverage.reviewed);
  const reasons = new Map(result.coverage.skipped.map((s) => [s.path, s.reason]));
  return result.coverage.expected
    .filter((f) => !reviewed.has(f))
    .map((path) => ({ path, reason: reasons.get(path) }));
}

const withReason = (f: { path: string; reason?: string }) =>
  `${neutralise(f.path)}${f.reason ? ` (${neutralise(f.reason)})` : ""}`;

/** `all 4 files reviewed`, or `Partial: reviewed 3 of 4; not reviewed: a (binary), b`. */
export function coverageText(result: ReviewResult) {
  const missing = notReviewed(result);
  const total = result.coverage.expected.length;
  if (missing.length === 0) return `all ${total} files reviewed`;
  return `Partial: reviewed ${total - missing.length} of ${total}; not reviewed: ${missing.map(withReason).join(", ")}`;
}

/** What each profile means, when the caller has nothing more specific to say. */
const PROFILE_NOTES: Record<Profile, string | undefined> = {
  ci: undefined,
  default: "your own signed-in `claude`",
  isolated: "a Claude Code profile that holds only a sign-in",
};

/** `default — your own signed-in \`claude\``, without the `Profile:` word, which each sink spells. */
export function profileText(result: ReviewResult, note?: string) {
  const profile = result.provider.profile;
  const text = note ?? PROFILE_NOTES[profile];
  return `${profile}${text ? ` — ${text}` : ""}`;
}

const seconds = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

/** The cost, said for what it is (spec D12): the same sentence in every local rendering. */
export function estimateLine(result: ReviewResult) {
  const e = result.execution;
  return `Cost: $${e.costUsdEstimate.toFixed(2)}, an API-equivalent estimate (what these calls would cost at API prices), not a bill. ${e.calls} call(s), ${e.turns} turn(s), ${seconds(e.durationMs)}.`;
}

const STOP_REASONS: Record<Exclude<ReviewResult["execution"]["stop"], "complete">, string> = {
  quota: "the account's usage limit ended the run",
  budget: "the run's estimate guard (AGENT_REVIEW_BUDGET_USD) was spent",
  turns: "the calls hit the turn limit (AGENT_REVIEW_MAX_TURNS)",
  timeout: "the calls hit the time limit (AGENT_REVIEW_CALL_TIMEOUT_S)",
  error: "no call returned a review",
};

/**
 * `stop: complete`, or why the run ended early and every file it did not review. A refused call
 * quotes the provider's own text, on one line.
 */
export function stopLine(result: ReviewResult) {
  const { stop, rejection } = result.execution;
  if (stop === "complete") return "stop: complete";
  let why = STOP_REASONS[stop];
  if (stop === "quota" && rejection?.kind === "rate_limit") why = "the provider kept rate-limiting the calls";
  if (stop === "error" && rejection) why = `the provider refused the call (${rejection.kind}): ${oneLine(rejection.text)}`;
  const missing = notReviewed(result);
  const files = missing.length > 0 ? `; ${missing.length} file(s) not reviewed: ${missing.map((f) => neutralise(f.path)).join(", ")}` : "";
  return `stop: ${stop} — ${why}${files}`;
}

/** The provider, effort, profile and engine version, for the last line. */
export function providerLine(result: ReviewResult) {
  return `${result.provider.label} · effort ${result.provider.effort} · profile ${result.provider.profile} · Wachiman ${result.engine.version}`;
}

/** The note on review-instruction files the change edits, or null. */
export function instructionNote(result: ReviewResult) {
  const { files, baseSha } = result.instructionChanges;
  if (files.length === 0) return null;
  return `Review instructions changed: this change edits ${files.map((f) => neutralise(f)).join(", ")}. The review ran under the versions at the base commit ${sha7(baseSha)}.`;
}
