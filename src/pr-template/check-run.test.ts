import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "../config";
import { parseCheckArgs, parseRiskArgs, parseStripArgs, runCheck, runRisk, runStrip, type PrTemplateIo } from "./check-run";
import { defaultRunner, type CommandResult, type CommandRunner } from "./gh";
import { BREAKING_TEXT, fixture, HEAD, TITLE, validBody, validCustomBody } from "./fixtures/check/load";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-template-run-"));
  dirs.push(dir);
  return dir;
};
const put = (dir: string, path: string, text: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const io: PrTemplateIo = { stdout: (t) => out.push(t), stderr: (l) => err.push(l) };
  return { io, out: () => out.join(""), err: () => err.join("\n") };
}

const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): CommandResult => ({ code: 1, stdout: "", stderr });
const notFound = fail("gh: Not Found (HTTP 404)");

/** A runner that answers by the start of the joined command; anything else fails. */
function fake(answers: Record<string, CommandResult>) {
  const calls: string[] = [];
  const run: CommandRunner = (cmd) => {
    const line = cmd.join(" ");
    calls.push(line);
    for (const [prefix, result] of Object.entries(answers)) if (line.startsWith(prefix) || line.includes(prefix)) return result;
    return fail(`fake: no answer for ${line}`);
  };
  return { run, calls };
}
const gitDown: Record<string, CommandResult> = { "git ": { code: 128, stdout: "", stderr: "fatal: bad revision 'no-such-ref'" } };

describe("parseCheckArgs", () => {
  test("a file with a title", () => {
    expect(parseCheckArgs(["body.md", "--title", "fix: a", "--head", "abc1234", "--allow-breaking"])).toEqual({
      file: "body.md", title: "fix: a", head: "abc1234", base: "origin/main", allowBreaking: true,
    });
    expect(parseCheckArgs(["--title=fix: a", "--base", "main", "body.md"])).toMatchObject({ file: "body.md", base: "main", allowBreaking: false });
  });

  test("a pull request, with an optional repository", () => {
    expect(parseCheckArgs(["--pr", "7"])).toEqual({ pr: 7, base: "origin/main", allowBreaking: false });
    expect(parseCheckArgs(["--pr", "7", "--repo", "acme/widgets"])).toMatchObject({ pr: 7, repo: "acme/widgets" });
  });

  test("check needs file or pr", () => {
    expect(() => parseCheckArgs(["--title", "x"])).toThrow(UsageError);
    expect(() => parseCheckArgs(["body.md", "--pr", "7"])).toThrow(UsageError);
  });

  test("a file needs a title, and --repo goes with --pr", () => {
    expect(() => parseCheckArgs(["body.md"])).toThrow("needs --title");
    expect(() => parseCheckArgs(["body.md", "--title", "x", "--repo", "a/b"])).toThrow("--repo goes with --pr");
  });

  test("with --pr the title, head and base come from the pull request", () => {
    for (const flag of ["--title", "--head", "--base"]) expect(() => parseCheckArgs(["--pr", "7", flag, "x"])).toThrow(UsageError);
  });

  test("bad flags and numbers are usage errors", () => {
    expect(() => parseCheckArgs(["--pr", "seven"])).toThrow("--pr must be a pull request number");
    expect(() => parseCheckArgs(["--pr", "0"])).toThrow(UsageError);
    expect(() => parseCheckArgs(["--pr", "7", "--nope"])).toThrow("does not take --nope");
    expect(() => parseCheckArgs(["a.md", "b.md", "--title", "x"])).toThrow(UsageError);
    expect(() => parseCheckArgs(["--pr"])).toThrow("needs a value");
  });

  test("help", () => {
    expect(parseCheckArgs(["--help"])).toEqual({ help: true });
    expect(parseCheckArgs(["-h"])).toEqual({ help: true });
  });
});

describe("parseStripArgs and parseRiskArgs", () => {
  test("strip takes exactly one file", () => {
    expect(parseStripArgs(["body.md"])).toEqual({ file: "body.md" });
    expect(() => parseStripArgs([])).toThrow(UsageError);
    expect(() => parseStripArgs(["a", "b"])).toThrow(UsageError);
    expect(() => parseStripArgs(["a", "--all"])).toThrow(UsageError);
    expect(parseStripArgs(["--help"])).toEqual({ help: true });
  });

  test("risk takes an optional base", () => {
    expect(parseRiskArgs([])).toEqual({ base: "origin/main" });
    expect(parseRiskArgs(["--base", "main"])).toEqual({ base: "main" });
    expect(() => parseRiskArgs(["main"])).toThrow(UsageError);
    expect(() => parseRiskArgs(["--head", "x"])).toThrow(UsageError);
    expect(parseRiskArgs(["-h"])).toEqual({ help: true });
  });
});

