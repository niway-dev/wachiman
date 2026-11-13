import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, SIZE_GATE_MARKER, readAutoCost, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// The size gate: a pull request whose estimate is above the gate is not reviewed, spends nothing
// and gets one comment, updated on each push. The estimate is priced from the diff alone.

const BASE = "b".repeat(40);
const HEAD = "abc1234" + "0".repeat(33);

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
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const files = [...request.prompt.split("This part holds exactly these files")[1].split("\n\n")[0].matchAll(/^- (\S+) \+/gm)].map((m) => m[1]);
    const output: ReviewOutput = { files_reviewed: files, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "ok" };
    return { costUsd: 0.2, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

/** One file of `lines` added lines, each in its own directory so no two share a module. */
const bigFile = (i: number, lines = 1000) => ({
  filename: `pkg${i}/mod.ts`,
  additions: lines,
  deletions: 0,
  patch: `@@ -0,0 +1,${lines} @@\n${Array.from({ length: lines }, (_, k) => `+line ${k}`).join("\n")}`,
});

interface Comment {
  id: number;
  user: { login: string };
  body: string;
}

/** A pull request as GitHub shows it, and every write the engine made to it. */
function world(files: unknown[], comments: Comment[] = []) {
  const calls: string[] = [];
  const posted: { kind: "comment" | "patch" | "review"; target?: number; body: string }[] = [];
  let listed = 0;
  const gh: GhFn = (args, input) => {
    const line = args.join(" ");
    calls.push(line);
    if (line.startsWith("pr comment")) {
      posted.push({ kind: "comment", body: input ?? "" });
      return "";
    }
    if (args.includes("PATCH")) {
      const id = Number(line.match(/issues\/comments\/(\d+)/)?.[1]);
      posted.push({ kind: "patch", target: id, body: args[args.length - 1].replace(/^body=/, "") });
      return "{}";
    }
    if (args.includes("POST")) {
      if (line.includes("/pulls/7/reviews")) posted.push({ kind: "review", body: JSON.parse(input ?? "{}").body });
      return "{}";
    }
    if (line.includes("/issues/7/comments")) {
      listed += 1;
      // `gh --jq` already applied the bot filter and the projection; mirror that here.
      return comments
        .filter((c) => c.user.login === "github-actions[bot]")
        .map((c) => JSON.stringify({ id: c.id, body: c.body }))
        .join("\n");
    }
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.includes("/pulls/7/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews") || line.includes("/pulls/7/comments")) return "";
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    const compare = line.match(/compare\/(\S+?)\.\.\.(\S+)/);
    if (compare) return JSON.stringify({ status: "ahead", files });
    throw new Error(`unexpected gh call: ${line}`);
  };
  return { gh, calls, posted, listCalls: () => listed };
}

function run(w: ReturnType<typeof world>, env: Record<string, string> = {}, words: string[] = []) {
  const provider = new FakeProvider();
  const logs: string[] = [];
  const deps: Deps = {
    gh: w.gh,
    provider,
    config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "synchronize", WACHIMAN_MODEL: "claude-sonnet-5-5", ...env }),
    repoDir: mkdtempSync(join(tmpdir(), "size-gate-head-")),
    log: (l) => void logs.push(l),
    warn: () => {},
    lineCounter: () => 100,
    sleep: () => {},
  };
  review(deps, "o/r", 7, words);
  return { provider, logs: logs.join("\n") };
}

/** 30 files of 1,000 lines: 30 batches, about $9.60 at the Sonnet figure, above the $6 default gate. */
const LARGE = Array.from({ length: 30 }, (_, i) => bigFile(i));
const SMALL = [bigFile(0, 20), bigFile(1, 20)];

