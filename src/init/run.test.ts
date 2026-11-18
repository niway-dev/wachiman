import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { CTRL_C, ESC, scripted } from "../../test/support/scripted-prompt";
import { commit, emptyRepo, git, removeTempRepos, write } from "../../test/support/temp-repo";
import { fakeUi } from "../../test/support/fake-ui";
import { snapshotTree } from "../../test/support/tree-snapshot";
import { UsageError } from "../config";
import { parseInitFlags } from "./args";
import { readKind, settingsContent, withKind } from "./settings";
import { callerHeader, renderCallerWorkflow } from "./render";
import { POINTER_BEGIN, pointerBlock } from "./agents";
import { runInitCommand, type InitDeps } from "./run";
import { runSetupCommand } from "../setup/run";
import { readConfig } from "../accounts/config";
import { fakeToolchain } from "../../test/support/fake-toolchain";

const scratch: string[] = [];
afterAll(() => {
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }));
  removeTempRepos();
});

const NOW = "2026-11-09T12:00:00.000Z";
const template = readFileSync(join(import.meta.dir, "..", "..", "templates", "wachiman-review-caller.yml"), "utf8");
const expected = (operator: string, tag = "v1.5.0") => renderCallerWorkflow(template, { operator, tag, header: callerHeader({ version: "1.9.0", now: NOW }) });

const realFetch = globalThis.fetch;
beforeEach(() => {
  // Init makes no Wachiman-owned request (types spec section 8, invariant 10). The one network use is
  // `gh api user`, a subprocess that only suggests the operator on a terminal; it never goes through fetch.
  globalThis.fetch = (() => {
    throw new Error("init must not use the network");
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function world() {
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n" }, "init");
  const out: string[] = [];
  const err: string[] = [];
  return {
    repo,
    out,
    err,
    io: { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) },
    deps: (extra: InitDeps = {}): InitDeps => ({ now: () => NOW, version: "1.9.0", defaultWorkflowRef: "v1.5.0", interactive: false, cwd: "/elsewhere", ...extra }),
    target: join(repo, ".github", "workflows", "wachiman-review.yml"),
  };
}
type World = ReturnType<typeof world>;

const init = (w: World, argv: string[], extra: InitDeps = {}) => runInitCommand(parseInitFlags(argv, w.repo), {}, w.io, w.deps(extra));
const exit2 = async (promise: Promise<number>) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(UsageError);
  return (error as Error).message;
};

describe("init --mode github --operator me --dry-run", () => {
  test("stdout is the rendered file and nothing is written", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    const code = await init(w, ["--mode", "github", "--operator", "me", "--dry-run"]);
    expect(code).toBe(0);
    expect(w.out.join("")).toBe(expected("me"));
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });

  test("it terminates after rendering: no setup line, no prompt, even in a terminal", async () => {
    const w = world();
    const io = scripted([]);
    const code = await init(w, ["--mode", "both", "--operator", "me", "--version", "v1.5.0", "--path", ".github/workflows/wachiman-review.yml", "--project-kind", "monorepo", "--dry-run"], { interactive: true, promptIO: io, bindNow: () => Promise.reject(new Error("must not chain")) });
    expect(code).toBe(0);
    expect(w.out.join("")).toBe(expected("me"));
    expect(w.err.join("\n")).not.toContain("setup");
  });
});

describe("init --mode github without --dry-run", () => {
  test("writes the workflow with the operator and the pinned tag, and says what is left to do", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me"])).toBe(0);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(readFileSync(w.target, "utf8")).toContain('      operator: "me"\n');
    expect(statSync(w.target).mode & 0o777).toBe(0o644);
    const said = w.err.join("\n");
    expect(said).toContain("ANTHROPIC_API_KEY");
    expect(said).toContain("Open a pull request");
    expect(said).toContain("never this key");
    expect(w.out).toEqual([]);
    expect(readdirSync(join(w.repo, ".github", "workflows"))).toEqual(["wachiman-review.yml"]);
  });

  test("--version and --path are honoured", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me", "--version", "v2.0.1", "--path", ".github/workflows/review.yaml"])).toBe(0);
    expect(readFileSync(join(w.repo, ".github/workflows/review.yaml"), "utf8")).toBe(expected("me", "v2.0.1"));
  });

  test("a second run without --force exits 2 and leaves the file as it was", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    const message = await exit2(init(w, ["--mode", "github", "--operator", "someone-else"]));
    expect(message).toContain("A workflow already exists at .github/workflows/wachiman-review.yml");
    expect(message).toContain("--force");
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(readdirSync(join(w.repo, ".github", "workflows"))).toEqual(["wachiman-review.yml"]);
  });

  test("with --force a .bak-<timestamp> copy of the old file exists and the new file is written", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    expect(await init(w, ["--mode", "github", "--operator", "someone-else", "--force"])).toBe(0);
    expect(readFileSync(w.target, "utf8")).toBe(expected("someone-else"));
    const files = readdirSync(join(w.repo, ".github", "workflows")).sort();
    expect(files).toEqual(["wachiman-review.yml", "wachiman-review.yml.bak-20261109-120000"]);
    expect(readFileSync(join(w.repo, ".github/workflows/wachiman-review.yml.bak-20261109-120000"), "utf8")).toBe(expected("me"));
  });

  test("a backup never overwrites another backup", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "one"]);
    await init(w, ["--mode", "github", "--operator", "two", "--force"]);
    await init(w, ["--mode", "github", "--operator", "three", "--force"]);
    const dir = join(w.repo, ".github", "workflows");
    expect(readdirSync(dir).sort()).toEqual(["wachiman-review.yml", "wachiman-review.yml.bak-20261109-120000", "wachiman-review.yml.bak-20261109-120000-2"]);
    expect(readFileSync(join(dir, "wachiman-review.yml.bak-20261109-120000"), "utf8")).toBe(expected("one"));
    expect(readFileSync(join(dir, "wachiman-review.yml.bak-20261109-120000-2"), "utf8")).toBe(expected("two"));
  });

  test("--dry-run on an existing file still prints and exits 0, and says --force is needed", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    const before = snapshotTree(w.repo);
    expect(await init(w, ["--mode", "github", "--operator", "other", "--dry-run"])).toBe(0);
    expect(w.err.join("\n")).toContain("needs --force");
    expect(snapshotTree(w.repo)).toEqual(before);
  });

  test("a workflow directory that is a symbolic link is refused, even to a place inside the repository", async () => {
    const w = world();
    const inside = join(w.repo, "elsewhere");
    mkdirSync(inside);
    mkdirSync(join(w.repo, ".github"));
    symlinkSync(inside, join(w.repo, ".github", "workflows"));
    expect(await exit2(init(w, ["--mode", "github", "--operator", "me"]))).toContain("symbolic link");
    expect(readdirSync(inside)).toEqual([]);
  });

  test("a .github that is a symbolic link out of the repository is refused", async () => {
    const w = world();
    const outside = mkdtempSync(join(tmpdir(), "wachiman-outside-"));
    scratch.push(outside);
    symlinkSync(outside, join(w.repo, ".github"));
    expect(await exit2(init(w, ["--mode", "github", "--operator", "me"]))).toContain("symbolic link");
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a target that is a symbolic link is refused and its destination is untouched", async () => {
    const w = world();
    const outside = mkdtempSync(join(tmpdir(), "wachiman-outside-"));
    scratch.push(outside);
    writeFileSync(join(outside, "victim.yml"), "keep\n");
    mkdirSync(join(w.repo, ".github", "workflows"), { recursive: true });
    symlinkSync(join(outside, "victim.yml"), w.target);
    expect(await exit2(init(w, ["--mode", "github", "--operator", "me", "--force"]))).toContain("symbolic link");
    expect(readFileSync(join(outside, "victim.yml"), "utf8")).toBe("keep\n");
  });

  test("a target that changes between the look and the replacement is not replaced", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    const error = await init(w, ["--mode", "github", "--operator", "other", "--force"], {
      hooks: { beforeCommit: () => writeFileSync(w.target, "someone edited this meanwhile\n") },
    }).then(
      () => undefined,
      (e) => e,
    );
    expect(error).toBeInstanceOf(UsageError);
    expect(readFileSync(w.target, "utf8")).toBe("someone edited this meanwhile\n");
    expect(readdirSync(join(w.repo, ".github", "workflows")).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  test("a new file that appears between the look and the write is not overwritten", async () => {
    const w = world();
    const error = await init(w, ["--mode", "github", "--operator", "me"], { hooks: { beforeCommit: () => writeFileSync(w.target, "appeared\n") } }).then(
      () => undefined,
      (e) => e,
    );
    expect(error).toBeInstanceOf(UsageError);
    expect(readFileSync(w.target, "utf8")).toBe("appeared\n");
  });

  test("a directory that is not a git repository is exit 2", async () => {
    const w = world();
    const plain = mkdtempSync(join(tmpdir(), "wachiman-plain-"));
    scratch.push(plain);
    const error = await exit2(runInitCommand(parseInitFlags(["--mode", "github", "--operator", "me"], plain), {}, w.io, w.deps()));
    expect(error).toContain("not a git repository");
    expect(existsSync(join(plain, ".github"))).toBe(false);
  });

  test("a template that has lost an anchor is an engine error, not a usage error", async () => {
    const w = world();
    const error = await init(w, ["--mode", "github", "--operator", "me"], { readTemplate: () => "name: x\n" }).then(
      () => undefined,
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UsageError);
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });
});