describe("CliTest: check a file", () => {
  const options = (file: string) => ({ file, title: TITLE, head: HEAD, base: "no-such-ref", allowBreaking: false });
  const run = (dir: string, body: string, answers = gitDown) => {
    put(dir, "body.md", body);
    const c = capture();
    const status = runCheck(options("body.md"), dir, c.io, { run: fake(answers).run });
    return { status, out: c.out(), err: c.err() };
  };

  test("check file reports codes and exit status", () => {
    const got = run(tmp(), validBody().replace("## Why\n", ""));
    expect(got.status).toBe(1);
    expect(got.err).toContain("wachiman pr-template: heading-missing:");
    expect(got.err).toContain("warning:");
  });

  test("check file ok", () => {
    const got = run(tmp(), validBody({ risk: "🔴 High, unverified floor" }));
    expect([got.status, got.out]).toEqual([0, "ok\n"]);
  });

  test("unverified risk floor is an error", () => {
    const got = run(tmp(), validBody());
    expect([got.status, got.out]).toEqual([1, ""]);
    expect(got.err).toContain("risk-unverified: the risk floor could not be computed");
    expect(got.err).toContain("fix the cause (a reachable --base");
  });

  test("unverified risk floor is fine when stated high", () => {
    const got = run(tmp(), validBody({ risk: "🔴 High, I know more" }));
    expect([got.status, got.out]).toEqual([0, "ok\n"]);
    expect(got.err).not.toContain("risk-unverified");
  });

  test("a missing file is exit 2", () => {
    const c = capture();
    expect(runCheck(options("nowhere.md"), tmp(), c.io, { run: fake(gitDown).run })).toBe(2);
    expect(c.err()).toContain("cannot read nowhere.md");
  });

  test("without --head the head comes from git, and a failing git skips the comparison with a warning", () => {
    const dir = tmp();
    put(dir, "body.md", validBody({ risk: "🔴 High, x" }));
    const c = capture();
    const opts = { file: "body.md", title: TITLE, base: "main", allowBreaking: false };
    expect(runCheck(opts, dir, c.io, { run: fake({ "git -c core.quotepath=false rev-parse HEAD": ok("0123456789abcdef0123456789abcdef01234567\n"), ...gitDown }).run })).toBe(1);
    expect(c.err()).toContain("footer-head-mismatch");
    const c2 = capture();
    expect(runCheck(opts, dir, c2.io, { run: fake(gitDown).run })).toBe(0);
    expect(c2.err()).toContain("footer head comparison skipped");
  });

  test("the JSON is read from the working tree: a custom required section is enforced", () => {
    const dir = tmp();
    put(dir, ".github/pr-template.json", fixture("custom-template.json"));
    expect(run(dir, validBody({ risk: "🔴 High, x" })).status).toBe(1);
    expect(run(dir, validCustomBody({ risk: "🔴 High, x" })).status).toBe(0);
  });

  test("invalid JSON is exit 2 naming the problem, and nothing falls back", () => {
    for (const [text, problem] of [
      ["{ nope", "is not valid JSON"],
      [JSON.stringify({ drop: ["needs-you"] }), "is locked"],
      [JSON.stringify({ add: ["ghost"] }), "unknown section"],
    ] as const) {
      const dir = tmp();
      put(dir, ".github/pr-template.json", text);
      const got = run(dir, validBody({ risk: "🔴 High, x" }));
      expect(got.status).toBe(2);
      expect(got.err).toContain(problem);
      expect(got.out).toBe("");
    }
  });
});

