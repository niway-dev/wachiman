import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changesFromGit, commitMessagesFromGit, defaultRunner, gitFileAt, ToolError } from "./gh";
import { computeRisk, formatRisk, HIGH, LOW, MEDIUM, parsePatch, parseRiskExtension, type ChangedFile, type RiskExtension } from "./pr-risk";
import { BREAKING_TEXT, fixture } from "./fixtures/check/load";

const change = (path: string, patch = "", status = "M"): ChangedFile => ({ path, status, patch });
const riskOf = (changes: ChangedFile[], extra?: RiskExtension | null, warn?: (line: string) => void) => computeRisk(changes, extra, warn);
const level = (changes: ChangedFile[], extra?: RiskExtension | null) => riskOf(changes, extra).level;

function expectRule(changes: ChangedFile[], lvl: number, part: string) {
  const risk = riskOf(changes);
  expect(risk.level).toBe(lvl);
  expect(risk.rule).toContain(part);
}

describe("RiskRulesTest: high", () => {
  test("high migration by path", () => {
    const r = riskOf([change("db/migrations/0003.sql", "", "A")]);
    expect(r.level).toBe(HIGH);
    expect(r.rule).toContain("migrations or schema");
    expect(formatRisk(r)).toBe("🔴 High: database migrations or schema (db/migrations/0003.sql)");
  });

  test("high schema by content", () => {
    expectRule([change("app/models.py", "+ALTER TABLE users ADD COLUMN x int;")], HIGH, "migrations or schema");
  });

  test("high auth by path", () => {
    expectRule([change("src/auth/session.ts")], HIGH, "authentication");
  });

  test("high auth by content", () => {
    expectRule([change("src/user.py", "+hash = bcrypt.hashpw(pw)")], HIGH, "authentication");
  });

  test("high secrets by path", () => {
    expectRule([change(".env.production")], HIGH, "secrets");
  });

  test("high secrets by content", () => {
    expectRule([change("src/cfg.py", "+API_KEY = 'abc'")], HIGH, "secrets");
  });

  test("env example is not a secret", () => {
    expect(level([change(".env.example")])).toBe(LOW);
  });

  test("high billing", () => {
    expectRule([change("src/billing/invoice.ts")], HIGH, "billing");
    expectRule([change("src/pay.py", "+import stripe")], HIGH, "billing");
  });

  test("high deletion of stored data", () => {
    expectRule([change("src/jobs.py", '+cur.execute("DELETE FROM events")')], HIGH, "deletion of stored data");
    expectRule([change("src/jobs.js", "+await db.users.deleteMany({})")], HIGH, "deletion of stored data");
  });

  test("deleted line is not data deletion", () => {
    expect(level([change("src/jobs.py", '-cur.execute("DELETE FROM events")')])).toBe(LOW);
  });

  test("high deploy file", () => {
    expectRule([change("infra/main.tf")], HIGH, "deploy or infrastructure");
    expectRule([change(".github/workflows/deploy.yml")], HIGH, "deploy or infrastructure");
    expectRule([change("Dockerfile", "", "M")], HIGH, "deploy or infrastructure");
  });

  test("high removed route", () => {
    expectRule([change("src/app.py", "-@app.get('/users')\n+x = 1")], HIGH, "removal of a public route");
  });

  test("high removed route file", () => {
    expectRule([change("src/routes/users.ts", "", "D")], HIGH, "removal of a public route");
  });

  test("high removed cli command", () => {
    expectRule([change("tools/cli.py", "-    sub.add_parser('sync')")], HIGH, "removal of a public route");
  });

  test("high removed contract field", () => {
    expectRule([change("api/openapi.yaml", "-        email:\n")], HIGH, "removal of a public route");
  });

  test("removed contract description is not a field", () => {
    expect(level([change("api/openapi.yaml", "-        description: old")])).not.toBe(HIGH);
  });
});

