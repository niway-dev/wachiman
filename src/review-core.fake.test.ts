import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError, loadConfig } from "./config";
import { armFor } from "./priority";
import { evaluate, type LoopFinding } from "./loop/stop-rule";
import {
  reviewChange,
  reviewOptionsOf,
  type CoreDeps,
  type ReviewInput,
  type ReviewOptions,
  type ReviewOutput,
  type Thread,
} from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { validate } from "../test/support/json-schema";

// ADR 0019 decision 1: the review core runs from a ReviewInput alone. No `gh` exists in these
// tests: the deps are a proxy that throws on any name the core is not given.

/** Plays back one scripted answer per call and records what the core asked for. */
class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly script: ((request: ProviderRequest) => Partial<ProviderResult>)[]) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret(texts: string[]) {
    return texts.some((t) => t.includes("SECRET"));
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
}

const out = (over: Partial<ReviewOutput>): ReviewOutput => ({
  files_reviewed: [],
  files_skipped: [],
  findings: [],
  thread_replies: [],
  summary: "",
  ...over,
});

const ROOT = join(import.meta.dir, "..");
const resultSchema = JSON.parse(readFileSync(join(ROOT, "docs/formats/review-result.v2.schema.json"), "utf8"));
const branchFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.branch.json"), "utf8"));

/** The branch fixture, with a head directory holding the files its patches describe. */
function branchInput(over: Partial<ReviewInput> = {}): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "core-head-"));
  mkdirSync(join(headDir, "src"));
  mkdirSync(join(headDir, "assets"));
  writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  writeFileSync(join(headDir, "src/b.ts"), "export const d = 4;\nexport const e = 5;\n");
  // The PNG signature and the start of its header: the NUL bytes are what make it binary to the engine.
  writeFileSync(join(headDir, "assets/icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  return { ...structuredClone(branchFixture), headDir, ...over };
}

/** CoreDeps behind a proxy: reading any name that is not one of them (`gh`, `config`, `repoDir`) throws. */
function coreDeps(provider: FakeProvider) {
  const warnings: string[] = [];
  const target: CoreDeps = {
    provider,
    log: () => {},
    warn: (l: string) => void warnings.push(l),
    lineCounter: undefined,
    sleep: () => {},
    rateLimitBackoffMs: 0,
    git: undefined,
    now: undefined,
    costs: undefined,
    engineVersion: undefined,
  };
  const deps = new Proxy(target, {
    get(t, prop) {
      if (!(prop in t)) throw new Error(`the core reached for deps.${String(prop)}`);
      return Reflect.get(t, prop);
    },
    has: (t, prop) => prop in t,
  });
  return { deps, warnings };
}

const options = (over: Partial<ReviewOptions> = {}): ReviewOptions => ({ ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "0" }), 5), ...over });

/** The files a part's prompt lists, so a fake answer accounts for exactly them. */
const partFiles = (prompt: string) =>
  [...prompt.split("This part holds exactly these files")[1].split("\n\n")[0].matchAll(/^- (\S+) \+/gm)].map((m) => m[1]);

describe("the priority trial arm (spec decision 13 and 20)", () => {
  const prFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.pull-request.json"), "utf8"));
  const finding = { path: "src/a.ts", line: 2, severity: "fix" as const, topic: "bug" as const, confidence: "high" as const, title: "b is wrong", body: "It should be 3." };
  const review = async (change: ReviewInput["change"], over: Partial<ReviewOptions>) => {
    const provider = new FakeProvider([() => ({ structuredOutput: out({ files_reviewed: ["src/a.ts"], findings: [finding], summary: "s" }) })]);
    const input = { ...branchInput(), change };
    return reviewChange(input, options(over), coreDeps(provider).deps);
  };
  const pr = (n: number): ReviewInput["change"] => ({ ...prFixture.change, identifier: `#${n}` });

  test("with the trial off, a pull request review records no arm and every finding has its priority", async () => {
    const result = await review(pr(7), {});
    expect(result.arm).toBeUndefined();
    expect("arm" in result).toBe(false);
    expect(result.findings[0]).toMatchObject({ priority: "should", rank: 70, tier: "Important" });
  });

  test("with the trial on, a pull request review records the arm armFor gives, and priority is computed in both arms", async () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 12; n++) {
      const result = await review(pr(n), { priorityTrial: true });
      expect(result.arm).toBe(armFor("o/r", n));
      expect(result.findings[0]).toMatchObject({ priority: "should", rank: 70 });
      expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
      seen.add(result.arm as string);
    }
    expect([...seen].sort()).toEqual(["priority", "word"]);
  });

  test("a local review never records an arm, trial or not", async () => {
    const result = await review(branchInput().change, { priorityTrial: true });
    expect(result.arm).toBeUndefined();
  });

  test("a pull request without a number has no arm to hash", async () => {
    const { identifier: _dropped, ...noNumber } = pr(7) as { identifier?: string };
    expect((await review(noNumber as ReviewInput["change"], { priorityTrial: true })).arm).toBeUndefined();
  });
});

