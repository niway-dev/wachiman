/**
 * What a loop round records about itself, and how the summary of the loop is printed and published
 * (ADR 0054). The review is a seam that answers like `runLocal` with a complete `/2` result; `gh` is
 * a scripted function. No model, no network, no GitHub.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wachimanHome } from "../accounts/config";
import { UsageError } from "../config";
import { historyRoot, readLoopFile, repositoryKey, writeLoopFile } from "../history/store";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { parseLoopArgs, runLoop } from "./command";
import type { GhResult, GhRunner } from "./publish";
import { readLoop } from "./state";
import { SUMMARY_MARKER } from "./summary";

const temps: string[] = [];
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const A1 = "export const a = 1;\nexport const b = 2;\n";
const A2 = "export const a = 1;\nexport const b = 20;\n";
const A3 = "export const a = 1;\nexport const b = 21;\n";
const A4 = "export const a = 1;\nexport const b = 22;\n";
const SETTINGS_ON = "# Wachiman settings\npublishLoopSummary: true\n";

/** `main` holds `base`; `feat/x` is checked out with one commit of its own. */
function repo(baseFiles: Record<string, string> = {}, branchFiles: Record<string, string> = {}) {
  const dir = emptyRepo("wachiman-loop-summary-");
  commit(dir, { "src/a.ts": A1, ...baseFiles }, "base");
  git(dir, "switch", "-q", "-c", "feat/x");
  commit(dir, { "src/a.ts": A2, ...branchFiles }, "change a");
  return dir;
}

interface Fake {
  /** The `from` each review call was asked to read. */
  calls: string[];
  review: never;
}
const FINDING = { id: "ab12cd34ef", path: "src/a.ts", line: 2, severity: "blocker", topic: "bug", title: "Off by ten" };

/** A review seam whose n-th call reports `findings[n]`, with the version and cost its options give. */
function fakeReview(dir: string, findings: object[][] = [], over: { version?: string; verifier?: boolean; verificationStatus?: string } = {}): Fake {
  const calls: string[] = [];
  return {
    calls,
    review: ((args: { base?: string }, _r: string, _e: unknown, io: { stdout: (t: string) => void }) => {
      const n = calls.length;
      calls.push(args.base ?? "");
      const head = git(dir, "rev-parse", "HEAD").trim();
      io.stdout(
        JSON.stringify({
          format: "wachiman.review-result/2",
          change: { base: { sha: git(dir, "merge-base", args.base ?? "main", head).trim() }, head: { sha: head } },
          engine: { version: over.version ?? "1.15.0" },
          provider: { model: "claude-sonnet-5-5", effort: "high" },
          coverage: { expected: ["src/a.ts"], reviewed: ["src/a.ts"], partial: false },
          execution: { stop: "complete", costUsdEstimate: 0.5 + n, durationMs: 60_000 * (n + 1) },
          findings: findings[n] ?? [],
          ...(over.verifier ? { verification: { ...(over.verificationStatus ? { status: over.verificationStatus } : {}), model: "claude-opus-5-5", effort: "high", entries: [] } } : {}),
        }),
      );
      return 0;
    }) as never,
  };
}

/** A scripted `gh`: an open pull request, the account `csdev19`, and the comments already there. */
function fakeGh(existing: string[] = [], fail?: string) {
  const calls: string[][] = [];
  const ok = (stdout: string): GhResult => ({ status: 0, stdout, stderr: "" });
  const gh: GhRunner = (args, input) => {
    calls.push(input === undefined ? args : [...args, `input:${input.length}`]);
    if (fail && args.includes(fail)) return { status: 1, stdout: "", stderr: "gh says no" };
    if (args[0] === "pr") return ok(JSON.stringify([{ number: 3, url: "https://github.com/niway-dev/wachiman/pull/3" }]));
    if (args[1] === "user") return ok("csdev19\n");
    if (args.includes("--paginate")) return ok(existing.join("\n"));
    return ok("https://github.com/niway-dev/wachiman/pull/3#issuecomment-1\n");
  };
  return { gh, calls, posted: () => calls.some((c) => c.includes("POST") || c.includes("PATCH")) };
}

