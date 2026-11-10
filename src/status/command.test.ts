import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { HISTORY_RUN_FORMAT, type HistoryRun } from "../history/types";
import { repositoryKey, writeRun } from "../history/store";
import { filterRuns, flatten, group, parseStatusArgs, runStatus, type StatusArgs } from "./command";

const temps: string[] = [];
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-11-10T12:00:00Z");
const args = (over: Partial<StatusArgs> = {}): StatusArgs => ({ json: false, allRepos: false, by: "day", ...over });

/** Illustrative run: only the fields `status` reads are filled in. */
function run(repository: ReturnType<typeof repositoryKey>, savedAt: string, cost: number, model: string, profile: string): HistoryRun {
  return {
    format: HISTORY_RUN_FORMAT,
    savedAt,
    engine: { version: "1.10.0" },
    repository,
    result: {
      format: "wachiman.review-result/1",
      change: { head: { sha: "a".repeat(40), ref: "feat/x" }, title: "feat/x" },
      provider: { label: "L", model, effort: "high", profile },
      execution: { costUsdEstimate: cost, usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
      coverage: { expected: [], reviewed: [], skipped: [] },
      findings: [],
    },
    tracking: [],
    settled: [],
    unknown: 0,
    unknownIds: [],
  } as unknown as HistoryRun;
}

function seeded() {
  const home = mkdtempSync(join(tmpdir(), "wachiman-status-home-"));
  temps.push(home);
  const repo = emptyRepo();
  git(repo, "remote", "add", "origin", "https://github.com/o/alpha.git");
  const key = repositoryKey(repo);
  const root = join(home, "history");
  writeRun(root, run(key, "2026-11-10T08:00:00.000Z", 0.5, "claude-sonnet-5-5", "isolated"));
  writeRun(root, run(key, "2026-11-10T09:00:00.000Z", 0.25, "claude-haiku-5-5", "isolated"));
  writeRun(root, run(key, "2026-11-01T09:00:00.000Z", 1, "claude-sonnet-5-5", "work"));
  return { home, repo, env: { WACHIMAN_HOME: home } as Record<string, string | undefined> };
}

const capture = () => {
  const out: string[] = [];
  return { out, io: { stdout: (t: string) => out.push(t), stderr: () => {}, now: () => NOW, version: "1.10.0" } };
};

describe("parseStatusArgs", () => {
  test("filters and grouping, in both spellings", () => {
    expect(parseStatusArgs(["--since=7d", "--model", "sonnet", "--by", "model", "--json"])).toEqual(args({ sinceDays: 7, model: "sonnet", by: "model", json: true }));
  });
  test("rejects a bad value, an unknown option and a conflicting pair", () => {
    expect(() => parseStatusArgs(["--since", "week"])).toThrow(UsageError);
    expect(() => parseStatusArgs(["--by", "pr"])).toThrow(UsageError);
    expect(() => parseStatusArgs(["--nope"])).toThrow(UsageError);
    expect(() => parseStatusArgs(["--repo", "a", "--all-repos"])).toThrow(UsageError);
  });
  test("help", () => expect(parseStatusArgs(["--help"])).toEqual({ help: true }));
});

describe("filter and group", () => {
  const key = { key: "k", name: "alpha", keyedBy: "remote", path: "/p" } as const;
  const runs = [
    flatten(run(key, "2026-11-10T08:00:00.000Z", 0.5, "claude-sonnet-5-5", "isolated")),
    flatten(run(key, "2026-11-10T09:00:00.000Z", 0.25, "claude-haiku-5-5", "isolated")),
    flatten(run(key, "2026-11-01T09:00:00.000Z", 1, "claude-sonnet-5-5", "work")),
  ];
  test("--since keeps the last days only", () => expect(filterRuns(runs, args({ sinceDays: 2 }), NOW)).toHaveLength(2));
  test("--model matches a substring, --profile an exact name", () => {
    expect(filterRuns(runs, args({ model: "haiku" }), NOW)).toHaveLength(1);
    expect(filterRuns(runs, args({ profile: "work" }), NOW)).toHaveLength(1);
  });
  test("by day sums cost per day, newest first", () => {
    expect(group(runs, "day")).toEqual([
      { key: "2026-11-10", runs: 2, costUsdEstimate: 0.75 },
      { key: "2026-11-01", runs: 1, costUsdEstimate: 1 },
    ]);
  });
  test("by model orders by cost and names the effort", () => {
    expect(group(runs, "model").map((g) => g.key)).toEqual(["claude-sonnet-5-5 (high)", "claude-haiku-5-5 (high)"]);
  });
});

describe("runStatus", () => {
  test("text says what it covers and totals the cost", () => {
    const { repo, env } = seeded();
    const { out, io } = capture();
    expect(runStatus(args(), repo, env, io)).toBe(0);
    const text = out.join("");
    expect(text).toContain("Local runs only");
    expect(text).toContain("3 runs, $1.75 estimated");
    expect(text).toContain("2026-11-10");
  });
  test("--json lists every run with its attributes", () => {
    const { repo, env } = seeded();
    const { out, io } = capture();
    runStatus(args({ json: true, profile: "isolated" }), repo, env, io);
    const doc = JSON.parse(out.join(""));
    expect(doc.format).toBe("wachiman.status/1");
    expect(doc.totals).toEqual({ runs: 2, costUsdEstimate: 0.75 });
    expect(doc.runs[0]).toMatchObject({ repository: "alpha", model: "claude-sonnet-5-5", effort: "high", profile: "isolated", change: "feat/x", findings: 0 });
  });
  test("no history yet points to --history and doctor; no match says so", () => {
    const home = mkdtempSync(join(tmpdir(), "wachiman-status-empty-"));
    temps.push(home);
    const { out, io } = capture();
    expect(runStatus(args(), emptyRepo(), { WACHIMAN_HOME: home }, io)).toBe(0);
    expect(out.join("")).toContain("wachiman local --history");
    const seed = seeded();
    const second = capture();
    runStatus(args({ model: "opus" }), seed.repo, seed.env, second.io);
    expect(second.out.join("")).toContain("No run matches the filters (3 kept before filtering)");
  });
});