describe("check a file against a real git repository", () => {
  const git = (dir: string, ...args: string[]) => {
    const r = defaultRunner(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], dir);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  /** A base commit (with an optional pr-risk.toml) and one branch commit adding `path`. */
  const repo = (extension: string | null, path: string, message = "feat: add a file") => {
    const dir = tmp();
    git(dir, "init", "-q", "-b", "main");
    put(dir, "a.txt", "a\n");
    if (extension !== null) put(dir, ".github/pr-risk.toml", extension);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    put(dir, path, "x = 1\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", message);
    return dir;
  };
  const check = (dir: string, body: string, extra: Record<string, unknown> = {}) => {
    put(dir, "../body.md", body);
    const c = capture();
    const status = runCheck({ file: join(dir, "../body.md"), title: TITLE, head: HEAD, base: "HEAD~1", allowBreaking: false, ...extra }, dir, c.io);
    return { status, out: c.out(), err: c.err() };
  };

  test("the floor and the commit messages come from the branch", () => {
    const dir = repo(null, "db/migrations/0003.sql", `feat: add a table\n\n${BREAKING_TEXT}: x`);
    const low = check(dir, validBody());
    expect(low.status).toBe(1);
    expect(low.err).toContain("risk-below-floor");
    expect(low.err).toContain("breaking-change");
    const high = check(dir, validBody({ risk: "🔴 High, a migration" }), { allowBreaking: true });
    expect([high.status, high.out]).toEqual([0, "ok\n"]);
  });

  test("the risk extension is read from the base commit, so a branch cannot raise or lower its own floor", () => {
    const ext = '[high]\npaths = ["^vault/"]\n';
    expect(check(repo(ext, "vault/a.py"), validBody()).err).toContain("risk-below-floor");
    expect(check(repo(null, "vault/a.py"), validBody()).status).toBe(0);
  });

  test("risk prints the line and reads the extension from the base", () => {
    const dir = repo('[medium]\npaths = ["^widgets/"]\n', "widgets/a.py");
    const c = capture();
    expect(runRisk({ base: "HEAD~1" }, dir, c.io)).toBe(0);
    expect(c.out()).toContain("🟡 Medium: .github/pr-risk.toml medium path /^widgets// (widgets/a.py)");
    const migration = repo(null, "db/migrations/1.sql");
    const c2 = capture();
    expect(runRisk({ base: "HEAD~1" }, migration, c2.io)).toBe(0);
    expect(c2.out()).toBe("🔴 High: database migrations or schema (db/migrations/1.sql)\n");
  });

  test("risk with a base that does not exist is exit 2 and says how to fix it", () => {
    const c = capture();
    expect(runRisk({ base: "origin/main" }, repo(null, "a.py"), c.io)).toBe(2);
    expect(c.err()).toContain("pass --base <ref> if origin/main does not exist");
    expect(c.out()).toBe("");
  });

  test("risk and strip never read .github/pr-template.json", () => {
    const dir = repo(null, "docs/a.md");
    put(dir, ".github/pr-template.json", "{ not json");
    const c = capture();
    expect(runRisk({ base: "HEAD~1" }, dir, c.io)).toBe(0);
    put(dir, "body.md", "## What\n<!-- gone -->\nx\n");
    const s = capture();
    expect(runStrip({ file: "body.md" }, dir, s.io)).toBe(0);
    expect(s.out()).toBe("## What\nx\n");
  });
});

