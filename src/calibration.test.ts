import { describe, expect, test } from "bun:test";
import { aggregateCells, bandOf, formatCellTable, movedWord, wilsonInterval, type Finding } from "./calibration";

describe("wilsonInterval", () => {
  test("no data gives the whole range", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
  test("20 of 20 at 90% has its lower end near 0.881 and upper end at 1", () => {
    const { low, high } = wilsonInterval(20, 20);
    // z^2 = 2.7055, denom = 1 + z^2/20 = 1.1353, center = (1 + 0.0676) / 1.1353 = 0.9404,
    // margin = 1.6449 * sqrt(2.7055 / 1600) / 1.1353 = 0.0596, so low = 0.8808.
    expect(Math.abs(low - 0.8808)).toBeLessThan(0.005);
    expect(high).toBeCloseTo(1, 10);
  });
  test("p = 0.5 at n = 100 brackets the estimate", () => {
    const { low, high } = wilsonInterval(50, 100);
    expect(low).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.5);
  });
});

describe("bandOf", () => {
  test.each([
    [0, "fyi"],
    [24.99, "fyi"],
    [25, "could"],
    [59.99, "could"],
    [60, "should"],
    [100, "should"],
  ] as const)("rank %d is %s", (rank, word) => {
    expect(bandOf(rank)).toBe(word);
  });
});

describe("movedWord", () => {
  test("19 judged is not measured", () => {
    expect(movedWord("could", 19, 19, 5)).toEqual({ word: "could", measured: false });
  });
  test("4 pull requests is not measured", () => {
    expect(movedWord("could", 20, 20, 4)).toEqual({ word: "could", measured: false });
  });
  test("20 of 20 across 5 PRs moves Could up to Should", () => {
    // lower end ~0.881 -> rank 88.1 -> band should, above could.
    expect(movedWord("could", 20, 20, 5)).toEqual({ word: "should", measured: true });
  });
  test("0 of 20 across 5 PRs moves Should down to FYI", () => {
    // upper end ~0.161 -> rank 16.1 -> band fyi, below should.
    expect(movedWord("should", 0, 20, 5)).toEqual({ word: "fyi", measured: true });
  });
  test("an interval inside the band keeps the word", () => {
    // 90 of 200 (0.45): interval about 0.39 to 0.51, both inside could (25-59).
    expect(movedWord("could", 90, 200, 5)).toEqual({ word: "could", measured: true });
  });
  test("a point estimate in a higher band does not move the word while the interval still reaches its own band", () => {
    // 15 of 20 is 0.75 (rank 75, should), but the lower end is ~0.56 (could), so Could stays.
    expect(movedWord("could", 15, 20, 5)).toEqual({ word: "could", measured: true });
  });
});

const f = (severity: Finding["severity"], confidence: Finding["confidence"], reply: Finding["reply"], pr: number): Finding => ({
  severity,
  confidence,
  reply,
  pr,
});

describe("aggregateCells", () => {
  test("groups by severity and confidence, counts distinct PRs, keeps undefined apart from medium", () => {
    const rows = aggregateCells([
      f("consider", undefined, "none", 3),
      f("consider", "medium", "fixed", 1),
      f("consider", "medium", "declined", 1),
      f("blocker", "high", "fixed", 2),
    ]);
    expect(rows).toEqual([
      { severity: "blocker", confidence: "high", answered: 1, fixed: 1, declined: 0, unanswered: 0, prs: 1 },
      { severity: "consider", confidence: "medium", answered: 2, fixed: 1, declined: 1, unanswered: 0, prs: 1 },
      { severity: "consider", confidence: undefined, answered: 0, fixed: 0, declined: 0, unanswered: 1, prs: 1 },
    ]);
  });
});

describe("AC8 fixture", () => {
  const many = (severity: Finding["severity"], confidence: Finding["confidence"], fixed: number, declined: number): Finding[] => [
    ...Array.from({ length: fixed }, (_, i) => f(severity, confidence, "fixed", i)),
    ...Array.from({ length: declined }, (_, i) => f(severity, confidence, "declined", i)),
  ];
  const rows = aggregateCells([
    ...many("consider", "high", 53, 3),
    ...many("consider", "medium", 68, 28),
    ...many("consider", "low", 14, 11),
    ...many("fix", "high", 8, 3),
  ]);

  test("counts reproduce the table", () => {
    expect(rows.map((r) => [r.severity, r.confidence, r.answered, r.fixed, r.declined, r.unanswered])).toEqual([
      ["fix", "high", 11, 8, 3, 0],
      ["consider", "high", 56, 53, 3, 0],
      ["consider", "medium", 96, 68, 28, 0],
      ["consider", "low", 25, 14, 11, 0],
    ]);
  });

  test("formatted percentages match", () => {
    const lines = formatCellTable(rows)
      .split("\n")
      .map((l) => l.split(/\s{2,}/));
    expect(lines[0]).toEqual(["Severity · confidence", "Answered", "Fixed", "Declined", "Unanswered"]);
    expect(lines.slice(1)).toEqual([
      ["Fix · high", "11", "73%", "27%", "0"],
      ["Consider · high", "56", "95%", "5%", "0"],
      ["Consider · medium", "96", "71%", "29%", "0"],
      ["Consider · low", "25", "56%", "44%", "0"],
    ]);
  });

  test("a cell with no answers shows a dash", () => {
    expect(formatCellTable(aggregateCells([f("info", "low", "none", 1)]))).toContain("—");
  });
});
