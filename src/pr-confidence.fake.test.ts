import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  githubReview,
  githubReviewInput,
  reviewChange,
  reviewOptionsOf,
  type CoreDeps,
  type ReviewInput,
  type ReviewOptions,
  type ReviewOutput,
} from "./engine";
import { CLAIMS_BUDGET_USD, CLAIMS_SCHEMA } from "./fidelity/claims-call";
import { BLOCK_END, BLOCK_START, claimsDigest } from "./fidelity/digest";
import { toResultV1 } from "./formats";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { validate } from "../test/support/json-schema";

// PR Confidence through the review core, with a fake provider: the claims call, the batches'
// assignments, the grade, and what a review that is not a full pull request review must not do.

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly script: ((request: ProviderRequest) => Partial<ProviderResult>)[]) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return { costUsd: 0.02, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
  /** The calls that asked for the claims list. */
  get claimsCalls() {
    return this.requests.filter((r) => r.outputSchema === CLAIMS_SCHEMA);
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
const prFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.pull-request.json"), "utf8"));
const branchFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/formats/review-input.branch.json"), "utf8"));

const HEAD = "a".repeat(40);
const TEN_LINES = Array.from({ length: 10 }, (_, i) => `line ${i + 1};`).join("\n") + "\n";
const patchOf = (n: number) => `@@ -0,0 +1,${n} @@\n${Array.from({ length: n }, (_, i) => `+line ${i + 1};`).join("\n")}`;

/** A pull request that changes the given files; each exists at the head with ten lines. */
function prInput(paths: string[], over: { title?: string; description?: string } = {}): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "conf-head-"));
  mkdirSync(join(headDir, "src"));
  for (const p of paths) writeFileSync(join(headDir, p), TEN_LINES);
  const input: ReviewInput = structuredClone(prFixture);
  delete input.since;
  input.change = { ...input.change, head: { sha: HEAD }, title: "Retry uploads", description: "Retries failed uploads and logs each retry.", ...over };
  input.files = paths.map((filename) => ({ filename, additions: 10, deletions: 0, patch: patchOf(10) }));
  return { ...input, headDir };
}

/** The files the prompt says this batch holds. */
const partFiles = (prompt: string) =>
  [...(/This part holds exactly these files[^\n]*\n((?:- .*\n?)+)/.exec(prompt)?.[1] ?? "").matchAll(/^- (\S+) \+/gm)].map((m) => m[1]!);

const deps = (provider: FakeProvider): CoreDeps => ({
  provider,
  log: () => {},
  warn: () => {},
  lineCounter: undefined,
  sleep: () => {},
  rateLimitBackoffMs: 0,
  git: undefined,
  now: undefined,
  costs: undefined,
  engineVersion: undefined,
});

const base = (budget = 5): ReviewOptions => reviewOptionsOf(loadConfig({ AGENT_REVIEW_VERIFY: "0" }), budget);
const graded = (budget = 5): ReviewOptions => ({ ...base(budget), confidence: { budgetUsd: CLAIMS_BUDGET_USD } });

const claimsAnswer = (...claims: { text: string; vague?: boolean }[]) => () => ({
  structuredOutput: { claims: claims.map((c) => ({ vague: false, ...c })) },
});
const TWO_CLAIMS = claimsAnswer({ text: "Retries failed uploads." }, { text: "Logs each retry." });

const supports = (path: string, claim: number, line: number) => ({
  path,
  claim,
  verdict: "supports" as const,
  evidence: [{ path, line }],
});

/** One batch that reviewed every path and ties the first two to the two claims. */
const batchOf = (paths: string[], extra: Partial<ReviewOutput> = {}) => () => ({
  structuredOutput: out({
    files_reviewed: paths,
    summary: "Reviewed.",
    claim_assignments: [supports("src/upload.ts", 0, 2), supports("src/log.ts", 1, 3)],
    ...extra,
  }),
});

/** The claims call and the batches end on a limit with usable output; the grade must not trust it. */
const limited = (reason: "turns" | "timeout", step: () => Partial<ProviderResult>) => () => ({ ...step(), terminalReason: reason });

