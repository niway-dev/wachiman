/**
 * Parity between the GitHub and the local-git connectors (spec D13).
 *
 * Level (b), always: for a recorded pull request and this clone at the same commits, the fake
 * provider receives byte-identical prompts from both connectors, given the same `change`. Skipped
 * when the commits are not in the clone (a shallow checkout: `git fetch --unshallow`).
 *
 * Level (a), opt-in (`WACHI_PARITY=1`, needs `gh` and the network): for merged pull requests of
 * this repository, the local files list equals GitHub's wherever GitHub sent a patch.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { localFiles, localInstructions, removeSnapshot, snapshotHead } from "../src/connectors/local-git";
import {
  defaultGh,
  githubReviewInput,
  REVIEW_INPUT_FORMAT,
  reviewChange,
  reviewOptionsOf,
  type ReviewFile,
  type ReviewInput,
} from "../src/engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../src/providers/types";
import { recordPrFixture, type PrFixture } from "../scripts/record-pr-fixture";

const ROOT = join(import.meta.dir, "..");
const FIXTURES = join(import.meta.dir, "fixtures", "parity");
const hasCommit = (sha: string) => spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT }).status === 0;

/** Answers every call with every file reviewed, so no batch retries and the prompts alone differ. */
class AllReviewed implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly filenames: string[]) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    return {
      costUsd: 0.01,
      turns: 1,
      durationMs: 1,
      terminalReason: "success",
      isError: false,
      raw: {},
      structuredOutput: { files_reviewed: this.filenames, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "ok" },
    };
  }
}

/** The prompts of one core run, with the per-batch run directory as a placeholder. */
function prompts(input: ReviewInput) {
  const provider = new AllReviewed(input.files.map((f) => f.filename));
  const options = reviewOptionsOf(loadConfig({}, () => {}), 3);
  reviewChange(input, options, { provider, log: () => {}, warn: () => {}, sleep: () => {}, rateLimitBackoffMs: 0 });
  return provider.requests.map((r) => r.prompt.replaceAll(r.addDirs[0], "<RUN_DIR>"));
}

/** The keys both connectors fill, with GitHub's `null` read as absent. */
const comparable = (f: ReviewFile) =>
  Object.fromEntries(
    (["filename", "additions", "deletions", "patch", "previous_filename"] as const)
      .filter((k) => f[k] !== undefined && f[k] !== null)
      .map((k) => [k, f[k]]),
  );

const snapshots: string[] = [];
afterAll(() => snapshots.forEach(removeSnapshot));

const fixtures = readdirSync(FIXTURES)
  .filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(readFileSync(join(FIXTURES, n), "utf8")) as PrFixture);

describe("prompt parity between the github and local-git connectors", () => {
  for (const fx of fixtures) {
    const present = hasCommit(fx.headSha) && hasCommit(fx.mergeBase);
    test.skipIf(!present)(`pull request #${fx.pr} at ${fx.headSha.slice(0, 7)} (needs its commits: git fetch --unshallow)`, () => {
      const snapshot = snapshotHead(ROOT, fx.headSha);
      snapshots.push(snapshot.dir);
      expect(snapshot.missing).toEqual([]);
      const github = githubReviewInput({
        repo: fx.repo,
        pr: fx.pr,
        headSha: fx.headSha,
        baseSha: fx.baseSha,
        meta: fx.meta,
        files: fx.files,
        instructions: fx.instructions,
        headDir: snapshot.dir,
        scope: [],
        since: null,
        rebased: false,
        threads: [],
      });
      const warnings: string[] = [];
      const local: ReviewInput = {
        format: REVIEW_INPUT_FORMAT,
        // The same metadata on both sides: the test is about the files and the instructions.
        change: github.change,
        files: localFiles(ROOT, fx.mergeBase, fx.headSha),
        instructions: localInstructions(ROOT, fx.mergeBase, (l) => warnings.push(l)),
        headDir: snapshot.dir,
        scope: [],
      };
      expect(local.instructions).toEqual(fx.instructions);
      const withPatch = new Set(fx.files.filter((f) => f.patch).map((f) => f.filename));
      expect(local.files.filter((f) => withPatch.has(f.filename)).map(comparable)).toEqual(
        fx.files.filter((f) => withPatch.has(f.filename)).map(comparable),
      );
      expect(local.files.map((f) => f.filename)).toEqual(fx.files.map((f) => f.filename));
      const localOnly = local.files.filter((f) => f.patch && !withPatch.has(f.filename)).map((f) => f.filename);
      if (localOnly.length > 0) console.log(`#${fx.pr}: only the local connector has a patch for ${localOnly.join(", ")}`);
      const fromGithub = prompts(github);
      const fromLocal = prompts(local);
      expect(fromLocal.length).toBe(fromGithub.length);
      expect(fromLocal.length).toBeGreaterThan(0);
      fromLocal.forEach((prompt, i) => expect(prompt, `#${fx.pr} batch ${i + 1}`).toBe(fromGithub[i]));
    });
  }
});

