import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  githubReview,
  reviewChange,
  reviewOptionsOf,
  type CoreDeps,
  type Finding,
  type ReviewInput,
  type ReviewOptions,
  type ReviewOutput,
} from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { validate } from "../test/support/json-schema";

// ADR 0027: the verifier through the review core, with a fake provider. One test per acceptance
// criterion of the spec (docs/specs/2026-11-08-findings-verifier-design.md).

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(
    private readonly script: ((request: ProviderRequest) => Partial<ProviderResult>)[],
    private readonly label = "Fake Model 1 via Fake CLI 0.1",
  ) {}
  preflight() {}
  modelLabel() {
    return this.label;
  }
  leaksSecret() {
    return false;
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

function branchInput(): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "verify-head-"));
  mkdirSync(join(headDir, "src"));
  mkdirSync(join(headDir, "assets"));
  writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  writeFileSync(join(headDir, "src/b.ts"), "export const d = 4;\nexport const e = 5;\n");
  writeFileSync(join(headDir, "assets/icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  return { ...structuredClone(branchFixture), headDir };
}

function deps(provider: FakeProvider, verifier?: FakeProvider) {
  const warnings: string[] = [];
  const logs: string[] = [];
  const d: CoreDeps = { provider, ...(verifier ? { verifier } : {}), log: (l) => void logs.push(l), warn: (l) => void warnings.push(l), sleep: () => {}, rateLimitBackoffMs: 0 };
  return { deps: d, warnings, logs };
}

const options = (over: Partial<ReviewOptions> = {}): ReviewOptions => ({
  ...reviewOptionsOf(loadConfig({ AGENT_REVIEW_VERIFY: "1" }), 5),
  ...over,
});

const finding = (over: Partial<Finding>): Finding => ({
  path: "src/a.ts",
  line: 2,
  severity: "fix",
  topic: "bug",
  confidence: "high",
  title: "t",
  body: "b",
  ...over,
});

const three = [
  finding({ line: 2, title: "b is wrong", severity: "fix" }),
  finding({ line: 3, title: "c is wrong", severity: "fix" }),
  finding({ line: 1, title: "a is odd", severity: "fix", topic: "cleanup" }),
];

const batch = (findings: Finding[], costUsd = 0.2) => () => ({
  costUsd,
  structuredOutput: out({ files_reviewed: ["src/a.ts"], findings, summary: "s" }),
});

describe("the verifier through the review core", () => {
  test("drops a refuted finding with a real disproof, degrades one whose disproof does not exist, moves a confirmed one", () => {
    const provider = new FakeProvider([batch(three)]);
    const verifier = new FakeProvider(
      [
        () => ({
          costUsd: 0.3,
          structuredOutput: {
            verdicts: [
              { id: "c1", verdict: "refuted", reason: "b is checked on line 1", checked: [{ path: "src/a.ts", line: 1 }], disproof: { path: "src/a.ts", line: 1 } },
              { id: "c2", verdict: "refuted", reason: "see the guard", checked: [], disproof: { path: "src/a.ts", line: 99 } },
              { id: "c3", verdict: "confirmed", reason: "true but minor", checked: [{ path: "src/a.ts", line: 1 }], severity: "consider" },
            ],
          },
        }),
      ],
      "Fake Verifier 9 via Fake CLI 0.1",
    );
    const { deps: d } = deps(provider, verifier);
    const result = reviewChange(branchInput(), options(), d);

    expect(result.findings.map((f) => [f.line, f.severity, f.topic, f.confidence])).toEqual([
      // The refutation pointing at a line that does not exist counts as doubt: low confidence, so a fix becomes a question.
      [3, "fix", "question", "low"],
      [1, "consider", "cleanup", "high"],
    ]);
    expect(result.verification).toMatchObject({ status: "verified", model: "claude-opus-5-5", effort: "high", label: "Fake Verifier 9 via Fake CLI 0.1", costUsd: 0.3, dropped: 1 });
    expect(result.verification?.entries.map((e) => [e.id, e.verdict, e.claimed, e.outcome])).toEqual([
      ["c1", "refuted", undefined, "dropped"],
      ["c2", "unconfirmed", "refuted", "degraded"],
      ["c3", "confirmed", undefined, "moved"],
    ]);
    // The verifier is its own call on its own adapter; its cost is the review's.
    expect(provider.requests).toHaveLength(1);
    expect(verifier.requests).toHaveLength(1);
    expect(verifier.requests[0].outputSchema).toBeDefined();
    expect(verifier.requests[0].allowedTools).toEqual(["read", "glob", "grep"]);
    expect(verifier.requests[0].prompt).toContain('<candidate id="c1" severity="fix" topic="bug" confidence="high" at="src/a.ts:2">');
    expect(verifier.requests[0].prompt).toContain("2  const b = 2;");
    expect(verifier.requests[0].prompt).toContain('<file-diff path="src/a.ts">');
    expect(result.execution.costUsdEstimate).toBeCloseTo(0.5);
    expect(result.execution.calls).toBe(2);
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);

    const review = githubReview(result, { since: null, rebased: false, scoped: false, mention: "/wachiman", automatic: false, instructionChanges: { files: [], baseSha: "b".repeat(40) } });
    expect(review.body).toContain("verified by Fake Verifier 9 via Fake CLI 0.1: 1 dropped, 1 unconfirmed, $0.30");
    expect(review.body).not.toContain("b is wrong");
  });

  test("a failed verifier call posts every finding unverified and says so", () => {
    const provider = new FakeProvider([batch(three), () => ({ isError: true, terminalReason: "error", errorText: "overloaded", costUsd: 0.05 })]);
    const { deps: d, warnings } = deps(provider);
    const result = reviewChange(branchInput(), options(), d);

    expect(result.findings.map((f) => [f.line, f.severity, f.confidence])).toEqual([
      [2, "fix", "high"],
      [3, "fix", "high"],
      [1, "fix", "high"],
    ]);
    expect(result.verification).toMatchObject({ status: "failed", dropped: 0, costUsd: 0.05 });
    expect(warnings.some((w) => w.includes("posted unverified"))).toBe(true);
    const review = githubReview(result, { since: null, rebased: false, scoped: false, mention: "/wachiman", automatic: false, instructionChanges: { files: [], baseSha: "b".repeat(40) } });
    expect(review.body).toContain("**Not verified**");
    expect(review.body).toContain("verification failed");
  });

  test("a verifier call that throws is counted at its cap and the review still posts", () => {
    const provider = new FakeProvider([batch(three)]);
    const { deps: d } = deps(provider);
    const result = reviewChange(branchInput(), options({ totalBudgetUsd: 2 }), d);
    expect(result.findings).toHaveLength(3);
    expect(result.verification?.status).toBe("failed");
    // The batches had 2 − 1 (the reserve); the verifier got what was left: 2 − 0.2.
    expect(result.verification?.costUsd).toBeCloseTo(1.8);
  });

  test("the reserve is taken before the batches: when they cannot run past it, the verifier still runs", () => {
    // $1 in total: the reserve is half, $0.50. The first batch spends exactly that, so the second
    // is not reached, and the verifier gets what is left of the total.
    const twoFiles = branchInput();
    twoFiles.files.push({ filename: "src/b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+export const d = 4;\n+export const e = 5;" });
    const provider = new FakeProvider([batch([finding({})], 0.5)]);
    const verifier = new FakeProvider([(r) => ({ costUsd: 0.1, structuredOutput: { verdicts: [{ id: "c1", verdict: "confirmed", reason: "yes", checked: [] }] }, raw: r.maxBudgetUsd })]);
    const { deps: d } = deps(provider, verifier);
    const result = reviewChange(twoFiles, options({ totalBudgetUsd: 1, batchLines: 1 }), d);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].maxBudgetUsd).toBeCloseTo(0.5);
    expect(result.batches.map((b) => b.status)).toEqual(["reviewed", "not run: budget spent"]);
    expect(verifier.requests).toHaveLength(1);
    expect(verifier.requests[0].maxBudgetUsd).toBeCloseTo(0.5);
    expect(result.verification?.status).toBe("verified");
  });

  test("no finding above info: no verifier call, no cost", () => {
    const provider = new FakeProvider([batch([finding({ severity: "info", topic: "docs" })])]);
    const { deps: d } = deps(provider);
    const result = reviewChange(branchInput(), options(), d);
    expect(provider.requests).toHaveLength(1);
    expect(result.verification).toMatchObject({ status: "nothing", costUsd: 0, entries: [] });
    expect(result.execution.costUsdEstimate).toBeCloseTo(0.2);
    const review = githubReview(result, { since: null, rebased: false, scoped: false, mention: "/wachiman", automatic: false, instructionChanges: { files: [], baseSha: "b".repeat(40) } });
    expect(review.body).not.toContain("verif");
  });

  test("a finding the verifier left unconfirmed collapses with a question already on its line", () => {
    const provider = new FakeProvider([
      batch([finding({ line: 2, title: "b is wrong" }), finding({ line: 2, title: "is b meant?", topic: "question", severity: "consider" })]),
    ]);
    const verifier = new FakeProvider([
      () => ({ structuredOutput: { verdicts: [{ id: "c1", verdict: "unconfirmed", reason: "cannot tell", checked: [] }, { id: "c2", verdict: "confirmed", reason: "yes", checked: [] }] } }),
    ]);
    const { deps: d } = deps(provider, verifier);
    const result = reviewChange(branchInput(), options(), d);
    expect(result.findings.map((f) => [f.line, f.topic, f.severity, f.title])).toEqual([[2, "question", "fix", "b is wrong"]]);
  });

  test("after the provider refused a batch, the verifier is not called and the record says why", () => {
    const twoFiles = branchInput();
    twoFiles.files.push({ filename: "src/b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+export const d = 4;\n+export const e = 5;" });
    const credit = "API Error: 400 Your credit balance is too low to access the Anthropic API.";
    const provider = new FakeProvider([
      batch([finding({})]),
      () => ({ isError: true, terminalReason: "error", turns: 1, errorText: credit, providerError: "billing" }),
    ]);
    const verifier = new FakeProvider([]);
    const { deps: d } = deps(provider, verifier);
    const result = reviewChange(twoFiles, options({ batchLines: 1 }), d);
    expect(verifier.requests).toHaveLength(0);
    expect(result.verification).toMatchObject({ status: "failed", costUsd: 0 });
    expect(result.verification?.detail).toContain("credit balance");
    expect(result.findings).toHaveLength(1);
  });

  test("off by default: no reserve, no call, no verification block", () => {
    const provider = new FakeProvider([batch(three)]);
    const { deps: d } = deps(provider);
    const result = reviewChange(branchInput(), reviewOptionsOf(loadConfig({}), 5), d);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].maxBudgetUsd).toBeCloseTo(0.75);
    expect(result.verification).toBeUndefined();
    expect(result.findings).toHaveLength(3);
  });
});
