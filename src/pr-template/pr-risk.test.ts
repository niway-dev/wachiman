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
