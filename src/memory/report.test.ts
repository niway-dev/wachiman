/**
 * `wachiman memory report` (AC13): comments by outcome, findings muted by memory, memory size and
 * entries never used, per month and in total. The scenario below is invented for the test.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { appendVerdict, repositoryKey, writeRun } from "../history/store";
import { HISTORY_RUN_FORMAT, type HistoryRun, type VerdictLine } from "../history/types";
import { runMemory } from "./command";
import { entryId } from "./entries";
import { recordMemoryUse } from "./hygiene";
import { buildReport, parseReportArgs, renderReport } from "./report";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const entryText = (kind: string, scope: string, rule: string) => {
  const why = `${rule} because.`;
  const id = entryId({ kind, scope, rule, why });
  return { id, text: `### ${id} ${rule}\n\n- kind: ${kind}\n- scope: ${scope}\n- rule: ${rule}\n- why: ${why}\n- evidence:\n  - 2026-11-01 operator instruction, pull request 1\n- added: 2026-11-01\n` };
};
const MUTER = entryText("exception", "docs/**", "Do not report stale dates on wording edits");
const IDLE = entryText("exception", "src/legacy/**", "Do not report the legacy naming");
const USED_CONVENTION = entryText("convention", "src/**", "Prefer named exports");
const IDLE_CONVENTION = entryText("convention", "apps/**", "Keep screens small");
const FILES = {
  "index.md": `# Memory\n\n| Glob | File |\n| --- | --- |\n| \`src/**\` | \`src.md\` |\n| \`apps/**\` | \`apps.md\` |\n\n${MUTER.text}\n${IDLE.text}`,
  "src.md": USED_CONVENTION.text,
  "apps.md": IDLE_CONVENTION.text,
};
/** Layer 6's record of use: two entries were used, the other two never. */
const USED: Record<string, string> = { [MUTER.id]: "2026-11-03", [USED_CONVENTION.id]: "2026-10-20" };
const lines = (text: string) => text.replace(/\n$/, "").split("\n").length;
const FILE_LINES = Object.values(FILES).reduce((n, t) => n + lines(t), 0);

const repository = { key: "demo-12345678", name: "demo", keyedBy: "remote", path: "/x" } as const;
const tr = (id: string, status: "new" | "open") => ({ id, status, firstId: id, firstHead: "h1", runs: 1, reopened: 0, titleKey: id });
const finding = (path: string, title: string) => ({ path, line: 1, title, severity: "fix", topic: "bug", body: "b", anchor: "diff" });
const record = (loadedLines: number, files: string[]) => ({
  revision: "r".repeat(40),
  files: files.map((f) => ({ path: `.wachiman/memory/${f}`, lines: 1 })),
  leftOut: [],
  overBudget: false,
  indexOverBudget: false,
  budget: { maxIndexLines: 150, maxLoadedLines: 400, loadedLines },
});
const muted = (entry: string, title: string) => ({ path: "docs/a.md", line: 1, severity: "consider", topic: "cleanup", title, entry, reason: "r" });

/** October: three comments (F1 stays open, F2 is fixed later, F3 is judged wrong). November: F1 again, plus one new comment and three muted. */
function runs(): HistoryRun[] {
  const base = { format: HISTORY_RUN_FORMAT, engine: { version: "0" }, repository, unknown: 0, unknownIds: [] };
  const result = (head: string, findings: unknown[], extra: object) => ({ format: "wachiman.review-result/2", change: { head: { sha: head } }, coverage: { reviewed: [], expected: [], skipped: [] }, findings, ...extra });
  return [
    { ...base, savedAt: "2026-10-20T10:00:00.000Z", result: result("h1", [finding("src/a.ts", "F1"), finding("src/b.ts", "F2"), finding("src/c.ts", "F3")], { memory: record(30, ["index.md", "src.md"]) }), tracking: [tr("f1", "new"), tr("f2", "new"), tr("f3", "new")], settled: [] },
    {
      ...base,
      savedAt: "2026-11-03T10:00:00.000Z",
      result: result("h2", [finding("src/a.ts", "F1"), finding("src/d.ts", "F4")], { memory: record(40, ["index.md", "src.md"]), muted: [muted(MUTER.id, "M1"), muted(MUTER.id, "M2"), muted("0000000", "M3")] }),
      tracking: [{ ...tr("f1x", "open"), firstId: "f1", runs: 2 }, tr("f4", "new")],
      settled: [{ firstId: "f2", status: "probably-fixed", path: "src/b.ts", line: 1, title: "F2", lastHead: "h1" }],
    },
  ] as unknown as HistoryRun[];
}
const verdict = (firstId: string, word: VerdictLine["verdict"]): [string, VerdictLine] => [firstId, { at: "t", firstId, verdict: word }];
const VERDICTS = new Map([verdict("f3", "wrong"), verdict("f4", "not-important")]);