describe("RiskRulesTest: medium", () => {
  test("medium ci workflow", () => {
    expectRule([change(".github/workflows/ci.yml")], MEDIUM, "CI workflows");
  });

  test("medium legal copy", () => {
    expectRule([change("site/privacy.html")], MEDIUM, "legal or public copy");
  });

  test("medium major dependency bump", () => {
    expectRule([change("package.json", '-    "left-pad": "^1.3.0",\n+    "left-pad": "^2.0.0",')], MEDIUM, "major dependency bump");
  });

  test("minor dependency bump is low", () => {
    expect(level([change("package.json", '-    "left-pad": "^1.3.0",\n+    "left-pad": "^1.4.0",')])).toBe(LOW);
  });

  test("medium python major bump", () => {
    expectRule([change("requirements.txt", "-django==4.2.1\n+django==5.0.0")], MEDIUM, "major dependency bump");
  });

  test("medium major bump with range specifier", () => {
    expectRule([change("requirements.txt", "-django>=3.2\n+django>=4.2")], MEDIUM, "major dependency bump");
    expectRule([change("requirements.txt", "-django~=3.2\n+django~=4.2")], MEDIUM, "major dependency bump");
  });

  test("minor bump with range specifier is low", () => {
    expect(level([change("requirements.txt", "-django>=4.2\n+django>=4.3")])).toBe(LOW);
    expect(level([change("requirements.txt", "-django~=4.2\n+django~=4.3")])).toBe(LOW);
  });

  test("medium new service", () => {
    expectRule([change("services/mailer/Dockerfile", "", "A")], MEDIUM, "new service or deploy path");
  });

  test("medium public contract extended", () => {
    expectRule([change("api/openapi.yaml", "+        nickname:\n")], MEDIUM, "public contract extended");
    expectRule([change("src/app.py", "+@app.post('/teams')")], MEDIUM, "public contract extended");
  });
});

describe("RiskRulesTest: low and ties", () => {
  test("low docs tests refactor", () => {
    const got = riskOf([
      change("docs/specs/a.md", "+ALTER TABLE x"),
      change("tests/test_a.py", "+DROP TABLE x"),
      change("README.md", "+text"),
      change("src/util.py", "+def f(): return 1"),
    ]);
    expect(got.level).toBe(LOW);
    expect(formatRisk(got)).toBe("🟢 Low: no high or medium rule matched");
  });

  test("docs about pricing are low", () => {
    expect(level([change("docs/adr/0001-pricing.md")])).toBe(LOW);
  });

  test("empty diff is low", () => {
    expect(computeRisk([]).level).toBe(LOW);
  });

  test("highest rule wins", () => {
    expect(riskOf([change(".github/workflows/ci.yml"), change("db/migrations/1.sql", "", "A")]).level).toBe(HIGH);
  });

  test("authentication stays High and CI workflows stay Medium", () => {
    expect(level([change("src/auth/login.ts")])).toBe(HIGH);
    expect(level([change(".github/workflows/test.yml")])).toBe(MEDIUM);
    expect(level([change("docs/guide.md")])).toBe(LOW);
  });
});

