/**
 * Personal memory (spec decision 16, AC16): the same entry format under the Wachiman home, keyed by
 * the URL of `origin`. Every Wachiman home here is a temporary directory; nothing touches a network.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyRepo, git, commit, removeTempRepos } from "../../test/support/temp-repo";
import { parseMemoryFile } from "./entries";
import { runMemory } from "./command";
import { personalMemoryDir, personalMemorySource } from "./personal";

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

/** A repository whose `origin` is a URL that is never contacted. */
function repoWithOrigin(url: string | undefined = "https://github.com/acme/widgets.git") {
  const dir = emptyRepo("wachiman-personal-");
  commit(dir, { "src/a.ts": "export const a = 1;\n" }, "seed");
  if (url) git(dir, "remote", "add", "origin", url);
  return dir;
}

function cli(dir: string, home: string, deps = {}) {
  return (...argv: string[]) => {
    let stdout = "";
    let stderr = "";
    let code: number;
    try {
      code = runMemory(argv, dir, { stdout: (t) => (stdout += t), stderr: (l) => (stderr += `${l}\n`) }, { env: { WACHIMAN_HOME: home }, now: () => new Date("2026-11-18T10:00:00Z"), deps });
    } catch (error) {
      code = 2;
      stderr += (error as Error).message;
    }
    return { code, stdout, stderr };
  };
}

describe("personalMemoryDir", () => {
  test("is <home>/memory/<host>/<owner>/<repository>, the same for https, ssh and scp-style remotes and for credentials in the URL", () => {
    const home = "/h/.wachiman";
    const want = join(home, "memory", "github.com", "acme", "widgets");
    for (const url of ["https://github.com/acme/widgets.git", "git@github.com:acme/widgets.git", "ssh://git@github.com/acme/widgets", "https://user:token@GitHub.com/acme/widgets/"]) {
      expect(personalMemoryDir(home, repoWithOrigin(url))).toBe(want);
    }
  });

  test("every worktree of a clone shares it", () => {
    const dir = repoWithOrigin();
    const other = join(temp("wachiman-wt-"), "wt");
    git(dir, "worktree", "add", "-q", "-b", "other", other);
    expect(personalMemoryDir("/h", other)).toBe(personalMemoryDir("/h", dir));
  });

  test("a clone with no origin, or a different repository, has no shared dir with another", () => {
    expect(personalMemoryDir("/h", repoWithOrigin(""))).toBeUndefined();
    expect(personalMemoryDir("/h", repoWithOrigin("https://github.com/acme/other.git"))).not.toBe(personalMemoryDir("/h", repoWithOrigin()));
  });

  test("a remote whose path would climb out of the folder is not trusted", () => {
    const dir = personalMemoryDir("/h", repoWithOrigin("https://github.com/a%2F..%2F..%2Fb/y"));
    expect(dir === undefined || dir.startsWith("/h/memory/")).toBe(true);
    expect(dir?.split("/").includes("..")).not.toBe(true);
    expect(personalMemoryDir("/h", repoWithOrigin("https://example.com/solo"))).toBeUndefined();
  });
});

describe("personalMemorySource", () => {
  test("lists and reads the plain markdown files of the folder, and has no settings of its own", () => {
    const dir = temp("wachiman-pm-");
    const s = personalMemorySource(dir);
    expect(s.list()).toEqual([]);
    expect(s.read("index.md")).toBeNull();
    expect(s.settings()).toBeUndefined();
  });
});

describe("memory propose --personal", () => {
  test("AC16: writes the shown entry under the Wachiman home with no commit and no push", () => {
    const dir = repoWithOrigin();
    const home = temp("wachiman-home-");
    const run = cli(dir, home);
    const added = run("add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "Greppable.", "--pr", "7");
    expect(added.code).toBe(0);
    const id = added.stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
    const shown = run("show", id).stdout;
    const headBefore = git(dir, "rev-parse", "HEAD");
    const refsBefore = git(dir, "for-each-ref");

    const r = run("propose", id, "--personal");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`recorded: entry ${id} in your personal memory`);

    const folder = join(home, "memory", "github.com", "acme", "widgets");
    expect(readdirSync(folder)).toEqual(["index.md"]);
    const text = readFileSync(join(folder, "index.md"), "utf8");
    expect(text).toContain(shown);
    expect(parseMemoryFile("index.md", text).entries.map((e) => e.id)).toEqual([id]);
    expect(statSync(join(folder, "index.md")).mode & 0o777).toBe(0o600);
    // Nothing in git moved and nothing is in the repository.
    expect(git(dir, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(dir, "for-each-ref")).toBe(refsBefore);
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(existsSync(join(dir, ".wachiman"))).toBe(false);
    // The candidate is marked as proposed.
    expect(run("candidates").stdout).toContain("proposed 2026-11-18");
  });

  test("proposing the same entry twice writes it once and only adds the new evidence", () => {
    const dir = repoWithOrigin();
    const home = temp("wachiman-home-");
    const run = cli(dir, home);
    const candidate = run("add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "Greppable.", "--pr", "7").stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
    expect(run("propose", candidate, "--personal").code).toBe(0);
    run("add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "Greppable.", "--pr", "9");
    const again = run("propose", candidate, "--personal");
    expect(again.code).toBe(0);
    const text = readFileSync(join(home, "memory", "github.com", "acme", "widgets", "index.md"), "utf8");
    expect(text.match(new RegExp(`### ${candidate}`, "g"))).toHaveLength(1);
    expect(text).toContain("pull request 7");
    expect(text).toContain("pull request 9");
  });

  test("a clone with no origin has no personal memory, and propose --personal says so and writes nothing", () => {
    const dir = repoWithOrigin("");
    const home = temp("wachiman-home-");
    const run = cli(dir, home);
    const id = run("add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "Greppable.", "--pr", "7").stdout.match(/candidate ([0-9a-f]{7})/)![1];
    const r = run("propose", id, "--personal");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no remote named origin");
    expect(existsSync(join(home, "memory"))).toBe(false);
  });
});
