#!/usr/bin/env bun
/**
 * Turns the raw snapshots written by fetch.ts into the dataset tables:
 *
 *   findings.csv / findings.jsonl   one row per posted finding (inline comment, or a finding listed
 *                                   only in a Wachiman review body)
 *   contracts.jsonl                 one entry per contract parsed from a Wachiman review body
 *   reviews.csv                     one row per Wachiman review (model, cost, counts, contracts)
 *   run-logs.csv                    one row per Actions run whose log was snapshotted
 *
 * Usage: bun scripts/benchmark-dataset/normalize.ts --raw docs/benchmark/dataset/raw --out docs/benchmark/dataset
 *          [--runs docs/benchmark/dataset/runs.csv]
 *
 * `--runs` is the owner-reviewed run map; when given, `run_label` and a fallback `version` come
 * from it. Rows with no inline `body` in the CSV keep it in the JSONL only.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  extractRunLog, hasWachimanSignature, isWachimanComment, parseCodeRabbit, parseCodeRabbitBody, parseLegacyNote, parsePullfrog, parseCsv, parseWachimanHeader,
  parseWachimanReview, toCsv, type Contract, type RunLog, type WachimanReview,
} from "./parse.ts";

export type Tool = "wachiman" | "pullfrog" | "coderabbit";

export const FINDING_COLUMNS = [
  "key", "tool", "source_repo", "bench_pr", "original_pr", "round", "run_label", "model", "version", "run_id",
  "review_id", "comment_id", "placement", "body_section", "path", "line", "original_line", "commit_id",
  "severity", "topic", "confidence", "native_severity", "native_category", "native_tags", "title", "replies",
  "created_at", "url",
] as const;

interface RawComment {
  id: number;
  user: { login?: string; type?: string } | null;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  commit_id?: string;
  in_reply_to_id: number | null;
  pull_request_review_id?: number;
  created_at: string;
  html_url: string;
  body: string;
}
interface RawReview {
  id: number;
  user: { login?: string } | null;
  state: string;
  commit_id: string;
  submitted_at: string;
  html_url: string;
  body: string;
}
interface RawPr {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
}
interface RawRun {
  databaseId: number;
  workflowName: string;
  event: string;
  status: string;
  conclusion: string;
  createdAt: string;
  updatedAt: string;
  headSha: string;
  url: string;
  log: string;
}

export interface RunMapRow {
  source_repo: string;
  bench_pr: string;
  run_label: string;
  version: string;
  model: string;
}

const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

/** The kaipu-record PR a bench PR replays: from the head ref `replay/pr-463/head-r4`, else the body. */
export function originalPrOf(repo: string, pr: Pick<RawPr, "number" | "head" | "body" | "title">): string {
  const ref = /replay\/pr-(\d+)\//.exec(pr.head.ref);
  if (ref) return ref[1] as string;
  const body = /kaipu-record(?:#|\/pull\/)(\d+)/.exec(pr.body ?? "");
  if (body && repo !== "kaipu-record") return body[1] as string;
  return repo === "kaipu-record" ? String(pr.number) : "";
}

/** `[replay r4] …` → `r4`; `[replay] …` → `r1` (the first round carries no number); anything else → "". */
export function roundOf(title: string): string {
  const m = /^\[replay(?: r(\d+))?\]/.exec(title);
  return m ? `r${m[1] ?? "1"}` : "";
}

export function toolOfComment(c: { user: { login?: string } | null; body: string }): Tool | null {
  const login = c.user?.login ?? "";
  if (hasWachimanSignature(c.body) || isWachimanComment(c.body, login)) return "wachiman";
  if (/^pullfrog/i.test(login)) return "pullfrog";
  if (/^coderabbitai/i.test(login)) return "coderabbit";
  return null;
}

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/\./g, "-").replace(/^-|-$/g, "");

