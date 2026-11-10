import { describe, expect, test } from "bun:test";
import { loadConfig as loadConfigWithDefaults } from "./config";

/** These tests script the batches only; the opt-in verifier has its own tests. */
const loadConfig = (env: Record<string, string | undefined>) => loadConfigWithDefaults({ AGENT_REVIEW_VERIFY: "0", ...env });
import {
  GhError,
  SIGNATURE,
  automaticSpend,
  buildReview,
  marker,
  neutralise,
  readAutoCost,
  readCeilingNotice,
  review,
  type Deps,
  type GhFn,
  type ReviewOutput,
} from "./engine";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { CodexProvider } from "./providers/codex";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";
import { checkGoldenPrompts, recordPrompt } from "../test/support/golden-prompts";

// ADR 0012, part A: one ceiling for all automatic runs on a pull request, summed from the
// engine's own signed footers.

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly script: ((request: ProviderRequest) => Partial<ProviderResult>)[]) {}
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    recordPrompt("ceiling.fake", request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
}

checkGoldenPrompts("ceiling.fake");

const out = (over: Partial<ReviewOutput>): ReviewOutput => ({
  files_reviewed: ["a.ts"],
  files_skipped: [],
  findings: [],
  contracts: [],
  thread_replies: [],
  summary: "ok",
  ...over,
});

/** A review body as the engine writes it for a run that spent `cost`. */
const spentBody = (cost: number, opts: { auto?: boolean; marker?: string; attempt?: boolean } = {}) =>
  [
    "👮 **Wachiman** · review of the whole pull request: all 1 files reviewed.",
    `<sub>Fake Model · effort high · $${cost.toFixed(2)}</sub>`,
    ...(opts.auto === false ? [] : [SIGNATURE.auto]),
    SIGNATURE.review,
    ...(opts.marker ? [marker(opts.marker)] : []),
    ...(opts.attempt ? ["<!-- wachi:attempt id=11111111-1111-1111-1111-111111111111 -->"] : []),
  ].join("\n\n");

const replyBody = (cost: number) =>
  `👮 **Wachiman** · **Still applies** at \`head123\`: no.\n\n<sub>Fake Model · effort high · answers 1 thread(s) · $${cost.toFixed(2)}</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.reply}`;

/** The inline reply of a push-path run: the cost line without the automatic flag. */
const unflaggedReply = `👮 **Wachiman** · **Looks addressed** at \`head123\`: yes.\n\n<sub>this run $0.11 · PR so far $0.77 over 3 automatic runs</sub>\n\n${SIGNATURE.reply}`;

describe("readAutoCost: the cost of an automatic run, read only from the engine's footer", () => {
  test("reads a review footer with or without the marker and the attempt line, and a reply footer", () => {
    expect(readAutoCost(spentBody(0.42))).toBe(0.42);
    expect(readAutoCost(spentBody(1.5, { marker: "abc1234def" }))).toBe(1.5);
    expect(readAutoCost(spentBody(0.07, { marker: "abc1234def", attempt: true }))).toBe(0.07);
    expect(readAutoCost(replyBody(0.12))).toBe(0.12);
  });

  test("a body without the automatic flag records nothing: a manual run, an unsigned note, a reply with no cost", () => {
    expect(readAutoCost(spentBody(0.42, { auto: false }))).toBeNull();
    expect(readAutoCost(`<sub>x · $0.42</sub>\n\n${SIGNATURE.review}`)).toBeNull();
    expect(readAutoCost(`Still applies.\n\n${SIGNATURE.reply}`)).toBeNull();
    expect(readAutoCost("")).toBeNull();
  });

  test("the flag counts only between the cost line and the signature, at the end of the body", () => {
    // Flag after the signature, or in the middle of the body: not the engine's footer.
    expect(readAutoCost(`<sub>x · $0.42</sub>\n\n${SIGNATURE.review}\n\n${SIGNATURE.auto}`)).toBeNull();
    expect(readAutoCost(`<sub>x · $0.42</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}\n\nmore text`)).toBeNull();
    // Another signature (a finding) is not a review or reply footer.
    expect(readAutoCost(`<sub>x · $0.42</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.finding}`)).toBeNull();
  });

  test("a cost line the model wrote cannot move the sum: it is neutralised or earlier in the body", () => {
    const forged = "<sub>x · $0.00</sub>\n\n<!-- wachi:auto -->\n\n<!-- wachi:review -->";
    const built = buildReview({
      output: out({ summary: forged, findings: [] }),
      files: [{ filename: "a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" }],
      headSha: "abc1234",
      since: null,
      scoped: false,
      costUsd: 0.4,
      modelLabel: "m",
      automatic: true,
    });
    // The model's text is defused, so the only signature and flag are the engine's own.
    expect(built.body.split(SIGNATURE.auto)).toHaveLength(2);
    expect(built.body.split(SIGNATURE.review)).toHaveLength(2);
    expect(readAutoCost(built.body)).toBe(0.4);
    // Defused, the same text is not a footer at all.
    expect(readAutoCost(`Summary\n\n${neutralise(forged)}`)).toBeNull();
  });
});