describe("the priority changes nothing the review decides (AC15)", () => {
  const prFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.pull-request.json"), "utf8"));
  // Illustrative findings that land on every priority, including a blocker the confidence caps.
  const findings = [
    { path: "src/a.ts", line: 1, severity: "blocker" as const, topic: "bug" as const, confidence: "high" as const, title: "one", body: "b" },
    { path: "src/a.ts", line: 2, severity: "blocker" as const, topic: "security" as const, confidence: "low" as const, title: "two", body: "b" },
    { path: "src/a.ts", line: 3, severity: "fix" as const, topic: "bug" as const, confidence: "medium" as const, title: "three", body: "b" },
    { path: "src/b.ts", line: 1, severity: "consider" as const, topic: "tests" as const, confidence: "low" as const, title: "four", body: "b" },
    { path: "src/b.ts", line: 2, severity: "info" as const, topic: "docs" as const, title: "five", body: "b" },
  ];
  const run = async (identifier: string, over: Partial<ReviewOptions>) => {
    const provider = new FakeProvider([() => ({ structuredOutput: out({ files_reviewed: ["src/a.ts", "src/b.ts"], findings, summary: "s" }) })]);
    const input = { ...branchInput(), change: { ...prFixture.change, identifier } };
    const result = await reviewChange(input, options(over), coreDeps(provider).deps);
    return { result, requests: provider.requests.map(({ prompt, allowedTools, maxBudgetUsd, maxTurns, outputSchema }) => ({ prompt: prompt.replace(/wachiman-review-\w+/g, "wachiman-review-TMP"), allowedTools, maxBudgetUsd, maxTurns, outputSchema })) };
  };
  const withoutPriority = (r: Awaited<ReturnType<typeof run>>["result"]) =>
    r.findings.map(({ priority: _p, rank: _r, ...rest }) => rest);
  const decisionOf = (r: Awaited<ReturnType<typeof run>>["result"]) => {
    const loop: LoopFinding[] = r.findings.map((f) => ({
      id: `${f.path}:${f.line}`,
      path: f.path,
      line: f.line,
      severity: f.severity,
      topic: f.topic,
      title: f.title,
      status: "new",
      refuted: false,
    }));
    return evaluate(loop);
  };

  test("the trial arms and the trial off make the same provider calls, find the same findings and reach the same stop-rule decision", async () => {
    const off = await run("#1", {});
    // 1 and 2 land in different arms (see armFor); the loop below asserts both are present.
    const arms = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => run(`#${n}`, { priorityTrial: true })));
    expect(new Set(arms.map((a) => a.result.arm))).toEqual(new Set(["word", "priority"]));
    for (const other of arms) {
      expect(other.requests).toEqual(off.requests);
      expect(other.result.findings.length).toBe(off.result.findings.length);
      expect(withoutPriority(other.result)).toEqual(withoutPriority(off.result));
      expect(other.result.findings.map((f) => [f.priority, f.rank])).toEqual(off.result.findings.map((f) => [f.priority, f.rank]));
      expect(decisionOf(other.result)).toEqual(decisionOf(off.result));
    }
    expect(off.requests.length).toBe(1);
    expect(decisionOf(off.result).converged).toBe(false);
  });

  test("the words follow the floors: a low-confidence blocker is capped at could, info is fyi", async () => {
    const { result } = await run("#1", {});
    expect(result.findings.map((f) => f.priority)).toEqual(["must", "could", "should", "could", "fyi"]);
  });

  test("the stop rule never reads a priority, a rank or an arm", () => {
    const source = readFileSync(join(ROOT, "src/loop/stop-rule.ts"), "utf8");
    expect(source).not.toMatch(/priority|rank|\barm\b/i);
  });
});