export function loadRuns(prDir: string): { runs: RawRun[]; logs: Map<number, RunLog> } {
  const runs = readJson<RawRun[]>(join(prDir, "runs.json"), []);
  const logs = new Map<number, RunLog>();
  for (const r of runs) {
    const path = join(prDir, "logs", `run-${r.databaseId}.log.gz`);
    if (existsSync(path)) logs.set(r.databaseId, extractRunLog(gunzipSync(readFileSync(path)).toString()));
  }
  return { runs, logs };
}

/** The run that posted a review: its window contains the submission time; ties go to the run with a log. */
export function runOfReview(submittedAt: string, runs: RawRun[], logs: Map<number, RunLog>): RawRun | null {
  const t = Date.parse(submittedAt);
  if (Number.isNaN(t)) return null;
  const hits = runs.filter((r) => Date.parse(r.createdAt) - 5000 <= t && t <= Date.parse(r.updatedAt) + 120000);
  hits.sort((a, b) => Number(logs.has(b.databaseId)) - Number(logs.has(a.databaseId)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return hits[0] ?? null;
}

export interface NormalizeResult {
  findings: Record<string, unknown>[];
  contracts: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  runLogs: Record<string, unknown>[];
  /** Wachiman comments whose header did not parse, for the README. */
  unparsed: { repo: string; pr: number; comment_id: number; head: string }[];
  /** Per tool and repo: pull requests and issue comments seen, for the README. */
  seen: Record<string, number>;
}

export function normalizeRepo(repo: string, repoDir: string, runMap: Map<string, RunMapRow>, into: NormalizeResult) {
  const prDirs = readdirSync(repoDir).filter((d) => /^pr-\d+$/.test(d));
  for (const d of prDirs.sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))) {
    const prDir = join(repoDir, d);
    const pr = readJson<RawPr | null>(join(prDir, "pr.json"), null);
    if (!pr) continue;
    const comments = readJson<RawComment[]>(join(prDir, "review-comments.json"), []);
    const reviews = readJson<RawReview[]>(join(prDir, "reviews.json"), []);
    const issueComments = readJson<RawComment[]>(join(prDir, "issue-comments.json"), []);
    const { runs, logs } = loadRuns(prDir);
    const base = {
      source_repo: repo,
      bench_pr: pr.number,
      original_pr: originalPrOf(repo, pr),
      round: roundOf(pr.title),
    };

    for (const r of runs) {
      const log = logs.get(r.databaseId);
      if (!log) continue;
      into.runLogs.push({
        source_repo: repo, bench_pr: pr.number, run_id: r.databaseId, workflow: r.workflowName, event: r.event,
        conclusion: r.conclusion, created_at: r.createdAt, version: log.version, workflow_ref: log.workflow_ref,
        model: log.model, effort: log.effort, claude_code_version: log.claude_code_version, calls: log.calls.length,
        turns: log.calls.reduce((s, c) => s + c.turns, 0), cost_usd: log.cost_usd, duration_ms: log.duration_ms,
        confidence_rule_lines: log.confidence_rule.length, engine_lines: log.engine_lines.length, url: r.url,
      });
    }

    // CodeRabbit lists some findings only in its review body (outside the diff, nitpicks, duplicates).
    for (const rv of reviews) {
      if (!/^coderabbitai/i.test(rv.user?.login ?? "")) continue;
      const mapRow = mapFor(runMap, repo, pr.number, "coderabbit", rv.commit_id);
      let n = 0;
      for (const f of parseCodeRabbitBody(rv.body ?? "")) {
        n++;
        into.findings.push({
          key: `${repo}#${pr.number}:review-${rv.id}:${n}`, tool: "coderabbit", ...base, run_label: mapRow?.run_label ?? "", model: "", version: "", run_id: "",
          review_id: rv.id, comment_id: "", placement: "body", body_section: f.section, path: f.path, line: f.line, original_line: "", commit_id: rv.commit_id,
          severity: "", topic: "", confidence: "", native_severity: f.native_severity, native_category: f.native_category, native_tags: f.native_tags,
          title: f.title, replies: 0, created_at: rv.submitted_at, url: rv.html_url, body: "",
        });
      }
    }

    // Wachiman reviews first: comments link to them for model, cost and run.
    const reviewInfo = new Map<number, { parsed: WachimanReview; run: RawRun | null; log: RunLog | null }>();
    for (const rv of reviews) {
      const parsed = parseWachimanReview(rv.body ?? "");
      if (!parsed) continue;
      const run = runOfReview(rv.submitted_at, runs, logs);
      const log = run ? (logs.get(run.databaseId) ?? null) : null;
      const mapRow = mapFor(runMap, repo, pr.number, "wachiman", rv.commit_id);
      reviewInfo.set(rv.id, { parsed, run, log });
      const model = log?.model || (parsed.model_label ? slug(parsed.model_label) : "");
      const version = log?.version || mapRow?.version || "";
      into.reviews.push({
        source_repo: repo, bench_pr: pr.number, original_pr: base.original_pr, round: base.round, run_label: mapRow?.run_label ?? "",
        review_id: rv.id, run_id: run?.databaseId ?? "", submitted_at: rv.submitted_at, commit_id: rv.commit_id,
        model, model_label: parsed.model_label, effort: parsed.effort || log?.effort || "", claude_code_version: parsed.claude_code_version || log?.claude_code_version || "",
        version, partial: parsed.partial, batches: parsed.batch_count ?? "", cost_usd: parsed.cost_usd ?? "", log_cost_usd: log?.cost_usd ?? "",
        log_duration_ms: log?.duration_ms ?? "", findings_total: parsed.findings_total ?? "", inline: parsed.inline_count ?? "",
        in_body: parsed.body_findings.length, contracts: parsed.contracts.length, contracts_open: parsed.contracts.filter((c) => c.status === "open").length,
        contracts_hidden: parsed.contracts_hidden, confidence_rule: log?.confidence_rule.join(" | ") ?? "", url: rv.html_url,
      });
      for (const c of parsed.contracts as Contract[]) {
        into.contracts.push({ source_repo: repo, bench_pr: pr.number, original_pr: base.original_pr, round: base.round, run_label: mapRow?.run_label ?? "", review_id: rv.id, run_id: run?.databaseId ?? "", ...c });
      }
      let n = 0;
      for (const f of parsed.body_findings) {
        n++;
        into.findings.push({
          key: `${repo}#${pr.number}:review-${rv.id}:${n}`, tool: "wachiman", ...base, run_label: mapRow?.run_label ?? "", model, version, run_id: run?.databaseId ?? "",
          review_id: rv.id, comment_id: "", placement: "body", body_section: f.section, path: f.path, line: f.line || "", original_line: "",
          commit_id: rv.commit_id, severity: f.severity, topic: f.topic, confidence: f.confidence, native_severity: "", native_category: "",
          native_tags: "", title: f.title, replies: 0, created_at: rv.submitted_at, url: rv.html_url, body: f.text,
        });
      }
    }

    const replies = new Map<number, number>();
    for (const c of comments) if (c.in_reply_to_id) replies.set(c.in_reply_to_id, (replies.get(c.in_reply_to_id) ?? 0) + 1);

    for (const c of comments) {
      if (c.in_reply_to_id) continue;
      const tool = toolOfComment(c);
      if (!tool) continue;
      const k = `${tool}:${repo}`;
      into.seen[k] = (into.seen[k] ?? 0) + 1;
      let fields: Record<string, unknown> = {};
      let model = "";
      let version = "";
      let runId: number | string = "";
      const info = c.pull_request_review_id ? reviewInfo.get(c.pull_request_review_id) : undefined;
      const mapRow = mapFor(runMap, repo, pr.number, tool, c.commit_id ?? "");
      if (tool === "wachiman") {
        const h = parseWachimanHeader(c.body);
        const legacy = h ? null : parseLegacyNote(c.body);
        if (legacy) fields = { severity: "", topic: "", confidence: "", native_severity: "Note", native_category: legacy.category, title: legacy.title };
        else if (!h) {
          into.unparsed.push({ repo, pr: pr.number, comment_id: c.id, head: c.body.split("\n", 1)[0]?.slice(0, 120) ?? "" });
          fields = { severity: "", topic: "", confidence: "", title: c.body.split("\n", 1)[0] ?? "" };
        } else fields = { severity: h.severity, topic: h.topic, confidence: h.confidence, title: h.title };
        model = info?.log?.model || (info?.parsed.model_label ? slug(info.parsed.model_label) : "");
        version = info?.log?.version || mapRow?.version || "";
        runId = info?.run?.databaseId ?? "";
      } else {
        const n = tool === "coderabbit" ? parseCodeRabbit(c.body) : parsePullfrog(c.body);
        fields = { native_severity: n.native_severity, native_category: n.native_category, native_tags: n.native_tags, title: n.title };
        model = mapRow?.model ?? "";
      }
      into.findings.push({
        key: `${repo}#${pr.number}:comment-${c.id}`, tool, ...base, run_label: mapRow?.run_label ?? "", model, version, run_id: runId, review_id: c.pull_request_review_id ?? "",
        comment_id: c.id, placement: "inline", body_section: "", path: c.path ?? "", line: c.line ?? c.original_line ?? "",
        original_line: c.original_line ?? "", commit_id: c.commit_id ?? "", severity: "", topic: "", confidence: "",
        native_severity: "", native_category: "", native_tags: "", replies: replies.get(c.id) ?? 0, created_at: c.created_at, url: c.html_url,
        ...fields, body: c.body,
      });
    }
    for (const c of issueComments) {
      const tool = toolOfComment(c);
      if (tool) into.seen[`${tool}:issue-comments:${repo}`] = (into.seen[`${tool}:issue-comments:${repo}`] ?? 0) + 1;
    }
    for (const rv of reviews) {
      const tool = toolOfComment({ user: rv.user, body: rv.body ?? "" });
      if (tool) into.seen[`${tool}:reviews:${repo}`] = (into.seen[`${tool}:reviews:${repo}`] ?? 0) + 1;
    }
  }
}