describe("check a pull request", () => {
  const BASE = "acme/widgets";
  const view = (over: Record<string, unknown> = {}) =>
    ok(JSON.stringify({
      title: TITLE,
      body: validBody({ risk: "🟢 Low, docs only" }),
      headRefOid: HEAD,
      baseRefName: "main",
      commits: [{ messageHeadline: "docs: describe the format", messageBody: "" }],
      files: [{ path: "docs/format.md" }],
      url: `https://github.com/${BASE}/pull/7`,
      isCrossRepository: false,
      headRepository: { name: "widgets" },
      headRepositoryOwner: { login: "acme" },
      ...over,
    }));
  const api = (repo: string, path: string, ref: string) => `repos/${repo}/contents/${path}?ref=${ref}`;
  const TEMPLATE = ".github/pr-template.json";
  const baseAnswers = (over: Record<string, CommandResult> = {}): Record<string, CommandResult> => ({
    "gh pr view 7": view(),
    "gh pr diff 7": ok("diff --git a/docs/format.md b/docs/format.md\n@@ -1 +1 @@\n-a\n+b\n"),
    [api(BASE, TEMPLATE, HEAD)]: notFound,
    [api(BASE, TEMPLATE, "main")]: notFound,
    [api(BASE, ".github/pr-risk.toml", "main")]: notFound,
    ...over,
  });
  const check = (answers: Record<string, CommandResult>, dir = tmp(), opts: { repo?: string; allowBreaking?: boolean } = {}) => {
    const f = fake(answers);
    const c = capture();
    const status = runCheck({ pr: 7, base: "origin/main", allowBreaking: false, ...opts }, dir, c.io, { run: f.run });
    return { status, out: c.out(), err: c.err(), calls: f.calls };
  };

  test("a passing pull request is exit 0", () => {
    const got = check(baseAnswers());
    expect([got.status, got.out]).toEqual([0, "ok\n"]);
    expect(got.calls[0]).toContain("gh pr view 7 --json title,body,headRefOid,baseRefName,commits,files");
  });

  test("findings are exit 1 with the earlier codes", () => {
    const body = validBody().replace("## Why\n", "");
    const got = check(baseAnswers({ "gh pr view 7": view({ body }) }));
    expect(got.status).toBe(1);
    expect(got.err).toContain("heading-missing");
    expect(got.out).toBe("");
  });

  test("the template is read at the head commit, never from the working tree", () => {
    const dir = tmp();
    put(dir, TEMPLATE, "{ this working tree file is not even JSON");
    const got = check(baseAnswers(), dir);
    expect(got.status).toBe(0);
    expect(got.calls.some((c) => c.includes(api(BASE, TEMPLATE, HEAD)))).toBe(true);

    const custom = capture();
    const dirWithValid = tmp();
    put(dirWithValid, TEMPLATE, "{}");
    const f = fake(baseAnswers({ [api(BASE, TEMPLATE, HEAD)]: ok(fixture("custom-template.json")) }));
    expect(runCheck({ pr: 7, base: "origin/main", allowBreaking: false }, dirWithValid, custom.io, { run: f.run })).toBe(1);
    expect(custom.err()).toContain("section-missing");
    expect(custom.err()).toContain("status-row-missing");
  });

  test("an invalid head JSON is exit 2 and does not fall back", () => {
    const got = check(baseAnswers({ [api(BASE, TEMPLATE, HEAD)]: ok(JSON.stringify({ drop: ["footer"] })) }));
    expect(got.status).toBe(2);
    expect(got.err).toContain("is locked");
    expect(got.out).toBe("");
    expect(check(baseAnswers({ [api(BASE, TEMPLATE, HEAD)]: ok("{ nope") })).status).toBe(2);
  });

  test("a failure that is not a missing file is exit 2", () => {
    const got = check(baseAnswers({ [api(BASE, TEMPLATE, HEAD)]: fail("gh: HTTP 502 Bad Gateway") }));
    expect(got.status).toBe(2);
    expect(got.err).toContain("failed");
  });

  test("a fork's template is read from the head repository", () => {
    const got = check(baseAnswers({
      "gh pr view 7": view({ isCrossRepository: true, headRepository: { name: "widgets-fork" }, headRepositoryOwner: { login: "someone" } }),
      [api("someone/widgets-fork", TEMPLATE, HEAD)]: notFound,
    }));
    expect(got.status).toBe(0);
    expect(got.calls.some((c) => c.includes(api("someone/widgets-fork", TEMPLATE, HEAD)))).toBe(true);
    expect(got.calls.some((c) => c.includes(api(BASE, TEMPLATE, HEAD)))).toBe(false);
  });

  test("--repo goes to every gh call", () => {
    const got = check(baseAnswers(), tmp(), { repo: BASE });
    expect(got.status).toBe(0);
    expect(got.calls.filter((c) => c.startsWith("gh pr "))).toEqual([expect.stringContaining("--repo acme/widgets"), expect.stringContaining("--repo acme/widgets")]);
  });

  test("the floor comes from the diff and the extension from the base branch", () => {
    const diff = ok("diff --git a/src/auth/login.ts b/src/auth/login.ts\n@@ -1 +1 @@\n-a\n+b\n");
    expect(check(baseAnswers({ "gh pr diff 7": diff })).err).toContain("risk-below-floor");
    const vault = ok("diff --git a/vault/x.py b/vault/x.py\n@@ -1 +1 @@\n-a\n+b\n");
    const withExtension = baseAnswers({ "gh pr diff 7": vault, [api(BASE, ".github/pr-risk.toml", "main")]: ok('[high]\npaths = ["^vault/"]\n') });
    expect(check(withExtension).err).toContain("risk-below-floor");
    expect(check(baseAnswers({ "gh pr diff 7": vault })).status).toBe(0);
  });

  test("a diff that cannot be read is risk-unverified unless Risk is High", () => {
    const got = check(baseAnswers({ "gh pr diff 7": fail("HTTP 406: diff too large") }));
    expect(got.status).toBe(1);
    expect(got.err).toContain("risk-unverified");
    const high = check(baseAnswers({ "gh pr diff 7": fail("HTTP 406"), "gh pr view 7": view({ body: validBody({ risk: "🔴 High, big" }) }) }));
    expect(high.status).toBe(0);
  });

  test("commit messages of the PR are scanned for the breaking-change text", () => {
    const commits = [{ messageHeadline: "fix: a", messageBody: `${BREAKING_TEXT}: b` }];
    const got = check(baseAnswers({ "gh pr view 7": view({ commits }) }));
    expect(got.status).toBe(1);
    expect(got.err).toContain("commit message 1");
    expect(check(baseAnswers({ "gh pr view 7": view({ commits }) }), tmp(), { allowBreaking: true }).status).toBe(0);
  });

  test("a PR that does not touch the template prints no comparison", () => {
    expect(check(baseAnswers()).out).toBe("ok\n");
  });

  test("a PR that changes the template says so first and tells what the base template would report", () => {
    const answers = baseAnswers({
      "gh pr view 7": view({ files: [{ path: TEMPLATE }] }),
      [api(BASE, TEMPLATE, HEAD)]: ok(fixture("custom-template.json")),
    });
    const got = check(answers);
    expect(got.status).toBe(1);
    expect(got.out.split("\n")[0]).toBe("checked against the template in this pull request");
    expect(got.out).toContain("the template on the base branch (the default, the base has no .github/pr-template.json) would report differently:");
    expect(got.out).toContain("only this pull request's template reports: section-missing");
    expect(got.err).toContain("section-missing");
  });

  test("a PR that makes the check pass says what the old template would have reported", () => {
    const body = validCustomBody();
    const answers = baseAnswers({
      "gh pr view 7": view({ body, files: [{ path: TEMPLATE }] }),
      [api(BASE, TEMPLATE, HEAD)]: ok(fixture("custom-template.json")),
    });
    const got = check(answers);
    expect(got.status).toBe(0);
    expect(got.out).toContain("checked against the template in this pull request");
    expect(got.out).toContain("only the base template reports:");
    expect(got.out.endsWith("ok\n")).toBe(true);
  });

  test("a base template that reports the same is said to", () => {
    const answers = baseAnswers({
      "gh pr view 7": view({ files: [{ path: TEMPLATE }] }),
      [api(BASE, TEMPLATE, HEAD)]: ok(JSON.stringify({ preamble: ["- [ ] a line"] })),
      [api(BASE, TEMPLATE, "main")]: ok("{}"),
    });
    const got = check(answers);
    expect(got.out).toContain("(.github/pr-template.json) would report the same.");
  });

  test("a base template that is itself invalid does not hide the check of the head", () => {
    const answers = baseAnswers({
      "gh pr view 7": view({ files: [{ path: TEMPLATE }] }),
      [api(BASE, TEMPLATE, HEAD)]: ok("{}"),
      [api(BASE, TEMPLATE, "main")]: ok("{ nope"),
    });
    const got = check(answers);
    expect(got.status).toBe(0);
    expect(got.out).toContain("the template on the base branch is not valid");
  });

  test("gh failing to show the PR is exit 2", () => {
    const got = check(baseAnswers({ "gh pr view 7": fail("could not resolve to a PullRequest") }));
    expect(got.status).toBe(2);
    expect(got.err).toContain("could not resolve to a PullRequest");
  });

  test("every gh and git call is an argument array", () => {
    const seen: string[][] = [];
    const run: CommandRunner = (cmd) => {
      seen.push(cmd);
      return fake(baseAnswers()).run(cmd);
    };
    const c = capture();
    runCheck({ pr: 7, base: "origin/main", allowBreaking: false }, tmp(), c.io, { run });
    expect(seen.length).toBeGreaterThan(3);
    for (const cmd of seen) expect(["gh", "git"]).toContain(cmd[0]!);
  });
});

