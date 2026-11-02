import { describe, expect, test } from "bun:test";
import { loadConfig, operatorProblem, UsageError } from "./config";

const load = (env: Record<string, string>) => {
  const warnings: string[] = [];
  return { config: loadConfig(env, (l) => warnings.push(l)), warnings };
};

describe("loadConfig", () => {
  test("has the documented defaults", () => {
    const { config, warnings } = load({});
    expect(config).toEqual({
      budgetUsd: 3,
      batchBudgetUsd: 0.75,
      answerBudgetUsd: 1,
      batchLines: 1000,
      batchChars: 140000,
      dryRun: false,
      model: "claude-sonnet-5-5",
      provider: "claude-code",
      effort: "high",
      maxTurns: 40,
      callTimeoutS: 900,
      mention: "/wachi",
      operator: "",
      exclude: [],
    });
    expect(warnings).toEqual([]);
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
