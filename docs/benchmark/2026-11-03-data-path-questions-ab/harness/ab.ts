#!/usr/bin/env bun
/**
 * A/B harness for the data-path questions (PR #88). It drives one arm's own engine code, imported
 * from that arm's checkout, over one batch of a kaipu-record pull request at a given head.
 *
 *   bun ab.ts plan --engine <dir> --clone <dir> --pr <n> --base <sha> --head <sha> --bug-file <path>...
 *       Builds the pull request's file list from `git diff <merge-base> <head>` in the clone, in
 *       GitHub's patch format, runs the engine's `filterFiles` and `planBatches` with the
 *       production limits, and prints every batch, the one holding each bug file, and (when the
 *       engine has them) the data-path questions `selectQuestions` picks for that batch. Free.
 *
 *   bun ab.ts run --engine <dir> --clone <dir> --repo-dir <head checkout> --pr <n> --base <sha>
 *       --head <sha> --bug-file <path> --out <dir> [--dry-run]
 *       Rebuilds the same batch, then follows `reviewBatch` step by step with the arm's exported
 *       functions: `pr.json` and `threads.json` in a scratch dir, call-site evidence
 *       (`planEvidence` + `collectEvidence`, as `gatherEvidence` does), `buildBatchPrompt` with its
 *       defaults (so arm B adds its questions exactly as the engine would), the Claude Code
 *       provider with the arguments `runProvider` passes, and `checkOutput(relativisePaths(...))`.
 *       Writes prompt.txt, result.json (the provider result) and output.json (the checked batch
 *       output) to --out. --dry-run stops before the paid call.
 *
 * Production settings (kaipu-record's caller workflow and review.yml defaults): model
 * claude-opus-5-5, effort high, batch budget $0.75, 40 turns, 900 s, 1000 lines and 140000 chars
 * per batch, no extra excludes.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PROD = {
  model: "claude-opus-5-5",
  effort: "high",
  batchBudgetUsd: 0.75,
  maxTurns: 40,
  callTimeoutS: 900,
  batchLines: 1000,
  batchChars: 140000,
  repo: "niway-dev/kaipu-record",
} as const;

function parseArgs(argv: string[]) {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = [...(out[key] ?? []), "1"];
    else {
      out[key] = [...(out[key] ?? []), next];
      i++;
    }
  }
  return out;
}

function git(clone: string, args: string[]) {
  const r = spawnSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

interface PrFile {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/**
 * The pull request's files as GitHub's `pulls/<n>/files` would list them at this head: the diff
 * from the merge base, renames detected, each patch starting at its first hunk header.
 */
