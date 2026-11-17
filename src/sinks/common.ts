/**
 * What the local sinks share: the lines that must read the same in the terminal and in the
 * Markdown report. Every sink reads only the `ReviewResult` and computes no anchor.
 */
import { detail, label, neutralise, oneLine, SEVERITY, TOPIC, type Finding, type Profile, type ReviewResult } from "../engine";
import type { Citation, ResultFinding } from "../formats";
import { sectionOf, tierWord, verificationSegment, type Section } from "../verify";
import type { Settled } from "../history/types";

export const sha7 = (sha: string) => sha.slice(0, 7);

/** A finding as a sink sees it: the verification fields are there on a `/2` result. */
export type Reported = Finding & Partial<Pick<ResultFinding, "origin" | "originReason" | "originEvidence" | "verification">>;

/** What the verifier found, for the label: nothing for a finding nobody verified. */
const statusOf = (f: Reported) => (f.verification && f.verification.status !== "unverified" ? f.verification.status : undefined);

/** `Important · 🟠🐛 Fix · bug: <title> (confidence high, supported)`: `label` without the Markdown bold. */
export const plainLabel = (f: Reported) =>
  `${tierWord(f)} · ${SEVERITY[f.severity].emoji}${TOPIC[f.topic].emoji} ${SEVERITY[f.severity].word} · ${TOPIC[f.topic].word}: ${neutralise(f.title)}${detail(f, statusOf(f))}`;

/** `Important · 🟠🐛 **Fix · bug: <title> (confidence high, supported)**`: the GitHub label plus the verdict, for a report. */
export const markdownLabel = (f: Reported) => label(f, statusOf(f));

const cite = (c: Citation) => neutralise(`${c.snapshot === "base" ? "base:" : ""}${c.path}:${c.line}`);

/** One part of what verification says about a finding: a name, a sentence, and the lines it rests on. */
export interface Note {
  name: "Verified" | "Inconclusive" | "Not verified" | "Pre-existing";
  text: string;
  /** Present on the first note of a finding that has citations: `Checked:` follows it. */
  cites?: string[];
}

/** The lines every local report prints under a finding's body; empty for a finding nobody verified. */
export function verificationNotes(f: Reported): Note[] {
  const v = f.verification;
  if (!v || v.status === "unverified") return [];
  const notes: Note[] = [];
  const citations = [...v.checked, ...(f.originEvidence ?? [])].map(cite);
  const cites = [...new Set(citations)];
  if (v.status === "supported") notes.push({ name: "Verified", text: neutralise(v.reason), ...(cites.length > 0 ? { cites } : {}) });
  else if (v.unreached) notes.push({ name: "Not verified", text: neutralise(v.reason.replace(/^not verified:\s*/, "")) });
  else notes.push({ name: "Inconclusive", text: neutralise(v.reason), ...(cites.length > 0 ? { cites } : {}) });
  if (f.origin === "pre-existing" && f.originReason) notes.push({ name: "Pre-existing", text: neutralise(f.originReason) });
  return notes;
}

export const SECTION_TITLES: Record<Exclude<Section, "main">, { heading: string; note: string }> = {
  inconclusive: { heading: "Inconclusive", note: "The verifier looked at these and could not settle them." },
  "pre-existing": { heading: "Pre-existing", note: "True, but not introduced by this change." },
};

/** The findings of a result by section, each with its index in `result.findings` (the history labels use it). */
export function sections(result: ReviewResult): Record<Section, { f: ResultFinding; index: number }[]> {
  const out: Record<Section, { f: ResultFinding; index: number }[]> = { main: [], inconclusive: [], "pre-existing": [] };
  result.findings.forEach((f, index) => out[sectionOf(f)].push({ f, index }));
  return out;
}

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

/**
 * `all 4 files reviewed`, or `Partial: reviewed 3 of 4; not reviewed: a (binary), b`. Files the
 * engine left out because no model can review them follow on, in one line: `; not reviewable: logo.png (binary)`.
 */
export function coverageText(result: ReviewResult) {
  const missing = notReviewed(result);
  const total = result.coverage.expected.length;
  const unreviewable = result.coverage.unreviewable ?? [];
  const tail = unreviewable.length > 0 ? `; not reviewable: ${unreviewable.map((u) => withReason({ path: u.path, reason: u.reason })).join(", ")}` : "";
  if (missing.length === 0) return `all ${total} files reviewed${tail}`;
  return `Partial: reviewed ${total - missing.length} of ${total}; not reviewed: ${missing.map(withReason).join(", ")}${tail}`;
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
export const dollars = (usd: number) => `$${usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;

/** The cost, said for what it is (spec D12): the same sentence in every local rendering. */
export function estimateLine(result: ReviewResult) {
  return costSentence(result.execution);
}

/** The cost sentence for any run of calls; `wachiman ask` uses it for one answer. */
export function costSentence(e: { costUsdEstimate: number; calls: number; turns: number; durationMs: number }) {
  return `Cost: ${dollars(e.costUsdEstimate)}, an API-equivalent estimate (what these calls would cost at API prices), not a bill. ${e.calls} call(s), ${e.turns} turn(s), ${seconds(e.durationMs)}.`;
}

const STOP_REASONS: Record<Exclude<ReviewResult["execution"]["stop"], "complete">, string> = {
  quota: "the account's usage limit ended the run",
  budget: "the run's estimate guard (WACHIMAN_BUDGET_USD) was spent",
  turns: "the calls hit the turn limit (WACHIMAN_MAX_TURNS)",
  timeout: "the calls hit the time limit (WACHIMAN_CALL_TIMEOUT_S)",
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

/** Which of the model and the effort the repository's `.wachiman.yml` chose, so the last line can say so. */
export interface SettingsFrom {
  model?: boolean;
  effort?: boolean;
}

/** The provider, effort, profile and engine version, for the last line; `from` marks a value that came from `.wachiman.yml`. */
export function providerLine(result: ReviewResult, from: SettingsFrom = {}) {
  const verified = result.verification ? verificationSegment(result.verification) : undefined;
  const file = " (from .wachiman.yml)";
  return `${result.provider.label}${from.model ? file : ""} · effort ${result.provider.effort}${from.effort ? file : ""} · profile ${result.provider.profile} · Wachiman ${result.engine.version}${verified ? ` · ${verified}` : ""}`;
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

/**
 * This run's findings with their history labels, as plain text, for `--format json` where the
 * report itself carries none: stderr only, the public JSON stays unchanged.
 */
export function thisRunText(result: ReviewResult, a: HistoryAnnotation) {
  const rows = result.findings.flatMap((f, i) => {
    const e = a.byIndex.get(i);
    if (!e) return [];
    const word = e.status === "new" ? "new" : `open since ${sha7(e.firstHead)}, ${e.runs} runs`;
    return [{ word, where: location(f), title: neutralise(f.title), id: e.id, verdict: e.verdict }];
  });
  if (rows.length === 0) return "This run (history): no findings.";
  const wordWidth = Math.max(...rows.map((r) => r.word.length));
  const whereWidth = Math.max(...rows.map((r) => r.where.length));
  const titleWidth = Math.max(...rows.map((r) => r.title.length));
  const lines = rows.map(
    (r) => `  ${pad(r.word, wordWidth)}  ${pad(r.where, whereWidth)}  ${pad(r.title, titleWidth)}  (id ${r.id}${r.verdict ? `, verdict: ${r.verdict}` : ""})`,
  );
  return ["This run (history):", ...lines].join("\n");
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
