import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { toResultV1 } from "./formats";
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

// ADR 0027 and ADR 0030: the verifier through the review core, with a fake provider. One test per
// verifier acceptance check in docs/specs/2026-11-09-review-and-config-types.md.

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
const resultSchema = JSON.parse(readFileSync(join(ROOT, "docs/formats/review-result.v2.schema.json"), "utf8"));
const resultV1Schema = JSON.parse(readFileSync(join(ROOT, "docs/formats/review-result.v1.schema.json"), "utf8"));
const branchFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.branch.json"), "utf8"));

function branchInput(): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "verify-head-"));
  mkdirSync(join(headDir, "src"));
  mkdirSync(join(headDir, "assets"));
  writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\nconst f = 6;\n");
  writeFileSync(join(headDir, "src/b.ts"), "export const d = 4;\nexport const e = 5;\n");
  writeFileSync(join(headDir, "assets/icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  return { ...structuredClone(branchFixture), headDir };
}

/** A base snapshot that records how often it was made and released. */
function baseSnapshot() {
  const dir = mkdtempSync(join(tmpdir(), "verify-base-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), "const a = 0;\nconst b = 2;\nconst c = 3;\n");
  const made = { acquired: 0, released: 0, dir };
  return { made, make: () => (made.acquired++, { dir, release: () => void made.released++ }) };
}

function deps(provider: FakeProvider, verifier?: FakeProvider, base?: CoreDeps["baseSnapshot"]) {
  const warnings: string[] = [];
  const logs: string[] = [];
  const d: CoreDeps = { provider, ...(verifier ? { verifier } : {}), ...(base ? { baseSnapshot: base } : {}), log: (l) => void logs.push(l), warn: (l) => void warnings.push(l), sleep: () => {}, rateLimitBackoffMs: 0 };
  return { deps: d, warnings, logs };
}

const options = (over: Partial<ReviewOptions> = {}): ReviewOptions => ({
  ...reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "1" }), 5),
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

/** Five findings, one per outcome the slice must show. */
const five = [
  finding({ line: 1, title: "a is refuted" }),
  finding({ line: 2, title: "b has a bad disproof" }),
  finding({ line: 3, title: "c is old" }),
  finding({ line: 4, title: "d is minor" }),
  finding({ line: 5, title: "e got no verdict" }),
];

const asVerifier = (verdicts: unknown[], over: Partial<ProviderResult> = {}) => () => ({ costUsd: 0.3, structuredOutput: { verdicts }, ...over });
const review = (result: ReturnType<typeof reviewChange>) =>
  githubReview(result, { since: null, rebased: false, scoped: false, mention: "/wachiman", automatic: false, instructionChanges: { files: [], baseSha: "b".repeat(40) } });

const batch = (findings: Finding[], costUsd = 0.2) => () => ({
  costUsd,
  structuredOutput: out({ files_reviewed: ["src/a.ts"], findings, summary: "s" }),
});

describe("the verifier through the review core", () => {
  test("five candidates: drops a proved refutation, degrades a bad one, marks pre-existing, moves a severity, leaves the unanswered inconclusive", () => {
    const provider = new FakeProvider([batch(five)]);
    const verifier = new FakeProvider(
      [
        asVerifier([
          { id: "c1", verdict: "refuted", reason: "a is set on line 1", checked: [{ snapshot: "head", path: "src/a.ts", line: 1 }], disproof: { snapshot: "head", path: "src/a.ts", line: 1 } },
          { id: "c2", verdict: "refuted", reason: "see the guard", checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }], disproof: { snapshot: "head", path: "src/a.ts", line: 99 } },
          {
            id: "c3",
            verdict: "supported",
            reason: "c is wrong",
            checked: [{ snapshot: "head", path: "src/a.ts", line: 3 }],
            origin: "pre-existing",
            originReason: "the same line is in the base",
            originEvidence: [{ snapshot: "base", path: "src/a.ts", line: 3 }],
          },
          { id: "c4", verdict: "supported", reason: "true but minor", checked: [{ snapshot: "head", path: "src/a.ts", line: 4 }], severity: "consider" },
        ]),
      ],
      "Fake Verifier 9 via Fake CLI 0.1",
    );
    const base = baseSnapshot();
    const { deps: d } = deps(provider, verifier, base.make);
    const result = reviewChange(branchInput(), options(), d);

    expect(result.format).toBe("wachiman.review-result/2");
    // The proved refutation is gone; the bad one counts as doubt (low confidence, so a fix becomes a question).
    expect(result.findings.map((f) => [f.line, f.severity, f.topic, f.confidence, f.verification.status, f.origin, f.tier])).toEqual([
      [2, "fix", "question", "low", "inconclusive", "unknown", "Important"],
      [3, "fix", "bug", "high", "supported", "pre-existing", "Pre-existing"],
      [4, "consider", "bug", "high", "supported", "unknown", "Nit"],
      [5, "fix", "question", "low", "inconclusive", "unknown", "Important"],
    ]);
    expect(result.findings[0].verification).toMatchObject({ claimed: "refuted" });
    expect(result.findings[3].verification.reason).toStartWith("not verified:");
    expect(result.verification).toMatchObject({ status: "partial", costUsd: 0.3, dropped: 1, inconclusive: 2, label: "Fake Verifier 9 via Fake CLI 0.1" });
    expect(result.verification?.entries.map((e) => [e.id, e.status, e.claimed, e.outcome, e.origin])).toEqual([
      ["c1", "refuted", undefined, "dropped", "unknown"],
      ["c2", "inconclusive", "refuted", "degraded", "unknown"],
      ["c3", "supported", undefined, "kept", "pre-existing"],
      ["c4", "supported", undefined, "moved", "unknown"],
      ["c5", "inconclusive", "none", "degraded", "unknown"],
    ]);

    // The verifier is its own call on its own adapter; it can read the head and the base; its cost is the review's.
    expect(provider.requests).toHaveLength(1);
    expect(verifier.requests).toHaveLength(1);
    expect(verifier.requests[0].allowedTools).toEqual(["read", "glob", "grep"]);
    expect(verifier.requests[0].addDirs).toContain(base.made.dir);
    expect(verifier.requests[0].prompt).toContain("read-only copy of the base commit");
    expect(verifier.requests[0].prompt).toContain('<candidate id="c1" severity="fix" topic="bug" confidence="high" at="src/a.ts:1">');
    expect(base.made).toMatchObject({ acquired: 1, released: 1 });
    expect(result.execution.costUsdEstimate).toBeCloseTo(0.5);
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
    expect(validate(resultV1Schema, JSON.parse(JSON.stringify(toResultV1(result))))).toEqual([]);

    expect(review(result).body).not.toContain("a is refuted");
  });

  test("a verifier stop keeps the verdicts it returned and marks every other candidate not verified", () => {
    const provider = new FakeProvider([batch(five)]);
    const verifier = new FakeProvider([
      asVerifier(
        [
          { id: "c1", verdict: "supported", reason: "yes", checked: [{ snapshot: "head", path: "src/a.ts", line: 1 }] },
          { id: "c2", verdict: "supported", reason: "yes", checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }] },
        ],
        { terminalReason: "budget", isError: true },
      ),
    ]);
    const { deps: d } = deps(provider, verifier);
    const result = reviewChange(branchInput(), options(), d);

    expect(result.verification).toMatchObject({ status: "partial", stop: { kind: "budget" }, dropped: 0, inconclusive: 3 });
    expect(result.verification?.entries.map((e) => [e.id, e.status])).toEqual([
      ["c1", "supported"],
      ["c2", "supported"],
      ["c3", "inconclusive"],
      ["c4", "inconclusive"],
      ["c5", "inconclusive"],
    ]);
    expect(result.verification?.entries.slice(2).every((e) => e.reason === "not verified: budget")).toBe(true);
    // A stop is not doubt: the unanswered findings keep their severity and confidence.
    expect(result.findings.map((f) => [f.severity, f.confidence])).toEqual(five.map(() => ["fix", "high"]));
    const body = review(result).body;
    expect(body).toContain("partly verified by Fake Model 1 via Fake CLI 0.1 (stopped: budget): 0 dropped, 3 inconclusive");
    expect(body).toContain("**Partly verified**");
  });

  test("a failed verifier call posts every finding unverified and says so", () => {
    const provider = new FakeProvider([batch(three), () => ({ isError: true, terminalReason: "error", errorText: "overloaded", costUsd: 0.05 })]);
    const { deps: d, warnings } = deps(provider);
    const result = reviewChange(branchInput(), options(), d);

    expect(result.findings.map((f) => [f.line, f.severity, f.confidence, f.verification.status])).toEqual([
      [2, "fix", "high", "inconclusive"],
      [3, "fix", "high", "inconclusive"],
      [1, "fix", "high", "inconclusive"],
    ]);
    expect(result.verification).toMatchObject({ status: "failed", dropped: 0, inconclusive: 3, costUsd: 0.05, stop: { kind: "error" } });
    expect(result.verification?.entries.every((e) => e.reason === "not verified: error")).toBe(true);
    expect(warnings.some((w) => w.includes("posted unverified"))).toBe(true);
    const body = review(result).body;
    expect(body).toContain("**Not verified**");
    expect(body).toContain("verification failed");
  });

  test("a rate-limit or billing stop is a quota stop", () => {
    const provider = new FakeProvider([batch(three), () => ({ isError: true, terminalReason: "error", providerError: "rate_limit", errorText: "slow down", costUsd: 0 })]);
    const result = reviewChange(branchInput(), options(), deps(provider).deps);
    expect(result.verification).toMatchObject({ status: "failed", stop: { kind: "quota" } });
  });

  test("an answer that is not a verdict list is failed, not salvaged", () => {
    const provider = new FakeProvider([batch(three), () => ({ costUsd: 0.1, structuredOutput: { verdicts: "c1: supported" } })]);
    const result = reviewChange(branchInput(), options(), deps(provider).deps);
    expect(result.verification?.status).toBe("failed");
    expect(result.findings).toHaveLength(3);
  });

  test("a schema-invalid envelope is not used, even when it carries a valid refutation", () => {
    const provider = new FakeProvider([batch(three)]);
    const refutation = { id: "c1", verdict: "refuted", reason: "b is set on line 2", checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }], disproof: { snapshot: "head", path: "src/a.ts", line: 2 } };
    const verifier = new FakeProvider([() => ({ costUsd: 0.2, structuredOutput: { verdicts: [refutation], notes: "an extra field the schema forbids" } })]);
    const result = reviewChange(branchInput(), options(), deps(provider, verifier).deps);
    expect(result.verification).toMatchObject({ status: "failed", dropped: 0, inconclusive: 3 });
    expect(result.findings).toHaveLength(3);
    // The same envelope without the violation does drop the finding.
    const clean = new FakeProvider([() => ({ costUsd: 0.2, structuredOutput: { verdicts: [refutation] } })]);
    expect(reviewChange(branchInput(), options(), deps(new FakeProvider([batch(three)]), clean).deps).verification?.dropped).toBe(1);
    // A wrong enum inside one verdict also voids the whole envelope.
    const wrongEnum = new FakeProvider([() => ({ costUsd: 0.2, structuredOutput: { verdicts: [refutation, { id: "c2", verdict: "maybe", reason: "x", checked: [] }] } })]);
    const second = reviewChange(branchInput(), options(), deps(new FakeProvider([batch(three)]), wrongEnum).deps);
    expect(second.verification).toMatchObject({ status: "failed", dropped: 0 });
    expect(second.findings).toHaveLength(3);
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

  test("no budget left: skipped, findings posted unverified, no call", () => {
    const provider = new FakeProvider([batch(three, 0.98)]);
    const verifier = new FakeProvider([asVerifier([])]);
    const { deps: d } = deps(provider, verifier);
    const result = reviewChange(branchInput(), options({ totalBudgetUsd: 1 }), d);
    expect(verifier.requests).toHaveLength(0);
    expect(result.verification).toMatchObject({ status: "skipped", costUsd: 0, stop: { kind: "budget" } });
    expect(result.findings.every((f) => f.verification.status === "inconclusive")).toBe(true);
  });

  test("the base snapshot is made lazily, once, and released even when the call fails", () => {
    const none = baseSnapshot();
    const noFindings = new FakeProvider([batch([finding({ severity: "info", topic: "docs" })])]);
    reviewChange(branchInput(), options(), deps(noFindings, undefined, none.make).deps);
    expect(none.made.acquired).toBe(0);

    const failing = baseSnapshot();
    const provider = new FakeProvider([batch(three), () => ({ isError: true, terminalReason: "error", errorText: "boom" })]);
    reviewChange(branchInput(), options(), deps(provider, undefined, failing.make).deps);
    expect(failing.made).toMatchObject({ acquired: 1, released: 1 });
  });

  test("the base snapshot is released when the verifier's temp directory cannot be made", () => {
    const leaking = baseSnapshot();
    const provider = new FakeProvider([batch(three)]);
    const before = process.env.TMPDIR;
    // Acquiring the snapshot breaks the temp directory, so the next step (mkdtemp) throws.
    const make = () => {
      const snap = leaking.make();
      process.env.TMPDIR = join(snap.dir, "missing", "tmp");
      return snap;
    };
    try {
      expect(() => reviewChange(branchInput(), options(), deps(provider, undefined, make).deps)).toThrow();
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
    expect(leaking.made).toMatchObject({ acquired: 1, released: 1 });
  });

  test("a base snapshot that cannot be made warns and the review goes on without base evidence", () => {
    const provider = new FakeProvider([batch(three)]);
    const verifier = new FakeProvider([
      asVerifier([
        {
          id: "c1",
          verdict: "supported",
          reason: "yes",
          checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }],
          origin: "pre-existing",
          originReason: "old",
          originEvidence: [{ snapshot: "base", path: "src/a.ts", line: 2 }],
        },
      ]),
    ]);
    const { deps: d, warnings } = deps(provider, verifier, () => {
      throw new Error("git is gone");
    });
    const result = reviewChange(branchInput(), options(), d);
    expect(warnings.some((w) => w.includes("base snapshot could not be made"))).toBe(true);
    expect(verifier.requests[0].prompt).toContain("base snapshot is not available");
    // No base to cite: the pre-existing claim is not accepted.
    expect(result.findings[0]).toMatchObject({ origin: "unknown", tier: "Important" });
  });

  test("a disproof that leaves the snapshot through a symlink is not accepted", () => {
    const input = branchInput();
    const outside = mkdtempSync(join(tmpdir(), "verify-outside-"));
    writeFileSync(join(outside, "secret.ts"), "x\n".repeat(50));
    symlinkSync(join(outside, "secret.ts"), join(input.headDir as string, "src/link.ts"));
    expect(existsSync(join(input.headDir as string, "src/link.ts"))).toBe(true);
    const provider = new FakeProvider([batch([finding({ line: 2 })])]);
    const verifier = new FakeProvider([
      asVerifier([{ id: "c1", verdict: "refuted", reason: "guarded", checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }], disproof: { snapshot: "head", path: "src/link.ts", line: 10 } }]),
    ]);
    const result = reviewChange(input, options(), deps(provider, verifier).deps);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].verification).toMatchObject({ status: "inconclusive", claimed: "refuted" });
  });

  test("the reserve is taken before the batches: when they cannot run past it, the verifier still runs", () => {
    // $1 in total: the reserve is half, $0.50. The first batch spends exactly that, so the second
    // is not reached, and the verifier gets what is left of the total.
    const twoFiles = branchInput();
    twoFiles.files.push({ filename: "src/b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+export const d = 4;\n+export const e = 5;" });
    const provider = new FakeProvider([batch([finding({})], 0.5)]);
    const verifier = new FakeProvider([asVerifier([{ id: "c1", verdict: "supported", reason: "yes", checked: [{ snapshot: "head", path: "src/a.ts", line: 2 }] }], { costUsd: 0.1 })]);
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
    expect(review(result).body).not.toContain("verif");
  });

  test("a finding the verifier left inconclusive collapses with a question already on its line", () => {
    const provider = new FakeProvider([
      batch([finding({ line: 2, title: "b is wrong" }), finding({ line: 2, title: "is b meant?", topic: "question", severity: "consider" })]),
    ]);
    const verifier = new FakeProvider([
      () => ({ structuredOutput: { verdicts: [{ id: "c1", verdict: "inconclusive", reason: "cannot tell", checked: [] }, { id: "c2", verdict: "supported", reason: "yes", checked: [] }] } }),
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
    expect(result.verification).toMatchObject({ status: "failed", costUsd: 0, stop: { kind: "error" } });
    expect(result.verification?.stop?.detail).toContain("credit balance");
    expect(result.findings).toHaveLength(1);
  });

  test("without its own adapter the record names the reviewer's model and effort, the ones that ran", () => {
    const provider = new FakeProvider([batch([finding({})]), () => ({ structuredOutput: { verdicts: [{ id: "c1", verdict: "supported", reason: "yes", checked: [] }] } })]);
    const { deps: d } = deps(provider);
    const opts = options();
    const result = reviewChange(branchInput(), opts, d);
    expect(result.verification).toMatchObject({ status: "verified", model: opts.model, effort: opts.effort });
  });

  test("when opted in: the reserve is taken out of the batches' budget", () => {
    // $1 in total: the reserve is half, so the batch gets $0.50 instead of its usual $0.75.
    const provider = new FakeProvider([batch(three)]);
    const { deps: d } = deps(provider);
    const result = reviewChange(branchInput(), reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "1" }), 1), d);
    expect(provider.requests[0].maxBudgetUsd).toBeCloseTo(0.5);
    expect(result.verification).toBeDefined();
  });

  test("off by default: no reserve, no call, no verification block", () => {
    const provider = new FakeProvider([batch(three)]);
    const { deps: d } = deps(provider);
    const result = reviewChange(branchInput(), reviewOptionsOf(loadConfig({}), 5), d);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].maxBudgetUsd).toBeCloseTo(0.75);
    expect(result.verification).toBeUndefined();
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((f) => f.verification.status === "unverified" && f.origin === "unknown")).toBe(true);
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
  });
});
