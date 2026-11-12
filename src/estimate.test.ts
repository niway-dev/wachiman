import { describe, expect, test } from "bun:test";
import { estimateReview, PER_BATCH_USD, sizeGate, suggestedBudget } from "./estimate";
import { estimateFor, type ReviewFile } from "./engine";
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
    const config = loadConfig({ AGENT_REVIEW_BATCH_LINES: "1000", AGENT_REVIEW_MODEL: "claude-sonnet-5-5" });
    const files = [file("a/x.ts", 600), file("b/y.ts", 600), file("c/z.ts", 600)];
    const e = estimateFor(files, config);
    expect(e.batches).toBe(3);
    expect(e.lines).toBe(1800);
    expect(e.usd).toBeCloseTo(0.96, 10);
  });

  test("small files share a batch", () => {
    const config = loadConfig({ AGENT_REVIEW_BATCH_LINES: "1000" });
    expect(estimateFor([file("a/x.ts", 100), file("b/y.ts", 100)], config).batches).toBe(1);
  });
});

describe("sizeGate", () => {
  test("never falls below what the run may spend", () => {
    const config = { sizeGateUsd: 6, budgetUsd: 3, autoBudgetUsd: 6 };
    expect(sizeGate(config, false)).toBe(6);
    expect(sizeGate(config, true)).toBe(6);
  });

  test("an operator run is lifted by budget_usd alone", () => {
    const config = { sizeGateUsd: 6, budgetUsd: 33, autoBudgetUsd: 6 };
    expect(sizeGate(config, false)).toBe(33);
  });

  test("an automatic run is bounded by auto_budget_usd too, so both must be raised", () => {
    expect(sizeGate({ sizeGateUsd: 6, budgetUsd: 33, autoBudgetUsd: 6 }, true)).toBe(6);
    expect(sizeGate({ sizeGateUsd: 6, budgetUsd: 33, autoBudgetUsd: 40 }, true)).toBe(33);
  });
});

describe("suggestedBudget", () => {
  test("rounds 1.5 times the estimate up to a whole dollar, at least 1", () => {
    expect(suggestedBudget(21.76)).toBe(33);
    expect(suggestedBudget(20)).toBe(30);
    expect(suggestedBudget(0.1)).toBe(1);
  });
});
