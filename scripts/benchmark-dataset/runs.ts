#!/usr/bin/env bun
/**
 * Builds runs.csv, the run map: which bot review each bench PR (or kaipu-record bot review) is,
 * under the label the analysis docs use for it (W-R1, W4, S7, PF-v1, CR-v2, …).
 *
 * What comes from data (`derived`): tool, model, version, date, commit and run id, read from the
 * snapshots and the run logs. What comes from the analysis docs (`derived`, with the doc named in
 * `basis`): the labels and the round legends. What had no doc (`guessed`) is flagged for the owner.
 * The labels are written here, in `BENCH_LABELS` and `FIELD_ROUNDS`, each with the doc line it
 * comes from, so a correction is a one-line edit and a re-run.
 *
 * Usage: bun scripts/benchmark-dataset/runs.ts --raw docs/benchmark/dataset/raw --out docs/benchmark/dataset/runs.csv
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRuns, originalPrOf, roundOf, runOfReview, toolOfComment } from "./normalize.ts";
import { parseWachimanReview, toCsv } from "./parse.ts";

export const RUN_COLUMNS = [
  "tool", "source_repo", "bench_pr", "original_pr", "commit", "round_tag", "run_label", "model", "version", "date",
  "review_ids", "run_ids", "doc_set", "confidence", "basis", "notes",
] as const;

interface Label {
  label: string;
  confidence: "derived" | "guessed";
  basis: string;
  /** Model and version stated by the doc, used when no log or review footer gives them. */
  model?: string;
  version?: string;
  notes?: string;
}

const D0201 = "docs/benchmark/2026-11-01/README.md, table \"The runs\"";
const D0202 = "docs/benchmark/2026-11-02/README.md (W4 = #16–#20, W5 = #21–#25, W6 = #26–#30)";
const DE1 = "docs/benchmark/2026-11-02-e1-sonnet/README.md (S7 = #31–#35, S8 = #36–#40, S9 = #41–#45)";

/** `r<n>` of a kaipu-bench-wachi replay → the label the docs use. */
function wachiLabel(round: string): Label | null {
  const n = Number(round.slice(1));
  if (n >= 1 && n <= 3) return { label: `W-R${n}`, confidence: "derived", basis: D0201, model: "claude-opus-5-5", version: "v1.3.0" };
  if (n >= 4 && n <= 6) return { label: `W${n}`, confidence: "derived", basis: D0202, model: "claude-opus-5-5", version: "v1.4.0" };
  if (n >= 7 && n <= 9) return { label: `S${n}`, confidence: "derived", basis: DE1, model: "claude-sonnet-5-5", version: "v1.4.0" };
  return null;
}

/** The five replays of kaipu-record #402 #255 #276 #269 #184 (bug catalogue sample) have no analysis doc. */
const SET2 = new Set(["402", "255", "276", "269", "184"]);
const SET1 = new Set(["463", "464", "465", "466", "467"]);

export function benchLabel(repo: string, pr: number, original: string, round: string, title: string): Label {
  if (/\[setup\]/.test(title)) return { label: "", confidence: "derived", basis: "title says [setup]", notes: "setup PR, not a review run" };
  if (repo === "kaipu-bench-wachi") {
    if (SET1.has(original)) {
      const l = wachiLabel(round);
      if (l) return l;
    }
    if (SET2.has(original)) {
      return {
        label: `W-set2-${round.toUpperCase()}`, confidence: "guessed", basis: "no analysis doc for #402 #255 #276 #269 #184; label invented",
        notes: "Replay of the bug-catalogue PRs on 2026-11-02; version and model come from the run log",
      };
    }
  }
  if (repo === "kaipu-bench-wachi-v2") {
    return { label: "W-v2", confidence: "guessed", basis: "no analysis doc names this repo's runs", notes: "agent-review.yml failed on all five PRs; no review was posted" };
  }
  if (repo === "kaipu-bench-pullfrog") return { label: "PF-v1", confidence: "derived", basis: D0201, model: "claude-opus-5-5", notes: "Opus 5.5, effort high (doc)" };
  if (repo === "kaipu-bench-pullfrog-v2") return { label: "PF-v2", confidence: "derived", basis: D0201, model: "claude-opus-5-5", notes: "fresh repository, no learnings from v1 (doc)" };
  if (repo === "kaipu-bench-coderabbit") {
    if (pr <= 5) return { label: "CR-v1", confidence: "derived", basis: D0201, notes: "plan Advanced, profile chill, started by @coderabbitai review (doc)" };
    return { label: "CR-set2", confidence: "guessed", basis: "PRs #6–#10 replay #402 #255 #276 #269 #184; no analysis doc; label invented" };
  }
  if (repo === "kaipu-bench-coderabbit-v2") return { label: "CR-v2", confidence: "derived", basis: D0201, notes: "fresh repository (doc)" };
  return { label: "", confidence: "guessed", basis: "no rule for this repository" };
}

/**
 * The live field run on kaipu-record: commit (7 characters) → label, per PR, from the round
 * legends at the top of docs/benchmark/2026-11-02-field/prs/pr-<n>.md (read from branch
 * docs/field-run-kaipu-workspaces). Versions are the ones the legends state.
 */