describe("a pull request above the size gate is skipped with one comment", () => {
  test("no model call, one comment with the marker, no review and no review marker", () => {
    const w = world(LARGE);
    const { provider, logs } = run(w);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted).toHaveLength(1);
    const [comment] = w.posted;
    expect(comment.kind).toBe("comment");
    expect(comment.body).toContain(SIZE_GATE_MARKER);
    expect(comment.body).toContain("Not reviewed: this pull request is above the size gate.");
    expect(comment.body).not.toContain("wachiman sha=");
    expect(w.posted.some((p) => p.kind === "review")).toBe(false);
    expect(logs).toContain("size gate");
  });

  test("the comment is exactly this", () => {
    const w = world(LARGE);
    run(w);
    expect(w.posted[0].body).toBe(
      [
        "👮 **Wachiman** · **Not reviewed: this pull request is above the size gate.** Reviewing all of it would cost about **$9.60**, and the gate is **$6.00**, so nothing was sent to a model and nothing was spent.",
        "The estimate: 30 batches × $0.32 a batch for `claude-sonnet-5-5` (30 files, 30,000 changed lines), from the diff alone, before any model call. It can be off by about 40% either way.",
        "To review the whole pull request, set the run budget in the workflow that calls Wachiman, then comment `/wachiman review`:",
        "```yaml\n    with:\n      budget_usd: 15\n```",
        "A `budget_usd` at or above the estimate lifts the gate for that run. To have pushes reviewed automatically as well, also set `auto_budget_usd: 15`. To review part of it now, comment `/wachiman review <path> [path…]`.",
        "<sub>Estimated at `abc1234`. This comment is updated on each push instead of a new one.</sub>",
        SIZE_GATE_MARKER,
      ].join("\n\n"),
    );
  });

  test("the comment carries no cost line, so the per-pull-request ceiling does not count it", () => {
    const w = world(LARGE);
    run(w);
    expect(readAutoCost(w.posted[0].body)).toBeNull();
  });

  test("an existing comment of the bot is updated, not duplicated", () => {
    const w = world(LARGE, [
      { id: 11, user: { login: "github-actions[bot]" }, body: `old\n\n${SIZE_GATE_MARKER}` },
      { id: 12, user: { login: "github-actions[bot]" }, body: `newer\n\n${SIZE_GATE_MARKER}` },
    ]);
    run(w);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]).toMatchObject({ kind: "patch", target: 12 });
    expect(w.posted[0].body).toContain("Not reviewed");
    expect(w.posted.filter((p) => p.kind === "comment")).toHaveLength(0);
  });

  test("a marker planted by a person is ignored: the bot posts its own comment", () => {
    const w = world(LARGE, [{ id: 5, user: { login: "someone" }, body: `fake\n\n${SIZE_GATE_MARKER}` }]);
    run(w);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].kind).toBe("comment");
  });

  test("a dry run logs the comment and calls no write", () => {
    const w = world(LARGE);
    const { logs } = run(w, { WACHIMAN_DRY_RUN: "1" });
    expect(logs).toContain("--- size gate comment ---");
    expect(w.posted).toHaveLength(0);
    expect(w.calls.some((c) => c.includes("/issues/7/comments"))).toBe(false);
  });

  test("a scoped run is estimated on the scoped files only", () => {
    const w = world(LARGE);
    const { provider } = run(w, { WACHIMAN_TRIGGER: "comment" }, ["pkg0/mod.ts"]);
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(w.posted.some((p) => p.body.includes(SIZE_GATE_MARKER))).toBe(false);
  });
});

describe("the gate lifts", () => {
  test("a raised WACHIMAN_SIZE_GATE_USD reviews the pull request", () => {
    const w = world(LARGE);
    const { provider } = run(w, { WACHIMAN_SIZE_GATE_USD: "10" });
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(w.posted.some((p) => p.kind === "review")).toBe(true);
    expect(w.posted.some((p) => p.body.includes(SIZE_GATE_MARKER))).toBe(false);
  });

  test("budget_usd alone lifts the gate for /wachiman review, but not for an automatic run", () => {
    const env = { WACHIMAN_BUDGET_USD: "12" };
    const operator = world(LARGE);
    const a = run(operator, { ...env, WACHIMAN_TRIGGER: "comment" });
    expect(a.provider.requests.length).toBeGreaterThan(0);
    expect(operator.posted.some((p) => p.body.includes(SIZE_GATE_MARKER))).toBe(false);

    const automatic = world(LARGE);
    const b = run(automatic, env);
    expect(b.provider.requests).toHaveLength(0);
    expect(automatic.posted.map((p) => p.kind)).toEqual(["comment"]);

    const both = world(LARGE);
    const c = run(both, { ...env, WACHIMAN_AUTO_BUDGET_USD: "12" });
    expect(c.provider.requests.length).toBeGreaterThan(0);
  });
});

describe("a pull request below the gate is reviewed as before", () => {
  test("it never lists the issue comments", () => {
    const w = world(SMALL);
    const { provider } = run(w);
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(w.listCalls()).toBe(0);
    expect(w.posted.some((p) => p.kind === "review")).toBe(true);
  });
});
