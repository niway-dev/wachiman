#!/usr/bin/env bun
/**
 * How often the reviewer is right, measured from the owner's replies.
 *
 *   bun src/precision.ts <owner/repo>… [--prs <n>]
 *
 * A maintainer tool, not part of the review: it only reads GitHub. For each of the last `n` pull
 * requests (default 50) of each repository, it pairs every inline finding the reviewer posted with
 * the first reply in its thread that starts with "Verdict:" and prints, per severity, topic and
 * model and confidence, how many findings were judged correct, partly correct or wrong. A finding with no verdict
 * reply is counted as unjudged, not as correct.
 *
 * The verdict convention the owner writes in a finding's thread:
 *   Verdict: correct …            the finding was right
 *   Verdict: wrong …              a false positive
 *   Verdict: partially wrong …    or any verdict that says both "correct" and "wrong"
 *
 * Why: a change to the prompt rules has to show it lowers false positives without hiding real
 * findings, and the owner's verdicts are the only ground truth available.
 */
import { defaultGh, isWachiFinding, type GhFn } from "./engine";

export type Verdict = "correct" | "partial" | "wrong" | "unjudged";

export interface ParsedLabel {
  severity: string;
  topic: string;
  /** `high`, `medium` or `low`, from `(confidence high)` in the label; absent on findings from before it existed. */
  confidence?: string;
}

/**
 * The severity and topic of a finding comment's first line. Reads the current label
 * (`🟠🐛 **Fix · bug: … (confidence high)**`) and the one used before v1.1.0 (`**Should fix (correctness): …**`),
 * so older reviews still count; the old ones keep their old names.
 */
export function parseLabel(body: string): ParsedLabel | null {
  const first = body.split("\n", 1)[0];
  const current = first.match(/\*\*(Blocker|Fix|Consider|Info) · ([a-z]+):/);
  if (current) {
    const confidence = first.match(/\(confidence (high|medium|low)\)\*\*\s*$/)?.[1];
    return { severity: current[1].toLowerCase(), topic: current[2], ...(confidence ? { confidence } : {}) };
  }
  const old = first.match(/\*\*(Should fix|Note) \(([a-z]+)\):/);
  if (old) return { severity: old[1] === "Should fix" ? "should_fix (old)" : "note (old)", topic: old[2] };
  return null;
}

/** The verdict in an owner's reply, or null when the reply is not a verdict. */
export function parseVerdict(body: string): Exclude<Verdict, "unjudged"> | null {
  const match = body.match(/^\W*verdict\W*:\W*(.+)/im);
  if (!match) return null;
  // Only the verdict's own sentence: the explanation after it may say "half" or "wrong" about the code.
  const text = match[1].split(/\.(?:\s|\*|$)|\*\*/)[0].toLowerCase();
  const correct = /\bcorrect\b/.test(text);
  const wrong = /\bwrong\b|\bincorrect\b|false positive/.test(text);
  if (/\bpartial(ly)?\b|\bpartly\b|\bhalf\b/.test(text) || (correct && wrong)) return "partial";
  if (wrong) return "wrong";
  if (correct) return "correct";
  return null;
}

/** The model name from a review body's footer, `<sub>Claude Sonnet 5.5 via Claude Code … · $0.03</sub>`. */
export function parseModel(reviewBody: string): string {
  return reviewBody.match(/<sub>(.+?) via /)?.[1] ?? "unknown";
}

export interface RawComment {
  id: number;
  in_reply_to_id?: number | null;
  pull_request_review_id?: number | null;
  user: { login: string };
  body: string;
  created_at?: string;
}

export interface Judged {
  severity: string;
  topic: string;
  /** Absent for a finding posted before the label carried it. */
  confidence?: string;
  model: string;
  verdict: Verdict;
}

/** Each of the reviewer's root comments with its label, its model and the first verdict in its thread. */
export function judge(
  comments: RawComment[],
  modelOfReview: Map<number, string>,
  botLogin = "github-actions[bot]",
): Judged[] {
  // Signed roots, and unsigned ones in the old label format from before `LEGACY_CUTOFF` (see `isWachiFinding`).
  const roots = comments.filter(
    (c) => c.user.login === botLogin && !c.in_reply_to_id && isWachiFinding(c.body, c.created_at),
  );
  return roots.flatMap((root) => {
    const label = parseLabel(root.body);
    if (!label) return [];
    const verdict =
      comments
        .filter((c) => c.in_reply_to_id === root.id && c.user.login !== botLogin)
        .map((c) => parseVerdict(c.body))
        .find((v) => v !== null) ?? "unjudged";
    const model = modelOfReview.get(root.pull_request_review_id ?? -1) ?? "unknown";
    return [{ ...label, model, verdict }];
  });
}

/**
 * One markdown table per dimension. Precision is correct over judged, with a partly correct
 * finding counted as half: it found something real and also asked for something wrong.
 */
export function report(rows: Judged[]): string {
  const dims: [string, (r: Judged) => string][] = [
    ["Severity", (r) => r.severity],
    ["Topic", (r) => r.topic],
    // Only once some finding carries it: older reviews would make the table a single "unlabelled" row.
    ...(rows.some((r) => r.confidence)
      ? [["Confidence", (r: Judged) => r.confidence ?? "unlabelled"] as [string, (r: Judged) => string]]
      : []),
    ["Model", (r) => r.model],
  ];
  const tables = dims.map(([name, key]) => {
    const groups = new Map<string, Judged[]>();
    for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
    const lines = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([group, rs]) => {
        const n = (v: Verdict) => rs.filter((r) => r.verdict === v).length;
        const judged = rs.length - n("unjudged");
        const precision = judged === 0 ? "n/a" : `${Math.round(((n("correct") + n("partial") / 2) / judged) * 100)}%`;
        return `| ${group} | ${rs.length} | ${n("correct")} | ${n("partial")} | ${n("wrong")} | ${n("unjudged")} | ${precision} |`;
      });
    return [
      `### By ${name.toLowerCase()}`,
      "",
      `| ${name} | Findings | Correct | Partly | Wrong | Unjudged | Precision |`,
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...lines,
    ].join("\n");
  });
  return tables.join("\n\n");
}

function collect(gh: GhFn, repo: string, prs: number): Judged[] {
  const numbers = gh(["pr", "list", "-R", repo, "--state", "all", "--limit", String(prs), "--json", "number", "--jq", ".[].number"])
    .split("\n")
    .filter(Boolean)
    .map(Number);
  return numbers.flatMap((pr) => {
    const comments = JSON.parse(
      gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr}/comments`]),
    ).flat() as RawComment[];
    if (!comments.some((c) => c.user.login === "github-actions[bot]")) return [];
    const reviews = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr}/reviews`])).flat() as {
      id: number;
      body: string;
    }[];
    return judge(comments, new Map(reviews.map((r) => [r.id, parseModel(r.body ?? "")])));
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--prs");
  const prs = at >= 0 ? Number(args[at + 1]) : 50;
  const repos = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
  if (repos.length === 0 || !Number.isInteger(prs) || prs < 1) {
    console.error("Usage: bun src/precision.ts <owner/repo>… [--prs <n>]");
    process.exit(2);
  }
  const rows = repos.flatMap((repo) => collect(defaultGh, repo, prs));
  console.log(`${rows.length} finding(s) in ${repos.join(", ")}, last ${prs} pull requests each.\n`);
  console.log(report(rows));
}