describe("init --mode local", () => {
  test("writes nothing under .github, nothing at all, and prints the setup line", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, ["--mode", "local"])).toBe(0);
    // The only new file is the agent pointer (AGENTS.md); no workflow or settings file.
    const after = snapshotTree(w.repo);
    expect(Object.keys(after).filter((f) => !(f in before))).toEqual(["AGENTS.md"]);
    delete after["AGENTS.md"];
    expect(after).toEqual(before);
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
    expect(w.err.join("\n")).toContain(`wachiman setup --repo-dir ${w.repo}`);
  });

  test("the setup line is bare when the repository is the current directory", async () => {
    const w = world();
    await init(w, ["--mode", "local"], { cwd: w.repo });
    expect(w.err.join("\n")).toMatch(/: wachiman setup {3}\(/);
  });

  test("a github-only flag with --mode local is exit 2", async () => {
    const w = world();
    expect(await exit2(init(w, ["--mode", "local", "--operator", "me"]))).toContain("--operator");
  });
});

describe("init without a terminal", () => {
  test("no --mode is exit 2", async () => {
    const w = world();
    expect(await exit2(init(w, []))).toContain("--mode");
  });

  test("--mode github without --operator is exit 2, and --mode both too", async () => {
    const w = world();
    expect(await exit2(init(w, ["--mode", "github"]))).toContain("--operator");
    expect(await exit2(init(w, ["--mode", "both"]))).toContain("--operator");
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });

  test("--mode both writes the workflow, prints the setup line and never runs setup", async () => {
    const w = world();
    const code = await init(w, ["--mode", "both", "--operator", "me"], { bindNow: () => Promise.reject(new Error("setup must not run without a terminal")) });
    expect(code).toBe(0);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(w.err.join("\n")).toContain(`wachiman setup --repo-dir ${w.repo}`);
  });

  test("--yes in a terminal behaves like no terminal: no prompts", async () => {
    const w = world();
    const io = scripted([]);
    expect(await init(w, ["--mode", "github", "--operator", "me", "--yes"], { interactive: undefined, streams: { stdin: { isTTY: true }, stdout: { isTTY: true } }, promptIO: io })).toBe(0);
    expect(io.printed()).toBe("");
    expect(existsSync(w.target)).toBe(true);
  });

  test("a version that is not a tag is exit 2 and writes nothing; without a bundled ref --version is mandatory", async () => {
    const w = world();
    expect(await exit2(init(w, ["--mode", "github", "--operator", "me", "--version", "1.9.0"]))).toContain("--version");
    expect(await exit2(init(w, ["--mode", "github", "--operator", "me"], { defaultWorkflowRef: undefined }))).toContain("--version");
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });
});

