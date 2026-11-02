#!/usr/bin/env bun
/**
 * Joins the dataset's finding rows with the owner's verdicts from the analysis docs.
 *
 * The docs live on the unmerged branch `docs/field-run-kaipu-workspaces` and are read with
 * `git show <ref>:<path>`; a path missing on the ref is read from the working tree.
 *
 * Two families of docs:
 *  - replay docs (`2026-11-01`, `2026-11-02`, `2026-11-02-e1-sonnet`, `prs/pr-46x.md`): tables of
 *    expected issues (E), baseline additions (A) and new findings (N), with one column per run
 *    saying which run found it;
 *  - field docs (`2026-11-02-field/prs/pr-<n>.md`): one table of findings (F), each with the bot,
 *    the round, the verdict and the issue it duplicates.
 *
 * A finding row is matched to a verdict only when the run agrees (replay docs: the verdict's run
 * column says that run found it; field docs: same bot) and the evidence is strong: a path and a
 * line near the one the verdict names, or wording that overlaps clearly more than any other
 * candidate. Everything else goes to ambiguous.md with its best candidates. Nothing is guessed.
 *
 * Usage: bun scripts/benchmark-dataset/labels.ts --dataset docs/benchmark/dataset [--docs-ref docs/field-run-kaipu-workspaces]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, toCsv } from "./parse.ts";

// ---------------------------------------------------------------------------------------------
// Markdown tables

export interface MdTable {
  heading: string;
  header: string[];
  rows: string[][];
}

const splitRow = (line: string): string[] => {
  const cells: string[] = [];
  let cur = "";
  let tick = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "`") {
      tick = !tick;
      cur += ch;
    } else if (ch === "|" && !tick) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
};

export function mdTables(md: string): MdTable[] {
  const out: MdTable[] = [];
  const lines = md.split("\n");
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^#{1,6} /.test(line)) heading = line.replace(/^#+ /, "").trim();
    if (line.startsWith("|") && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && (lines[j] as string).startsWith("|")) {
        rows.push(splitRow(lines[j] as string));
        j++;
      }
      out.push({ heading, header, rows });
      i = j - 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Verdicts

export interface Verdict {
  doc: string;
  original_pr: string;
  id: string;
  kind: "expected" | "additional" | "new" | "field";
  text: string;
  /** Replay docs: run labels whose column says the run found it. */
  runs: Set<string>;
  /** Field docs: the bot that posted it. */
  bot: string;
  round: string;
  verdict: string;
  severity: string;
  sameAs: string;
}

const RUN_TOKEN = /\b(W-R\d|W\d|S\d|PF-v\d|CR-v\d)\b/g;
const SINGLE_RUN = /^(?:Opus )?(W-R\d|W\d|S\d|PF-v\d|CR-v\d)$/;
const MULTI_RUN = /^(?:Opus )?((?:W-R\d|W\d|S\d|PF-v\d|CR-v\d)(?:\s*\/\s*(?:W-R\d|W\d|S\d|PF-v\d|CR-v\d))+)$/;

const foundCell = (v: string) => /^(yes|partial|✓|~)/i.test(v.trim());

export function normaliseId(raw: string): string | null {
  const m = /^\*{0,2}([A-Z]{1,2}\d+[a-z]?)\*{0,2}$/.exec(raw.trim());
  if (m) return m[1] as string;
  if (/^\d+$/.test(raw.trim())) return `N${raw.trim()}`;
  return null;
}

