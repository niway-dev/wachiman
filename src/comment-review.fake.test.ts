import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  GhError,
  review,
  reviewChange,
  reviewOptionsOf,
  type CoreDeps,
  type Deps,
  type GhFn,
  type ReviewInput,
  type ReviewOutput,
} from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { checkGoldenPrompts, recordPrompt } from "../test/support/golden-prompts";

// The comment rule (`review.comments_point_to_docs`, ADR 0064): off by default. The off-state
// prompts are pinned byte for byte in test/fixtures/golden-prompts/comment-review.fake.jsonl,
// recorded before the rule existed, so "off" provably sends what Wachiman sent before.
// The fake cannot read code: it plays a reviewer that answers only what the prompt asks for.

const RULE_HEADING = "## Comments in the added lines";

/**
 * The scripted judgement: how this fake classifies the fixture's added comments. A real model
 * decides this from the code; here it is a table, so the test checks the wiring (the rule in the
 * prompt, the findings through the pipeline), not the model's judgement.
 */
const CATEGORY: Record<string, { category: string; topic: "cleanup" | "docs"; why: string }> = {
  "// increment the counter": { category: "tautology", topic: "cleanup", why: "It restates `counter += 1`. Delete it." },
  "// retries three times": { category: "stale", topic: "docs", why: "The code uses 5 retries. Delete it." },
  "// hack: the API lies about dates": {
    category: "excuse",
    topic: "cleanup",
    why: "It excuses the workaround. Delete it and open an issue for the hack.",
  },
};

/** What a reviewer that follows the rule reports: every added comment in the prompt's diff that is not a pointer. */
function judge(prompt: string): ReviewOutput["findings"] {
  const diff = prompt.slice(prompt.indexOf("<diff>"));
  return [...diff.matchAll(/^\s*(\d+) \+(\/\/.*)$/gm)].flatMap(([, line, text]) => {
    if (text.startsWith("// See docs/")) return [];
    const verdict = CATEGORY[text];
    if (!verdict) return [];
    return [
      {
        path: "src/a.ts",
        line: Number(line),
        severity: "consider" as const,
        topic: verdict.topic,
        confidence: "high" as const,
        title: `Comment (${verdict.category}): ${text.slice(3)}`,
        body: verdict.why,
      },
    ];
  });
}

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
      findings: asked ? judge(request.prompt) : [],
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
  writeFileSync(
    join(headDir, "src/a.ts"),
    "const counter = 0;\n// increment the counter\ncounter += 1;\n// retries three times\nconst retries = 5;\n// hack: the API lies about dates\nconst when = new Date(raw.replace(' ', 'T'));\n// See docs/adr/0053-reviews-are-opt-in.md\n",
  );
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
  test("the rule reaches the provider, and the three findings come out with their category and nothing for the pointer line", async () => {
    const provider = new FakeProvider();
    const result = await reviewChange(input({ commentsPointToDocs: true }), options(), coreDeps(provider));
    expect(provider.requests[0].prompt).toContain(RULE_HEADING);
    expect(result.findings.map((f) => [f.line, f.title])).toEqual([
      [2, "Comment (tautology): increment the counter"],
      [4, "Comment (stale): retries three times"],
      [6, "Comment (excuse): hack: the API lies about dates"],
    ]);
    expect(result.findings.every((f) => f.severity === "consider")).toBe(true);
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

describe("the cap on a comment finding", () => {
  test("a model that answers a higher severity for a comment still gets consider", async () => {
    class Loud extends FakeProvider {
      override async run(request: ProviderRequest): Promise<ProviderResult> {
        const result = await super.run(request);
        const out = result.structuredOutput as ReviewOutput;
        return { ...result, structuredOutput: { ...out, findings: out.findings.map((f) => ({ ...f, severity: "blocker" as const })) } };
      }
    }
    const result = await reviewChange(input({ commentsPointToDocs: true }), options(), coreDeps(new Loud()));
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((f) => f.severity === "consider")).toBe(true);
  });
});

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
    const { provider } = await github({
      base: "review:\n  comments_point_to_docs: true\n",
      head: "review:\n  comments_point_to_docs: false\n",
    });
    expect(provider.requests[0].prompt).toContain(RULE_HEADING);
  });

  test("explicit false at the base is the same as absent", async () => {
    const { provider } = await github({ base: "review:\n  comments_point_to_docs: false\n" });
    expect(provider.requests[0].prompt).not.toContain(RULE_HEADING);
  });
});