describe("what the review did not read or finish", () => {
  const paths = ["src/upload.ts", "src/log.ts"];

  test("a confirmed change plus a binary file the review never read gives B, naming the binary", () => {
    const input = prInput(paths);
    mkdirSync(join(input.headDir!, "assets"));
    writeFileSync(join(input.headDir!, "assets/logo.png"), Buffer.from([0, 1, 2, 3, 0, 255]));
    input.files = [...input.files, { filename: "assets/logo.png", additions: 0, deletions: 0 }];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const f = reviewChange(input, graded(), deps(provider)).fidelity!;
    expect(f.unexplainedFiles).toEqual(["assets/logo.png"]);
    expect(f.grade).toBe("B");
  });

  test("a file the owner excluded from the review is named too, and a lockfile is still explained", () => {
    const input = prInput([...paths, "src/notes.md"]);
    input.files = [...input.files, { filename: "bun.lock", additions: 5, deletions: 5, patch: patchOf(5) }];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const f = reviewChange(input, { ...graded(), exclude: ["src/notes.md"] }, deps(provider)).fidelity!;
    expect(f.unexplainedFiles).toEqual(["src/notes.md"]);
    expect(f.grade).toBe("B");
  });

  test("build output the engine skips by default, beside two confirmed claims, keeps A", () => {
    const input = prInput(paths);
    input.files = [
      ...input.files,
      { filename: "dist/app.js", additions: 5, deletions: 5, patch: patchOf(5) },
      { filename: "packages/web/build/main.css", additions: 5, deletions: 5, patch: patchOf(5) },
      { filename: "app.js.map", additions: 5, deletions: 5, patch: patchOf(5) },
      { filename: "src/__snapshots__/upload.test.ts.snap", additions: 5, deletions: 5, patch: patchOf(5) },
    ];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    expect(reviewChange(input, graded(), deps(provider)).fidelity).toMatchObject({ grade: "A", unexplainedFiles: [] });
  });

  test("a lockfile alone beside two confirmed claims keeps A", () => {
    const input = prInput(paths);
    input.files = [...input.files, { filename: "bun.lock", additions: 5, deletions: 5, patch: patchOf(5) }];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    expect(reviewChange(input, graded(), deps(provider)).fidelity).toMatchObject({ grade: "A", unexplainedFiles: [] });
  });

  test("a title and body too long for the claims call give cannot say with that reason", () => {
    const description = `Retries failed uploads and logs each retry. ${"More detail. ".repeat(3000)}`;
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const f = reviewChange(prInput(paths, { description }), graded(), deps(provider)).fidelity!;
    expect(f.grade).toBe("cannot say");
    expect(f.reasons).toEqual(["The pull request text was too long to read in full"]);
    expect(f.trial).toBe(false);
  });

  test("a batch that hits the turn limit with usable output gives cannot say", () => {
    const provider = new FakeProvider([TWO_CLAIMS, limited("turns", batchOf(paths))]);
    const f = reviewChange(prInput(paths), graded(), deps(provider)).fidelity!;
    expect(f.grade).toBe("cannot say");
    expect(f.reasons).toEqual(["The run did not finish"]);
  });

  test("a batch killed by the time limit with usable output gives cannot say", () => {
    const provider = new FakeProvider([TWO_CLAIMS, limited("timeout", batchOf(paths))]);
    expect(reviewChange(prInput(paths), graded(), deps(provider)).fidelity?.grade).toBe("cannot say");
  });

  test("a claims call that hits the turn limit with a usable list gives cannot say", () => {
    const provider = new FakeProvider([limited("turns", TWO_CLAIMS), batchOf(paths)]);
    const f = reviewChange(prInput(paths), graded(), deps(provider)).fidelity!;
    expect(f.grade).toBe("cannot say");
  });
});

