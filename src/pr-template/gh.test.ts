import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changesFromGit, defaultRunner, gitFileAt, ToolError, type CommandResult, type CommandRunner } from "./gh";

const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): CommandResult => ({ code: 128, stdout: "", stderr });

/** A runner that answers by the git subcommand and records every command. */
function fake(answers: { lsTree?: CommandResult; show?: CommandResult }) {
  const calls: string[][] = [];
  const run: CommandRunner = (cmd) => {
    calls.push(cmd);
    if (cmd[1] === "ls-tree") return answers.lsTree ?? ok("");
    if (cmd[1] === "show") return answers.show ?? fail("no show");
    return fail("unexpected");
  };
  return { run, calls };
}

describe("gitFileAt", () => {
  const entry = (type: string, mode: string, path: string) => `${mode} ${type} 1111111111111111111111111111111111111111\t${path}\0`;

  test("an empty listing means the commit has no such file, whatever language git speaks", () => {
    const f = fake({ lsTree: ok("") });
    expect(gitFileAt(f.run, "/repo", "abc1234", ".github/pr-risk.toml")).toBeNull();
    expect(f.calls.map((c) => c[1])).toEqual(["ls-tree"]);
  });

  test("a listed file is read with git show", () => {
    const f = fake({ lsTree: ok(entry("blob", "100644", ".github/pr-risk.toml")), show: ok("[high]\n") });
    expect(gitFileAt(f.run, "/repo", "abc1234", ".github/pr-risk.toml")).toBe("[high]\n");
    expect(f.calls[0]).toEqual(["git", "ls-tree", "-z", "--full-tree", "abc1234", "--", ".github/pr-risk.toml"]);
    expect(f.calls[1]).toEqual(["git", "show", "abc1234:.github/pr-risk.toml"]);
  });

  test("a directory or a submodule at the path is not a file", () => {
    expect(gitFileAt(fake({ lsTree: ok(entry("tree", "040000", ".github")) }).run, "/repo", "abc1234", ".github")).toBeNull();
    expect(gitFileAt(fake({ lsTree: ok(entry("commit", "160000", "mod")) }).run, "/repo", "abc1234", "mod")).toBeNull();
  });

  test("an entry that only shares the prefix is not the file", () => {
    expect(gitFileAt(fake({ lsTree: ok(entry("blob", "100644", "pr-risk.toml.bak")) }).run, "/repo", "abc1234", "pr-risk.toml")).toBeNull();
  });

  test("a failing ls-tree is a real failure, not an absent file, in any language", () => {
    for (const stderr of [
      "fatal: Not a valid object name nope",
      "fatal: Ce n'est pas un nom d'objet valide nope",
      "fatal: 無効なオブジェクト名 nope",
    ]) {
      expect(() => gitFileAt(fake({ lsTree: fail(stderr) }).run, "/repo", "nope", "a.toml")).toThrow(ToolError);
    }
    expect(() => gitFileAt(fake({ lsTree: fail("fatal: nope") }).run, "/repo", "nope", "a.toml")).toThrow(
      "git ls-tree nope -- a.toml failed: fatal: nope",
    );
  });

  test("a listed file that git show cannot read is a failure even when the message looks like absence", () => {
    const f = fake({ lsTree: ok(entry("blob", "100644", "a.toml")), show: fail("fatal: path 'a.toml' does not exist in 'abc1234'") });
    expect(() => gitFileAt(f.run, "/repo", "abc1234", "a.toml")).toThrow(ToolError);
  });

  test("the message of git is never read: the same answers give the same result", () => {
    const lang = (text: string) => gitFileAt(fake({ lsTree: ok(""), show: fail(text) }).run, "/repo", "abc1234", "a.toml");
    expect(lang("fatal: le chemin 'a.toml' n'existe pas")).toBeNull();
    expect(lang("")).toBeNull();
  });
});

describe("the real git", () => {
  const git = (dir: string, ...args: string[]) => {
    const r = defaultRunner(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], dir);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  const withRepo = (body: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "pr-template-gh-"));
    try {
      git(dir, "init", "-q", "-b", "main");
      mkdirSync(join(dir, ".github"));
      writeFileSync(join(dir, ".github", "pr-risk.toml"), "[high]\n");
      writeFileSync(join(dir, "a.txt"), "a\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "base");
      body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a present file, an absent file and a bad ref", () => {
    withRepo((dir) => {
      expect(gitFileAt(defaultRunner, dir, "HEAD", ".github/pr-risk.toml")).toBe("[high]\n");
      expect(gitFileAt(defaultRunner, dir, "HEAD", ".github/nowhere.toml")).toBeNull();
      expect(gitFileAt(defaultRunner, dir, "HEAD", ".github")).toBeNull();
      expect(() => gitFileAt(defaultRunner, dir, "no-such-ref", "a.txt")).toThrow(ToolError);
    });
  });

  test("the path is from the repository root even when the command runs in a subdirectory", () => {
    withRepo((dir) => {
      expect(gitFileAt(defaultRunner, join(dir, ".github"), "HEAD", ".github/pr-risk.toml")).toBe("[high]\n");
    });
  });

  test("a diff keeps the a/ and b/ prefixes even when the user's git is set to no prefix", () => {
    withRepo((dir) => {
      git(dir, "config", "diff.noprefix", "true");
      writeFileSync(join(dir, "db.sql"), "select 1;\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "second");
      expect(changesFromGit(defaultRunner, dir, "HEAD~1").changes.map((c) => c.path)).toEqual(["db.sql"]);
    });
  });
});

describe("defaultRunner", () => {
  test("runs the tool with LC_ALL=C whatever the caller's locale", () => {
    const before = process.env.LC_ALL;
    process.env.LC_ALL = "de_DE.UTF-8";
    try {
      expect(defaultRunner(["sh", "-c", 'printf %s "$LC_ALL"']).stdout).toBe("C");
    } finally {
      if (before === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = before;
    }
  });

  test("keeps the rest of the environment and reports a missing tool as exit 127", () => {
    process.env.PR_TEMPLATE_GH_TEST = "yes";
    try {
      expect(defaultRunner(["sh", "-c", 'printf %s "$PR_TEMPLATE_GH_TEST"']).stdout).toBe("yes");
    } finally {
      delete process.env.PR_TEMPLATE_GH_TEST;
    }
    expect(defaultRunner(["definitely-not-a-tool-xyz"]).code).toBe(127);
  });
});
