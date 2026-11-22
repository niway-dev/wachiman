/**
 * The review body as Markdown (spec "The review body", ADR 0055): the slots of a `ReviewView`, in
 * one fixed order, an empty slot left out, never moved:
 *
 *      1 status line          2 callout and notices     3 At a glance
 *      4 To fix               5 Needs investigation     6 To consider
 *      7 Needs a person       8 Risk facts              9 Pre-existing
 *     10 For your information 11 What the change connects to
 *     12 What the reviewer checked   13 Coverage by batch   13a Files not reviewed
 *        Details of findings (no thread; in the 422 body, of each finding)
 *        the answer line, the receipt, the cost line, the hidden markers
 *
 * Size fitting is by name (spec "The review body"): whole slots go in a fixed order, then the row
 * tables are cut; see `fit`. This build keeps today's `<sub>` cost line text: Run details (slot 14) and the shortened line are
 * a later change. Text Wachiman did not write (titles, paths, reasons) goes through `escapeCell` in
 * a table cell and through `neutralise` anywhere else, so it cannot break a row or forge a marker.
 */
// Module cycle: this imports values from the engine, and the engine imports `renderReviewBody` from
// here. It works only because every use is inside a function. A top-level use of an engine export
// in this file (or of this file in the engine) would run before initialisation.
import { oneLine, renderContracts, SEVERITY, TOPIC } from "../engine";
import { A_MEANS } from "../fidelity/summary";
import { inertText } from "../fidelity/inert";
import { MUTED_HEADING } from "../memory/mute";
import { PRIORITY_WORD } from "../priority";
import { SETTINGS_PATH } from "../repo-settings";
import type { RiskLevel } from "../risk";
import { defuseDetails, escapeCell, neutralise } from "./escape";
import { computeStatus, renderStatusLine } from "./status";
import type { FindingRow, GlanceRow, ReviewView } from "./view";

/** A slot of the body, as text, with the name the size fitting finds it by. */
export interface Slot {
  id: SlotId;
  text: string;
}

export type SlotId =
  | "status"
  | "callout"
  | "notices"
  | "glance"
  | "toFix"
  | "investigate"
  | "consider"
  | "needsPerson"
  | "riskFacts"
  | "preExisting"
  | "info"
  | "connects"
  | "checked"
  | "coverage"
  | "notReviewedFiles"
  | "details"
  | "answer"
  | "receipt"
  | "cost"
  | "markers";

/**
 * What the size fitting has done to the body so far. The default is the whole body. Only the
 * fitting sets anything here; the slots read it.
 */
export interface Fit {
  /** How many rows of each cuttable table to show; absent means all. */
  limits: RowLimits;
  /** Slots left out whole. */
  dropped: ReadonlySet<SlotId>;
  /** Slot 13a shrunk to one count per reason, no file names. */
  filesAsCounts?: boolean;
  /** Slot 6 shrunk to its rows with no inline thread, and a count for the rest. */
  considerShrunk?: boolean;
  /** The Consider and Info bodies left out of the details. */
  lightDetailsDropped?: boolean;
  /** The Blocker and Fix bodies in the details cut to their first paragraph. */
  bodiesShortened?: boolean;
}

/** The line that says how to answer a finding. It holds no `$`, so `readAutoCost` still reads the cost line. */
export const ANSWER_LINE = "<sub>Answer a finding in its thread: `Verdict: correct` or `Verdict: wrong`, and why.</sub>";

/** To consider is collapsed above this many rows (spec slot 6). */
export const CONSIDER_OPEN_ROWS = 8;

/** A list of commits a headline names before it says "and N more". */
const MAX_LISTED_COMMITS = 10;

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const short = (sha: string) => sha.slice(0, 7);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Inline code from text Wachiman did not write: no backtick to end the span, a pipe escaped for a table cell. */
const codeSpan = (text: string) => `\`${neutralise(flat(text)).replaceAll("`", "'").replaceAll("|", "\\|")}\``;
/** Model text as one line of a bullet or a bold title: comments defused, whitespace collapsed. */
const oneLineText = (text: string) => defuseDetails(neutralise(flat(text)));
/** What GitHub starts a list with: a bullet, or an ordered item numbered 1, indented at most 3 spaces. */
const LIST_START = /^ {0,3}(?:[-*+]|1[.)])[ \t]/;
/** Any list item, whatever its number or indent. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])[ \t]/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A blank line before a line that starts a list right after prose, so Markdown renders a list. Fenced code is left alone. */
export function blankBeforeLists(text: string): string {
  let fence: string | null = null;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const mark = FENCE.exec(line)?.[1];
    if (mark) {
      // Only the same character, at least as long, closes a fence; any other fence inside is plain text.
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = null;
    }
    const prev = out[out.length - 1];
    if (fence === null && !mark && LIST_START.test(line) && prev !== undefined && prev.trim() !== "" && !LIST_ITEM.test(prev) && !/^\s/.test(prev)) out.push("");
    out.push(line);
  }
  return out.join("\n");
}
/** Model text as a block inside `<details>`: a stray `</details>` in it cannot close the block early, and a list after a line of prose gets the blank line it needs. */
const block = (text: string) => blankBeforeLists(defuseDetails(neutralise(text.trim())));
const collapsed = (summary: string, inner: string) => `<details><summary>${summary}</summary>\n\n${inner}\n\n</details>`;

