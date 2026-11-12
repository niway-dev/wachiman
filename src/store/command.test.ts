import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { checkKeywords, validate } from "../../test/support/json-schema";
import { ALPHA, EXPECTED, fixtureHome, removeFixtureHomes } from "../../test/support/dashboard-fixture";
import { DASHBOARD_FORMAT, parseDashboardArgs } from "./command";
import { esc } from "./html";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeFixtureHomes();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const cli = join(import.meta.dir, "..", "cli.ts");
function wachiman(args: string[], home: string, extraEnv: Record<string, string> = {}, cwd?: string) {
  const out = Bun.spawnSync([process.execPath, cli, ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: home, USER: "dev", ...extraEnv },
    stdin: "ignore",
    ...(cwd ? { cwd } : {}),
  });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}
const dashboard = (args: string[], home: string, extraEnv: Record<string, string> = {}) => wachiman(["dashboard", ...args], home, extraEnv);
/** The JSON document without the one field that is a clock reading. */
const figures = (stdout: string) => {
  const { generatedAt: _at, ...rest } = JSON.parse(stdout);
  return rest;
};

describe("parseDashboardArgs", () => {
  test("options, help and the usage errors", () => {
    expect(parseDashboardArgs([])).toEqual({ json: false });
    expect(parseDashboardArgs(["--json"])).toEqual({ json: true });
    expect(parseDashboardArgs(["--out", "a.html"])).toEqual({ json: false, out: "a.html" });
    expect(parseDashboardArgs(["--out=a.html"])).toEqual({ json: false, out: "a.html" });
    expect(parseDashboardArgs(["--help"])).toEqual({ help: true });
    for (const bad of [["--frobnicate"], ["stray"], ["--json=1"], ["--out"], ["--out", "--json"], ["--out="], ["--json", "--out", "a.html"]]) {
      expect(() => parseDashboardArgs(bad)).toThrow(UsageError);
    }
  });
});

describe("wachiman dashboard --json", () => {
  test("reports spend per day and repository, findings by severity and verdict, and loop rounds, matching the fixture history", () => {
    const { home } = fixtureHome();
    const r = dashboard(["--json"], home);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.format).toBe(DASHBOARD_FORMAT);
    expect(doc.spend.byDay).toEqual(EXPECTED.spendByDay);
    expect(doc.spend.byRepository).toEqual(EXPECTED.spendByRepository);
    expect(doc.totals).toEqual(EXPECTED.totals);
    expect(doc.findings).toEqual(EXPECTED.findings);
    expect(doc.loops.totals).toEqual(EXPECTED.loops.totals);
    expect(doc.loops.branches).toHaveLength(2);
    expect(doc.loops.branches[0]).toMatchObject({ repositoryKey: ALPHA.key, branch: "feat/x", base: "main", outcome: "converged", rounds: 2, exitReason: "not recorded" });
    expect(doc.prConfidence.status).toBe("not recorded");
  });

  test("validates against docs/formats/dashboard.v1.schema.json, with and without a recorded grade", () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "docs", "formats", "dashboard.v1.schema.json"), "utf8"));
    checkKeywords(schema);
    for (const opts of [{}, { grade: "A" as const }]) {
      const doc = JSON.parse(dashboard(["--json"], fixtureHome(opts).home).stdout);
      expect(validate(schema, doc)).toEqual([]);
    }
    // Negative controls.
    const doc = JSON.parse(dashboard(["--json"], fixtureHome().home).stdout);
    expect(validate(schema, { ...doc, extra: 1 })).toEqual(['$: unexpected property "extra"']);
    expect(validate(schema, { ...doc, prConfidence: { status: "recorded" } })).not.toEqual([]);
  });

  test("deleting the index and running the dashboard rebuilds it and shows the same figures", () => {
    const { home, index } = fixtureHome();
    const first = dashboard(["--json"], home);
    expect(existsSync(index)).toBe(true);
    rmSync(index);
    const second = dashboard(["--json"], home);
    expect(second.code).toBe(0);
    expect(existsSync(index)).toBe(true);
    expect(statSync(index).mode & 0o777).toBe(0o600);
    expect(figures(second.stdout)).toEqual(figures(first.stdout));
    // A corrupt index gives the same figures too.
    writeFileSync(index, "garbage");
    expect(figures(dashboard(["--json"], home).stdout)).toEqual(figures(first.stdout));
  });

  test("an empty home prints zero figures and exits 0", () => {
    const home = temp("wachiman-dash-empty-");
    const r = dashboard(["--json"], home);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).totals).toEqual({ repositories: 0, runs: 0, costUsdEstimate: 0 });
  });

  test("a recorded PR Confidence grade is counted", () => {
    const { home } = fixtureHome({ grade: "B" });
    expect(JSON.parse(dashboard(["--json"], home).stdout).prConfidence).toEqual({
      status: "recorded",
      gradedRuns: 1,
      byGrade: { A: 0, "A-": 0, B: 1, C: 0, "cannot say": 0 },
    });
  });
});

