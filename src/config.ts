/** The `WACHIMAN_*` settings, read once, with the old `CLAUDE_REVIEW_*` names as a fallback. */
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

/** Where a setting's value came from: the environment (a workflow input or `WACHIMAN_*`), the repository's `.wachiman.yml`, or the built-in default. */
export type SettingSource = "env" | "file" | "default";

export type LimitMode = "fail" | "notice";
export type LedgerUnavailableMode = "run" | "stop";

export interface EngineConfig {
  /** Total per review invocation, USD. */
  budgetUsd: number;
  /**
   * `WACHIMAN_AUTO_BUDGET_USD`: the most all automatic runs on one pull request may spend
   * together (the first review, push reviews, thread runs), summed from the engine's own signed
   * footers. The operator's `comment` is not limited by it.
   */
  autoBudgetUsd: number;
  /**
   * `WACHIMAN_SIZE_GATE_USD`: the most a review's estimate may be before a GitHub run skips it
   * and posts one comment instead. The effective gate is never below what the run may spend
   * (`sizeGate` in estimate.ts), so raising the budgets lifts it. Local runs only warn.
   */
  sizeGateUsd: number;
  /**
   * `WACHIMAN_LEDGER_URL`: the spend ledger service, trimmed, without a trailing slash. Unset
   * means no ledger call of any kind. It is also the OIDC audience, as configured.
   */
  ledgerUrl?: string;
  /** `WACHIMAN_DAILY_BUDGET_USD`: a stricter daily number for this repository; it never raises the account's limit. */
  dailyBudgetUsd?: number;
  /** `WACHIMAN_WEEKLY_BUDGET_USD`: the same, per week. */
  weeklyBudgetUsd?: number;
  /** `WACHIMAN_LIMIT_MODE`: when a limit refuses a run, `fail` exits 3 (red job); `notice` posts the comment and passes. */
  limitMode: LimitMode;
  /** `WACHIMAN_LIMIT_BYPASS`: `1` or `true` skips the ledger for this run. */
  limitBypass: boolean;
  /** `WACHIMAN_LEDGER_UNAVAILABLE`: with an unreachable ledger, `run` reviews anyway (and says so); `stop` exits 3 before any model call. */
  ledgerUnavailable: LedgerUnavailableMode;
  /** `WACHIMAN_THREADS_BUDGET_USD`: the one provider call of a thread-only run. */
  threadsBudgetUsd: number;
  /**
   * `WACHIMAN_TRIGGER`: why this run started (see `Trigger`). Unset means a person ran the
   * CLI by hand: not automatic, so the ceiling does not apply. `comment` mode ignores it.
   */
  trigger?: Trigger;
  batchBudgetUsd: number;
  answerBudgetUsd: number;
  batchLines: number;
  batchChars: number;
  dryRun: boolean;
  /**
   * `WACHIMAN_FULL_REVIEW`: a dry run reviews the whole pull request, as if it had never been
   * reviewed, without reading the previous-review marker. Only together with `dryRun`.
   */
  fullReview: boolean;
  /**
   * `WACHIMAN_MODEL`, else `model` of the repository's `.wachiman.yml` (`applyRepoSettings`), else the
   * provider's default (`DEFAULT_MODELS`).
   */
  model: string;
  /** Where `model` came from. `loadConfig` sets `env` or `default`; `applyRepoSettings` may change `default` to `file`. */
  modelSource?: SettingSource;
  provider: string;
  /** `WACHIMAN_PRICE_PER_MTOK`: "input,cached_input,output" USD per million tokens, for a Codex model without a built-in price. */
  pricePerMTok?: string;
  /**
   * `WACHIMAN_EFFORT`: the reasoning effort, always explicit so a CLI default change cannot
   * alter reviews. Passed as `--effort` (Claude Code) or `model_reasoning_effort` (Codex).
   */
  effort: Effort;
  /** Where `effort` came from, as for `modelSource`. */
  effortSource?: SettingSource;
  /**
   * `WACHIMAN_MAX_TURNS`: the most agent turns one provider call may take. Passed as
   * `--max-turns` (Claude Code); Codex has no equivalent and ignores it.
   */
  maxTurns: number;
  /**
   * `WACHIMAN_CALL_TIMEOUT_S`: wall-clock limit on one provider call, in seconds. The call is
   * killed when it passes and ends as `timeout`.
   */
  callTimeoutS: number;
  /**
   * `WACHIMAN_ON_PROVIDER_UNAVAILABLE`: what a run does when the provider rejects every call
   * because the reviewer's own account cannot pay or authenticate (or stays rate-limited). `warn`
   * posts a notice and finishes green; `fail` posts it and fails the job.
   */
  onProviderUnavailable: "warn" | "fail";
  mention: string;
  /** Login allowed to command the tool. `comment` refuses to run when it is empty or a placeholder. */
  operator: string;
  /**
   * `WACHIMAN_ASKERS`: who may ask a question (ADR 0032 decision 5). `operator` (default): only
   * the operator. `write`: also a collaborator whose permission on the repository is admin,
   * maintain or write, checked by the engine on each question. Reviews stay operator-only.
   */
  askers: "operator" | "write";
  /**
   * `WACHIMAN_ASK_CEILING_USD`: the most the questions of everyone but the operator may spend
   * on one pull request, summed from the engine's own footers. The operator's questions are not limited.
   */
  askCeilingUsd: number;
  /** Extra exclude globs on top of the built-in ones. */
  exclude: string[];
  /**
   * `WACHIMAN_VERIFY`: after the batches, one more call tries to refute every finding above
   * `info` before it is posted (ADR 0027). Off by default; enabled only by `1` or `true`.
   */
  verify: boolean;
  /** `WACHIMAN_VERIFY_BUDGET_USD`: the verifier's reserve, taken out of `budgetUsd` (at most half of it). */
  verifyBudgetUsd: number;
  /** `WACHIMAN_VERIFIER_MODEL`: the verifier's model; it always runs at effort `high`. */
  verifierModel: string;
  /**
   * `WACHIMAN_CONFIDENCE`: PR Confidence (ADR 0033). A full review of a pull request lists the
   * claims in its title and body with one more small call, grades the change against them and
   * writes the grade into the description. Off by default; enabled only by `1` or `true`. Read by
   * the pull request review only: `wachiman local` never grades.
   */
  confidence: boolean;
}