/** The address of a location at the head commit, or null when the repository is not known (decision 7). */
function blobUrl(view: ReviewView, path: string, line: number): string | null {
  if (!view.repo) return null;
  const encoded = path
    .split("/")
    .map((s) => encodeURIComponent(s).replaceAll("(", "%28").replaceAll(")", "%29"))
    .join("/");
  return `https://github.com/${view.repo}/blob/${view.scope.head}/${encoded}${line > 0 ? `#L${line}` : ""}`;
}

/** `[`run.ts:12`](…/blob/<head>/src/init/run.ts#L12)`: the short name for the eye, the full path in the link. */
function where(view: ReviewView, loc: { path: string; line: number; location: string }): string {
  const text = codeSpan(loc.location);
  const url = blobUrl(view, loc.path, loc.line);
  return url ? `[${text}](${url})` : text;
}

const LEVEL_WORD: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };

/** The whole body: nothing dropped, nothing cut. */
const WHOLE: Fit = { limits: {}, dropped: new Set() };

/** What slot 13a shows: every path, one count per reason, or nothing (the callout and the partial marker keep the rest). */
const listing = (fit: Fit): "paths" | "counts" | "none" => (fit.dropped.has("notReviewedFiles") ? "none" : fit.filesAsCounts ? "counts" : "paths");

/** Where the names of the files not reviewed are, as the end of a sentence. */
const NAMES_GONE = "The file names are not listed because of GitHub's size limit.";

// ---- The status line and what stands under it (slots 1 and 2) -----------------------------------

