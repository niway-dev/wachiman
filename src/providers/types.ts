/**
 * The boundary between the engine and the agent CLI that does the reading.
 *
 * One interface, one method. Filtering, risk, batches, retries, coverage, budgets, posting and
 * threads stay in the engine and call only `run`. Hardening (what the agent may read or run, what
 * it inherits from the environment) belongs to the adapter and is documented per adapter in
 * `docs/providers/`.
 *
 * Non-goal: a plugin system. Each adapter brings its own sandbox story, its own structured-output
 * path and its own cost accounting. The shape was drawn from Claude Code and held for Codex
 * (ADR 0004); if a third adapter does not fit, redraw it.
 */

/**
 * Reasoning effort levels, in the vocabulary both CLIs share. The consumer picks one its provider
 * and model accept (Codex may refuse `xhigh` or `max` for some models); nothing translates it.
 */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
/** Explicit on purpose: Claude Code's own default moved from medium to high in 2.1.94 and may move again. */
export const DEFAULT_EFFORT: Effort = "high";

/**
 * Default cap on the agent's turns per call (`AGENT_REVIEW_MAX_TURNS`). Wachiman's batches take
 * 5–12 turns and an external agent's whole-PR reviews took 19–46, so 40 never cuts a normal batch;
 * it only stops a run that is looping.
 */
export const DEFAULT_MAX_TURNS = 40;
/** Default wall-clock limit on one provider call, in seconds (`AGENT_REVIEW_CALL_TIMEOUT_S`). */
export const DEFAULT_CALL_TIMEOUT_S = 900;

/** Tool names the engine may ask for. Each adapter maps them to its own names. */
export type NeutralTool = "read" | "glob" | "grep";

export interface ProviderRequest {
  /** The full prompt text. */
  prompt: string;
  /** The directory the agent works in: the checked-out head of the pull request. */
  cwd: string;
  /** Extra directories the agent may read (the scratch folder holding `pr.json`, `threads.json`). */
  addDirs: string[];
  allowedTools: NeutralTool[];
  /** The most this call may spend, in USD. A soft cap: a provider may overshoot it. */
  maxBudgetUsd: number;
  /**
   * The most agent turns this call may take. Claude Code passes it as `--max-turns`; Codex has no
   * such flag, so that adapter ignores it. Omit it for no cap.
   */
  maxTurns?: number;
  /**
   * Wall-clock limit for this call, in milliseconds. The adapter kills the CLI when it passes and
   * returns `terminalReason: "timeout"`. Omit it to use the adapter's own default.
   */
  timeoutMs?: number;
  /** JSON schema for the structured answer. Omit it to get free text in `text`. */
  outputSchema?: object;
  /** Send the prompt through stdin instead of an argument (a large diff would exceed argv limits). */
  promptViaStdin: boolean;
}

export interface ProviderResult {
  /** The answer parsed against `outputSchema`, when one was given and the call succeeded. */
  structuredOutput?: unknown;
  /** The free-text answer. */
  text?: string;
  costUsd: number;
  turns: number;
  durationMs: number;
  /**
   * `success`; `budget` (the spend cap ended the call); `turns` (the turn cap ended it);
   * `timeout` (the wall-clock limit killed it); or `error`. A provider may add more.
   */
  terminalReason: string;
  isError: boolean;
  /** The provider's own result, kept for debugging. Never posted. */
  raw: unknown;
}

export interface ProviderAdapter {
  /** The value of `AGENT_REVIEW_PROVIDER` that selects it. */
  readonly name: string;
  /** Throws when the call would fail anyway: missing binary, settings file or credential. */
  preflight(): void;
  /** For the review footer, e.g. "Claude Sonnet 5.5 via Claude Code 2.1.304". */
  modelLabel(): string;
  /**
   * True when any text contains a credential of this provider (the exact key in the environment
   * or anything shaped like one). The engine throws and posts nothing.
   */
  leaksSecret(texts: string[]): boolean;
  /** Runs one call to completion. Throws when the call produced no result at all. */
  run(request: ProviderRequest): ProviderResult;
}
