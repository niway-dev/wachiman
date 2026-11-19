import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { GhError, SIGNATURE, marker, review, type Deps, type GhFn, type ReviewOutput } from "../engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../providers/types";
import { entryId } from "./entries";

// `holds while` on the GitHub path is checked against every path the whole pull request touches,
// old and new names included, even when the review is incremental (ADR 0057 decision 4).

const BASE = "b".repeat(40);
const LAST = "1".repeat(40);
const HEAD = "abc1234" + "0".repeat(33);

const why = "the owner said so";
const rule = "Do not report stale comments";
const scope = "src/**";
const entryBlock = (holdsWhile: string) => {
  const id = entryId({ kind: "exception", scope, rule, why, holdsWhile });
  return { id, text: `# Memory\n\n### ${id} ${rule}\n\n- kind: exception\n- scope: ${scope}\n- rule: ${rule}\n- why: ${why}\n- holds while: ${holdsWhile}\n- evidence:\n  - 2026-11-18 operator instruction\n- added: 2026-11-18\n` };
};

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret() {
    return false;
  }
  get matchingCalls() {
    return this.requests.filter((r) => r.prompt.includes("<exceptions>"));
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    if (request.prompt.includes("<exceptions>")) return { costUsd: 0.01, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: { matches: [] } };
    const files = [...request.prompt.split("This part holds exactly these files")[1].split("\n\n")[0].matchAll(/^- (\S+) \+/gm)].map((m) => m[1]);
    const finding = { path: files[0], line: 1, severity: "consider", topic: "cleanup", confidence: "high", title: "stale comment", body: "b" } as const;
    const output: ReviewOutput = { files_reviewed: files, files_skipped: [], findings: [finding], contracts: [], thread_replies: [], summary: "ok" };
    return { costUsd: 0.1, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

type PrFile = { filename: string; previous_filename?: string };
const file = (f: PrFile) => ({ additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+x", ...f });

/** One run of the engine over a pull request whose whole change is `prFiles`; `sinceLast` are the files that changed after the last review. */
async function run(holdsWhile: string, prFiles: PrFile[], sinceLast?: PrFile[]) {
  const memory = entryBlock(holdsWhile);
  const reviews: string[] = [];
  const gh: GhFn = (args, stdin) => {
    const line = args.join(" ");
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.includes("/pulls/7/files")) return prFiles.map((f) => JSON.stringify(file(f))).join("\n");
    if (line.includes("/issues/7/comments")) return "";
    if (line.includes("/pulls/7/reviews") && args.includes("POST")) {
      reviews.push(JSON.parse(stdin ?? "{}").body);
      return "{}";
    }
    if (line.includes("/pulls/7/reviews")) {
      return sinceLast ? JSON.stringify({ body: `Reviewed.\n\n${SIGNATURE.review}\n\n${marker(LAST)}`, submitted_at: "2026-11-18T00:00:00Z" }) : "";
    }
    if (line.includes("/pulls/7/comments")) return "";
    if (args.includes("POST") || args.includes("PATCH") || line.startsWith("pr comment")) return "{}";
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    const memoryPath = line.match(/contents\/\.wachiman\/memory(?:\/(\S+?))?\?ref=/);
    if (memoryPath) {
      if (!memoryPath[1]) return JSON.stringify([{ type: "file", name: "index.md" }]);
      if (memoryPath[1] === "index.md") return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(memory.text).toString("base64") });
    }
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    const compare = line.match(/compare\/(\S+?)\.\.\.(\S+)/);
    if (compare) {
      // base...last is the change at the last review; last...head is what came after it.
      const files = compare[1] === BASE ? prFiles.filter((f) => !sinceLast?.some((s) => s.filename === f.filename)) : (sinceLast ?? prFiles);
      return JSON.stringify({ status: "ahead", files: files.map(file) });
    }
    throw new Error(`unexpected gh call: ${line}`);
  };
  const headDir = mkdtempSync(join(tmpdir(), "memory-holds-head-"));
  mkdirSync(join(headDir, "src"));
  for (const f of prFiles) writeFileSync(join(headDir, f.filename), "x\n");
  const provider = new FakeProvider();
  const deps: Deps = {
    gh,
    provider,
    config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "synchronize", WACHIMAN_MODEL: "claude-sonnet-5-5" }),
    repoDir: headDir,
    log: () => {},
    warn: () => {},
    lineCounter: () => 10,
    sleep: () => {},
  };
  await review(deps, "o/r", 7, []);
  return { provider, reviews, id: memory.id };
}

describe("holds while on the GitHub path covers the whole pull request", () => {
  test("a path the pull request renamed away from makes the exception stale", async () => {
    // Only the new name is listed as `filename`; the old one is `previous_filename`.
    const { provider, reviews, id } = await run("legacy/**", [{ filename: "src/a.ts", previous_filename: "legacy/gateway.ts" }]);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(reviews.join("\n")).toContain(`\`${id}\` may be out of date`);
  });

  test("on an incremental run, a holds-while path only an earlier commit touched makes the exception stale", async () => {
    // src/gateway.ts changed before the last review; the delta since it is src/a.ts alone.
    const { provider, reviews, id } = await run("src/gateway.ts", [{ filename: "src/gateway.ts" }, { filename: "src/a.ts" }], [{ filename: "src/a.ts" }]);
    expect(provider.requests.some((r) => r.prompt.includes("src/a.ts"))).toBe(true);
    expect(provider.requests.some((r) => r.prompt.includes("- src/gateway.ts +"))).toBe(false);
    expect(provider.matchingCalls).toHaveLength(0);
    expect(reviews.join("\n")).toContain(`\`${id}\` may be out of date`);
  });

  test("a holds-while path the pull request does not touch leaves the exception active", async () => {
    const { provider, reviews } = await run("src/gateway.ts", [{ filename: "src/a.ts" }]);
    expect(provider.matchingCalls).toHaveLength(1);
    expect(reviews.join("\n")).not.toContain("may be out of date");
  });
});
