/**
 * The "Review summary — local" comment of `wachiman loop` (ADR 0054): one Markdown document,
 * generated only by this module from the loop state and the verdicts, never typed by an agent.
 * Pure: no filesystem, no git, no GitHub. The same state and verdicts give the same text, which is
 * what lets `--publish` edit the comment in place and the golden tests pin every shape.
 *
 * The first line is a marker that carries the kind of summary (`local` here; a `remote` summary of
 * a pull request review can exist later under its own kind). `SUMMARY_KIND` is the only place the
 * kind is written.
 *
 * Rows adapt to the data: one version or model has no per-round ranges; a round the state has no
 * data for says `not recorded` and the totals name the rounds missing; no findings means no
 * findings table. Everything that came from a model or a person is made safe for a table cell.
 */
import { SEVERITY, type Severity } from "../engine";
import { dollars, location, sha7 } from "../sinks/common";
import type { LoopRound, LoopState } from "./state";
import { evaluate, type LoopFinding } from "./stop-rule";

/** The kind of this summary. A future remote summary adds its own kind; nothing else changes. */
export const SUMMARY_KIND = "local";
export const SUMMARY_MARKER = `<!-- wachiman-review-summary:${SUMMARY_KIND} -->`;
const TITLE = `Review summary — ${SUMMARY_KIND}`;
/**
 * The summary is a wide table, a collapsed block and a footnote, which three of markdownlint's
 * default rules reject on principle (MD013 line length, MD033 inline HTML, MD041 first-line heading).
 * One invisible directive after the marker turns exactly those off, so a repository that lints its
 * Markdown, or a tool that checks the comment, finds nothing to fix. Every other rule still applies.
 */
const LINT_DIRECTIVE = "<!-- markdownlint-disable MD013 MD033 MD041 -->";
const NOT_RECORDED = "not recorded";

/** A finding of the loop with its history verdict, as the stop rule reads it, and the round that first reported it. */
export type SummaryFinding = LoopFinding & { round?: number };

export interface SummaryInput {
  state: LoopState;
  /** `state.ledger` with the verdicts read now. */
  findings: SummaryFinding[];
  /** The agent that posts the summary, when it said so. Absent: the user posts it. */
  agent?: string;
}

type Outcome = { kind: "fixed" | "declined" | "open" | "noted"; text: string; judgedWrong?: string; unreasoned?: boolean };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Text a model or a person wrote, safe inside a table cell or a list line: no tag (so no comment),
 * no mention and no pipe. `<` and `>` become entities, which also defuses `<!--` and `-->`.
 */
const safe = (text: string) =>
  oneLine(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "\\|").replace(/@(?=\w)/g, "@&#8203;");

/** The cited place as code. In a table a pipe in the path would end the cell, so it is escaped there. */
const where = (f: LoopFinding, inTable: boolean) => `\`${inTable ? location(f).replaceAll("|", "\\|") : location(f)}\``;

/** A reason as the end of a sentence: one line, cut, without its own closing punctuation. */
const reasonText = (text: string, max: number) => clip(safe(text), max).replace(/[.!?\s]+$/, "");

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** "Claude Sonnet 5.5" for `claude-sonnet-5-5`; any other id as it is. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

/** `42 s`, `11 min 17 s`, `1 h 02 min`. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${String(total % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** `round 3`, `rounds 1-4`, `rounds 1-2, 4`. */
export function roundsText(rounds: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < rounds.length; ) {
    let j = i;
    while (j + 1 < rounds.length && rounds[j + 1] === rounds[j] + 1) j++;
    runs.push(j === i ? `${rounds[i]}` : `${rounds[i]}-${rounds[j]}`);
    i = j + 1;
  }
  return `${rounds.length === 1 ? "round" : "rounds"} ${runs.join(", ")}`;
}

/** A round after the first with the same head as the one before it made no review call: there was nothing new to read. */
const quiet = (rounds: LoopRound[], i: number) => i > 0 && rounds[i - 1].head === rounds[i].head;

type Slot = { round: LoopRound; label: string | undefined };

/**
 * Groups the rounds by `label` (undefined: the state has no data for that round). A round that made
 * no review call carries no data of its own and joins the group of the round before it.
 */