export const FIELD_ROUNDS: Record<string, Record<string, { label: string; version: string; basis: string }>> = {
  "439": { c59e58f: { label: "R1", version: "v1.2.0", basis: "field/prs/pr-439.md line 3" } },
  "449": { "1eb0638": { label: "R1", version: "v1.2.0", basis: "field/prs/pr-449.md line 3" } },
  "478": {
    "07a47af": { label: "Full", version: "v1.3.0", basis: "field/prs/pr-478.md line 7" },
    "886d67f": { label: "Inc-1", version: "v1.3.0", basis: "field/prs/pr-478.md line 7" },
    "649c902": { label: "Inc-2", version: "v1.3.0", basis: "field/prs/pr-478.md line 7" },
    "7620879": { label: "Inc-3", version: "v1.3.0", basis: "field/prs/pr-478.md line 7" },
    c573b8e: { label: "Inc-4", version: "v1.4.0", basis: "field/prs/pr-478.md line 7" },
    "64db30b": { label: "Inc-5", version: "v1.4.0", basis: "field/prs/pr-478.md line 7" },
    "392778f": { label: "Inc-6", version: "v1.4.0", basis: "field/prs/pr-478.md line 7" },
  },
  "479": {
    aac7202: { label: "W-full", version: "v1.3.0", basis: "field/prs/pr-479.md line 11" },
    "670b1ba": { label: "W-i1", version: "v1.3.0", basis: "field/prs/pr-479.md line 11" },
    "02dbb2e": { label: "W-i2", version: "v1.3.0", basis: "field/prs/pr-479.md line 11" },
    "413ee15": { label: "W-i3", version: "v1.4.0", basis: "field/prs/pr-479.md line 11" },
  },
  "482": {
    "833ca60": { label: "R0", version: "v1.3.0", basis: "field/prs/pr-482.md line 9" },
    "75698b7": { label: "R1", version: "v1.3.0", basis: "field/prs/pr-482.md line 9" },
    "1fb4fd6": { label: "R2", version: "v1.3.0", basis: "field/prs/pr-482.md line 9" },
    d9accc8: { label: "R3", version: "v1.3.0", basis: "field/prs/pr-482.md line 9" },
    "543053c": { label: "R4", version: "v1.3.0", basis: "field/prs/pr-482.md line 9" },
    ad0fa5c: { label: "R5", version: "v1.4.0", basis: "field/prs/pr-482.md line 9" },
  },
  "483": {
    "443a9b0": { label: "R1", version: "v1.3.0", basis: "field/prs/pr-483.md line 7" },
    a47dea6: { label: "R2", version: "v1.3.0", basis: "field/prs/pr-483.md line 7" },
    "77d67e5": { label: "R3", version: "v1.3.0", basis: "field/prs/pr-483.md line 7" },
    "4ed1580": { label: "R4", version: "v1.3.0", basis: "field/prs/pr-483.md line 7" },
    "0253fd7": { label: "R5", version: "v1.4.0", basis: "field/prs/pr-483.md line 7" },
  },
  "484": {
    de9134b: { label: "R1", version: "v1.4.0", basis: "field/prs/pr-484.md lines 3 and 12" },
    "59f6d48": { label: "R2", version: "v1.4.0", basis: "field/prs/pr-484.md lines 3 and 12" },
  },
};

interface ReviewLike {
  id: number;
  user: { login?: string } | null;
  commit_id: string;
  submitted_at: string;
  body: string;
}

const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

