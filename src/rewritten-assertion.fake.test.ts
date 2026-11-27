import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, review, REWRITTEN_ASSERTION_RULE, type Deps, type GhFn } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// The rewritten-assertion rule (`review.rewritten_assertions`, ADR 0064) on the GitHub path: the
// setting is read from the pull request's base commit, never its head, and a repository without it
// gets a prompt with neither the rule nor the hint.

const HEAD = "head1234567";
const BASE = "b".repeat(40);
const ON = "review:\n  rewritten_assertions: true\n";
const SOURCE = {
  filename: "src/stock.ts",
  additions: 1,
  deletions: 1,
  patch: "@@ -1,3 +1,3 @@\n function f(n) {\n-  return stock >= n;\n+  return stock > n;\n }",
};
const TEST = {
  filename: "src/stock.test.ts",
  additions: 1,
  deletions: 1,
  patch: '@@ -1,3 +1,3 @@\n test("x", () => {\n-  expect(f(1)).toBe(true);\n+  expect(f(1)).toBe(false);\n });',
};

function fakeGh(files: { base?: string; head?: string }): GhFn {
  return (args) => {
    const line = args.join(" ");
    if (args.includes("graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (args.includes("POST")) return "{}";
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.includes("/pulls/7/files")) return [SOURCE, TEST].map((f) => JSON.stringify(f)).join("\n");
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

async function prompts(files: { base?: string; head?: string }): Promise<string[]> {
  const head = mkdtempSync(join(tmpdir(), "rewritten-assertion-gh-"));
  mkdirSync(join(head, "src"));
  writeFileSync(join(head, "src/stock.ts"), "x\n");
  writeFileSync(join(head, "src/stock.test.ts"), "x\n");
  const seen: string[] = [];
  const provider: ProviderAdapter = {
    name: "fake",
    preflight() {},
    modelLabel: () => "Fake Model 1 via Fake CLI 0.1",
    leaksSecret: () => false,
    async run(request: ProviderRequest): Promise<ProviderResult> {
      seen.push(request.prompt);
      const output = {
        files_reviewed: [SOURCE.filename, TEST.filename],
        files_skipped: [],
        findings: [],
        thread_replies: [],
        summary: "Fine.",
      };
      return { costUsd: 0.1, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
    },
  } as ProviderAdapter;
  const deps: Deps = {
    gh: fakeGh(files),
    provider,
    config: loadConfig({ WACHIMAN_DRY_RUN: "1", WACHIMAN_VERIFY: "0" }, () => {}),
    repoDir: head,
    log: () => {},
    warn: () => {},
    lineCounter: () => 8,
    sleep: () => {},
  };
  await review(deps, "o/r", 7, []);
  return seen;
}

const HINT = "The engine noticed that this part changes logic";

describe("the rewritten-assertion rule on the GitHub path", () => {
  test("a repository without the setting gets neither the rule nor the hint", async () => {
    for (const files of [{}, { base: "effort: high\n" }, { base: "review:\n  rewritten_assertions: false\n" }, { head: ON }]) {
      const sent = await prompts(files);
      expect(sent.length).toBeGreaterThan(0);
      for (const p of sent) {
        expect(p).not.toContain(REWRITTEN_ASSERTION_RULE);
        expect(p).not.toContain(HINT);
      }
    }
  });

  test("on at the base commit: the rule and the hint reach the model, even when the head's copy says false", async () => {
    for (const files of [{ base: ON }, { base: ON, head: "review:\n  rewritten_assertions: false\n" }]) {
      const sent = await prompts(files);
      expect(sent[0]).toContain(REWRITTEN_ASSERTION_RULE);
      expect(sent[0]).toContain(HINT);
    }
  });
});