describe("RiskRulesTest: the extension file", () => {
  test("extension adds high path", () => {
    const r = riskOf([change("vault_v2/x.py")], { high: { paths: ["^vault_v2/"] } });
    expect(r.level).toBe(HIGH);
    expect(r.rule).toContain("pr-risk.toml");
  });

  test("extension adds medium content", () => {
    expect(level([change("src/x.py", "+feature_flag('beta')")], { medium: { content: ["feature_flag"] } })).toBe(MEDIUM);
  });

  test("extension cannot lower default", () => {
    expect(level([change("db/migrations/1.sql")], { medium: { paths: ["migrations"] } })).toBe(HIGH);
  });

  test("extension invalid regex is ignored", () => {
    const warnings: string[] = [];
    const r = riskOf([change("a.py")], { high: { paths: ["("] } }, (line) => warnings.push(line));
    expect(r.level).toBe(LOW);
    expect(warnings.join("\n")).toContain("invalid regex");
  });

  test("extension file is loaded from repo root", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-risk-"));
    try {
      mkdirSync(join(dir, ".github"));
      writeFileSync(join(dir, ".github", "pr-risk.toml"), '[high]\npaths = ["^vault/"]\n');
      const run = defaultRunner;
      run(["git", "init", "-q", "-b", "main"], dir);
      run(["git", "add", "-A"], dir);
      run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"], dir);
      const text = gitFileAt(run, dir, "HEAD", ".github/pr-risk.toml");
      expect(text).not.toBeNull();
      expect(level([change("vault/a.py")], parseRiskExtension(text!))).toBe(HIGH);
      expect(gitFileAt(run, dir, "HEAD", ".github/nowhere.toml")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("extension that is not valid TOML is reported and ignored", () => {
    const warnings: string[] = [];
    expect(parseRiskExtension("[high\npaths = ", (line) => warnings.push(line))).toBeNull();
    expect(warnings.join("\n")).toContain(".github/pr-risk.toml");
  });

  test("a pattern in the extension with a leading (?i) is case-insensitive", () => {
    expect(level([change("src/Vault/x.py")], { high: { paths: ["(?i)/vault/"] } })).toBe(HIGH);
  });
});

describe("ParsePatchTest", () => {
  test("statuses and paths", () => {
    const got = parsePatch(fixture("diffs/three-files.diff"));
    expect(got.map((c) => [c.path, c.status])).toEqual([
      ["db/migrations/1.sql", "A"],
      ["new.py", "R"],
      ["gone.py", "D"],
    ]);
    expect(got[0]!.patch).toContain("+CREATE TABLE");
    expect(got[0]!.patch).not.toContain("+++");
  });

  test("empty", () => {
    expect(parsePatch("")).toEqual([]);
  });

  const paths = (text: string) => parsePatch(text).map((c) => [c.path, c.status, c.unreadable === true]);

  test("a path with a space, unquoted in the header, is read whole", () => {
    const diff = [
      "diff --git a/docs/my notes/auth login.ts b/docs/my notes/auth login.ts",
      "index 1111111..2222222 100644",
      "--- a/docs/my notes/auth login.ts\t",
      "+++ b/docs/my notes/auth login.ts\t",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    expect(paths(diff)).toEqual([["docs/my notes/auth login.ts", "M", false]]);
  });

  test("a quoted path with a space and an escaped quote", () => {
    const diff = [
      String.raw`diff --git "a/src/we \"ird\" name.ts" "b/src/we \"ird\" name.ts"`,
      "index 1111111..2222222 100644",
      String.raw`--- "a/src/we \"ird\" name.ts"`,
      String.raw`+++ "b/src/we \"ird\" name.ts"`,
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    expect(paths(diff)).toEqual([['src/we "ird" name.ts', "M", false]]);
  });

  test("escapes in a quoted path: tab, backslash, newline and octal bytes", () => {
    const header = (name: string) => `diff --git "a/${name}" "b/${name}"\nnew file mode 100644\nindex 0000000..1111111\n`;
    expect(paths(header(String.raw`a\tb\\c\nd`))).toEqual([["a\tb\\c\nd", "A", false]]);
    expect(paths(header(String.raw`caf\303\251.ts`))).toEqual([["café.ts", "A", false]]);
  });

  test("a rename takes the new path, quoted or not", () => {
    const plain = ["diff --git a/old name.py b/new name.py", "similarity index 100%", "rename from old name.py", "rename to new name.py"].join("\n");
    expect(paths(plain)).toEqual([["new name.py", "R", false]]);
    const quoted = [
      String.raw`diff --git "a/old.py" "b/new \"q\".py"`,
      "similarity index 90%",
      "rename from old.py",
      String.raw`rename to "new \"q\".py"`,
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    expect(paths(quoted)).toEqual([['new "q".py', "R", false]]);
  });

  test("a rename into a protected folder is still seen as that folder", () => {
    const diff = ["diff --git a/tools/x.ts b/db/migrations/x.ts", "similarity index 100%", "rename from tools/x.ts", "rename to db/migrations/x.ts"].join("\n");
    expect(computeRisk(parsePatch(diff)).level).toBe(HIGH);
  });

  test("a deleted file takes its name from the --- line", () => {
    const diff = [
      "diff --git a/old dir/gone.py b/old dir/gone.py",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "--- a/old dir/gone.py\t",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-y = 1",
    ].join("\n");
    expect(paths(diff)).toEqual([["old dir/gone.py", "D", false]]);
  });

  test("a binary file has no --- and +++ lines: the header gives the path", () => {
    const diff = ["diff --git a/img/logo file.png b/img/logo file.png", "new file mode 100644", "index 0000000..1111111", "Binary files /dev/null and b/img/logo file.png differ"].join("\n");
    expect(paths(diff)).toEqual([["img/logo file.png", "A", false]]);
    const quoted = [String.raw`diff --git "a/img/\"x\".png" "b/img/\"x\".png"`, "index 1111111..2222222 100644", String.raw`Binary files "a/img/\"x\".png" and "b/img/\"x\".png" differ`].join("\n");
    expect(paths(quoted)).toEqual([['img/"x".png', "M", false]]);
  });

  test("a mode-only change is read from the header", () => {
    const diff = ["diff --git a/bin/run b/bin/run", "old mode 100644", "new mode 100755"].join("\n");
    expect(paths(diff)).toEqual([["bin/run", "M", false]]);
  });

  test("a path that cannot be read is kept, flagged, and raises the floor to High", () => {
    const diff = [
      String.raw`diff --git "a/bad\qname" "b/bad\qname"`,
      "index 1111111..2222222 100644",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    const got = parsePatch(diff);
    expect(got.map((c) => c.unreadable === true)).toEqual([true, false]);
    expect(got[1]!.path).toBe("README.md");
    const risk = computeRisk(got);
    expect(risk.level).toBe(HIGH);
    expect(risk.rule).toBe("a changed path that could not be read");
    expect(formatRisk(risk)).toStartWith("🔴 High: a changed path that could not be read (");
  });

  test("an unterminated quote and an ambiguous unquoted header are unreadable too", () => {
    expect(paths(String.raw`diff --git "a/x b/x`)).toEqual([[expect.any(String), "M", true]]);
    expect(paths("diff --git a/one b/two a/three b/four")).toEqual([[expect.any(String), "M", true]]);
  });

  test("a readable path leaves the floor to the rules", () => {
    const diff = ["diff --git a/README.md b/README.md", "--- a/README.md", "+++ b/README.md", "@@ -1 +1 @@", "-a", "+b"].join("\n");
    expect(computeRisk(parsePatch(diff)).level).toBe(LOW);
  });
});

describe("GitRiskTest", () => {
  const run = defaultRunner;
  const git = (dir: string, ...args: string[]) => {
    const r = run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], dir);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-risk-git-"));
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "a\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    return dir;
  };

  test("diff against merge base", () => {
    const dir = repo();
    try {
      mkdirSync(join(dir, "db", "migrations"), { recursive: true });
      writeFileSync(join(dir, "db", "migrations", "0003.sql"), "CREATE TABLE t (id int);\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", `feat: add table\n\n${BREAKING_TEXT}: x`);
      const { changes } = changesFromGit(run, dir, "HEAD~1");
      expect(changes.map((c) => [c.path, c.status])).toEqual([["db/migrations/0003.sql", "A"]]);
      expect(formatRisk(computeRisk(changes))).toBe("🔴 High: database migrations or schema (db/migrations/0003.sql)");
      const messages = commitMessagesFromGit(run, dir, "HEAD~1");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(BREAKING_TEXT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing base raises", () => {
    const dir = repo();
    try {
      expect(() => changesFromGit(run, dir, "origin/main")).toThrow(ToolError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