/** Verdicts of one replay doc (`prs/pr-46x.md`). */
export function parseReplayDoc(md: string, doc: string, originalPr: string): Verdict[] {
  const out: Verdict[] = [];
  for (const t of mdTables(md)) {
    const h0 = (t.header[0] ?? "").trim();
    if (h0 !== "ID" && h0 !== "#") continue;
    const kind: Verdict["kind"] = /^Expected/i.test(t.heading) ? "expected" : /^New/i.test(t.heading) ? "new" : "additional";
    if (/message quality|label calibration|per run|real medium/i.test(t.heading)) continue;
    if (t.header.some((c) => /^Score$/.test(c.trim()))) continue;
    const verdictCol = t.header.findIndex((c) => /^Verdict/i.test(c));
    const sevCol = t.header.findIndex((c) => /^(Real )?severity$/i.test(c));
    for (const row of t.rows) {
      const id = normaliseId(row[0] ?? "");
      if (!id) continue;
      const runs = new Set<string>();
      t.header.forEach((col, i) => {
        const cell = row[i] ?? "";
        const c = col.trim();
        const multi = MULTI_RUN.exec(c);
        if (SINGLE_RUN.test(c)) {
          if (foundCell(cell)) runs.add((SINGLE_RUN.exec(c) as RegExpExecArray)[1] as string);
        } else if (multi) {
          const labels = (multi[1] as string).split("/").map((x) => x.trim());
          const vals = cell.split("/").map((x) => x.trim());
          if (vals.length === labels.length) labels.forEach((l, k) => foundCell(vals[k] as string) && runs.add(l));
        } else if (/^Runs?\b/i.test(c) || /^Sonnet runs$/i.test(c)) {
          for (const m of cell.matchAll(RUN_TOKEN)) runs.add(m[1] as string);
        }
      });
      out.push({
        doc, original_pr: originalPr, id, kind, text: row.join(" | "), runs, bot: "", round: "",
        verdict: verdictCol >= 0 ? (row[verdictCol] ?? "") : "", severity: sevCol >= 0 ? (row[sevCol] ?? "") : "", sameAs: "",
      });
    }
  }
  return out;
}

