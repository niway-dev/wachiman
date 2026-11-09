import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { repositoryKey } from "../history/store";
import { fakeToolchain, type Tools } from "../../test/support/fake-toolchain";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { type AccountDeps, parseProjectArgs, parseSetupArgs, projectShow, runProject, runSetup } from "./commands";
import { readConfig, type WachimanConfigV1 } from "./config";

const scratch: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
afterAll(() => {
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }));
  removeTempRepos();
});

const NOW = "2026-11-09T12:00:00.000Z";

/** Every file under `dir` (the .git directory included) with a digest of its bytes and its mode. */
function snapshot(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) Object.assign(out, snapshot(path, `${prefix}${name}/`));
    else out[`${prefix}${name}`] = `${stat.mode}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  }
  return out;
}

interface World {
  home: string;
  env: Record<string, string>;
  repo: string;
  workDir: string;
  out: string[];
  err: string[];
  asked: string[];
  calls: ReturnType<typeof fakeToolchain>["calls"];
  deps: (extra?: AccountDeps) => AccountDeps;
  io: { stdout: (t: string) => void; stderr: (l: string) => void };
  config: () => WachimanConfigV1 | undefined;
}

/** A committed repository with an origin, a Wachiman home with one external profile, and a fake toolchain. */
function world(tools: Tools = {}, answers: ("yes" | "no" | "cancel")[] = []): World {
  const home = join(temp("wachiman-world-"), ".wachiman");
  const workDir = temp("claude-work-a-");
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n", "src/a.ts": "export const a = 1;\n" }, "init");
  git(repo, "remote", "add", "origin", "https://user:token@github.com/acme/app.git");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      version: 1,
      profiles: {
        "work-a": { kind: "external", configDir: workDir, createdAt: "t" },
        "work-b": { kind: "external", configDir: temp("claude-work-b-"), createdAt: "t" },
      },
      projects: {},
    }),
  );
  const toolchain = fakeToolchain(tools);
  const w: World = {
    home,
    env: { PATH: "/usr/bin", HOME: temp("wachiman-user-"), USER: "me", WACHIMAN_HOME: home },
    repo,
    workDir,
    out: [],
    err: [],
    asked: [],
    calls: toolchain.calls,
    deps: (extra = {}) => ({
      spawn: toolchain.spawn,
      now: () => NOW,
      interactive: false,
      ask: (q) => (w.asked.push(q), answers.shift() ?? "cancel"),
      doctor: { version: "1.9.0", install: { kind: "source", root: "/opt/wachiman" }, platform: "darwin", arch: "arm64" },
      ...extra,
    }),
    io: { stdout: (t) => w.out.push(t), stderr: (l) => w.err.push(l) },
    config() {
      const read = readConfig(home);
      return read.kind === "ok" ? read.config : undefined;
    },
  };
  return w;
}

const setup = (w: World, argv: string[], extra: AccountDeps = {}) =>
  runSetup(parseSetupArgs(argv, w.repo) as Exclude<ReturnType<typeof parseSetupArgs>, { help: true }>, w.env, w.io, w.deps(extra));
const project = (w: World, argv: string[], repoDir = w.repo, extra: AccountDeps = {}) =>
  runProject(parseProjectArgs(argv, repoDir), w.env, w.io, w.deps(extra));

describe("setup --profile", () => {
  test("writes the binding keyed by repositoryKey, with the origin stripped of credentials, and nothing under the repository changes", () => {
    const w = world();
    const before = snapshot(w.repo);
    expect(setup(w, ["--profile", "work-a"])).toBe(0);
    const repo = repositoryKey(w.repo);
    expect(repo.keyedBy).toBe("remote");
    expect(w.config()?.projects).toEqual({
      [repo.key]: { profile: "work-a", keyedBy: "remote", remote: "https://github.com/acme/app", name: "app", boundAt: NOW, boundFrom: w.repo },
    });
    expect(JSON.stringify(w.config())).not.toContain("token");
    expect(snapshot(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain(`bound: app → work-a (home config, nothing written in the repository)`);
    expect(w.err.join("\n")).toContain(`wachiman local --repo-dir ${w.repo}`);
    expect(w.err.join("\n")).not.toContain("--profile");
    // The profile entries are untouched: setup never registers or creates a profile.
    expect(Object.keys(w.config()!.profiles)).toEqual(["work-a", "work-b"]);
  });

  test("a worktree of the same origin resolves to that binding, and so does a clone elsewhere", () => {
    const w = world();
    expect(setup(w, ["--profile", "work-a"])).toBe(0);
    const tree = join(temp("wachiman-tree-"), "wt");
    git(w.repo, "worktree", "add", "-q", "-b", "other", tree);
    const shown = projectShow(tree, w.env, w.deps());
    expect(shown.binding?.profile).toBe("work-a");
    expect(shown.resolved).toMatchObject({ profile: "work-a", kind: "external", rung: "binding" });
    const clone = temp("wachiman-clone-");
    git(clone, "init", "-q");
    git(clone, "remote", "add", "origin", "https://github.com/acme/app");
    expect(projectShow(clone, w.env, w.deps()).binding?.profile).toBe("work-a");
  });

  test("a repository without an origin is keyed by its path", () => {
    const w = world();
    const lonely = emptyRepo();
    commit(lonely, { "a.txt": "x" }, "init");
    expect(runSetup({ repoDir: lonely, profile: "work-b", yes: false, json: false }, w.env, w.io, w.deps())).toBe(0);
    const key = repositoryKey(lonely).key;
    expect(w.config()?.projects[key]).toMatchObject({ profile: "work-b", keyedBy: "path", name: expect.any(String) });
    expect(w.config()?.projects[key]).not.toHaveProperty("remote");
  });

  test("without --profile and without a TTY it is exit 2 and nothing is written, not even the home", () => {
    const w = world();
    rmSync(w.home, { recursive: true });
    expect(() => setup(w, [])).toThrow(/setup needs --profile <name> when it cannot ask; run wachiman profile list/);
    expect(existsSync(w.home)).toBe(false);
    expect(w.calls).toEqual([]);
  });

  test("with a TTY but no --profile the wizard is not built yet: exit 2 and nothing is written", () => {
    const w = world();
    const before = readFileSync(join(w.home, "config.json"), "utf8");
    expect(() => setup(w, [], { interactive: true })).toThrow(UsageError);
    expect(readFileSync(join(w.home, "config.json"), "utf8")).toBe(before);
  });

  test("a name that resolves to nothing, and a repository that is not a git repository, are usage errors with no write", () => {
    const w = world();
    const before = readFileSync(join(w.home, "config.json"), "utf8");
    expect(() => setup(w, ["--profile", "ghost"])).toThrow(/not registered/);
    expect(() => runSetup({ repoDir: temp("wachiman-plain-"), profile: "work-a", yes: false, json: false }, w.env, w.io, w.deps())).toThrow(/not a git repository/);
    expect(readFileSync(join(w.home, "config.json"), "utf8")).toBe(before);
  });

  test("`default`, `isolated:<name>` over an existing managed directory, and re-running with another profile all bind", () => {
    const w = world();
    mkdirSync(join(w.home, "claude-scratch"));
    const key = repositoryKey(w.repo).key;
    expect(setup(w, ["--profile", "default"])).toBe(0);
    expect(w.config()?.projects[key].profile).toBe("default");
    expect(setup(w, ["--profile", "isolated:scratch"])).toBe(0);
    expect(w.config()?.projects[key].profile).toBe("isolated:scratch");
    expect(setup(w, ["--profile", "work-b"])).toBe(0);
    expect(w.config()?.projects[key].profile).toBe("work-b");
    expect(Object.keys(w.config()!.projects)).toEqual([key]);
  });

  test("a signed-out account still writes the binding, exits 1 and says so, with the doctor's fix", () => {
    const w = world({ auth: () => ({ status: 1, stdout: JSON.stringify({ loggedIn: false }) }) });
    expect(setup(w, ["--profile", "work-a"])).toBe(1);
    expect(w.config()?.projects[repositoryKey(w.repo).key].profile).toBe("work-a");
    const err = w.err.join("\n");
    expect(err).toContain("the binding was written");
    expect(err).toContain("wachiman profile login work-a");
    expect(err).toContain("required check(s) failed");
  });

  test("a healthy machine ends with the summary and exit 0; ANTHROPIC_API_KEY in the environment is a failed required check, reported after the write", () => {
    const w = world();
    expect(setup(w, ["--profile", "work-a"])).toBe(0);
    expect(w.err.join("\n")).toContain("All required checks passed.");
    const keyed = world();
    keyed.env.ANTHROPIC_API_KEY = "sk-ant-secret";
    expect(setup(keyed, ["--profile", "work-a"])).toBe(1);
    expect(keyed.config()?.projects[repositoryKey(keyed.repo).key].profile).toBe("work-a");
    expect(keyed.err.join("\n")).not.toContain("sk-ant-secret");
    for (const call of keyed.calls) expect(call.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("--json prints exactly one ProjectShow document on stdout and keeps the summary on stderr", () => {
    const w = world();
    expect(setup(w, ["--profile", "work-a", "--json"])).toBe(0);
    const doc = JSON.parse(w.out.join(""));
    expect(doc.format).toBe("wachiman.project/1");
    expect(doc.binding).toMatchObject({ profile: "work-a", keyedBy: "remote" });
    expect(doc.resolved).toMatchObject({ profile: "work-a", rung: "binding" });
    expect(w.err.join("\n")).toContain("All required checks passed.");
  });

  test("with a TTY and --profile it states what it will write and asks first; no and cancel write nothing, --yes does not ask", () => {
    const answers: ("yes" | "no" | "cancel")[] = ["no", "cancel", "yes"];
    const w = world({}, answers);
    const before = readFileSync(join(w.home, "config.json"), "utf8");
    expect(setup(w, ["--profile", "work-a"], { interactive: true })).toBe(0);
    expect(setup(w, ["--profile", "work-a"], { interactive: true })).toBe(130);
    expect(readFileSync(join(w.home, "config.json"), "utf8")).toBe(before);
    expect(w.asked[0]).toContain("work-a");
    expect(w.err.join("\n")).toContain("every clone and worktree of this origin will use it");
    expect(setup(w, ["--profile", "work-a"], { interactive: true })).toBe(0);
    expect(w.config()?.projects[repositoryKey(w.repo).key].profile).toBe("work-a");
    const w2 = world();
    expect(setup(w2, ["--profile", "work-a", "--yes"], { interactive: true })).toBe(0);
    expect(w2.asked).toEqual([]);
  });

  test("a planted configuration in the repository has no effect on the binding or the resolution", () => {
    const w = world();
    commit(w.repo, { ".wachiman.json": JSON.stringify({ profile: "work-b" }), ".wachiman/config.json": JSON.stringify({ profile: "work-b" }), "package.json": JSON.stringify({ wachiman: { profile: "work-b" } }) }, "plant");
    expect(setup(w, ["--profile", "work-a"])).toBe(0);
    expect(projectShow(w.repo, w.env, w.deps()).resolved).toMatchObject({ profile: "work-a", rung: "binding" });
  });
});

describe("project show", () => {
  test("--json prints ProjectShow: the identity, the binding, and the resolution with the ignored value", () => {
    const w = world();
    setup(w, ["--profile", "work-a"]);
    w.out.length = 0;
    w.env.WACHIMAN_PROFILE = "work-b";
    expect(project(w, ["show", "--json"])).toBe(0);
    const repo = repositoryKey(w.repo);
    expect(JSON.parse(w.out.join(""))).toEqual({
      format: "wachiman.project/1",
      repository: { key: repo.key, name: "app", keyedBy: "remote", remote: repo.remote, path: repo.path },
      binding: { profile: "work-a", keyedBy: "remote", remote: repo.remote, name: "app", boundAt: NOW, boundFrom: w.repo },
      resolved: { profile: "work-a", kind: "external", rung: "binding", overridden: [{ rung: "env", value: "work-b" }] },
    });
  });

  test("an unbound repository has no binding and resolves to the built-in default; a failing resolution is reported in the document, exit 0", () => {
    const w = world();
    expect(project(w, ["show", "--json"])).toBe(0);
    const doc = JSON.parse(w.out.join(""));
    expect(doc).not.toHaveProperty("binding");
    expect(doc.resolved).toMatchObject({ profile: "default", kind: "default", rung: "builtIn" });
    w.out.length = 0;
    w.env.WACHIMAN_PROFILE = "ghost";
    expect(project(w, ["show", "--json"])).toBe(0);
    expect(JSON.parse(w.out.join("")).resolved.error).toContain("ghost");
  });

  test("the text output carries the profile line the run would print", () => {
    const w = world();
    setup(w, ["--profile", "work-a"]);
    w.out.length = 0;
    project(w, ["show"]);
    const text = w.out.join("");
    expect(text).toContain("repository: app (origin https://github.com/acme/app)");
    expect(text).toContain("bound to: work-a");
    expect(text).toContain(`profile: work-a (external, ${w.workDir}; chosen by project binding)`);
  });

  test("a corrupt config and a directory that is not a repository are usage errors; nothing under the repository changes", () => {
    const w = world();
    const before = snapshot(w.repo);
    project(w, ["show"]);
    expect(snapshot(w.repo)).toEqual(before);
    expect(() => project(w, ["show"], temp("wachiman-plain-"))).toThrow(/not a git repository/);
    writeFileSync(join(w.home, "config.json"), "{");
    expect(() => project(w, ["show"])).toThrow(/corrupt/);
  });
});

describe("project unbind", () => {
  test("removes only this repository's binding after a confirm, or with --yes", () => {
    const w = world({}, ["yes"]);
    setup(w, ["--profile", "work-a"]);
    const other = emptyRepo();
    commit(other, { "a": "1" }, "init");
    runSetup({ repoDir: other, profile: "work-b", yes: false, json: false }, w.env, w.io, w.deps());
    expect(Object.keys(w.config()!.projects).length).toBe(2);
    expect(project(w, ["unbind"], w.repo, { interactive: true })).toBe(0);
    expect(w.asked[0]).toContain("work-a");
    expect(Object.keys(w.config()!.projects)).toEqual([repositoryKey(other).key]);
    expect(project(w, ["unbind", "--yes"], other)).toBe(0);
    expect(w.config()?.projects).toEqual({});
    expect(Object.keys(w.config()!.profiles)).toEqual(["work-a", "work-b"]);
  });

  test("not bound prints `not bound` and exits 0 without a write; no TTY without --yes is a usage error; no and cancel change nothing", () => {
    const w = world({}, ["no", "cancel"]);
    const before = readFileSync(join(w.home, "config.json"), "utf8");
    expect(project(w, ["unbind"])).toBe(0);
    expect(w.out.join("")).toContain("not bound");
    expect(readFileSync(join(w.home, "config.json"), "utf8")).toBe(before);
    setup(w, ["--profile", "work-a"]);
    expect(() => project(w, ["unbind"])).toThrow(/--yes/);
    expect(project(w, ["unbind"], w.repo, { interactive: true })).toBe(0);
    expect(project(w, ["unbind"], w.repo, { interactive: true })).toBe(130);
    expect(Object.keys(w.config()!.projects).length).toBe(1);
  });

  test("a binding whose profile no longer exists can still be removed (structural read)", () => {
    const w = world();
    const key = repositoryKey(w.repo).key;
    writeFileSync(
      join(w.home, "config.json"),
      JSON.stringify({ version: 1, profiles: {}, projects: { [key]: { profile: "gone", keyedBy: "path", name: "app", boundAt: "t", boundFrom: "/x" } } }),
    );
    expect(() => project(w, ["show"])).toThrow(/corrupt/);
    expect(project(w, ["unbind", "--yes"])).toBe(0);
    expect(w.config()?.projects).toEqual({});
  });
});

describe("argument parsing", () => {
  test("setup and project normalise their flags and reject what the contract does not provide", () => {
    expect(parseSetupArgs(["--profile", "x", "--yes", "--json"], "/r")).toEqual({ repoDir: "/r", profile: "x", yes: true, json: true });
    expect(parseSetupArgs([], "/r")).toEqual({ repoDir: "/r", yes: false, json: false });
    expect(parseSetupArgs(["--help"], "/r")).toEqual({ help: true });
    expect(() => parseSetupArgs(["--profile", "Bad Name"], "/r")).toThrow(UsageError);
    expect(() => parseSetupArgs(["extra"], "/r")).toThrow(UsageError);
    expect(parseProjectArgs(["show", "--json"], "/r")).toEqual({ kind: "show", repoDir: "/r", json: true });
    expect(parseProjectArgs(["unbind", "--yes"], "/r")).toEqual({ kind: "unbind", repoDir: "/r", yes: true });
    expect(parseProjectArgs(["--help"], "/r")).toEqual({ kind: "help" });
    expect(() => parseProjectArgs([], "/r")).toThrow(/subcommand/);
    expect(() => parseProjectArgs(["use", "x"], "/r")).toThrow(/Unknown project subcommand/);
    expect(() => parseProjectArgs(["show", "--yes"], "/r")).toThrow(UsageError);
  });
});
