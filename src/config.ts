/** The `AGENT_REVIEW_*` settings, read once, with the old `CLAUDE_REVIEW_*` names as a fallback. */
import { DEFAULT_MODELS } from "./providers";
import { DEFAULT_CALL_TIMEOUT_S, DEFAULT_EFFORT, DEFAULT_MAX_TURNS, EFFORTS, type Effort } from "./providers/types";

export class UsageError extends Error {}

/**
 * Why a run started. `comment` is the operator's command; every other value (`opened`,
 * `ready_for_review`, `synchronize`, `thread`, …) is an automatic run and counts against
 * `autoBudgetUsd` (ADR 0012).
 */
export type Trigger = string;

/** Whether a run started by `trigger` spends from the pull request's automatic ceiling. */
export const isAutomatic = (trigger: Trigger | undefined) => trigger !== undefined && trigger !== "comment";

export interface EngineConfig {
  /** Total per review invocation, USD. */
  budgetUsd: number;
  /**
   * `AGENT_REVIEW_AUTO_BUDGET_USD`: the most all automatic runs on one pull request may spend
   * together (the first review, push reviews, thread runs), summed from the engine's own signed
   * footers. The operator's `comment` is not limited by it.
   */
  autoBudgetUsd: number;
  /** `AGENT_REVIEW_THREADS_BUDGET_USD`: the one provider call of a thread-only run. */
  threadsBudgetUsd: number;
  /**
   * `AGENT_REVIEW_TRIGGER`: why this run started (see `Trigger`). Unset means a person ran the
   * CLI by hand: not automatic, so the ceiling does not apply. `comment` mode ignores it.
   */
  trigger?: Trigger;
  batchBudgetUsd: number;
  answerBudgetUsd: number;
  batchLines: number;
  batchChars: number;
  dryRun: boolean;
  /**
   * `AGENT_REVIEW_FULL_REVIEW`: a dry run reviews the whole pull request, as if it had never been
   * reviewed, without reading the previous-review marker. Only together with `dryRun`.
   */
  fullReview: boolean;
  /** The provider's default (`DEFAULT_MODELS`) when unset. */
  model: string;
  provider: string;
  /** `AGENT_REVIEW_PRICE_PER_MTOK`: "input,cached_input,output" USD per million tokens, for a Codex model without a built-in price. */
  pricePerMTok?: string;
  /**
   * `AGENT_REVIEW_EFFORT`: the reasoning effort, always explicit so a CLI default change cannot
   * alter reviews. Passed as `--effort` (Claude Code) or `model_reasoning_effort` (Codex).
   */
  effort: Effort;
  /**
   * `AGENT_REVIEW_MAX_TURNS`: the most agent turns one provider call may take. Passed as
   * `--max-turns` (Claude Code); Codex has no equivalent and ignores it.
   */
  maxTurns: number;
  /**
   * `AGENT_REVIEW_CALL_TIMEOUT_S`: wall-clock limit on one provider call, in seconds. The call is
   * killed when it passes and ends as `timeout`.
   */
  callTimeoutS: number;
  /**
   * `AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE`: what a run does when the provider rejects every call
   * because the reviewer's own account cannot pay or authenticate (or stays rate-limited). `warn`
   * posts a notice and finishes green; `fail` posts it and fails the job.
   */
  onProviderUnavailable: "warn" | "fail";
  mention: string;
  /** Login allowed to command the tool. `comment` refuses to run when it is empty or a placeholder. */
  operator: string;
  /**
   * `AGENT_REVIEW_ASKERS`: who may ask a question (ADR 0032 decision 5). `operator` (default): only
   * the operator. `write`: also a collaborator whose permission on the repository is admin,
   * maintain or write, checked by the engine on each question. Reviews stay operator-only.
   */
  askers: "operator" | "write";
  /**
   * `AGENT_REVIEW_ASK_CEILING_USD`: the most the questions of everyone but the operator may spend
   * on one pull request, summed from the engine's own footers. The operator's questions are not limited.
   */
  askCeilingUsd: number;
  /** Extra exclude globs on top of the built-in ones. */
  exclude: string[];
  /**
   * `AGENT_REVIEW_VERIFY`: after the batches, one more call tries to refute every finding above
   * `info` before it is posted (ADR 0027). Off by default; enabled only by `1` or `true`.
   */
  verify: boolean;
  /** `AGENT_REVIEW_VERIFY_BUDGET_USD`: the verifier's reserve, taken out of `budgetUsd` (at most half of it). */
  verifyBudgetUsd: number;
  /** `AGENT_REVIEW_VERIFIER_MODEL`: the verifier's model; it always runs at effort `high`. */
  verifierModel: string;
}

