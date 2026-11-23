import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, review, reviewChange, reviewOptionsOf, type CoreDeps, type Deps, type GhFn, type ReviewInput, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { checkGoldenPrompts, recordPrompt } from "../test/support/golden-prompts";

// The comment rule (`review.comments_point_to_docs`, ADR 0064): off by default. The off-state
// prompts are pinned byte for byte in test/fixtures/golden-prompts/comment-review.fake.jsonl,
// recorded before the rule existed, so "off" provably sends what Wachiman sent before.
// The fake cannot read code: it plays a reviewer that answers only what the prompt asks for.

const RULE_HEADING = "## Comments in the added lines";

/** What a reviewer that follows the rule would report for the fixture's four added comments. */
const COMMENT_FINDINGS: ReviewOutput["findings"] = [
  { path: "src/a.ts", line: 2, severity: "consider", topic: "cleanup", confidence: "high", title: "Comment (tautology): repeats the code", body: "`// increment the counter` restates `counter += 1`. Delete it." },
  { path: "src/a.ts", line: 4, severity: "consider", topic: "docs", confidence: "high", title: "Comment (stale): says the opposite of the code", body: "The comment says the retry count is 3, the code uses 5. Delete it." },
  { path: "src/a.ts", line: 6, severity: "consider", topic: "cleanup", confidence: "medium", title: "Comment (excuse): justifies a hack", body: "`// hack: the API lies about dates` excuses the workaround. Delete it and open an issue for the hack." },
];

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly golden = false) {}
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    if (this.golden) recordPrompt("comment-review.fake", request);
    const asked = request.prompt.includes(RULE_HEADING);
    const output: ReviewOutput = {
      files_reviewed: ["src/a.ts"],
      files_skipped: [],
      findings: asked ? COMMENT_FINDINGS : [],
      thread_replies: [],
      summary: "Fine.",
    };
    return { costUsd: 0.1, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

/** Added lines 2 to 7: a tautology, a stale comment, an excuse, and a pointer. */
const PATCH = [
  "@@ -1,1 +1,8 @@",
  " const counter = 0;",
  "+// increment the counter",
  "+counter += 1;",
  "+// retries three times",
  "+const retries = 5;",
  "+// hack: the API lies about dates",
  "+const when = new Date(raw.replace(' ', 'T'));",
  "+// See docs/adr/0053-reviews-are-opt-in.md",
].join("\n");

function input(over: Partial<ReviewInput> = {}): ReviewInput {
  const headDir = mkdtempSync(join(tmpdir(), "comment-review-head-"));
  mkdirSync(join(headDir, "src"));
  writeFileSync(join(headDir, "src/a.ts"), "const counter = 0;\n// increment the counter\ncounter += 1;\n// retries three times\nconst retries = 5;\n// hack: the API lies about dates\nconst when = new Date(raw.replace(' ', 'T'));\n// See docs/adr/0053-reviews-are-opt-in.md\n");
  return {
    format: "wachiman.review-input/1",
    change: {
      kind: "branch",
      describe: "branch `feat/x` of repo against main (merge-base 1234567)",
      repository: { name: "repo" },
      base: { sha: "1234567000000000000000000000000000000000" },
      head: { sha: "9999999999999999999999999999999999999999" },
    },
    files: [{ filename: "src/a.ts", additions: 7, deletions: 0, patch: PATCH }],
    instructions: { baseSha: "1234567000000000000000000000000000000000", files: [] },
    scope: [],
    headDir,
    ...over,
  };
}

function coreDeps(provider: FakeProvider): CoreDeps {
  return { provider, log: () => {}, warn: () => {}, sleep: () => {}, rateLimitBackoffMs: 0 } as CoreDeps;
}

const options = () => reviewOptionsOf(loadConfig({ WACHIMAN_VERIFY: "0" }), 5);

describe("the core, with the comment rule off", () => {
  checkGoldenPrompts("comment-review.fake");

  test("a repository without the setting gets the prompt it got before, and no comment finding", async () => {
    const provider = new FakeProvider(true);
    const result = await reviewChange(input(), options(), coreDeps(provider));
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].prompt).not.toContain(RULE_HEADING);
    expect(result.findings).toEqual([]);
  });
});