/** The verifier's model when `WACHIMAN_VERIFIER_MODEL` is unset (Claude Code only). */
export const DEFAULT_VERIFIER_MODEL = "claude-opus-5-5";

type Env = Record<string, string | undefined>;

/**
 * `WACHIMAN_<name>`, else the deprecated `CLAUDE_REVIEW_<name>` (with a one-line notice on
 * stderr), else undefined. An empty value counts as unset.
 */
export function readSetting(env: Env, name: string, warn: (line: string) => void) {
  const current = env[`WACHIMAN_${name}`];
  if (current !== undefined && current !== "") return current;
  const old = env[`CLAUDE_REVIEW_${name}`];
  if (old !== undefined && old !== "") {
    warn(`CLAUDE_REVIEW_${name} is deprecated; use WACHIMAN_${name}.`);
    return old;
  }
  return undefined;
}

/**
 * `WACHIMAN_EFFORT`, else the deprecated `WACHIMAN_REASONING_EFFORT` (Codex only before),
 * else the default. An unknown value is a configuration error: a silent fallback would run the
 * review at an effort nobody chose.
 */
function readEffort(env: Env, warn: (line: string) => void): { value: Effort; source: SettingSource } {
  const current = readSetting(env, "EFFORT", warn);
  const old = readSetting(env, "REASONING_EFFORT", () => {});
  let name = "WACHIMAN_EFFORT";
  let raw = current;
  if (old !== undefined) {
    warn("WACHIMAN_REASONING_EFFORT is deprecated; use WACHIMAN_EFFORT.");
    if (raw === undefined) {
      raw = old;
      name = "WACHIMAN_REASONING_EFFORT";
    }
  }
  if (raw === undefined) return { value: DEFAULT_EFFORT, source: "default" };
  if (!(EFFORTS as readonly string[]).includes(raw)) {
    throw new UsageError(`${name} must be one of ${EFFORTS.join(", ")}, got "${raw}".`);
  }
  return { value: raw as Effort, source: "env" };
}

