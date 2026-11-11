import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./config";
import {
  MAX_BODY_CHARS,
  githubReview,
  reviewChange,
  reviewOptionsOf,
  type CoreDeps,
  type ReviewInput,
  type ReviewOptions,
  type ReviewOutput,
} from "./engine";
import { renderJson } from "./sinks/json";
import { renderMarkdown } from "./sinks/markdown";
import { renderTerminal } from "./sinks/terminal";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { validate } from "../test/support/json-schema";

// The risk map end to end: a batch's facts and judgement items are checked, merged, rendered on
// GitHub, in Markdown and in the terminal, and kept in result /2 only (ADR 0031).

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

/** The branch fixture over a head that holds src/a.ts with three lines, as its patch describes. */
function branchInput(): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "risk-head-"));
  mkdirSync(join(headDir, "src"));
  writeFileSync(join(headDir, "src/a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  return { ...structuredClone(branchFixture), headDir };
}

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

const options = (): ReviewOptions => reviewOptionsOf(loadConfig({ AGENT_REVIEW_VERIFY: "0" }), 5);

const GITHUB = {
  since: null,
  rebased: false,
  scoped: false,
  mention: "/wachiman",
  automatic: false,
  instructionChanges: { files: [], baseSha: "b".repeat(40) },
};

/** One batch that reviews src/a.ts, reports a valid auth fact, one fact on a line that does not exist, and two judgement items. */
function reviewWithFacts(input = branchInput()) {
  const provider = new FakeProvider([
    () => ({
      structuredOutput: out({
        files_reviewed: ["src/a.ts"],
        findings: [
          { path: "src/a.ts", line: 2, severity: "fix", topic: "bug", confidence: "high", title: "b is wrong", body: "It should be 3." },
        ],
        summary: "One change.",
        risk_facts: [
          { kind: "auth", path: "src/a.ts", line: 2, why: "The check is skipped on this path." },
          { kind: "money", path: "src/a.ts", line: 99, why: "A line that does not exist." },
        ],
        judgement: [
          { kind: "tradeoff", path: "src/a.ts", line: 3, why: "Whether a retry is acceptable is a product call." },
          { kind: "direction", path: "src/missing.ts", line: 1, why: "A file that is not in the review." },
        ],
      }),
    }),
  ]);
  const result = reviewChange(input, options(), deps(provider));
  return { provider, result, input };
}

describe("the risk map of a review", () => {
  test("a valid fact is kept; a fact on a missing line and an item on a missing file are dropped and counted", () => {
    const { provider, result } = reviewWithFacts();
    expect(provider.requests[0].prompt).toContain("Also report risk facts");
    expect(result.riskMap?.level).toBe("high");
    expect(result.riskMap?.facts).toEqual([{ kind: "auth", path: "src/a.ts", line: 2, why: "The check is skipped on this path." }]);
    expect(result.riskMap?.judgement.map((j) => [j.kind, j.path, j.line])).toEqual([["tradeoff", "src/a.ts", 3]]);
    expect(result.riskMap?.droppedFacts).toBe(2);
    expect(result.riskMap?.floor).toBe(false);
  });

  test("the GitHub body carries the map after the count line, with the valid references only", () => {
    const { result } = reviewWithFacts();
    const body = githubReview(result, GITHUB).body;
    expect(body).toContain("### Risk map");
    expect(body).toContain("**High.**");
    expect(body).toContain("`src/a.ts:2`");
    expect(body).not.toContain("src/a.ts:99");
    expect(body).not.toContain("src/missing.ts");
    expect(body).toContain("`src/a.ts:3`");
    expect(body).toContain("**Read first:** `src/a.ts`.");
    expect(body.indexOf("on their lines")).toBeLessThan(body.indexOf("### Risk map"));
    expect(body.indexOf("### Risk map")).toBeLessThan(body.indexOf("### Summary"));
  });

  test("a review with no facts on files without a risky path renders the two-line form and no heading", () => {
    const provider = new FakeProvider([() => ({ structuredOutput: out({ files_reviewed: ["src/a.ts"], summary: "Fine." }) })]);
    const result = reviewChange(branchInput(), options(), deps(provider));
    expect(result.batches[0].status).toBe("reviewed");
    expect(result.riskMap?.level).toBe("low");
    const body = githubReview(result, GITHUB).body;
    expect(body).toContain("**Risk map:** low — no risk facts in this change.\n**Read first:** `src/a.ts`.");
    expect(body).not.toContain("### Risk map");
  });

  test("a partial review says at least, with the count of files not read", () => {
    const provider = new FakeProvider([
      () => ({
        structuredOutput: out({
          files_reviewed: [],
          summary: "Nothing read.",
          risk_facts: [{ kind: "auth", path: "src/a.ts", line: 2, why: "The check is skipped on this path." }],
        }),
      }),
    ]);
    const result = reviewChange(branchInput(), options(), deps(provider));
    expect(result.coverage.partial).toBe(true);
    expect(result.riskMap?.floor).toBe(true);
    const body = githubReview(result, GITHUB).body;
    expect(body).toContain("**At least high.** 1 file was not reviewed.");
  });

  test("a trimmed body keeps the map: the long part is cut, the map is not", () => {
    const { result } = reviewWithFacts();
    result.findings = [
      ...result.findings,
      ...Array.from({ length: 400 }, (_, i) => ({
        ...result.findings[0],
        origin: "pre-existing" as const,
        title: `Old problem ${i}`,
        body: "x".repeat(400),
      })),
    ];
    const body = githubReview(result, GITHUB).body;
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(body).toContain("### Risk map");
    expect(body).toContain("**High.**");
  });

  test("a push-only review says so on the level line", () => {
    const { result } = reviewWithFacts();
    const body = githubReview(result, { ...GITHUB, since: "c".repeat(40) }).body;
    expect(body).toContain("This push only. **High.**");
  });

  test("an absolute path in a fact is made relative to the head, as findings are", () => {
    const input = branchInput();
    const provider = new FakeProvider([
      () => ({
        structuredOutput: out({
          files_reviewed: ["src/a.ts"],
          risk_facts: [{ kind: "auth", path: `${input.headDir}/src/a.ts`, line: 2, why: "The check is skipped." }],
        }),
      }),
    ]);
    const result = reviewChange(input, options(), deps(provider));
    expect(result.riskMap?.facts.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  test("the local Markdown has the map before the findings, the JSON /2 has it and /1 does not", () => {
    const { result } = reviewWithFacts();
    const md = renderMarkdown(result, {});
    expect(md).toContain("## Risk map");
    expect(md.indexOf("## Risk map")).toBeLessThan(md.indexOf("## Findings"));

    const v2 = JSON.parse(renderJson(result, 2));
    expect(v2.riskMap.level).toBe("high");
    expect(validate(resultSchema, v2)).toEqual([]);
    expect("riskMap" in JSON.parse(renderJson(result, 1))).toBe(false);
  });

  test("the terminal output carries the map as plain text", () => {
    const { result } = reviewWithFacts();
    const text = renderTerminal(result, { agentPrompt: false });
    expect(text).toContain("Risk map:\n\nHigh.");
    expect(text).toContain("auth · src/a.ts:2");
    expect(text).not.toContain("**");
  });
});
