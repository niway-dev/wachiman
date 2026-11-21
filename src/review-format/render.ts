/**
 * The review body as Markdown (spec "The review body", ADR 0055): the slots of a `ReviewView`, in
 * one fixed order, an empty slot left out, never moved:
 *
 *      1 status line          2 callout and notices     3 At a glance
 *      4 To fix               5 Needs investigation     6 To consider
 *      7 Needs a person       8 Risk facts              9 Pre-existing
 *     10 For your information 11 What the change connects to
 *     12 What the reviewer checked   13 Coverage by batch   13a Files not reviewed
 *        Details of findings with no thread
 *        the answer line, the receipt, the cost line, the hidden markers
 *
 * This build keeps today's `<sub>` cost line text: Run details (slot 14) and the shortened line are
 * a later change. Text Wachiman did not write (titles, paths, reasons) goes through `escapeCell` in
 * a table cell and through `neutralise` anywhere else, so it cannot break a row or forge a marker.
 */
import { renderContracts, SEVERITY, TOPIC } from "../engine";
import { A_MEANS } from "../fidelity/summary";
import { inertText } from "../fidelity/inert";
import { MUTED_HEADING } from "../memory/mute";
import { PRIORITY_WORD } from "../priority";
import { SETTINGS_PATH } from "../repo-settings";
import type { RiskLevel } from "../risk";
import { escapeCell, neutralise } from "./escape";
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
const oneLineText = (text: string) => neutralise(flat(text));
/** Model text as a block inside `<details>`: a stray `</details>` in it cannot close the block early. */
const block = (text: string) => neutralise(text.trim()).replace(/<(\/?)details/gi, "&lt;$1details");
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

/** The partial callout: counts per reason, and how to ask for the rest. */
function partialCallout(view: ReviewView): string | null {
  const { files } = view;
  const notReviewed = files.total - files.reviewed;
  if (notReviewed === 0) return null;
  const groups = files.notReviewed;
  const detail =
    groups.length === 1
      ? `${notReviewed} not reviewed ${because(groups[0].reason)}.`
      : `${notReviewed} not reviewed: ${groups.map((g) => `${g.paths.length} ${because(g.reason)}`).join(", ")}.`;
  const twice =
    files.notReviewedTwice.length > 0
      ? ` ${files.notReviewedTwice.length} of them ${files.notReviewedTwice.length === 1 ? "was" : "were"} not reviewed after two tries, so the next push will not carry ${files.notReviewedTwice.length === 1 ? "it" : "them"}.`
      : "";
  return `> ⚠️ **Partial review: ${files.reviewed} of ${files.total} files reviewed.** ${detail}${twice} They are listed under "Files not reviewed". Ask ${codeSpan(`${view.mention} review <paths>`)} for the rest.`;
}