describe("buildReport", () => {
  test("counts each comment once, in the month of its first run, by its outcome today", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED });
    const [october, november] = report.periods;
    expect(october).toMatchObject({ period: "2026-10", comments: 3, outcomes: { fixed: 1, wrong: 1, intentional: 0, notImportant: 0, unjudged: 1 } });
    expect(november).toMatchObject({ period: "2026-11", comments: 1, outcomes: { fixed: 0, wrong: 0, intentional: 0, notImportant: 1, unjudged: 0 } });
    expect(report.total).toMatchObject({ period: "total", comments: 4, outcomes: { fixed: 1, wrong: 1, intentional: 0, notImportant: 1, unjudged: 1 } });
  });

  test("a verdict beats the loop's own settling, and correct or partial without a fix stays unjudged", () => {
    const report = buildReport({ runs: runs(), verdicts: new Map([verdict("f2", "intentional"), verdict("f1", "correct")]), files: FILES, used: USED });
    expect(report.periods[0].outcomes).toEqual({ fixed: 0, wrong: 0, intentional: 1, notImportant: 0, unjudged: 2 });
  });

  test("findings muted by memory: the count, and each entry id with its count", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED });
    expect(report.periods[0].muted).toEqual({ count: 0, byEntry: {} });
    expect(report.periods[1].muted).toEqual({ count: 3, byEntry: { [MUTER.id]: 2, "0000000": 1 } });
    expect(report.total.muted).toEqual({ count: 3, byEntry: { [MUTER.id]: 2, "0000000": 1 } });
  });

  test("memory size is the working tree's, and each period says how many lines its last run loaded", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED });
    expect(report.memory).toEqual({ present: true, files: 3, entries: 4, lines: FILE_LINES });
    expect(report.periods.map((p) => p.memoryLoadedLines)).toEqual([30, 40]);
  });

  test("entries never used: the entries layer 6's record of use has no date for", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED });
    expect(report.neverUsed.map((e) => e.id).sort()).toEqual([IDLE.id, IDLE_CONVENTION.id].sort());
    expect(report.neverUsed.find((e) => e.id === IDLE.id)).toMatchObject({ kind: "exception", file: "index.md" });
  });

  test("archive.md is never loaded: its entries are not live memory and are not listed as never used", () => {
    const archived = entryText("convention", "lib/**", "Keep helpers pure");
    const files = { ...FILES, "archive.md": archived.text };
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files, used: USED });
    expect(report.memory).toEqual({ present: true, files: 3, entries: 4, lines: FILE_LINES });
    expect(report.neverUsed.map((e) => e.id)).not.toContain(archived.id);
  });

  test("--since keeps the runs and comments from that date on, the way the whole history does", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED, since: "2026-11-01" });
    expect(report.periods.map((p) => p.period)).toEqual(["2026-11"]);
    expect(report.total.comments).toBe(1);
    expect(report.since).toBe("2026-11-01");
  });

  test("--since counts an entry as used only when its last use is on or after that day", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED, since: "2026-11-01" });
    expect(report.neverUsed.map((e) => e.id).sort()).toEqual([IDLE.id, IDLE_CONVENTION.id, USED_CONVENTION.id].sort());
  });

  test("no record of use at all: never-used is unknown, not every entry", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: {} });
    expect(report.neverUsed).toBeNull();
    expect(report.neverUsedReason).toBe("no-use-recorded");
    const text = renderReport(report);
    expect(text).toContain("Entries never used: unknown, no use was recorded");
    expect(text).not.toContain(IDLE.id);
    const withUse = buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED });
    expect(withUse.neverUsedReason).toBeNull();
  });

  test("memory lines is the period's last run's value, null when that run recorded none", () => {
    const all = runs();
    delete (all[1].result as unknown as { memory?: unknown }).memory;
    const report = buildReport({ runs: all, verdicts: VERDICTS, files: FILES, used: USED });
    expect(report.periods.map((p) => p.memoryLoadedLines)).toEqual([30, null]);
    expect(report.total.memoryLoadedLines).toBeNull();
  });

  test("a repository with no memory folder reports zero size and nothing never used", () => {
    const report = buildReport({ runs: runs(), verdicts: VERDICTS, files: undefined, used: USED });
    expect(report.memory).toEqual({ present: false, files: 0, entries: 0, lines: 0 });
    expect(report.neverUsed).toEqual([]);
  });

  test("no runs: empty, and the text says so", () => {
    const report = buildReport({ runs: [], verdicts: new Map(), files: FILES, used: USED });
    expect(report.empty).toBe(true);
    expect(report.periods).toEqual([]);
    expect(renderReport(report)).toContain("No review history");
  });

  test("the table has one row per period and a total, and lists the entries", () => {
    const text = renderReport(buildReport({ runs: runs(), verdicts: VERDICTS, files: FILES, used: USED }));
    expect(text).toMatch(/period\s+comments\s+fixed\s+wrong\s+intentional\s+not important\s+unjudged\s+muted/);
    expect(text).toMatch(/2026-10\s+3\s+1\s+1\s+0\s+0\s+1\s+0/);
    expect(text).toMatch(/2026-11\s+1\s+0\s+0\s+0\s+1\s+0\s+3/);
    expect(text).toMatch(/total\s+4\s+1\s+1\s+0\s+1\s+1\s+3/);
    expect(text).toContain(`${MUTER.id}: 2`);
    expect(text).toContain(`3 files, 4 entries, ${FILE_LINES} lines`);
    expect(text).toContain(IDLE.id);
  });
});

