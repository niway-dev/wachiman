/**
 * Personal memory (spec decision 16, AC16): the same entry format under the Wachiman home, keyed by
 * the URL of `origin`. Every Wachiman home here is a temporary directory; nothing touches a network.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyRepo, git, commit, removeTempRepos } from "../../test/support/temp-repo";
import { parseMemoryFile } from "./entries";
import { runMemory } from "./command";
import { repositoryKey } from "../history/store";
import { candidatesFromPersonal, personalMemoryDir, personalMemorySource, readPersonalFiles, writeMemoryChoice } from "./personal";
import { teamHasMemory } from "./propose";

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

function cli(dir: string, home: string, deps = {}, extra: { ask?: (question: string) => string | undefined } = {}) {
  return (...argv: string[]) => {
    let stdout = "";
    let stderr = "";
    let code: number;
    try {
      code = runMemory(argv, dir, { stdout: (t) => (stdout += t), stderr: (l) => (stderr += `${l}\n`) }, { env: { WACHIMAN_HOME: home }, now: () => new Date("2026-11-18T10:00:00Z"), deps, ...extra });
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

  test("nested owner groups get nested folders, so group-sub/repo and group/sub/repo never share one", () => {
    const home = "/h/.wachiman";
    const flat = personalMemoryDir(home, repoWithOrigin("https://gitlab.com/group-sub/repo.git"));
    const nested = personalMemoryDir(home, repoWithOrigin("https://gitlab.com/group/sub/repo.git"));
    expect(flat).toBe(join(home, "memory", "gitlab.com", "group-sub", "repo"));
    expect(nested).toBe(join(home, "memory", "gitlab.com", "group", "sub", "repo"));
    expect(personalMemoryDir(home, repoWithOrigin("https://gitlab.com/group/../repo.git"))).toBeUndefined();
  });

  test("is keyed by the URL as configured, so an insteadOf rewrite does not change it", () => {
    const dir = repoWithOrigin("https://github.com/acme/widgets.git");
    const before = personalMemoryDir("/h", dir);
    git(dir, "config", "url.git@github.com:.insteadOf", "https://github.com/");
    expect(personalMemoryDir("/h", dir)).toBe(before);
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

  test("a populated folder lists its plain .md files and reads them; hidden files, other extensions and folders are not memory", () => {
    const dir = temp("wachiman-pm-");
    writeFileSync(join(dir, "index.md"), "# Memory\n");
    writeFileSync(join(dir, "src.md"), "src rules\n");
    writeFileSync(join(dir, ".hidden.md"), "no\n");
    writeFileSync(join(dir, "notes.txt"), "no\n");
    mkdirSync(join(dir, "folder.md"));
    const s = personalMemorySource(dir);
    expect(s.list().sort()).toEqual(["index.md", "src.md"]);
    expect(s.read("index.md")).toBe("# Memory\n");
    expect(s.read("src.md")).toBe("src rules\n");
    expect(s.read("notes.txt")).toBeNull();
    expect(s.read("missing.md")).toBeNull();
  });

  test("an unreadable file is warned about by path and left out; the rest still loads", () => {
    if (process.getuid?.() === 0) return;
    const dir = temp("wachiman-pm-");
    writeFileSync(join(dir, "index.md"), "# Memory\n");
    writeFileSync(join(dir, "locked.md"), "secret\n");
    chmodSync(join(dir, "locked.md"), 0o000);
    const warned: string[] = [];
    const s = personalMemorySource(dir, (line) => warned.push(line));
    expect(s.list()).toEqual(["index.md"]);
    expect(s.read("locked.md")).toBeNull();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(join(dir, "locked.md"));
    expect(warned[0]).toContain("personal memory");
  });

  test("a folder that cannot be listed is warned about and has no memory", () => {
    const dir = temp("wachiman-pm-");
    const file = join(dir, "not-a-folder");
    writeFileSync(file, "x");
    const warned: string[] = [];
    expect(personalMemorySource(file, (line) => warned.push(line)).list()).toEqual([]);
    expect(warned.join("\n")).toContain(file);
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
    // The candidate is marked as kept personally, never as proposed to the team.
    const listed = run("candidates").stdout;
    expect(listed).toContain("personal 2026-11-18");
    expect(listed).not.toContain("proposed 2026-11-18");
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

describe("the first propose in a repository whose team has not adopted memory", () => {
  /** A bare origin with `main` seeded, a clone of it, and a fake for the pull-request calls. */
  function teamWorld() {
    const bare = temp("wachiman-origin-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    const seed = emptyRepo("wachiman-seed-");
    commit(seed, { "src/a.ts": "export const a = 1;\n" }, "seed");
    git(seed, "remote", "add", "origin", bare);
    git(seed, "push", "-q", "origin", "main");
    const parent = temp("wachiman-dev-");
    git(parent, "clone", "-q", bare, "repo");
    const dir = join(parent, "repo");
    git(dir, "config", "user.name", "ana");
    git(dir, "config", "user.email", "ana@example.com");
    git(dir, "config", "commit.gpgsign", "false");
    const created: string[] = [];
    const pulls = { list: () => [], createDraft: () => (created.push("pr"), "https://example.test/pr/1") };
    // A local path names no host, owner and repository, so personal memory needs a URL of origin; nothing contacts it.
    const asGithub = () => git(dir, "remote", "set-url", "origin", "https://github.com/acme/widgets.git");
    const asBare = () => git(dir, "remote", "set-url", "origin", bare);
    return { bare, dir, pulls, created, asGithub, asBare };
  }
  const NO_TEAM_MEMORY = () => false;
  const add = (run: ReturnType<typeof cli>, rule: string) => run("add", "--kind", "convention", "--scope", "src/**", "--rule", rule, "--why", "Because.", "--pr", "7").stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
  const choices = (home: string) => (existsSync(join(home, "memory-choice")) ? readdirSync(join(home, "memory-choice")).map((f) => JSON.parse(readFileSync(join(home, "memory-choice", f), "utf8"))) : []);
  const onlyMain = (bare: string) => git(bare, "branch", "--list").trim() === "main" || git(bare, "branch", "--list").trim() === "* main";

  test("without a way to ask, and without --personal or --team, it refuses and pushes nothing", () => {
    const w = teamWorld();
    const home = temp("wachiman-home-");
    const run = cli(w.dir, home, { teamMemory: NO_TEAM_MEMORY, pulls: w.pulls });
    const r = run("propose", add(run, "Prefer named exports."));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("has no .wachiman/memory/");
    expect(r.stderr).toContain("--personal");
    expect(r.stderr).toContain("--team");
    expect(onlyMain(w.bare)).toBe(true);
    expect(w.created).toEqual([]);
    expect(existsSync(join(home, "memory"))).toBe(false);
    expect(choices(home)).toEqual([]);
  }, 30_000);

  test("asked, a personal answer is stored and the next propose uses it without asking again", () => {
    const w = teamWorld();
    w.asGithub();
    const home = temp("wachiman-home-");
    const asked: string[] = [];
    const run = cli(w.dir, home, { teamMemory: NO_TEAM_MEMORY, pulls: w.pulls }, { ask: (q) => (asked.push(q), "1") });
    const first = run("propose", add(run, "Prefer named exports."));
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("in your personal memory");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/1\b.*personal/s);
    expect(asked[0]).toMatch(/2\b.*team/s);
    expect(choices(home)).toMatchObject([{ choice: "personal" }]);
    expect(onlyMain(w.bare)).toBe(true);

    const second = run("propose", add(run, "Keep modules small."));
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("in your personal memory");
    expect(asked).toHaveLength(1);
    expect(onlyMain(w.bare)).toBe(true);
  }, 30_000);

  test("asked, a team answer is stored and the entry goes to the team's memory branch", () => {
    const w = teamWorld();
    const home = temp("wachiman-home-");
    const run = cli(w.dir, home, { teamMemory: NO_TEAM_MEMORY, pulls: w.pulls }, { ask: () => "2" });
    const r = run("propose", add(run, "Prefer named exports."));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("on wachiman/memory");
    expect(git(w.bare, "branch", "--list").includes("wachiman/memory")).toBe(true);
    expect(choices(home)).toMatchObject([{ choice: "team" }]);
    expect(existsSync(join(home, "memory"))).toBe(false);
  }, 30_000);

  test("an answer that is neither option writes and stores nothing", () => {
    const w = teamWorld();
    const home = temp("wachiman-home-");
    const run = cli(w.dir, home, { teamMemory: NO_TEAM_MEMORY, pulls: w.pulls }, { ask: () => "maybe" });
    const r = run("propose", add(run, "Prefer named exports."));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--personal");
    expect(onlyMain(w.bare)).toBe(true);
    expect(choices(home)).toEqual([]);
    expect(existsSync(join(home, "memory"))).toBe(false);
  }, 30_000);

  test("--personal and --team never ask, and do not store an answer", () => {
    const w = teamWorld();
    const home = temp("wachiman-home-");
    const run = cli(w.dir, home, { teamMemory: NO_TEAM_MEMORY, pulls: w.pulls }, { ask: () => { throw new Error("must not ask"); } });
    w.asGithub();
    expect(run("propose", add(run, "Prefer named exports."), "--personal").code).toBe(0);
    expect(onlyMain(w.bare)).toBe(true);
    w.asBare();
    expect(run("propose", add(run, "Keep modules small."), "--team").code).toBe(0);
    expect(git(w.bare, "branch", "--list").includes("wachiman/memory")).toBe(true);
    expect(choices(home)).toEqual([]);
    expect(run("propose", add(run, "Third rule."), "--personal", "--team").code).toBe(2);
  }, 30_000);

  test("a remembered personal answer yields to the team once the repository has team memory, and says so", () => {
    const w = teamWorld();
    const home = temp("wachiman-home-");
    const remember = () => writeMemoryChoice(home, repositoryKey(w.dir).key, "personal", new Date("2026-11-01T00:00:00Z"));
    const noAsk = { ask: () => { throw new Error("must not ask"); } };

    // The team has not adopted memory yet: the remembered answer holds.
    const solo = cli(w.dir, home, { teamMemory: NO_TEAM_MEMORY, pulls: w.pulls }, noAsk);
    w.asGithub();
    remember();
    const first = solo("propose", add(solo, "Prefer named exports."));
    expect(first.stdout).toContain("in your personal memory");

    // The team adopted it: a plain propose goes to the team and says so in one line.
    w.asBare();
    remember();
    const after = cli(w.dir, home, { teamMemory: () => true, pulls: w.pulls }, noAsk);
    const r = after("propose", add(after, "Keep modules small."));
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("in your personal memory");
    expect(r.stdout).toContain("on wachiman/memory");
    expect(r.stdout.split("\n").filter((l) => l.includes("now has .wachiman/memory/"))).toHaveLength(1);
    expect(git(w.bare, "branch", "--list").includes("wachiman/memory")).toBe(true);

    // --personal still works explicitly.
    w.asGithub();
    const explicit = after("propose", add(after, "Third rule."), "--personal");
    expect(explicit.code).toBe(0);
    expect(explicit.stdout).toContain("in your personal memory");
  }, 30_000);

  test("a repository whose default branch already has memory is not asked", () => {
    const w = teamWorld();
    const home = temp("wachiman-home-");
    const run = cli(w.dir, home, { teamMemory: () => true, pulls: w.pulls }, { ask: () => { throw new Error("must not ask"); } });
    expect(run("propose", add(run, "Prefer named exports.")).code).toBe(0);
    expect(git(w.bare, "branch", "--list").includes("wachiman/memory")).toBe(true);
  }, 30_000);
});