describe("init with scripted prompts", () => {
  test.each(["local", "both"])("%s runs the real setup flow with one account choice and no binding confirmation", async (mode) => {
    const w = world();
    const home = mkdtempSync(join(tmpdir(), "wachiman-init-home-"));
    scratch.push(home);
    const env = { WACHIMAN_HOME: home, PATH: "/usr/bin", USER: "fixture" };
    const tools = fakeToolchain();
    const promptIO = scripted(["", "n", "", ""]); // kind, PR template (no), Write it? (both) or Write .wachiman.yml? (local), account; the binding is not asked
    const code = await runInitCommand({ repoDir: w.repo, mode, ...(mode === "both" ? { operator: "me", version: "v1.5.0", path: ".github/workflows/wachiman-review.yml" } : {}) }, env, w.io, w.deps({
      interactive: true,
      promptIO,
      bindNow: (prompter, initMode) => runSetupCommand({ repoDir: w.repo }, env, w.io, {
        interactive: true, fromInit: true, initMode, prompter, spawn: tools.spawn,
        doctor: { platform: "darwin", arch: "arm64", version: "1.9.0", install: { kind: "source", root: "/fixture" } },
      }),
    }));
    expect(code).toBe(0);
    const config = readConfig(home);
    expect(config.kind).toBe("ok");
    if (config.kind === "ok") expect(Object.values(config.config.projects)[0].profile).toBe("default");
    expect(promptIO.printed()).not.toContain("Set up this repository?");
    expect(promptIO.printed()).not.toContain("Run wachiman setup now");
    expect(promptIO.printed()).not.toMatch(/Bind .* to default\?/);
    expect(promptIO.printed()).not.toContain("Confirm binding");
    expect(promptIO.printed()).toMatch(/local reviews of .* will use the account "default"; saved in .*config\.json, nothing in the repository/);
    expect(existsSync(w.target)).toBe(mode === "both");
    expect(readFileSync(join(w.repo, ".wachiman.yml"), "utf8")).toContain("kind: monorepo\n");
    expect(promptIO.printed()).toContain(mode === "both" ? "Step 5/6  Claude account" : "Step 4/5  Claude account");
    expect(promptIO.printed()).toContain(mode === "both" ? "Step 6/6  Checks and next actions" : "Step 5/5  Checks and next actions");
    expect(w.err.join("\n")).toContain("local: ready");
    if (mode === "both") expect(w.err.join("\n").match(/github: pending/g)).toHaveLength(1);
  });

  test("an invalid Git worktree fails before asking any questions", async () => {
    const w = world();
    const plain = mkdtempSync(join(tmpdir(), "wachiman-not-git-"));
    scratch.push(plain);
    const io = scripted(["1"]);
    await expect(runInitCommand({ repoDir: plain }, {}, w.io, w.deps({ interactive: true, promptIO: io }))).rejects.toBeInstanceOf(UsageError);
    expect(io.printed()).toBe("");
  });

  test("defaults taken by Enter equal the printed defaults", async () => {
    const w = world();
    const io = scripted(["", "", "octocat", "", ""]); // kind, mode, operator, PR template, Write it?
    const code = await init(w, [], { interactive: true, promptIO: io });
    expect(code).toBe(0);
    const printed = io.printed();
    expect(printed).toMatch(/1\. In GitHub Actions on pull requests \(default\)/);
    // The tag and the workflow path are never asked: the release of this CLI and the standard path are used.
    expect(printed).not.toContain("Release tag to pin");
    expect(printed).not.toContain("Workflow file");
    expect(printed).toContain("is adopted and replaced (a backup is kept); nothing is committed. [Y/n]");
    expect(printed).toContain("Write it? [Y/n]");
    expect(printed).toMatch(/1\. Monorepo \(default\)/);
    expect(printed).toContain("3. Distributed repository (coming soon)");
    expect(printed).toContain("Step 2  Project type");
    expect(printed).toContain("Step 3  Review mode");
    expect(printed).toContain("Step 4/5  GitHub workflow");
    expect(printed).toContain("Step 5/5  Checks and next actions");
    expect(readFileSync(join(w.repo, ".wachiman.yml"), "utf8")).toContain("kind: monorepo\n");
    // What the printed defaults mean is what was written.
    expect(readFileSync(w.target, "utf8")).toBe(expected("octocat", "v1.5.0"));
    // The default of the template question is yes, and it writes the file without a commit.
    expect(existsSync(join(w.repo, ".github", "pull_request_template.md"))).toBe(true);
    expect(git(w.repo, "status", "--porcelain")).toContain(".github/");
    expect(git(w.repo, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  });

  test("the preview shows the file and whether it is new before the question", async () => {
    const w = world();
    const io = scripted(["", "1", "octocat", "n", "y"]);
    await init(w, [], { interactive: true, promptIO: io });
    expect(w.err.join("\n")).toContain("--- .github/workflows/wachiman-review.yml (new)");
    expect(w.err.join("\n")).toContain('operator: "octocat"');
  });

  test("an invalid answer is shown and asked again; flags already given are not asked", async () => {
    const w = world();
    const io = scripted(["", "bad login", "me", "n", "y"]); // kind, operator (twice), PR template, Write it?
    const code = await init(w, ["--mode", "github", "--version", "v1.5.0"], { interactive: true, promptIO: io });
    expect(code).toBe(0);
    expect(io.printed()).toContain("is not a GitHub login");
    expect(io.printed()).not.toContain("Release tag to pin");
    expect(io.printed()).not.toContain("How will Wachiman review");
    expect(readFileSync(w.target, "utf8")).toContain('operator: "me"\n');
  });

  test("a bad value given on the command line is exit 2 before any question", async () => {
    const w = world();
    const io = scripted(["1"]);
    expect(await exit2(init(w, ["--operator", "-bad"], { interactive: true, promptIO: io }))).toContain("operator");
    expect(io.printed()).toBe("");
  });

  test.each([
    ["Escape", ESC],
    ["Ctrl-C", CTRL_C],
  ])("%s at the first question exits 130 and writes nothing", async (_n, key) => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, [], { interactive: true, promptIO: scripted([key]) })).toBe(130);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain("cancelled: nothing was written");
  });

  test("Ctrl-D (the input ends) at the Write it? question exits 130 and writes nothing", async () => {
    const w = world();
    const io = scripted(["", "1", "me", "n"]); // kind, mode, operator, PR template: the input ends at Write it?
    expect(await init(w, [], { interactive: true, promptIO: io })).toBe(130);
    expect(io.printed()).toContain("Write it?");
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });

  test.each([
    ["Escape", ESC],
    ["Ctrl-C", CTRL_C],
  ])("%s at the PR template question exits 130 and writes nothing, after the mode and the workflow answers", async (_n, key) => {
    const w = world();
    const before = snapshotTree(w.repo);
    const io = scripted(["", "1", "me", key]); // kind, mode, operator, PR template (cancelled)
    expect(await init(w, [], { interactive: true, promptIO: io })).toBe(130);
    expect(io.printed()).toContain("PR description template");
    expect(io.printed()).not.toContain("Write it?");
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain("cancelled: nothing was written");
  });

  test("Escape at the PR template question in local mode exits 130 and writes nothing", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, [], { interactive: true, promptIO: scripted(["", "2", ESC]) })).toBe(130);
    expect(snapshotTree(w.repo)).toEqual(before);
  });

  test("answering no to Write it? writes nothing and exits 0", async () => {
    const w = world();
    expect(await init(w, [], { interactive: true, promptIO: scripted(["", "1", "me", "n", "n"]) })).toBe(0);
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
    expect(w.err.join("\n")).toContain("not written");
  });

  test("a re-run that would write the same workflow says it is unchanged and asks nothing about it", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    const before = readFileSync(w.target, "utf8");
    const io = scripted(["", "1", "me", "n", ""]); // kind, mode, operator, PR template, Write .wachiman.yml?
    expect(await init(w, [], { interactive: true, promptIO: io })).toBe(0);
    expect(w.err.join("\n")).toContain("is unchanged");
    expect(io.printed()).not.toContain("Replace the existing workflow?");
    expect(io.printed()).not.toContain("Write it?");
    expect(readFileSync(w.target, "utf8")).toBe(before);
    expect(readdirSync(join(w.repo, ".github", "workflows"))).toEqual(["wachiman-review.yml"]);
  });

  test("a re-run that differs shows the new file and asks to replace; yes keeps a .bak copy, no keeps the file", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    const io = scripted(["", "1", "other", "n", "y"]); // kind, mode, operator, PR template, Replace?
    expect(await init(w, [], { interactive: true, promptIO: io })).toBe(0);
    expect(io.printed()).toContain("Replace the existing workflow? A .bak copy is kept. [Y/n]");
    expect(w.err.join("\n")).toContain("would overwrite");
    expect(readFileSync(w.target, "utf8")).toBe(expected("other"));
    expect(readdirSync(join(w.repo, ".github", "workflows")).filter((f) => f.includes(".bak-"))).toHaveLength(1);

    const w2 = world();
    await init(w2, ["--mode", "github", "--operator", "me"]);
    expect(await init(w2, [], { interactive: true, promptIO: scripted(["", "1", "other", "n", "n"]) })).toBe(0);
    expect(readFileSync(w2.target, "utf8")).toBe(expected("me"));
  });

  test("without a terminal, an existing different workflow still needs --force, and an identical one is unchanged", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    expect(await exit2(init(w, ["--mode", "github", "--operator", "other"]))).toContain("--force");
    expect(await init(w, ["--mode", "github", "--operator", "me"])).toBe(0);
    expect(w.err.join("\n")).toContain("is unchanged");
  });

  test("the operator defaults to the signed-in gh user, and nothing about the tag or the path is asked", async () => {
    const w = world();
    const io = scripted(["", "1", "", "n", ""]); // kind, mode, operator (Enter takes the default), PR template, Write it?
    expect(await init(w, [], { interactive: true, promptIO: io, githubLogin: () => "octocat" })).toBe(0);
    expect(io.printed()).toContain("Your GitHub username");
    expect(io.printed()).toContain("[octocat]");
    expect(io.printed()).not.toContain("Release tag to pin");
    expect(io.printed()).not.toContain("Workflow file");
    expect(readFileSync(w.target, "utf8")).toBe(expected("octocat"));
  });

  test("without gh, or with a login that is not valid, the operator has no default", async () => {
    for (const githubLogin of [() => undefined, () => "not a login!"]) {
      const w = world();
      const io = scripted(["", "1", "me", "n", ""]);
      expect(await init(w, [], { interactive: true, promptIO: io, githubLogin })).toBe(0);
      expect(io.printed()).not.toMatch(/octocat|not a login/);
      expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    }
  });

  test("the tag is asked only when this build has no default release", async () => {
    const w = world();
    const io = scripted(["", "1", "me", "v1.6.0", "n", ""]); // kind, mode, operator, tag, PR template, Write it?
    expect(await init(w, [], { interactive: true, promptIO: io, defaultWorkflowRef: undefined })).toBe(0);
    expect(io.printed()).toContain("Release tag to pin");
    expect(readFileSync(w.target, "utf8")).toBe(expected("me", "v1.6.0"));
  });

  test("local mode enters setup directly without another invitation", async () => {
    const w = world();
    const io = scripted(["", "2", "n", "", "from-setup"]);
    let got: string | null | undefined;
    const code = await init(w, [], { interactive: true, promptIO: io, bindNow: async (p) => {
      got = await p.text("Setup asks", undefined);
      return 0;
    } });
    expect(code).toBe(0);
    expect(got).toBe("from-setup");
    expect(existsSync(w.target)).toBe(false);
    expect(readFileSync(join(w.repo, ".wachiman.yml"), "utf8")).toContain("kind: monorepo\n");
    expect(w.err.join("\n")).toContain("Commit .wachiman.yml");
    expect(io.printed()).not.toContain("Run wachiman setup now");
  });

  test("both: setup runs in the same process, sharing the prompt session", async () => {
    const w = world();
    const io = scripted(["", "3", "me", "n", "", "from-setup"]);
    let got: string | null | undefined;
    const code = await init(w, [], {
      interactive: true,
      promptIO: io,
      bindNow: async (prompter) => {
        got = await prompter.text("Setup asks", undefined);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(got).toBe("from-setup");
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
  });

  test("both: setup hands the session a closing slot, and a failed sign-in keeps the exit code 1", async () => {
    const w = world();
    const io = scripted(["", "3", "me", "n", ""]);
    let slot: { warning?: string } | undefined;
    const code = await init(w, [], { interactive: true, promptIO: io, bindNow: async (_p, _m, closing) => {
      slot = closing;
      closing.warning = "Saved. One step left: sign in to Claude (`claude auth login`), then run `wachiman init` again or `wachiman doctor`.";
      return 1;
    } });
    expect(code).toBe(1);
    expect(slot?.warning).toContain("One step left");
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
  });

  test.each(["both", "local"] as const)("%s: a terminal session ends on the neutral warning, never on \"Stopped.\"", async (mode) => {
    const w = world();
    const ui = fakeUi([0, true, true, true]); // project kind, then the confirmations (workflow, settings)
    const warning = "Saved. One step left: sign in to Claude (`claude auth login`), then run `wachiman init` again or `wachiman doctor`.";
    const code = await runInitCommand(
      { repoDir: w.repo, mode, ...(mode === "both" ? { operator: "me", version: "v1.5.0", path: ".github/workflows/wachiman-review.yml" } : {}) },
      { WACHIMAN_INTRO_DONE: "1" },
      w.io,
      w.deps({ interactive: true, promptIO: { input: new PassThrough(), output: new PassThrough() }, ui, bindNow: async (_p, _m, closing) => {
        closing.warning = warning;
        return 1;
      } }),
    );
    expect(code).toBe(1);
    // What the session finally drew: the neutral text is the last event, as an outro, and nothing says "Stopped.".
    expect(ui.events.at(-1)).toEqual({ kind: "outro", message: warning });
    expect(ui.of("cancel")).toEqual([]);
    expect(JSON.stringify(ui.events)).not.toContain("Stopped.");
  });

  test("both: cancelling during setup leaves the confirmed workflow in place and says so", async () => {
    const w = world();
    const io = scripted(["", "3", "me", "n", ""]);
    const code = await init(w, [], { interactive: true, promptIO: io, bindNow: async () => 130 });
    expect(code).toBe(130);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(w.err.join("\n")).toContain(".github/workflows/wachiman-review.yml was written before setup was cancelled and stays in place");
  });

  test("both: a setup failure reports the completed workflow write", async () => {
    const w = world();
    const io = scripted(["", "3", "me", "n", ""]);
    const code = await exit2(init(w, [], { interactive: true, promptIO: io, bindNow: async () => { throw new UsageError("setup failed"); } }));
    expect(code).toContain("setup failed");
    expect(existsSync(w.target)).toBe(true);
    expect(w.err.join("\n")).toContain(".github/workflows/wachiman-review.yml was written before setup failed and stays");
    expect(w.err.join("\n")).not.toMatch(/rolled back|removed/);
  });
});

describe("init from a subdirectory of the repository", () => {
  test("a linked worktree gets its own workflow, leaving the original worktree untouched", async () => {
    const w = world();
    const linked = mkdtempSync(join(tmpdir(), "wachiman-linked-"));
    scratch.push(linked);
    git(w.repo, "worktree", "add", "--detach", linked, "HEAD");
    expect(await runInitCommand({ repoDir: linked, mode: "github", operator: "me" }, {}, w.io, w.deps())).toBe(0);
    expect(existsSync(join(linked, ".github/workflows/wachiman-review.yml"))).toBe(true);
    expect(existsSync(w.target)).toBe(false);
  });

  test("the workflow lands under the repository top level, never under the subdirectory", async () => {
    const w = world();
    const sub = join(w.repo, "sub");
    mkdirSync(sub);
    const argv = ["--mode", "github", "--operator", "me", "--version", "v1.5.0"];
    expect(await runInitCommand(parseInitFlags(argv, sub), {}, w.io, w.deps())).toBe(0);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(existsSync(join(sub, ".github"))).toBe(false);
  });
});

describe("init and the PR description template", () => {
  const TEMPLATE = ".github/pull_request_template.md";
  const stamped = (w: World) => readFileSync(join(w.repo, TEMPLATE), "utf8").includes("wachiman:pr-template version=1");
  const commits = (w: World) => git(w.repo, "log", "--oneline").trim().split("\n").length;

  test("without --pr-template a script gets no template, and no new file beyond the workflow", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me"])).toBe(0);
    expect(existsSync(join(w.repo, TEMPLATE))).toBe(false);
    expect(w.err.join("\n")).not.toContain("pull_request_template");
    // Nothing but the workflow was created: no template, no pr-template.json, no backup.
    expect(readdirSync(join(w.repo, ".github")).sort()).toEqual(["workflows"]);
    expect(readdirSync(join(w.repo, ".github", "workflows")).sort()).toEqual(["wachiman-review.yml"]);
  });

  test("--no-pr-template is the same as saying nothing", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me", "--no-pr-template"])).toBe(0);
    expect(existsSync(join(w.repo, TEMPLATE))).toBe(false);
  });

  test("--pr-template installs it after the workflow and never commits", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me", "--pr-template"])).toBe(0);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(stamped(w)).toBe(true);
    expect(commits(w)).toBe(1);
    const said = w.err.join("\n");
    expect(said.indexOf("wrote .github/workflows/wachiman-review.yml")).toBeLessThan(said.indexOf(`wrote ${TEMPLATE}`));
    expect(w.out).toEqual([]);
  });

  test("--mode local --pr-template installs the template and nothing else", async () => {
    const w = world();
    expect(await init(w, ["--mode", "local", "--pr-template"])).toBe(0);
    expect(stamped(w)).toBe(true);
    expect(existsSync(join(w.repo, ".github", "workflows"))).toBe(false);
    expect(w.err.join("\n")).toContain("wachiman setup");
  });

  test("a hand-edited template is reported and does not fail the rest of init", async () => {
    const w = world();
    expect(await init(w, ["--mode", "local", "--pr-template"])).toBe(0);
    writeFileSync(join(w.repo, TEMPLATE), `${readFileSync(join(w.repo, TEMPLATE), "utf8")}\nedited by hand\n`);
    w.err.length = 0;
    expect(await init(w, ["--mode", "github", "--operator", "me", "--pr-template"])).toBe(0);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(readFileSync(join(w.repo, TEMPLATE), "utf8")).toContain("edited by hand");
    expect(w.err.join("\n")).toContain("pr-template: not installed:");
    expect(w.err.join("\n")).toContain("was edited by hand");
  });

  test("an invalid .github/pr-template.json is reported, not fatal", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"), { recursive: true });
    writeFileSync(join(w.repo, ".github", "pr-template.json"), "{ not json");
    expect(await init(w, ["--mode", "github", "--operator", "me", "--pr-template"])).toBe(0);
    expect(existsSync(w.target)).toBe(true);
    expect(existsSync(join(w.repo, TEMPLATE))).toBe(false);
    expect(w.err.join("\n")).toContain("pr-template: not installed:");
  });

  test("any other error while installing the template is reported too, and init carries on", async () => {
    const w = world();
    const hooks = {
      beforeCommit: () => {
        throw new Error("disk went away");
      },
    };
    expect(await init(w, ["--mode", "github", "--operator", "me", "--pr-template"], { prTemplate: { hooks } })).toBe(0);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(w.err.join("\n")).toContain("pr-template: not installed: disk went away");
    expect(w.err.join("\n")).toContain("github: pending;");
  });

  test("when only part of the install failed, the report says what was written and what was not", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"), { recursive: true });
    writeFileSync(join(w.repo, TEMPLATE), "- [ ] I read the contributing guide.\n");
    let writes = 0;
    const hooks = {
      beforeCommit: () => {
        if (++writes === 2) throw new Error("disk went away");
      },
    };
    expect(await init(w, ["--mode", "github", "--operator", "me", "--pr-template"], { prTemplate: { hooks } })).toBe(0);
    const said = w.err.join("\n");
    expect(existsSync(join(w.repo, ".github", "pr-template.json"))).toBe(true);
    expect(said).not.toContain("pr-template: not installed:");
    expect(said).toContain("pr-template: only part of the install was done: disk went away");
    expect(said).toContain("written: .github/pr-template.json");
    expect(said).toContain("not written: .github/pull_request_template.md");
    expect(said).toContain("github: pending;");
  });

  test("--dry-run installs nothing and says why", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, ["--mode", "github", "--operator", "me", "--dry-run", "--pr-template"])).toBe(0);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain("PR description template is not installed");
  });

  test("declining the workflow does not stop an asked-for template", async () => {
    const w = world();
    const io = scripted(["", "1", "me", "y", "n"]); // kind, mode, operator, PR template, Write it?
    expect(await init(w, [], { interactive: true, promptIO: io })).toBe(0);
    expect(existsSync(w.target)).toBe(false);
    expect(stamped(w)).toBe(true);
  });

  test("the two flags together are exit 2", () => {
    expect(() => parseInitFlags(["--mode", "local", "--pr-template", "--no-pr-template"], ".")).toThrow(UsageError);
  });
});

