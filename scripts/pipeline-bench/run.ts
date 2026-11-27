// Times and sizes the code-only pipeline of one engine over one corpus case, with a stub provider
// that answers instantly with full coverage. The model, the GitHub API and posting are out.
//
// Usage: bun --no-env-file --config=bunfig.toml scripts/pipeline-bench/run.ts \
//          --src <engine src dir> --repo <checkout of the case> --case <id> [--runs N]
// Prints one JSON line. Only APIs that exist in old engine versions are used, and each is looked
// up at run time. buildLocalInput, reviewChange, loadConfig and reviewOptionsOf are required: an engine
// without one exits with status 3 ("nothing to measure"). A missing optional API (the evidence log
// lines, the pure planning steps) leaves its metrics null instead of failing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const srcDir = arg("src") ? resolve(arg("src")!) : "";
const repoDir = arg("repo") ? resolve(arg("repo")!) : "";
const caseId = arg("case");
if (!srcDir || !repoDir || !caseId) {
  console.error("usage: bun run.ts --src <engine src dir> --repo <case checkout> --case <id> [--runs N]");
  process.exit(2);
}
const corpus = JSON.parse(readFileSync(join(import.meta.dir, "corpus.json"), "utf8"));
const spec = corpus.cases.find((c: { id: string }) => c.id === caseId);
if (!spec) {
  console.error(`unknown case ${caseId}`);
  process.exit(2);
}
const runsArg = arg("runs") ? Number(arg("runs")) : undefined;

// The engine under test is loaded from a path chosen at run time, so its types are not known here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
// Only a module that does not exist gives {} (an old engine without that file); any other error
// (a syntax error, a failing import) is printed and rethrown, so it is never read as "no API".
const load = async (rel: string): Promise<Any> => {
  const path = join(srcDir, rel);
  try {
    return await import(path);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (!existsSync(path) && (err.code === "ERR_MODULE_NOT_FOUND" || /cannot find module/i.test(err.message ?? ""))) return {};
    console.error(`failed to load ${path}: ${err.message ?? e}`);
    throw e;
  }
};
const git: Any = await load("connectors/local-git.ts");
const eng: Any = await load("engine.ts");
const cfg: Any = await load("config.ts");
if (
  typeof git.buildLocalInput !== "function" ||
  typeof eng.reviewChange !== "function" ||
  typeof eng.reviewOptionsOf !== "function" ||
  typeof cfg.loadConfig !== "function"
) {
  console.error("the engine at --src has no buildLocalInput, reviewChange, reviewOptionsOf or loadConfig: nothing to measure");
  process.exit(3);
}

const now = () => performance.now();
const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const median = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const has = (name: string) => typeof eng[name] === "function";

/** What can change from one run to the next is cut out: the cap's wall clock and time-box notes. */
function stableEvidence(text: string): string {
  try {
    const doc = JSON.parse(text);
    if (doc?.caps) delete doc.caps.wall_clock_ms;
    if (Array.isArray(doc?.notes)) doc.notes = doc.notes.filter((n: string) => !/time box/i.test(n));
    return JSON.stringify(doc);
  } catch {
    return text;
  }
}

