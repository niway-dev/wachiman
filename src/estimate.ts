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

/**
 * What one batch call costs on average at low effort, the effort of `format_model` (ADR 0063).
 * Haiku: pull request 287's files that only the formatter commit touched, read with `wachiman local`
 * on a subscription (claude-haiku-5-5, effort low, 1,000-line batches). A 3-batch sample (56 files)
 * cost $0.0387; all 15 batches (282 files) cost $0.2253 over 17 calls (two batches were retried),
 * $0.0150 a batch with its retries. Calls took 2 to 4 turns and
 * $0.010 to $0.016 each. API-equivalent estimates, not bills; see docs/costs.md. A model with no
 * low-effort figure is priced at its high-effort one, never lower.
 */
export const PER_BATCH_LOW_USD = { haiku: 0.015 } as const;

/** The mean cost of one batch call for `model`, never above the per-call cap. */
export function perBatchFor(model: string, batchBudgetUsd: number, effort: "high" | "low" = "high") {
  const id = model.toLowerCase();
  const family = (Object.keys(PER_BATCH_USD) as (keyof typeof PER_BATCH_USD)[]).find((f) => id.includes(f));
  const low = effort === "low" && family && family in PER_BATCH_LOW_USD ? PER_BATCH_LOW_USD[family as keyof typeof PER_BATCH_LOW_USD] : undefined;
  return family ? Math.min(low ?? PER_BATCH_USD[family], batchBudgetUsd) : batchBudgetUsd;
}

/**
 * The room a batch needs before it starts: 60% of the model's mean batch, never below `minUsd`.
 * Below it, a call is cut before its first turn pays for anything (the cheapest first turn on
 * pull request 287 cost $0.17).
 */
export function batchStartFloor(model: string, batchBudgetUsd: number, minUsd: number) {
  return Math.max(minUsd, 0.6 * perBatchFor(model, batchBudgetUsd));
}

/** One group of a review: the files read by one model and what its batches cost. */
export interface GroupEstimate {
  files: number;
  lines: number;
  batches: number;
  perBatchUsd: number;
  usd: number;
  model: string;
}

export interface ReviewEstimate {
  /** The main group's files, changed lines, batches and figure per batch. */
  files: number;
  lines: number;
  batches: number;
  perBatchUsd: number;
  /** The whole review: the main group plus `format`. */
  usd: number;
  /** The files only listed formatting commits touched, read by `format_model` at low effort (ADR 0063). */
  format?: GroupEstimate;
}

const linesOf = (files: ReviewFile[]) => files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

/**
 * What reviewing `files` would cost, from the diff alone: no model call and no IO. `batches` is
 * the number `planBatches` made of those files. It is passed in rather than computed here because
 * engine.ts imports this module, and importing engine back would be a cycle. `format` is the second
 * group (ADR 0063): its files, its own batch count and the model that reads it, priced at low effort.
 */
export function estimateReview(
  files: ReviewFile[],
  opts: { batches: number; batchBudgetUsd: number; model: string; format?: { files: ReviewFile[]; batches: number; model: string } },
): ReviewEstimate {
  const perBatchUsd = perBatchFor(opts.model, opts.batchBudgetUsd);
  const main = opts.batches * perBatchUsd;
  const format = opts.format
    ? (() => {
        const per = perBatchFor(opts.format.model, opts.batchBudgetUsd, "low");
        return { files: opts.format.files.length, lines: linesOf(opts.format.files), batches: opts.format.batches, perBatchUsd: per, usd: opts.format.batches * per, model: opts.format.model };
      })()
    : undefined;
  return {
    files: files.length,
    lines: linesOf(files),
    batches: opts.batches,
    perBatchUsd,
    usd: main + (format?.usd ?? 0),
    ...(format ? { format } : {}),
  };
}
