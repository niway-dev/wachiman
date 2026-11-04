import { describe, expect, test } from "bun:test";
import { describeCall } from "./call-message";

const base = { label: "batch 1/2", isError: false, terminalReason: "success", turns: 3, costUsd: 0.314, durationMs: 42_100 };

describe("describeCall", () => {
  test("a finished call says how long it ran and what it cost", () => {
    expect(describeCall(base)).toBe("✅ batch 1/2: finished in 3 turns, 42.1 s, $0.31.");
  });

  test("one turn is singular", () => {
    expect(describeCall({ ...base, turns: 1 })).toContain("in 1 turn,");
  });

  test("no credit names the cause, quotes the API and says what to do", () => {
    const line = describeCall({
      ...base,
      isError: true,
      terminalReason: "error",
      turns: 1,
      costUsd: 0,
      durationMs: 306,
      providerError: "billing",
      errorText: "Credit balance is too low",
    });
    expect(line).toBe(
      '❌ batch 1/2: the Anthropic API refused the call: the account has no credit. Top up, then re-run this job. API said: "Credit balance is too low"',
    );
  });

  test("a rejected key points at the secret", () => {
    const line = describeCall({ ...base, isError: true, terminalReason: "error", providerError: "auth", errorText: "invalid x-api-key" });
    expect(line).toContain("the API key was rejected. Check the ANTHROPIC_API_KEY secret.");
  });

  test("a rate limit says it is temporary", () => {
    const line = describeCall({ ...base, isError: true, terminalReason: "error", providerError: "rate_limit", errorText: "429" });
    expect(line).toStartWith("⏳ batch 1/2: the Anthropic API rate-limited the call.");
  });

  test("an unclassified error keeps the text and the turn count", () => {
    const line = describeCall({ ...base, isError: true, terminalReason: "error", providerError: "other", errorText: "boom" });
    expect(line).toBe('❌ batch 1/2: the call failed after 3 turns. Error: "boom"');
  });

  test("budget, turn and time limits are named", () => {
    expect(describeCall({ ...base, isError: true, terminalReason: "budget" })).toBe("💸 batch 1/2: stopped at its budget after 3 turns, $0.31.");
    expect(describeCall({ ...base, isError: true, terminalReason: "turns" })).toBe("⏹️ batch 1/2: hit the turn limit after 3 turns, $0.31.");
    expect(describeCall({ ...base, isError: true, terminalReason: "timeout" })).toBe("⏱️ batch 1/2: killed at the time limit after 42.1 s.");
  });

  test("the error text is kept on one line and cut", () => {
    const line = describeCall({ ...base, isError: true, terminalReason: "error", providerError: "other", errorText: `a\nb ${"x".repeat(500)}` });
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(400);
  });
});