describe("the core, with the comment rule on", () => {
  test("the rule reaches the provider, and the three findings come out with their category and no pointer finding", async () => {
    const provider = new FakeProvider();
    const result = await reviewChange(input({ commentsPointToDocs: true }), options(), coreDeps(provider));
    expect(provider.requests[0].prompt).toContain(RULE_HEADING);
    expect(result.findings.map((f) => f.title)).toEqual([
      "Comment (tautology): repeats the code",
      "Comment (stale): says the opposite of the code",
      "Comment (excuse): justifies a hack",
    ]);
    expect(result.findings.every((f) => f.severity === "consider")).toBe(true);
    expect(result.findings.some((f) => f.line === 8)).toBe(false);
  });
});

// The GitHub path: the setting is read from the pull request's base commit, never its head.
const HEAD = "head1234567";
const BASE = "b".repeat(40);

function fakeGh(files: { base?: string; head?: string }): GhFn {
  return (args) => {
    const line = args.join(" ");
    if (args.includes("graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (args.includes("POST")) return "{}";
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.includes("/pulls/7/files")) return JSON.stringify({ filename: "src/a.ts", additions: 7, deletions: 0, patch: PATCH });
    if (line.includes("/pulls/7/reviews")) return "";
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    const m = /\/contents\/\.wachiman\.yml\?ref=(\S+)$/.exec(line);
    if (m) {
      const content = m[1] === BASE ? files.base : m[1] === HEAD ? files.head : undefined;
      if (content === undefined) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
      return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") });
    }
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    throw new Error(`unexpected gh call: ${line}`);
  };
}

async function github(files: { base?: string; head?: string }) {
  const head = mkdtempSync(join(tmpdir(), "comment-review-gh-"));
  mkdirSync(join(head, "src"));
  writeFileSync(join(head, "src/a.ts"), "x\n");
  const provider = new FakeProvider();
  const warnings: string[] = [];
  const deps: Deps = {
    gh: fakeGh(files),
    provider,
    config: loadConfig({ WACHIMAN_DRY_RUN: "1", WACHIMAN_VERIFY: "0" }, () => {}),
    repoDir: head,
    log: () => {},
    warn: (l) => warnings.push(l),
    lineCounter: () => 8,
    sleep: () => {},
  };
  await review(deps, "o/r", 7, []);
  return { provider, warnings };
}

describe("a pull request in Actions", () => {
  test("no .wachiman.yml: the rule is off", async () => {
    const { provider } = await github({});
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].prompt).not.toContain(RULE_HEADING);
  });

  test("the base turns it on: the rule is in the prompt", async () => {
    const { provider } = await github({ base: "review:\n  comments_point_to_docs: true\n" });
    expect(provider.requests[0].prompt).toContain(RULE_HEADING);
  });

  test("only the head turns it on: this review does not apply it", async () => {
    const { provider } = await github({ head: "review:\n  comments_point_to_docs: true\n" });
    expect(provider.requests[0].prompt).not.toContain(RULE_HEADING);
  });

  test("the base has it on and the head turns it off: this review still applies it", async () => {
    const { provider } = await github({ base: "review:\n  comments_point_to_docs: true\n", head: "review:\n  comments_point_to_docs: false\n" });
    expect(provider.requests[0].prompt).toContain(RULE_HEADING);
  });

  test("explicit false at the base is the same as absent", async () => {
    const { provider } = await github({ base: "review:\n  comments_point_to_docs: false\n" });
    expect(provider.requests[0].prompt).not.toContain(RULE_HEADING);
  });
});