function session(dir: string) {
  const home = mkdtempSync(join(tmpdir(), "wachiman-loop-summary-home-"));
  temps.push(home);
  const root = historyRoot(wachimanHome({ WACHIMAN_HOME: home }));
  const key = repositoryKey(dir).key;
  const run = async (fake: Fake, gh: GhRunner, ...argv: string[]) => {
    let out = "";
    const err: string[] = [];
    const env = { WACHIMAN_HOME: home, PATH: process.env.PATH };
    const code = await runLoop(parseLoopArgs(argv), dir, env, { stdout: (t) => (out += t), stderr: (l) => err.push(l), engineVersion: "0" }, { review: fake.review, gh });
    return { code, out, err };
  };
  return { root, key, run, state: () => readLoop(root, key, "feat/x")! };
}

describe("what a round records", () => {
  test("a verifier that was skipped or failed is recorded as such, never as the verifier that ran", async () => {
    for (const status of ["skipped", "failed"]) {
      const dir = repo();
      const s = session(dir);
      await s.run(fakeReview(dir, [[]], { verifier: true, verificationStatus: status }), fakeGh().gh, "--base", "main");
      const review = s.state().rounds[0].review!;
      expect(review.verifier).toBeUndefined();
      expect(review.verifierStatus).toBe(status);
    }
    const dir = repo();
    const s = session(dir);
    await s.run(fakeReview(dir, [[]], { verifier: true, verificationStatus: "verified" }), fakeGh().gh, "--base", "main");
    expect(s.state().rounds[0].review!.verifier).toEqual({ model: "claude-opus-5-5", effort: "high" });
    expect(s.state().rounds[0].review!.verifierStatus).toBeUndefined();
  }, 30_000);

  test("each round keeps its range, version, models, cost, time and findings; the next round starts where the last one ended", async () => {
    const dir = repo();
    const s = session(dir);
    const fake = fakeReview(dir, [[FINDING], []]);
    const g = fakeGh();
    await s.run(fake, g.gh, "--base", "main");
    const first = git(dir, "rev-parse", "HEAD").trim();
    const fix = commit(dir, { "src/a.ts": A3 }, "fix");
    await s.run(fake, g.gh);
    const state = s.state();
    expect(state.format).toBe("wachiman.loop-state/2");
    expect(state.rounds[0].review).toEqual({
      base: git(dir, "merge-base", "main", first).trim(),
      version: "1.15.0",
      reviewer: { model: "claude-sonnet-5-5", effort: "high" },
      costUsd: 0.5,
      durationMs: 60_000,
      findings: 1,
      newFindings: 1,
    });
    expect(state.rounds[1].review).toMatchObject({ base: first, costUsd: 1.5, durationMs: 120_000, findings: 0, newFindings: 0 });
    expect(state.rounds[1].head).toBe(fix);
    // Contiguous: every round after the first reads from the head the round before ended on.
    for (const [i, r] of state.rounds.entries()) if (i > 0) expect(r.review!.base).toBe(state.rounds[i - 1].head);
    expect(state.ledger[0]).toMatchObject({ id: FINDING.id, round: 1 });
    expect(fake.calls).toEqual(["main", first]);
    expect(state.maxRounds).toBe(5);
  }, 60_000);

  test("three rounds in a row stay contiguous, and a finding keeps the round that first reported it", async () => {
    const dir = repo();
    const s = session(dir);
    const fake = fakeReview(dir, [[FINDING], [FINDING], []]);
    const g = fakeGh();
    await s.run(fake, g.gh, "--base", "main");
    commit(dir, { "src/a.ts": A3 }, "attempt");
    await s.run(fake, g.gh);
    commit(dir, { "src/a.ts": A4 }, "fix");
    await s.run(fake, g.gh);
    const { rounds, ledger } = s.state();
    expect(rounds.map((r) => r.review!.base)).toEqual([expect.any(String), rounds[0].head, rounds[1].head]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].round).toBe(1);
    expect(rounds[1].review).toMatchObject({ findings: 1, newFindings: 0 });
  }, 60_000);

  test("a verifier shows up as the round's verifier; no verifier leaves it out", async () => {
    const dir = repo();
    const s = session(dir);
    await s.run(fakeReview(dir, [], { verifier: true }), fakeGh().gh, "--base", "main");
    expect(s.state().rounds[0].review!.verifier).toEqual({ model: "claude-opus-5-5", effort: "high" });
  }, 30_000);

  test("a round with no new commit records no review", async () => {
    const dir = repo();
    const s = session(dir);
    const fake = fakeReview(dir, [[FINDING]]);
    await s.run(fake, fakeGh().gh, "--base", "main");
    await s.run(fake, fakeGh().gh);
    expect(s.state().rounds[1].review).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  }, 30_000);

  test("a result without a cost is recorded as not recorded, never as zero", async () => {
    const dir = repo();
    const s = session(dir);
    const broken = ((_a: unknown, _r: string, _e: unknown, io: { stdout: (t: string) => void }) => {
      io.stdout(
        JSON.stringify({
          format: "wachiman.review-result/2",
          change: { head: { sha: git(dir, "rev-parse", "HEAD").trim() } },
          coverage: { expected: [], reviewed: [], partial: false },
          execution: { stop: "complete" },
          findings: [],
        }),
      );
      return 0;
    }) as never;
    await s.run({ calls: [], review: broken }, fakeGh().gh, "--base", "main");
    expect(s.state().rounds[0].review).toBeUndefined();
    const out = await s.run({ calls: [], review: broken }, fakeGh().gh, "--summary");
    expect(out.out).toContain("| **Wachiman cost** | not recorded |");
  }, 30_000);
});