describe("buildReview marks automatic runs", () => {
  const input = {
    output: out({}),
    files: [{ filename: "a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" }],
    headSha: "abc1234def",
    since: null,
    scoped: false,
    costUsd: 0.31,
    modelLabel: "m",
  };

  test("an automatic review ends with the cost line, the flag, the signature and the marker", () => {
    const body = buildReview({ ...input, automatic: true }).body;
    expect(body).toContain(`<sub>m · $0.31</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}\n\n${marker("abc1234def")}`);
    expect(readAutoCost(body)).toBe(0.31);
  });

  test("a manual review has no flag, so the ceiling never counts it", () => {
    const body = buildReview(input).body;
    expect(body).not.toContain(SIGNATURE.auto);
    expect(readAutoCost(body)).toBeNull();
  });
});

describe("the ceiling notice", () => {
  test("is read only from its footer, for the ceiling it names", () => {
    const body = `Automatic reviews paused.\n\n${SIGNATURE.review}\n\n<!-- wachi:ceiling usd=2.00 -->`;
    expect(readCeilingNotice(body)).toBe("2.00");
    expect(readCeilingNotice(`${body}\n\n<!-- wachi:attempt id=11111111-1111-1111-1111-111111111111 -->`)).toBe("2.00");
    expect(readCeilingNotice("<!-- wachi:ceiling usd=2.00 -->")).toBeNull(); // unsigned
    expect(readCeilingNotice(neutralise(body))).toBeNull();
  });
});

