/**
 * The PR Confidence block in a pull request description (ADR 0033 decisions 7 and 14, spec "The
 * description block"). The review body is the record; this block is a mirror of it between two
 * markers. `renderBlock` writes the grade, `cannotSayBlock` writes the reset that goes in before
 * any model call, and `upsertBlock` puts either into a body without touching a byte outside the
 * markers. Pure string work.
 *
 * Everything a model wrote is made inert before it is placed here: it cannot close the block,
 * open a link, mention a person, or end the `<details>` section.
 */
import { inertText } from "./inert";
import { BLOCK_END, BLOCK_START, blockRegions, digestComment } from "./digest";
import { groupByFile, trialBound } from "./grade";
import type { Attention, Claim, Evidence, Fidelity, Grade } from "./types";

export interface BlockOptions {
  /** Link to the full review. Left out when absent or not an https URL. */
  reviewUrl?: string;
  /** The commit the review read; links point at it, never at `HEAD`. */
  reviewedCommit: string;
  /** The date shown, `YYYY-MM-DD`; empty to show none. */
  date: string;
  /** The repository URL, `https://github.com/owner/repo`; without it the block has no links. */
  permalinkBase?: string;
}

const ALERT: Record<Grade, string> = {
  A: "TIP",
  "A-": "NOTE",
  B: "WARNING",
  C: "CAUTION",
  "cannot say": "IMPORTANT",
};

const TITLE = "## 👮 Wachiman · PR Confidence";
const FOOTER =
  "<sub>👮 Wachiman · measures whether the diff does what the pull request says, not code quality. " +
  "Edits to the description do not update this block until the next push.</sub>";
const A_MEANS = "Every claim has cited evidence and no change is unexplained";
const NOT_SAFE = "This is not a statement that the pull request is safe to merge unread.";

const COMMIT = /^[0-9a-f]{7,64}$/i;

/** Model text as one inert line (see `inertText`). */
const safe = inertText;

/** A path or commit as an inline code span. */
const code = (text: string) => `\`${text.replace(/[`\r\n]/g, "")}\``;

const shortCommit = (commit: string) => (COMMIT.test(commit) ? commit.slice(0, 7) : commit);

const encodePath = (path: string) =>
  path
    .split("/")
    .map((s) => encodeURIComponent(s).replaceAll("(", "%28").replaceAll(")", "%29"))
    .join("/");

/** A link to a file, or a line of it, at a commit. Undefined when there is no repository or the commit is not a hash. */
function permalink(opts: BlockOptions, path: string, line?: number): string | undefined {
  const base = opts.permalinkBase?.replace(/\/+$/, "");
  if (!base || !/^https:\/\/[^\s<>]+$/.test(base) || !COMMIT.test(opts.reviewedCommit)) return undefined;
  return `${base}/blob/${opts.reviewedCommit}/${encodePath(path)}${line ? `#L${line}` : ""}`;
}

const link = (label: string, url: string | undefined) => (url ? `[${label}](<${url}>)` : label);

function reviewedLine(opts: BlockOptions, lead: string, tail: string): string {
  const review =
    opts.reviewUrl && /^https:\/\/[^\s<>]+$/.test(opts.reviewUrl) ? ` · [full review](<${opts.reviewUrl}>)` : "";
  const on = opts.date ? ` on ${safe(opts.date)}` : "";
  return `${lead} ${code(shortCommit(opts.reviewedCommit))}${on}${review}${tail}`;
}

const range = (e: Evidence) => `L${e.line}${e.endLine ? `–L${e.endLine}` : ""}`;

function attentionLines(items: Attention[], opts: BlockOptions): string[] {
  const lines: string[] = [];
  for (const group of groupByFile(items)) {
    const place = (item: Attention) => permalink(opts, group.path, item.line);
    const [only] = group.items;
    if (group.items.length === 1 && only) {
      const label = `${code(group.path)}${only.line ? ` L${only.line}` : ""}`;
      lines.push(`- ${link(label, place(only))} — ${safe(only.text)}`);
      continue;
    }
    lines.push(`- ${link(code(group.path), permalink(opts, group.path))}`);
    for (const item of group.items) {
      lines.push(`  - ${link(item.line ? `L${item.line}` : "whole file", place(item))} — ${safe(item.text)}`);
    }
  }
  return lines;
}