export function prFiles(clone: string, base: string, head: string): { mergeBase: string; files: PrFile[] } {
  const mergeBase = git(clone, ["merge-base", base, head]).trim();
  const diff = git(clone, ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", mergeBase, head]);
  const files: PrFile[] = [];
  for (const chunk of diff.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split("\n");
    let filename: string | undefined;
    const renameTo = lines.find((l) => l.startsWith("rename to "));
    const plus = lines.find((l) => l.startsWith("+++ "));
    const minus = lines.find((l) => l.startsWith("--- "));
    if (renameTo) filename = renameTo.slice("rename to ".length);
    else if (plus && plus !== "+++ /dev/null") filename = plus.slice("+++ b/".length);
    else if (minus && minus !== "--- /dev/null") filename = minus.slice("--- a/".length);
    else {
      // Binary or mode-only change: take the b/ path from the header line.
      const m = lines[0].match(/^a\/(.+) b\/(.+)$/);
      filename = m?.[2];
    }
    if (!filename) continue;
    const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
    if (firstHunk < 0) {
      files.push({ filename, additions: 0, deletions: 0 });
      continue;
    }
    const body = lines.slice(firstHunk);
    while (body.length > 0 && body[body.length - 1] === "") body.pop();
    let additions = 0;
    let deletions = 0;
    for (const l of body) {
      if (l.startsWith("+")) additions++;
      else if (l.startsWith("-")) deletions++;
    }
    files.push({ filename, additions, deletions, patch: body.join("\n") });
  }
  return { mergeBase, files };
}

async function loadEngine(engineDir: string) {
  const dir = resolve(engineDir);
  const engine = await import(join(dir, "src/engine.ts"));
  const evidence = await import(join(dir, "src/evidence.ts"));
  const contracts = await import(join(dir, "src/contracts.ts"));
  const provider = await import(join(dir, "src/providers/claude-code.ts"));
  let questions: { selectQuestions: (files: PrFile[]) => { id: string }[] } | null = null;
  try {
    questions = await import(join(dir, "src/questions/index.ts"));
  } catch {
    questions = null;
  }
  return { engine, evidence, contracts, provider, questions };
}

async function planFor(opts: Record<string, string[]>) {
  const E = await loadEngine(opts.engine[0]);
  const clone = resolve(opts.clone[0]);
  const { mergeBase, files } = prFiles(clone, opts.base[0], opts.head[0]);
  const { kept, dropped } = E.engine.filterFiles(files, [...E.engine.DEFAULT_EXCLUDE], []);
  const batches = E.engine.planBatches(kept, { maxLines: PROD.batchLines, maxChars: PROD.batchChars });
  return { E, clone, mergeBase, files, kept, dropped, batches };
}

function batchIndexOf(batches: { files: PrFile[] }[], path: string) {
  return batches.findIndex((b) => b.files.some((f) => f.filename === path));
}

async function plan(opts: Record<string, string[]>) {
  const { E, mergeBase, files, kept, dropped, batches } = await planFor(opts);
  const report = {
    pr: Number(opts.pr[0]),
    head: opts.head[0],
    mergeBase,
    files: files.length,
    kept: kept.length,
    dropped: dropped.map((f: PrFile) => f.filename),
    batches: batches.map((b: { files: PrFile[]; lines: number; maxRisk: number }, i: number) => ({
      index: i + 1,
      files: b.files.length,
      lines: b.lines,
      maxRisk: b.maxRisk,
      paths: b.files.map((f) => f.filename),
      questions: E.questions ? E.questions.selectQuestions(b.files).map((q) => q.id) : null,
    })),
    bugFiles: (opts["bug-file"] ?? []).map((p) => ({ path: p, batch: batchIndexOf(batches, p) + 1 })),
  };
  console.log(JSON.stringify(report, null, 2));
}

/** `gh` for `readBaseInstructions` only: the contents API, answered from the clone. */
function cloneGh(clone: string, GhError: new (m: string, s: number | null, g: string) => Error) {
  return (args: string[]) => {
    const m = args[1]?.match(/^repos\/[^/]+\/[^/]+\/contents\/(.+)\?ref=([0-9a-f]+)$/);
    if (args[0] !== "api" || !m) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    const r = spawnSync("git", ["-C", clone, "show", `${m[2]}:${m[1]}`], { encoding: "buffer" });
    if (r.status !== 0) throw new GhError("Not Found", 404, "Not Found");
    return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(r.stdout).toString("base64") });
  };
}

