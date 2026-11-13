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
      sizeGateUsd: 6,
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
      limitMode: "fail",
      limitBypass: false,
      ledgerUnavailable: "run",
    });
    expect(warnings).toEqual([]);
  });

  test("the ledger settings: unset means no ledger, mode defaults to fail, bypass to false, unavailable to run", () => {
    const { config: c } = load({});
    expect(c.ledgerUrl).toBeUndefined();
    expect(c.dailyBudgetUsd).toBeUndefined();
    expect(c.weeklyBudgetUsd).toBeUndefined();
    expect(c.limitMode).toBe("fail");
    expect(c.limitBypass).toBe(false);
    expect(c.ledgerUnavailable).toBe("run");
    expect(load({ WACHIMAN_LEDGER_URL: "  " }).config.ledgerUrl).toBeUndefined();
    // The workflow passes an empty string for a budget of 0 (unset).
    expect(load({ WACHIMAN_DAILY_BUDGET_USD: "", WACHIMAN_WEEKLY_BUDGET_USD: "" }).config.dailyBudgetUsd).toBeUndefined();
  });

  test("a provider other than claude-code is refused when a ledger url is set and an OIDC request token is present", () => {
    const message =
      "WACHIMAN_PROVIDER codex cannot run in a job that holds an OIDC request token: its sandbox can read it from the engine's environment. Use claude-code, or call review.yml instead of review-platform.yml.";
    const token = { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "bearer" };
    const ledger = { WACHIMAN_LEDGER_URL: "https://ledger.example" };
    expect(() => load({ ...token, ...ledger, WACHIMAN_PROVIDER: "codex" })).toThrow(message);
    expect(() => load({ ...token, ...ledger, WACHIMAN_PROVIDER: "codex" })).toThrow(UsageError);
    // Without a ledger url nothing uses the token: a job that merely holds `id-token: write` behaves as before.
    expect(load({ ...token, WACHIMAN_PROVIDER: "codex" }).config.provider).toBe("codex");
    expect(load({ ...token, WACHIMAN_LEDGER_URL: "", WACHIMAN_PROVIDER: "codex" }).config.provider).toBe("codex");
    expect(() => load({ ...token, ...ledger, WACHIMAN_PROVIDER: "codex", WACHIMAN_LIMIT_BYPASS: "true" })).toThrow(message);
    expect(load({ ...token, ...ledger, WACHIMAN_PROVIDER: "claude-code" }).config.ledgerUrl).toBe("https://ledger.example");
    // No token in the environment: Codex is fine, with or without a ledger url (the CLI case).
    expect(load({ WACHIMAN_PROVIDER: "codex" }).config.provider).toBe("codex");
    expect(load({ ...ledger, WACHIMAN_PROVIDER: "codex" }).config.provider).toBe("codex");
  });

  test("ledger url loses a trailing slash; the ledger settings are read; a bad mode is a usage error", () => {
    const { config: c } = load({
      WACHIMAN_LEDGER_URL: "https://ledger.example/",
      WACHIMAN_LIMIT_MODE: "notice",
      WACHIMAN_LIMIT_BYPASS: "true",
      WACHIMAN_LEDGER_UNAVAILABLE: "stop",
      WACHIMAN_DAILY_BUDGET_USD: "2.5",
      WACHIMAN_WEEKLY_BUDGET_USD: "10",
    });
    expect(c.ledgerUrl).toBe("https://ledger.example");
    expect(c.limitMode).toBe("notice");
    expect(c.limitBypass).toBe(true);
    expect(c.ledgerUnavailable).toBe("stop");
    expect(c.dailyBudgetUsd).toBe(2.5);
    expect(c.weeklyBudgetUsd).toBe(10);
    expect(() => load({ WACHIMAN_LIMIT_MODE: "warn" })).toThrow(/LIMIT_MODE must be fail or notice/);
    expect(() => load({ WACHIMAN_LEDGER_UNAVAILABLE: "ignore" })).toThrow(/LEDGER_UNAVAILABLE must be run or stop/);
    expect(() => load({ WACHIMAN_DAILY_BUDGET_USD: "0" })).toThrow(UsageError);
  });

  test("the ledger url must be https: the job's OIDC token travels to it; localhost is allowed for tests", () => {
    for (const url of ["http://ledger.example", "ledger.example", "ftp://ledger.example", "https://", "HTTP://ledger.example", "http://localhost.evil.example", "http://127.0.0.1.evil.example"]) {
      expect(() => load({ WACHIMAN_LEDGER_URL: url })).toThrow(UsageError);
      expect(() => load({ WACHIMAN_LEDGER_URL: url })).toThrow(/WACHIMAN_LEDGER_URL must start with https:\/\//);
    }
    for (const url of ["https://ledger.example", "HTTPS://ledger.example/base", "http://localhost", "http://localhost:8787", "http://localhost:8787/", "http://127.0.0.1:8787/v1", "http://127.0.0.1"]) {
      expect(load({ WACHIMAN_LEDGER_URL: url }).config.ledgerUrl).toBe(url.replace(/\/+$/, ""));
    }
    expect(load({ WACHIMAN_LEDGER_URL: "" }).config.ledgerUrl).toBeUndefined();
  });

  test("askers is operator or write, and anything else is a configuration error", () => {
    expect(load({ WACHIMAN_ASKERS: "write" }).config.askers).toBe("write");
    expect(load({ WACHIMAN_ASKERS: "operator" }).config.askers).toBe("operator");
    expect(() => load({ WACHIMAN_ASKERS: "everyone" })).toThrow('WACHIMAN_ASKERS must be operator or write, got "everyone".');
    expect(() => load({ WACHIMAN_ASKERS: "Write" })).toThrow(/WACHIMAN_ASKERS must be/);
  });

  test("the question ceiling is a positive number, $3 by default", () => {
    expect(load({ WACHIMAN_ASK_CEILING_USD: "5" }).config.askCeilingUsd).toBe(5);
    expect(() => load({ WACHIMAN_ASK_CEILING_USD: "0" })).toThrow("WACHIMAN_ASK_CEILING_USD must be a positive number");
  });

  test("PR Confidence is opt-in: only 1 or true turns it on, anything else but 0, false or unset is an error", () => {
    expect(load({}).config.confidence).toBe(false);
    expect(load({ WACHIMAN_CONFIDENCE: "1" }).config.confidence).toBe(true);
    expect(load({ WACHIMAN_CONFIDENCE: "true" }).config.confidence).toBe(true);
    expect(load({ WACHIMAN_CONFIDENCE: "0" }).config.confidence).toBe(false);
    expect(load({ WACHIMAN_CONFIDENCE: "false" }).config.confidence).toBe(false);
    expect(load({ WACHIMAN_CONFIDENCE: "" }).config.confidence).toBe(false);
    expect(() => load({ WACHIMAN_CONFIDENCE: "yes" })).toThrow(/WACHIMAN_CONFIDENCE must be/);
  });

  test("the verifier is opt-in and needs a model outside Claude Code", () => {
    expect(load({ WACHIMAN_VERIFY: "1" }).config).toMatchObject({ verify: true, verifierModel: "claude-opus-5-5", verifyBudgetUsd: 1 });
    expect(load({ WACHIMAN_VERIFY: "true", WACHIMAN_VERIFIER_MODEL: "claude-sonnet-5-5", WACHIMAN_VERIFY_BUDGET_USD: "0.5" }).config).toMatchObject({ verify: true, verifierModel: "claude-sonnet-5-5", verifyBudgetUsd: 0.5 });
    expect(load({ WACHIMAN_VERIFY: "0" }).config.verify).toBe(false);
    expect(load({ WACHIMAN_VERIFY: "false" }).config.verify).toBe(false);
    expect(load({ WACHIMAN_VERIFY: "" }).config.verify).toBe(false);
    expect(load({}).config.verify).toBe(false);
    expect(load({ WACHIMAN_VERIFIER_MODEL: "claude-opus-5-5" }).config.verify).toBe(false);
    // Selecting a verifier model alone must not enable an extra paid call.
    expect(load({ WACHIMAN_PROVIDER: "codex" }).config.verify).toBe(false);
    expect(load({ WACHIMAN_PROVIDER: "codex", WACHIMAN_VERIFIER_MODEL: "claude-opus-5-5" }).config.verify).toBe(false);
    expect(() => load({ WACHIMAN_VERIFY: "yes" })).toThrow(/WACHIMAN_VERIFY must be/);
    expect(() => load({ WACHIMAN_VERIFY: "1", WACHIMAN_PROVIDER: "codex" })).toThrow(/WACHIMAN_VERIFIER_MODEL/);
  });

  test("a full review is a dry-run option only", () => {
    expect(load({ WACHIMAN_FULL_REVIEW: "1", WACHIMAN_DRY_RUN: "1" }).config.fullReview).toBe(true);
    expect(load({ WACHIMAN_DRY_RUN: "1" }).config.fullReview).toBe(false);
    expect(() => load({ WACHIMAN_FULL_REVIEW: "1" })).toThrow(UsageError);
    expect(() => load({ WACHIMAN_FULL_REVIEW: "1" })).toThrow(/WACHIMAN_FULL_REVIEW.*WACHIMAN_DRY_RUN/);
  });

  test("reads the per-pull-request ceiling and the thread run's budget", () => {
    const { config } = load({ WACHIMAN_AUTO_BUDGET_USD: "0.5", WACHIMAN_THREADS_BUDGET_USD: "0.1" });
    expect(config).toMatchObject({ autoBudgetUsd: 0.5, threadsBudgetUsd: 0.1 });
  });

  test("rejects a ceiling or a thread budget that is not a positive number", () => {
    for (const bad of ["0", "-1", "two", "NaN", "Infinity"]) {
      expect(() => load({ WACHIMAN_AUTO_BUDGET_USD: bad })).toThrow(UsageError);
      expect(() => load({ WACHIMAN_THREADS_BUDGET_USD: bad })).toThrow(UsageError);
    }
    expect(() => load({ WACHIMAN_AUTO_BUDGET_USD: "abc" })).toThrow("WACHIMAN_AUTO_BUDGET_USD");
  });

  test("reads the size gate and rejects one that is not a positive number", () => {
    expect(load({ WACHIMAN_SIZE_GATE_USD: "12.5" }).config.sizeGateUsd).toBe(12.5);
    for (const bad of ["0", "-1", "two", "NaN", "Infinity"]) {
      expect(() => load({ WACHIMAN_SIZE_GATE_USD: bad })).toThrow(UsageError);
    }
    expect(() => load({ WACHIMAN_SIZE_GATE_USD: "abc" })).toThrow("WACHIMAN_SIZE_GATE_USD");
  });

  test("a run is automatic unless the trigger is absent or the operator's comment", () => {
    expect(load({}).config.trigger).toBeUndefined();
    expect(load({ WACHIMAN_TRIGGER: "synchronize" }).config.trigger).toBe("synchronize");
    expect(isAutomatic(undefined)).toBe(false);
    expect(isAutomatic("comment")).toBe(false);
    for (const t of ["opened", "ready_for_review", "synchronize", "reopened", "thread"]) expect(isAutomatic(t)).toBe(true);
  });

  test("rejects a trigger that is not an event action", () => {
    expect(() => load({ WACHIMAN_TRIGGER: "Sync Now!" })).toThrow(UsageError);
  });

  test("reads WACHIMAN_ON_PROVIDER_UNAVAILABLE: warn or fail, anything else is a usage error", () => {
    expect(load({ WACHIMAN_ON_PROVIDER_UNAVAILABLE: "fail" }).config.onProviderUnavailable).toBe("fail");
    expect(load({ WACHIMAN_ON_PROVIDER_UNAVAILABLE: "warn" }).config.onProviderUnavailable).toBe("warn");
    expect(load({ WACHIMAN_ON_PROVIDER_UNAVAILABLE: "" }).config.onProviderUnavailable).toBe("warn");
    expect(() => load({ WACHIMAN_ON_PROVIDER_UNAVAILABLE: "ignore" })).toThrow(UsageError);
    expect(() => load({ WACHIMAN_ON_PROVIDER_UNAVAILABLE: "ignore" })).toThrow("WACHIMAN_ON_PROVIDER_UNAVAILABLE");
  });

  test("reads WACHIMAN_MAX_TURNS and WACHIMAN_CALL_TIMEOUT_S", () => {
    const { config } = load({ WACHIMAN_MAX_TURNS: "25", WACHIMAN_CALL_TIMEOUT_S: "600" });
    expect(config).toMatchObject({ maxTurns: 25, callTimeoutS: 600 });
  });

  test("rejects a turn cap or a call timeout that is not a positive integer", () => {
    for (const bad of ["0", "-3", "2.5", "forty", "NaN"]) {
      expect(() => load({ WACHIMAN_MAX_TURNS: bad })).toThrow(UsageError);
      expect(() => load({ WACHIMAN_CALL_TIMEOUT_S: bad })).toThrow(UsageError);
    }
    expect(() => load({ WACHIMAN_MAX_TURNS: "0" })).toThrow("WACHIMAN_MAX_TURNS must be a positive integer");
    expect(() => load({ WACHIMAN_CALL_TIMEOUT_S: "x" })).toThrow("WACHIMAN_CALL_TIMEOUT_S");
  });

  test("an empty value counts as unset", () => {
    expect(load({ WACHIMAN_MAX_TURNS: "", WACHIMAN_CALL_TIMEOUT_S: "" }).config).toMatchObject({
      maxTurns: 40,
      callTimeoutS: 900,
    });
  });

  test("reads WACHIMAN_EFFORT and accepts every documented level", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(load({ WACHIMAN_EFFORT: effort }).config.effort).toBe(effort);
    }
  });

  test("rejects an unknown effort instead of falling back", () => {
    expect(() => load({ WACHIMAN_EFFORT: "ultra" })).toThrow(UsageError);
    expect(() => load({ WACHIMAN_EFFORT: "ultra" })).toThrow("low, medium, high, xhigh, max");
    expect(() => load({ WACHIMAN_REASONING_EFFORT: "turbo" })).toThrow("WACHIMAN_REASONING_EFFORT");
  });

  test("keeps WACHIMAN_REASONING_EFFORT as a deprecated alias that loses to WACHIMAN_EFFORT", () => {
    const alias = load({ WACHIMAN_REASONING_EFFORT: "low" });
    expect(alias.config.effort).toBe("low");
    expect(alias.warnings.some((w) => w.includes("deprecated"))).toBe(true);
    const both = load({ WACHIMAN_REASONING_EFFORT: "low", WACHIMAN_EFFORT: "max" });
    expect(both.config.effort).toBe("max");
    expect(both.warnings.some((w) => w.includes("WACHIMAN_REASONING_EFFORT is deprecated"))).toBe(true);
  });

  test("reads the WACHIMAN_ names", () => {
    const { config, warnings } = load({
      WACHIMAN_BUDGET_USD: "5",
      WACHIMAN_DRY_RUN: "1",
      WACHIMAN_MENTION: "@reviewer",
      WACHIMAN_OPERATOR: "someone",
      WACHIMAN_EXCLUDE: "a/**,b/**",
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
      WACHIMAN_MODEL: "new-model",
    });
    expect(config.batchLines).toBe(500);
    expect(config.model).toBe("new-model");
    expect(warnings).toEqual(["CLAUDE_REVIEW_BATCH_LINES is deprecated; use WACHIMAN_BATCH_LINES."]);
  });

  test("rejects a number that is not positive", () => {
    expect(() => load({ WACHIMAN_BUDGET_USD: "abc" })).toThrow(UsageError);
    expect(() => load({ WACHIMAN_BATCH_LINES: "1.5" })).toThrow(UsageError);
    expect(() => load({ WACHIMAN_BATCH_BUDGET_USD: "0" })).toThrow(UsageError);
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
