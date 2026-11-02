import { describe, expect, test } from "bun:test";
import { judge, parseLabel, parseModel, parseVerdict, report, type RawComment } from "./precision";

describe("parseLabel", () => {
  test("reads the current two-axis label", () => {
    expect(parseLabel("🟠🐛 **Fix · bug: Arrow-left lands on the wrong preset**\n\nbody")).toEqual({
      severity: "fix",
      topic: "bug",
    });
  });
  test("reads the confidence the label carries, and none when it carries none", () => {
    expect(parseLabel("🟠🐛 **Fix · bug: Face is lost (confidence high)**\n\nbody")).toEqual({
      severity: "fix",
      topic: "bug",
      confidence: "high",
    });
    expect(parseLabel("🟡❓ **Consider · question: Deliberate? (confidence low)**")?.confidence).toBe("low");
    expect(parseLabel("🟠🐛 **Fix · bug: a (confidence high) in the middle**")?.confidence).toBeUndefined();
    expect(parseLabel("🟠🐛 **Fix · bug: no confidence**")).toEqual({ severity: "fix", topic: "bug" });
  });
  test("reads the label used before v1.1.0", () => {
    expect(parseLabel("**Note (other): Stale cell**")).toEqual({ severity: "note (old)", topic: "other" });
    expect(parseLabel("**Should fix (correctness): x**")).toEqual({ severity: "should_fix (old)", topic: "correctness" });
  });
  test("ignores a comment that is not a finding", () => {
    expect(parseLabel("Thanks, addressed.")).toBeNull();
  });
});

describe("parseVerdict", () => {
  // The four replies the owner wrote on kaipu-record pull request #384.
  test("reads the owner's real verdicts", () => {
    expect(parseVerdict("**Verdict: wrong (false positive).** `current` is never -1")).toBe("wrong");
    expect(parseVerdict("**Verdict: correct.** Fixed in 4b37e3fe")).toBe("correct");
    expect(parseVerdict("**Verdict: correct, and the gap is wider than reported.**")).toBe("correct");
    expect(parseVerdict("**Verdict: correct for the timer, wrong for the early patch.**")).toBe("partial");
    expect(
      parseVerdict("**Verdict: correct.** Fixed in 4b37e3fe: `useSettingsFocus` keeps only the focus-contract half"),
    ).toBe("correct");
  });
  test("reads the spellings the convention allows", () => {
    expect(parseVerdict("Verdict: partially wrong")).toBe("partial");
    expect(parseVerdict("verdict: incorrect")).toBe("wrong");
  });
  test("a reply without a verdict is not one", () => {
    expect(parseVerdict("I think this is correct")).toBeNull();
    expect(parseVerdict("Verdict: not sure yet")).toBeNull();
  });
});

test("parseModel reads the review footer", () => {
  expect(parseModel("…\n\n<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · $0.03</sub>")).toBe("Claude Sonnet 5.5");
  expect(parseModel("no footer")).toBe("unknown");
});

describe("judge and report", () => {
  const bot = { login: "github-actions[bot]" };
  const owner = { login: "csdev19" };
  const old = "2026-09-01T00:00:00Z";
  const comments: RawComment[] = [
    { id: 1, pull_request_review_id: 9, user: bot, body: "🟠🐛 **Fix · bug: a**", created_at: old },
    { id: 2, pull_request_review_id: 9, user: bot, body: "🟡📜 **Consider · rules: b**", created_at: old },
    { id: 3, pull_request_review_id: 9, user: bot, body: "🟡🧹 **Consider · cleanup: c**", created_at: old },
    { id: 4, in_reply_to_id: 1, user: owner, body: "**Verdict: wrong (false positive).**" },
    { id: 5, in_reply_to_id: 2, user: owner, body: "**Verdict: correct.**" },
    // A bot reply in its own thread is never read as a verdict.
    { id: 6, in_reply_to_id: 3, user: bot, body: "Verdict: correct" },
  ];
  const rows = judge(comments, new Map([[9, "Claude Sonnet 5.5"]]));

  test("pairs each finding with the owner's verdict and the review's model", () => {
    expect(rows).toEqual([
      { severity: "fix", topic: "bug", model: "Claude Sonnet 5.5", verdict: "wrong" },
      { severity: "consider", topic: "rules", model: "Claude Sonnet 5.5", verdict: "correct" },
      { severity: "consider", topic: "cleanup", model: "Claude Sonnet 5.5", verdict: "unjudged" },
    ]);
  });

  test("takes signed roots, and leaves out another workflow's comment", () => {
    const signed = "🟠🐛 **Fix · bug: s**\n\n<!-- wachi:finding -->";
    const found = judge(
      [
        { id: 1, user: bot, body: signed },
        // Same label, but signed as something else: not a finding.
        { id: 2, user: bot, body: "🟠🐛 **Fix · bug: f**\n\n<!-- wachi:reply -->" },
        { id: 3, user: bot, body: "Lint failed" },
        // The old unsigned format, created after the cutoff: an imitation.
        { id: 4, user: bot, body: "🟠🐛 **Fix · bug: i**", created_at: "2026-11-01T00:00:00Z" },
      ],
      new Map(),
    );
    expect(found).toEqual([{ severity: "fix", topic: "bug", model: "unknown", verdict: "unjudged" }]);
  });

  test("carries the confidence of a finding into its row, and tabulates precision by confidence", () => {
    const withConfidence = judge(
      [
        { id: 1, pull_request_review_id: 9, user: bot, body: "🟠🐛 **Fix · bug: a (confidence high)**\n\n<!-- wachi:finding -->" },
        { id: 2, pull_request_review_id: 9, user: bot, body: "🟠🐛 **Fix · bug: b (confidence low)**\n\n<!-- wachi:finding -->" },
        { id: 3, in_reply_to_id: 1, user: owner, body: "**Verdict: correct.**" },
        { id: 4, in_reply_to_id: 2, user: owner, body: "**Verdict: wrong.**" },
      ],
      new Map(),
    );
    expect(withConfidence.map((r) => r.confidence)).toEqual(["high", "low"]);
    const text = report(withConfidence);
    expect(text).toContain("### By confidence");
    expect(text).toContain("| high | 1 | 1 | 0 | 0 | 0 | 100% |");
    expect(text).toContain("| low | 1 | 0 | 0 | 1 | 0 | 0% |");
    // Reviews from before the field existed produce no confidence table.
    expect(report(rows)).not.toContain("By confidence");
  });

  test("precision counts only judged findings, a partial one as half", () => {
    const text = report([...rows, { severity: "fix", topic: "bug", model: "m", verdict: "partial" }]);
    expect(text).toContain("| fix | 2 | 0 | 1 | 1 | 0 | 25% |");
    expect(text).toContain("| consider | 2 | 1 | 0 | 0 | 1 | 100% |");
    expect(text).toContain("### By model");
  });
});