describe("memory propose --from-personal", () => {
  function worldWithPersonal() {
    const bare = temp("wachiman-origin-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    const seed = emptyRepo("wachiman-seed-");
    commit(seed, { "src/a.ts": "export const a = 1;\n" }, "seed");
    git(seed, "remote", "add", "origin", bare);
    git(seed, "push", "-q", "origin", "main");
    const parent = temp("wachiman-dev-");
    git(parent, "clone", "-q", bare, "repo");
    const dir = join(parent, "repo");
    git(dir, "config", "user.name", "ana");
    git(dir, "config", "user.email", "ana@example.com");
    git(dir, "config", "commit.gpgsign", "false");
    const home = temp("wachiman-home-");
    const created: string[] = [];
    const pulls = { list: () => (created.length > 0 ? [{ number: 1, state: "OPEN" as const, url: "https://example.test/pr/1" }] : []), createDraft: () => (created.push("pr"), "https://example.test/pr/1") };
    const run = cli(dir, home, { teamMemory: () => false, pulls });
    // Personal entries are written under a GitHub-shaped origin, then origin points at the bare repository for the push.
    git(dir, "remote", "set-url", "origin", "https://github.com/acme/widgets.git");
    // Git still reaches the bare repository through a rewrite, as on a machine that rewrites https to ssh; the personal folder is keyed by the URL as written.
    git(dir, "config", `url.${bare}.insteadOf`, "https://github.com/acme/widgets.git");
    const ids = ["Prefer named exports.", "Keep modules small."].map((rule, i) => {
      const id = run("add", "--kind", "convention", "--scope", "src/**", "--rule", rule, "--why", "Because.", "--pr", String(7 + i)).stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
      expect(run("propose", id, "--personal").code).toBe(0);
      return id;
    });
    const personalFile = join(home, "memory", "github.com", "acme", "widgets", "index.md");
    return { bare, dir, home, run, ids, created, personalFile };
  }
  const memoryLog = (bare: string) => git(bare, "log", "--format=%s", "refs/heads/wachiman/memory").trim().split("\n");

  test("sends every personal entry to the team's memory branch, one commit each, with the text and evidence as personal memory has them", () => {
    const w = worldWithPersonal();
    const personalText = readFileSync(w.personalFile, "utf8");
    const r = w.run("propose", "--from-personal");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(memoryLog(w.bare)).toHaveLength(3); // seed + one commit per entry
    const team = git(w.bare, "show", "refs/heads/wachiman/memory:.wachiman/memory/index.md");
    for (const id of w.ids) expect(team).toContain(`### ${id}`);
    expect(team).toContain("pull request 7");
    expect(team).toContain("pull request 8");
    expect(parseMemoryFile("index.md", team).problems).toEqual([]);
    expect(w.created).toEqual(["pr"]);
    // Personal memory is left as it was: a committed copy wins at load time, so nothing is lost or doubled.
    expect(readFileSync(w.personalFile, "utf8")).toBe(personalText);
    // The local candidates are marked as proposed, as after a team propose.
    const json = JSON.parse(w.run("candidates", "--format", "json").stdout);
    for (const c of json.candidates) expect(c.proposed).toBe("2026-11-18T10:00:00.000Z");
  }, 60_000);

  test("a candidate whose mark cannot be saved after the send is reported, and the send still succeeds", () => {
    const w = worldWithPersonal();
    // A lock held by a live run on one candidate makes its mark fail, as for a team propose.
    mkdirSync(join(w.home, "memory-candidates", readdirSync(join(w.home, "memory-candidates"))[0]!, `${w.ids[0]}.lock`));
    const r = w.run("propose", "--from-personal");
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`the entry was recorded, but candidate ${w.ids[0]} could not be marked as proposed`);
    const team = git(w.bare, "show", "refs/heads/wachiman/memory:.wachiman/memory/index.md");
    for (const id of w.ids) expect(team).toContain(`### ${id}`);
    const json = JSON.parse(w.run("candidates", "--format", "json").stdout);
    expect(json.candidates.find((c: { id: string }) => c.id === w.ids[1]).proposed).toBe("2026-11-18T10:00:00.000Z");
  }, 60_000);

  test("with ids it sends only those, and an id that is not in personal memory is a usage error", () => {
    const w = worldWithPersonal();
    const bad = w.run("propose", "--from-personal", "0000000");
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("0000000");
    expect(git(w.bare, "branch", "--list").includes("wachiman/memory")).toBe(false);
    const r = w.run("propose", "--from-personal", w.ids[1]);
    expect(r.code).toBe(0);
    const team = git(w.bare, "show", "refs/heads/wachiman/memory:.wachiman/memory/index.md");
    expect(team).toContain(`### ${w.ids[1]}`);
    expect(team).not.toContain(`### ${w.ids[0]}`);
  }, 60_000);

  test("with no personal memory it says so and writes nothing", () => {
    const dir = repoWithOrigin();
    const run = cli(dir, temp("wachiman-home-"), { teamMemory: () => true });
    const r = run("propose", "--from-personal");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no personal memory");
  });

  test("it cannot be combined with --personal or --team", () => {
    const dir = repoWithOrigin();
    const run = cli(dir, temp("wachiman-home-"));
    expect(run("propose", "--from-personal", "--personal").code).toBe(2);
    expect(run("propose", "--from-personal", "--team").code).toBe(2);
  });
});

