import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendVerdict } from "../history/store";
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

  test("a damaged run file is moved aside by the replay, as `history` does, and the rest is indexed", () => {
    const { wachiman, index, root } = fixtureHome();
    const dir = join(root, ALPHA.key, "runs");
    writeFileSync(join(dir, "2026-11-09T00-00-00-000Z-zzzzzzz.json"), "{ not json");
    const lines: string[] = [];
    refreshIndex(wachiman, (l) => lines.push(l));
    expect(lines.join("\n")).toContain("cannot be read");
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
    const { wachiman, index } = fixtureHome();
    const empty = join(wachiman, "..", "nothing-here");
    refreshIndex(empty, warn);
    const f = readFigures(join(empty, "index.sqlite"));
    expect(f.totals).toEqual({ repositories: 0, runs: 0, costUsdEstimate: 0 });
    expect(f.findings.total).toBe(0);
    expect(f.spend.byDay).toEqual([]);
    expect(existsSync(index)).toBe(false);
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