/** Why a group of files was not reviewed, as the end of a sentence. */
function because(reason: string): string {
  switch (reason) {
    case "not reached: the pull request's budget was spent":
      return "because the pull request's budget was spent";
    case "not reached: the call ran out of its budget":
      return "because a call ran out of its budget";
    case "not reached: the provider rejected the call":
      return "because the provider rejected a call";
    case "":
      return "with no reason recorded";
  }
  const rest = oneLineText(reason).replace(/^not reached: /, "");
  return reason.startsWith("not reached") ? `because ${rest}` : `with the reason "${rest}"`;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The partial callout: how much was read, the count per reason on one line, and how to ask for the rest. */
function partialCallout(view: ReviewView, fit: Fit): string | null {
  const { files } = view;
  const notReviewed = files.total - files.reviewed;
  if (notReviewed === 0) return null;
  const reasons = files.notReviewed.map((g) => `${g.paths.length} ${g.paths.length === 1 ? "file" : "files"}: ${oneLineText(g.reason) || "no reason recorded"}`).join("; ");
  const twice =
    files.notReviewedTwice.length > 0
      ? ` ${files.notReviewedTwice.length} of them ${files.notReviewedTwice.length === 1 ? "was" : "were"} not reviewed after two tries, so the next push will not carry ${files.notReviewedTwice.length === 1 ? "it" : "them"}.`
      : "";
  return [
    `> ⚠️ **Partial review.** Reviewed ${files.reviewed} of ${files.total} files. Not reviewed: ${notReviewed} (${reasons}).`,
    `>${twice} ${listing(fit) === "paths" ? 'They are listed under "Files not reviewed".' : NAMES_GONE} Ask ${codeSpan(`${view.mention} review <paths>`)} for the rest.`,
  ].join("\n");
}

/** Instructions, policy and verifier notices, and what memory did: one visible paragraph each (slot 2). */
function notices(view: ReviewView): string | null {
  const out: string[] = [];
  if (view.inlineRefused) {
    out.push("ℹ️ **GitHub would not anchor these findings on their lines**, so none of them is an inline comment. Each finding is listed once below, with a number.");
  }
  const { instructionChanges, pathPolicyChange } = view.notices;
  if (instructionChanges) {
    const names = instructionChanges.files.map(codeSpan).join(", ");
    out.push(
      `ℹ️ **Review instructions changed**: this pull request edits ${names}. The review ran under the versions at the base commit ${codeSpan(short(instructionChanges.baseSha))}; the change takes effect after merge.`,
    );
  }
  if (pathPolicyChange) {
    out.push(
      `ℹ️ **Review policy changed**: this pull request edits the path rules in ${codeSpan(SETTINGS_PATH)}. The review ran under the rules at the base commit ${codeSpan(short(pathPolicyChange.baseSha))}; the change takes effect after merge.`,
    );
  }
  if (view.verifier.status === "failed") {
    out.push("⚠️ **Not verified**: the second reader that checks each finding did not finish, so these findings are posted as the review wrote them.");
  } else if (view.verifier.status === "partial") {
    out.push("⚠️ **Partly verified**: the second reader that checks each finding stopped early, so some findings are posted as the review wrote them.");
  }
  // ADR 0057: every muted finding is shown, so what memory did never goes inside a collapsed block.
  if (view.memoryNotices) out.push(neutralise(view.memoryNotices));
  return out.length > 0 ? out.join("\n\n") : null;
}

// ---- At a glance (slot 3) -----------------------------------------------------------------------

/** `🔴 0 blockers · 🟠 2 to fix · 🟡 5 to consider · ⚪ 2 for your information (9) · 1 pre-existing · 1 Should · 5 Could`. */
function findingsCell(view: ReviewView, c: Extract<GlanceRow, { key: "findings" }>): string {
  const parts = [
    `🔴 ${count(c.blockers, "blocker", "blockers")}`,
    `🟠 ${c.fixes} to fix`,
    `🟡 ${c.considers} to consider`,
    `⚪ ${c.info} for your information`,
  ];
  const cells = [`${parts.join(" · ")} (${c.total})`];
  if (c.preExisting > 0) cells.push(`${c.preExisting} pre-existing`);
  if (c.investigate > 0) cells.push(`${c.investigate} needs investigation`);
  // The word the readers of this review see in each row: a word-arm review shows no priority word.
  const mine = [...view.findings.toFix, ...view.findings.consider, ...view.findings.info];
  const words =
    view.arm === "word"
      ? (["Important", "Nit", "Pre-existing"] as const).map((t) => [mine.filter((r) => r.tier === t).length, t] as const)
      : (["must", "should", "could", "fyi"] as const).map((p) => [mine.filter((r) => r.priority === p).length, PRIORITY_WORD[p]] as const);
  for (const [n, word] of words) if (n > 0) cells.push(`${n} ${word}`);
  return cells.join(" · ");
}

const KIND_WORD = { tradeoff: "trade-off", direction: "direction", "pattern-others-will-copy": "pattern others will copy" } as const;
const KIND_PLURAL = { tradeoff: "trade-offs", direction: "directions", "pattern-others-will-copy": "patterns others will copy" } as const;

function riskCell(view: ReviewView, r: Extract<GlanceRow, { key: "risk" }>): string {
  const risk = view.risk;
  const level = r.floor ? `At least ${r.level}` : LEVEL_WORD[r.level];
  const push = r.pushOnly ? " (this push only)" : "";
  const unread = risk && risk.unreadFiles > 0 ? `${count(risk.unreadFiles, "file was", "files were")} not reviewed` : "";
  const fact = risk?.facts[0];
  const reason = risk?.pathReasons[0];
  if (fact) {
    const top = `top fact ${codeSpan(fact.kind)} at ${codeSpan(fact.location)}, see Risk facts`;
    return `${level}${push}: ${unread ? `${unread}; ` : ""}${top}`;
  }
  if (reason) {
    const top = `${reason.rule ? "path rule on" : "risky path"} ${codeSpan(reason.displayPath)}, see Risk facts`;
    return `${level}${push}: ${unread ? `${unread}; ` : ""}${top}`;
  }
  return r.floor
    ? `${level}${push}: no risk facts in the files read${unread ? `; ${unread}` : ""}`
    : `${level}${push}: no risk facts reported, no risky paths`;
}

function needsPersonCell(c: Extract<GlanceRow, { key: "needsPerson" }>, view: ReviewView): string {
  const kinds = c.kinds.map((k) => {
    const n = view.needsPerson.filter((i) => i.kind === k).length;
    return n === 1 ? `1 ${KIND_WORD[k]}` : `${n} ${KIND_PLURAL[k]}`;
  });
  const what = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}` : kinds[0];
  const places = view.needsPerson.map((i) => codeSpan(i.location));
  const at = places.length > 1 ? `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}` : places[0];
  return `${what}, in ${at}`;
}

function commitsText(commits: string[]): string {
  if (commits.length === 0) return "";
  const shown = commits.slice(0, MAX_LISTED_COMMITS).map((c) => codeSpan(short(c)));
  const more = commits.length - shown.length;
  return ` (${count(commits.length, "commit", "commits")}: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""})`;
}

function coverageCell(view: ReviewView, c: Extract<GlanceRow, { key: "coverage" }>, fit: Fit): string {
  const { scope, files } = view;
  const since = scope.since === null ? "" : codeSpan(short(scope.since));
  const of =
    c.scope === "whole"
      ? "whole pull request"
      : c.scope === "rebase"
        ? `changes since ${since} (after a rebase)`
        : `changes since ${since}${commitsText(scope.commits)}`;
  const carried = scope.carried > 0 ? `, plus the ${count(scope.carried, "file", "files")} the previous review did not reach` : "";
  let text = `${c.reviewed} of ${c.total} files reviewed, ${of}${carried}`;
  if (c.total > c.reviewed) {
    const where = listing(fit) === "paths" ? "listed under Files not reviewed" : "file names not listed because of GitHub's size limit";
    text += `; ${c.total - c.reviewed} not reviewed, ${where}. Ask ${codeSpan(`${view.mention} review <paths>`)} for the rest`;
  }
  if (files.notReviewable.length > 0) {
    const shown = files.notReviewable.slice(0, 3).map((u) => `${codeSpan(u.path)} (${oneLineText(u.reason)})`);
    const more = files.notReviewable.length - shown.length;
    text += `; ${files.notReviewable.length} not reviewable: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  }
  return text;
}

