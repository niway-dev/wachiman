#!/usr/bin/env bun
/**
 * Measures how often each data-path question fires on real pull requests, before it is trusted.
 *
 *   bun scripts/questions-firing.ts [--json] <owner/repo> <data PRs> -- <contrast PRs>
 *   bun scripts/questions-firing.ts niway-dev/kaipu-record 439 449 478 -- 472 473 475
 *
 * For each PR it fetches the files with `gh api repos/<repo>/pulls/<n>/files --paginate`, drops
 * what the engine drops (DEFAULT_EXCLUDE), and then does what a review does: `planBatches` with the
 * default limits, `selectQuestions` per batch, and `buildBatchPrompt` with and without the
 * selection, so the words and characters added are the real ones. It prints, per PR, the files
 * where each question fires, the share of files with any question, and the batches that pay.
 * Needs `gh` logged in with read access to the repository. Not part of the engine or of `bun test`.
 */
import { loadConfig } from "../src/config";
import {
  DEFAULT_EXCLUDE,
  buildBatchPrompt,
  filterFiles,
  planBatches,
  type PrFile,
  type ReviewContext,
} from "../src/engine";
import { addedLinesOf } from "../src/evidence";
import { QUESTIONS, selectQuestions } from "../src/questions";

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

function fetchFiles(repo: string, pr: number): PrFile[] {
  const run = Bun.spawnSync([
    "gh",
    "api",
    `repos/${repo}/pulls/${pr}/files`,
    "--paginate",
    "--jq",
    ".[] | {filename, additions, deletions, patch, sha}",
  ]);
  if (run.exitCode !== 0) throw new Error(`gh api failed for #${pr}: ${run.stderr.toString()}`);
  return run.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PrFile);
}

export interface PrReport {
  pr: number;
  files: number;
  filesWithAny: number;
  fires: Record<string, string[]>;
  batches: number;
  batchesWithAny: number;
  /** Words the sections add to the PR's batches, in total and in the largest batch. */
  wordsTotal: number;
  wordsMaxBatch: number;
  /** Prompt characters without the sections, summed over batches (the diff dominates it). */
  promptChars: number;
  addedChars: number;
}

export function measure(pr: number, all: PrFile[]): PrReport {
  const config = loadConfig({});
  const { kept } = filterFiles(all, [...DEFAULT_EXCLUDE, ...config.exclude], []);
  const fires: Record<string, string[]> = Object.fromEntries(QUESTIONS.map((q) => [q.id, [] as string[]]));
  const any = new Set<string>();
  for (const f of kept) {
    const added = addedLinesOf(f.patch);
    if (added.length === 0) continue;
    for (const q of QUESTIONS) {
      if (q.applies(added, f.filename)) {
        fires[q.id]!.push(f.filename);
        any.add(f.filename);
      }
    }
  }
  const ctx: ReviewContext = {
    describe: `pull request #${pr} in o/r`,
    headSha: "0".repeat(40),
    headDir: "/tmp/head",
    since: null,
    paths: [],
    dropped: all.length - kept.length,
    everyFile: kept.map((f) => `- ${f.filename} +${f.additions} −${f.deletions}`).join("\n"),
    meta: { title: "t", body: "b" },
    instructions: "",
  };
  const batches = planBatches(kept, { maxLines: config.batchLines, maxChars: config.batchChars });
  let batchesWithAny = 0;
  let wordsTotal = 0;
  let wordsMaxBatch = 0;
  let promptChars = 0;
  let addedChars = 0;
  batches.forEach((b, i) => {
    const part = { index: i + 1, total: batches.length };
    const bare = buildBatchPrompt(ctx, b.files, false, part, "/tmp/d", "", "", []);
    const full = buildBatchPrompt(ctx, b.files, false, part, "/tmp/d", "", "", selectQuestions(b.files));
    promptChars += bare.length;
    if (full !== bare) {
      batchesWithAny++;
      addedChars += full.length - bare.length;
      const w = words(full) - words(bare);
      wordsTotal += w;
      wordsMaxBatch = Math.max(wordsMaxBatch, w);
    }
  });
  return {
    pr,
    files: kept.length,
    filesWithAny: any.size,
    fires,
    batches: batches.length,
    batchesWithAny,
    wordsTotal,
    wordsMaxBatch,
    promptChars,
    addedChars,
  };
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "0 %");

function main() {
  const args = process.argv.slice(2);
  const json = args[0] === "--json";
  if (json) args.shift();
  const [repo, ...rest] = args;
  const split = rest.indexOf("--");
  if (!repo || split < 0) throw new Error("usage: questions-firing.ts [--json] <owner/repo> <data PRs> -- <contrast PRs>");
  const sets = { data: rest.slice(0, split).map(Number), contrast: rest.slice(split + 1).map(Number) };
  const out: Record<string, PrReport[]> = {};
  for (const [name, prs] of Object.entries(sets)) out[name] = prs.map((n) => measure(n, fetchFiles(repo, n)));
  if (json) return console.log(JSON.stringify(out, null, 2));

  const ids = QUESTIONS.map((q) => q.id);
  for (const [name, reports] of Object.entries(out)) {
    console.log(`\n## ${name} set\n`);
    console.log(`| PR | files | files with any | ${ids.join(" | ")} | batches paying | words added (total / largest batch) |`);
    console.log(`| --- | --- | --- | ${ids.map(() => "---").join(" | ")} | --- | --- |`);
    for (const r of reports) {
      const cells = ids.map((id) => r.fires[id]!.length);
      console.log(
        `| #${r.pr} | ${r.files} | ${r.filesWithAny} (${pct(r.filesWithAny, r.files)}) | ${cells.join(" | ")} | ${r.batchesWithAny} of ${r.batches} | ${r.wordsTotal} / ${r.wordsMaxBatch} |`,
      );
    }
    const files = reports.reduce((n, r) => n + r.files, 0);
    const withAny = reports.reduce((n, r) => n + r.filesWithAny, 0);
    const batches = reports.reduce((n, r) => n + r.batches, 0);
    const paying = reports.reduce((n, r) => n + r.batchesWithAny, 0);
    const chars = reports.reduce((n, r) => n + r.promptChars, 0);
    const added = reports.reduce((n, r) => n + r.addedChars, 0);
    console.log(
      `\nTotal: ${withAny} of ${files} files (${pct(withAny, files)}); ${paying} of ${batches} batches get a section; the sections add ${added} characters to ${chars} (${pct(added, chars)} of the prompts, diffs included).`,
    );
    console.log("\nFiring files:");
    for (const r of reports) for (const id of ids) for (const f of r.fires[id]!) console.log(`- #${r.pr} ${id}: ${f}`);
  }
}

if (import.meta.main) main();
