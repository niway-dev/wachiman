import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError, loadConfig } from "./config";
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
  run(request: ProviderRequest): ProviderResult {
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
const resultSchema = JSON.parse(readFileSync(join(ROOT, "docs/formats/review-result.v1.schema.json"), "utf8"));
const branchFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.branch.json"), "utf8"));

/** The branch fixture, with a head directory holding the files its patches describe. */
function branchInput(over: Partial<ReviewInput> = {}): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "core-head-"));
  mkdirSync(join(headDir, "src"));
  mkdirSync(join(headDir, "assets"));
  writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  writeFileSync(join(headDir, "src/b.ts"), "export const d = 4;\nexport const e = 5;\n");
  writeFileSync(join(headDir, "assets/icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
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

const options = (over: Partial<ReviewOptions> = {}): ReviewOptions => ({ ...reviewOptionsOf(loadConfig({}), 5), ...over });

/** The files a part's prompt lists, so a fake answer accounts for exactly them. */
const partFiles = (prompt: string) =>
  [...prompt.split("This part holds exactly these files")[1].split("\n\n")[0].matchAll(/^- (\S+) \+/gm)].map((m) => m[1]);

describe("reviewChange from a ReviewInput", () => {
  test("reviews a branch input end to end and never touches gh", () => {
    const provider = new FakeProvider([
      () => ({
        costUsd: 0.2,
        turns: 4,
        structuredOutput: out({
          files_reviewed: ["src/a.ts"],
          files_skipped: [{ path: "assets/icon.png", reason: "binary" }],
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
    const result = reviewChange(input, options(), deps);

    expect(result.format).toBe("wachiman.review-result/1");
    expect(result.coverage).toEqual({
      expected: ["src/a.ts", "assets/icon.png"],
      reviewed: ["src/a.ts"],
      skipped: [{ path: "assets/icon.png", reason: "binary" }],
      excluded: 0,
      partial: true,
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

  test("the result survives JSON and validates against the result schema", () => {
    const provider = new FakeProvider([
      () => ({
        costUsd: 0.1,
        structuredOutput: out({
          files_reviewed: ["src/a.ts"],
          files_skipped: [{ path: "assets/icon.png", reason: "binary" }],
          findings: [{ path: "src/a.ts", line: 3, severity: "info", topic: "docs", title: "Note", body: "Fine." }],
          summary: "ok",
        }),
      }),
    ]);
    const result = reviewChange(branchInput(), options(), coreDeps(provider).deps);
    const written = JSON.parse(JSON.stringify(result));
    expect(written).toEqual(result);
    expect(validate(resultSchema, written)).toEqual([]);
  });

  test("a stop with no output: budget, turns, timeout, error", () => {
    const stopOf = (answer: Partial<ProviderResult>) => {
      const provider = new FakeProvider([() => answer, () => answer]);
      const result = reviewChange(branchInput(), options(), coreDeps(provider).deps);
      expect(result.execution.callsWithOutput).toBe(0);
      expect(result.findings).toEqual([]);
      expect(result.execution.calls).toBe(provider.requests.length);
      return result.execution;
    };
    expect(stopOf({ terminalReason: "budget" }).stop).toBe("budget");
    expect(stopOf({ terminalReason: "turns" }).stop).toBe("turns");
    expect(stopOf({ terminalReason: "timeout" }).stop).toBe("timeout");
    const failed = stopOf({ isError: true, terminalReason: "error", errorText: "boom" });
    expect(failed.stop).toBe("error");
    expect(failed.rejection).toEqual({ kind: "other", text: "boom" });
    const billing = stopOf({ isError: true, terminalReason: "error", providerError: "billing", errorText: "credit balance too low" });
    expect(billing.stop).toBe("quota");
    expect(billing.rejection).toEqual({ kind: "billing", text: "credit balance too low" });
    expect(billing.calls).toBe(1);
    const auth = stopOf({ isError: true, terminalReason: "error", providerError: "auth", errorText: "invalid x-api-key" });
    expect(auth.stop).toBe("error");
    expect(auth.rejection?.kind).toBe("auth");
  });

  test("budget spent after the first batch: the rest is not reached and partial is true", () => {
    const input = branchInput({
      files: [
        { filename: "src/a.ts", additions: 2, deletions: 0, patch: "@@ -1,1 +1,3 @@\n const a = 1;\n+const b = 2;\n+const c = 3;" },
        { filename: "src/b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+export const d = 4;\n+export const e = 5;" },
      ],
    });
    const provider = new FakeProvider([
      (request) => ({ costUsd: 0.09, structuredOutput: out({ files_reviewed: partFiles(request.prompt), summary: "ok" }) }),
    ]);
    const result = reviewChange(input, options({ batchLines: 1, totalBudgetUsd: 0.1 }), coreDeps(provider).deps);
    expect(provider.requests).toHaveLength(1);
    const first = partFiles(provider.requests[0].prompt);
    const second = ["src/a.ts", "src/b.ts"].filter((f) => !first.includes(f));
    expect(second).toHaveLength(1);
    expect(result.batches.map((b) => b.status)).toEqual(["reviewed", "not run: budget spent"]);
    expect(result.coverage.skipped).toEqual([{ path: second[0], reason: "not reached: the pull request's budget was spent" }]);
    expect(result.coverage.partial).toBe(true);
    expect(result.execution.stop).toBe("complete");
  });

  test("an unknown format is a usage error before any call", () => {
    const provider = new FakeProvider([]);
    const input = { ...branchInput(), format: "wachiman.review-input/2" } as unknown as ReviewInput;
    expect(() => reviewChange(input, options(), coreDeps(provider).deps)).toThrow(UsageError);
    expect(provider.requests).toEqual([]);
  });

  test("a scope that matches nothing reviews nothing and calls nothing", () => {
    const provider = new FakeProvider([]);
    const result = reviewChange(branchInput({ scope: ["nope/"] }), options(), coreDeps(provider).deps);
    expect(result.coverage.expected).toEqual([]);
    // Out-of-scope files are not counted as excluded: only the exclude globs' drops are.
    expect(result.coverage.excluded).toBe(0);
    expect(result.execution).toMatchObject({ calls: 0, callsWithOutput: 0, stop: "complete" });
    expect(provider.requests).toEqual([]);
  });

  test("conversation ids the model did not get are dropped from threadReplies", () => {
    const thread: Thread = { comment_id: 11, path: "src/a.ts", line: 2, finding: "b is wrong", replies: [] };
    const provider = new FakeProvider([
      () => ({
        structuredOutput: out({
          files_reviewed: ["src/a.ts"],
          files_skipped: [{ path: "assets/icon.png", reason: "binary" }],
          thread_replies: [
            { comment_id: 11, status: "addressed", reply: "Fixed at src/a.ts:2." },
            { comment_id: 99, status: "still_open", reply: "Made up." },
          ],
          summary: "ok",
        }),
      }),
    ]);
    const result = reviewChange(branchInput({ conversation: [thread] }), options(), coreDeps(provider).deps);
    expect(result.threadReplies).toEqual([{ comment_id: 11, status: "addressed", reply: "Fixed at src/a.ts:2." }]);
    expect(provider.requests[0].prompt).toContain("threads.json");
  });
});
