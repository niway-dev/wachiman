import { describe, expect, test } from "bun:test";
import { isAutomatic, loadConfig, operatorProblem, UsageError } from "./config";

const load = (env: Record<string, string>) => {
  const warnings: string[] = [];
  return { config: loadConfig(env, (l) => warnings.push(l)), warnings };
};

describe("loadConfig", () => {
  test("has the documented defaults", () => {
    const { config, warnings } = load({});
    expect(config).toEqual({
      budgetUsd: 3,
      autoBudgetUsd: 6,
      threadsBudgetUsd: 0.25,
      trigger: undefined,
      batchBudgetUsd: 0.75,
      answerBudgetUsd: 1,
      batchLines: 1000,
      batchChars: 140000,
      dryRun: false,
      fullReview: false,
      model: "claude-sonnet-5-5",
      provider: "claude-code",
      effort: "high",
      maxTurns: 40,
      callTimeoutS: 900,
      onProviderUnavailable: "warn",
      mention: "/wachiman",
      operator: "",
      askers: "operator",
      askCeilingUsd: 3,
      exclude: [],
      verify: false,
      verifyBudgetUsd: 1,
      verifierModel: "claude-opus-5-5",
      confidence: false,
    });
    expect(warnings).toEqual([]);
  });

  test("askers is operator or write, and anything else is a configuration error", () => {
    expect(load({ AGENT_REVIEW_ASKERS: "write" }).config.askers).toBe("write");
    expect(load({ AGENT_REVIEW_ASKERS: "operator" }).config.askers).toBe("operator");
    expect(() => load({ AGENT_REVIEW_ASKERS: "everyone" })).toThrow('AGENT_REVIEW_ASKERS must be operator or write, got "everyone".');
    expect(() => load({ AGENT_REVIEW_ASKERS: "Write" })).toThrow(/AGENT_REVIEW_ASKERS must be/);
  });

  test("the question ceiling is a positive number, $3 by default", () => {
    expect(load({ AGENT_REVIEW_ASK_CEILING_USD: "5" }).config.askCeilingUsd).toBe(5);
    expect(() => load({ AGENT_REVIEW_ASK_CEILING_USD: "0" })).toThrow("AGENT_REVIEW_ASK_CEILING_USD must be a positive number");
  });

  test("PR Confidence is opt-in: only 1 or true turns it on, anything else but 0, false or unset is an error", () => {
    expect(load({}).config.confidence).toBe(false);
    expect(load({ AGENT_REVIEW_CONFIDENCE: "1" }).config.confidence).toBe(true);
    expect(load({ AGENT_REVIEW_CONFIDENCE: "true" }).config.confidence).toBe(true);
    expect(load({ AGENT_REVIEW_CONFIDENCE: "0" }).config.confidence).toBe(false);
    expect(load({ AGENT_REVIEW_CONFIDENCE: "false" }).config.confidence).toBe(false);
    expect(load({ AGENT_REVIEW_CONFIDENCE: "" }).config.confidence).toBe(false);
    expect(() => load({ AGENT_REVIEW_CONFIDENCE: "yes" })).toThrow(/AGENT_REVIEW_CONFIDENCE must be/);
  });

  test("the verifier is opt-in and needs a model outside Claude Code", () => {
    expect(load({ AGENT_REVIEW_VERIFY: "1" }).config).toMatchObject({ verify: true, verifierModel: "claude-opus-5-5", verifyBudgetUsd: 1 });
    expect(load({ AGENT_REVIEW_VERIFY: "true", AGENT_REVIEW_VERIFIER_MODEL: "claude-sonnet-5-5", AGENT_REVIEW_VERIFY_BUDGET_USD: "0.5" }).config).toMatchObject({ verify: true, verifierModel: "claude-sonnet-5-5", verifyBudgetUsd: 0.5 });
    expect(load({ AGENT_REVIEW_VERIFY: "0" }).config.verify).toBe(false);
    expect(load({ AGENT_REVIEW_VERIFY: "false" }).config.verify).toBe(false);
    expect(load({ AGENT_REVIEW_VERIFY: "" }).config.verify).toBe(false);
    expect(load({}).config.verify).toBe(false);
    expect(load({ AGENT_REVIEW_VERIFIER_MODEL: "claude-opus-5-5" }).config.verify).toBe(false);
    // Selecting a verifier model alone must not enable an extra paid call.
    expect(load({ AGENT_REVIEW_PROVIDER: "codex" }).config.verify).toBe(false);
    expect(load({ AGENT_REVIEW_PROVIDER: "codex", AGENT_REVIEW_VERIFIER_MODEL: "claude-opus-5-5" }).config.verify).toBe(false);
    expect(() => load({ AGENT_REVIEW_VERIFY: "yes" })).toThrow(/AGENT_REVIEW_VERIFY must be/);
    expect(() => load({ AGENT_REVIEW_VERIFY: "1", AGENT_REVIEW_PROVIDER: "codex" })).toThrow(/AGENT_REVIEW_VERIFIER_MODEL/);
  });

  test("a full review is a dry-run option only", () => {
    expect(load({ AGENT_REVIEW_FULL_REVIEW: "1", AGENT_REVIEW_DRY_RUN: "1" }).config.fullReview).toBe(true);
    expect(load({ AGENT_REVIEW_DRY_RUN: "1" }).config.fullReview).toBe(false);
    expect(() => load({ AGENT_REVIEW_FULL_REVIEW: "1" })).toThrow(UsageError);
    expect(() => load({ AGENT_REVIEW_FULL_REVIEW: "1" })).toThrow(/AGENT_REVIEW_FULL_REVIEW.*AGENT_REVIEW_DRY_RUN/);
  });

  test("reads the per-pull-request ceiling and the thread run's budget", () => {
    const { config } = load({ AGENT_REVIEW_AUTO_BUDGET_USD: "0.5", AGENT_REVIEW_THREADS_BUDGET_USD: "0.1" });
    expect(config).toMatchObject({ autoBudgetUsd: 0.5, threadsBudgetUsd: 0.1 });
  });

  test("rejects a ceiling or a thread budget that is not a positive number", () => {
    for (const bad of ["0", "-1", "two", "NaN", "Infinity"]) {
      expect(() => load({ AGENT_REVIEW_AUTO_BUDGET_USD: bad })).toThrow(UsageError);
      expect(() => load({ AGENT_REVIEW_THREADS_BUDGET_USD: bad })).toThrow(UsageError);
    }
    expect(() => load({ AGENT_REVIEW_AUTO_BUDGET_USD: "abc" })).toThrow("AGENT_REVIEW_AUTO_BUDGET_USD");
  });

  test("a run is automatic unless the trigger is absent or the operator's comment", () => {
    expect(load({}).config.trigger).toBeUndefined();
    expect(load({ AGENT_REVIEW_TRIGGER: "synchronize" }).config.trigger).toBe("synchronize");
    expect(isAutomatic(undefined)).toBe(false);
    expect(isAutomatic("comment")).toBe(false);
    for (const t of ["opened", "ready_for_review", "synchronize", "reopened", "thread"]) expect(isAutomatic(t)).toBe(true);
  });

  test("rejects a trigger that is not an event action", () => {
    expect(() => load({ AGENT_REVIEW_TRIGGER: "Sync Now!" })).toThrow(UsageError);
  });

  test("reads AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE: warn or fail, anything else is a usage error", () => {
    expect(load({ AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE: "fail" }).config.onProviderUnavailable).toBe("fail");
    expect(load({ AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE: "warn" }).config.onProviderUnavailable).toBe("warn");
    expect(load({ AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE: "" }).config.onProviderUnavailable).toBe("warn");
    expect(() => load({ AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE: "ignore" })).toThrow(UsageError);
    expect(() => load({ AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE: "ignore" })).toThrow("AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE");
  });

  test("reads AGENT_REVIEW_MAX_TURNS and AGENT_REVIEW_CALL_TIMEOUT_S", () => {
    const { config } = load({ AGENT_REVIEW_MAX_TURNS: "25", AGENT_REVIEW_CALL_TIMEOUT_S: "600" });
    expect(config).toMatchObject({ maxTurns: 25, callTimeoutS: 600 });
  });

  test("rejects a turn cap or a call timeout that is not a positive integer", () => {
    for (const bad of ["0", "-3", "2.5", "forty", "NaN"]) {
      expect(() => load({ AGENT_REVIEW_MAX_TURNS: bad })).toThrow(UsageError);
      expect(() => load({ AGENT_REVIEW_CALL_TIMEOUT_S: bad })).toThrow(UsageError);
    }
    expect(() => load({ AGENT_REVIEW_MAX_TURNS: "0" })).toThrow("AGENT_REVIEW_MAX_TURNS must be a positive integer");
    expect(() => load({ AGENT_REVIEW_CALL_TIMEOUT_S: "x" })).toThrow("AGENT_REVIEW_CALL_TIMEOUT_S");
  });

  test("an empty value counts as unset", () => {
    expect(load({ AGENT_REVIEW_MAX_TURNS: "", AGENT_REVIEW_CALL_TIMEOUT_S: "" }).config).toMatchObject({
      maxTurns: 40,
      callTimeoutS: 900,
    });
  });

  test("reads AGENT_REVIEW_EFFORT and accepts every documented level", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(load({ AGENT_REVIEW_EFFORT: effort }).config.effort).toBe(effort);
    }
  });

  test("rejects an unknown effort instead of falling back", () => {
    expect(() => load({ AGENT_REVIEW_EFFORT: "ultra" })).toThrow(UsageError);
    expect(() => load({ AGENT_REVIEW_EFFORT: "ultra" })).toThrow("low, medium, high, xhigh, max");
    expect(() => load({ AGENT_REVIEW_REASONING_EFFORT: "turbo" })).toThrow("AGENT_REVIEW_REASONING_EFFORT");
  });

  test("keeps AGENT_REVIEW_REASONING_EFFORT as a deprecated alias that loses to AGENT_REVIEW_EFFORT", () => {
    const alias = load({ AGENT_REVIEW_REASONING_EFFORT: "low" });
    expect(alias.config.effort).toBe("low");
    expect(alias.warnings.some((w) => w.includes("deprecated"))).toBe(true);
    const both = load({ AGENT_REVIEW_REASONING_EFFORT: "low", AGENT_REVIEW_EFFORT: "max" });
    expect(both.config.effort).toBe("max");
    expect(both.warnings.some((w) => w.includes("AGENT_REVIEW_REASONING_EFFORT is deprecated"))).toBe(true);
  });

  test("reads the AGENT_REVIEW_ names", () => {
    const { config, warnings } = load({
      AGENT_REVIEW_BUDGET_USD: "5",
      AGENT_REVIEW_DRY_RUN: "1",
      AGENT_REVIEW_MENTION: "@reviewer",
      AGENT_REVIEW_OPERATOR: "someone",
      AGENT_REVIEW_EXCLUDE: "a/**,b/**",
    });
    expect(config).toMatchObject({
      budgetUsd: 5,
      dryRun: true,
      mention: "@reviewer",
      operator: "someone",
      exclude: ["a/**", "b/**"],
    });
    expect(warnings).toEqual([]);
  });

  test("falls back to the old CLAUDE_REVIEW_ name with one notice, and the new name wins", () => {
    const { config, warnings } = load({
      CLAUDE_REVIEW_BATCH_LINES: "500",
      CLAUDE_REVIEW_MODEL: "old-model",
      AGENT_REVIEW_MODEL: "new-model",
    });
    expect(config.batchLines).toBe(500);
    expect(config.model).toBe("new-model");
    expect(warnings).toEqual(["CLAUDE_REVIEW_BATCH_LINES is deprecated; use AGENT_REVIEW_BATCH_LINES."]);
  });

  test("rejects a number that is not positive", () => {
    expect(() => load({ AGENT_REVIEW_BUDGET_USD: "abc" })).toThrow(UsageError);
    expect(() => load({ AGENT_REVIEW_BATCH_LINES: "1.5" })).toThrow(UsageError);
    expect(() => load({ AGENT_REVIEW_BATCH_BUDGET_USD: "0" })).toThrow(UsageError);
  });
});

describe("operatorProblem", () => {
  test("flags empty and placeholder logins, accepts a real one", () => {
    expect(operatorProblem(undefined)).toContain("empty");
    expect(operatorProblem("")).toContain("empty");
    expect(operatorProblem("EDIT-THIS-github-login")).toContain("placeholder");
    expect(operatorProblem("your-github-login")).toContain("placeholder");
    expect(operatorProblem("editor-bot")).toContain("placeholder"); // anything starting with "edit"
    expect(operatorProblem("csdev19")).toBeUndefined();
  });
});