describe("parseReportArgs", () => {
  test("defaults, --since and --format, and the usage errors", () => {
    expect(parseReportArgs([])).toEqual({ format: "terminal" });
    expect(parseReportArgs(["--since", "2026-11-01", "--format=json"])).toEqual({ since: "2026-11-01", format: "json" });
    for (const bad of [["--since", "yesterday"], ["--since", "2026-13-40"], ["--format", "xml"], ["--nope"], ["stray"], ["--since"]]) {
      expect(() => parseReportArgs(bad)).toThrow(UsageError);
    }
  });
});

describe("wachiman memory report", () => {
  function seeded(withRuns: boolean) {
    const home = temp("wachiman-report-home-");
    const repo = emptyRepo();
    git(repo, "remote", "add", "origin", "https://github.com/o/demo.git");
    mkdirSync(join(repo, ".wachiman/memory"), { recursive: true });
    for (const [name, text] of Object.entries(FILES)) writeFileSync(join(repo, ".wachiman/memory", name), text);
    if (withRuns) {
      const key = repositoryKey(repo);
      recordMemoryUse(home, key.key, [MUTER.id, USED_CONVENTION.id], "2026-11-03");
      for (const run of runs()) writeRun(join(home, "history"), { ...run, repository: key });
      for (const v of VERDICTS.values()) appendVerdict(join(home, "history"), key.key, v);
    }
    const out: string[] = [];
    const run = (args: string[]) => {
      out.length = 0;
      const code = runMemory(["report", ...args], repo, { stdout: (t) => out.push(t), stderr: () => {} }, { env: { WACHIMAN_HOME: home } });
      return { code, stdout: out.join("") };
    };
    return { run };
  }

  test("with no history it says so and exits 0, in text and in json", () => {
    const { run } = seeded(false);
    const text = run([]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("No review history");
    const json = run(["--format", "json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ format: "wachiman.memory-report/1", empty: true, periods: [] });
  });

  test("reads the local history and the working tree's memory folder", () => {
    const { run } = seeded(true);
    const text = run([]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/total\s+4\s+1\s+1\s+0\s+1\s+1\s+3/);
    const json = JSON.parse(run(["--format", "json"]).stdout);
    expect(Object.keys(json).sort()).toEqual(["empty", "format", "memory", "neverUsed", "neverUsedReason", "periods", "since", "total"].sort());
    expect(json.total.outcomes).toEqual({ fixed: 1, wrong: 1, intentional: 0, notImportant: 1, unjudged: 1 });
    expect(json.memory.entries).toBe(4);
    expect(json.neverUsed.map((e: { id: string }) => e.id).sort()).toEqual([IDLE.id, IDLE_CONVENTION.id].sort());
  });
});
