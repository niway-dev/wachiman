import { describe, expect, test } from "bun:test";
import {
  NO_USAGE,
  addUsage,
  costLine,
  costLogLine,
  formatTokens,
  renderCostSummary,
  writeStepSummary,
  type CallCost,
} from "./cost";
import { SIGNATURE, readAutoCost } from "./engine";
import { tokenUsageOf } from "./providers/codex";
import { usageOf } from "./providers/claude-code";

const call = (over: Partial<CallCost> = {}): CallCost => ({
  operation: "review",
  label: "batch 1/2",
  model: "claude-sonnet-5-5",
  turns: 7,
  durationMs: 41000,
  usage: { input: 1200, output: 3400, cacheRead: 560000, cacheWrite: 21000 },
  costUsd: 0.4321,
  terminalReason: "success",
  repo: "o/r",
  pr: 7,
  ...over,
});

describe("usage parsing", () => {
  test("Claude Code's usage object maps the four counts, cache fields included", () => {
    expect(
      usageOf({
        usage: {
          input_tokens: 12,
          output_tokens: 345,
          cache_read_input_tokens: 6789,
          cache_creation_input_tokens: 1011,
        },
      }),
    ).toEqual({ input: 12, output: 345, cacheRead: 6789, cacheWrite: 1011 });
  });

  test("a missing usage object, missing fields or junk values degrade to 0", () => {
    expect(usageOf({})).toEqual(NO_USAGE);
    expect(usageOf({ usage: { output_tokens: 5 } })).toEqual({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 });
    expect(usageOf({ usage: { input_tokens: -3, output_tokens: Number.NaN } as never })).toEqual(NO_USAGE);
  });

  test("Codex's cached input becomes cache read and leaves input", () => {
    expect(tokenUsageOf({ input_tokens: 39761, cached_input_tokens: 25728, output_tokens: 241 })).toEqual({
      input: 14033,
      output: 241,
      cacheRead: 25728,
      cacheWrite: 0,
    });
    expect(tokenUsageOf({ input_tokens: 10, output_tokens: 1 })).toEqual({ input: 10, output: 1, cacheRead: 0, cacheWrite: 0 });
  });

  test("addUsage sums field by field", () => {
    expect(addUsage({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 })).toEqual({
      input: 11,
      output: 22,
      cacheRead: 33,
      cacheWrite: 44,
    });
  });
});

describe("the footer cost line", () => {
  test("keeps the old shape when nothing but a cost is known", () => {
    expect(costLine({ modelLabel: "m", effort: "high", costUsd: 0.31 })).toBe("<sub>m · effort high · $0.31</sub>");
  });

  test("adds the operation and tokens before the dollars, and the ceiling still reads the dollars", () => {
    const line = costLine({
      modelLabel: "Claude Sonnet 5.5 via Claude Code 2.1.304",
      effort: "high",
      operation: "re-review",
      extra: ["2 batches"],
      usage: { input: 1200, output: 3400, cacheRead: 560000, cacheWrite: 21000 },
      costUsd: 1.234,
    });
    expect(line).toBe(
      "<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · re-review · 2 batches · 1.2k in / 3.4k out / 560k cache read / 21k cache write · $1.23</sub>",
    );
    const body = `x\n\n${line}\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;
    expect(readAutoCost(body)).toBe(1.23);
    const reply = `x\n\n${costLine({ modelLabel: "m", operation: "reply", extra: ["answers 1 thread(s)"], usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8 }, costUsd: 0.12 })}\n\n${SIGNATURE.auto}\n\n${SIGNATURE.reply}`;
    expect(readAutoCost(reply)).toBe(0.12);
  });

  test("the ceiling still reads a footer written before this change", () => {
    const old = `x\n\n<sub>Fake Model · effort high · 2 batches · $0.42</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;
    expect(readAutoCost(old)).toBe(0.42);
  });

  test("a subscription run says the amount is an estimate, before the figure the ceiling reads", () => {
    const line = costLine({ modelLabel: "m", effort: "high", operation: "review", estimate: true, costUsd: 0.31 });
    expect(line).toBe("<sub>m · effort high · review · Claude subscription: API-equivalent estimate, not a bill · $0.31</sub>");
    const body = `x\n\n${line}\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;
    // Exactly what an API-key footer of the same amount reads.
    const keyed = `x\n\n${costLine({ modelLabel: "m", effort: "high", operation: "review", costUsd: 0.31 })}\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;
    expect(readAutoCost(body)).toBe(0.31);
    expect(readAutoCost(body)).toBe(readAutoCost(keyed));
    const reply = `x\n\n${costLine({ modelLabel: "m", operation: "reply", extra: ["answers 1 thread(s)"], estimate: true, costUsd: 0.12 })}\n\n${SIGNATURE.auto}\n\n${SIGNATURE.reply}`;
    expect(readAutoCost(reply)).toBe(0.12);
  });

  test("formats token counts", () => {
    expect([0, 842, 1500, 12345, 999999, 4_100_000].map(formatTokens)).toEqual(["0", "842", "1.5k", "12k", "1000k", "4.1M"]);
  });
});