function groups(rounds: LoopRound[], label: (r: LoopRound) => string): { recorded: { label: string; rounds: number[] }[]; missing: number[] } {
  const slots: Slot[] = rounds.map((round, i) => ({ round, label: round.review ? label(round) : quiet(rounds, i) ? "" : undefined }));
  const recorded: { label: string; rounds: number[] }[] = [];
  const missing: number[] = [];
  let current = "";
  for (const s of slots) {
    if (s.label === undefined) {
      missing.push(s.round.round);
      current = "";
      continue;
    }
    const name = s.label === "" ? current : s.label;
    if (name === "") continue;
    current = name;
    const last = recorded.at(-1);
    if (last && last.label === name && last.rounds.at(-1) === s.round.round - 1) last.rounds.push(s.round.round);
    else recorded.push({ label: name, rounds: [s.round.round] });
  }
  return { recorded, missing };
}

/** One row cell for a per-round fact: the single value, or each value with its rounds, plus the rounds with no data. */
function perRound(rounds: LoopRound[], label: (r: LoopRound) => string, prefix = ""): string {
  const { recorded, missing } = groups(rounds, label);
  if (recorded.length === 0) return NOT_RECORDED;
  const only = recorded.length === 1 && missing.length === 0;
  const body = only ? recorded[0].label : recorded.map((g) => `${g.label} (${roundsText(g.rounds)})`).join(", ");
  return `${prefix}${body}${missing.length > 0 ? `; ${NOT_RECORDED} for ${roundsText(missing)}` : ""}`;
}

const modelLabel = (r: LoopRound) => {
  const v = r.review!;
  const verifier = v.verifier ? `verifier ${modelName(v.verifier.model)} ${v.verifier.effort}` : "verifier off";
  return `${modelName(v.reviewer.model)} ${v.reviewer.effort}, ${verifier}`;
};

const RANK: Record<Severity, number> = { blocker: 0, fix: 1, consider: 2, info: 3 };

/** What became of each finding, in plain words. The stop rule decides the counted ones; the same words apply to the notes. */
function outcomes(findings: SummaryFinding[]): Map<string, Outcome> {
  const decision = evaluate(findings);
  const out = new Map<string, Outcome>();
  for (const f of decision.open) {
    out.set(f.id, {
      kind: "open",
      unreasoned: f.unreasonedWrong,
      text: f.unreasonedWrong
        ? "open (judged wrong without a reason, so it still counts)"
        : f.status === "not-repeated"
          ? "open (not reported again, but the cited line is still there)"
          : f.status === "unknown"
            ? "open (its file was not read again since)"
            : "open",
    });
  }
  for (const r of decision.released) {
    if (r.why === "probably-fixed") out.set(r.finding.id, { kind: "fixed", text: "fixed (the cited line changed)" });
    else if (r.why === "refuted") out.set(r.finding.id, { kind: "declined", text: "declined (the verifier disproved it)" });
    else out.set(r.finding.id, { kind: "declined", judgedWrong: r.reason ?? "", text: `declined (judged wrong: ${reasonText(r.reason ?? "", 140)})` });
  }
  for (const f of decision.notes) out.set(f.id, { kind: "noted", text: "noted (never holds the loop open)" });
  // A 🟡 or ⚪ the stop rule leaves out because something already settled it.
  for (const f of findings) {
    if (out.has(f.id)) continue;
    const reason = f.verdict?.verdict === "wrong" ? f.verdict.reason?.trim() : undefined;
    if (reason) out.set(f.id, { kind: "declined", judgedWrong: reason, text: `declined (judged wrong: ${reasonText(reason, 140)})` });
    else if (f.refuted) out.set(f.id, { kind: "declined", text: "declined (the verifier disproved it)" });
    else out.set(f.id, { kind: "fixed", text: "fixed (the cited line changed)" });
  }
  return out;
}

const tag = (f: LoopFinding) => `${SEVERITY[f.severity].emoji} ${SEVERITY[f.severity].word}`;

function judgment(findings: SummaryFinding[], outcome: Map<string, Outcome>): string[] {
  const lines: string[] = [];
  for (const f of findings) {
    const o = outcome.get(f.id)!;
    const what = `${where(f, false)} — ${clip(safe(f.title), 160)} (id \`${f.id}\`)`;
    if (o.kind === "open") lines.push(`- ${tag(f)} ${what}. Still ${o.text}.`);
    else if (o.judgedWrong !== undefined && o.judgedWrong !== "") lines.push(`- ${tag(f)} ${what}. Judged wrong, with this reason: ${reasonText(o.judgedWrong, 300)}. Overrule it if it is wrong.`);
    else if (f.verdict?.verdict === "partial") {
      const why = f.verdict.reason?.trim();
      lines.push(`- ${tag(f)} ${what}. Judged partly right${why ? `: ${reasonText(why, 300)}` : ""}.`);
    }
  }
  return lines;
}

