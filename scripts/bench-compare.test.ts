import { describe, expect, test } from "bun:test";
import { MARKER, compare, median, parseArgs, render, type BenchRun } from "./bench-compare";

const run = (commit: string, medians: Record<string, number>): BenchRun => ({
  commit,
  date: "2026-11-21",
  results: Object.entries(medians).map(([name, median_ms]) => ({ case: name, median_ms })),
});

describe("bench-compare", () => {
  test("median of an odd and an even list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test("takes the median of the rounds on each side and reports the change in percent", () => {
    const base = [run("b", { a: 100 }), run("b", { a: 200 }), run("b", { a: 100 })];
    const head = [run("h", { a: 130 }), run("h", { a: 120 }), run("h", { a: 500 })];
    const [row] = compare(base, head, { thresholdPct: 25, minDeltaMs: 0 }).rows;
    expect(row).toMatchObject({ case: "a", baseMs: 100, headMs: 130, changePct: 30, regressed: true });
  });

  test("a slowdown at or below the threshold passes, an improvement never fails", () => {
    const base = [run("b", { slow: 100, fast: 100, same: 100 })];
    const head = [run("h", { slow: 125, fast: 50, same: 100 })];
    const { rows, failed } = compare(base, head, { thresholdPct: 25, minDeltaMs: 0 });
    expect(rows.map((r) => r.regressed)).toEqual([false, false, false]);
    expect(failed).toBe(false);
  });

  test("a big percentage on a tiny absolute change does not fail", () => {
    const { failed } = compare([run("b", { a: 4 })], [run("h", { a: 8 })], { thresholdPct: 25, minDeltaMs: 10 });
    expect(failed).toBe(false);
  });

  test("a case on one side only is listed and never fails", () => {
    const { rows, failed } = compare([run("b", { old: 10 })], [run("h", { fresh: 10 })], { thresholdPct: 25, minDeltaMs: 0 });
    expect(rows.map((r) => [r.case, r.baseMs, r.headMs, r.regressed])).toEqual([
      ["old", 10, null, false],
      ["fresh", null, 10, false],
    ]);
    expect(failed).toBe(false);
  });

  test("the table has the hidden marker, one line per case and the threshold", () => {
    const result = compare([run("b", { a: 100, b: 100 })], [run("h", { a: 150, b: 90 })], { thresholdPct: 25, minDeltaMs: 0 });
    const md = render(result, { thresholdPct: 25, minDeltaMs: 10, rounds: 1, baseCommit: "abc1234", headCommit: "def5678" });
    expect(md.startsWith(MARKER)).toBe(true);
    expect(md).toContain("| a | 100.0 ms | 150.0 ms | +50.0% | regressed |");
    expect(md).toContain("| b | 100.0 ms | 90.0 ms | -10.0% | ok |");
    expect(md).toContain("more than 25% and at least 10 ms slower");
    expect(md).toContain("abc1234");
  });

  test("argument parsing: files after --base and --head, numeric options", () => {
    expect(parseArgs(["--threshold", "30", "--min-delta-ms=5", "--base", "b1", "b2", "--head", "h1", "h2", "--out", "x.md"])).toEqual({
      base: ["b1", "b2"],
      head: ["h1", "h2"],
      thresholdPct: 30,
      minDeltaMs: 5,
      out: "x.md",
      baseCommit: undefined,
      headCommit: undefined,
    });
    expect(parseArgs(["--base", "b", "--head", "h", "--head-commit", "abc1234"]).headCommit).toBe("abc1234");
    expect(parseArgs(["--base", "b", "--head", "h", "--out=a=b.md"]).out).toBe("a=b.md");
    expect(() => parseArgs(["--base", "b"])).toThrow(/--head/);
    expect(() => parseArgs(["--threshold", "x", "--base", "b", "--head", "h"])).toThrow(/threshold/);
  });
});
