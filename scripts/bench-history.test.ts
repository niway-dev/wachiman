import { describe, expect, test } from "bun:test";
import { appendEntry, parseHistory, renderTable, toEntry } from "./bench-history";

const bench = (commit: string, a: number, b: number) => ({
  commit,
  date: "2026-11-21",
  bun: "1.3.4",
  cpu: "x",
  platform: "linux-x64",
  results: [
    { case: "a", median_ms: a, min_ms: 1, p90_ms: 2, runs: 5 },
    { case: "b", median_ms: b, min_ms: 1, p90_ms: 2, runs: 5 },
  ],
});

describe("bench-history", () => {
  test("an entry keeps the commit, the date and only the medians", () => {
    expect(toEntry(bench("abc", 10, 20), "2026-11-22T01:02:03Z")).toEqual({
      commit: "abc",
      date: "2026-11-22T01:02:03Z",
      bun: "1.3.4",
      platform: "linux-x64",
      medians: { a: 10, b: 20 },
    });
  });

  test("append adds one line per commit and ignores a commit already stored", () => {
    let text = "";
    text = appendEntry(text, toEntry(bench("c1", 10, 20), "d1"));
    text = appendEntry(text, toEntry(bench("c2", 11, 20), "d2"));
    text = appendEntry(text, toEntry(bench("c2", 99, 99), "d3"));
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
    expect(parseHistory(text).map((e) => e.commit)).toEqual(["c1", "c2"]);
  });

  test("a malformed line is an error that names the line", () => {
    expect(() => parseHistory('{"commit":"x","medians":{}}\nnot json\n')).toThrow(/line 2/);
  });

  test("the table shows one row per commit, a column per case and the drift from the first row", () => {
    const entries = [toEntry(bench("c1", 100, 50), "2026-11-20"), toEntry(bench("c2", 110, 45), "2026-11-21")];
    const out = renderTable(entries);
    expect(out).toContain("| 2026-11-20 | c1 | 100.0 | 50.0 |");
    expect(out).toContain("| 2026-11-21 | c2 | 110.0 | 45.0 |");
    expect(out).toContain("| change since first |  | +10.0% | -10.0% |");
  });
});
