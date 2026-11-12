/** The stop rule of `wachiman loop` (ADR 0034 decision 5): pure, so no model call and no repository. */
import { describe, expect, test } from "bun:test";
import { evaluate, isRefutedBy, roundCapReached, type LoopFinding } from "./stop-rule";

const finding = (over: Partial<LoopFinding> = {}): LoopFinding => ({
  id: "aaaaaaaaaa",
  path: "src/a.ts",
  line: 2,
  severity: "blocker",
  topic: "bug",
  title: "T",
  status: "new",
  refuted: false,
  linesChanged: false,
  ...over,
});

describe("evaluate", () => {
  test("a Blocker or a Fix that is new, open, not-repeated or unknown keeps the loop open", () => {
    for (const severity of ["blocker", "fix"] as const) {
      for (const status of ["new", "open", "not-repeated", "unknown"] as const) {
        const d = evaluate([finding({ severity, status })]);
        expect(d.open.map((o) => o.id)).toEqual(["aaaaaaaaaa"]);
        expect(d.converged).toBe(false);
      }
    }
  });

  test("a Consider and an Info never keep it open; they are notes", () => {
    for (const severity of ["consider", "info"] as const) {
      const d = evaluate([finding({ severity, status: "open" })]);
      expect(d.converged).toBe(true);
      expect(d.open).toEqual([]);
      expect(d.notes.map((n) => n.id)).toEqual(["aaaaaaaaaa"]);
    }
  });

  test("probably-fixed releases a finding", () => {
    const d = evaluate([finding({ status: "probably-fixed" })]);
    expect(d.converged).toBe(true);
    expect(d.released).toEqual([{ finding: expect.objectContaining({ id: "aaaaaaaaaa" }), why: "probably-fixed" }]);
  });

  test("not-repeated stays open until the lines changed; then it is released", () => {
    expect(evaluate([finding({ status: "not-repeated", linesChanged: false })]).converged).toBe(false);
    const released = evaluate([finding({ status: "not-repeated", linesChanged: true })]);
    expect(released.converged).toBe(true);
    expect(released.released[0].why).toBe("probably-fixed");
  });

  test("changed lines alone do not release a finding the round reported again", () => {
    expect(evaluate([finding({ status: "open", linesChanged: true })]).converged).toBe(false);
  });

  test("a refuted finding is released as refuted", () => {
    const d = evaluate([finding({ refuted: true })]);
    expect(d.converged).toBe(true);
    expect(d.released[0].why).toBe("refuted");
  });

  test("judged wrong with a reason releases it, and the reason travels; without a reason it stays open", () => {
    const withReason = evaluate([finding({ verdict: { verdict: "wrong", reason: "the guard is two lines up" } })]);
    expect(withReason.converged).toBe(true);
    expect(withReason.released).toEqual([
      { finding: expect.objectContaining({ id: "aaaaaaaaaa" }), why: "judged wrong", reason: "the guard is two lines up" },
    ]);
    for (const verdict of [{ verdict: "wrong" as const }, { verdict: "wrong" as const, reason: "   " }]) {
      const bare = evaluate([finding({ verdict })]);
      expect(bare.converged).toBe(false);
      expect(bare.open[0].unreasonedWrong).toBe(true);
    }
  });

  test("partial and correct verdicts do not release", () => {
    for (const verdict of ["partial", "correct"] as const) {
      expect(evaluate([finding({ verdict: { verdict, reason: "x" } })]).converged).toBe(false);
    }
  });

  test("a mix: one open Blocker keeps it open and the released ones are still listed", () => {
    const d = evaluate([
      finding({ id: "1111111111" }),
      finding({ id: "2222222222", status: "probably-fixed" }),
      finding({ id: "3333333333", severity: "info" }),
      finding({ id: "4444444444", verdict: { verdict: "wrong", reason: "r" } }),
    ]);
    expect(d.open.map((f) => f.id)).toEqual(["1111111111"]);
    expect(d.released.map((r) => r.finding.id)).toEqual(["2222222222", "4444444444"]);
    expect(d.notes.map((f) => f.id)).toEqual(["3333333333"]);
    expect(d.converged).toBe(false);
  });

  test("no findings at all is converged", () => {
    expect(evaluate([])).toEqual({ open: [], released: [], notes: [], converged: true });
  });
});

describe("roundCapReached", () => {
  test("a loop that already ran as many rounds as the cap stops", () => {
    expect(roundCapReached(0, 3)).toBe(false);
    expect(roundCapReached(2, 3)).toBe(false);
    expect(roundCapReached(3, 3)).toBe(true);
    expect(roundCapReached(4, 3)).toBe(true);
  });
});

describe("isRefutedBy", () => {
  const tracked = { path: "src/a.ts", topic: "bug" as const, titleKey: "null deref", lineText: "returnuser.name;" };
  test("same file, topic and title key matches", () => {
    expect(isRefutedBy({ ...tracked, lineText: undefined }, tracked)).toBe(true);
    expect(isRefutedBy({ ...tracked, lineText: "somethingelse();" }, tracked)).toBe(true);
  });
  test("the same title key under another topic does not match", () => {
    expect(isRefutedBy({ ...tracked, topic: "perf", lineText: "somethingelse();" }, tracked)).toBe(false);
  });
  test("the same topic with a different title and different line text does not match, whatever the line number", () => {
    expect(isRefutedBy({ ...tracked, titleKey: "other", lineText: "somethingelse();" }, tracked)).toBe(false);
  });
  test("the same cited line text and topic matches even when the line moved or the title differs", () => {
    expect(isRefutedBy({ ...tracked, titleKey: "other" }, tracked)).toBe(true);
  });
  test("the same cited line text under another topic does not match: a disproof of another concern closes nothing", () => {
    expect(isRefutedBy({ ...tracked, titleKey: "other", topic: "security" }, tracked)).toBe(false);
  });
  test("the text branch is skipped when either side has no line text", () => {
    expect(isRefutedBy({ ...tracked, titleKey: "other", lineText: undefined }, tracked)).toBe(false);
    expect(isRefutedBy({ ...tracked, titleKey: "other" }, { ...tracked, lineText: undefined })).toBe(false);
  });
  test("never another file", () => {
    expect(isRefutedBy({ ...tracked, path: "src/b.ts" }, tracked)).toBe(false);
  });
});
