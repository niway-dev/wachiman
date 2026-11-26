/**
 * The two call sites' adapter: turns a finished review (or ask) into a `TelemetryRun` and sends it when
 * the gate allows. It reads numbers and enums from the result and nothing else; it never throws and
 * never prints, so the review's output and exit code cannot change.
 */
import type { ReviewFile } from "../engine";
import type { ReviewResult } from "../formats";
import { readConsent, telemetryAllowed } from "./consent";
import { sendSummary } from "./send";
import { buildSummary, type ErrorCategory, type Outcome, type TelemetryRun } from "./summary";

type Env = Record<string, string | undefined>;
type Execution = Pick<ReviewResult["execution"], "stop" | "rejection">;

/** A fixed category from the engine's own stop reason and provider rejection class; never a message. */
export function errorOf(execution: Execution): ErrorCategory | null {
  const kind = execution.rejection?.kind;
  if (kind === "auth") return "auth";
  if (kind === "billing" || kind === "rate_limit" || execution.stop === "quota") return "quota";
  if (execution.stop === "timeout") return "timeout";
  if (kind === "other") return "provider";
  if (execution.stop === "error") return "other";
  return null;
}

/** The category of a failed `ask` call: from the provider's error class and terminal reason; `other` when no call returned. */
export function askErrorOf(result: { terminalReason: string; providerError?: "billing" | "auth" | "rate_limit" | "other" } | undefined): ErrorCategory {
  if (result === undefined) return "other";
  return errorOf({
    stop: result.terminalReason === "timeout" ? "timeout" : "error",
    rejection: { kind: result.providerError ?? "other", text: "" },
  }) ?? "other";
}

export function outcomeOf(result: Pick<ReviewResult, "execution" | "coverage">): Outcome {
  const { stop, callsWithOutput } = result.execution;
  if (stop === "complete" && !result.coverage.partial) return "complete";
  return stop === "complete" || callsWithOutput > 0 ? "partial" : "failed";
}

/** The run of a finished `wachiman local` review. */
export function runOfReview(result: ReviewResult, kept: readonly ReviewFile[]): TelemetryRun {
  const done = (status: string) => status === "reviewed" || status === "reviewed after a retry";
  return {
    mode: "local",
    model: result.provider.model,
    files: kept.map((f) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions })),
    chunks: { planned: result.batches.length, completed: result.batches.filter((b) => done(b.status)).length },
    usage: result.execution.usage,
    durationMs: result.execution.durationMs,
    outcome: outcomeOf(result),
    retries: result.batches.filter((b) => b.status.endsWith("after a retry")).length,
    error: errorOf(result.execution),
    severities: result.findings.map((f) => f.severity),
    distributed: result.siblings?.some((s) => s.status === "read") ?? false,
  };
}

/** The run of a `wachiman ask` answer: one call, no findings. `error` is set when it failed. */
export function runOfAsk(p: {
  model: string;
  kept: readonly ReviewFile[];
  usage: TelemetryRun["usage"];
  durationMs: number;
  error: ErrorCategory | null;
  failed: boolean;
}): TelemetryRun {
  return {
    mode: "ask",
    model: p.model,
    files: p.kept.map((f) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions })),
    chunks: { planned: 1, completed: p.failed ? 0 : 1 },
    usage: p.usage,
    durationMs: p.durationMs,
    outcome: p.failed ? "failed" : "complete",
    retries: 0,
    error: p.error,
    severities: [],
    distributed: false,
  };
}

/** Sends the summary of `run` when the stored yes and the environment allow it. Never throws, never prints. */
export async function reportRun(run: TelemetryRun, p: { env: Env; home: () => string; version: string }): Promise<void> {
  try {
    const consent = readConsent(p.home());
    if (!telemetryAllowed(p.env, consent)) return;
    const summary = buildSummary(run, { installation: consent!.installation!, version: p.version, now: new Date() });
    await sendSummary(summary, { env: p.env });
  } catch {
    // Telemetry never fails a review.
  }
}