/** Keys: `repo#pr#tool@commit7` for the exact review, and `repo#pr#tool` for the first row of that tool on the PR. */
export function readRunMap(path: string): Map<string, RunMapRow> {
  const map = new Map<string, RunMapRow>();
  if (!existsSync(path)) return map;
  for (const r of parseCsv(readFileSync(path, "utf8"))) {
    const row = { source_repo: r.source_repo as string, bench_pr: r.bench_pr as string, run_label: r.run_label ?? "", version: r.version ?? "", model: r.model ?? "" };
    map.set(`${r.source_repo}#${r.bench_pr}#${r.tool}@${r.commit}`, row);
    if (!map.has(`${r.source_repo}#${r.bench_pr}#${r.tool}`)) map.set(`${r.source_repo}#${r.bench_pr}#${r.tool}`, row);
  }
  return map;
}

const mapFor = (m: Map<string, RunMapRow>, repo: string, pr: number, tool: Tool, commit: string) =>
  m.get(`${repo}#${pr}#${tool}@${commit.slice(0, 7)}`) ?? m.get(`${repo}#${pr}#${tool}`);

const REVIEW_COLUMNS = [
  "source_repo", "bench_pr", "original_pr", "round", "run_label", "review_id", "run_id", "submitted_at", "commit_id", "model", "model_label",
  "effort", "claude_code_version", "version", "partial", "batches", "cost_usd", "log_cost_usd", "log_duration_ms", "findings_total", "inline",
  "in_body", "contracts", "contracts_open", "contracts_hidden", "confidence_rule", "url",
] as const;
const RUNLOG_COLUMNS = [
  "source_repo", "bench_pr", "run_id", "workflow", "event", "conclusion", "created_at", "version", "workflow_ref", "model", "effort",
  "claude_code_version", "calls", "turns", "cost_usd", "duration_ms", "confidence_rule_lines", "engine_lines", "url",
] as const;

