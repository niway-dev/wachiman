import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRepoDir, runResetConfidence } from "./cli";
import type { GhFn } from "./engine";

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
    expect(out.stdout).toContain("wachiman review <pr>");
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
    expect(run(["--help"]).stdout).toContain("wachiman threads <pr>");
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

  test("a GitHub-mode review with a temporary HOME creates nothing under it", () => {
    const home = mkdtempSync(join(tmpdir(), "wachiman-gh-home-"));
    const bin = mkdtempSync(join(tmpdir(), "wachiman-gh-bin-"));
    try {
      // A `claude` that answers the version probe, and a `gh` that fails: `review()` starts and stops.
      writeFileSync(join(bin, "claude"), '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
      writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n");
      for (const name of ["claude", "gh"]) chmodSync(join(bin, name), 0o755);
      const env = { GH_TOKEN: "x", GITHUB_REPOSITORY: "o/r", AGENT_REVIEW_DRY_RUN: "1", AGENT_REVIEW_HISTORY: "1", AGENT_REVIEW_HISTORY_DAYS: "x", HOME: home };
      const started = run(["review", "1"], { ...env, PATH: `${bin}:${process.env.PATH ?? ""}` });
      expect(started.code).toBe(1);
      expect(started.stderr).not.toContain("AGENT_REVIEW_HISTORY");
      const missing = run(["review", "1"], { ...env, PATH: "/nonexistent" });
      expect(missing.code).toBe(1);
      // The variable is ignored outside `local`: no history, no `~/.wachiman`. (macOS may add
      // `Library` for its own reasons; only ours is asserted.)
      expect(readdirSync(home)).not.toContain(".wachiman");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
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

describe("reset-confidence", () => {
  const HEAD = "a".repeat(40);
  const ENV = { AGENT_REVIEW_CONFIDENCE: "1", GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r" };

  /** A pull request whose description holds an old grade; records what is written. */
  function fakeGh(head = HEAD) {
    const writes: string[] = [];
    let body = "Retries uploads.\n\n<!-- wachiman:confidence:start -->\nold B for bbbbbbb\n<!-- wachiman:confidence:end -->";
    const gh: GhFn = (args, input) => {
      const line = args.join(" ");
      if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: head, title: "t", body });
      if (line.includes("-X PATCH repos/o/r/pulls/7")) {
        body = (JSON.parse(input ?? "{}") as { body: string }).body;
        writes.push(body);
        return "{}";
      }
      throw new Error(`unexpected gh call: ${line}`);
    };
    return { gh, writes };
  }

  test("replaces an old grade with cannot say for the commit, keeping the author's text, with no model", () => {
    const { gh, writes } = fakeGh();
    expect(runResetConfidence(["7", "--commit", HEAD], ENV, gh)).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("cannot say");
    expect(writes[0]).toContain("aaaaaaa");
    expect(writes[0]).not.toContain("old B");
    expect(writes[0]!.startsWith("Retries uploads.\n\n<!-- wachiman:confidence:start -->")).toBe(true);
    expect(writes[0]!.split("wachiman:confidence:start")).toHaveLength(2);
  });

  test("a run for an older commit leaves the description alone", () => {
    const { gh, writes } = fakeGh("c".repeat(40));
    expect(runResetConfidence(["7", "--commit", HEAD], ENV, gh)).toBe(0);
    expect(writes).toEqual([]);
  });

  test("does nothing with the flag off, and writes nothing in a dry run", () => {
    const off = fakeGh();
    expect(runResetConfidence(["7"], { ...ENV, AGENT_REVIEW_CONFIDENCE: "0" }, off.gh)).toBe(0);
    expect(off.writes).toEqual([]);
    const dry = fakeGh();
    expect(runResetConfidence(["7"], { ...ENV, AGENT_REVIEW_DRY_RUN: "1" }, dry.gh)).toBe(0);
    expect(dry.writes).toEqual([]);
  });

  test("a failed write does not fail the step", () => {
    // The read works and only the PATCH fails, so the write's error path is the one exercised.
    const gh: GhFn = (args) => {
      if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b" });
      throw new Error("gh: HTTP 500");
    };
    const warned: string[] = [];
    const original = console.error;
    console.error = (line: string) => void warned.push(String(line));
    try {
      expect(runResetConfidence(["7"], ENV, gh)).toBe(0);
    } finally {
      console.error = original;
    }
    expect(warned.join("\n")).toContain("could not be reset");
  });

  test("needs a pull request number and refuses an unknown flag", () => {
    expect(() => runResetConfidence([], ENV, fakeGh().gh)).toThrow("pull request number");
    expect(() => runResetConfidence(["7", "--bogus"], ENV, fakeGh().gh)).toThrow("unexpected");
  });
});
