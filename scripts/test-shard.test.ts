import { describe, expect, test } from "bun:test";
import { assign, checkSplit, discover, fallbackWeight, loadTimings, weight } from "./test-shard";

describe("test sharding", () => {
  const files = discover();
  const timings = loadTimings();

  test("discovers the test files, including this one", () => {
    expect(files).toContain("scripts/test-shard.test.ts");
    expect(files.every((f) => !f.includes("node_modules"))).toBe(true);
  });

  test("every file is in exactly one shard", () => {
    for (const total of [1, 2, 4, 7]) {
      const shards = assign(files, timings, total);
      expect(checkSplit(files, shards)).toEqual([]);
      expect(shards.flat().length).toBe(files.length);
    }
  });

  test("the split is deterministic and does not depend on input order", () => {
    const first = assign(files, timings, 4);
    expect(assign(files, timings, 4)).toEqual(first);
    expect(assign([...files].reverse(), timings, 4)).toEqual(first);
  });

  test("a file missing from the timings is still assigned", () => {
    const withNew = [...files, "src/brand-new-thing.test.ts"];
    const shards = assign(withNew, timings, 4);
    expect(shards.flat().filter((f) => f === "src/brand-new-thing.test.ts")).toHaveLength(1);
    expect(checkSplit(withNew, shards)).toEqual([]);
  });

  test("a file with no recorded time weighs something, so it is not piled onto one shard for free", () => {
    expect(fallbackWeight(files, timings)).toBeGreaterThan(0);
    expect(weight("x.test.ts", { "x.test.ts": 0 }, 1)).toBeGreaterThan(0);
  });

  test("the load is balanced within the greedy bound", () => {
    const fallback = fallbackWeight(files, timings);
    const seconds = (f: string) => weight(f, timings, fallback);
    const loads = assign(files, timings, 4).map((s) => s.reduce((sum, f) => sum + seconds(f), 0));
    const total = loads.reduce((a, b) => a + b, 0);
    // Longest-first greedy packing never exceeds the average by more than 3/4 of the largest item.
    expect(Math.max(...loads)).toBeLessThanOrEqual(total / 4 + (3 / 4) * Math.max(...files.map(seconds)) + 1e-9);
  });

  test("checkSplit reports a missing, duplicated and unknown file and an empty shard", () => {
    const problems = checkSplit(["a.test.ts", "b.test.ts"], [["a.test.ts", "a.test.ts"], ["c.test.ts"], []]);
    expect(problems).toEqual(["not in any shard: b.test.ts", "in 2 shards: a.test.ts", "not a test file: c.test.ts", "shard 3 is empty"]);
  });
});