function confidenceCell(c: Extract<GlanceRow, { key: "confidence" }>): string {
  const label = c.trial ? `${c.grade} (trial)` : c.grade;
  const why = c.grade === "A" ? [A_MEANS] : c.reasons.map((r) => inertText(r).replaceAll("|", "\\|"));
  return `${label}${why.length > 0 ? `: ${why.join("; ")}` : ""}`;
}

function glanceTable(view: ReviewView, fit: Fit): string {
  const rows: [string, string][] = [];
  for (const row of view.glance) {
    switch (row.key) {
      case "findings":
        rows.push(["Findings", findingsCell(view, row)]);
        break;
      case "risk":
        rows.push(["Risk", riskCell(view, row)]);
        break;
      case "needsPerson":
        rows.push(["Needs a person", needsPersonCell(row, view)]);
        break;
      case "coverage":
        rows.push(["Coverage", coverageCell(view, row, fit)]);
        break;
      case "earlierThreads":
        rows.push(["Earlier threads", row.count === "unknown" ? "not counted: a page of threads could not be read" : row.count === 0 ? "none open" : `${row.count} open`]);
        break;
      case "confidence":
        rows.push(["PR Confidence", confidenceCell(row)]);
        break;
      case "readFirst":
        rows.push(["Read first", row.paths.map((p) => codeSpan(p.displayPath)).join(", ")]);
        break;
    }
  }
  return ["| At a glance | |", "| --- | --- |", ...rows.map(([k, v]) => `| **${k}** | ${v} |`)].join("\n");
}

// ---- The finding tables (slots 4, 5, 6, 9, 10) ---------------------------------------------------

/** What a row's first cell says before the severity, by slot. */
type RowPrefix = "" | "Needs investigation" | "Pre-existing";

/** `🟠 Fix · Should · 🐛 bug`: severity, the word the arm shows, the topic. */
function kindCell(view: ReviewView, row: FindingRow, prefix: RowPrefix): string {
  const sev = SEVERITY[row.severity];
  const topic = TOPIC[row.topic];
  const demanding = row.severity === "blocker" || row.severity === "fix";
  // In a Pre-existing slot the row already says so; the word arm's tier would say it twice.
  const word = view.arm === "word" ? (row.tier === "Pre-existing" && prefix === "Pre-existing" ? (demanding ? "Important" : "Nit") : row.tier) : PRIORITY_WORD[row.priority];
  return `${prefix ? `${prefix} · ` : ""}${sev.emoji} ${sev.word} · ${word} · ${topic.emoji} ${topic.word}`;
}

/** A row's number in the 422 body: its place among the rows of the body, slot by slot, as the tables list them. */
function numbering(view: ReviewView): Map<FindingRow, number> {
  const f = view.findings;
  return new Map([...f.toFix, ...f.investigate, ...f.consider, ...f.preExisting, ...f.info].map((r, i) => [r, i + 1] as const));
}

/**
 * A table of findings, the first `shown` rows of `rows`. The rows left out are one line after it;
 * "they are on their lines" only when every one of them has a thread. In the 422 body the first
 * column is the row's number, which the details of each finding repeat.
 */
