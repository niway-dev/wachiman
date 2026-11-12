import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendVerdict, historyRoot, writeLoopFile, writeRun } from "../history/store";
import type { HistoryRun } from "../history/types";
import { ALPHA, EXPECTED, fixtureHome, removeFixtureHomes } from "../../test/support/dashboard-fixture";
import { INDEX_SCHEMA_VERSION, refreshIndex } from "./index";
import { readFigures } from "./figures";

afterAll(removeFixtureHomes);

const warnings: string[] = [];
const warn = (line: string) => warnings.push(line);

const userVersion = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
};

describe("the local index", () => {
  test("replays the run files, the verdicts and the loop states into figures", () => {
    const { wachiman, index } = fixtureHome();
    const built = refreshIndex(wachiman, warn);
    expect(built).toEqual({ path: index, rebuilt: true });
    const f = readFigures(index);
    expect(f.spend.byDay).toEqual(EXPECTED.spendByDay);
    expect(f.spend.byRepository).toEqual(EXPECTED.spendByRepository);
    expect(f.totals).toEqual(EXPECTED.totals);
    expect(f.findings).toEqual(EXPECTED.findings);
    expect(f.loops.totals).toEqual(EXPECTED.loops.totals);
    expect(f.loops.branches.map((b) => [b.repositoryKey, b.branch, b.outcome, b.rounds, b.exitReason])).toEqual([
      [ALPHA.key, "feat/x", "converged", 2, "not recorded"],
      ["beta-5e6f7a8b", "fix/y", "open", 3, "not recorded"],
    ]);
    expect(f.loops.branches[0].ledger).toEqual({ total: 1, byStatus: { new: 0, open: 0, "probably-fixed": 1, "not-repeated": 0, unknown: 0 } });
  });

  test("is one file, 0600, written through a temporary name that is gone afterwards", () => {
    const { wachiman, index } = fixtureHome();
    refreshIndex(wachiman, warn);
    expect(statSync(index).mode & 0o777).toBe(0o600);
    expect(userVersion(index)).toBe(INDEX_SCHEMA_VERSION);
    expect(readdirSync(wachiman).filter((n) => n.startsWith("index.sqlite"))).toEqual(["index.sqlite"]);
  });

  test("a missing index is rebuilt and gives the same figures", () => {
    const { wachiman, index } = fixtureHome();
    refreshIndex(wachiman, warn);
    const before = readFigures(index);
    unlinkSync(index);
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
    expect(existsSync(index)).toBe(true);
    expect(readFigures(index)).toEqual(before);
  });

  test("a corrupt index is deleted and rebuilt; the history files are untouched", () => {
    const { wachiman, index, root } = fixtureHome();
    refreshIndex(wachiman, warn);
    const before = readFigures(index);
    const run = join(root, ALPHA.key, "runs");
    const files = readdirSync(run);
    for (const garbage of ["not a database at all", ""]) {
      writeFileSync(index, garbage);
      expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
      expect(readFigures(index)).toEqual(before);
    }
    // A real database whose pages were cut short.
    const bytes = readFileSync(index);
    writeFileSync(index, bytes.subarray(0, Math.floor(bytes.length / 2)));
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
    expect(readFigures(index)).toEqual(before);
    expect(readdirSync(run)).toEqual(files);
  });

  test("an index of another schema version is rebuilt, never read", () => {
    const { wachiman, index } = fixtureHome();
    refreshIndex(wachiman, warn);
    const db = new Database(index);
    db.run(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION + 1}`);
    db.run("DELETE FROM runs");
    db.close();
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
    expect(userVersion(index)).toBe(INDEX_SCHEMA_VERSION);
    expect(readFigures(index).totals).toEqual(EXPECTED.totals);
  });

  test("an index that is up to date is reused; a new run file, verdict or loop makes it rebuild", () => {
    const { wachiman, index, root } = fixtureHome();
    refreshIndex(wachiman, warn);
    const db = new Database(index);
    db.run("INSERT INTO meta (key, value) VALUES ('marker', '1')");
    db.close();
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(false);
    const marker = () => {
      const d = new Database(index, { readonly: true });
      try {
        return d.query("SELECT value FROM meta WHERE key = 'marker'").get();
      } finally {
        d.close();
      }
    };
    expect(marker()).toEqual({ value: "1" });

    appendVerdict(root, ALPHA.key, { at: "2026-11-03T00:00:00.000Z", firstId: "c1c1c1c1c1", verdict: "partial" });
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
    expect(marker()).toBeNull();
    expect(readFigures(index).findings.byVerdict).toEqual({ correct: 1, partial: 1, wrong: 1, unjudged: 1 });
  });

  test("a new run file and a new loop file each make an up-to-date index rebuild", () => {
    const { wachiman, index, root } = fixtureHome();
    refreshIndex(wachiman, warn);
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(false);

    const [first] = readdirSync(join(root, ALPHA.key, "runs"));
    const extra = JSON.parse(readFileSync(join(root, ALPHA.key, "runs", first), "utf8")) as HistoryRun;
    writeRun(root, { ...extra, savedAt: "2026-11-05T10:00:00.000Z" });
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
    expect(readFigures(index).totals.runs).toBe(EXPECTED.totals.runs + 1);
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(false);

    writeLoopFile(root, ALPHA.key, "feat/z", { format: "wachiman.loop-state/1", branch: "feat/z", base: "main", status: "open", rounds: [{ round: 1, head: "a".repeat(40), at: "2026-11-05T11:00:00.000Z" }], ledger: [] });
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
    expect(readFigures(index).loops.totals.branches).toBe(3);
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(false);
  });

  test("a run file written while the index is being built is not lost: the next call rebuilds", () => {
    const { wachiman, index, root } = fixtureHome();
    const [first] = readdirSync(join(root, ALPHA.key, "runs"));
    const extra = JSON.parse(readFileSync(join(root, ALPHA.key, "runs", first), "utf8")) as HistoryRun;
    // The write lands after the signature was taken and before the replay reads the files.
    refreshIndex(wachiman, warn, { beforeReplay: () => writeRun(historyRoot(wachiman), { ...extra, savedAt: "2026-11-06T10:00:00.000Z" }) });
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
    expect(readFigures(index).totals.runs).toBe(EXPECTED.totals.runs + 1);
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(false);
  });

  test("a rebuild that fails leaves the previous index in place and no temporary file", () => {
    const { wachiman, index, root } = fixtureHome();
    refreshIndex(wachiman, warn);
    const before = readFileSync(index);
    appendVerdict(root, ALPHA.key, { at: "2026-11-03T00:00:00.000Z", firstId: "c1c1c1c1c1", verdict: "partial" });
    expect(() =>
      refreshIndex(wachiman, warn, {
        beforeReplay: () => {
          throw new Error("disk full");
        },
      }),
    ).toThrow("disk full");
    expect(readFileSync(index).equals(before)).toBe(true);
    expect(readdirSync(wachiman).filter((n) => n.startsWith("index.sqlite"))).toEqual(["index.sqlite"]);
  });

  test("a temporary file a crashed rebuild left a day ago is swept; a fresh one is not", () => {
    const { wachiman } = fixtureHome();
    const old = join(wachiman, "index.sqlite.tmp-111");
    const fresh = join(wachiman, "index.sqlite.tmp-222");
    mkdirSync(wachiman, { recursive: true });
    writeFileSync(old, "x");
    writeFileSync(fresh, "x");
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    refreshIndex(wachiman, warn);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("a damaged run file is moved aside by the replay, as `history` does, and the rest is indexed", () => {
    const { wachiman, index, root } = fixtureHome();
    const dir = join(root, ALPHA.key, "runs");
    const name = "2026-11-09T00-00-00-000Z-zzzzzzz.json";
    writeFileSync(join(dir, name), "{ not json");
    const lines: string[] = [];
    refreshIndex(wachiman, (l) => lines.push(l));
    expect(lines.join("\n")).toContain("moved to");
    expect(existsSync(join(dir, name))).toBe(false);
    expect(readdirSync(dir).filter((n) => n.startsWith(`${name}.unreadable-`))).toHaveLength(1);
    expect(readFigures(index).totals).toEqual(EXPECTED.totals);
  });

  test("a loop file that is not a loop state is skipped with a warning", () => {
    const { wachiman, index, root } = fixtureHome();
    writeFileSync(join(root, ALPHA.key, "loops", "broken-00000000.json"), "{ nope");
    const lines: string[] = [];
    refreshIndex(wachiman, (l) => lines.push(l));
    expect(lines.join("\n")).toContain("broken-00000000.json");
    expect(readFigures(index).loops.totals.branches).toBe(2);
  });

  test("PR Confidence grades are counted only where the run files record one", () => {
    const none = fixtureHome();
    refreshIndex(none.wachiman, warn);
    expect(readFigures(none.index).prConfidence).toEqual({
      status: "not recorded",
      note: expect.stringContaining("GitHub pull request"),
    });

    const graded = fixtureHome({ grade: "A-" });
    refreshIndex(graded.wachiman, warn);
    expect(readFigures(graded.index).prConfidence).toEqual({
      status: "recorded",
      gradedRuns: 1,
      byGrade: { A: 0, "A-": 1, B: 0, C: 0, "cannot say": 0 },
    });
  });

  test("an empty home gives empty figures", () => {
    const empty = join(fixtureHome().wachiman, "..", "nothing-here");
    const { path } = refreshIndex(empty, warn);
    expect(path).toBe(join(empty, "index.sqlite"));
    const f = readFigures(path);
    expect(f.totals).toEqual({ repositories: 0, runs: 0, costUsdEstimate: 0 });
    expect(f.findings.total).toBe(0);
    expect(f.spend.byDay).toEqual([]);
  });

  test("a source file that vanishes between the listing and the stat does not stop the index", () => {
    const { wachiman, index, root } = fixtureHome();
    const runs = join(root, ALPHA.key, "runs");
    const victim = join(runs, readdirSync(runs).sort()[0]);
    let calls = 0;
    const r = refreshIndex(wachiman, warn, {
      afterListing: () => {
        // Only the first scan: the retry finds the files as they are.
        if (calls++ === 0) unlinkSync(victim);
      },
    });
    expect(r.rebuilt).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(readFigures(index).totals.runs).toBe(EXPECTED.totals.runs - 1);
    // What is left is stable.
    expect(refreshIndex(wachiman, warn).rebuilt).toBe(false);
  });

  test("a verdict record without a time is indexed, and the figures still work", () => {
    const { wachiman, index, root } = fixtureHome();
    appendFileSync(join(root, ALPHA.key, "verdicts.jsonl"), `${JSON.stringify({ firstId: "c1c1c1c1c1", verdict: "partial" })}\n`);
    refreshIndex(wachiman, warn);
    expect(readFigures(index).findings.byVerdict).toEqual({ correct: 1, partial: 1, wrong: 1, unjudged: 1 });
  });

  test("an index that keeps its version and signature but lost a table or a column is rebuilt", () => {
    for (const damage of ["DROP TABLE loop_ledger", "ALTER TABLE runs DROP COLUMN cost_usd"]) {
      const { wachiman, index } = fixtureHome();
      refreshIndex(wachiman, warn);
      const db = new Database(index);
      db.run(damage);
      db.close();
      expect(refreshIndex(wachiman, warn).rebuilt).toBe(true);
      expect(readFigures(index).totals).toEqual(EXPECTED.totals);
    }
  });

  test("a verdicts line that is half written does not stop the index", () => {
    const { wachiman, index, root } = fixtureHome();
    appendFileSync(join(root, ALPHA.key, "verdicts.jsonl"), '{"at":"x","firstId"');
    refreshIndex(wachiman, warn);
    expect(readFigures(index).findings.byVerdict).toEqual(EXPECTED.findings.byVerdict);
  });
});

describe("nothing existing depends on the index", () => {
  test("only the store and the command table import the store module", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !path.includes(`${join("src", "store")}`) && path !== join(import.meta.dir, "..", "cli.ts")) {
          if (/from "\.\.?\/(\.\.\/)?store\//.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    walk(join(import.meta.dir, ".."));
    expect(offenders).toEqual([]);
  });
});
