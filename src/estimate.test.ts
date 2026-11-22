import { describe, expect, test } from "bun:test";
import { estimateReview, PER_BATCH_USD } from "./estimate";
import { approvalBudget, batchRoom, estimateFor, type ReviewFile } from "./engine";
import type { ExceptionPlan } from "./memory/mute";
import { loadConfig } from "./config";

const file = (filename: string, additions: number, deletions = 0): ReviewFile => ({ filename, additions, deletions });

describe("estimateReview", () => {
  const files = [file("a.ts", 10, 5), file("b.ts", 20)];
  const opts = { batches: 4, batchBudgetUsd: 0.75 };

  test("prices a batch by model family, matched on the model id", () => {
    expect(estimateReview(files, { ...opts, model: "claude-sonnet-5-5" }).perBatchUsd).toBe(PER_BATCH_USD.sonnet);
    expect(estimateReview(files, { ...opts, model: "claude-opus-5-5" }).perBatchUsd).toBe(PER_BATCH_USD.opus);
    expect(estimateReview(files, { ...opts, model: "claude-haiku-5-5" }).perBatchUsd).toBe(PER_BATCH_USD.haiku);
    expect(PER_BATCH_USD).toEqual({ sonnet: 0.32, opus: 0.5, haiku: 0.28 });
  });

  test("totals files, changed lines and dollars", () => {
    const e = estimateReview(files, { ...opts, model: "claude-sonnet-5-5" });
    expect(e).toMatchObject({ files: 2, lines: 35, batches: 4 });
    expect(e.usd).toBeCloseTo(1.28, 10);
  });

  test("a model with no measurement is priced at the per-call cap", () => {
    const e = estimateReview(files, { ...opts, model: "gpt-6.1-sol" });
    expect(e.perBatchUsd).toBe(0.75);
    expect(e.usd).toBe(3);
  });

  test("a cap lower than the measured figure wins", () => {
    const e = estimateReview(files, { batches: 2, batchBudgetUsd: 0.2, model: "claude-opus-5-5" });
    expect(e.perBatchUsd).toBe(0.2);
    expect(e.usd).toBeCloseTo(0.4, 10);
  });
});

describe("estimateFor", () => {
  test("counts the batches planBatches makes: one per 600-line file when two do not fit in 1,000", () => {
    const config = loadConfig({ WACHIMAN_BATCH_LINES: "1000", WACHIMAN_MODEL: "claude-sonnet-5-5" });
    const files = [file("a/x.ts", 600), file("b/y.ts", 600), file("c/z.ts", 600)];
    const e = estimateFor(files, config);
    expect(e.batches).toBe(3);
    expect(e.lines).toBe(1800);
    expect(e.usd).toBeCloseTo(0.96, 10);
  });

  test("small files share a batch", () => {
    const config = loadConfig({ WACHIMAN_BATCH_LINES: "1000" });
    expect(estimateFor([file("a/x.ts", 100), file("b/y.ts", 100)], config).batches).toBe(1);
  });
});

describe("batchRoom: what the batches get once the reserves are taken (AC4)", () => {
  const none = { active: [], stale: [] } as ExceptionPlan;
  const exceptions = { active: [{ id: "e" }], stale: [] } as unknown as ExceptionPlan;

  test("with no verifier and no exception the batches get the whole total", () => {
    expect(batchRoom(3, undefined, none)).toBe(3);
  });

  test("the verifier reserve is its budget, at most half the total", () => {
    expect(batchRoom(3, { budgetUsd: 1 }, none)).toBe(2);
    expect(batchRoom(1, { budgetUsd: 1 }, none)).toBe(0.5);
  });

  test("an active exception reserves a matching call: $0.25 at most, a quarter of what is left", () => {
    expect(batchRoom(3, undefined, exceptions)).toBe(2.75);
    expect(batchRoom(0.4, undefined, exceptions)).toBeCloseTo(0.3, 10);
    expect(batchRoom(3, { budgetUsd: 1 }, exceptions)).toBe(1.75);
  });

  test("the gate's room takes the PR Confidence claims call out too: $0.15 at most, a quarter of the room", () => {
    expect(batchRoom(3, undefined, none, true)).toBeCloseTo(2.85, 10);
    expect(batchRoom(0.4, undefined, none, true)).toBeCloseTo(0.3, 10);
    expect(batchRoom(3, undefined, none, false)).toBe(3);
  });
});

describe("approvalBudget: the smallest whole dollar whose batch room is 1.5 times the estimate (AC5)", () => {
  const none = { active: [], stale: [] } as ExceptionPlan;

  test("with no reserve it is 1.5 times the estimate rounded up", () => {
    expect(approvalBudget(9.6, (n) => batchRoom(n, undefined, none))).toBe(15);
    expect(approvalBudget(5.76, (n) => batchRoom(n, undefined, none))).toBe(9);
  });

  test("a verifier reserve is paid out of N, so N grows to leave the batches their share (AC15)", () => {
    expect(approvalBudget(9.6, (n) => batchRoom(n, { budgetUsd: 1 }, none))).toBe(16);
  });

  test("an estimate that needs less than a dollar still asks for $1", () => {
    expect(approvalBudget(0.1, (n) => batchRoom(n, undefined, none))).toBe(1);
  });
});
