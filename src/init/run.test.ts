import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CTRL_C, ESC, scripted } from "../../test/support/scripted-prompt";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { snapshotTree } from "../../test/support/tree-snapshot";
import { UsageError } from "../config";
import { parseInitFlags } from "./args";
import { callerHeader, renderCallerWorkflow } from "./render";
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
  // No Wachiman-owned network request from init (types spec section 8, invariant 10).
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
    const code = await init(w, ["--mode", "both", "--operator", "me", "--version", "v1.5.0", "--path", ".github/workflows/wachiman-review.yml", "--dry-run"], { interactive: true, promptIO: io, bindNow: () => Promise.reject(new Error("must not chain")) });
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
    expect(await init(w, ["--mode", "github", "--operator", "me", "--dry-run"])).toBe(0);
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
    expect(snapshotTree(w.repo)).toEqual(before);
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
  test.each(["local", "both"])("%s runs the real setup flow with one account choice and one binding confirmation", async (mode) => {
    const w = world();
    const home = mkdtempSync(join(tmpdir(), "wachiman-init-home-"));
    scratch.push(home);
    const env = { WACHIMAN_HOME: home, PATH: "/usr/bin", USER: "fixture" };
    const tools = fakeToolchain();
    const promptIO = scripted(mode === "both" ? ["", "", ""] : ["", ""]);
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
    expect(promptIO.printed().match(/Bind .* to default\?/g)).toHaveLength(1);
    expect(existsSync(w.target)).toBe(mode === "both");
    expect(promptIO.printed()).toContain(mode === "both" ? "Step 4/6  Claude account" : "Step 3/5  Claude account");
    expect(promptIO.printed()).toContain(mode === "both" ? "Step 6/6  Checks and next actions" : "Step 5/5  Checks and next actions");
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
    const io = scripted(["", "octocat", "", "", ""]); // mode, operator, tag, file, Write it?
    const code = await init(w, [], { interactive: true, promptIO: io });
    expect(code).toBe(0);
    const printed = io.printed();
    expect(printed).toMatch(/1\. In GitHub Actions on pull requests \(default\)/);
    expect(printed).toContain("Release tag to pin [v1.5.0]");
    expect(printed).toContain("Workflow file [.github/workflows/wachiman-review.yml]");
    expect(printed).toContain("Write it? [Y/n]");
    // What the printed defaults mean is what was written.
    expect(readFileSync(w.target, "utf8")).toBe(expected("octocat", "v1.5.0"));
  });

  test("the preview shows the file and whether it is new before the question", async () => {
    const w = world();
    const io = scripted(["1", "octocat", "", "", "y"]);
    await init(w, [], { interactive: true, promptIO: io });
    expect(w.err.join("\n")).toContain("--- .github/workflows/wachiman-review.yml (new)");
    expect(w.err.join("\n")).toContain('operator: "octocat"');
  });

  test("an invalid answer is shown and asked again; flags already given are not asked", async () => {
    const w = world();
    const io = scripted(["bad login", "me", "", "y"]); // operator (twice), file, Write it?
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
  ])("%s at the mode question exits 130 and writes nothing", async (_n, key) => {
    const w = world();
    const before = snapshotTree(w.repo);
    expect(await init(w, [], { interactive: true, promptIO: scripted([key]) })).toBe(130);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.err.join("\n")).toContain("cancelled: nothing was written");
  });

  test("Ctrl-D (the input ends) at the Write it? question exits 130 and writes nothing", async () => {
    const w = world();
    const io = scripted(["1", "me", "", ""]); // mode, operator, tag, file: the input ends at Write it?
    expect(await init(w, [], { interactive: true, promptIO: io })).toBe(130);
    expect(io.printed()).toContain("Write it?");
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
  });

  test("answering no to Write it? writes nothing and exits 0", async () => {
    const w = world();
    expect(await init(w, [], { interactive: true, promptIO: scripted(["1", "me", "", "", "n"]) })).toBe(0);
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
    expect(w.err.join("\n")).toContain("not written");
  });

  test("an existing target without --force is exit 2 before the question", async () => {
    const w = world();
    await init(w, ["--mode", "github", "--operator", "me"]);
    const io = scripted(["1", "me", "", ""]);
    expect(await exit2(init(w, [], { interactive: true, promptIO: io }))).toContain("--force");
    expect(io.printed()).not.toContain("Write it?");
  });

  test("local mode enters setup directly without another invitation", async () => {
    const w = world();
    const io = scripted(["2", "from-setup"]);
    let got: string | null | undefined;
    const code = await init(w, [], { interactive: true, promptIO: io, bindNow: async (p) => {
      got = await p.text("Setup asks", undefined);
      return 0;
    } });
    expect(code).toBe(0);
    expect(got).toBe("from-setup");
    expect(existsSync(join(w.repo, ".github"))).toBe(false);
    expect(io.printed()).not.toContain("Run wachiman setup now");
  });

  test("both: yes runs setup in the same process, sharing the prompt session", async () => {
    const w = world();
    const io = scripted(["3", "me", "", "", "", "from-setup"]);
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

  test("both: cancelling during setup leaves the confirmed workflow in place and says so", async () => {
    const w = world();
    const io = scripted(["3", "me", "", "", ""]);
    const code = await init(w, [], { interactive: true, promptIO: io, bindNow: async () => 130 });
    expect(code).toBe(130);
    expect(readFileSync(w.target, "utf8")).toBe(expected("me"));
    expect(w.err.join("\n")).toContain(".github/workflows/wachiman-review.yml was written before setup was cancelled and stays in place");
  });

  test("both: a setup failure reports the completed workflow write", async () => {
    const w = world();
    const io = scripted(["3", "me", "", "", "", ESC]);
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