/** Lower is more urgent: the place the block tells the reader to look at first. */
function urgency(item: Attention): number {
  if (item.kind === "contradicted-claim" || item.severity === "blocker") return 0;
  if (item.kind === "unexplained" || item.kind === "risk-fact" || item.severity === "fix") return 1;
  return 2;
}

const mostUrgent = (items: Attention[]): Attention | undefined =>
  items.reduce<Attention | undefined>((best, item) => (!best || urgency(item) < urgency(best) ? item : best), undefined);

const claimsSentence = (claims: Claim[]): string | undefined => {
  const checkable = claims.filter((c) => c.status !== "vague").length;
  if (checkable === 0) return undefined;
  const confirmed = claims.filter((c) => c.status === "confirmed").length;
  if (confirmed < checkable) return `${confirmed} of ${checkable} claims verified.`;
  return checkable === 1 ? "The claim is verified." : checkable === 2 ? "Both claims verified." : `All ${checkable} claims verified.`;
};

function trialLine(judged: number): string {
  const bound = trialBound(judged);
  const count =
    bound === undefined
      ? "no A-graded pull request has been judged yet."
      : `${judged} A-graded pull request${judged === 1 ? "" : "s"} judged; with no serious miss that bounds the miss rate below about ${(bound * 100).toFixed(1)}%.`;
  return `Trial: ${count} ${NOT_SAFE}`;
}

function evidenceTable(f: Fidelity): string[] {
  const checkable = f.claims.filter((c) => c.status !== "vague").length;
  const confirmed = f.claims.filter((c) => c.status === "confirmed").length;
  const vague = f.claims.length - checkable;
  const contradicted = f.claims.some((c) => c.status === "contradicted");
  let claims: string;
  if (checkable === 0) claims = "❌ No checkable claim";
  else {
    claims = `${contradicted ? "❌" : confirmed === checkable ? "✅" : "⚠️"} ${confirmed} / ${checkable}`;
    if (vague > 0) claims += ` · ${vague} vague, not counted`;
  }
  return [
    "| Evidence | Result |",
    "| :--- | :--- |",
    `| Claims verified | ${claims} |`,
    `| Unexplained changes | ${f.unexplainedFiles.length === 0 ? "✅ None" : `⚠️ ${f.unexplainedFiles.length}`} |`,
    "| Refutation check | — Not performed |",
    `| Sensitive paths | ${f.sensitivePaths.length === 0 ? "✅ None" : `⚠️ ${f.sensitivePaths.length}`} |`,
  ];
}

function claimDetails(f: Fidelity): string[] {
  const checkable = f.claims.filter((c) => c.status !== "vague").length;
  const confirmed = f.claims.filter((c) => c.status === "confirmed");
  const others = f.claims.filter((c) => c.status !== "confirmed");
  const out: string[] = [];
  if (confirmed.length > 0) {
    out.push("<details>", `<summary>✅ Verified claims (${confirmed.length}/${checkable})</summary>`, "");
    for (const c of confirmed) {
      out.push(`- **${safe(c.text)}:** ${c.evidence.map((e) => `${code(e.path)} ${range(e)}`).join(", ")}`);
    }
    out.push("", "</details>", "");
  }
  if (others.length > 0) {
    out.push("<details>", `<summary>⚠️ Claims not verified (${others.length})</summary>`, "");
    for (const c of others) {
      out.push(`- **${safe(c.text)}:** ${c.status === "vague" ? "vague, counts as no claim" : c.status}`);
    }
    out.push("", "</details>", "");
  }
  return out;
}

function wrap(digest: string | undefined, body: string[]): string {
  return [BLOCK_START, ...(digest ? [digestComment(digest)] : []), TITLE, "", ...body, FOOTER, BLOCK_END].join("\n");
}