/** Verdicts of one field doc (`2026-11-02-field/prs/pr-<n>.md`). */
export function parseFieldDoc(md: string, doc: string, originalPr: string): Verdict[] {
  const out: Verdict[] = [];
  for (const t of mdTables(md)) {
    if ((t.header[0] ?? "").trim() !== "ID" || !t.header.some((c) => /^Claim$/i.test(c))) continue;
    const col = (re: RegExp) => t.header.findIndex((c) => re.test(c));
    const iBot = col(/^Bot$/i);
    const iRound = col(/^Round/i);
    const iVerdict = col(/^Verdict/i);
    const iSev = col(/^Severity$/i);
    const iSame = col(/^Same issue as/i);
    for (const row of t.rows) {
      const id = (row[0] ?? "").trim();
      if (!/^F\d+[a-z]?$/.test(id)) continue;
      out.push({
        doc, original_pr: originalPr, id, kind: "field", text: row.join(" | "), runs: new Set(),
        bot: iBot >= 0 ? (row[iBot] ?? "") : "Wachiman", round: iRound >= 0 ? (row[iRound] ?? "") : "",
        verdict: iVerdict >= 0 ? (row[iVerdict] ?? "") : "", severity: iSev >= 0 ? (row[iSev] ?? "") : "", sameAs: iSame >= 0 ? (row[iSame] ?? "") : "",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Matching

export interface Loc {
  file: string;
  lo: number;
  hi: number;
}

const FILE_RE = /([A-Za-z0-9_.@/-]+\.(?:tsx?|jsx?|mjs|css|md|json|sh|ya?ml|py|html|toml|sql))(?::((?:~?\d+(?:[-–]\d+)?)(?:\s*,\s*~?\d+(?:[-–]\d+)?)*))?/g;
const base = (p: string) => (p.split("/").pop() ?? p).toLowerCase();

export function locsOf(text: string): Loc[] {
  const out: Loc[] = [];
  for (const m of text.matchAll(FILE_RE)) {
    const file = base(m[1] as string);
    if (!m[2]) {
      out.push({ file, lo: 0, hi: 0 });
      continue;
    }
    for (const part of (m[2] as string).split(",")) {
      const r = /~?(\d+)(?:[-–](\d+))?/.exec(part);
      if (r) out.push({ file, lo: Number(r[1]), hi: Number(r[2] ?? r[1]) });
    }
  }
  return out;
}

const STOP = new Set(
  "this that with from have has had will would should could does done into than then them they their there these those when where which while what only also more most some such each both over under after before about because still every other again same being been were was are and the for not but can its it's".split(" "),
);

export function tokensOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[`*_"'()[\]{}<>,.;:!?=/\\|]/g, " ").split(/\s+/)) {
    const t = w.replace(/^[-~]+|[-~]+$/g, "");
    if (t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t)) out.add(t);
  }
  return out;
}

export interface Finding {
  key: string;
  tool: string;
  original_pr: string;
  run_label: string;
  path: string;
  line: number | null;
  commit_id: string;
  title: string;
  body: string;
  severity: string;
  topic: string;
  placement: string;
}

export interface Candidate {
  v: Verdict;
  score: number;
  basis: string;
  pathLine: boolean;
  title: number;
  text: number;
}

/** How well a verdict describes a finding, with the reasons. Scores are comparable within one finding. */
export function scoreMatch(f: Finding, v: Verdict, idf: Map<string, number>): Candidate {
  const locs = locsOf(v.text);
  const fb = base(f.path);
  let score = 0;
  let pathLine = false;
  const why: string[] = [];
  const sameFile = locs.filter((l) => l.file === fb);
  if (sameFile.length > 0 && fb) {
    score += 3;
    why.push("path");
    if (f.line !== null && sameFile.some((l) => l.lo > 0 && f.line !== null && f.line >= l.lo - 8 && f.line <= l.hi + 8)) {
      score += 4;
      pathLine = true;
      why.push("line");
    }
  }
  const ft = tokensOf(f.title);
  const fbody = tokensOf(f.body.slice(0, 400));
  const vt = tokensOf(v.text);
  let tw = 0;
  let to = 0;
  for (const t of ft) {
    const w = idf.get(t) ?? 1;
    tw += w;
    if (vt.has(t)) to += w;
  }
  let bo = 0;
  let bw = 0;
  for (const t of fbody) {
    const w = idf.get(t) ?? 1;
    bw += w;
    if (vt.has(t)) bo += w;
  }
  // Field docs name the round of each claim, by label or by commit: the same wording in another round is another posting.
  if (v.kind === "field" && v.round) {
    const sha = /`([0-9a-f]{7,})`/.exec(v.round)?.[1];
    const label = f.run_label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if ((sha && f.commit_id.startsWith(sha.slice(0, 7))) || (label && new RegExp(`^${label}\\b`).test(v.round))) {
      score += 2.5;
      why.push("round");
    }
  }
  const titleOverlap = tw > 0 ? to / tw : 0;
  const bodyOverlap = bw > 0 ? bo / bw : 0;
  score += 6 * titleOverlap + 3 * bodyOverlap;
  if (titleOverlap >= 0.3) why.push(`title ${titleOverlap.toFixed(2)}`);
  if (bodyOverlap >= 0.25) why.push(`text ${bodyOverlap.toFixed(2)}`);
  return { v, score, basis: why.join("+"), pathLine, title: titleOverlap, text: bodyOverlap };
}

export function idfOf(verdicts: Verdict[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const v of verdicts) for (const t of tokensOf(v.text)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = verdicts.length;
  return new Map([...df].map(([t, d]) => [t, Math.log((n + 1) / (d + 0.5)) + 0.5]));
}

/** Minimum score for any match, and the lead the best candidate needs over the runner-up. */
export const ACCEPT = 5.5;
export const MARGIN = 1.5;
/** A path-and-line hit alone is not enough: the same line can host several findings. It needs wording that agrees. */
const corroborated = (c: Candidate) =>
  (c.pathLine && (c.title >= 0.2 || c.text >= 0.15)) || (c.title >= 0.6 && c.score >= 6) || c.score >= 9;

export interface Decision {
  finding: Finding;
  chosen: Candidate | null;
  /** Other verdicts of the same family (F12a, F12b, F12c) the one comment also holds, per the doc. */
  family?: string[];
  ranked: Candidate[];
  reason: string;
}

/** Decides one finding: accept the best candidate when it clears the bar and beats the runner-up. */
export function decide(f: Finding, candidates: Verdict[], idf: Map<string, number>): Decision {
  const ranked = candidates.map((v) => scoreMatch(f, v, idf)).sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  if (!best) return { finding: f, chosen: null, ranked, reason: "no verdict in the docs lists this run for this PR" };
  if (best.score < ACCEPT) return { finding: f, chosen: null, ranked, reason: `best candidate scores ${best.score.toFixed(1)}, below ${ACCEPT}` };
  const lead = second ? best.score - second.score : Number.POSITIVE_INFINITY;
  if (!corroborated(best) && !(lead >= 3)) {
    return { finding: f, chosen: null, ranked, reason: `${best.v.id} matches by ${best.basis || "nothing specific"} only; the wording does not corroborate it` };
  }
  if (second && best.score - second.score < MARGIN) {
    // Two candidates that are the same issue in the doc (one lists the other) are not a conflict.
    const same = best.v.sameAs.includes(second.v.id) || second.v.sameAs.includes(best.v.id);
    if (!same) return { finding: f, chosen: null, ranked, reason: `${best.v.id} and ${second.v.id} score within ${MARGIN}` };
  }
  // F12a, F12b and F12c are one Pullfrog comment that the doc splits into three claims: the comment carries all three.
  const stem = (id: string) => id.replace(/[a-z]$/, "");
  const family = /[a-z]$/.test(best.v.id) ? candidates.filter((v) => v.id !== best.v.id && /[a-z]$/.test(v.id) && stem(v.id) === stem(best.v.id)).map((v) => v.id) : [];
  return { finding: f, chosen: best, ranked, reason: "", ...(family.length > 0 ? { family } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Docs

const FIELD_REF = "docs/field-run-kaipu-workspaces";
const REPLAY_DOCS = [
  { dir: "docs/benchmark/2026-11-01/prs", name: "2026-11-01" },
  { dir: "docs/benchmark/2026-11-02/prs", name: "2026-11-02" },
  { dir: "docs/benchmark/2026-11-02-e1-sonnet/prs", name: "2026-11-02-e1-sonnet" },
];
const FIELD_DIR = "docs/benchmark/2026-11-02-field/prs";
const REPLAY_PRS = ["463", "464", "465", "466", "467"];
const FIELD_PRS = ["439", "449", "478", "479", "482", "483", "484"];

/** The doc whose run columns are authoritative for a run label. */
export const PRIMARY_DOC: Record<string, string> = {
  "W-R1": "2026-11-01", "W-R2": "2026-11-01", "W-R3": "2026-11-01", "PF-v1": "2026-11-01", "PF-v2": "2026-11-01", "CR-v1": "2026-11-01", "CR-v2": "2026-11-01",
  W4: "2026-11-02", W5: "2026-11-02", W6: "2026-11-02", S7: "2026-11-02-e1-sonnet", S8: "2026-11-02-e1-sonnet", S9: "2026-11-02-e1-sonnet",
};

function readDoc(ref: string, path: string): string | null {
  const r = Bun.spawnSync(["git", "show", `${ref}:${path}`], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode === 0) return r.stdout.toString();
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// ---------------------------------------------------------------------------------------------

const LABEL_COLUMNS = [
  "key", "tool", "source_repo", "bench_pr", "original_pr", "run_label", "doc", "verdict_id", "label", "label_kind", "verdict", "real_severity",
  "same_as", "match_score", "match_basis", "shares_verdict_with",
] as const;

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataset = arg("--dataset");
  if (!dataset) throw new Error("usage: labels.ts --dataset <dir> [--docs-ref <git ref>]");
  const ref = arg("--docs-ref") ?? `origin/${FIELD_REF}`;
  const rows = readFileSync(join(dataset, "findings.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
  const findings: (Finding & { source_repo: string; bench_pr: number })[] = rows.map((r) => ({
    key: r.key, tool: r.tool, original_pr: String(r.original_pr), run_label: r.run_label ?? "", path: r.path ?? "", line: r.line === "" || r.line == null ? null : Number(r.line),
    commit_id: r.commit_id ?? "", title: r.title ?? "", body: r.body ?? "", severity: r.severity ?? "", topic: r.topic ?? "", placement: r.placement,
    source_repo: r.source_repo, bench_pr: r.bench_pr,
  }));

  const replay: Verdict[] = [];
  for (const d of REPLAY_DOCS) {
    for (const pr of REPLAY_PRS) {
      const md = readDoc(ref, `${d.dir}/pr-${pr}.md`);
      if (md) replay.push(...parseReplayDoc(md, d.name, pr));
    }
  }
  const field: Verdict[] = [];
  for (const pr of FIELD_PRS) {
    const md = readDoc(ref, `${FIELD_DIR}/pr-${pr}.md`);
    if (md) field.push(...parseFieldDoc(md, "2026-11-02-field", pr));
  }

  const decisions: Decision[] = [];
  const unlabelled: { finding: Finding; why: string }[] = [];
  for (const f of findings) {
    if (REPLAY_PRS.includes(f.original_pr) && PRIMARY_DOC[f.run_label]) {
      const doc = PRIMARY_DOC[f.run_label];
      const cands = replay.filter((v) => v.doc === doc && v.original_pr === f.original_pr && v.runs.has(f.run_label));
      const all = replay.filter((v) => v.doc === doc && v.original_pr === f.original_pr);
      decisions.push(decide(f, cands, idfOf(all)));
    } else if (FIELD_PRS.includes(f.original_pr) && f.source_repo === "kaipu-record") {
      const bot = f.tool;
      const cands = field.filter((v) => v.original_pr === f.original_pr && v.bot.toLowerCase().startsWith(bot));
      const all = field.filter((v) => v.original_pr === f.original_pr);
      decisions.push(decide(f, cands, idfOf(all)));
    } else {
      unlabelled.push({ finding: f, why: "outside the analysed sets (no verdict doc covers this PR or run)" });
    }
  }

  // Rows
  const labelRows: Record<string, unknown>[] = [];
  const ambiguous: Decision[] = [];
  const byRunVerdict = new Map<string, string[]>();
  for (const d of decisions) if (d.chosen) {
    const k = `${d.finding.original_pr}|${d.finding.run_label}|${d.finding.tool}|${d.chosen.v.id}`;
    byRunVerdict.set(k, [...(byRunVerdict.get(k) ?? []), d.finding.key]);
  }
  for (const d of decisions) {
    if (!d.chosen) {
      ambiguous.push(d);
      continue;
    }
    const v = d.chosen.v;
    const k = `${d.finding.original_pr}|${d.finding.run_label}|${d.finding.tool}|${v.id}`;
    const others = (byRunVerdict.get(k) ?? []).filter((x) => x !== d.finding.key);
    const invalid = /^invalid/i.test(v.verdict);
    const ids = [v.id, ...(d.family ?? [])].sort().join("|");
    labelRows.push({
      key: d.finding.key, tool: d.finding.tool, source_repo: (d.finding as any).source_repo, bench_pr: (d.finding as any).bench_pr,
      original_pr: d.finding.original_pr, run_label: d.finding.run_label, doc: v.doc, verdict_id: ids,
      label: invalid ? "false-positive" : ids, label_kind: invalid ? "false-positive" : v.kind, verdict: v.verdict, real_severity: v.severity,
      same_as: v.sameAs, match_score: d.chosen.score.toFixed(1), match_basis: d.chosen.basis, shares_verdict_with: others.join(" "),
    });
  }
  writeFileSync(join(dataset, "labels.csv"), toCsv(LABEL_COLUMNS, labelRows));

  const lines: string[] = [
    "# Findings the verdict join could not match",
    "",
    "Generated by `scripts/benchmark-dataset/labels.ts`. A finding is listed here when no verdict in the analysis docs",
    "matched it with enough evidence, or when two verdicts matched equally. Nothing was guessed: tell the owner's",
    "answer back as a row in `labels.csv`. `Candidates` are the best verdicts by score, with the reason they were not taken.",
    "",
    `Matched: ${labelRows.length} of ${findings.length} findings. Listed below: ${ambiguous.length} (in an analysed set, unmatched). Not in any analysed set: ${unlabelled.length} (not listed).`,
    "",
  ];
  const groups = new Map<string, Decision[]>();
  for (const d of ambiguous) {
    const k = `${d.finding.original_pr} · ${d.finding.run_label || "(no run label)"}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  for (const [k, ds] of [...groups].sort()) {
    lines.push(`## PR ${k}`, "");
    for (const d of ds) {
      const f = d.finding as Finding & { source_repo: string; bench_pr: number };
      const loc = f.path ? `${f.path}${f.line ? `:${f.line}` : ""}` : "(no location)";
      const cands = d.ranked.slice(0, 3).map((c) => `${c.v.id} (${c.score.toFixed(1)}${c.basis ? `, ${c.basis}` : ""})`).join(", ") || "none";
      lines.push(`- **${f.title.replace(/\n/g, " ").slice(0, 140)}** — \`${loc}\` — ${f.tool} ${f.source_repo}#${f.bench_pr} — candidates: ${cands}. _${d.reason}_`);
    }
    lines.push("");
  }
  writeFileSync(join(dataset, "ambiguous.md"), lines.join("\n"));
  console.log(`labels ${labelRows.length}; ambiguous ${ambiguous.length}; outside analysed sets ${unlabelled.length}; verdicts replay ${replay.length}, field ${field.length}`);
}

if (import.meta.main) await main();