function findingTable(view: ReviewView, rows: FindingRow[], prefix: RowPrefix, shown = rows.length): string {
  const numbers = view.inlineRefused ? numbering(view) : null;
  const lines = rows
    .slice(0, shown)
    .map((r) => `| ${numbers ? `${numbers.get(r)} | ` : ""}${kindCell(view, r, prefix)} | ${where(view, r)} | ${escapeCell(r.title)} |`);
  const table = [`| ${numbers ? "# | " : ""}| Where | Finding |`, `| ${numbers ? "--- | " : ""}--- | --- | --- |`, ...lines].join("\n");
  const left = rows.length - shown;
  if (left === 0) return table;
  const onLines = rows.slice(shown).every((r) => r.inlineThread);
  const note = `- … and ${left} more not shown because of GitHub's size limit${onLines ? ", they are on their lines" : ""}.`;
  return shown === 0 ? note : `${table}\n\n${note}`;
}

const visible = (heading: string, n: number, inner: string) => `### ${heading} (${n})\n\n${inner}`;

/** The rows of a slot the body shows now, after the size fitting. */
function shownRows(view: ReviewView, fit: Fit) {
  const f = view.findings;
  const { limits, dropped } = fit;
  // Slot 6 shrunk keeps the rows with no thread (they are the only place their finding is); the 422 body has none of those to keep.
  const considerKept = (fit.considerShrunk ? f.consider.filter((r) => !r.inlineThread) : f.consider).slice(0, limits.consider);
  return {
    toFix: f.toFix.slice(0, limits.toFix),
    investigate: f.investigate.slice(0, limits.investigate),
    consider: dropped.has("consider") ? [] : considerKept,
    preExisting: dropped.has("preExisting") ? [] : f.preExisting.slice(0, limits.preExisting),
    info: dropped.has("info") ? [] : f.info.slice(0, limits.info),
  };
}

/** To consider, whole or shrunk: the rows with no thread, then a count of the rest and where they are. */
function considerSlot(view: ReviewView, fit: Fit): string | null {
  const all = view.findings.consider;
  if (all.length === 0) return null;
  const kept = shownRows(view, fit).consider;
  const rest = all.length - kept.length;
  let inner: string;
  if (rest === 0) inner = findingTable(view, all, "");
  else {
    const note = view.inlineRefused || fit.limits.consider !== undefined ? `${rest} more to consider, not shown because of GitHub's size limit.` : `${rest} more to consider, on their lines (see Files changed).`;
    inner = kept.length > 0 ? `${findingTable(view, kept, "")}\n\n${note}` : note;
  }
  return all.length > CONSIDER_OPEN_ROWS ? collapsed(`To consider (${all.length})`, inner) : visible("To consider", all.length, inner);
}

// ---- The rest of the slots -----------------------------------------------------------------------

/** `- `kind` · `loc` — why` for each risk fact, then the files a path rule or a heuristic marked. */
function riskFactBullets(view: ReviewView): string[] {
  const risk = view.risk;
  if (!risk) return [];
  const covered = new Set(risk.facts.map((f) => f.path));
  const MAX_PATH_BULLETS = 20;
  const ruleReasons = risk.pathReasons.filter((r) => r.rule);
  const heuristic = risk.pathReasons.filter((r) => !r.rule && !covered.has(r.path));
  const bullet = (r: { displayPath: string; why: string }) => `- ${codeSpan(r.displayPath)} — ${oneLineText(r.why)}`;
  return [
    ...risk.facts.map((f) => `- ${codeSpan(f.kind)} · ${where(view, f)} — ${oneLineText(f.why)}`),
    ...ruleReasons.slice(0, MAX_PATH_BULLETS).map(bullet),
    ...(ruleReasons.length > MAX_PATH_BULLETS ? [`- and ${ruleReasons.length - MAX_PATH_BULLETS} more files matched by path rules`] : []),
    ...heuristic.map(bullet),
  ];
}

function riskFacts(view: ReviewView, shown?: number): string | null {
  const bullets = riskFactBullets(view);
  if (bullets.length === 0) return null;
  const kept = shown === undefined ? bullets : bullets.slice(0, shown);
  const left = bullets.length - kept.length;
  const note = left > 0 ? [`- … and ${left} more not shown because of GitHub's size limit`] : [];
  return `### Risk facts\n\n${[...kept, ...note].join("\n")}`;
}

/** `path:line` or `path:from-to` as a contract writes a location; anything else is shown as written. */
const CONTRACT_LOCATION = /^(.+?):(\d+)(?:-\d+)?$/;

/**
 * Slot 7: what only a person can answer, visible. The needs-a-person items first (the risk map
 * keeps three), then every open "connects to" question with its location and the files that would
 * answer it. The status counts the same items.
 */