describe("a loop state from before the per-round data", () => {
  test("it still reads, prints with not recorded, and the next round upgrades it and keeps the old rounds", async () => {
    const dir = repo();
    const s = session(dir);
    const base = git(dir, "rev-parse", "main").trim();
    writeLoopFile(s.root, s.key, "feat/x", {
      format: "wachiman.loop-state/1",
      branch: "feat/x",
      base: "main",
      status: "open",
      rounds: [{ round: 1, head: base, at: "2026-11-13T10:00:00.000Z" }],
      ledger: [{ id: "0011223344", path: "src/a.ts", line: 2, severity: "fix", topic: "bug", title: "Old finding", status: "unknown", refuted: false }],
    });
    const fake = fakeReview(dir, []);
    const printed = await s.run(fake, fakeGh().gh, "--summary");
    expect(printed.code).toBe(0);
    expect(printed.out).toContain("| **Reviewer** | not recorded |");
    expect(printed.out).toContain("| **Reviewed** | not recorded |");
    expect(printed.out).toContain("Old finding");
    expect(fake.calls).toHaveLength(0);
    // --summary writes nothing: the file is still a /1 state.
    expect((readLoopFile(s.root, s.key, "feat/x") as { format: string }).format).toBe("wachiman.loop-state/1");

    await s.run(fake, fakeGh().gh);
    const state = s.state();
    expect(state.format).toBe("wachiman.loop-state/2");
    expect(state.rounds).toHaveLength(2);
    expect(state.rounds[0].review).toBeUndefined();
    expect(state.rounds[1].review).toBeDefined();
    const after = await s.run(fake, fakeGh().gh, "--summary");
    expect(after.out).toContain("| **Reviewer** | Wachiman 1.15.0 (round 2); not recorded for round 1 |");
  }, 30_000);
});