describe("reviewChange from a ReviewInput", () => {
  test("reviews a branch input end to end and never touches gh", async () => {
    const provider = new FakeProvider([
      () => ({
        costUsd: 0.2,
        turns: 4,
        structuredOutput: out({
          files_reviewed: ["src/a.ts"],
          findings: [
            { path: "src/a.ts", line: 2, severity: "fix", topic: "bug", confidence: "high", title: "b is wrong", body: "It should be 3." },
            { path: "src/a.ts", line: 0, severity: "consider", topic: "tests", confidence: "medium", title: "No test", body: "Add one." },
          ],
          summary: "One bug.",
        }),
      }),
    ]);
    const { deps } = coreDeps(provider);
    expect("gh" in deps).toBe(false);
    expect(() => (deps as unknown as { gh: unknown }).gh).toThrow("the core reached for deps.gh");
    const input = branchInput();
    const result = await reviewChange(input, options(), deps);

    expect(result.format).toBe("wachiman.review-result/2");
    expect(result.coverage).toEqual({
      // The engine, not the model, sets the binary icon aside: it is not expected, so the review is complete.
      expected: ["src/a.ts"],
      reviewed: ["src/a.ts"],
      skipped: [],
      excluded: 0,
      unreviewable: [{ path: "assets/icon.png", reason: "binary" }],
      partial: false,
    });
    expect(result.findings.map((f) => [f.line, f.anchor])).toEqual([
      [2, "diff"],
      [0, "outside"],
    ]);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].status).toBe("reviewed");
    expect(result.execution).toMatchObject({ calls: 1, callsWithOutput: 1, turns: 4, costUsdEstimate: 0.2, stop: "complete" });
    expect(result.execution.rejection).toBeUndefined();
    expect(result.provider).toEqual({ label: "Fake Model 1 via Fake CLI 0.1", model: options().model, effort: "high", profile: "ci" });
    expect(result.engine.version).toBe("unknown");
    expect(result.threadReplies).toEqual([]);
    expect(result.summary).toBe("One bug.");
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].prompt).toStartWith(
      "You are reviewing branch `feat/x` of repo against main (merge-base 1234567), checked out at its head commit",
    );
    expect(provider.requests[0].cwd).toBe(input.headDir);
  });

  test("the result survives JSON and validates against the result schema", async () => {
    const provider = new FakeProvider([
      () => ({
        costUsd: 0.1,
        structuredOutput: out({
          files_reviewed: ["src/a.ts"],
          findings: [{ path: "src/a.ts", line: 3, severity: "info", topic: "docs", title: "Note", body: "Fine." }],
          summary: "ok",
        }),
      }),
    ]);
    const result = await reviewChange(branchInput(), options(), coreDeps(provider).deps);
    const written = JSON.parse(JSON.stringify(result));
    expect(written).toEqual(result);
    expect(validate(resultSchema, written)).toEqual([]);
  });

  test("a stop with no output: budget, turns, timeout, error", async () => {
    const stopOf = async (answer: Partial<ProviderResult>) => {
      const provider = new FakeProvider([() => answer, () => answer]);
      const result = await reviewChange(branchInput(), options(), coreDeps(provider).deps);
      expect(result.execution.callsWithOutput).toBe(0);
      expect(result.findings).toEqual([]);
      expect(result.execution.calls).toBe(provider.requests.length);
      return result.execution;
    };
    expect((await stopOf({ terminalReason: "budget" })).stop).toBe("budget");
    expect((await stopOf({ terminalReason: "turns" })).stop).toBe("turns");
    expect((await stopOf({ terminalReason: "timeout" })).stop).toBe("timeout");
    const failed = await stopOf({ isError: true, terminalReason: "error", errorText: "boom" });
    expect(failed.stop).toBe("error");
    expect(failed.rejection).toEqual({ kind: "other", text: "boom" });
    const billing = await stopOf({ isError: true, terminalReason: "error", providerError: "billing", errorText: "credit balance too low" });
    expect(billing.stop).toBe("quota");
    expect(billing.rejection).toEqual({ kind: "billing", text: "credit balance too low" });
    expect(billing.calls).toBe(1);
    const auth = await stopOf({ isError: true, terminalReason: "error", providerError: "auth", errorText: "invalid x-api-key" });
    expect(auth.stop).toBe("error");
    expect(auth.rejection?.kind).toBe("auth");
  });

  test("budget spent after the first batch: the rest is not reached and partial is true", async () => {
    const input = branchInput({
      files: [
        { filename: "src/a.ts", additions: 2, deletions: 0, patch: "@@ -1,1 +1,3 @@\n const a = 1;\n+const b = 2;\n+const c = 3;" },
        { filename: "src/b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+export const d = 4;\n+export const e = 5;" },
      ],
    });
    const provider = new FakeProvider([
      (request) => ({ costUsd: 0.09, structuredOutput: out({ files_reviewed: partFiles(request.prompt), summary: "ok" }) }),
    ]);
    const result = await reviewChange(input, options({ batchLines: 1, totalBudgetUsd: 0.1 }), coreDeps(provider).deps);
    expect(provider.requests).toHaveLength(1);
    const first = partFiles(provider.requests[0].prompt);
    const second = ["src/a.ts", "src/b.ts"].filter((f) => !first.includes(f));
    expect(second).toHaveLength(1);
    expect(result.batches.map((b) => b.status)).toEqual(["reviewed", "not run: budget spent"]);
    expect(result.coverage.skipped).toEqual([{ path: second[0], reason: "not reached: the pull request's budget was spent" }]);
    expect(result.coverage.partial).toBe(true);
    expect(result.execution.stop).toBe("complete");
  });

  test("an unknown format is a usage error before any call", async () => {
    const provider = new FakeProvider([]);
    const input = { ...branchInput(), format: "wachiman.review-input/3" } as unknown as ReviewInput;
    await expect(reviewChange(input, options(), coreDeps(provider).deps)).rejects.toThrow(UsageError);
    expect(provider.requests).toEqual([]);
  });

  test("a scope that matches nothing reviews nothing and calls nothing", async () => {
    const provider = new FakeProvider([]);
    const result = await reviewChange(branchInput({ scope: ["nope/"] }), options(), coreDeps(provider).deps);
    expect(result.coverage.expected).toEqual([]);
    // Out-of-scope files are not counted as excluded: only the exclude globs' drops are.
    expect(result.coverage.excluded).toBe(0);
    expect(result.execution).toMatchObject({ calls: 0, callsWithOutput: 0, stop: "complete" });
    expect(provider.requests).toEqual([]);
  });

  test("conversation ids the model did not get are dropped from threadReplies", async () => {
    const thread: Thread = { comment_id: 11, path: "src/a.ts", line: 2, finding: "b is wrong", replies: [] };
    const provider = new FakeProvider([
      () => ({
        structuredOutput: out({
          files_reviewed: ["src/a.ts"],
          thread_replies: [
            { comment_id: 11, status: "addressed", reply: "Fixed at src/a.ts:2." },
            { comment_id: 99, status: "still_open", reply: "Made up." },
          ],
          summary: "ok",
        }),
      }),
    ]);
    const result = await reviewChange(branchInput({ conversation: [thread] }), options(), coreDeps(provider).deps);
    expect(result.threadReplies).toEqual([{ comment_id: 11, status: "addressed", reply: "Fixed at src/a.ts:2." }]);
    expect(provider.requests[0].prompt).toContain("threads.json");
  });
});