function questions(view: ReviewView): string | null {
  const people = view.needsPerson.map((i) => `- ${where(view, i)} · ${KIND_WORD[i.kind]} — ${oneLineText(i.why)}`);
  const open = view.contracts.open.map((c) => {
    const location = c.location.trim();
    const at = CONTRACT_LOCATION.exec(location);
    const place = at ? where(view, { path: at[1]!, line: Number(at[2]), location }) : codeSpan(location);
    const question = oneLine(c.open_question ?? "Not answered from the files the reviewer could read.", 400);
    const candidates = c.candidates?.length ? ` Files that would answer it: ${c.candidates.slice(0, 6).map(codeSpan).join(", ")}.` : "";
    const unverified = c.evidence_checked === false ? " ⚠️ A citation did not resolve in the head." : "";
    return `- ${place} · open question — ${oneLine(c.action, 160)}: ${question}${candidates}${unverified}`;
  });
  const items = [...people, ...open];
  return items.length === 0 ? null : visible("Questions for you", items.length, items.join("\n"));
}

/** The first paragraph of a model's text: where a body is cut when the details must shrink. */
const FIRST_PARAGRAPH_MAX = 600;
export const firstParagraph = (text: string) => {
  const first = text.trim().split(/\n\s*\n/)[0]!;
  const cut = first.length > FIRST_PARAGRAPH_MAX ? `${first.slice(0, FIRST_PARAGRAPH_MAX - 1).trimEnd()}…` : first;
  return closeOpenFence(cut);
};

/** Closes a code fence the text leaves open, with the same marker, so what follows the text does not render as code. */
function closeOpenFence(text: string): string {
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const mark = FENCE.exec(line)?.[1];
    if (!mark) continue;
    if (fence === null) fence = mark;
    else if (mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = null;
  }
  return fence === null ? text : `${text}\n${fence}`;
}

const demanding = (r: FindingRow) => r.severity === "blocker" || r.severity === "fix";

/**
 * The details of the rows the tables show: the model's text for each. In a normal body only the
 * rows with no inline thread have one (a finding with no thread has nowhere else to put its text);
 * in the 422 body every row has one, numbered like its row.
 */
function details(view: ReviewView, fit: Fit): string | null {
  const shown = shownRows(view, fit);
  const rows = [...shown.toFix, ...shown.investigate, ...shown.consider, ...shown.preExisting, ...shown.info]
    .filter((r) => !r.inlineThread)
    .filter((r) => !(fit.lightDetailsDropped && !demanding(r)));
  if (rows.length === 0) return null;
  const numbers = view.inlineRefused ? numbering(view) : null;
  const items = rows.map((r) => {
    const confidence = r.confidence ? ` (confidence ${r.confidence})` : "";
    const text = fit.bodiesShortened && demanding(r) ? firstParagraph(r.body) : r.body;
    return `**${numbers ? `${numbers.get(r)}. ` : ""}${oneLineText(r.title)}${confidence}** (${where(view, r)})\n\n${block(text)}`;
  });
  return collapsed(numbers ? `Details of each finding (${rows.length})` : `Details of findings with no thread (${rows.length})`, items.join("\n\n"));
}

