import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");

// The installer refuses a linked worktree, and tests may run in one: use a fixture clone.
let home: string;
let root: string;
let installer: string;
let wrapper: string;
let skill: string;
beforeEach(() => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-test-")));
  home = join(tmp, "home");
  root = join(tmp, "clone");
  mkdirSync(home);
  for (const d of ["bin", "scripts", "skills", "src"]) mkdirSync(join(root, d), { recursive: true });
  cpSync(join(repo, "bin/wachiman"), join(root, "bin/wachiman"));
  cpSync(join(repo, "scripts/install-local.sh"), join(root, "scripts/install-local.sh"));
  cpSync(join(repo, "skills/wachiman-review"), join(root, "skills/wachiman-review"), { recursive: true });
  writeFileSync(join(root, "src/cli.ts"), "");
  writeFileSync(join(root, "bunfig.toml"), "");
  Bun.spawnSync(["git", "init", "-q", root]);
  installer = join(root, "scripts/install-local.sh");
  wrapper = join(root, "bin/wachiman");
  skill = join(root, "skills/wachiman-review");
});
afterEach(() => rmSync(resolve(home, ".."), { recursive: true, force: true }));

function run(cmd: string[], env: Record<string, string> = {}) {
  const base: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home, ...env };
  const p = Bun.spawnSync(cmd, { env: base, cwd: root });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

const install = (...args: string[]) => run(["bash", installer, ...args]);

describe("install-local.sh", () => {
  test("links the command and the skill into every config dir", () => {
    mkdirSync(join(home, ".claude"));
    mkdirSync(join(home, ".claude-work"));
    const r = install();
    expect(r.code).toBe(0);
    expect(readlinkSync(join(home, ".local/bin/wachiman"))).toBe(join(root, "bin/wachiman"));
    for (const d of [".agents/skills", ".claude/skills", ".claude-work/skills"]) {
      expect(readlinkSync(join(home, d, "wachiman-review"))).toBe(skill);
    }
    expect(r.out).toMatch(/^link /m);
  });

  test("is idempotent", () => {
    mkdirSync(join(home, ".claude"));
    install();
    const r = install();
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/^(link|repoint|backup) /m);
    expect(r.out).toMatch(/^skip /m);
  });

  test("repoints a stale symlink", () => {
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    Bun.spawnSync(["ln", "-s", "/nonexistent", join(home, ".local/bin/wachiman")]);
    const r = install();
    expect(r.out).toMatch(/^repoint /m);
    expect(readlinkSync(join(home, ".local/bin/wachiman"))).toBe(join(root, "bin/wachiman"));
  });

  test("moves a regular file to the backup folder instead of deleting it", () => {
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    writeFileSync(join(home, ".local/bin/wachiman"), "mine");
    const r = install();
    expect(r.out).toMatch(/^backup /m);
    expect(lstatSync(join(home, ".local/bin/wachiman")).isSymbolicLink()).toBe(true);
    const base = join(home, ".local/state/wachiman-install/backup");
    const stamps = readdirSync(base);
    expect(stamps).toHaveLength(1);
    expect(readdirSync(join(base, stamps[0]!))).toHaveLength(1);
  });

  test("never touches ~/.wachiman", () => {
    mkdirSync(join(home, ".wachiman/claude-x"), { recursive: true });
    mkdirSync(join(home, ".claude"));
    install();
    install("--uninstall");
    expect(readdirSync(join(home, ".wachiman/claude-x"))).toEqual([]);
  });

  test("refuses a CLAUDE_CONFIG_DIR under ~/.wachiman", () => {
    const dir = join(home, ".wachiman/claude-x");
    mkdirSync(dir, { recursive: true });
    const r = run(["bash", installer], { CLAUDE_CONFIG_DIR: dir });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("refusing");
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(join(home, ".local/bin/wachiman"))).toBe(false);
  });

  test("--uninstall removes its links and leaves foreign files", () => {
    mkdirSync(join(home, ".claude"));
    install();
    const r = install("--uninstall");
    expect(r.code).toBe(0);
    expect(existsSync(join(home, ".local/bin/wachiman"))).toBe(false);
    expect(existsSync(join(home, ".claude/skills/wachiman-review"))).toBe(false);
    mkdirSync(join(home, ".claude/skills/wachiman-review"));
    install("--uninstall");
    expect(existsSync(join(home, ".claude/skills/wachiman-review"))).toBe(true);
  });
});

describe("bin/wachiman", () => {
  function stubBun() {
    const bin = join(home, "stub");
    mkdirSync(bin, { recursive: true });
    const p = join(bin, "bun");
    writeFileSync(p, '#!/bin/sh\necho "KEY=${ANTHROPIC_API_KEY-unset}"\nfor a in "$@"; do echo "ARG=$a"; done\n');
    chmodSync(p, 0o755);
    return bin;
  }
  const call = (args: string[], env: Record<string, string> = {}) =>
    run(["bash", wrapper, ...args], {
      PATH: `${stubBun()}:${process.env.PATH}`,
      ANTHROPIC_API_KEY: "sk-x",
      ...env,
    });

  test("passes the Bun flags and leaves the environment alone, the API key included", () => {
    const r = call(["history", "--repo-dir", "."]);
    // The command refuses a key itself, identically through every entry point.
    expect(r.out).toContain("KEY=sk-x");
    expect(r.out).toContain("ARG=--no-env-file");
    expect(r.out).toContain(`ARG=--config=${root}/bunfig.toml`);
    expect(r.out).toContain(`ARG=${root}/src/cli.ts`);
  });

  test("never turns WACHIMAN_PROFILE into a --profile flag: the resolver reads it in-process", () => {
    const env = { WACHIMAN_PROFILE: "isolated:me" };
    for (const args of [["local"], ["history"], ["local", "--profile", "default"]]) {
      const out = call(args, env).out;
      expect(out).not.toContain("isolated:me");
      expect(out.split("\n").filter((l) => l.startsWith("ARG=")).slice(3)).toEqual(args.map((a) => `ARG=${a}`));
    }
  });

  test("follows a symlink to find the engine", () => {
    const link = join(home, "wachiman-link");
    Bun.spawnSync(["ln", "-s", wrapper, link]);
    const r = run(["bash", link, "local"], { PATH: `${stubBun()}:${process.env.PATH}` });
    expect(r.out).toContain(`ARG=${root}/src/cli.ts`);
  });

  test("exits 2 when the engine is missing", () => {
    const r = call(["local"], { WACHIMAN_DIR: join(home, "nope") });
    expect(r.code).toBe(2);
    expect(r.err).toContain("wachiman: no engine at");
  });
});