function counts(findings: SummaryFinding[], outcome: Map<string, Outcome>): string {
  if (findings.length === 0) return "0";
  const n = (kind: Outcome["kind"]) => findings.filter((f) => outcome.get(f.id)!.kind === kind).length;
  const parts = ([["fixed", "fixed"], ["declined", "declined"], ["open", "open"], ["noted", "noted"]] as const)
    .map(([kind, word]) => [n(kind), word] as const)
    .filter(([c]) => c > 0)
    .map(([c, word]) => `${c} ${word}`);
  return `${findings.length}: ${parts.join(", ")}`;
}

/** The cost and time of the rounds that have data; the rounds that do not are named, never counted as zero. */
function totals(rounds: LoopRound[]): string {
  const reviewed = rounds.filter((r) => r.review);
  const missing = rounds.filter((r, i) => !r.review && !quiet(rounds, i)).map((r) => r.round);
  if (reviewed.length === 0 && missing.length > 0) return NOT_RECORDED;
  const cost = reviewed.reduce((sum, r) => sum + r.review!.costUsd, 0);
  const time = reviewed.reduce((sum, r) => sum + r.review!.durationMs, 0);
  const note = missing.length > 0 ? ` (${NOT_RECORDED} for ${roundsText(missing)})` : "";
  return `${dollars(cost)} API-equivalent, ${duration(time)}${note}`;
}

export function renderSummary({ state, findings, agent }: SummaryInput): string {
  const rounds = state.rounds;
  const last = rounds.at(-1);
  const outcome = outcomes(findings);
  const open = findings.filter((f) => outcome.get(f.id)!.kind === "open");
  const stopped = state.status !== "converged" && state.maxRounds !== undefined && rounds.length >= state.maxRounds;
  const budget =
    state.maxRounds === undefined
      ? ""
      : ` (budget ${state.maxRounds}${stopped ? `; stopped at the budget: ${open.length} finding${open.length === 1 ? "" : "s"} still keep${open.length === 1 ? "s" : ""} the loop open` : ""})`;
  const first = rounds.find((r) => r.review)?.review;
  const lastReviewed = [...rounds].reverse().find((r) => r.review);
  const reviewed = first && lastReviewed ? `\`${sha7(first.base)}..${sha7(lastReviewed.head)}\`` : NOT_RECORDED;

  const rows: [string, string][] = [
    ["Review", `Local, before push. Posted by ${agent ? `an agent (${safe(agent)})` : "the user"}`],
    ["Reviewer", perRound(rounds, (r) => r.review!.version, "Wachiman ")],
    ["Model", perRound(rounds, modelLabel)],
    ["Rounds", `${rounds.length}${budget}`],
    ["Findings", counts(findings, outcome)],
    ["Reviewed", reviewed],
    ["Wachiman cost", totals(rounds)],
  ];
  const lines = [SUMMARY_MARKER, LINT_DIRECTIVE, `| ${TITLE} | |`, "| --- | --- |", ...rows.map(([k, v]) => `| **${k}** | ${v} |`), ""];

  const judge = judgment(
    [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]),
    outcome,
  );
  if (judge.length > 0) lines.push("**Needs your judgment:**", "", ...judge, "");

  lines.push("<details>", `<summary>Everything the local review caught (${findings.length})</summary>`, "");
  lines.push("| round | range | findings | cost | time |", "| --- | --- | --- | --- | --- |");
  for (const [i, r] of rounds.entries()) {
    const v = r.review;
    if (v) lines.push(`| ${r.round} | \`${sha7(v.base)}..${sha7(r.head)}\` | ${v.newFindings} | ${dollars(v.costUsd)} | ${duration(v.durationMs)} |`);
    else if (quiet(rounds, i)) lines.push(`| ${r.round} | no new commit, no review | — | — | — |`);
    else lines.push(`| ${r.round} | ${NOT_RECORDED} | ${NOT_RECORDED} | ${NOT_RECORDED} | ${NOT_RECORDED} |`);
  }
  if (findings.length > 0) {
    lines.push("", "| id | round | severity | finding | status |", "| --- | --- | --- | --- | --- |");
    const ordered = [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.round ?? Infinity) - (b.round ?? Infinity));
    for (const f of ordered) {
      lines.push(`| \`${f.id}\` | ${f.round ?? NOT_RECORDED} | ${tag(f)} | ${where(f, true)} ${clip(safe(f.title), 160)} | ${outcome.get(f.id)!.text} |`);
    }
  }
  lines.push("", "</details>", "", `<sub>Summary as of \`${last ? sha7(last.head) : NOT_RECORDED}\`.</sub>`);
  return `${lines.join("\n")}\n`;
}
