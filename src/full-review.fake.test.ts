import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, marker, review, SIGNATURE, type Deps, type GhFn, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// Plan decision 13: WACHIMAN_FULL_REVIEW=1 in a dry run ignores the previous-review marker.
// In its own file: the golden prompts of engine.fake must not gain a prompt.

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  preflight() {}
  modelLabel() {
    return "Fake Model 1 via Fake CLI 0.1";
  }
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const output: ReviewOutput = {
      files_reviewed: ["src/a.ts"],
      files_skipped: [],
      findings: [],
      thread_replies: [],
      summary: "Fine.",
    };
    return { costUsd: 0.1, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

const HEAD = "head1234567";

/** A pull request whose last Wachiman review is at the head; any POST is recorded. */
function fakeGh(posts: string[]): GhFn {
  return (args) => {
    const line = args.join(" ");
    if (args.includes("POST")) {
      posts.push(line);
      return "{}";
    }
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.includes("/pulls/7/files")) return JSON.stringify({ filename: "src/a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" });
    if (line.includes("/pulls/7/reviews"))
      return JSON.stringify({ body: `👮 review\n\n<sub>m · $0.20</sub>\n\n${SIGNATURE.review}\n\n${marker(HEAD)}` });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return "b".repeat(40);
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    throw new Error(`unexpected gh call: ${line}`);
  };
}

function run(env: Record<string, string>) {
  const head = mkdtempSync(join(tmpdir(), "full-review-head-"));
  writeFileSync(join(head, "x"), "");
  const provider = new FakeProvider();
  const logs: string[] = [];
  const posts: string[] = [];
  const deps: Deps = {
    gh: fakeGh(posts),
    provider,
    config: loadConfig(env, () => {}),
    repoDir: head,
    log: (l) => logs.push(l),
    warn: () => {},
    lineCounter: () => 1,
    sleep: () => {},
  };
  review(deps, "o/r", 7, []);
  return { provider, logs: logs.join("\n"), posts };
}

describe("a dry run that ignores the previous-review marker", () => {
  test("without the flag, a reviewed head is not reviewed again", () => {
    const r = run({ WACHIMAN_DRY_RUN: "1" });
    expect(r.provider.requests).toHaveLength(0);
    expect(r.logs).toContain("Already reviewed");
  });

  test("with WACHIMAN_FULL_REVIEW=1 the head is reviewed in full, printed and not posted", () => {
    const r = run({ WACHIMAN_DRY_RUN: "1", WACHIMAN_FULL_REVIEW: "1" });
    expect(r.provider.requests).toHaveLength(1);
    expect(r.logs).not.toContain("Already reviewed");
    expect(r.logs).toContain(`--- review at ${HEAD.slice(0, 7)} ---`);
    expect(r.logs).toContain("review of the whole pull request");
    expect(r.posts).toEqual([]);
  });
});
