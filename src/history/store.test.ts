import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { REVIEW_RESULT_FORMAT } from "../formats";
import { emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import {
  appendVerdict,
  forget,
  historyRoot,
  historySettings,
  prune,
  readRuns,
  readVerdicts,
  repositoryKey,
  writeRun,
} from "./store";
import { HISTORY_RUN_FORMAT, type HistoryRun } from "./types";

const temps: string[] = [];
const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-hist-home-"));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const mode = (path: string) => statSync(path).mode & 0o777;
const DAY = 86_400_000;

function run(savedAt: string, firstIds: string[] = ["aaaaaaaaaa"], key = "r-12345678"): HistoryRun {
  return {
    format: HISTORY_RUN_FORMAT,
    savedAt,
    engine: { version: "0.0.0" },
    repository: { key, name: "r", keyedBy: "remote", remote: "https://github.com/o/r", path: "/x" },
    result: { format: REVIEW_RESULT_FORMAT, change: { head: { sha: "1a2b3c4d5e6f".padEnd(40, "0") } }, findings: [] } as any,
    tracking: firstIds.map((id) => ({ id, status: "new", firstId: id, firstHead: "h", runs: 1, reopened: 0, titleKey: "t" })),
    settled: [],
    unknown: 0,
    unknownIds: [],
  };
}

describe("historySettings", () => {
  test("off by default, on with --history or AGENT_REVIEW_HISTORY=1", () => {
    expect(historySettings({}, false).enabled).toBe(false);
    expect(historySettings({}, true).enabled).toBe(true);
    expect(historySettings({ AGENT_REVIEW_HISTORY: "1" }, false).enabled).toBe(true);
    expect(historySettings({ AGENT_REVIEW_HISTORY: "0" }, false).enabled).toBe(false);
  });

  test("days defaults to 30, accepts 0, refuses a non-integer or a negative", () => {
    expect(historySettings({}, true).days).toBe(30);
    expect(historySettings({ AGENT_REVIEW_HISTORY_DAYS: "0" }, true).days).toBe(0);
    expect(historySettings({ AGENT_REVIEW_HISTORY_DAYS: "7" }, true).days).toBe(7);
    for (const bad of ["x", "-1", "1.5"]) {
      expect(() => historySettings({ AGENT_REVIEW_HISTORY_DAYS: bad }, true)).toThrow(UsageError);
      expect(() => historySettings({ AGENT_REVIEW_HISTORY_DAYS: bad }, true)).toThrow("AGENT_REVIEW_HISTORY_DAYS");
    }
  });
});

describe("repositoryKey", () => {
  test("basename plus 8 hex of the normalised origin URL, credentials stripped", () => {
    const a = emptyRepo();
    git(a, "remote", "add", "origin", "https://me:ghp_x@GitHub.com/o/r.git/");
    const b = emptyRepo();
    git(b, "remote", "add", "origin", "https://github.com/o/r");
    const ka = repositoryKey(a);
    expect(ka.key).toBe(repositoryKey(b).key);
    expect(ka.key).toMatch(/^r-[0-9a-f]{8}$/);
    expect(ka.keyedBy).toBe("remote");
    expect(ka.remote).toBe("https://github.com/o/r");
    expect(JSON.stringify(ka)).not.toContain("ghp_x");
  });

  test("ssh and alias remotes are normalised to host and path", () => {
    const a = emptyRepo();
    git(a, "remote", "add", "origin", "git@github-csdev:o/r.git");
    const b = emptyRepo();
    git(b, "remote", "add", "origin", "ssh://git@github-csdev/o/r.git");
    expect(repositoryKey(a).key).toBe(repositoryKey(b).key);
    expect(repositoryKey(a).remote).toBe("ssh://github-csdev/o/r");
  });

  test("without origin, the common git directory's real path keys it", () => {
    const dir = emptyRepo();
    git(dir, "commit", "-q", "--allow-empty", "-m", "x");
    const wt = join(home(), "wt");
    git(dir, "worktree", "add", "-q", "-b", "other", wt);
    const k = repositoryKey(dir);
    expect(k.keyedBy).toBe("path");
    expect(k.remote).toBeUndefined();
    expect(repositoryKey(wt).key).toBe(k.key);
  });
});

describe("writeRun / readRuns", () => {
  test("creates the directories 0700 and the file 0600, atomically", () => {
    const h = home();
    const root = historyRoot(h);
    const path = writeRun(root, run("2026-11-05T10:00:00.000Z"));
    expect(path).toMatch(/runs\/2026-11-05T10-00-00-000Z-1a2b3c4\.json$/);
    for (const d of [join(h, ".wachiman"), root, join(root, "r-12345678"), join(root, "r-12345678", "runs")]) expect(mode(d)).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(readdirSync(join(root, "r-12345678", "runs")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const runs = readRuns(root, "r-12345678", () => {});
    expect(runs).toHaveLength(1);
    expect(runs[0].format).toBe("wachiman.history-run/1");
  });

  test("runs come back in savedAt order", () => {
    const root = historyRoot(home());
    writeRun(root, run("2026-11-05T12:00:00.000Z", ["cccccccccc"]));
    writeRun(root, run("2026-11-05T10:00:00.000Z", ["aaaaaaaaaa"]));
    writeRun(root, run("2026-11-05T11:00:00.000Z", ["bbbbbbbbbb"]));
    expect(readRuns(root, "r-12345678", () => {}).map((r) => r.tracking[0].firstId)).toEqual(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"]);
  });

  test("two runs in the same millisecond at one head keep two files", () => {
    const root = historyRoot(home());
    writeRun(root, run("2026-11-05T10:00:00.000Z"));
    writeRun(root, run("2026-11-05T10:00:00.000Z"));
    expect(readRuns(root, "r-12345678", () => {})).toHaveLength(2);
  });

  test("an unreadable file is moved aside with a warning and the rest is read", () => {
    const root = historyRoot(home());
    writeRun(root, run("2026-11-05T10:00:00.000Z"));
    const dir = join(root, "r-12345678", "runs");
    writeFileSync(join(dir, "a.json"), "not json");
    writeFileSync(join(dir, "b.json"), JSON.stringify({ ...run("2026-11-05T09:00:00.000Z"), format: "wachiman.history-run/2" }));
    const warnings: string[] = [];
    const runs = readRuns(root, "r-12345678", (l) => warnings.push(l));
    expect(runs).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    const names = readdirSync(dir);
    expect(names.filter((n) => /^[ab]\.json\.unreadable-\d+$/.test(n))).toHaveLength(2);
    expect(names.filter((n) => n === "a.json" || n === "b.json")).toEqual([]);
    expect(readRuns(root, "r-12345678", (l) => warnings.push(l))).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });
});

describe("prune", () => {
  test("deletes runs older than the limit and the verdicts that no longer resolve", () => {
    const root = historyRoot(home());
    const now = new Date("2026-11-05T12:00:00.000Z");
    writeRun(root, run(new Date(now.getTime() - 31 * DAY).toISOString(), ["oldoldoldo"]));
    writeRun(root, run(new Date(now.getTime() - 1 * DAY).toISOString(), ["newnewnewn"]));
    appendVerdict(root, "r-12345678", { at: "t", firstId: "oldoldoldo", verdict: "wrong" });
    appendVerdict(root, "r-12345678", { at: "t", firstId: "newnewnewn", verdict: "correct" });
    const removed = prune(root, "r-12345678", 30, () => now);
    expect(removed.runs).toHaveLength(1);
    expect(removed.verdicts).toBe(1);
    expect(readRuns(root, "r-12345678", () => {})).toHaveLength(1);
    expect([...readVerdicts(root, "r-12345678").keys()]).toEqual(["newnewnewn"]);
    expect(mode(join(root, "r-12345678", "verdicts.jsonl"))).toBe(0o600);
  });

  test("0 keeps everything", () => {
    const root = historyRoot(home());
    writeRun(root, run("2000-01-01T00:00:00.000Z"));
    expect(prune(root, "r-12345678", 0, () => new Date())).toEqual({ runs: [], verdicts: 0 });
    expect(readRuns(root, "r-12345678", () => {})).toHaveLength(1);
  });
});

describe("verdicts", () => {
  test("appends one JSON line, 0600, and the last line for an id wins", () => {
    const root = historyRoot(home());
    appendVerdict(root, "r-12345678", { at: "1", firstId: "aaaaaaaaaa", verdict: "wrong", reason: "x" });
    appendVerdict(root, "r-12345678", { at: "2", firstId: "aaaaaaaaaa", verdict: "correct" });
    const path = join(root, "r-12345678", "verdicts.jsonl");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
    expect(mode(path)).toBe(0o600);
    expect(readVerdicts(root, "r-12345678").get("aaaaaaaaaa")?.verdict).toBe("correct");
  });
});

describe("forget", () => {
  test("removes one key's directory, or the whole history, and never a claude-* profile", () => {
    const h = home();
    const profile = join(h, ".wachiman", "claude-isolated");
    mkdirSync(profile, { recursive: true });
    const root = historyRoot(h);
    writeRun(root, run("2026-11-05T10:00:00.000Z", ["aaaaaaaaaa"], "one-11111111"));
    writeRun(root, run("2026-11-05T10:00:00.000Z", ["bbbbbbbbbb"], "two-22222222"));
    expect(forget(root, "one-11111111")).toEqual([join(root, "one-11111111")]);
    expect(existsSync(join(root, "one-11111111"))).toBe(false);
    expect(existsSync(join(root, "two-22222222"))).toBe(true);
    expect(existsSync(profile)).toBe(true);
    expect(forget(root)).toEqual([root]);
    expect(existsSync(root)).toBe(false);
    expect(existsSync(profile)).toBe(true);
    expect(forget(root)).toEqual([]);
    expect(() => forget(root, "../claude-isolated")).toThrow();
  });
});