function coverage(view: ReviewView): string | null {
  const { rows, estimate } = view.coverage;
  if (rows.length === 0) return null;
  const lines = rows.map(
    (b) => `| ${neutralise(b.label)} | ${b.files} | ${b.lines} | ${b.maxRisk} | ${b.status} | ${b.turns} | $${b.costUsd.toFixed(2)} |`,
  );
  const table = [
    `| Batch | Files | Lines | Highest risk | Status | Turns | Cost${estimate ? " (estimate)" : ""} |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...lines,
  ].join("\n");
  return collapsed("Coverage by batch", table);
}

/** Every file not reviewed, grouped by reason (partial reviews, and any binary files); or, shrunk, one count per reason. */
function notReviewedFiles(view: ReviewView, fit: Fit): string | null {
  const { files } = view;
  // Binary files are not part of `files`: they are listed whenever any exist, even in a complete review.
  const total = files.total - files.reviewed + files.notReviewable.length;
  if (total === 0) return null;
  if (fit.filesAsCounts) {
    const lines = files.notReviewed.map((g) => `- ${capitalise(because(g.reason))}: ${count(g.paths.length, "file", "files")}`);
    if (files.notReviewable.length > 0) lines.push(`- Not reviewable by a model: ${count(files.notReviewable.length, "file", "files")}`);
    return collapsed(`Files not reviewed (${total})`, `${lines.join("\n")}\n\n${NAMES_GONE}`);
  }
  const groups = files.notReviewed.map(
    (g) => `**${capitalise(because(g.reason))} (${g.paths.length})**\n\n${g.paths.map((p) => `- ${codeSpan(p)}`).join("\n")}`,
  );
  if (files.notReviewable.length > 0) {
    groups.push(`**Not reviewable by a model (${files.notReviewable.length})**\n\n${files.notReviewable.map((u) => `- ${codeSpan(u.path)} (${oneLineText(u.reason)})`).join("\n")}`);
  }
  return collapsed(`Files not reviewed (${total})`, groups.join("\n\n"));
}

// ---- The body --------------------------------------------------------------------------------------

/** How many rows of each cuttable table to show; absent means all. Used only by the size fitting. */
export type RowLimits = Partial<Record<"toFix" | "investigate" | "preExisting" | "riskFacts" | "consider" | "info", number>>;

/** The slots of the review body in their order, empty ones and dropped ones left out. `fit` says what the size fitting has cut. */
export function renderSlots(view: ReviewView, fit: Fit = WHOLE): Slot[] {
  const f = view.findings;
  const shown = shownRows(view, fit);
  const { limits, dropped } = fit;
  const slots: Slot[] = [];
  const add = (id: SlotId, text: string | null | undefined) => {
    if (text && !dropped.has(id)) slots.push({ id, text });
  };

  add("status", renderStatusLine(computeStatus(view)));
  add("callout", partialCallout(view, fit));
  add("notices", notices(view));
  add("glance", glanceTable(view, fit));
  if (f.toFix.length > 0) add("toFix", visible("To fix", f.toFix.length, findingTable(view, f.toFix, "", limits.toFix)));
  if (f.investigate.length > 0) {
    add("investigate", visible("Needs investigation", f.investigate.length, findingTable(view, f.investigate, "Needs investigation", limits.investigate)));
  }
  if (!dropped.has("consider")) add("consider", considerSlot(view, fit));
  add("needsPerson", questions(view));
  add("riskFacts", riskFacts(view, limits.riskFacts));
  if (f.preExisting.length > 0 && !dropped.has("preExisting")) {
    const table = findingTable(view, f.preExisting, "Pre-existing", limits.preExisting);
    const holdsFix = f.preExisting.some(demanding);
    add("preExisting", holdsFix ? visible("Pre-existing", f.preExisting.length, table) : collapsed(`Pre-existing (${f.preExisting.length})`, table));
  }
  if (f.info.length > 0 && !dropped.has("info")) add("info", collapsed(`For your information (${f.info.length})`, findingTable(view, f.info, "", limits.info)));
  const contracts = [...view.contracts.open, ...view.contracts.closed];
  add("connects", renderContracts(contracts));
  if (view.batchProse.trim()) add("checked", collapsed("What the reviewer checked", block(view.batchProse)));
  add("coverage", coverage(view));
  add("notReviewedFiles", notReviewedFiles(view, fit));
  add("details", details(view, fit));
  // No thread in the 422 body: "answer in its thread" would point nowhere.
  if (!view.inlineRefused) add("answer", ANSWER_LINE);
  add("receipt", view.footer.receipt);
  add("cost", view.footer.costLine);
  if (view.footer.markers.length > 0) add("markers", view.footer.markers.join("\n\n"));
  return slots;
}

const join = (slots: Slot[]) => slots.map((s) => s.text).join("\n\n");

/**
 * The "Muted by memory" paragraph cut to `room` characters: a count line, then as many entries as
 * fit. The count stays even when no entry fits (ADR 0057: every muted finding is counted).
 */
export function fitMemoryNotices(notices: string, room: number): string {
  const at = notices.indexOf(MUTED_HEADING);
  if (at === -1) return notices;
  const before = notices.slice(0, at).trimEnd();
  const items = notices.slice(at).trim().split("\n").slice(1);
  const count = `**${items.length} finding${items.length === 1 ? "" : "s"} muted by memory** (not posted as comments; the list is cut to fit GitHub's size limit):`;
  const lead = before ? `${before}\n\n` : "";
  const kept: string[] = [];
  let used = lead.length + count.length;
  for (const item of items) {
    if (used + 1 + item.length > room) break;
    kept.push(item);
    used += 1 + item.length;
  }
  return `${lead}${[count, ...kept].join("\n")}`;
}

/** One step of the slot drops: leave a slot out, or shrink it, or cut text inside the details. */
type Step = { drop: SlotId } | { shrink: "filesAsCounts" | "considerShrunk" | "lightDetailsDropped" | "bodiesShortened" };

/**
 * The steps of the size fitting, in the spec's order ("The review body"). Slots 1 to 3, 7, 15 and
 * 16 are not in it, and neither are 4, 5, 8 and 9: they are never removed as slots (a Pre-existing
 * slot goes only when it holds no Blocker or Fix). Slot 13a shrinks to counts before it goes. Slot 6
 * shrinks to its rows with no thread. The details are the interim home of a finding's text:
 * in the normal body the Consider and Info bodies go after slot 13a (before 10); in the 422 body
 * they go right after slot 12, as the spec says; the Blocker and Fix bodies are cut to their first
 * paragraph last of all.
 */
function stepsOf(view: ReviewView): Step[] {
  const holdsFix = view.findings.preExisting.some(demanding);
  const light: Step = { shrink: "lightDetailsDropped" };
  const rest: Step[] = [
    { drop: "connects" },
    { drop: "coverage" },
    { shrink: "filesAsCounts" },
    { drop: "notReviewedFiles" },
    ...(view.inlineRefused ? [] : [light]),
    { drop: "info" },
    ...(holdsFix ? [] : [{ drop: "preExisting" } as Step]),
    { shrink: "considerShrunk" },
    { shrink: "bodiesShortened" },
  ];
  return [{ drop: "checked" }, ...(view.inlineRefused ? [light] : []), ...rest];
}

/**
 * The review body at most `limit` characters, from the same view as the whole body:
 *
 * 1. whole slots go from the named list (`stepsOf`) until it fits, one at a time;
 * 2. if the never-dropped slots alone are still too long, the row tables are cut in order: Risk
 *    facts (down to the first, which sets the level), Pre-existing, Needs investigation, To fix,
 *    each as little as needed, Blockers first, each ending with a line that says how many are not
 *    shown. A cut row takes its details with it.
 *
 * The "Muted by memory" list is cut only when it alone would not fit. The status, glance, answer
 * line, receipt, cost line and markers are never touched.
 */
function fit(view: ReviewView, limit: number): string {
  const render = (v: ReviewView, f: Fit) => join(renderSlots(v, f));
  let state: Fit = { limits: {}, dropped: new Set() };
  const whole = render(view, state);
  if (whole.length <= limit) return whole;
  for (const step of stepsOf(view)) {
    state =
      "drop" in step
        ? { ...state, dropped: new Set([...state.dropped, step.drop]) }
        : { ...state, [step.shrink]: true };
    const text = render(view, state);
    if (text.length <= limit) return text;
  }

  // Still over. The memory list keeps what fits next to the smallest body the tables can make.
  const f = view.findings;
  const bullets = riskFactBullets(view).length;
  const sizes: Record<keyof RowLimits, number> = { info: f.info.length, consider: f.consider.length, riskFacts: bullets, preExisting: f.preExisting.length, investigate: f.investigate.length, toFix: f.toFix.length };
  // Risk facts keep the one that sets the level, To fix and Needs investigation their first row (a Blocker when there is one): a body a little over the limit is better than one with no finding in it.
  const least = (key: keyof RowLimits) => (key === "preExisting" || key === "consider" || key === "info" ? 0 : Math.min(1, sizes[key]));
  const smallest: Fit = { ...state, limits: { info: 0, consider: 0, riskFacts: least("riskFacts"), preExisting: 0, investigate: least("investigate"), toFix: least("toFix") } };
  let shownView = view;
  if (view.memoryNotices) {
    const rest = render({ ...view, memoryNotices: "" }, smallest).length;
    const room = limit - rest - 2;
    if (view.memoryNotices.length > room) shownView = { ...view, memoryNotices: fitMemoryNotices(view.memoryNotices, room) };
  }
  const limits: RowLimits = {};
  const at = (k: keyof RowLimits, n: number): Fit => ({ ...state, limits: { ...limits, [k]: n } });
  // Each table in turn keeps the most rows that make the body fit; when none does, it keeps the least and the next one is cut.
  for (const key of ["info", "consider", "riskFacts", "preExisting", "investigate", "toFix"] as const) {
    const min = least(key);
    if (render(shownView, { ...state, limits }).length <= limit) break;
    let [low, high] = [min, sizes[key] - 1];
    if (render(shownView, at(key, min)).length > limit) high = min;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (render(shownView, at(key, mid)).length <= limit) low = mid;
      else high = mid - 1;
    }
    limits[key] = low;
  }
  return render(shownView, { ...state, limits });
}

/**
 * The review body for GitHub. With `limit`, a body over it is fitted as above; without, the whole
 * body. A view from `refusedView` renders the 422 body.
 */
export function renderReviewBody(view: ReviewView, limit = Number.POSITIVE_INFINITY): string {
  return Number.isFinite(limit) ? fit(view, limit) : join(renderSlots(view));
}