async function once() {
  const marks: string[] = [];
  const log = (line: string) => marks.push(line);
  let t = now();
  const built = git.buildLocalInput({ repoDir, commit: spec.sha, paths: [], log, warn: log });
  const inputMs = now() - t;
  const input = built.input;
  try {
    const config = cfg.loadConfig ? cfg.loadConfig({}, () => {}) : undefined;
    const options = has("reviewOptionsOf") && config ? eng.reviewOptionsOf(config, 1e6, "default") : undefined;

    // The pure planning steps, timed alone (reviewChange runs them again inside).
    let filterMs: number | null = null;
    let splitMs: number | null = null;
    let planMs: number | null = null;
    let kept: Any[] | null = null;
    let reviewable: Any[] | null = null;
    let batches: Any[] | null = null;
    if (options && has("filterFiles") && eng.DEFAULT_EXCLUDE) {
      t = now();
      const filtered = eng.filterFiles(input.files, [...eng.DEFAULT_EXCLUDE, ...(options.exclude ?? [])], input.scope);
      filterMs = now() - t;
      kept = filtered.kept;
      if (has("splitUnreviewable")) {
        t = now();
        reviewable = eng.splitUnreviewable(kept, input.headDir).reviewable;
        splitMs = now() - t;
        if (has("planBatches")) {
          t = now();
          batches = eng.planBatches(reviewable, { maxLines: options.batchLines, maxChars: options.batchChars }, input.pathRules);
          planMs = now() - t;
        }
      }
    }

    // The whole core, with a provider that reads each batch's evidence file before it is removed.
    const prompts: string[] = [];
    let mismatches = 0;
    const evidences: string[] = [];
    const provider = {
      name: "stub",
      preflight() {},
      modelLabel: () => "stub",
      leaksSecret: () => false,
      async run(req: { prompt: string }) {
        // The run dir is a random temp dir named in the prompt: it is replaced before hashing.
        const dir = req.prompt.match(/(\S*wachiman-review-[A-Za-z0-9]+)\//)?.[1];
        let prompt = req.prompt;
        if (dir) {
          prompt = prompt.split(dir).join("<run-dir>");
          try {
            evidences.push(stableEvidence(readFileSync(join(dir, "evidence.json"), "utf8")));
          } catch {
            // No evidence file: this batch adds nothing to the evidence hash.
          }
        }
        prompts.push(prompt);
        const m = req.prompt.match(/This part holds exactly these files[^\n]*\n([\s\S]*?)\n\n/);
        const files = (m?.[1] ?? "")
          .split("\n")
          .map((l) => l.replace(/^- /, "").replace(/ \+\d+ −\d+.*$/, ""))
          .filter(Boolean);
        // A non-empty prompt with no files parsed means the engine's wording changed under the stub.
        if (files.length === 0 && req.prompt.trim() !== "") mismatches++;
        return {
          structuredOutput: { files_reviewed: files, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "stub" },
          costUsd: 0,
          turns: 1,
          durationMs: 0,
          terminalReason: "success",
          isError: false,
        };
      },
    };
    t = now();
    await eng.reviewChange(input, options, { provider, log, warn: log });
    const coreMs = now() - t;

    // The evidence log line: "evidence: N symbol(s) found, M call site(s), B bytes, T ms, status".
    const lines = marks
      .map((l) => l.match(/evidence: (\d+) symbol\(s\) found, (\d+) call site\(s\), (\d+) bytes, (\d+) ms/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ symbols: +m[1], sites: +m[2], bytes: +m[3], ms: +m[4] }));
    const hasEvidence = lines.length > 0;
    const allFiles: Any[] = input.files;
    return {
      mismatches,
      det: {
        filesChanged: allFiles.length,
        filesKept: kept ? kept.length : null,
        filesReviewable: reviewable ? reviewable.length : null,
        linesChanged: reviewable ? sum(reviewable.map((f) => (f.additions ?? 0) + (f.deletions ?? 0))) : null,
        batches: batches ? batches.length : null,
        providerCalls: prompts.length,
        promptCharsTotal: sum(prompts.map((p) => p.length)),
        evidenceBytesTotal: hasEvidence ? sum(lines.map((l) => l.bytes)) : null,
        evidenceSymbols: hasEvidence ? sum(lines.map((l) => l.symbols)) : null,
        evidenceCallSites: hasEvidence ? sum(lines.map((l) => l.sites)) : null,
        // Batches finish in any order, so the per-batch digests are sorted before the last one.
        evidenceHash: evidences.length ? sha256(evidences.map(sha256).sort().join("\n")) : null,
        promptHash: prompts.length ? sha256(prompts.map(sha256).sort().join("\n")) : null,
      },
      ms: {
        input: inputMs,
        filter: filterMs,
        split: splitMs,
        planBatches: planMs,
        reviewChange: coreMs,
        evidenceSum: hasEvidence ? sum(lines.map((l) => l.ms)) : null,
        evidenceMaxBatch: hasEvidence ? Math.max(...lines.map((l) => l.ms)) : null,
      },
    };
  } finally {
    // One cleanup path that always runs: the snapshot directory and its `.tar`, whatever the engine offers.
    rmSync(built.snapshotDir, { recursive: true, force: true });
    rmSync(`${built.snapshotDir}.tar`, { force: true });
  }
}

// Read every object of the case once, untimed, so the first engine measured does not pay the cold
// git object cache that the second one would get for free. This costs seconds, not a pipeline pass.
const warm = spawnSync("git", ["-C", repoDir, "cat-file", "--batch-all-objects", "--batch"], { stdio: "ignore" });
if (warm.error || warm.status !== 0) {
  console.error(`warning: the git cache warm-up failed (${warm.error?.message ?? `exit ${warm.status}`}); timings may carry a cold cache`);
}
const first = await once();
const runs = runsArg ?? (first.ms.reviewChange < 60_000 ? 3 : 1);
const all = [first];
for (let i = 1; i < runs; i++) all.push(await once());
const timing: Record<string, number | null> = {};
for (const k of Object.keys(first.ms) as (keyof typeof first.ms)[]) {
  const xs = all.map((r) => r.ms[k]).filter((x): x is number => x !== null);
  timing[k] = xs.length ? +median(xs).toFixed(2) : null;
}
console.log(
  JSON.stringify({
    case: spec.id,
    repo: spec.repo,
    sha: spec.sha,
    tier: spec.tier,
    runs,
    deterministic: first.det,
    // Batches whose file list the stub could not read from the engine's prompt.
    harnessMismatch: all.reduce((n, r) => n + r.mismatches, 0),
    // The same inputs must give the same digests on every run; a difference is reported, not hidden.
    stable: all.every((r) => r.det.evidenceHash === first.det.evidenceHash && r.det.promptHash === first.det.promptHash),
    timingMs: timing,
  }),
);
