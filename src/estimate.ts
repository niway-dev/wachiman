import type { ReviewFile } from "./engine";

/**
 * What one batch call costs on average at high effort, by model family, matched on the model id.
 * Measured, not derived: the cost of a call did not track its line count. Sonnet: 42 batch calls
 * (Sonnet 5.5 high, range $0.20 to $0.58); Opus: 66 batch rows (Opus 5.5 high); Haiku: 21 calls
 * (Haiku 5.5 high). Sources: wachiman-benchmarks 2026-11-02-e1-sonnet rounds 7-9, the 2026-11-02
 * and 2026-11-02-heldout coverage tables, the 2026-11-06-local-haiku-vs-opus logs; see
 * docs/costs.md. Any other model (Codex and so on) has no measurement, so it uses the per-call
 * cap, the worst case the engine allows.
 */
export const PER_BATCH_USD = { sonnet: 0.32, opus: 0.5, haiku: 0.28 } as const;

/** The mean cost of one batch call for `model`, never above the per-call cap. */
function perBatchFor(model: string, batchBudgetUsd: number) {
  const id = model.toLowerCase();
  const family = (Object.keys(PER_BATCH_USD) as (keyof typeof PER_BATCH_USD)[]).find((f) => id.includes(f));
  return family ? Math.min(PER_BATCH_USD[family], batchBudgetUsd) : batchBudgetUsd;
}

export interface ReviewEstimate {
  files: number;
  lines: number;
  batches: number;
  perBatchUsd: number;
  usd: number;
}

/**
 * What reviewing `files` would cost, from the diff alone: no model call and no IO. `batches` is
 * the number `planBatches` made of those files. It is passed in rather than computed here because
 * engine.ts imports this module, and importing engine back would be a cycle.
 */
export function estimateReview(
  files: ReviewFile[],
  opts: { batches: number; batchBudgetUsd: number; model: string },
): ReviewEstimate {
  const perBatchUsd = perBatchFor(opts.model, opts.batchBudgetUsd);
  return {
    files: files.length,
    lines: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
    batches: opts.batches,
    perBatchUsd,
    usd: opts.batches * perBatchUsd,
  };
}