describe("the grade of a pull request review", () => {
  test("two confirmed claims and one file no claim explains give B, and the file is named", () => {
    const paths = ["src/upload.ts", "src/log.ts", "src/extra.ts"];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    const f = result.fidelity!;
    expect(f.claims.map((c) => c.status)).toEqual(["confirmed", "confirmed"]);
    expect(f.unexplainedFiles).toEqual(["src/extra.ts"]);
    expect(f.grade).toBe("B");
    expect(f.reasons).toEqual(["One unexplained change"]);
    expect(f.questions.map((q) => [q.kind, q.path])).toEqual([["unexplained", "src/extra.ts"]]);
    expect(f.reviewedCommit).toBe(HEAD);
    expect(f.digest).toBe(claimsDigest("Retry uploads", "Retries failed uploads and logs each retry."));
    expect(validate(resultSchema, JSON.parse(JSON.stringify(result)))).toEqual([]);
  });

  test("the same pull request without that file gives A, marked as a trial", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity).toMatchObject({ grade: "A", trial: true, reasons: [], unexplainedFiles: [] });
  });

  test("a title and body that name nothing checkable give C with the stated reason", () => {
    const paths = ["src/upload.ts"];
    const provider = new FakeProvider([
      claimsAnswer({ text: "Various improvements.", vague: true }),
      () => ({ structuredOutput: out({ files_reviewed: paths, summary: "Reviewed." }) }),
    ]);
    const result = reviewChange(prInput(paths, { title: "Updates", description: "Various improvements." }), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("C");
    expect(result.fidelity?.reasons[0]).toBe("The pull request does not say what it changes");
    expect(result.fidelity?.claims.map((c) => c.status)).toEqual(["vague"]);
  });

  test("a pull request with no claim at all gives C too", () => {
    const paths = ["src/upload.ts"];
    const provider = new FakeProvider([claimsAnswer(), () => ({ structuredOutput: out({ files_reviewed: paths, summary: "Reviewed." }) })]);
    const result = reviewChange(prInput(paths, { title: "wip", description: "" }), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("C");
  });

  test("a money risk fact gives at most B even when every claim is confirmed", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const provider = new FakeProvider([
      TWO_CLAIMS,
      batchOf(paths, { risk_facts: [{ kind: "money", path: "src/upload.ts", line: 4, why: "A retry can charge twice." }] }),
    ]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("B");
    expect(result.fidelity?.reasons[0]).toContain("money");
  });

  test("a contradicted claim gives C", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const provider = new FakeProvider([
      TWO_CLAIMS,
      batchOf(paths, {
        claim_assignments: [
          supports("src/upload.ts", 0, 2),
          { path: "src/log.ts", claim: 1, verdict: "contradicts", evidence: [{ path: "src/log.ts", line: 5 }] },
        ],
      }),
    ]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("C");
    expect(result.fidelity?.claims[1]).toMatchObject({ status: "contradicted", evidence: [{ path: "src/log.ts", line: 5 }] });
  });

  test("evidence on a line that does not exist at the head leaves the claim unverified, so B", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const provider = new FakeProvider([
      TWO_CLAIMS,
      batchOf(paths, { claim_assignments: [supports("src/upload.ts", 0, 2), supports("src/log.ts", 1, 99)] }),
    ]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity?.claims.map((c) => c.status)).toEqual(["confirmed", "unverified"]);
    expect(result.fidelity?.grade).toBe("B");
    expect(result.fidelity?.reasons).toEqual(["Claim not verified: Logs each retry."]);
  });

  test("an open Blocker gives C, and a pre-existing one does not", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const blocker = { path: "src/upload.ts", line: 2, severity: "blocker" as const, topic: "bug" as const, confidence: "high" as const, title: "Loses data", body: "It drops the file." };
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths, { findings: [blocker] })]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("C");
    expect(result.fidelity?.reasons).toEqual(["One open Blocker"]);
  });
});