/** The first `lines` lines of a unified diff of two patches. */
function patchDiff(a: string, b: string, lines = 40) {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-parity-"));
  try {
    writeFileSync(join(dir, "github"), `${a}\n`);
    writeFileSync(join(dir, "local"), `${b}\n`);
    const out = spawnSync("git", ["diff", "--no-index", "--no-color", "github", "local"], { cwd: dir, encoding: "utf8" });
    return out.stdout.split("\n").slice(0, lines).join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(process.env.WACHI_PARITY !== "1")("files parity with GitHub on merged pull requests (WACHI_PARITY=1)", () => {
  test(
    "equal filename, additions, deletions and patch wherever GitHub sent a patch",
    () => {
      const repo = "niway-dev/wachiman";
      const merged = JSON.parse(defaultGh(["pr", "list", "-R", repo, "--state", "merged", "--limit", "20", "--json", "number"])) as {
        number: number;
      }[];
      const rows: { pr: number; files: number; equal: number; localOnly: number; differing: number }[] = [];
      const failures: string[] = [];
      for (const { number } of merged) {
        if (rows.length >= 10) break;
        const fx = recordPrFixture(defaultGh, repo, number);
        if (!hasCommit(fx.headSha) || !hasCommit(fx.mergeBase)) continue;
        const local = new Map(localFiles(ROOT, fx.mergeBase, fx.headSha).map((f) => [f.filename, f]));
        let equal = 0;
        let localOnly = 0;
        let differing = 0;
        for (const gf of fx.files) {
          const lf = local.get(gf.filename);
          if (!gf.patch) {
            if (lf?.patch) localOnly++;
            continue;
          }
          const same = lf && JSON.stringify(comparable(lf)) === JSON.stringify(comparable(gf));
          if (same) equal++;
          else {
            differing++;
            failures.push(
              `#${number} ${gf.filename}: github +${gf.additions} −${gf.deletions}, local ${lf ? `+${lf.additions} −${lf.deletions}` : "missing"}\n${patchDiff(gf.patch, lf?.patch ?? "")}`,
            );
          }
        }
        const missing = [...local.keys()].filter((name) => !fx.files.some((f) => f.filename === name));
        if (missing.length > 0) failures.push(`#${number}: local-only files ${missing.join(", ")}`);
        rows.push({ pr: number, files: fx.files.length, equal, localOnly, differing });
      }
      console.log(
        ["| PR | files | equal | local-only patch | differing |", "| --- | --- | --- | --- | --- |", ...rows.map((r) => `| #${r.pr} | ${r.files} | ${r.equal} | ${r.localOnly} | ${r.differing} |`)].join("\n"),
      );
      expect(rows.length).toBeGreaterThanOrEqual(10);
      expect(failures, failures.join("\n\n")).toEqual([]);
    },
    300_000,
  );
});
