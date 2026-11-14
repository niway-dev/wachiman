/**
 * `setup`, `doctor`, `profile` and `project` through the real entry point, in a child process with
 * a temporary Wachiman home and a fake `claude` first on PATH. Nothing here starts the real
 * `claude` or reads the real `~/.wachiman`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { commit, emptyRepo, git, removeTempRepos } from "../test/support/temp-repo";
import { snapshotTree } from "../test/support/tree-snapshot";
import { repositoryKey } from "./history/store";

const cli = join(import.meta.dir, "cli.ts");
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

/** A `claude` that answers `--version` and `auth status` for whatever directory it is run under. */
function fakeClaude() {
  const bin = temp("wachiman-fake-claude-");
  const path = join(bin, "claude");
  writeFileSync(
    path,
    `#!/bin/sh
case "$1" in
  --version) echo "2.1.321 (Claude Code)" ;;
  auth) if [ "$2" = "status" ]; then printf '{"loggedIn":true,"authMethod":"claude.ai","configDirectory":"%s"}' "$CLAUDE_CONFIG_DIR"; fi ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return bin;
}

function machine() {
  const home = join(temp("wachiman-cli-home-"), ".wachiman");
  const userHome = temp("wachiman-cli-user-");
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n" }, "init");
  git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
  const workDir = temp("claude-work-a-");
  const bin = fakeClaude();
  const env: Record<string, string> = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: userHome,
    USER: "dev",
    WACHIMAN_HOME: home,
  };
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const out = Bun.spawnSync([process.execPath, cli, ...args], { env: { ...env, ...extra }, stdin: "ignore", cwd: repo });
    return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
  };
  return { home, repo, workDir, env, run };
}

describe("account commands through the CLI", () => {
  test("setup without --profile and without a TTY exits 2 and writes nothing, not even the home", () => {
    const m = machine();
    const out = m.run(["setup"]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("setup needs --profile <name> when it cannot ask; run wachiman profile list");
    expect(existsSync(m.home)).toBe(false);
  });

  test("add a profile, bind the repository, read the binding and the profile back; the repository is untouched", () => {
    const m = machine();
    const before = snapshotTree(m.repo);
    expect(m.run(["profile", "add", "work-a", "--config-dir", m.workDir]).code).toBe(0);
    const list = JSON.parse(m.run(["profile", "list", "--json"]).stdout);
    expect(list).toMatchObject({ format: "wachiman.profiles/1", profiles: [{ name: "work-a", kind: "external", registered: true, usedBy: [] }] });
    const setup = m.run(["setup", "--profile", "work-a", "--repo-dir", m.repo]);
    expect(setup.code).toBe(0);
    expect(setup.stderr).toContain("bound: app → work-a (home config, nothing written in the repository)");
    const shown = JSON.parse(m.run(["project", "show", "--json"], { WACHIMAN_PROFILE: "work-a" }).stdout);
    expect(shown.binding.profile).toBe("work-a");
    expect(shown.resolved).toMatchObject({ profile: "work-a", rung: "binding" });
    expect(JSON.parse(m.run(["profile", "list", "--json"]).stdout).profiles[0].usedBy).toEqual([repositoryKey(m.repo).key]);
    expect(JSON.parse(readFileSync(join(m.home, "config.json"), "utf8")).projects[repositoryKey(m.repo).key].profile).toBe("work-a");
    expect(snapshotTree(m.repo)).toEqual(before);
    expect(m.run(["project", "unbind", "--yes"]).code).toBe(0);
    expect(JSON.parse(m.run(["project", "show", "--json"]).stdout)).not.toHaveProperty("binding");
  });

  test("usage errors exit 2: a refused add, --delete-dir on an external profile, an unknown subcommand", () => {
    const m = machine();
    expect(m.run(["profile", "add", "w", "--config-dir", "relative"]).code).toBe(2);
    m.run(["profile", "add", "work-a", "--config-dir", m.workDir]);
    expect(m.run(["profile", "remove", "work-a", "--delete-dir", "--yes"]).code).toBe(2);
    expect(m.run(["profile", "frob"]).code).toBe(2);
    expect(m.run(["project", "use", "x"]).code).toBe(2);
    expect(m.run(["profile", "remove", "work-a"]).code).toBe(2); // no TTY, no --yes
    expect(m.run(["profile", "remove", "work-a", "--yes"]).code).toBe(0);
  });

  test("--help of each command exits 0 and writes nothing", () => {
    const m = machine();
    for (const args of [["setup", "--help"], ["doctor", "--help"], ["profile", "--help"], ["profile", "add", "--help"], ["project", "show", "--help"]]) {
      const out = m.run(args);
      expect(out.code).toBe(0);
      expect(out.stdout).toContain("wachiman ");
    }
    expect(existsSync(m.home)).toBe(false);
  });

  test("doctor --json on a machine fixture: every row, an unobserved network on the auth row, exit 0; the API key turns it to exit 1", () => {
    const m = machine();
    const ok = m.run(["doctor", "--json"]);
    expect(ok.code).toBe(0);
    const report = JSON.parse(ok.stdout);
    expect(report.checks.map((r: { id: string }) => r.id)).toEqual([
      "wachiman", "bun", "git", "tar", "config", "profile", "auth", "environment", "project", "settings", "workflow-pin", "history", "skills", "isolation",
    ]);
    expect(report.checks.find((r: { id: string }) => r.id === "auth")).toMatchObject({ status: "ok", detail: { networkObserved: "unknown" } });
    expect(report).toMatchObject({ format: "wachiman.doctor/1", exitCode: 0, failedRequired: 0 });
    const keyed = m.run(["doctor", "--json"], { ANTHROPIC_API_KEY: "sk-ant-secret" });
    expect(keyed.code).toBe(1);
    const failing = JSON.parse(keyed.stdout);
    expect(failing.checks.find((r: { id: string }) => r.id === "environment").status).toBe("fail");
    expect(failing.exitCode).toBe(1);
    expect(keyed.stdout).not.toContain("sk-ant-secret");
    const text = m.run(["doctor"]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("Required");
    expect(m.run(["doctor", "--profile", "x", "--all-profiles"]).code).toBe(2);
  });

  test("a relative WACHIMAN_HOME is a usage error for every account command", () => {
    const m = machine();
    for (const args of [["doctor"], ["profile", "list"], ["project", "show"], ["setup", "--profile", "x"]]) {
      expect(m.run(args, { WACHIMAN_HOME: "relative" }).code).toBe(2);
    }
  });
});