/**
 * Counts per source repository, with no text from any pull request: the only thing that may be
 * published about a private repository. Wachiman figures come from its reviews, the other tools'
 * from their inline comments.
 */
export function aggregate(res: NormalizeResult) {
  const repos: Record<string, any> = {};
  const repo = (name: string) => (repos[name] ??= {
    prs_with_wachiman_review: new Set<string>(), prs_with_any_bot_finding: new Set<string>(), reviews: 0, runs_with_log: 0, cost_usd: 0,
    findings: {} as Record<string, number>, wachiman_by_severity: {} as Record<string, number>, wachiman_by_topic: {} as Record<string, number>,
    wachiman_by_placement: {} as Record<string, number>, contracts: 0, versions: {} as Record<string, number>, models: {} as Record<string, number>,
  });
  const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  for (const r of res.reviews) {
    const a = repo(String(r.source_repo));
    a.prs_with_wachiman_review.add(String(r.bench_pr));
    a.reviews++;
    a.cost_usd += Number(r.cost_usd || 0);
    inc(a.versions, String(r.version || "unknown"));
    inc(a.models, String(r.model || "unknown"));
  }
  for (const l of res.runLogs) repo(String(l.source_repo)).runs_with_log++;
  for (const c of res.contracts) repo(String(c.source_repo)).contracts++;
  for (const f of res.findings) {
    const a = repo(String(f.source_repo));
    a.prs_with_any_bot_finding.add(String(f.bench_pr));
    inc(a.findings, String(f.tool));
    if (f.tool === "wachiman") {
      // The v1.0.x engine posted `Note (category)` with no severity; it is counted under its own words.
      inc(a.wachiman_by_severity, String(f.severity || (f.native_severity ? String(f.native_severity).toLowerCase() : "unparsed")));
      inc(a.wachiman_by_topic, String(f.topic || f.native_category || "unparsed"));
      inc(a.wachiman_by_placement, String(f.placement));
    }
  }
  return Object.fromEntries(
    Object.entries(repos).map(([name, a]) => [name, { ...a, prs_with_wachiman_review: a.prs_with_wachiman_review.size, prs_with_any_bot_finding: a.prs_with_any_bot_finding.size, cost_usd: Math.round(a.cost_usd * 100) / 100 }]),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = arg("--raw");
  const out = arg("--out");
  if (!raw || !out) throw new Error("usage: normalize.ts --raw <raw dir> --out <dataset dir> [--runs <runs.csv>]");
  const runMap = readRunMap(arg("--runs") ?? join(out, "runs.csv"));
  const res: NormalizeResult = { findings: [], contracts: [], reviews: [], runLogs: [], unparsed: [], seen: {} };
  for (const repo of readdirSync(raw).sort()) {
    const dir = join(raw, repo);
    if (existsSync(join(dir, "_index.json"))) normalizeRepo(repo, dir, runMap, res);
  }
  mkdirSync(out, { recursive: true });
  const csvRows = res.findings.map(({ body: _body, ...rest }) => rest);
  writeFileSync(join(out, "findings.csv"), toCsv(FINDING_COLUMNS, csvRows));
  writeFileSync(join(out, "findings.jsonl"), `${res.findings.map((f) => JSON.stringify(f)).join("\n")}\n`);
  writeFileSync(join(out, "contracts.jsonl"), res.contracts.length > 0 ? `${res.contracts.map((c) => JSON.stringify(c)).join("\n")}\n` : "");
  writeFileSync(join(out, "reviews.csv"), toCsv(REVIEW_COLUMNS, res.reviews));
  writeFileSync(join(out, "run-logs.csv"), toCsv(RUNLOG_COLUMNS, res.runLogs));
  writeFileSync(join(out, "normalize-report.json"), `${JSON.stringify({ unparsed: res.unparsed, seen: res.seen, aggregate: aggregate(res) }, null, 1)}\n`);
  const byTool: Record<string, number> = {};
  for (const f of res.findings) byTool[`${f.tool}`] = (byTool[`${f.tool}`] ?? 0) + 1;
  console.log(`findings ${res.findings.length} ${JSON.stringify(byTool)}; contracts ${res.contracts.length}; reviews ${res.reviews.length}; run logs ${res.runLogs.length}; unparsed ${res.unparsed.length}`);
}

if (import.meta.main) await main();