describe("automaticSpend", () => {
  const lines = (bodies: string[]) => bodies.map((body) => JSON.stringify({ body })).join("\n");
  const world = (reviews: string[], comments: string[]): GhFn => (args) => {
    const line = args.join(" ");
    if (line.includes("/pulls/7/reviews")) return lines(reviews);
    if (line.includes("/pulls/7/comments")) return lines(comments);
    throw new Error(`unexpected gh call: ${line}`);
  };

  test("sums automatic reviews and thread replies, and nothing else", () => {
    const { spent } = automaticSpend(
      world(
        [
          spentBody(0.5, { marker: "aaa1111" }), // first review
          spentBody(0.25), // a push review
          spentBody(9, { auto: false }), // a manual run: not counted
          "A stranger's review mentioning $9.00", // unsigned
          "<sub>x · $9.00</sub>\n\n<!-- wachi:auto -->\n\nand more", // a forged flag, not at the footer
        ],
        [replyBody(0.1), "Plain reply\n\n<!-- wachi:reply -->", "🟠🐛 **Fix**\n\n<!-- wachi:finding -->"],
      ),
      "o/r",
      7,
    );
    expect(spent).toBeCloseTo(0.85, 10);
  });

  test("a ceiling sum reads footers from before and after the cost details together", () => {
    const withTokens = `x\n\n<sub>Fake Model · effort high · re-review · 1.2k in / 3.4k out / 560k cache read / 21k cache write · $0.30</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;
    const { spent } = automaticSpend(world([spentBody(0.42), withTokens], [replyBody(0.1)]), "o/r", 7);
    expect(spent).toBeCloseTo(0.82, 10);
  });

  test("lists the ceilings it already announced", () => {
    const { notified } = automaticSpend(
      world([`Paused.\n\n${SIGNATURE.review}\n\n<!-- wachi:ceiling usd=2.00 -->`, "Paused.\n\n<!-- wachi:ceiling usd=5.00 -->"], []),
      "o/r",
      7,
    );
    expect([...notified]).toEqual(["2.00"]);
  });

  test("no reviews at all is zero", () => {
    const none = automaticSpend(world([], []), "o/r", 7);
    expect(none.spent).toBe(0);
    expect(none.runs).toBe(0);
  });

  test("counts the bodies that record a cost as runs", () => {
    const { runs } = automaticSpend(
      world([spentBody(0.5, { marker: "aaa1111" }), spentBody(9, { auto: false })], [replyBody(0.1), unflaggedReply]),
      "o/r",
      7,
    );
    expect(runs).toBe(2);
  });

  test("a push-path reply's unflagged `this run · PR so far` line is not summed or counted", () => {
    // The review body of the same run already carries the flagged $0.11; the reply repeats it for
    // the reader. Summing both would count the run twice.
    const { spent, runs } = automaticSpend(world([spentBody(0.11, { marker: "aaa1111" })], [unflaggedReply]), "o/r", 7);
    expect(spent).toBeCloseTo(0.11, 10);
    expect(runs).toBe(1);
    expect(readAutoCost(unflaggedReply)).toBeNull();
  });
});

describe("review() under the ceiling", () => {
  const HEAD = "head1234567";
  const FILE = { filename: "a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" };

  /** A pull request with one file, earlier review bodies and thread-reply comments; POSTed reviews are appended. */
  function setup(opts: {
    reviews?: string[];
    comments?: string[];
    env?: Record<string, string>;
    compare?: unknown;
    script?: ((request: ProviderRequest) => Partial<ProviderResult>)[];
  }) {
    const reviews = [...(opts.reviews ?? [])];
    const calls: string[] = [];
    const posted: string[] = [];
    const gh: GhFn = (args, input) => {
      const line = args.join(" ");
      calls.push(line);
      if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
      if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
      if (line.includes("/pulls/7/files")) return JSON.stringify(FILE);
      if (line.includes("/pulls/7/reviews") && !args.includes("POST"))
        return reviews.map((body) => JSON.stringify({ body, submitted_at: "2026-11-02T00:00:00Z" })).join("\n");
      if (line.includes("/pulls/7/comments") && !args.includes("POST"))
        return (opts.comments ?? []).map((body) => JSON.stringify({ body })).join("\n");
      if (line.includes("-X POST repos/o/r/pulls/7/reviews")) {
        const body = JSON.parse(input ?? "{}").body as string;
        posted.push(body);
        reviews.push(body);
        return "{}";
      }
      // What the pull request changed up to the last review: nothing, so the file counts as changed since.
      if (line.includes(`/compare/${"b".repeat(40)}...`)) return JSON.stringify({ status: "ahead", files: [] });
      if (line.includes("/compare/")) return JSON.stringify(opts.compare);
      if (line.startsWith("api repos/o/r/pulls/7 ")) return "b".repeat(40);
      if (line.startsWith("api graphql"))
        return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
      throw new Error(`unexpected gh call: ${line}`);
    };
    const provider = new FakeProvider(
      opts.script ?? [() => ({ costUsd: 0.1, structuredOutput: out({}) })],
    );
    const deps: Deps = {
      gh,
      provider,
      config: loadConfig(opts.env ?? {}),
      log: () => {},
      warn: () => {},
      sleep: () => {},
    };
    return { deps, provider, posted, calls, reviews };
  }

  test("an automatic run records its cost and the flag in the footer", () => {
    const t = setup({ env: { AGENT_REVIEW_TRIGGER: "opened" } });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(readAutoCost(t.posted[0])).toBeCloseTo(0.1, 10);
  });

  const USAGE = { input: 1200, output: 3400, cacheRead: 560000, cacheWrite: 21000 };

  test("a first review reports its operation, tokens and cost in the footer, the log and the recorded calls", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "opened" },
      script: [() => ({ costUsd: 0.1, model: "claude-sonnet-5-5", usage: USAGE, structuredOutput: out({}) })],
    });
    const logs: string[] = [];
    t.deps.log = (line) => void logs.push(line);
    t.deps.costs = [];
    review(t.deps, "o/r", 7, []);
    expect(t.posted[0]).toContain(
      "<sub>Fake Model · effort high · review · PR so far $0.10 over 1 automatic run · 1.2k in / 3.4k out / 560k cache read / 21k cache write · $0.10</sub>",
    );
    expect(readAutoCost(t.posted[0])).toBeCloseTo(0.1, 10);
    expect(t.deps.costs).toEqual([
      {
        operation: "review",
        label: "batch 1/1",
        model: "claude-sonnet-5-5",
        turns: 1,
        durationMs: 1,
        usage: USAGE,
        costUsd: 0.1,
        terminalReason: "success",
        repo: "o/r",
        pr: 7,
      },
    ]);
    const costLines = logs.filter((l) => l.startsWith("wachiman-cost "));
    expect(costLines).toHaveLength(1);
    expect(JSON.parse(costLines[0].slice("wachiman-cost ".length))).toMatchObject({
      operation: "review",
      pr: 7,
      trigger: "opened",
      cache_read_tokens: 560000,
      cost_usd: 0.1,
    });
  });

  test("a push after a reviewed commit is a re-review, and the retry call is tagged in the recorded calls", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "synchronize" },
      reviews: [spentBody(0.2, { marker: "aaa1111" })],
      compare: { status: "ahead", files: [{ filename: "a.ts", patch: FILE.patch }] },
      // The first call leaves a.ts unaccounted for, so the engine retries it once.
      script: [
        () => ({ costUsd: 0.1, usage: USAGE, structuredOutput: out({ files_reviewed: [] }) }),
        () => ({ costUsd: 0.05, usage: USAGE, structuredOutput: out({}) }),
      ],
    });
    t.deps.costs = [];
    review(t.deps, "o/r", 7, []);
    expect(t.deps.costs?.map((c) => [c.operation, c.label])).toEqual([
      ["re-review", "batch 1/1"],
      ["re-review", "batch 1/1 retry"],
    ]);
    // The earlier review cost $0.20, so this $0.15 run brings the pull request to $0.35 over 2 runs.
    expect(t.posted[0]).toContain(
      "effort high · re-review · PR so far $0.35 over 2 automatic runs · 2.4k in / 6.8k out / 1.1M cache read / 42k cache write · $0.15</sub>",
    );
    expect(readAutoCost(t.posted[0])).toBe(0.15);
  });

  test("a provider that reports no tokens or model still yields a footer, a record and a log line", () => {
    const t = setup({ env: { AGENT_REVIEW_TRIGGER: "opened" } });
    t.deps.costs = [];
    review(t.deps, "o/r", 7, []);
    expect(t.posted[0]).toContain("<sub>Fake Model · effort high · review · PR so far $0.10 over 1 automatic run · $0.10</sub>");
    expect(t.deps.costs?.[0]).toMatchObject({ model: t.deps.config.model, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  });

  test("a call that dies without a result is recorded and logged as an unknown cost, counted at its cap", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "opened" },
      script: [
        () => {
          throw new Error("claude exited with signal SIGKILL");
        },
      ],
    });
    const logs: string[] = [];
    t.deps.log = (line) => void logs.push(line);
    t.deps.costs = [];
    // No batch returned anything, so the review fails; the dead call is still on the record.
    expect(() => review(t.deps, "o/r", 7, [])).toThrow("did not return a review");
    // The engine retries the batch's files once; that call dies too, and is recorded the same way.
    expect(t.deps.costs?.map((c) => [c.label, c.costKnown])).toEqual([
      ["batch 1/1", false],
      ["batch 1/1 retry", false],
    ]);
    const dead = t.deps.costs?.[0];
    expect(dead).toMatchObject({ operation: "review", label: "batch 1/1", costKnown: false, pr: 7, turns: 0 });
    expect(dead?.costUsd).toBeGreaterThan(0);
    const lines = logs.filter((l) => l.startsWith("wachiman-cost "));
    expect(lines).toHaveLength(2);
    const json = JSON.parse(lines[0].slice("wachiman-cost ".length));
    expect(json).toMatchObject({ operation: "review", costKnown: false, cost_usd: null, countedUsd: dead?.costUsd });
    expect(json.terminal_reason).toContain("no result");
    expect(dead?.costUsd).toBe(t.deps.config.batchBudgetUsd);
  });

  test("a result flagged costKnown false is counted at the request's cap in the footer and the ceiling", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "opened" },
      script: [() => ({ costUsd: 0, costKnown: false, structuredOutput: out({}) })],
    });
    t.deps.costs = [];
    review(t.deps, "o/r", 7, []);
    const cap = t.deps.config.batchBudgetUsd;
    expect(readAutoCost(t.posted[0])).toBeCloseTo(cap, 2);
    expect(t.deps.costs?.[0]).toMatchObject({ costKnown: false, costUsd: cap });
  });

  /** A shell stand-in for an agent CLI that never answers. */
  const hangingBinary = (name: string) => {
    const path = join(mkdtempSync(join(tmpdir(), `stub-${name}-`)), name);
    writeFileSync(path, "#!/bin/sh\ncat >/dev/null\nsleep 30\n");
    chmodSync(path, 0o755);
    return path;
  };

  for (const kind of ["claude", "codex"] as const) {
    test(`a ${kind} call killed at the time limit is an unknown cost counted at the batch cap, with its reason kept`, () => {
      const t = setup({ env: { AGENT_REVIEW_TRIGGER: "opened", AGENT_REVIEW_CALL_TIMEOUT_S: "1" } });
      const binary = hangingBinary(kind);
      t.deps.provider =
        kind === "claude"
          ? new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary })
          : new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: false, binary });
      const logs: string[] = [];
      t.deps.log = (line) => void logs.push(line);
      t.deps.costs = [];
      try {
        review(t.deps, "o/r", 7, []);
      } catch {
        // No batch returned a review; the point is what was recorded.
      }
      const cap = t.deps.config.batchBudgetUsd;
      expect(t.deps.costs?.length).toBeGreaterThan(0);
      for (const c of t.deps.costs ?? []) {
        expect(c).toMatchObject({ costKnown: false, costUsd: cap, terminalReason: "timeout" });
      }
      const json = JSON.parse(logs.filter((l) => l.startsWith("wachiman-cost "))[0].slice("wachiman-cost ".length));
      expect(json).toMatchObject({ costKnown: false, cost_usd: null, countedUsd: cap, terminal_reason: "timeout" });
      // Whatever was posted records the cap, never $0.00.
      for (const body of t.posted) expect(readAutoCost(body)).toBeCloseTo(cap * (t.deps.costs?.length ?? 1), 2);
    });
  }

  test("at the ceiling the next push posts one notice, starts no batch, and a later push posts nothing", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "synchronize", AGENT_REVIEW_AUTO_BUDGET_USD: "0.5" },
      reviews: [spentBody(0.5)],
    });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("Automatic reviews paused: $0.50 of $0.50 spent on this pull request.");
    expect(t.posted[0]).toContain("Comment `/wachiman review` to review now.");
    expect(readCeilingNotice(t.posted[0].trimEnd().replace(/\n\n<!-- wachi:attempt id=[0-9a-f-]+ -->$/, ""))).toBe("0.50");

    // The next push: the notice for this ceiling already exists.
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(1);
  });

  test("raising the ceiling above the spend lets the next push run; a still-lower ceiling gets its own notice", () => {
    const base = { AGENT_REVIEW_TRIGGER: "synchronize" };
    const paused = setup({ env: { ...base, AGENT_REVIEW_AUTO_BUDGET_USD: "0.5" }, reviews: [spentBody(0.5)] });
    review(paused.deps, "o/r", 7, []);
    expect(paused.posted).toHaveLength(1);
    // The same pull request, now with a ceiling of $0.60 and the old $0.50 notice: $0.10 is left, so it runs.
    const raised = setup({ env: { ...base, AGENT_REVIEW_AUTO_BUDGET_USD: "0.6" }, reviews: paused.reviews });
    review(raised.deps, "o/r", 7, []);
    expect(raised.provider.requests).toHaveLength(1);
    // A $0.55 ceiling with $0.60 spent: a notice for that ceiling, not skipped because of the old $0.50 one.
    const again = setup({ env: { ...base, AGENT_REVIEW_AUTO_BUDGET_USD: "0.55" }, reviews: [...paused.reviews, spentBody(0.1)] });
    review(again.deps, "o/r", 7, []);
    expect(again.provider.requests).toHaveLength(0);
    expect(again.posted).toHaveLength(1);
    expect(again.posted[0]).toContain("$0.60 of $0.55 spent");
  });

  test("a run starts with at most what is left under the ceiling", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "synchronize", AGENT_REVIEW_AUTO_BUDGET_USD: "2" },
      reviews: [spentBody(1.2, { marker: "aaa1111" }), spentBody(0.5)],
      comments: [replyBody(0)],
      compare: { status: "ahead", files: [{ filename: "a.ts", patch: FILE.patch }] },
    });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.provider.requests[0].maxBudgetUsd).toBeCloseTo(0.3, 10);
  });

  test("less than a batch's minimum left counts as the ceiling", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "synchronize", AGENT_REVIEW_AUTO_BUDGET_USD: "2" },
      reviews: [spentBody(1.97)],
    });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted[0]).toContain("$1.97 of $2.00");
  });

  test("the operator's /wachiman review is not limited, and does not even read the spend", () => {
    for (const trigger of [undefined, "comment"]) {
      const t = setup({
        env: { AGENT_REVIEW_AUTO_BUDGET_USD: "0.5", ...(trigger ? { AGENT_REVIEW_TRIGGER: trigger } : {}) },
        reviews: [spentBody(5)],
      });
      const before = t.calls.length;
      review(t.deps, "o/r", 7, []);
      expect(t.provider.requests).toHaveLength(1);
      // Its budget is the run's own, not what is left of the ceiling.
      expect(t.provider.requests[0].maxBudgetUsd).toBe(0.75);
      expect(t.posted[0]).not.toContain("Automatic reviews paused");
      expect(readAutoCost(t.posted[0])).toBeNull();
      expect(t.calls.slice(before).some((c) => c.includes("/pulls/7/comments"))).toBe(false);
    }
  });

  test("a push that is only a rebase still moves the marker at the ceiling, and posts no notice", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "synchronize", AGENT_REVIEW_AUTO_BUDGET_USD: "0.5" },
      reviews: [spentBody(0.5, { marker: "old1111111" })],
      compare: { status: "ahead", files: [] },
    });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("no new changes since");
    expect(t.posted[0]).toContain(marker(HEAD));
    expect(t.posted[0]).not.toContain("paused");
  });

  test("an automatic run that ends without a review still records what it spent", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "synchronize" },
      script: [
        () => ({ costUsd: 0.6, terminalReason: "budget", isError: true }),
        () => ({ costUsd: 0.4, terminalReason: "budget", isError: true }),
      ],
    });
    review(t.deps, "o/r", 7, []);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("ran out of its budget");
    expect(readAutoCost(t.posted[0])).toBeGreaterThan(0.5);
    // A manual run in the same situation keeps its old, unsigned notice.
    const manual = setup({ script: [() => ({ costUsd: 0.6, terminalReason: "budget", isError: true }), () => ({ costUsd: 0.4, terminalReason: "budget", isError: true })] });
    review(manual.deps, "o/r", 7, []);
    expect(manual.posted[0]).toContain("ran out of its budget");
    expect(manual.posted[0]).not.toContain(SIGNATURE.auto);
  });

  test("a marker-less partial review's spend still counts toward the next automatic run", () => {
    const t = setup({
      env: { AGENT_REVIEW_TRIGGER: "synchronize", AGENT_REVIEW_AUTO_BUDGET_USD: "0.3" },
      script: [() => ({ costUsd: 0.25, structuredOutput: out({ files_reviewed: [] }) }), () => ({ costUsd: 0, structuredOutput: out({ files_reviewed: [] }) })],
    });
    review(t.deps, "o/r", 7, []);
    expect(t.posted[0]).toContain("Partial review");
    expect(t.posted[0]).not.toContain("<!-- agent-review sha=");
    // The partial review's cost is in its footer: $0.05 is left of $0.30, i.e. a batch can still start.
    const next = setup({ env: { AGENT_REVIEW_TRIGGER: "synchronize", AGENT_REVIEW_AUTO_BUDGET_USD: "0.3" }, reviews: t.reviews });
    expect(automaticSpend(next.deps.gh, "o/r", 7).spent).toBeCloseTo(0.25, 10);
  });
});