describe("the machine-readable log line", () => {
  test("is prefixed, one line, and parses back to the call's numbers", () => {
    const line = costLogLine(call(), { trigger: "synchronize" });
    expect(line.startsWith("wachiman-cost {")).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice("wachiman-cost ".length))).toEqual({
      operation: "review",
      label: "batch 1/2",
      repo: "o/r",
      pr: 7,
      trigger: "synchronize",
      model: "claude-sonnet-5-5",
      turns: 7,
      duration_ms: 41000,
      input_tokens: 1200,
      output_tokens: 3400,
      cache_read_tokens: 560000,
      cache_write_tokens: 21000,
      costKnown: true,
      cost_usd: 0.4321,
      terminal_reason: "success",
      auth: "api-key",
    });
  });

  test("carries the credential of the run, so a subscription estimate is never summed as spend by mistake", () => {
    for (const auth of ["api-key", "oauth-token", "subscription"] as const) {
      const line = costLogLine(call({ auth }));
      expect(JSON.parse(line.slice("wachiman-cost ".length)).auth).toBe(auth);
    }
  });
});

describe("the log line of an unknown cost", () => {
  test("says costKnown false, a null cost_usd and the cap it was counted at", () => {
    const line = costLogLine(call({ costUsd: 0.75, costKnown: false, terminalReason: "no result: killed" }));
    expect(JSON.parse(line.slice("wachiman-cost ".length))).toMatchObject({
      costKnown: false,
      cost_usd: null,
      countedUsd: 0.75,
    });
    expect(JSON.parse(costLogLine(call()).slice("wachiman-cost ".length))).toMatchObject({ costKnown: true, cost_usd: 0.4321 });
  });
});

describe("the job summary", () => {
  test("renders one row per call and a total row", () => {
    const table = renderCostSummary([
      call(),
      call({ operation: "reply", label: "threads", turns: 3, usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400 }, costUsd: 0.1 }),
    ]);
    expect(table).toBe(
      [
        "### Wachiman model cost",
        "",
        "| Operation | Model | Turns | Input | Output | Cache read | Cache write | Cost USD |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        "| review (batch 1/2) | claude-sonnet-5-5 | 7 | 1200 | 3400 | 560000 | 21000 | $0.4321 |",
        "| reply (threads) | claude-sonnet-5-5 | 3 | 100 | 200 | 300 | 400 | $0.1000 |",
        "| **Total** | | 10 | 1300 | 3600 | 560300 | 21400 | **$0.5321** |",
        "",
      ].join("\n"),
    );
  });

  test("an unknown cost shows its cap in the cost column and stays out of the total", () => {
    const table = renderCostSummary([
      call({ usage: NO_USAGE, turns: 0, costUsd: 0.75, costKnown: false, terminalReason: "no result: killed" }),
      call({ label: "batch 2/2", costUsd: 0.25 }),
    ]);
    expect(table).toContain("| review (batch 1/2) | claude-sonnet-5-5 | 0 | 0 | 0 | 0 | 0 | unknown (counted at cap $0.75) |");
    expect(table).toContain("| **Total** | | 7 | 1200 | 3400 | 560000 | 21000 | **$0.2500** |");
    expect(table).toContain("1 call(s) died without a result");
    expect(table).toContain("$0.75 together");
  });

  test("renders nothing when no model was called", () => {
    expect(renderCostSummary([])).toBe("");
  });

  test("is appended to $GITHUB_STEP_SUMMARY only when it is set, and never throws", () => {
    const written: [string, string][] = [];
    const append = (path: string, text: string) => void written.push([path, text]);
    expect(writeStepSummary([call()], {}, append)).toBe(false);
    expect(writeStepSummary([], { GITHUB_STEP_SUMMARY: "/tmp/s" }, append)).toBe(false);
    expect(writeStepSummary([call()], { GITHUB_STEP_SUMMARY: "/tmp/s" }, append)).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0][0]).toBe("/tmp/s");
    expect(written[0][1]).toContain("| **Total** |");
    expect(writeStepSummary([call()], { GITHUB_STEP_SUMMARY: "/nope" }, () => { throw new Error("EACCES"); })).toBe(false);
  });
});