describe("--format markdown and --summary", () => {
  test("--format markdown runs the round and prints the summary instead of the report; the outcome goes to stderr; the exit code is the round's", async () => {
    const dir = repo();
    const s = session(dir);
    const g = fakeGh();
    const r = await s.run(fakeReview(dir, [[FINDING]]), g.gh, "--base", "main", "--format", "markdown");
    expect(r.code).toBe(10);
    expect(r.out.split("\n")[0]).toBe(SUMMARY_MARKER);
    expect(r.out).toContain("| **Findings** | 1: 1 open |");
    expect(r.out).toContain("Needs your judgment");
    expect(r.out).not.toContain("Keeps the loop open");
    expect(r.err.some((l) => l.startsWith("loop: 1 finding keeps the loop open"))).toBe(true);
    expect(g.calls).toEqual([]);
  }, 30_000);

  test("--summary prints the loop as it stands with no review call and no write, and a posted-by agent when given", async () => {
    const dir = repo();
    const s = session(dir);
    const fake = fakeReview(dir, [[FINDING]]);
    await s.run(fake, fakeGh().gh, "--base", "main");
    const before = JSON.stringify(s.state());
    const r = await s.run(fake, fakeGh().gh, "--summary", "--agent", "Claude Code");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Posted by an agent (Claude Code)");
    expect(fake.calls).toHaveLength(1);
    expect(JSON.stringify(s.state())).toBe(before);
  }, 30_000);

  test("--summary with no loop open, or a loop with no round yet, is a usage error", async () => {
    const dir = repo();
    const s = session(dir);
    await expect(s.run(fakeReview(dir), fakeGh().gh, "--summary")).rejects.toThrow(UsageError);
    const failing = ((): number => 1) as never;
    await s.run({ calls: [], review: failing }, fakeGh().gh, "--base", "main");
    await expect(s.run(fakeReview(dir), fakeGh().gh, "--summary")).rejects.toThrow(/has not recorded a round yet/);
  }, 30_000);

  test("a loop that stopped at the round cap says so in the summary, and the cap is kept", async () => {
    const dir = repo();
    const s = session(dir);
    const fake = fakeReview(dir, [[FINDING]]);
    await s.run(fake, fakeGh().gh, "--base", "main", "--max-rounds", "1");
    const stop = await s.run(fake, fakeGh().gh, "--max-rounds", "1", "--format", "markdown");
    expect(stop.code).toBe(11);
    expect(stop.out).toContain("| **Rounds** | 1 (budget 1 per pass, counted since the loop last converged or started; stopped at the budget: 1 finding still keeps the loop open) |");
    expect(s.state().maxRounds).toBe(1);
  }, 30_000);
});

