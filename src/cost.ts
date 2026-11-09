/**
 * Cost accounting for every model call.
 *
 * The engine calls a model through `ProviderAdapter.run` in exactly one place (`runProvider` in
 * `engine.ts`); each call becomes one `CallCost`. A call is reported three ways: a cost line in
 * the footer of the comment it paid for, one `wachiman-cost {json}` line in the log (so costs can
 * be grepped and summed across runs), and a table in the GitHub Actions job summary.
 */
import { appendFileSync } from "node:fs";

/**
 * What a call was for.
 *
 * - `review`: a first or full review (no earlier reviewed commit to start from), including the
 *   retry of a batch's unaccounted-for files.
 * - `re-review`: an incremental review of the changes since an earlier reviewed commit.
 * - `reply`: the one call that answers the pending review-thread replies.
 * - `on-demand`: an operator's `/wachiman <question>` answered as a comment.
 *
 * There is no `description` kind: the engine never asks a model to write a pull request
 * description. The summary in a review is part of the review's own structured output.
 */
export type Operation = "review" | "re-review" | "reply" | "on-demand" | "verify";

/**
 * Tokens a call used. `input` excludes cached tokens, so the four fields never overlap.
 * A provider that does not report a field leaves it 0.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export const hasUsage = (u: TokenUsage) => u.input + u.output + u.cacheRead + u.cacheWrite > 0;

/** One model call, as reported by the provider and tagged by the engine. */
export interface CallCost {
  operation: Operation;
  /** Which call of the operation: `batch 2/3`, `batch 2/3 retry`, `threads`, `question`. */
  label: string;
  model: string;
  turns: number;
  durationMs: number;
  usage: TokenUsage;
  /** For an unknown cost (`costKnown: false`) this is the cap the call was counted at, not a measurement. */
  costUsd: number;
  /** False when the call died without a result: its real cost is unknown and `costUsd` is its cap. Default true. */
  costKnown?: boolean;
  terminalReason: string;
  repo?: string;
  pr?: number;
}

/** A count of tokens in a footer or table: 842, 12.3k, 4.1M. */
export function formatTokens(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * The footer's cost line. The run's own dollar figure stays last: `readAutoCost` reads the
 * ceiling's spend as the last `$` figure before `</sub>`, so the details go before it. `extra` may
 * hold earlier figures (`PR so far $0.77 over 3 automatic runs`); they are never the last one.
 */
export function costLine(parts: {
  /** The model label, e.g. "Claude Sonnet 5.5 via Claude Code 2.1.304". */
  modelLabel: string;
  effort?: string;
  operation?: Operation;
  /** Anything else for the line, e.g. `2 batches`, `answers 2 thread(s)` or `PR so far $0.77 over 3 automatic runs`. */
  extra?: string[];
  usage?: TokenUsage;
  costUsd: number;
}) {
  const { usage } = parts;
  const tokens =
    usage && hasUsage(usage)
      ? [
          `${formatTokens(usage.input)} in / ${formatTokens(usage.output)} out / ${formatTokens(usage.cacheRead)} cache read / ${formatTokens(usage.cacheWrite)} cache write`,
        ]
      : [];
  const segments = [
    parts.modelLabel,
    ...(parts.effort ? [`effort ${parts.effort}`] : []),
    ...(parts.operation ? [parts.operation] : []),
    ...(parts.extra ?? []),
    ...tokens,
    `$${parts.costUsd.toFixed(2)}`,
  ];
  return `<sub>${segments.join(" · ")}</sub>`;
}

export const COST_LOG_PREFIX = "wachiman-cost";

/** One grep-able log line per call: `wachiman-cost {"operation":"review",…}`. */
export function costLogLine(call: CallCost, extra: { trigger?: string } = {}) {
  return `${COST_LOG_PREFIX} ${JSON.stringify({
    operation: call.operation,
    label: call.label,
    repo: call.repo,
    pr: call.pr,
    trigger: extra.trigger,
    model: call.model,
    turns: call.turns,
    duration_ms: call.durationMs,
    input_tokens: call.usage.input,
    output_tokens: call.usage.output,
    cache_read_tokens: call.usage.cacheRead,
    cache_write_tokens: call.usage.cacheWrite,
    // An unknown cost is `null`, never the cap, so summing `cost_usd` across runs never counts a guess.
    costKnown: call.costKnown !== false,
    cost_usd: call.costKnown === false ? null : Number(call.costUsd.toFixed(6)),
    ...(call.costKnown === false ? { countedUsd: Number(call.costUsd.toFixed(6)) } : {}),
    terminal_reason: call.terminalReason,
  })}`;
}

/** The job summary: one row per call and a total row. Empty string when no call was made. */
export function renderCostSummary(calls: CallCost[]) {
  if (calls.length === 0) return "";
  const unknown = calls.filter((c) => c.costKnown === false);
  const rows = calls.map(
    (c) =>
      `| ${c.operation} (${c.label}) | ${c.model} | ${c.turns} | ${c.usage.input} | ${c.usage.output} | ${c.usage.cacheRead} | ${c.usage.cacheWrite} | ${c.costKnown === false ? `unknown (counted at cap $${c.costUsd.toFixed(2)})` : `$${c.costUsd.toFixed(4)}`} |`,
  );
  const total = calls.reduce((t, c) => addUsage(t, c.usage), NO_USAGE);
  const turns = calls.reduce((n, c) => n + c.turns, 0);
  // The total is what was measured; calls with an unknown cost are listed under it, not added to it.
  const usd = calls.reduce((n, c) => n + (c.costKnown === false ? 0 : c.costUsd), 0);
  const counted = unknown.reduce((n, c) => n + c.costUsd, 0);
  return [
    "### Wachiman model cost",
    "",
    "| Operation | Model | Turns | Input | Output | Cache read | Cache write | Cost USD |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    `| **Total** | | ${turns} | ${total.input} | ${total.output} | ${total.cacheRead} | ${total.cacheWrite} | **$${usd.toFixed(4)}** |`,
    ...(unknown.length
      ? [
          "",
          `${unknown.length} call(s) died without a result, so their cost is unknown. The review footer and the automatic ceiling count them at their cap ($${counted.toFixed(2)} together); the total above does not.`,
        ]
      : []),
    "",
  ].join("\n");
}

/**
 * Appends the summary to `$GITHUB_STEP_SUMMARY` when it is set. Never throws: a summary that
 * cannot be written must not fail a review that was already posted.
 */
export function writeStepSummary(
  calls: CallCost[],
  env: Record<string, string | undefined>,
  append: (path: string, text: string) => void = appendFileSync,
) {
  const path = env.GITHUB_STEP_SUMMARY;
  const text = renderCostSummary(calls);
  if (!path || !text) return false;
  try {
    append(path, `${text}\n`);
    return true;
  } catch {
    return false;
  }
}