describe("a run that did not read everything has no grade", () => {
  test("a spend-ceiling stop gives cannot say, whatever the claims say", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const provider = new FakeProvider([
      TWO_CLAIMS,
      // The first batch spends nearly the whole budget; the second is not run.
      (request) => {
        const mine = partFiles(request.prompt);
        return { costUsd: 0.34, structuredOutput: out({ files_reviewed: mine, summary: "One.", claim_assignments: mine.includes("src/upload.ts") ? [supports("src/upload.ts", 0, 2)] : [] }) };
      },
    ]);
    const options = { ...graded(0.4), batchLines: 10 };
    const result = reviewChange(prInput(paths), options, deps(provider));
    expect(result.batches.map((b) => b.status)).toEqual(["reviewed", "not run: budget spent"]);
    expect(result.fidelity?.grade).toBe("cannot say");
    expect(result.fidelity?.trial).toBe(false);
    expect(result.fidelity?.reasons[0]).toBe("The run stopped at the spend ceiling");
    expect(result.fidelity?.reasons).toContain("One file was not read");
  });

  test("a file the batch did not account for gives cannot say", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(["src/upload.ts"]), () => ({ structuredOutput: out({ files_reviewed: ["src/upload.ts"] }) })]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("cannot say");
    expect(result.fidelity?.reasons).toContain("One file was not read");
  });

  test("a claims call that returns nothing usable gives cannot say, never C", () => {
    const paths = ["src/upload.ts"];
    const provider = new FakeProvider([() => ({ structuredOutput: { nope: true } }), () => ({ structuredOutput: out({ files_reviewed: paths }) })]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("cannot say");
    expect(provider.requests[1]?.prompt).not.toContain("claim_assignments");
  });

  test("a claims call that throws gives cannot say and the review goes on", () => {
    const paths = ["src/upload.ts"];
    const provider = new FakeProvider([
      () => {
        throw new Error("the provider crashed");
      },
      () => ({ structuredOutput: out({ files_reviewed: paths, summary: "Reviewed." }) }),
    ]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("cannot say");
    expect(result.findings).toEqual([]);
    expect(result.execution.callsWithOutput).toBe(1);
  });

  test("a budget too small for the claims call skips it and gives cannot say", () => {
    const paths = ["src/upload.ts"];
    const provider = new FakeProvider([() => ({ structuredOutput: out({ files_reviewed: paths, summary: "Reviewed." }) })]);
    const result = reviewChange(prInput(paths), graded(0.1), deps(provider));
    expect(provider.claimsCalls).toHaveLength(0);
    expect(result.fidelity?.grade).toBe("cannot say");
    expect(result.fidelity?.reasons[0]).toBe("The run stopped at the spend ceiling");
  });
});

describe("the claims call", () => {
  test("is one extra call, costed and counted like any other", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const costs: NonNullable<CoreDeps["costs"]> = [];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const result = reviewChange(prInput(paths), graded(), { ...deps(provider), costs });
    expect(provider.requests).toHaveLength(2);
    expect(provider.claimsCalls).toHaveLength(1);
    expect(costs.map((c) => c.label)).toEqual(["claims", "batch 1/1"]);
    expect(result.execution.calls).toBe(2);
    expect(result.execution.costUsdEstimate).toBeCloseTo(0.04, 5);
    expect(provider.claimsCalls[0]?.maxBudgetUsd).toBeLessThanOrEqual(CLAIMS_BUDGET_USD);
  });

  test("reads the title and body the author wrote, without Wachiman's block", () => {
    const paths = ["src/upload.ts"];
    const block = `${BLOCK_START}\n## Wachiman · PR Confidence\n> B · old letter\n${BLOCK_END}`;
    const author = "Retries failed uploads.";
    const input = githubReviewInput({
      repo: "o/r",
      pr: 7,
      headSha: HEAD,
      baseSha: "b".repeat(40),
      meta: { title: "Retry uploads", body: `${block}\n\n${author}` },
      files: prInput(paths).files,
      instructions: prInput(paths).instructions,
      headDir: prInput(paths).headDir,
      scope: [],
      since: null,
      rebased: false,
      threads: [],
    });
    expect(input.change.description).toBe(author);
    const provider = new FakeProvider([claimsAnswer({ text: author }), batchOf(paths)]);
    reviewChange(input, graded(), deps(provider));
    const prompt = provider.claimsCalls[0]!.prompt;
    expect(prompt).toContain(JSON.stringify({ title: "Retry uploads", body: author }));
    expect(prompt).not.toContain(BLOCK_START);
    expect(prompt).not.toContain("old letter");
  });

  test("an absolute path in an assignment or its evidence is made relative to the head", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const input = prInput(paths);
    const abs = (p: string) => `${input.headDir}/${p}`;
    const provider = new FakeProvider([
      TWO_CLAIMS,
      () => ({
        structuredOutput: out({
          files_reviewed: paths,
          claim_assignments: [
            { path: abs("src/upload.ts"), claim: 0, verdict: "supports", evidence: [{ path: abs("src/upload.ts"), line: 2 }] },
            { path: "src/log.ts", claim: 1, verdict: "supports", evidence: [{ path: abs("src/log.ts"), line: 3 }] },
          ],
        }),
      }),
    ]);
    const result = reviewChange(input, graded(), deps(provider));
    expect(result.fidelity?.grade).toBe("A");
    expect(result.fidelity?.claims.map((c) => c.evidence[0]?.path)).toEqual(["src/upload.ts", "src/log.ts"]);
  });

  test("the batches get the claims and the optional claim_assignments output", () => {
    const paths = ["src/upload.ts"];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    reviewChange(prInput(paths), graded(), deps(provider));
    const batch = provider.requests[1]!;
    expect(batch.prompt).toContain('0. "Retries failed uploads."');
    expect(batch.prompt).toContain('1. "Logs each retry."');
    const schema = batch.outputSchema as { required: string[]; properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toContain("claim_assignments");
    expect(schema.required).not.toContain("claim_assignments");
  });
});