/** The verifier's model when `AGENT_REVIEW_VERIFIER_MODEL` is unset (Claude Code only). */
export const DEFAULT_VERIFIER_MODEL = "claude-opus-5-5";

type Env = Record<string, string | undefined>;

/**
 * `AGENT_REVIEW_<name>`, else the deprecated `CLAUDE_REVIEW_<name>` (with a one-line notice on
 * stderr), else undefined. An empty value counts as unset.
 */
export function readSetting(env: Env, name: string, warn: (line: string) => void) {
  const current = env[`AGENT_REVIEW_${name}`];
  if (current !== undefined && current !== "") return current;
  const old = env[`CLAUDE_REVIEW_${name}`];
  if (old !== undefined && old !== "") {
    warn(`CLAUDE_REVIEW_${name} is deprecated; use AGENT_REVIEW_${name}.`);
    return old;
  }
  return undefined;
}

/**
 * `AGENT_REVIEW_EFFORT`, else the deprecated `AGENT_REVIEW_REASONING_EFFORT` (Codex only before),
 * else the default. An unknown value is a configuration error: a silent fallback would run the
 * review at an effort nobody chose.
 */
function readEffort(env: Env, warn: (line: string) => void): Effort {
  const current = readSetting(env, "EFFORT", warn);
  const old = readSetting(env, "REASONING_EFFORT", () => {});
  let name = "AGENT_REVIEW_EFFORT";
  let raw = current;
  if (old !== undefined) {
    warn("AGENT_REVIEW_REASONING_EFFORT is deprecated; use AGENT_REVIEW_EFFORT.");
    if (raw === undefined) {
      raw = old;
      name = "AGENT_REVIEW_REASONING_EFFORT";
    }
  }
  if (raw === undefined) return DEFAULT_EFFORT;
  if (!(EFFORTS as readonly string[]).includes(raw)) {
    throw new UsageError(`${name} must be one of ${EFFORTS.join(", ")}, got "${raw}".`);
  }
  return raw as Effort;
}

