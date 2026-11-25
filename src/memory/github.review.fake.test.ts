import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { GhError, review, type Deps, type GhFn, type ReviewOutput } from "../engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../providers/types";

// Which files select memory on the GitHub path: the files the run reviews, not every changed one.

const BASE = "b".repeat(40);
const HEAD = "abc1234" + "0".repeat(33);
const INDEX = "# Memory\n\n| Glob | File |\n| --- | --- |\n| `src/**` | `src.md` |\n| `package-lock.json` | `locks.md` |\n";

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    const files = [
      ...request.prompt
        .split("This part holds exactly these files")[1]
        .split("\n\n")[0]
        .matchAll(/^- (\S+) \+/gm),
    ].map((m) => m[1]);
    const output: ReviewOutput = {
      files_reviewed: files,
      files_skipped: [],
      findings: [],
      contracts: [],
      thread_replies: [],
      summary: "ok",
    };
    return { costUsd: 0.1, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

const file = (filename: string) => ({ filename, additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+x" });
const FILES = [file("src/a.ts"), file("package-lock.json"), file("docs/out.md")];
const MEMORY: Record<string, string> = { "index.md": INDEX, "src.md": "src rule\n", "locks.md": "lock rule\n" };

async function run(words: string[]) {
  const calls: string[] = [];
  const gh: GhFn = (args) => {
    const line = args.join(" ");
    calls.push(line);
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.includes("/pulls/7/files")) return FILES.map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/issues/7/comments")) return "";
    if (line.includes("/pulls/7/reviews") || line.includes("/pulls/7/comments")) return "";
    if (args.includes("POST") || args.includes("PATCH") || line.startsWith("pr comment")) return "{}";
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    const memoryPath = line.match(/contents\/\.wachiman\/memory(?:\/(\S+?))?\?ref=/);
    if (memoryPath) {
      if (!memoryPath[1]) return JSON.stringify(Object.keys(MEMORY).map((name) => ({ type: "file", name })));
      const text = MEMORY[memoryPath[1]];
      if (text !== undefined) return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(text).toString("base64") });
    }
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    if (line.match(/compare\/(\S+?)\.\.\.(\S+)/)) return JSON.stringify({ status: "ahead", files: FILES });
    throw new Error(`unexpected gh call: ${line}`);
  };
  const deps: Deps = {
    gh,
    provider: new FakeProvider(),
    config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "synchronize", WACHIMAN_MODEL: "claude-sonnet-5-5" }),
    repoDir: mkdtempSync(join(tmpdir(), "memory-gh-head-")),
    log: () => {},
    warn: () => {},
    lineCounter: () => 10,
    sleep: () => {},
  };
  await review(deps, "o/r", 7, words);
  return calls;
}

const requested = (calls: string[], name: string) => calls.some((c) => c.includes(`.wachiman/memory/${name}?ref=`));

describe("memory on the GitHub path is selected by the files the run reviews", () => {
  test("a lockfile (excluded) selects nothing; a reviewed file does", async () => {
    const calls = await run([]);
    expect(requested(calls, "src.md")).toBe(true);
    expect(requested(calls, "locks.md")).toBe(false);
  });

  test("a run scoped to a path is not given the memory of files outside the scope", async () => {
    const calls = await run(["review", "docs/out.md"]);
    expect(requested(calls, "src.md")).toBe(false);
  });
});