async function run(opts: Record<string, string[]>) {
  const { E, clone, mergeBase, kept, dropped, batches } = await planFor(opts);
  const repoDir = resolve(opts["repo-dir"][0]);
  const headInCheckout = git(repoDir, ["rev-parse", "HEAD"]).trim();
  const head = git(clone, ["rev-parse", opts.head[0]]).trim();
  if (headInCheckout !== head) throw new Error(`--repo-dir is at ${headInCheckout}, not ${head}`);
  const index = batchIndexOf(batches, opts["bug-file"][0]);
  if (index < 0) throw new Error(`${opts["bug-file"][0]} is in no batch`);
  const files: PrFile[] = batches[index].files;
  const out = resolve(opts.out[0]);
  mkdirSync(out, { recursive: true });
  const log: string[] = [];
  const say = (line: string) => {
    log.push(line);
    console.error(line);
  };

  const pr = Number(opts.pr[0]);
  const meta = JSON.parse(readFileSync(opts.meta[0], "utf8"));
  const instructions = E.engine.readBaseInstructions(cloneGh(clone, E.engine.GhError), PROD.repo, mergeBase, say);
  const ctx = {
    pr,
    repo: PROD.repo,
    headSha: head,
    since: null,
    rebased: false,
    paths: [],
    dropped: dropped.length,
    everyFile: kept.map((f: PrFile) => `- ${f.filename} +${f.additions} −${f.deletions}`).join("\n"),
    meta: { title: meta.title, body: meta.body ?? "", author: meta.author },
    instructions: E.engine.renderInstructions(instructions),
  };

  // reviewBatch, step by step.
  const dir = mkdtempSync(join(tmpdir(), "agent-review-"));
  writeFileSync(
    join(dir, "pr.json"),
    JSON.stringify({ title: ctx.meta.title, body: ctx.meta.body, author: ctx.meta.author?.login }, null, 2),
  );
  writeFileSync(join(dir, "threads.json"), JSON.stringify([], null, 2));
  // gatherEvidence, as in engine.ts.
  const batchFiles = files.map((f) => f.filename);
  const ev = E.evidence;
  let doc = ev.emptyEvidence(batchFiles, "No symbols to search.");
  const plan = ev.planEvidence(files.map((f) => ({ filename: f.filename, addedLines: ev.addedLinesOf(f.patch) })));
  if (plan.symbols.length > 0) {
    const found = ev.collectEvidence(plan, { repoDir, batchFiles }, { ...ev.defaultEvidenceIo, now: Date.now });
    doc = found.doc;
    for (const w of found.warnings) say(w);
  }
  const text = ev.fitEvidence(doc, ev.EVIDENCE_CAPS.fileBytes);
  writeFileSync(join(dir, "evidence.json"), text);
  const evidence = ev.renderEvidenceSlice(doc, dir);
  const questions = E.questions ? E.questions.selectQuestions(files).map((q) => q.id) : null;
  say(`Data-path questions: ${questions === null ? "(engine has none)" : questions.join(", ") || "none"}`);
  const part = { index: index + 1, total: batches.length };
  const prompt: string = E.engine.buildBatchPrompt(ctx, files, false, part, dir, ctx.instructions, evidence);
  writeFileSync(join(out, "prompt.txt"), prompt);
  writeFileSync(join(out, "evidence.json"), text);
  const info = {
    pr,
    head,
    mergeBase,
    part,
    files: batchFiles,
    questions,
    engine: git(resolve(opts.engine[0]), ["rev-parse", "HEAD"]).trim(),
    promptChars: prompt.length,
    scratchDir: dir,
  };
  writeFileSync(join(out, "info.json"), JSON.stringify(info, null, 2));
  if (opts["dry-run"]) {
    say(`dry run: prompt ${prompt.length} chars written to ${out}`);
    return;
  }

  // `binary`: a wrapper that restores USER for the local keychain login (claude-with-user.sh).
  const provider = new E.provider.ClaudeCodeProvider({
    model: PROD.model,
    requireApiKey: false,
    effort: PROD.effort,
    binary: opts.binary?.[0] ?? "claude",
  });
  provider.preflight();
  // runProvider, as in engine.ts.
  const result = provider.run({
    prompt,
    cwd: repoDir,
    addDirs: [dir],
    allowedTools: ["read", "glob", "grep"],
    maxBudgetUsd: PROD.batchBudgetUsd,
    maxTurns: PROD.maxTurns,
    timeoutMs: PROD.callTimeoutS * 1000,
    outputSchema: E.engine.SCHEMA,
    promptViaStdin: true,
  });
  say(
    JSON.stringify({
      is_error: result.isError,
      terminal_reason: result.terminalReason,
      turns: result.turns,
      cost_usd: result.costUsd,
      duration_ms: result.durationMs,
    }),
  );
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
  const raw = !result.isError ? result.structuredOutput : undefined;
  const output =
    raw &&
    E.engine.checkOutput(E.engine.relativisePaths(raw, repoDir), E.contracts.repoLineCounter(repoDir), say);
  writeFileSync(join(out, "output.json"), JSON.stringify(output ?? null, null, 2));
  writeFileSync(join(out, "log.txt"), log.join("\n") + "\n");
}

if (import.meta.main) {
const [mode, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);
if (mode === "plan") await plan(opts);
else if (mode === "run") await run(opts);
else {
  console.error("usage: bun ab.ts plan|run ...");
  process.exit(2);
}
}
