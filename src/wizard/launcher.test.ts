import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { main } from "../cli";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { scripted } from "../../test/support/scripted-prompt";
import { commandArgs, commandLine, detectBase, maybeLaunch, runLauncher, scopeArgs, shouldLaunch, SPENDING, type Action, type Scope } from "./launcher";

const tty = { isTTY: true };
const allTty = { stdin: tty, stdout: tty, stderr: tty };

const home = mkdtempSync(join(tmpdir(), "wachiman-launcher-home-"));
afterAll(() => {
  removeTempRepos();
  rmSync(home, { recursive: true, force: true });
});

describe("when the launcher opens", () => {
  test("only with a terminal on stdin, stdout and stderr and no CI", () => {
    expect(shouldLaunch({}, allTty)).toBe(true);
  });

  test.each([
    ["stdin piped", { ...allTty, stdin: { isTTY: false } }, {}],
    ["stdout piped", { ...allTty, stdout: {} }, {}],
    ["stderr redirected", { ...allTty, stderr: { isTTY: false } }, {}],
    ["CI=true", allTty, { CI: "true" }],
    ["CI=1", allTty, { CI: "1" }],
    ["any other CI value", allTty, { CI: "yes" }],
  ])("not with %s", (_name, streams, env) => {
    expect(shouldLaunch(env, streams)).toBe(false);
  });

  test("maybeLaunch does nothing without a terminal: no prompt, no dispatch", async () => {
    let dispatched = 0;
    const io = scripted([]);
    const result = await maybeLaunch({
      env: {},
      version: "1.0.0",
      streams: { ...allTty, stdin: { isTTY: false } },
      promptIO: io,
      dispatch: async () => ++dispatched,
    });
    expect(result).toBeUndefined();
    expect(dispatched).toBe(0);
    expect(io.printed()).toBe("");
  });

  test("a bare `wachiman` without a terminal still says no command was given", async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    try {
      expect(await main([], { CI: "true" })).toBe(2);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain("No command given.");
  });
});

describe("what each menu entry runs", () => {
  const branch: Scope = { kind: "branch", base: "origin/main" };

  test("scope flags", () => {
    expect(scopeArgs(branch)).toEqual(["--base", "origin/main"]);
    expect(scopeArgs({ kind: "commit", commit: "abc1234" })).toEqual(["--commit", "abc1234"]);
    expect(scopeArgs({ kind: "staged" })).toEqual(["--working-tree", "staged"]);
    expect(scopeArgs({ kind: "tree" })).toEqual(["--working-tree", "all"]);
  });

  test.each<[Action, Parameters<typeof commandArgs>[1], string[]]>([
    ["review", { scope: branch }, ["local", "--base", "origin/main"]],
    ["review", { scope: { kind: "staged" } }, ["local", "--working-tree", "staged"]],
    ["ask", { scope: { kind: "commit", commit: "HEAD" }, question: "why this change?" }, ["ask", "why this change?", "--commit", "HEAD"]],
    ["ask", { scope: { kind: "tree" }, question: "" }, ["ask", "--working-tree", "all"]],
    ["loop-start", { base: "main" }, ["loop", "--base", "main"]],
    ["loop-continue", {}, ["loop"]],
    ["history", {}, ["history"]],
    ["status", {}, ["status"]],
    ["dashboard", {}, ["dashboard"]],
    ["setup", {}, ["setup"]],
    ["init", {}, ["init"]],
    ["doctor", {}, ["doctor"]],
    ["profile", {}, ["profile", "list"]],
    ["skills", {}, ["skills", "install"]],
  ])("%s", (action, options, expected) => {
    expect(commandArgs(action, options)).toEqual(expected);
  });

  test("only the review, the answer and the loop spend the subscription", () => {
    expect([...SPENDING].sort()).toEqual(["ask", "loop-continue", "loop-start", "review"]);
  });

  test("the command line is quoted the way a shell needs", () => {
    expect(commandLine(["ask", "why this change?", "--base", "origin/main"])).toBe("wachiman ask 'why this change?' --base origin/main");
  });
});

describe("the base branch", () => {
  const run = (answers: Record<string, string>) => (args: string[]) => ({ status: args.join(" ") in answers ? 0 : 1, stdout: answers[args.join(" ")] ?? "", stderr: "" });

  test("origin's default branch wins, then the first common name that exists", () => {
    expect(detectBase("/x", run({ "symbolic-ref --short refs/remotes/origin/HEAD": "origin/develop\n" }))).toBe("origin/develop");
    expect(detectBase("/x", run({ "rev-parse --verify --quiet main": "x" }))).toBe("main");
    expect(detectBase("/x", run({ "rev-parse --verify --quiet origin/main": "x", "rev-parse --verify --quiet main": "x" }))).toBe("origin/main");
    expect(detectBase("/x", run({}))).toBeUndefined();
  });
});