// The one behaviour change of the extraction: each batch's run directory (pr.json, threads.json,
// evidence.json) holds the reviewed change's text and is removed after its call, on every path.
describe("the run directory", () => {
  const twoFiles = (): Partial<ReviewInput> => ({
    files: [
      { filename: "src/a.ts", additions: 2, deletions: 0, patch: "@@ -1,1 +1,3 @@\n const a = 1;\n+const b = 2;\n+const c = 3;" },
    ],
  });

  test("the run directory is removed after the call, on success", async () => {
    const during: boolean[] = [];
    const provider = new FakeProvider([
      (request) => {
        const dir = request.addDirs[0];
        during.push(["pr.json", "threads.json", "evidence.json"].every((f) => existsSync(join(dir, f))));
        return { structuredOutput: out({ files_reviewed: ["src/a.ts"], summary: "ok" }) };
      },
    ]);
    const result = await reviewChange(branchInput(twoFiles()), options(), coreDeps(provider).deps);
    expect(result.execution.stop).toBe("complete");
    expect(during).toEqual([true]);
    expect(existsSync(provider.requests[0].addDirs[0])).toBe(false);
  });

  test("the run directory is removed when the provider throws", async () => {
    const during: boolean[] = [];
    const dies = (request: ProviderRequest): Partial<ProviderResult> => {
      during.push(existsSync(request.addDirs[0]));
      throw new Error("the CLI died");
    };
    // The first call and its one retry both throw.
    const provider = new FakeProvider([dies, dies]);
    const result = await reviewChange(branchInput(twoFiles()), options(), coreDeps(provider).deps);
    expect(result.execution).toMatchObject({ calls: 2, callsWithOutput: 0, stop: "error" });
    expect(during).toEqual([true, true]);
    expect(provider.requests).toHaveLength(2);
    for (const request of provider.requests) expect(existsSync(request.addDirs[0])).toBe(false);
  });
});