/** Instructions, policy and verifier notices, and what memory did: one visible paragraph each (slot 2). */
function notices(view: ReviewView): string | null {
  const out: string[] = [];
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

function coverageCell(view: ReviewView, c: Extract<GlanceRow, { key: "coverage" }>): string {
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
    text += `; ${c.total - c.reviewed} not reviewed, listed under Files not reviewed. Ask ${codeSpan(`${view.mention} review <paths>`)} for the rest`;
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

function glanceTable(view: ReviewView): string {
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
        rows.push(["Coverage", coverageCell(view, row)]);
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

function findingTable(view: ReviewView, rows: FindingRow[], prefix: RowPrefix, shown = rows.length): string {
  const lines = rows
    .slice(0, shown)
    .map((r) => `| ${kindCell(view, r, prefix)} | ${where(view, r)} | ${escapeCell(r.title)} |`);
  const table = ["| | Where | Finding |", "| --- | --- | --- |", ...lines].join("\n");
  const left = rows.length - shown;
  if (left === 0) return table;
  const onLines = rows.slice(shown).every((r) => r.inlineThread);
  return `${table}\n\n- … and ${left} more not shown because of GitHub's size limit${onLines ? ", they are on their lines" : ""}.`;
}

const visible = (heading: string, n: number, inner: string) => `### ${heading} (${n})\n\n${inner}`;

// ---- The rest of the slots -----------------------------------------------------------------------

/** `- `kind` · `loc` — why` for each risk fact, then the files a path rule or a heuristic marked. */
function riskFacts(view: ReviewView, shown?: number): string | null {
  const risk = view.risk;
  if (!risk) return null;
  const covered = new Set(risk.facts.map((f) => f.path));
  const MAX_PATH_BULLETS = 20;
  const ruleReasons = risk.pathReasons.filter((r) => r.rule);
  const heuristic = risk.pathReasons.filter((r) => !r.rule && !covered.has(r.path));
  const bullet = (r: { displayPath: string; why: string }) => `- ${codeSpan(r.displayPath)} — ${oneLineText(r.why)}`;
  const bullets = [
    ...risk.facts.map((f) => `- ${codeSpan(f.kind)} · ${where(view, f)} — ${oneLineText(f.why)}`),
    ...ruleReasons.slice(0, MAX_PATH_BULLETS).map(bullet),
    ...(ruleReasons.length > MAX_PATH_BULLETS ? [`- and ${ruleReasons.length - MAX_PATH_BULLETS} more files matched by path rules`] : []),
    ...heuristic.map(bullet),
  ];
  if (bullets.length === 0) return null;
  const kept = shown === undefined ? bullets : bullets.slice(0, shown);
  const left = bullets.length - kept.length;
  const note = left > 0 ? [`- … and ${left} more not shown because of GitHub's size limit`] : [];
  return `### Risk facts\n\n${[...kept, ...note].join("\n")}`;
}

function needsPerson(view: ReviewView): string | null {
  if (view.needsPerson.length === 0) return null;
  const items = view.needsPerson.map((i) => `- ${where(view, i)} · ${KIND_WORD[i.kind]} — ${oneLineText(i.why)}`);
  return `### Needs a person\n\n${items.join("\n")}`;
}

/** The rows with no inline thread, each with the model's body: a finding with no thread has nowhere else to put it. */
function detailRows(view: ReviewView, limits: RowLimits, dropped: ReadonlySet<SlotId>): FindingRow[] {
  const f = view.findings;
  const shown = (rows: FindingRow[], id: SlotId, n?: number) => (dropped.has(id) ? [] : rows.slice(0, n));
  return [
    ...shown(f.toFix, "toFix", limits.toFix),
    ...shown(f.investigate, "investigate", limits.investigate),
    ...shown(f.consider, "consider"),
    ...shown(f.preExisting, "preExisting", limits.preExisting),
    ...shown(f.info, "info"),
  ].filter((r) => !r.inlineThread);
}

function details(view: ReviewView, limits: RowLimits, dropped: ReadonlySet<SlotId>): string | null {
  const rows = detailRows(view, limits, dropped);
  if (rows.length === 0) return null;
  const items = rows.map((r) => {
    const confidence = r.confidence ? ` (confidence ${r.confidence})` : "";
    return `**${oneLineText(r.title)}${confidence}** (${where(view, r)})\n\n${block(r.body)}`;
  });
  return collapsed(`Details of findings with no thread (${rows.length})`, items.join("\n\n"));
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

/** Every file not reviewed, grouped by reason (partial reviews only). */
function notReviewedFiles(view: ReviewView): string | null {
  const { files } = view;
  const total = files.total - files.reviewed;
  if (total === 0) return null;
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
export type RowLimits = Partial<Record<"toFix" | "investigate" | "preExisting" | "riskFacts", number>>;

/** The slots of the review body in their order, empty ones left out. `limits` cuts a table to its first rows. */
export function renderSlots(view: ReviewView, limits: RowLimits = {}, dropped: ReadonlySet<SlotId> = new Set()): Slot[] {
  const f = view.findings;
  const slots: Slot[] = [];
  const add = (id: SlotId, text: string | null | undefined) => {
    if (text) slots.push({ id, text });
  };

  add("status", renderStatusLine(computeStatus(view)));
  add("callout", partialCallout(view));
  add("notices", notices(view));
  add("glance", glanceTable(view));
  if (f.toFix.length > 0) add("toFix", visible("To fix", f.toFix.length, findingTable(view, f.toFix, "", limits.toFix)));
  if (f.investigate.length > 0) {
    add("investigate", visible("Needs investigation", f.investigate.length, findingTable(view, f.investigate, "Needs investigation", limits.investigate)));
  }
  if (f.consider.length > 0) {
    const table = findingTable(view, f.consider, "");
    add("consider", f.consider.length > CONSIDER_OPEN_ROWS ? collapsed(`To consider (${f.consider.length})`, table) : visible("To consider", f.consider.length, table));
  }
  add("needsPerson", needsPerson(view));
  add("riskFacts", riskFacts(view, limits.riskFacts));
  if (f.preExisting.length > 0) {
    const table = findingTable(view, f.preExisting, "Pre-existing", limits.preExisting);
    const demanding = f.preExisting.some((r) => r.severity === "blocker" || r.severity === "fix");
    add("preExisting", demanding ? visible("Pre-existing", f.preExisting.length, table) : collapsed(`Pre-existing (${f.preExisting.length})`, table));
  }
  if (f.info.length > 0) add("info", collapsed(`For your information (${f.info.length})`, findingTable(view, f.info, "")));
  const contracts = [...view.contracts.open, ...view.contracts.closed];
  add("connects", renderContracts(contracts));
  if (view.batchProse.trim()) add("checked", collapsed("What the reviewer checked", block(view.batchProse)));
  add("coverage", coverage(view));
  add("notReviewedFiles", notReviewedFiles(view));
  add("details", details(view, limits, dropped));
  add("answer", ANSWER_LINE);
  add("receipt", view.footer.receipt);
  add("cost", view.footer.costLine);
  if (view.footer.markers.length > 0) add("markers", view.footer.markers.join("\n\n"));
  return slots;
}

const join = (slots: Slot[]) => slots.map((s) => s.text).join("\n\n");

/** Slots the size fitting drops whole, in this order (spec: 12, 11, 13, 13a, details, 10, 9, 6). */
const DROP_ORDER: SlotId[] = ["checked", "connects", "coverage", "notReviewedFiles", "details", "info", "preExisting", "consider"];

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

/**
 * Interim size fitting (unit 3 replaces it with the full rule): whole slots go in `DROP_ORDER`
 * until the body fits, never one that holds a Blocker or Fix (Pre-existing) or a row with no other
 * home (the details of To fix and Needs investigation); then the long tables (and the details of
 * the rows they show) are cut to their first rows, Blockers first, with a note. The "Muted by
 * memory" list is cut only when it alone would not fit. The status, glance, answer line, receipt,
 * cost line and markers are never touched.
 */
function fit(view: ReviewView, limit: number): string {
  const render = (v: ReviewView, limits: RowLimits, dropped: ReadonlySet<SlotId>) =>
    join(renderSlots(v, limits, dropped).filter((s) => !dropped.has(s.id)));
  const dropped = new Set<SlotId>();
  const whole = render(view, {}, dropped);
  if (whole.length <= limit) return whole;
  const f = view.findings;
  const demandingPre = f.preExisting.some((r) => r.severity === "blocker" || r.severity === "fix");
  const detailsHold = [...f.toFix, ...f.investigate].some((r) => !r.inlineThread);
  for (const id of DROP_ORDER) {
    if (id === "preExisting" && demandingPre) continue;
    if (id === "details" && detailsHold) continue;
    dropped.add(id);
    const text = render(view, {}, dropped);
    if (text.length <= limit) return text;
  }
  // Still over: the memory list keeps what fits next to the smallest body the tables can make, then
  // the largest cuttable table is halved until the body fits or nothing is left to cut.
  const limits: RowLimits = {};
  const sizes = () => ({
    toFix: f.toFix.length,
    investigate: f.investigate.length,
    preExisting: f.preExisting.length,
    riskFacts: view.risk ? view.risk.facts.length + view.risk.pathReasons.length : 0,
  });
  const smallest: RowLimits = { toFix: 0, investigate: 0, preExisting: 0, riskFacts: 0 };
  let shownView = view;
  if (view.memoryNotices) {
    const rest = render({ ...view, memoryNotices: "" }, smallest, dropped).length;
    const room = limit - rest - 2;
    if (view.memoryNotices.length > room) shownView = { ...view, memoryNotices: fitMemoryNotices(view.memoryNotices, room) };
  }
  let text = render(shownView, limits, dropped);
  for (let guard = 0; guard < 64 && text.length > limit; guard++) {
    const now = sizes();
    const shown = (k: keyof RowLimits) => limits[k] ?? now[k];
    const widest = (Object.keys(now) as (keyof RowLimits)[]).sort((a, b) => shown(b) - shown(a))[0];
    if (shown(widest) === 0) break;
    limits[widest] = Math.floor(shown(widest) / 2);
    text = render(shownView, limits, dropped);
  }
  return text;
}

/**
 * The review body for GitHub. With `limit`, a body over it is fitted as above (the interim rule);
 * without, the whole body.
 */
export function renderReviewBody(view: ReviewView, limit = Number.POSITIVE_INFINITY): string {
  return Number.isFinite(limit) ? fit(view, limit) : join(renderSlots(view));
}
