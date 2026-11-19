import { describe, expect, test } from "bun:test";
import { CONFIDENCE, SEVERITY, TOPIC, type Confidence, type Severity, type Topic } from "./engine";
import { armFor, priorityOf, TABLE_V1, type CalibrationTable, type Priority } from "./priority";

const SEVERITIES = Object.keys(SEVERITY) as Severity[];
const TOPICS = Object.keys(TOPIC) as Topic[];
const DEFECT: Topic[] = ["bug", "security", "perf"];
const ORDER: Priority[] = ["fyi", "could", "should", "must"];
const atLeast = (p: Priority, floor: Priority) => ORDER.indexOf(p) >= ORDER.indexOf(floor);

describe("table v1 (spec decision 4, AC1, AC11)", () => {
  test("is versioned data with one seed cell per severity and confidence, no counts", () => {
    expect(TABLE_V1.version).toBe("v1");
    for (const s of SEVERITIES) {
      for (const c of CONFIDENCE) {
        const cell = TABLE_V1.cells[s][c];
        expect(cell.provenance).toEqual({ basis: "seed" });
        expect(Object.keys(cell).sort()).toEqual(["priority", "provenance", "rank"]);
      }
    }
  });

  test("seed priorities and ranks", () => {
    const seed = (s: Severity, c: Confidence) => [TABLE_V1.cells[s][c].priority, TABLE_V1.cells[s][c].rank];
    expect(seed("blocker", "high")).toEqual(["must", 90]);
    expect(seed("blocker", "medium")).toEqual(["must", 90]);
    expect(seed("fix", "high")).toEqual(["should", 70]);
    expect(seed("fix", "medium")).toEqual(["should", 70]);
    expect(seed("consider", "high")).toEqual(["should", 70]);
    expect(seed("consider", "medium")).toEqual(["could", 40]);
    expect(seed("consider", "low")).toEqual(["could", 40]);
    expect(seed("blocker", "low")).toEqual(["could", 40]);
    expect(seed("fix", "low")).toEqual(["could", 40]);
    for (const c of CONFIDENCE) expect(seed("info", c)).toEqual(["fyi", 10]);
  });
});

describe("priorityOf over every severity x confidence x topic (AC1)", () => {
  const expected = (s: Severity, c: Confidence | undefined): Priority => {
    const conf = c ?? "medium";
    if (s === "info") return "fyi";
    if (s === "blocker") return conf === "low" ? "could" : "must";
    if (s === "fix") return conf === "low" ? "could" : "should";
    return conf === "high" ? "should" : "could";
  };

  for (const s of SEVERITIES) {
    for (const c of [...CONFIDENCE, undefined]) {
      for (const topic of TOPICS) {
        test(`${s} / ${c ?? "no confidence"} / ${topic}`, () => {
          const got = priorityOf({ severity: s, topic, ...(c ? { confidence: c } : {}) });
          expect(got.priority).toBe(expected(s, c));
          expect(got.basis).toBe("seed");
          expect(got.tableVersion).toBe("v1");
          expect(got.rank).toBeGreaterThanOrEqual(0);
          expect(got.rank).toBeLessThanOrEqual(100);
        });
      }
    }
  }

  test("a finding with no confidence is priced by its severity's medium cell", () => {
    for (const s of SEVERITIES) {
      expect(priorityOf({ severity: s, topic: "bug" })).toEqual(priorityOf({ severity: s, topic: "bug", confidence: "medium" }));
    }
  });
});

describe("floors and caps (spec decision 10, AC10)", () => {
  // A table that measured every cell as worthless: only the floors and caps can hold the line.
  const worthless: CalibrationTable = {
    version: "test-low",
    cells: Object.fromEntries(
      SEVERITIES.map((s) => [s, Object.fromEntries(CONFIDENCE.map((c) => [c, { priority: "fyi", rank: 0, provenance: { basis: "seed" } }]))]),
    ) as CalibrationTable["cells"],
  };
  // A table that measured every cell as highly actionable: only the caps can hold the line.
  const glowing: CalibrationTable = {
    version: "test-high",
    cells: Object.fromEntries(
      SEVERITIES.map((s) => [s, Object.fromEntries(CONFIDENCE.map((c) => [c, { priority: "must", rank: 100, provenance: { basis: "seed" } }]))]),
    ) as CalibrationTable["cells"],
  };

  for (const table of [TABLE_V1, worthless, glowing]) {
    test(`floors hold on table ${table.version}`, () => {
      for (const topic of TOPICS) {
        for (const c of [...CONFIDENCE, undefined]) {
          const low = c === "low";
          if (!low) expect(priorityOf({ severity: "blocker", topic, ...(c ? { confidence: c } : {}) }, table).priority).toBe("must");
          if (!low && DEFECT.includes(topic)) {
            expect(atLeast(priorityOf({ severity: "fix", topic, ...(c ? { confidence: c } : {}) }, table).priority, "should")).toBe(true);
          }
        }
      }
    });

    test(`caps hold on table ${table.version}`, () => {
      for (const topic of TOPICS) {
        for (const s of ["blocker", "fix"] as const) {
          expect(atLeast(priorityOf({ severity: s, topic, confidence: "low" }, table).priority, "should")).toBe(false);
        }
        for (const c of [...CONFIDENCE, undefined]) {
          expect(priorityOf({ severity: "info", topic, ...(c ? { confidence: c } : {}) }, table).priority).toBe("fyi");
        }
      }
    });
  }

  test("a rate raises above the floor: a fix cell calibrated to must stays must on a medium defect", () => {
    expect(priorityOf({ severity: "fix", topic: "bug", confidence: "high" }, glowing).priority).toBe("must");
  });

  test("a low table cannot lower a blocker or a defect fix; it can lower a non-defect fix", () => {
    expect(priorityOf({ severity: "blocker", topic: "docs", confidence: "high" }, worthless)).toMatchObject({ priority: "must", rank: 90 });
    expect(priorityOf({ severity: "fix", topic: "perf", confidence: "medium" }, worthless)).toMatchObject({ priority: "should", rank: 70 });
    expect(priorityOf({ severity: "fix", topic: "docs", confidence: "medium" }, worthless).priority).toBe("fyi");
  });

  test("a cap lowers the rank with the priority", () => {
    expect(priorityOf({ severity: "blocker", topic: "bug", confidence: "low" }, glowing)).toMatchObject({ priority: "could", rank: 40 });
  });
});

describe("armFor (spec decision 20, AC13)", () => {
  test("the same repository and pull request always get the same arm", () => {
    for (let pr = 1; pr <= 50; pr++) {
      const first = armFor("niway-dev/wachiman", pr);
      for (let again = 0; again < 3; again++) expect(armFor("niway-dev/wachiman", pr)).toBe(first);
    }
  });

  test("both arms occur, in roughly even shares, across pull request numbers and repositories", () => {
    const arms = Array.from({ length: 400 }, (_, i) => armFor(i % 2 === 0 ? "o/r" : "o/other", i + 1));
    const words = arms.filter((a) => a === "word").length;
    expect(arms.every((a) => a === "word" || a === "priority")).toBe(true);
    expect(words).toBeGreaterThan(140);
    expect(words).toBeLessThan(260);
  });

  test("the repository is part of the key", () => {
    const differs = Array.from({ length: 40 }, (_, i) => armFor("o/a", i + 1) !== armFor("o/b", i + 1));
    expect(differs.some(Boolean)).toBe(true);
  });
});