export function loadConfig(env: Env, warn: (line: string) => void = console.error): EngineConfig {
  const get = (name: string) => readSetting(env, name, warn);
  const number = (name: string, fallback: number, integer = false) => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
      throw new UsageError(`WACHIMAN_${name} must be a positive ${integer ? "integer" : "number"}, got "${raw}".`);
    }
    return value;
  };
  const effort = readEffort(env, warn);
  const onProviderUnavailable = get("ON_PROVIDER_UNAVAILABLE") ?? "warn";
  if (onProviderUnavailable !== "warn" && onProviderUnavailable !== "fail") {
    throw new UsageError(`WACHIMAN_ON_PROVIDER_UNAVAILABLE must be warn or fail, got "${onProviderUnavailable}".`);
  }
  const provider = get("PROVIDER") ?? "claude-code";
  const modelFromEnv = get("MODEL");
  const dryRun = get("DRY_RUN") === "1";
  const fullReview = get("FULL_REVIEW") === "1";
  if (fullReview && !dryRun) {
    throw new UsageError(
      "WACHIMAN_FULL_REVIEW=1 works only with WACHIMAN_DRY_RUN=1: a full review ignores the previous-review marker, so it is printed, never posted.",
    );
  }
  const verifyRaw = get("VERIFY");
  if (verifyRaw !== undefined && verifyRaw !== "0" && verifyRaw !== "1" && verifyRaw !== "true" && verifyRaw !== "false") {
    throw new UsageError(`WACHIMAN_VERIFY must be 1, true, 0 or false (unset means off), got "${verifyRaw}".`);
  }
  const verifierModel = get("VERIFIER_MODEL") ?? (provider === "claude-code" ? DEFAULT_VERIFIER_MODEL : undefined);
  // Verification is opt-in, including when a verifier model is configured.
  const verify = verifyRaw === "1" || verifyRaw === "true";
  if (verify && verifierModel === undefined) {
    throw new UsageError(`WACHIMAN_VERIFY needs WACHIMAN_VERIFIER_MODEL with the ${provider} provider: the default verifier is a Claude model.`);
  }
  const confidenceRaw = get("CONFIDENCE");
  if (confidenceRaw !== undefined && !["0", "1", "true", "false"].includes(confidenceRaw)) {
    throw new UsageError(`WACHIMAN_CONFIDENCE must be 1, true, 0 or false (unset means off), got "${confidenceRaw}".`);
  }
  const askers = get("ASKERS") ?? "operator";
  if (askers !== "operator" && askers !== "write") {
    throw new UsageError(`WACHIMAN_ASKERS must be operator or write, got "${askers}".`);
  }
  const trigger = get("TRIGGER")?.trim();
  if (trigger !== undefined && !/^[a-z_]+$/.test(trigger)) {
    throw new UsageError(`WACHIMAN_TRIGGER must be a lowercase event action such as synchronize, got "${trigger}".`);
  }
  const limitMode = get("LIMIT_MODE") ?? "fail";
  if (limitMode !== "fail" && limitMode !== "notice") {
    throw new UsageError(`WACHIMAN_LIMIT_MODE must be fail or notice, got "${limitMode}".`);
  }
  const ledgerUnavailable = get("LEDGER_UNAVAILABLE") ?? "run";
  if (ledgerUnavailable !== "run" && ledgerUnavailable !== "stop") {
    throw new UsageError(`WACHIMAN_LEDGER_UNAVAILABLE must be run or stop, got "${ledgerUnavailable}".`);
  }
  const bypass = get("LIMIT_BYPASS")?.trim();
  const ledgerUrl = get("LEDGER_URL")?.trim().replace(/\/+$/, "") || undefined;
  // The job's OIDC token is sent to this address: never over cleartext, except to the local machine for tests.
  if (ledgerUrl !== undefined && !/^https:\/\/\S/i.test(ledgerUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i.test(ledgerUrl)) {
    throw new UsageError(
      `WACHIMAN_LEDGER_URL must start with https:// (http://localhost and http://127.0.0.1 are allowed for tests), got "${ledgerUrl}".`,
    );
  }
  // With a ledger, `review-platform.yml` grants `id-token: write`, so the request token is in the
  // engine's environment; a Codex sandbox could read it from /proc and mint tokens as this job.
  // Without `ledger_url` nothing uses the token and the guard does not apply.
  if (ledgerUrl !== undefined && provider !== "claude-code" && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== undefined) {
    throw new UsageError(
      `WACHIMAN_PROVIDER ${provider} cannot run in a job that holds an OIDC request token: its sandbox can read it from the engine's environment. Use claude-code, or call review.yml instead of review-platform.yml.`,
    );
  }
  return {
    budgetUsd: number("BUDGET_USD", 3),
    autoBudgetUsd: number("AUTO_BUDGET_USD", 6),
    sizeGateUsd: number("SIZE_GATE_USD", 6),
    threadsBudgetUsd: number("THREADS_BUDGET_USD", 0.25),
    trigger: trigger || undefined,
    batchBudgetUsd: number("BATCH_BUDGET_USD", 0.75),
    answerBudgetUsd: number("ANSWER_BUDGET_USD", 1),
    batchLines: number("BATCH_LINES", 1000, true),
    batchChars: number("BATCH_CHARS", 140000, true),
    dryRun,
    fullReview,
    model: modelFromEnv ?? DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS] ?? DEFAULT_MODELS["claude-code"],
    modelSource: modelFromEnv === undefined ? "default" : "env",
    provider,
    pricePerMTok: get("PRICE_PER_MTOK"),
    effort: effort.value,
    effortSource: effort.source,
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
    confidence: confidenceRaw === "1" || confidenceRaw === "true",
    ledgerUrl,
    dailyBudgetUsd: get("DAILY_BUDGET_USD") === undefined ? undefined : number("DAILY_BUDGET_USD", 0),
    weeklyBudgetUsd: get("WEEKLY_BUDGET_USD") === undefined ? undefined : number("WEEKLY_BUDGET_USD", 0),
    limitMode,
    limitBypass: bypass === "1" || bypass === "true",
    ledgerUnavailable,
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
  if (login === "") return "The operator login is empty. Set `operator` (WACHIMAN_OPERATOR) to your GitHub login.";
  const lower = login.toLowerCase();
  if (lower.startsWith("edit") || PLACEHOLDER_OPERATORS.includes(lower)) {
    return `The operator login is still the template placeholder "${login}". Set \`operator\` (WACHIMAN_OPERATOR) to your GitHub login.`;
  }
  return undefined;
}
