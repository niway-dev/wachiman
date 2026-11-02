import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRepoDir } from "./cli";

const cli = join(import.meta.dir, "cli.ts");
const run = (args: string[], env: Record<string, string> = {}) => {
  const out = Bun.spawnSync([process.execPath, cli, ...args], {
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
};

describe("cli", () => {
  test("--help prints the usage and exits 0", () => {
    const out = run(["--help"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("agent-review review <pr>");
  });

  test("--version prints the package version", () => {
    const out = run(["--version"]);
    expect(out.code).toBe(0);
    expect(out.stdout.trim()).toBe(require("../package.json").version);
  });

  test("usage errors exit 2", () => {
    expect(run(["review"]).code).toBe(2);
    expect(run(["review", "abc"]).code).toBe(2);
    expect(run(["frobnicate", "1"]).code).toBe(2);
    expect(run([]).code).toBe(2);
    expect(run(["review", "1"]).code).toBe(2); // GH_TOKEN is not set
    expect(run(["comment", "1"], { GH_TOKEN: "x", GITHUB_REPOSITORY: "o/r" }).code).toBe(2); // no REQUEST
  });

  test("threads is a command: it needs a pull request number and takes no paths", () => {
    expect(run(["--help"]).stdout).toContain("agent-review threads <pr>");
    expect(run(["threads"]).code).toBe(2);
    expect(run(["threads", "abc"]).code).toBe(2);
    expect(run(["threads", "7", "a.ts"]).code).toBe(2);
    expect(run(["threads", "7"]).code).toBe(2); // GH_TOKEN is not set
  });

  test("a trigger that is not an event action is a usage error", () => {
    expect(run(["review", "1"], { AGENT_REVIEW_TRIGGER: "Not An Action" }).code).toBe(2);
  });

  test("an unknown provider is a usage error naming the accepted values", () => {
    const out = run(["review", "1"], { AGENT_REVIEW_PROVIDER: "other" });
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("claude-code");
  });

  test("a missing agent binary is an engine error, before anything is posted", () => {
    const out = run(["review", "1"], {
      GH_TOKEN: "x",
      GITHUB_REPOSITORY: "o/r",
      AGENT_REVIEW_DRY_RUN: "1",
      PATH: "/nonexistent",
    });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("did not run");
  });
});

describe("--repo-dir", () => {
  test("is taken out of the arguments, in both spellings, and defaults to the current directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-dir-"));
    expect(extractRepoDir(["review", "7", "--repo-dir", dir])).toEqual({ repoDir: dir, rest: ["review", "7"] });
    expect(extractRepoDir(["--repo-dir=" + dir, "comment", "7"])).toEqual({ repoDir: dir, rest: ["comment", "7"] });
    expect(extractRepoDir(["review", "7"]).repoDir).toBe(process.cwd());
  });

  test("a missing value or a directory that does not exist is a usage error", () => {
    expect(() => extractRepoDir(["review", "7", "--repo-dir"])).toThrow("needs a directory");
    expect(() => extractRepoDir(["review", "7", "--repo-dir=/nonexistent/head"])).toThrow("not a directory");
    expect(run(["review", "7", "--repo-dir", "/nonexistent/head"]).code).toBe(2);
  });
});