export function buildRuns(rawRoot: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const repo of readdirSync(rawRoot).sort()) {
    const repoDir = join(rawRoot, repo);
    if (!existsSync(join(repoDir, "_index.json"))) continue;
    const isBench = repo.startsWith("kaipu-bench-");
    const prDirs = readdirSync(repoDir).filter((d) => /^pr-\d+$/.test(d)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
    for (const d of prDirs) {
      const prDir = join(repoDir, d);
      const pr = readJson<{ number: number; title: string; body: string | null; created_at: string; head: { ref: string; sha: string }; base: { ref: string; sha: string } } | null>(join(prDir, "pr.json"), null);
      if (!pr) continue;
      const reviews = readJson<ReviewLike[]>(join(prDir, "reviews.json"), []);
      const { runs, logs } = loadRuns(prDir);
      const original = originalPrOf(repo, pr);
      const round = roundOf(pr.title);
      const bots = reviews
        .map((rv) => ({ rv, tool: toolOfComment({ user: rv.user, body: rv.body ?? "" }) }))
        .filter((x): x is { rv: ReviewLike; tool: "wachiman" | "pullfrog" | "coderabbit" } => x.tool !== null);

      if (isBench) {
        const l = benchLabel(repo, pr.number, original, round, pr.title);
        const tool = repo.includes("wachi") ? "wachiman" : repo.includes("pullfrog") ? "pullfrog" : "coderabbit";
        const mine = bots.filter((b) => b.tool === tool);
        let model = "";
        let version = "";
        const runIds: number[] = [];
        for (const b of mine) {
          const run = runOfReview(b.rv.submitted_at, runs, logs);
          const log = run ? logs.get(run.databaseId) : undefined;
          if (run) runIds.push(run.databaseId);
          if (log?.model) model = log.model;
          if (log?.version) version = log.version;
          if (!model && tool === "wachiman") {
            const lbl = parseWachimanReview(b.rv.body)?.model_label;
            if (lbl) model = lbl.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          }
        }
        const fromLog = Boolean(version || model);
        const notes = [l.notes ?? ""];
        if (version && l.version && version !== l.version) notes.push(`doc says ${l.version}, log says ${version}`);
        if (model && l.model && model !== l.model) notes.push(`doc says ${l.model}, log says ${model}`);
        if (mine.length === 0 && !/\[setup\]/.test(pr.title)) notes.push("no review posted by this tool");
        out.push({
          tool, source_repo: repo, bench_pr: pr.number, original_pr: original, commit: (mine[0]?.rv.commit_id ?? pr.head.sha).slice(0, 7),
          round_tag: round, run_label: l.label, model: model || l.model || "", version: version || l.version || "",
          date: (mine[0]?.rv.submitted_at ?? pr.created_at).slice(0, 10), review_ids: mine.map((b) => b.rv.id).join(" "), run_ids: runIds.join(" "),
          doc_set: l.label ? (/docs\/[^\s,()]+/.exec(l.basis)?.[0] ?? "") : "", confidence: l.confidence === "derived" && (fromLog || tool !== "wachiman") ? "derived" : l.confidence,
          basis: l.basis, notes: notes.filter(Boolean).join("; "),
        });
        continue;
      }

      // Live repositories: one row per bot review, keyed by the commit it reviewed.
      const seen = new Set<string>();
      let pfOrdinal = 0;
      let crOrdinal = 0;
      for (const b of bots) {
        const commit = b.rv.commit_id.slice(0, 7);
        const key = `${b.tool}@${commit}`;
        const isThreadReply = b.tool === "wachiman" && !parseWachimanReview(b.rv.body);
        if (isThreadReply) continue;
        const run = b.tool === "wachiman" ? runOfReview(b.rv.submitted_at, runs, logs) : null;
        const log = run ? logs.get(run.databaseId) : undefined;
        const field = FIELD_ROUNDS[original]?.[commit];
        let label = "";
        let confidence = "derived";
        let basis = "run map built from the snapshots only";
        if (b.tool === "wachiman" && field) {
          label = field.label;
          basis = `docs/benchmark/2026-11-02-${field.basis}`;
        } else if (b.tool === "pullfrog" && FIELD_ROUNDS[original]) {
          if (!seen.has(key)) pfOrdinal++;
          label = `PF-${pfOrdinal}`;
          confidence = "guessed";
          basis = "ordinal of the Pullfrog review on this PR; the field docs name rounds by commit, not by number";
        } else if (b.tool === "coderabbit" && FIELD_ROUNDS[original]) {
          if (!seen.has(key)) crOrdinal++;
          label = `CR-${crOrdinal}`;
          confidence = "guessed";
          basis = "ordinal of the CodeRabbit review on this PR; the field docs name rounds by commit, not by number";
        } else if (b.tool === "wachiman") {
          basis = "no analysis doc covers this PR's rounds; version and model come from the run log or the review footer";
        }
        if (seen.has(key)) continue;
        seen.add(key);
        const version = log?.version || field?.version || "";
        // A Wachiman row whose version could not be read from a log or a doc is not derived: the owner has to supply it.
        if (b.tool === "wachiman" && !version) confidence = "guessed";
        out.push({
          tool: b.tool, source_repo: repo, bench_pr: pr.number, original_pr: String(pr.number), commit, round_tag: "", run_label: label,
          model: log?.model || (b.tool === "wachiman" ? (parseWachimanReview(b.rv.body)?.model_label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""),
          version, date: b.rv.submitted_at.slice(0, 10), review_ids: String(b.rv.id), run_ids: run ? String(run.databaseId) : "",
          doc_set: field ? "docs/benchmark/2026-11-02-field" : "", confidence, basis,
          notes: [
            log?.version && field && log.version !== field.version ? `doc says ${field.version}, log says ${log.version}` : "",
            b.tool === "wachiman" && !version ? "version unknown: no log (expired or never kept) and no doc" : "",
          ].filter(Boolean).join("; "),
        });
      }
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = arg("--raw");
  const out = arg("--out");
  if (!raw || !out) throw new Error("usage: runs.ts --raw <raw dir> --out <runs.csv>");
  const rows = buildRuns(raw);
  writeFileSync(out, toCsv(RUN_COLUMNS, rows));
  const by: Record<string, number> = {};
  for (const r of rows) by[`${r.tool}/${r.confidence}`] = (by[`${r.tool}/${r.confidence}`] ?? 0) + 1;
  console.log(`runs ${rows.length} ${JSON.stringify(by)}`);
}

if (import.meta.main) await main();
