import { describe, expect, test } from "bun:test";
import { assign, checkSplit, discover, loadTimings } from "./test-shard";

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

  test("the load is balanced: no shard is far above the average", () => {
    const seconds = (f: string) => timings[f] ?? 1;
    const loads = assign(files, timings, 4).map((s) => s.reduce((sum, f) => sum + seconds(f), 0));
    const total = loads.reduce((a, b) => a + b, 0);
    // The slowest file alone sets the floor; allow it on top of an even share.
    expect(Math.max(...loads)).toBeLessThanOrEqual(total / 4 + Math.max(...files.map(seconds)));
  });

  test("checkSplit reports a missing, duplicated and unknown file and an empty shard", () => {
    const problems = checkSplit(["a.test.ts", "b.test.ts"], [["a.test.ts", "a.test.ts"], ["c.test.ts"], []]);
    expect(problems).toEqual([
      "not in any shard: b.test.ts",
      "in 2 shards: a.test.ts",
      "not a test file: c.test.ts",
      "shard 3 is empty",
    ]);
  });
});