describe("what is not a full pull request review gets no grade and no extra call", () => {
  test("without the option, a pull request review makes no claims call and has no fidelity", () => {
    const paths = ["src/upload.ts"];
    const provider = new FakeProvider([() => ({ structuredOutput: out({ files_reviewed: paths, summary: "Reviewed." }) })]);
    const result = reviewChange(prInput(paths), base(), deps(provider));
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.prompt).not.toContain("## Claims");
    expect(provider.requests[0]?.outputSchema).toBeDefined();
    expect(Object.keys((provider.requests[0]!.outputSchema as { properties: object }).properties)).not.toContain("claim_assignments");
    expect(result.fidelity).toBeUndefined();
  });

  test("a local branch review never produces fidelity, even when the option is passed", () => {
    const headDir = mkdtempSync(join(tmpdir(), "conf-branch-"));
    mkdirSync(join(headDir, "src"));
    writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const provider = new FakeProvider([() => ({ structuredOutput: out({ files_reviewed: ["src/a.ts"], summary: "Fine." }) })]);
    const result = reviewChange({ ...structuredClone(branchFixture), headDir }, graded(), deps(provider));
    expect(provider.requests).toHaveLength(1);
    expect(result.fidelity).toBeUndefined();
  });
});

describe("result /2 and /1", () => {
  test("/2 has fidelity and the /1 downgrade does not", () => {
    const paths = ["src/upload.ts", "src/log.ts"];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    expect(result.fidelity).toBeDefined();
    expect(JSON.stringify(result)).toContain('"fidelity"');
    const v1 = toResultV1(result);
    expect(JSON.stringify(v1)).not.toContain('"fidelity"');
    expect(v1).not.toHaveProperty("fidelity");
  });

  test("the review comment body carries a short PR Confidence result", () => {
    const paths = ["src/upload.ts", "src/log.ts", "src/extra.ts"];
    const provider = new FakeProvider([TWO_CLAIMS, batchOf(paths)]);
    const result = reviewChange(prInput(paths), graded(), deps(provider));
    const body = githubReview(result, {
      since: null,
      rebased: false,
      scoped: false,
      mention: "/wachiman",
      automatic: false,
      instructionChanges: { files: [], baseSha: "b".repeat(40) },
    }).body;
    expect(body).toContain("**PR Confidence: B.** One unexplained change.");
    expect(body.indexOf("on their lines")).toBeLessThan(body.indexOf("PR Confidence: B"));
  });
});