describe("teamHasMemory against a real origin", () => {
  function origin(files: Record<string, string>) {
    const bare = temp("wachiman-origin-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    const seed = emptyRepo("wachiman-seed-");
    commit(seed, files, "seed");
    git(seed, "remote", "add", "origin", bare);
    git(seed, "push", "-q", "origin", "main");
    const parent = temp("wachiman-dev-");
    git(parent, "clone", "-q", bare, "repo");
    return join(parent, "repo");
  }

  test("a default branch whose .wachiman/memory/ holds only index.md has memory", () => {
    expect(teamHasMemory(origin({ "src/a.ts": "a\n", ".wachiman/memory/index.md": "# Memory\n" }))).toBe(true);
  });

  test("a default branch with no .wachiman/memory/ has none", () => {
    expect(teamHasMemory(origin({ "src/a.ts": "a\n" }))).toBe(false);
  });

  test("a file named like the folder is not memory", () => {
    expect(teamHasMemory(origin({ ".wachiman/memory": "not a folder\n" }))).toBe(false);
  });

  test("an unreachable origin is unknown, not false", () => {
    expect(teamHasMemory(repoWithOrigin("/nonexistent/origin.git"))).toBeUndefined();
  });
});

describe("first-propose routing branches", () => {
  const setup = () => {
    // The team path pushes to a local bare repository reached through an insteadOf rewrite of the GitHub-shaped origin, with a fake for `gh`: no network.
    const bare = temp("wachiman-origin-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    const seed = emptyRepo("wachiman-seed-");
    commit(seed, { "src/a.ts": "export const a = 1;\n" }, "seed");
    git(seed, "remote", "add", "origin", bare);
    git(seed, "push", "-q", "origin", "main");
    const parent = temp("wachiman-dev-");
    git(parent, "clone", "-q", bare, "repo");
    const dir = join(parent, "repo");
    git(dir, "config", "user.name", "ana");
    git(dir, "config", "user.email", "ana@example.com");
    git(dir, "config", "commit.gpgsign", "false");
    git(dir, "remote", "set-url", "origin", "https://github.com/acme/widgets.git");
    git(dir, "config", `url.${bare}.insteadOf`, "https://github.com/acme/widgets.git");
    const created: string[] = [];
    const pulls = { list: () => [], createDraft: () => (created.push("pr"), "https://example.test/pr/1") };
    const teamTaken = () => created.length === 1 && git(bare, "branch", "--list").includes("wachiman/memory");
    const home = temp("wachiman-home-");
    const key = repositoryKey(dir).key;
    const probes: number[] = [];
    const probe = (answer: boolean | undefined) => () => (probes.push(1), answer);
    const add = (run: ReturnType<typeof cli>, rule: string) => run("add", "--kind", "convention", "--scope", "src/**", "--rule", rule, "--why", "Because.", "--pr", "7").stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
    const noAsk = { ask: () => { throw new Error("must not ask"); } };
    return { dir, home, key, probes, probe, add, noAsk, pulls, teamTaken };
  };

  test("a stored team answer never probes the network and goes to the team", () => {
    const t = setup();
    writeMemoryChoice(t.home, t.key, "team", new Date("2026-11-01T00:00:00Z"));
    const run = cli(t.dir, t.home, { teamMemory: t.probe(false), pulls: t.pulls }, t.noAsk);
    const r = run("propose", t.add(run, "Prefer named exports."));
    expect(t.probes).toHaveLength(0);
    expect(r.stdout).not.toContain("in your personal memory");
    expect(t.teamTaken()).toBe(true);
  }, 30_000);

  test("an explicit flag never probes the network", () => {
    const t = setup();
    const run = cli(t.dir, t.home, { teamMemory: t.probe(true) }, t.noAsk);
    expect(run("propose", t.add(run, "Prefer named exports."), "--personal").code).toBe(0);
    expect(t.probes).toHaveLength(0);
  });

  test("a stored personal answer holds when the team state is unknown, without a line about the team", () => {
    const t = setup();
    writeMemoryChoice(t.home, t.key, "personal", new Date("2026-11-01T00:00:00Z"));
    const run = cli(t.dir, t.home, { teamMemory: t.probe(undefined) }, t.noAsk);
    const r = run("propose", t.add(run, "Prefer named exports."));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("in your personal memory");
    expect(r.stdout).not.toContain("now has .wachiman/memory/");
  });

  test("with no stored answer and an unknown team state it does not ask and takes the team path", () => {
    const t = setup();
    const run = cli(t.dir, t.home, { teamMemory: t.probe(undefined), pulls: t.pulls }, t.noAsk);
    const r = run("propose", t.add(run, "Prefer named exports."));
    expect(r.stdout).not.toContain("in your personal memory");
    expect(existsSync(join(t.home, "memory-choice"))).toBe(false);
    expect(t.teamTaken()).toBe(true);
  }, 30_000);

  test("a personal write keeps the entry proposable to the team", () => {
    const t = setup();
    const run = cli(t.dir, t.home);
    const id = t.add(run, "Prefer named exports.");
    run("propose", id, "--personal");
    const json = JSON.parse(run("candidates", "--format", "json").stdout);
    expect(json.candidates[0]).toMatchObject({ id, proposable: true, personal: "2026-11-18T10:00:00.000Z" });
    expect(json.candidates[0].proposed).toBeUndefined();
  });
});

describe("the personal folder reader", () => {
  test("without a warn callback an unreadable file throws, so a write never starts from a partial picture", () => {
    if (process.getuid?.() === 0) return;
    const dir = temp("wachiman-pm-");
    writeFileSync(join(dir, "locked.md"), "x\n");
    chmodSync(join(dir, "locked.md"), 0o000);
    expect(() => readPersonalFiles(dir)).toThrow();
  });

  test("a symbolic link and a hidden file are not memory", () => {
    const dir = temp("wachiman-pm-");
    const outside = temp("wachiman-outside-");
    writeFileSync(join(outside, "secret.md"), "outside\n");
    symlinkSync(join(outside, "secret.md"), join(dir, "link.md"));
    writeFileSync(join(dir, ".hidden.md"), "h\n");
    writeFileSync(join(dir, "index.md"), "# Memory\n");
    expect(Object.keys(readPersonalFiles(dir))).toEqual(["index.md"]);
  });

  test("propose --personal refuses a folder that is a symbolic link and writes nothing through it", () => {
    const dir = repoWithOrigin();
    const home = temp("wachiman-home-");
    const run = cli(dir, home);
    const id = run("add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "Because.", "--pr", "7").stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
    const target = temp("wachiman-target-");
    mkdirSync(join(home, "memory", "github.com", "acme"), { recursive: true });
    symlinkSync(target, join(home, "memory", "github.com", "acme", "widgets"));
    const r = run("propose", id, "--personal");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not a plain directory");
    expect(readdirSync(target)).toEqual([]);
  });
});

describe("personal files in a review and in --from-personal", () => {
  test("a personal file over the size cap is cut and named, like committed memory", () => {
    const dir = temp("wachiman-pm-");
    writeFileSync(join(dir, "index.md"), `# Memory\n${"x".repeat(70 * 1024)}\n`);
    const warned: string[] = [];
    const source = personalMemorySource(dir, (l) => warned.push(l));
    expect(source.read("index.md")!.length).toBeLessThanOrEqual(64 * 1024);
    expect(warned.join("\n")).toContain("index.md");
    expect(warned.join("\n")).toContain("64 KB");
  });

  test("a write never starts from a cut file", () => {
    const dir = temp("wachiman-pm-");
    writeFileSync(join(dir, "index.md"), `# Memory\n${"x".repeat(70 * 1024)}\n`);
    expect(readPersonalFiles(dir)["index.md"].length).toBeGreaterThan(64 * 1024);
  });

  test("--from-personal does not read archive.md, as the report does not", () => {
    const dir = repoWithOrigin();
    const home = temp("wachiman-home-");
    const run = cli(dir, home);
    const id = run("add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "Because.", "--pr", "7").stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
    expect(run("propose", id, "--personal").code).toBe(0);
    const folder = personalMemoryDir(home, dir)!;
    expect(candidatesFromPersonal(folder, []).candidates.map((c) => c.id)).toEqual([id]);
    renameSync(join(folder, "index.md"), join(folder, "archive.md"));
    expect(candidatesFromPersonal(folder, []).candidates).toEqual([]);
  });
});
