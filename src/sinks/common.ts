/**
 * What the local sinks share: the lines that must read the same in the terminal and in the
 * Markdown report. Every sink reads only the `ReviewResult` and computes no anchor.
 */
import { neutralise, oneLine, SEVERITY, TOPIC, type Finding, type Profile, type ReviewResult } from "../engine";
import type { Settled } from "../history/types";

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
  // Spec open question 4: the harness cleared CLAUDE.md, skills, hooks and MCP servers, not plugins.
  default: "your own signed-in `claude`; its plugins are untested and could reach the review",
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

/** Dollars to the cent; a cheap run (a Haiku call costs a fraction of a cent) to four places, not "$0.00". */
const dollars = (usd: number) => `$${usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;

/** The cost, said for what it is (spec D12): the same sentence in every local rendering. */
export function estimateLine(result: ReviewResult) {
  const e = result.execution;
  return `Cost: ${dollars(e.costUsdEstimate)}, an API-equivalent estimate (what these calls would cost at API prices), not a bill. ${e.calls} call(s), ${e.turns} turn(s), ${seconds(e.durationMs)}.`;
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

/**
 * What a `--history` run adds to its report (ADR 0020): a label per finding and what this run
 * settled about earlier ones. Built by `saveRun`; the sinks only print it.
 */
export interface HistoryEntry {
  status: "new" | "open";
  firstHead: string;
  runs: number;
  id: string;
  verdict?: string;
}

export interface HistoryAnnotation {
  /** By index into `result.findings`. `id` is the finding's first id, the one `history --verdict` takes. */
  byIndex: Map<number, HistoryEntry>;
  settled: Settled[];
  unknown: number;
  lastRun?: { head: string; savedAt: string };
}

const SETTLED_WORDS: Record<Settled["status"], string> = { "probably-fixed": "probably fixed", "not-repeated": "not repeated" };

/** `new · id a1b2c3d4e5` or `open since 5d6e7f8 · 3 runs · id a1b2c3d4e5`, plus `· verdict: wrong` when judged. */
export function historyLabel(entry: HistoryEntry) {
  const where = entry.status === "new" ? "new" : `open since ${sha7(entry.firstHead)} · ${entry.runs} runs`;
  return `${where} · id ${entry.id}${entry.verdict ? ` · verdict: ${entry.verdict}` : ""}`;
}

const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - text.length));

const UNKNOWN_HINT = "finding(s) in files this run did not review (run without paths to settle them)";

/** The "Since the last run" block, as plain text (terminal, and stderr for `--format json`). */
export function sinceLastRunText(a: HistoryAnnotation) {
  const head = a.lastRun
    ? `Since the last run (${sha7(a.lastRun.head)}, ${a.lastRun.savedAt.slice(0, 16).replace("T", " ")}):`
    : "Since the last run: this is the first saved run of this repository.";
  const rows = a.settled.map((s) => ({ word: SETTLED_WORDS[s.status], where: location(s), title: neutralise(s.title), id: s.firstId }));
  const wordWidth = Math.max(...rows.map((r) => r.word.length), "unknown".length);
  const whereWidth = Math.max(0, ...rows.map((r) => r.where.length));
  const titleWidth = Math.max(0, ...rows.map((r) => r.title.length));
  const lines = rows.map((r) => `  ${pad(r.word, wordWidth)}  ${pad(r.where, whereWidth)}  ${pad(r.title, titleWidth)}  (id ${r.id})`);
  if (a.unknown > 0) lines.push(`  ${pad("unknown", wordWidth)}  ${a.unknown} ${UNKNOWN_HINT}`);
  return [head, ...lines].join("\n");
}

/** The same facts as Markdown bullets, for the `## Since the last run` section. */
export function sinceLastRunMarkdown(a: HistoryAnnotation) {
  const head = a.lastRun
    ? `Compared with the run at \`${sha7(a.lastRun.head)}\` (${a.lastRun.savedAt.slice(0, 16).replace("T", " ")}).`
    : "This is the first saved run of this repository.";
  const bullets = a.settled.map(
    (s) => `- ${SETTLED_WORDS[s.status]}: \`${location(s)}\` ${neutralise(s.title)} (id \`${s.firstId}\`)`,
  );
  if (a.unknown > 0) bullets.push(`- unknown: ${a.unknown} ${UNKNOWN_HINT}`);
  return bullets.length > 0 ? `${head}\n\n${bullets.join("\n")}` : head;
}