describe("--publish", () => {
  test("it creates the summary comment after a round, prints the usual report, and says where it went", async () => {
    const dir = repo();
    const s = session(dir);
    const g = fakeGh();
    const r = await s.run(fakeReview(dir, [[FINDING]]), g.gh, "--base", "main", "--publish");
    expect(r.code).toBe(10);
    expect(r.out).toContain("Keeps the loop open (1):");
    expect(g.calls.some((c) => c.includes("POST"))).toBe(true);
    expect(r.err.some((l) => l.includes("summary created on https://github.com/niway-dev/wachiman/pull/3: "))).toBe(true);
  }, 30_000);

  test("a later round edits the comment in place instead of adding another", async () => {
    const dir = repo();
    const s = session(dir);
    const fake = fakeReview(dir, [[FINDING], []]);
    await s.run(fake, fakeGh().gh, "--base", "main", "--publish");
    commit(dir, { "src/a.ts": A3 }, "fix");
    const g = fakeGh(["4242"]);
    const r = await s.run(fake, g.gh, "--publish");
    expect(g.calls.some((c) => c.includes("PATCH") && c.includes("repos/niway-dev/wachiman/issues/comments/4242"))).toBe(true);
    expect(g.calls.some((c) => c.includes("POST"))).toBe(false);
    expect(r.err.some((l) => l.includes("summary updated"))).toBe(true);
  }, 30_000);

  test("--summary --publish posts the summary without a round; a gh failure is said on stderr and is exit 1 there, never a changed round code", async () => {
    const dir = repo();
    const s = session(dir);
    const fake = fakeReview(dir, [[FINDING]]);
    await s.run(fake, fakeGh().gh, "--base", "main");
    const g = fakeGh();
    expect((await s.run(fake, g.gh, "--summary", "--publish")).code).toBe(0);
    expect(g.posted()).toBe(true);
    expect(fake.calls).toHaveLength(1);

    const bad = fakeGh([], "POST");
    const failed = await s.run(fake, bad.gh, "--summary", "--publish");
    expect(failed.code).toBe(1);
    expect(failed.err.some((l) => l.includes("the summary was not published: could not create the summary comment: gh says no"))).toBe(true);
    commit(dir, { "src/a.ts": A3 }, "fix");
    const round = await s.run(fake, fakeGh([], "POST").gh, "--publish");
    // The fix converged the loop: the failed publish changed nothing about the round's exit code.
    expect(round.code).toBe(0);
    expect(round.err.some((l) => l.includes("the summary was not published"))).toBe(true);
  }, 60_000);

  test("without --publish and with no setting, nothing is sent to GitHub", async () => {
    const dir = repo();
    const s = session(dir);
    const g = fakeGh();
    await s.run(fakeReview(dir, [[FINDING]]), g.gh, "--base", "main");
    expect(g.calls).toEqual([]);
  }, 30_000);
});

describe("publishLoopSummary in .wachiman.yml", () => {
  test("set where the branch started, it publishes after every call without a flag; --no-publish overrides it", async () => {
    const dir = repo({ ".wachiman.yml": SETTINGS_ON });
    const s = session(dir);
    const g = fakeGh();
    const fake = fakeReview(dir, [[FINDING], []]);
    await s.run(fake, g.gh, "--base", "main");
    expect(g.calls.some((c) => c.includes("POST"))).toBe(true);
    commit(dir, { "src/a.ts": A3 }, "fix");
    const off = fakeGh();
    await s.run(fake, off.gh, "--no-publish");
    expect(off.calls).toEqual([]);
  }, 30_000);

  test("set only by the branch under review, it is not read: the change cannot turn publishing on", async () => {
    const dir = repo({}, { ".wachiman.yml": SETTINGS_ON });
    const s = session(dir);
    const g = fakeGh();
    await s.run(fakeReview(dir, [[FINDING]]), g.gh, "--base", "main");
    expect(g.calls).toEqual([]);
  }, 30_000);

  test("when the merge-base cannot be computed the setting is not read, and that is said instead of staying silent", async () => {
    const dir = repo({ ".wachiman.yml": SETTINGS_ON });
    const s = session(dir);
    await s.run(fakeReview(dir, [[FINDING]]), fakeGh().gh, "--base", "main");
    writeLoopFile(s.root, s.key, "feat/x", { ...s.state(), base: "no-such-ref" });
    const g = fakeGh();
    const r = await s.run(fakeReview(dir, []), g.gh, "--summary");
    expect(r.code).toBe(0);
    expect(g.calls).toEqual([]);
    expect(r.err.some((l) => l.includes("publishLoopSummary was not checked: no merge-base of no-such-ref"))).toBe(true);
  }, 30_000);

  test("a broken settings file is ignored with a warning and the round goes on", async () => {
    const dir = repo({ ".wachiman.yml": "publishLoopSummary: maybe\n" });
    const s = session(dir);
    const g = fakeGh();
    const r = await s.run(fakeReview(dir, [[FINDING]]), g.gh, "--base", "main");
    expect(r.code).toBe(10);
    expect(g.calls).toEqual([]);
    expect(r.err.some((l) => l.includes("publishLoopSummary must be true or false") && l.includes("not publishing"))).toBe(true);
  }, 30_000);
});