describe("the repository settings file .wachiman.yml", () => {
  const settingsFile = (w: World) => join(w.repo, ".wachiman.yml");
  const baseArgs = ["--mode", "github", "--operator", "me", "--version", "v1.5.0"];

  test("a new file has the explanatory comments, the kind, and model, effort and paths commented out, and the next steps name it", async () => {
    const w = world();
    expect(await init(w, [...baseArgs, "--project-kind", "monorepo"])).toBe(0);
    expect(readFileSync(settingsFile(w), "utf8")).toBe(
      [
        "# Wachiman settings for this repository, written by `wachiman init`. Commit it like any file.",
        '# kind: the shape of the repository, "monorepo" or "single". Metadata only for now.',
        "kind: monorepo",
        "",
        "# Optional. Wachiman's defaults are what its benchmarks measure; change them knowing that.",
        "# model: claude-sonnet-5-5",
        "# effort: high",
        "",
        "# Optional. Path rules: files a rule matches are read first, the review quotes your reason, and for",
        "# critical and high it says a person should approve the change. Wachiman never approves or blocks.",
        "# Rules are read from the base branch, so a pull request cannot change its own rules.",
        "# Inspired by the Claude Code team's review process:",
        "# https://claude.dev/blog/solving-code-review-at-anthropic/#the-life-of-a-change",
        "# paths:",
        '#   - match: ".github/workflows/**"',
        "#     severity: critical",
        "#     reason: CI can publish releases and read secrets",
        "",
      ].join("\n"),
    );
    expect(statSync(settingsFile(w)).mode & 0o777).toBe(0o644);
    expect(readdirSync(join(w.repo, ".github"))).toEqual(["workflows"]);
    expect(existsSync(settingsFile(w))).toBe(true);
    expect(w.err.join("\n")).toContain("Open a pull request that adds .github/workflows/wachiman-review.yml and .wachiman.yml.");
  });

  test("local mode writes only the settings file and tells the person to commit it", async () => {
    const w = world();
    expect(await init(w, ["--mode", "local", "--project-kind", "single"])).toBe(0);
    expect(readFileSync(settingsFile(w), "utf8")).toBe(settingsContent("single"));
    expect(existsSync(w.target)).toBe(false);
    expect(w.err.join("\n")).toContain("Commit .wachiman.yml");
  });

  test("the same kind leaves the file untouched and says so", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"));
    writeFileSync(settingsFile(w), "# mine\nkind: 'single'  # note\nother: 1\n");
    // The agent pointer is already in place, so the only thing this test can see change is the settings file.
    write(w.repo, { "AGENTS.md": pointerBlock() });
    const before = snapshotTree(w.repo);
    expect(await init(w, ["--mode", "local", "--project-kind", "single"])).toBe(0);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain(".wachiman.yml already says kind: single.");
  });

  test("a different kind needs --force when nobody can be asked, and nothing is written without it", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"));
    writeFileSync(settingsFile(w), "kind: monorepo\n");
    const before = snapshotTree(w.repo);
    expect(await exit2(init(w, [...baseArgs, "--project-kind", "single"]))).toContain("--force");
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(existsSync(w.target)).toBe(false);
  });

  test("--force replaces only the kind line and keeps every other line", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"));
    writeFileSync(settingsFile(w), "# mine\nowner: team-a\nkind: monorepo\nnested:\n  kind: keep-me\n");
    expect(await init(w, ["--mode", "local", "--project-kind", "single", "--force"])).toBe(0);
    expect(readFileSync(settingsFile(w), "utf8")).toBe("# mine\nowner: team-a\nkind: single\nnested:\n  kind: keep-me\n");
    expect(readdirSync(w.repo).filter((f) => f.startsWith(".wachiman.yml"))).toEqual([".wachiman.yml"]); // no backup file is left behind
  });

  test("--force refuses a settings file whose kind key it cannot rewrite safely, and writes nothing", async () => {
    for (const content of ['"kind": monorepo\nmodel: claude-opus-5-5\n', "{kind: monorepo, model: x}\n", "model: [unclosed\n"]) {
      const w = world();
      mkdirSync(join(w.repo, ".github"));
      writeFileSync(settingsFile(w), content);
      const before = snapshotTree(w.repo);
      expect(await exit2(init(w, ["--mode", "local", "--project-kind", "single", "--force"]))).toContain("by hand");
      expect(snapshotTree(w.repo)).toEqual(before);
      expect(readFileSync(settingsFile(w), "utf8")).toBe(content);
    }
  });

  test("an edit to the settings file during the write is never overwritten, and the workflow written before it stays", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"));
    writeFileSync(settingsFile(w), "kind: monorepo\n");
    const edited = "kind: monorepo\nowner: someone-else\n";
    const settingsHooks = { beforeCommit: () => { unlinkSync(settingsFile(w)); writeFileSync(settingsFile(w), edited); } };
    expect(await exit2(init(w, [...baseArgs, "--project-kind", "single", "--force"], { settingsHooks }))).toContain("changed while init was running");
    expect(readFileSync(settingsFile(w), "utf8")).toBe(edited);
    expect(existsSync(w.target)).toBe(true);
    expect(w.err.join("\n")).toContain("was written before .wachiman.yml failed and stays in place.");
  });

  test("a settings file that appears during the write is never overwritten", async () => {
    const w = world();
    const settingsHooks = { beforeCommit: () => writeFileSync(settingsFile(w), "kind: theirs\n") };
    expect(await exit2(init(w, ["--mode", "local", "--project-kind", "single"], { settingsHooks }))).toContain("appeared while init was running");
    expect(readFileSync(settingsFile(w), "utf8")).toBe("kind: theirs\n");
  });

  test("a file without a kind line gets one appended", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"));
    writeFileSync(settingsFile(w), "owner: team-a");
    expect(await init(w, ["--mode", "local", "--project-kind", "single", "--force"])).toBe(0);
    expect(readFileSync(settingsFile(w), "utf8")).toBe("owner: team-a\nkind: single\n");
  });

  test("--dry-run writes nothing, says what it would write on stderr, and keeps stdout to the workflow", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, [...baseArgs, "--project-kind", "single", "--dry-run"])).toBe(0);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain("would write .wachiman.yml (kind: single)");
    expect(w.out.join("")).toBe(expected("me", "v1.5.0"));
  });

  test("without --project-kind and without a terminal the file is not written, and nothing is said about it", async () => {
    const w = world();
    expect(await init(w, baseArgs)).toBe(0);
    expect(existsSync(settingsFile(w))).toBe(false);
    expect(w.err.join("\n")).not.toContain("wachiman.yml");
    mkdirSync(join(w.repo, ".github"), { recursive: true });
    writeFileSync(settingsFile(w), "kind: monorepo\n");
    expect(await init(w, ["--mode", "local"])).toBe(0);
    expect(readFileSync(settingsFile(w), "utf8")).toBe("kind: monorepo\n");
  });

  test("an invalid kind, or distributed, is exit 2 before anything is written", async () => {
    const w = world();
    expect(await exit2(init(w, ["--mode", "local", "--project-kind", "polyrepo"]))).toContain("monorepo or single");
    expect(await exit2(init(w, ["--mode", "local", "--project-kind", "distributed"]))).toContain("not available yet");
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });

  test("a settings file that is a symbolic link is refused", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".github"));
    writeFileSync(join(w.repo, "elsewhere.yml"), "kind: single\n");
    symlinkSync(join(w.repo, "elsewhere.yml"), settingsFile(w));
    expect(await exit2(init(w, ["--mode", "local", "--project-kind", "single"]))).toContain("symbolic link");
  });

  describe("on a prompt", () => {
    test("local: the kind question lists distributed as not available, the preview comes before Write, and No writes nothing", async () => {
      const w = world();
      const io = scripted(["3", "1", "n", "n"]); // distributed (refused), monorepo, PR template no, Write .wachiman.yml? no
      const code = await init(w, ["--mode", "local"], { interactive: true, promptIO: io });
      expect(code).toBe(0);
      expect(io.printed()).toContain("Option 3 is not available yet");
      expect(io.printed()).toContain("Write .wachiman.yml? [Y/n]");
      expect(w.err.join("\n")).toContain("--- .wachiman.yml (new)");
      expect(existsSync(settingsFile(w))).toBe(false);
    });

    test("an existing different kind asks to change it; yes replaces only that line", async () => {
      const w = world();
      mkdirSync(join(w.repo, ".github"));
      writeFileSync(settingsFile(w), "owner: a\nkind: monorepo\n");
      const io = scripted(["2", "n", "y"]); // single, PR template no, change? yes
      expect(await init(w, ["--mode", "local"], { interactive: true, promptIO: io })).toBe(0);
      expect(io.printed()).toContain("Change kind from monorepo to single in .wachiman.yml? [Y/n]");
      expect(readFileSync(settingsFile(w), "utf8")).toBe("owner: a\nkind: single\n");
    });

    test("an existing different kind: no keeps the file, and a github run still writes the workflow", async () => {
      const w = world();
      mkdirSync(join(w.repo, ".github"));
      writeFileSync(settingsFile(w), "kind: monorepo\n");
      const io = scripted(["2", "n", "n", "y"]); // kind single, PR template no, change? no, Write it? yes
      expect(await init(w, [...baseArgs], { interactive: true, promptIO: io })).toBe(0);
      expect(readFileSync(settingsFile(w), "utf8")).toBe("kind: monorepo\n");
      expect(existsSync(w.target)).toBe(true);
      expect(w.err.join("\n")).toContain(".wachiman.yml left as it is.");
    });

    test("github: one Write it? covers the workflow and the new settings file; Ctrl-D there writes neither", async () => {
      const w = world();
      expect(await init(w, [...baseArgs], { interactive: true, promptIO: scripted(["1", "n"]) })).toBe(130);
      expect(existsSync(join(w.repo, ".github"))).toBe(false);
      expect(w.err.join("\n")).toContain("cancelled: nothing was written");
      const w2 = world();
      expect(await init(w2, [...baseArgs], { interactive: true, promptIO: scripted(["1", "n", "y"]) })).toBe(0);
      expect(existsSync(settingsFile(w2))).toBe(true);
      expect(existsSync(w2.target)).toBe(true);
    });

    test("a kind given on the command line is not asked", async () => {
      const w = world();
      const io = scripted(["n", "y"]); // PR template, Write .wachiman.yml?
      expect(await init(w, ["--mode", "local", "--project-kind", "single"], { interactive: true, promptIO: io })).toBe(0);
      expect(io.printed()).not.toContain("What kind of repository");
      expect(readFileSync(settingsFile(w), "utf8")).toContain("kind: single\n");
    });
  });
});

