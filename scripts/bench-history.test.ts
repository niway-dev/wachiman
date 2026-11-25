import { describe, expect, test } from "bun:test";
import { appendEntry, parseAppendArgs, parseHistory, parseTableArgs, renderTable, toEntry } from "./bench-history";

const run = (commit: string, a: number, b: number) => ({
  commit,
  bun: "1.3.4",
  cpu: "Xeon",
  platform: "linux-x64",
  results: [
    { case: "a", median_ms: a, min_ms: 1, p90_ms: 2, runs: 5 },
    { case: "b", median_ms: b, min_ms: 1, p90_ms: 2, runs: 5 },
  ],
});
const entry = (commit: string, parentA: number, commitA: number, date = "2026-11-21") =>
  toEntry([run("p", parentA, 20), run("p", parentA, 20)], [run(commit, commitA, 20), run(commit, commitA, 20)], date, {
    os: "Linux",
    arch: "X64",
  });

describe("bench-history", () => {
  test("an entry holds the parent median, the commit median, the change and the runner per case", () => {
    expect(entry("abc-dirty", 100, 110, "2026-11-22T01:02:03Z")).toEqual({
      commit: "abc",
      parent: "p",
      date: "2026-11-22T01:02:03Z",
      bun: "1.3.4",
      platform: "linux-x64",
      runner: { os: "Linux", arch: "X64", cpu: "Xeon" },
      cases: {
        a: { parent_ms: 100, commit_ms: 110, change_pct: expect.closeTo(10, 6) },
        b: { parent_ms: 20, commit_ms: 20, change_pct: 0 },
      },
    });
  });

  test("the runner falls back to the platform of the bench when the environment gives none", () => {
    const e = toEntry([run("p", 1, 1)], [run("c", 1, 1)], "d");
    expect(e.runner).toEqual({ os: "linux", arch: "x64", cpu: "Xeon" });
  });

  test("append adds one line per commit and ignores a commit already stored", () => {
    let text = "";
    text = appendEntry(text, entry("c1", 10, 11));
    text = appendEntry(text, entry("c2", 10, 12));
    text = appendEntry(text, entry("c2", 99, 99));
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
    expect(parseHistory(text).map((e) => e.commit)).toEqual(["c1", "c2"]);
  });

  test("a malformed line is an error that names the line", () => {
    expect(() => parseHistory('{"commit":"x","medians":{}}\nnot json\n')).toThrow(/line 2/);
  });

  test("the table shows the change per commit and keeps reading legacy rows as n/a", () => {
    const legacy = { commit: "old", date: "2026-11-19", bun: "1.3.4", platform: "linux-x64", medians: { a: 100, b: 50 } };
    const out = renderTable([legacy, entry("c1", 100, 110, "2026-11-20"), entry("c2", 100, 90, "2026-11-21")]);
    expect(out).toContain("| 2026-11-19 | old | linux-x64 | n/a | n/a |");
    expect(out).toContain("| 2026-11-20 | c1 | Linux-X64 | +10.0% | +0.0% |");
    expect(out).toContain("| 2026-11-21 | c2 | Linux-X64 | -10.0% | +0.0% |");
  });

  test("append arguments: the file, then the rounds of each side", () => {
    expect(parseAppendArgs(["h.jsonl", "--parent", "p1", "p2", "--commit", "c1", "c2"])).toEqual({
      file: "h.jsonl",
      parent: ["p1", "p2"],
      commit: ["c1", "c2"],
    });
    expect(() => parseAppendArgs(["h.jsonl", "--parent", "p1"])).toThrow(/usage/);
    expect(() => parseAppendArgs(["--parent", "p1", "--commit", "c1"])).toThrow(/usage/);
    expect(() => parseAppendArgs(["h.jsonl", "--prnt", "p1"])).toThrow(/Unknown/);
  });

  test("table arguments: --last in both forms, unknown flags are errors", () => {
    expect(parseTableArgs(["h.jsonl", "--last", "5"])).toEqual({ file: "h.jsonl", last: 5 });
    expect(parseTableArgs(["--last=7", "h.jsonl"])).toEqual({ file: "h.jsonl", last: 7 });
    expect(parseTableArgs(["h.jsonl"]).last).toBe(Infinity);
    expect(() => parseTableArgs(["h.jsonl", "--lst=5"])).toThrow(/Unknown/);
    expect(() => parseTableArgs(["h.jsonl", "--last=0"])).toThrow(/--last/);
    expect(() => parseTableArgs([])).toThrow(/usage/);
  });
});