describe("the menu, end to end", () => {
  // The menu only reads the repository, so one serves every test.
  let shared: string | undefined;
  function repo() {
    if (shared) return shared;
    shared = emptyRepo();
    commit(shared, { "a.txt": "1\n" }, "first");
    git(shared, "branch", "-M", "main");
    return shared;
  }
  const env = { WACHIMAN_HOME: home };

  async function launch(answers: string[], dir = repo()) {
    const io = scripted(answers);
    const calls: string[][] = [];
    const code = await runLauncher({ env, version: "1.0.0", cwd: dir, promptIO: io, dispatch: async (argv) => (calls.push(argv), 7) });
    return { code, calls, printed: io.printed() };
  }

  test("Review changes, this branch: the base defaults to main, and confirming runs `local --base main`", async () => {
    const r = await launch(["1", "1", "", ""]); // review, branch, base default, confirm default
    expect(r.calls).toEqual([["local", "--base", "main"]]);
    expect(r.code).toBe(7); // the exit code is the command's
    // Before it spends: the repository, the scope, the profile and the command.
    expect(r.printed).toMatch(/repository\s+wachiman-repo-/);
    expect(r.printed).toContain("this branch against main");
    expect(r.printed).toMatch(/profile\s+\S+/);
    expect(r.printed).toContain("wachiman local --base main");
    expect(r.printed).toContain("counts against your subscription");
  });

  test("Review changes, one commit, with a commit typed", async () => {
    const r = await launch(["1", "2", "abc1234", "y"]);
    expect(r.calls).toEqual([["local", "--commit", "abc1234"]]);
  });

  test("Review changes, staged and all working-tree changes", async () => {
    expect((await launch(["1", "3", ""])).calls).toEqual([["local", "--working-tree", "staged"]]);
    expect((await launch(["1", "4", ""])).calls).toEqual([["local", "--working-tree", "all"]]);
  });

  test("Ask about changes carries the question and the scope", async () => {
    const r = await launch(["2", "3", "does it handle empty input?", ""]);
    expect(r.calls).toEqual([["ask", "does it handle empty input?", "--working-tree", "staged"]]);
    expect(r.printed).toContain("wachiman ask 'does it handle empty input?' --working-tree staged");
  });

  test("Ask about changes with no question asks for the walkthrough", async () => {
    expect((await launch(["2", "4", "", ""])).calls).toEqual([["ask", "--working-tree", "all"]]);
  });

  test("Review loop: start with a base, or continue the open one", async () => {
    expect((await launch(["3", "1", "develop", ""])).calls).toEqual([["loop", "--base", "develop"]]);
    expect((await launch(["3", "2", ""])).calls).toEqual([["loop"]]);
  });

  test.each([
    ["history", ["4", "1"], ["history"]],
    ["status", ["4", "2"], ["status"]],
    ["dashboard", ["4", "3"], ["dashboard"]],
    ["setup", ["5", "1"], ["setup"]],
    ["init", ["5", "2"], ["init"]],
    ["doctor", ["5", "3"], ["doctor"]],
    ["profile", ["5", "4"], ["profile", "list"]],
  ])("%s runs at once, with its command shown and no confirmation", async (_name, keys, expected) => {
    const r = await launch(keys);
    expect(r.calls).toEqual([expected]);
    expect(r.printed).toContain(`wachiman ${expected.join(" ")}`);
    expect(r.printed).not.toContain("Run it?");
  });

  test("Agent skills ask before copying files", async () => {
    expect((await launch(["5", "5", "n", "6"])).calls).toEqual([]);
    expect((await launch(["5", "5", ""])).calls).toEqual([["skills", "install"]]);
  });

  test("declining the confirmation spends nothing and returns to the menu", async () => {
    const r = await launch(["1", "1", "", "n", "6"]); // ... confirm no, then Exit
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.printed).toContain("Nothing was run.");
  });

  test("Exit runs nothing and succeeds", async () => {
    const r = await launch(["6"]);
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
  });

  test("Back in a submenu returns to the main menu", async () => {
    const r = await launch(["4", "4", "5", "3"]); // Findings > Back > Configure > Doctor
    expect(r.calls).toEqual([["doctor"]]);
  });

  test.each([
    ["Escape at the menu", ["\u001b"]],
    ["Ctrl-C at the menu", ["\u0003"]],
    ["Escape at the scope question", ["1", "\u001b"]],
    ["Escape at the base question", ["1", "1", "\u001b"]],
    ["Escape at the confirmation", ["1", "1", "", "\u001b"]],
    ["the input ending at the confirmation", ["1", "1", ""]],
  ])("%s cancels before dispatch: nothing runs, exit 130", async (_name, keys) => {
    const r = await launch(keys);
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(130);
    expect(r.printed).toContain("cancelled: nothing was run.");
  });

  test("a base that is a flag is refused and asked again", async () => {
    const r = await launch(["1", "1", "--evil", "main", ""]);
    expect(r.printed).toContain("The base cannot start with a dash.");
    expect(r.calls).toEqual([["local", "--base", "main"]]);
  });

  test("a question that looks like a flag is refused", async () => {
    const r = await launch(["2", "4", "--profile x", "fine", ""]);
    expect(r.printed).toContain("Start the question with a word, not a dash.");
    expect(r.calls).toEqual([["ask", "fine", "--working-tree", "all"]]);
  });

  test("outside a git repository a command that spends is not offered to run", async () => {
    const outside = mkdtempSync(join(tmpdir(), "wachiman-launcher-outside-"));
    try {
      const r = await launch(["1", "6"], outside);
      expect(r.calls).toEqual([]);
      expect(r.printed).toContain("not inside a git repository");
      expect(r.printed).toContain("This needs a git repository.");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("the prompt session is closed before the command starts", async () => {
    // The input stays open, so only closing the session can remove readline's listener.
    const input = new PassThrough();
    input.write("4\n1\n");
    const io = { input, output: new PassThrough() };
    let readersAtDispatch: number | undefined;
    await runLauncher({
      env,
      version: "1.0.0",
      cwd: repo(),
      promptIO: io,
      dispatch: async () => {
        // readline reads through a "data" listener; a closed session has none left.
        readersAtDispatch = input.listenerCount("data");
        return 0;
      },
    });
    input.end();
    expect(readersAtDispatch).toBe(0);
  });
});