describe("settings text helpers", () => {
  test("readKind drops quotes and comments; withKind touches only the top-level kind line", () => {
    expect(readKind('kind: "single"\n')).toBe("single");
    expect(readKind("kind: monorepo # why\n")).toBe("monorepo");
    expect(readKind("  kind: nested\n")).toBeUndefined();
    expect(readKind("kind:\n")).toBeUndefined();
    expect(readKind("kind: # not set yet\n")).toBeUndefined();
    expect(withKind("a: 1\r\nkind: x\r\nb: 2\r\n", "single")).toBe("a: 1\r\nkind: single\r\nb: 2\r\n");
  });

  test("withKind refuses a result that is invalid YAML or whose kind key is not the plain line it wrote", () => {
    expect(() => withKind('"kind": monorepo\n', "single")).toThrow(/by hand/); // a quoted key would end up duplicated
    expect(() => withKind("'kind' : monorepo\nmodel: x\n", "single")).toThrow(/by hand/);
    expect(() => withKind("{kind: monorepo}\n", "single")).toThrow(/cannot be updated safely/); // appending to a flow mapping is invalid YAML
    expect(() => withKind("kind: a\nkind: b\n", "single")).toThrow(/by hand/); // a duplicate the regex would half-fix
    expect(withKind("model: x\n", "single")).toBe("model: x\nkind: single\n");
  });
});