describe("wachiman history does not depend on the index", () => {
  test("gives byte-identical output with the index present, deleted or corrupt", () => {
    const { home, index } = fixtureHome();
    const repo = temp("wachiman-dash-cwd-");
    const runs = () => [
      wachiman(["history", "--all-repos", "--repo-dir", repo], home),
      wachiman(["history", "--all-repos", "--json", "--repo-dir", repo], home),
      wachiman(["status", "--all-repos", "--json", "--repo-dir", repo], home),
    ];
    const without = runs();
    expect(without[0].code).toBe(0);
    expect(without[0].stdout).toContain(ALPHA.key);
    expect(existsSync(index)).toBe(false);

    dashboard([], home);
    expect(existsSync(index)).toBe(true);
    const present = runs();

    writeFileSync(index, "this is not a sqlite database");
    const corrupt = runs();

    rmSync(index);
    const deleted = runs();

    for (const other of [present, corrupt, deleted]) {
      other.forEach((r, i) => {
        expect(r.code).toBe(without[i].code);
        expect(r.stdout).toBe(without[i].stdout);
        expect(r.stderr).toBe(without[i].stderr);
      });
    }
  });

  test("history works when the index path cannot even be read", () => {
    const { home, index } = fixtureHome();
    const repo = temp("wachiman-dash-cwd-");
    const before = wachiman(["history", "--all-repos", "--repo-dir", repo], home);
    // A directory where the file would be: opening it as a database fails.
    mkdirSync(index);
    const after = wachiman(["history", "--all-repos", "--repo-dir", repo], home);
    expect(after).toEqual(before);
  });
});

describe("wachiman dashboard (HTML)", () => {
  test("writes one self-contained file under the Wachiman home, prints its path and shows the figures", () => {
    const { home, wachiman: wh } = fixtureHome();
    const r = dashboard([], home);
    expect(r.code).toBe(0);
    const path = join(wh, "dashboard.html");
    expect(r.stdout).toBe(`${path}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const html = readFileSync(path, "utf8");
    for (const text of ["Spend per day", "2026-11-01", "2026-11-02", "$0.75", "$1.75", "$2.50", "alpha", "beta", "Blocker", "feat/x", "fix/y", "converged", "PR Confidence", "not recorded"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("<svg");
  });

  test("--out writes where it is told, creating the directory, and replaces an older file", () => {
    const { home } = fixtureHome();
    const dir = temp("wachiman-dash-out-");
    const out = join(dir, "nested", "page.html");
    expect(dashboard(["--out", out], home).stdout).toBe(`${out}\n`);
    expect(readFileSync(out, "utf8")).toContain("Wachiman dashboard");
    expect(dashboard(["--out", out], home).code).toBe(0);
  });

  test("makes no external request: no script, no resource reference, no http(s) address, a policy that forbids them", () => {
    const { home, wachiman: wh } = fixtureHome();
    dashboard([], home);
    const page = readFileSync(join(wh, "dashboard.html"), "utf8");
    expect(page).not.toMatch(/https?:\/\//i);
    expect(page).not.toMatch(/<script|<link|<img|<iframe|<object|<embed|<form|@import|url\(|\ssrc=|\shref=|\son\w+=/i);
    expect(page).toContain(`Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"`);
  });

  test("escapes a hostile repository, branch and finding title wherever they could appear", () => {
    const hostile = `<script>alert(1)</script><img src="http://evil.example/x" onerror='boom()'> & "q"`;
    const { home, wachiman: wh } = fixtureHome({ hostile });
    const r = dashboard([], home);
    expect(r.code).toBe(0);
    const page = readFileSync(join(wh, "dashboard.html"), "utf8");
    expect(page).not.toContain("<script");
    expect(page).not.toContain("<img");
    expect(page).not.toContain("onerror='");
    expect(page).toContain(esc(hostile));
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The only tags are the ones the page itself writes.
    expect(page.match(/<([a-z][a-z0-9]*)/g)!.map((t) => t.slice(1)).filter((t) => !["html", "head", "meta", "title", "style", "body", "main", "h1", "h2", "p", "div", "b", "table", "thead", "tbody", "tr", "th", "td", "span", "svg", "rect"].includes(t))).toEqual([]);
  });

  test("never runs claude or gh, and has no flag that opens a browser", () => {
    const { home } = fixtureHome();
    const bin = temp("wachiman-bin-");
    const canary = join(bin, "canary");
    for (const name of ["claude", "gh", "open", "xdg-open", "curl"]) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${canary}"\nexit 99\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    expect(dashboard([], home, env).code).toBe(0);
    expect(dashboard(["--json"], home, env).code).toBe(0);
    expect(existsSync(canary)).toBe(false);
    expect(dashboard(["--open"], home, env).code).toBe(2);
  });

  test("is listed in the help and takes --repo-dir without using it", () => {
    const { home } = fixtureHome();
    const help = wachiman(["--help"], home);
    expect(help.stdout).toContain("wachiman dashboard [--json] [--out <file>] [--repo-dir <dir>]");
    expect(wachiman(["dashboard", "--help"], home).stdout).toBe("wachiman dashboard [--json] [--out <file>] [--repo-dir <dir>]\n");
    const repo = temp("wachiman-dash-cwd-");
    expect(wachiman(["dashboard", "--json", "--repo-dir", repo], home).code).toBe(0);
    expect(wachiman(["dashboard", "--json", "--repo-dir", join(repo, "missing")], home).code).toBe(2);
  });
});