describe("runStrip", () => {
  test("prints the stripped description", () => {
    const dir = tmp();
    put(dir, "body.md", "## What\n<!-- gone -->\nx\n<!-- wachiman:confidence:start -->\n");
    const c = capture();
    expect(runStrip({ file: "body.md" }, dir, c.io)).toBe(0);
    expect(c.out()).toBe("## What\nx\n<!-- wachiman:confidence:start -->\n");
  });

  test("a missing file is exit 2", () => {
    const c = capture();
    expect(runStrip({ file: "nowhere.md" }, tmp(), c.io)).toBe(2);
    expect(c.err()).toContain("cannot read nowhere.md");
  });
});

describe("exit codes", () => {
  test("0 passes, 1 findings, 2 configuration or tool problems", () => {
    const dir = tmp();
    put(dir, "body.md", validBody({ risk: "🔴 High, x" }));
    const base = { file: "body.md", title: TITLE, head: HEAD, base: "no-such-ref", allowBreaking: false };
    const deps = { run: fake(gitDown).run };
    expect(runCheck(base, dir, capture().io, deps)).toBe(0);
    expect(runCheck({ ...base, title: "feat!: x" }, dir, capture().io, deps)).toBe(1);
    put(dir, ".github/pr-template.json", "[]");
    expect(runCheck(base, dir, capture().io, deps)).toBe(2);
    expect(runCheck({ ...base, file: "nowhere.md" }, dir, capture().io, deps)).toBe(2);
  });
});