describe("the agent instruction pointer", () => {
  test("a github run creates AGENTS.md with the pointer, and a re-run leaves exactly one", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me"])).toBe(0);
    expect(readFileSync(join(w.repo, "AGENTS.md"), "utf8")).toBe(pointerBlock());
    expect(await init(w, ["--mode", "github", "--operator", "me"])).toBe(0);
    expect(readFileSync(join(w.repo, "AGENTS.md"), "utf8")).toBe(pointerBlock());
  });

  test("an existing AGENTS.md keeps its text and gets the block appended", async () => {
    const w = world();
    write(w.repo, { "AGENTS.md": "# Rules\n\nUse named exports.\n" });
    expect(await init(w, ["--mode", "local"])).toBe(0);
    expect(readFileSync(join(w.repo, "AGENTS.md"), "utf8")).toBe(`# Rules\n\nUse named exports.\n\n${pointerBlock()}`);
  });

  test("with only CLAUDE.md in the repository, local mode writes the pointer there and nowhere else", async () => {
    const w = world();
    write(w.repo, { "CLAUDE.md": "# Claude\n" });
    expect(await init(w, ["--mode", "local"])).toBe(0);
    expect(readFileSync(join(w.repo, "CLAUDE.md"), "utf8")).toBe(`# Claude\n\n${pointerBlock()}`);
    expect(existsSync(join(w.repo, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });

  test("--dry-run writes nothing and says what it would write on stderr", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, ["--mode", "github", "--operator", "me", "--dry-run"])).toBe(0);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain("would create AGENTS.md");
    expect(w.err.join("\n")).toContain(POINTER_BEGIN);
  });

  test("a malformed pointer block does not fail init: the workflow is written, the problem is reported", async () => {
    const w = world();
    write(w.repo, { "AGENTS.md": `${POINTER_BEGIN}\nno end marker\n` });
    expect(await init(w, ["--mode", "github", "--operator", "me"])).toBe(0);
    expect(existsSync(w.target)).toBe(true);
    expect(readFileSync(join(w.repo, "AGENTS.md"), "utf8")).toBe(`${POINTER_BEGIN}\nno end marker\n`);
    expect(w.err.join("\n")).toContain("wachiman pointer not written");
    expect(w.err.join("\n")).toContain("by hand");
  });

  test("a symlinked CLAUDE.md is written through to AGENTS.md inside the repository", async () => {
    const w = world();
    write(w.repo, { "AGENTS.md": "# Rules\n" });
    symlinkSync("AGENTS.md", join(w.repo, "CLAUDE.md"));
    expect(await init(w, ["--mode", "local"])).toBe(0);
    expect(readFileSync(join(w.repo, "AGENTS.md"), "utf8")).toBe(`# Rules\n\n${pointerBlock()}`);
    expect(lstatSync(join(w.repo, "CLAUDE.md")).isSymbolicLink()).toBe(true);
  });

  test("a symlink to a file outside the repository is skipped with a message and init still succeeds", async () => {
    const w = world();
    const outside = mkdtempSync(join(tmpdir(), "wachiman-run-out-"));
    writeFileSync(join(outside, "shared.md"), "x\n");
    symlinkSync(join(outside, "shared.md"), join(w.repo, "AGENTS.md"));
    expect(await init(w, ["--mode", "github", "--operator", "me"])).toBe(0);
    expect(existsSync(w.target)).toBe(true);
    expect(readFileSync(join(outside, "shared.md"), "utf8")).toBe("x\n");
    expect(w.err.join("\n")).toContain("wachiman pointer not written");
    rmSync(outside, { recursive: true, force: true });
  });

  test("a failure while writing the pointer leaves the workflow in place and the exit code 0", async () => {
    const w = world();
    const hooks = {
      writeTemp: (path: string, content: string) => {
        if (content.includes(POINTER_BEGIN)) throw new Error("disk full");
        writeFileSync(path, content, { flag: "wx" });
      },
    };
    expect(await init(w, ["--mode", "github", "--operator", "me"], { hooks })).toBe(0);
    expect(w.err.join("\n")).toContain("disk full");
    expect(w.err.join("\n")).toContain("by hand");
  });

  test("--no-agent-pointer writes no pointer and a dry run says so", async () => {
    const w = world();
    expect(await init(w, ["--mode", "github", "--operator", "me", "--no-agent-pointer"])).toBe(0);
    expect(existsSync(w.target)).toBe(true);
    expect(existsSync(join(w.repo, "AGENTS.md"))).toBe(false);
    const d = world();
    expect(await init(d, ["--mode", "github", "--operator", "me", "--dry-run", "--no-agent-pointer"])).toBe(0);
    expect(d.err.join("\n")).toContain("--no-agent-pointer");
  });
});