function cannotSay(
  reasons: string[],
  opts: BlockOptions,
  lead: string,
  digest: string | undefined,
): string {
  const [headline = "The review did not finish", ...more] = reasons.map(safe);
  const commit = code(shortCommit(opts.reviewedCommit));
  return wrap(digest, [
    `> [!${ALERT["cannot say"]}]`,
    `> ### cannot say · ${headline}`,
    ...(more.length > 0 ? [`> ${more.map((r) => `${r}.`).join(" ")}`] : []),
    `> No grade for ${commit}. A grade from an earlier commit does not apply to it.`,
    "",
    reviewedLine(opts, lead, ""),
    "",
  ]);
}

/**
 * The block for a review that produced a grade. A `cannot say` grade renders without the claims or
 * the table: with an incomplete run they would read as evidence.
 */
export function renderBlock(f: Fidelity, opts: BlockOptions): string {
  if (f.grade === "cannot say") return cannotSay(f.reasons, opts, "Reviewed at", f.digest);

  const [first, ...rest] = f.reasons;
  const headline = f.grade === "A" ? A_MEANS : safe(first ?? "");
  const label = f.trial ? `${f.grade} (trial)` : f.grade;
  const alert = [`> [!${ALERT[f.grade]}]`, `> ### ${label} · ${headline}`];

  if (f.grade !== "A") {
    const place = mostUrgent(f.questions);
    const sentences = [
      claimsSentence(f.claims),
      ...rest.map((r) => `${safe(r)}.`),
      place ? `Look at ${code(place.path)}${place.line ? ` line ${place.line}` : ""}.` : undefined,
    ].filter((s) => s !== undefined);
    if (sentences.length > 0) alert.push(`> ${sentences.join(" ")}`);
  }
  if (f.trial) alert.push(`> ${trialLine(f.judgedAGrades)}`);

  const attention = attentionLines(f.questions, opts);
  return wrap(f.digest, [
    ...alert,
    "",
    reviewedLine(opts, "Reviewed at", " · Your check: pending"),
    "",
    ...evidenceTable(f),
    "",
    ...(attention.length > 0 ? ["**👀 Your attention**", "", ...attention, ""] : []),
    ...claimDetails(f),
  ]);
}

/**
 * The reset block: `cannot say` for one commit, with nothing from an earlier commit. It is written
 * by a step that makes no model call, before the push wait, so a run that is cancelled, fails or
 * hits the ceiling leaves no old letter. It carries no digest: no text has been read yet.
 */
export function cannotSayBlock(
  commit: string,
  reason: string,
  opts: { date?: string; reviewUrl?: string } = {},
): string {
  return cannotSay([reason], { ...opts, reviewedCommit: commit, date: opts.date ?? "" }, "Commit", undefined);
}

/** True when the text is exactly one whole block. */
const isWholeBlock = (text: string) => {
  const regions = blockRegions(text);
  return regions.length === 1 && regions[0]?.start === 0 && regions[0].end === text.length;
};

/**
 * Puts the block into a description. The first block already there is replaced where it stands, and
 * any further ones are removed, so a second run never adds a block; a body with no block gets it at
 * the top followed by a blank line. The text outside the markers is not changed. A marker with no
 * partner is text, not a block.
 */
export function upsertBlock(body: string | null | undefined, block: string): string {
  if (!isWholeBlock(block)) throw new Error("upsertBlock expects exactly one whole Wachiman block");
  const text = body ?? "";
  const regions = blockRegions(text);
  if (regions.length === 0) return text === "" ? block : `${block}\n\n${text}`;

  let out = "";
  let at = 0;
  regions.forEach(({ start, end }, i) => {
    out += text.slice(at, start);
    if (i === 0) out += block;
    at = end;
    if (i > 0) at += /^(?:\r?\n){2}/.exec(text.slice(end))?.[0].length ?? 0;
  });
  return out + text.slice(at);
}