export function loadConfig(env: Env, warn: (line: string) => void = console.error): EngineConfig {
  const get = (name: string) => readSetting(env, name, warn);
  const number = (name: string, fallback: number, integer = false) => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
      throw new UsageError(`AGENT_REVIEW_${name} must be a positive ${integer ? "integer" : "number"}, got "${raw}".`);
    }
    return value;
  };
  const effort = readEffort(env, warn);
  const onProviderUnavailable = get("ON_PROVIDER_UNAVAILABLE") ?? "warn";
  if (onProviderUnavailable !== "warn" && onProviderUnavailable !== "fail") {
    throw new UsageError(`AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE must be warn or fail, got "${onProviderUnavailable}".`);
  }
  const provider = get("PROVIDER") ?? "claude-code";
  const dryRun = get("DRY_RUN") === "1";
  const fullReview = get("FULL_REVIEW") === "1";
  if (fullReview && !dryRun) {
    throw new UsageError(
      "AGENT_REVIEW_FULL_REVIEW=1 works only with AGENT_REVIEW_DRY_RUN=1: a full review ignores the previous-review marker, so it is printed, never posted.",
    );
  }
  const verifyRaw = get("VERIFY");
  if (verifyRaw !== undefined && verifyRaw !== "0" && verifyRaw !== "1" && verifyRaw !== "true" && verifyRaw !== "false") {
    throw new UsageError(`AGENT_REVIEW_VERIFY must be 1, true, 0 or false (unset means off), got "${verifyRaw}".`);
  }
  const verifierModel = get("VERIFIER_MODEL") ?? (provider === "claude-code" ? DEFAULT_VERIFIER_MODEL : undefined);
  // Verification is opt-in, including when a verifier model is configured.
  const verify = verifyRaw === "1" || verifyRaw === "true";
  if (verify && verifierModel === undefined) {
    throw new UsageError(`AGENT_REVIEW_VERIFY needs AGENT_REVIEW_VERIFIER_MODEL with the ${provider} provider: the default verifier is a Claude model.`);
  }
  const askers = get("ASKERS") ?? "operator";
  if (askers !== "operator" && askers !== "write") {
    throw new UsageError(`AGENT_REVIEW_ASKERS must be operator or write, got "${askers}".`);
  }
  const trigger = get("TRIGGER")?.trim();
  if (trigger !== undefined && !/^[a-z_]+$/.test(trigger)) {
    throw new UsageError(`AGENT_REVIEW_TRIGGER must be a lowercase event action such as synchronize, got "${trigger}".`);
  }
  return {
    budgetUsd: number("BUDGET_USD", 3),
    autoBudgetUsd: number("AUTO_BUDGET_USD", 6),
    threadsBudgetUsd: number("THREADS_BUDGET_USD", 0.25),
    trigger: trigger || undefined,
    batchBudgetUsd: number("BATCH_BUDGET_USD", 0.75),
    answerBudgetUsd: number("ANSWER_BUDGET_USD", 1),
    batchLines: number("BATCH_LINES", 1000, true),
    batchChars: number("BATCH_CHARS", 140000, true),
    dryRun,
    fullReview,
    model: get("MODEL") ?? DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS] ?? DEFAULT_MODELS["claude-code"],
    provider,
    pricePerMTok: get("PRICE_PER_MTOK"),
    effort,
    maxTurns: number("MAX_TURNS", DEFAULT_MAX_TURNS, true),
    callTimeoutS: number("CALL_TIMEOUT_S", DEFAULT_CALL_TIMEOUT_S, true),
    onProviderUnavailable,
    mention: get("MENTION") ?? "/wachiman",
    operator: get("OPERATOR") ?? "",
    askers,
    askCeilingUsd: number("ASK_CEILING_USD", 3),
    exclude: (get("EXCLUDE") ?? "").split(",").filter(Boolean),
    verify,
    verifyBudgetUsd: number("VERIFY_BUDGET_USD", 1),
    verifierModel: verifierModel ?? DEFAULT_VERIFIER_MODEL,
  };
}

/** Template values that look like a login but belong to nobody the consumer chose. */
const PLACEHOLDER_OPERATORS = ["your-github-login"];

/**
 * Why `operator` cannot be trusted as the operator's login, or undefined when it can. The
 * templates ship placeholders that are valid, possibly registrable logins: whoever registered one
 * would become the operator of every repository that forgot to edit it.
 */
export function operatorProblem(operator: string | undefined): string | undefined {
  const login = (operator ?? "").trim();
  if (login === "") return "The operator login is empty. Set `operator` (AGENT_REVIEW_OPERATOR) to your GitHub login.";
  const lower = login.toLowerCase();
  if (lower.startsWith("edit") || PLACEHOLDER_OPERATORS.includes(lower)) {
    return `The operator login is still the template placeholder "${login}". Set \`operator\` (AGENT_REVIEW_OPERATOR) to your GitHub login.`;
  }
  return undefined;
}
