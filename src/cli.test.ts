import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

describe("exit code 3: the daily limit and a required ledger (ADR 0020)", () => {
  /** `gh`, `claude` and `curl` as shell scripts: a one-file pull request, a probe that logs model calls, a scripted ledger. */
  function world() {
    const bin = mkdtempSync(join(tmpdir(), "wachiman-daily-bin-"));
    const modelCalls = join(bin, "model-called");
    const script = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    script("claude", `case "$*" in *--version*) echo "9.9.9 (Claude Code)";; *) touch "${modelCalls}";; esac`);
    script(
      "gh",
      [
        'case "$*" in',
        `  "pr view"*) printf '%s\\n' '{"headRefOid":"head1234567","title":"t","body":"b","author":{"login":"u"}}';;`,
        `  *pulls/1/files*) printf '%s\\n' '{"filename":"a.ts","additions":1,"deletions":0,"patch":"@@ -0,0 +1 @@\\n+x"}';;`,
        "  *pulls/1/reviews*|*pulls/1/comments*) ;;",
        "  *) exit 1;;",
        "esac",
      ].join("\n"),
    );
    script(
      "curl",
      [
        '[ -n "$CURL_EXIT" ] && exit "$CURL_EXIT"',
        'for last; do :; done',
        'case "$last" in',
        `  https://tokens.test/*) printf '{"value":"jwt"}\\n200';;`,
        `  *) printf '%s\\n%s' "$LEDGER_BODY" "$LEDGER_STATUS";;`,
        "esac",
      ].join("\n"),
    );
    const env = (extra: Record<string, string>) => ({
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GH_TOKEN: "x",
      GITHUB_REPOSITORY: "o/r",
      AGENT_REVIEW_DRY_RUN: "1",
      AGENT_REVIEW_TRIGGER: "opened",
      AGENT_REVIEW_LEDGER_URL: "https://ledger.test",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://tokens.test/token?api=1",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "bearer",
      ...extra,
    });
    return { bin, env, modelCalled: () => existsSync(modelCalls) };
  }

  const LIMIT = JSON.stringify({ reason: "limit", account_spent_usd: 6.12, account_limit_usd: 6, day: "2026-11-06" });

  test("the daily limit exits 3 in fail mode and 0 in notice mode", () => {
    const w = world();
    try {
      const failed = run(["review", "1"], w.env({ LEDGER_STATUS: "402", LEDGER_BODY: LIMIT }));
      expect(failed.code).toBe(3);
      expect(failed.stderr).toContain("daily limit reached");
      expect(failed.stdout).toContain("No credits today");
      const quiet = run(["review", "1"], w.env({ LEDGER_STATUS: "402", LEDGER_BODY: LIMIT, AGENT_REVIEW_DAILY_LIMIT_MODE: "notice" }));
      expect(quiet.code).toBe(0);
      expect(quiet.stdout).toContain("No credits today");
      expect(w.modelCalled()).toBe(false);
    } finally {
      rmSync(w.bin, { recursive: true, force: true });
    }
  });

  test("an unreachable ledger exits 3 before any model call", () => {
    const w = world();
    try {
      const out = run(["review", "1"], w.env({ CURL_EXIT: "7" }));
      expect(out.code).toBe(3);
      expect(out.stderr).toContain("agent-review: ledger:");
      expect(w.modelCalled()).toBe(false);
    } finally {
      rmSync(w.bin, { recursive: true, force: true });
    }
  });

  test("an unlinked repository exits 3 with 'repository not linked'", () => {
    const w = world();
    try {
      const out = run(["review", "1"], w.env({ LEDGER_STATUS: "403", LEDGER_BODY: JSON.stringify({ reason: "not_linked" }) }));
      expect(out.code).toBe(3);
      expect(out.stderr).toContain("repository not linked");
      expect(w.modelCalled()).toBe(false);
    } finally {
      rmSync(w.bin, { recursive: true, force: true });
    }
  });

  test("--help lists exit code 3", () => {
    expect(run(["--help"]).stdout).toContain("3 the daily limit");
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
