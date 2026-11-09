import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildChildEnv } from "../providers/claude-code";
import { confirmProfile, type ConfirmIo, type SpawnFn } from "./confirm";
import type { ResolvedProfile } from "./resolve";

const DIR = "/Users/me/.claude-work-a";
const BIN = "/opt/claude/claude";
const external = (extra: { binary?: string } = {}): ResolvedProfile => ({
  profile: { kind: "external", name: "work-a", configDir: DIR, ...extra },
  rung: "flag",
  overridden: [],
});
const managed: ResolvedProfile = { profile: { kind: "managed", name: "personal", configDir: "/wh/claude-personal", registered: true }, rung: "flag", overridden: [] };
const builtIn: ResolvedProfile = { profile: { kind: "default" }, rung: "builtIn", overridden: [] };

const ENV = { PATH: "/usr/bin", HOME: "/Users/me", USER: "me", ANTHROPIC_API_KEY: "sk-ant-secret", GH_TOKEN: "ghp_x", CLAUDE_CONFIG_DIR: "/parent/elsewhere" };

interface Call {
  binary: string;
  args: string[];
  options: Parameters<SpawnFn>[2];
  cwdListing: string[];
}
const cleanup: string[] = [];
afterAll(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fake `claude`: answers `--version` and `auth status`, and records every call. */
function fake(opts: { version?: Partial<ReturnType<SpawnFn>>; auth?: Partial<ReturnType<SpawnFn>> | object } = {}) {
  const calls: Call[] = [];
  const spawn: SpawnFn = (binary, args, options) => {
    cleanup.push(options.cwd);
    calls.push({ binary, args, options, cwdListing: readdirSync(options.cwd) });
    if (args[0] === "--version") return { status: 0, stdout: "2.1.319 (Claude Code)\n", stderr: "", ...(opts.version ?? {}) };
    return { status: 0, stdout: "", stderr: "", ...(opts.auth ?? {}) };
  };
  return { spawn, calls };
}
const signedIn = (extra: Record<string, unknown> = {}, dir: string | null = DIR) =>
  JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", ...(dir === null ? {} : { configDirectory: dir }), email: "me@example.com", orgId: "org-secret", ...extra });

/** Every path the confirmation looked at, and the answer for each. */
function io(overrides: Partial<ConfirmIo> = {}) {
  const looked: string[] = [];
  const impl: ConfirmIo = {
    isDirectory: (p) => (looked.push(p), true),
    isExecutableFile: (p) => (looked.push(p), true),
    realpath: (p) => (looked.push(p), p),
    ...overrides,
  };
  return { impl, looked };
}

describe("confirmProfile", () => {
  test("an external profile signed in with claude.ai in its own directory is confirmed", () => {
    const f = fake({ auth: { stdout: signedIn() } });
    const result = confirmProfile(external({ binary: BIN }), ENV, f.spawn, io().impl);
    expect(result).toEqual({
      ok: true,
      binary: { path: BIN, version: "2.1.319" },
      auth: {
        exitCode: 0,
        authMethod: "claude.ai",
        configDirectory: DIR,
        directory: "matches",
        networkObserved: "unknown",
        summary: expect.stringContaining("claude.ai"),
      },
    });
    // The summary is one line and carries neither the e-mail address nor the raw JSON.
    if (result.ok) {
      expect(result.auth.summary).not.toContain("\n");
      expect(JSON.stringify(result)).not.toContain("me@example.com");
      expect(JSON.stringify(result)).not.toContain("org-secret");
    }
  });

  test("both probes run by path with the subscription environment, an empty directory, a timeout and an output cap", () => {
    const f = fake({ auth: { stdout: signedIn() } });
    confirmProfile(external({ binary: BIN }), ENV, f.spawn, io().impl);
    expect(f.calls.map((c) => [c.binary, c.args])).toEqual([
      [BIN, ["--version"]],
      [BIN, ["auth", "status"]],
    ]);
    for (const call of f.calls) {
      expect(call.options.env).toEqual(buildChildEnv(ENV, { auth: "subscription", configDir: DIR }));
      expect(call.options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(call.options.env.GH_TOKEN).toBeUndefined();
      expect(call.options.env.CLAUDE_CONFIG_DIR).toBe(DIR);
      expect(call.options).toMatchObject({ timeout: 15_000, maxBuffer: 64 * 1024, shell: false, encoding: "utf8" });
      expect(call.cwdListing).toEqual([]);
    }
    // The scratch directory is gone afterwards.
    expect(existsSync(f.calls[0].options.cwd)).toBe(false);
  });

  test("without a stored binary it runs claude from PATH", () => {
    const f = fake({ auth: { stdout: signedIn() } });
    const result = confirmProfile(external(), ENV, f.spawn, io().impl);
    expect(f.calls[0].binary).toBe("claude");
    expect(result).toMatchObject({ ok: true, binary: { path: "claude" } });
  });

  test("the built-in default passes the parent's CLAUDE_CONFIG_DIR through and has no directory to compare", () => {
    const f = fake({ auth: { stdout: signedIn({}, "/parent/elsewhere") } });
    const result = confirmProfile(builtIn, ENV, f.spawn, io().impl);
    expect(f.calls[1].options.env.CLAUDE_CONFIG_DIR).toBe("/parent/elsewhere");
    expect(result).toMatchObject({ ok: true, auth: { directory: "n/a" } });
    // Not even a missing configDirectory matters for the default.
    expect(confirmProfile(builtIn, ENV, fake({ auth: { stdout: signedIn({}, null) } }).spawn, io().impl)).toMatchObject({ ok: true });
  });

  test("exit 1 is an auth failure that names the login command", () => {
    const f = fake({ auth: { status: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }) } });
    const result = confirmProfile(managed, ENV, f.spawn, io().impl);
    expect(result).toMatchObject({ ok: false, stage: "auth", fix: expect.stringContaining("wachiman profile login personal") });
  });

  test("api_key is a failure because a local run would be billed to a key", () => {
    const f = fake({ auth: { stdout: signedIn({ authMethod: "api_key" }) } });
    const result = confirmProfile(external(), ENV, f.spawn, io().impl);
    expect(result).toMatchObject({ ok: false, stage: "auth", problem: expect.stringContaining("billed to a key") });
  });

  test.each(["api_key_helper", "third_party", "unknown", "oauth_token", "something-new"])("authMethod %s is unsupported by the local mode", (authMethod) => {
    const f = fake({ auth: { stdout: signedIn({ authMethod }) } });
    const result = confirmProfile(external(), ENV, f.spawn, io().impl);
    expect(result).toMatchObject({ ok: false, stage: "auth", problem: expect.stringContaining("unsupported by the local mode") });
  });

  test("a binary that does not report configDirectory leaves the directory unverified, which fails", () => {
    const f = fake({ auth: { stdout: signedIn({}, null) } });
    const result = confirmProfile(external(), ENV, f.spawn, io().impl);
    expect(result).toMatchObject({ ok: false, stage: "auth", problem: expect.stringContaining("unverified"), auth: { directory: "unverified" } });
    // An empty string is the same as not reporting it.
    expect(confirmProfile(external(), ENV, fake({ auth: { stdout: signedIn({}, "") } }).spawn, io().impl)).toMatchObject({ ok: false, auth: { directory: "unverified" } });
  });

  test("another directory is a mismatch, which fails and says what may interfere", () => {
    const f = fake({ auth: { stdout: signedIn({}, "/Users/me/.claude") } });
    const result = confirmProfile(external(), ENV, f.spawn, io().impl);
    expect(result).toMatchObject({
      ok: false,
      stage: "auth",
      problem: expect.stringContaining("another directory"),
      auth: { directory: "differs", configDirectory: "/Users/me/.claude" },
    });
  });

  test("the same directory through a symlink still matches", () => {
    const f = fake({ auth: { stdout: signedIn({}, "/private/var/x/.claude-work-a") } });
    const real = io({ realpath: (p) => (p.startsWith("/private") ? DIR : p) });
    expect(confirmProfile(external(), ENV, f.spawn, real.impl)).toMatchObject({ ok: true, auth: { directory: "matches" } });
  });

  test("output that is not JSON, or has no method, is a failure rather than a pass", () => {
    expect(confirmProfile(external(), ENV, fake({ auth: { stdout: "Logged in as someone" } }).spawn, io().impl)).toMatchObject({ ok: false, stage: "auth" });
    expect(confirmProfile(external(), ENV, fake({ auth: { stdout: JSON.stringify({ loggedIn: true }) } }).spawn, io().impl)).toMatchObject({ ok: false, stage: "auth" });
  });

  test("a probe that times out, or overflows its output cap, is a failure that names the cause", () => {
    const timeout = fake({ auth: { status: null, error: Object.assign(new Error("spawnSync claude ETIMEDOUT"), { code: "ETIMEDOUT" }) } });
    expect(confirmProfile(external(), ENV, timeout.spawn, io().impl)).toMatchObject({ ok: false, stage: "auth", problem: expect.stringContaining("ETIMEDOUT") });
    const overflow = fake({ auth: { status: null, error: Object.assign(new Error("ENOBUFS"), { code: "ENOBUFS" }) } });
    expect(confirmProfile(external(), ENV, overflow.spawn, io().impl)).toMatchObject({ ok: false, stage: "auth" });
  });

  test("a binary that does not answer --version stops before auth status", () => {
    const f = fake({ version: { status: 127, stderr: "not found" } });
    const result = confirmProfile(external({ binary: BIN }), ENV, f.spawn, io().impl);
    expect(result).toMatchObject({ ok: false, stage: "binary", problem: expect.stringContaining(BIN) });
    expect(f.calls.length).toBe(1);
    const spawnError = fake({ version: { status: null, error: new Error("spawn ENOENT") } });
    expect(confirmProfile(builtIn, ENV, spawnError.spawn, io().impl)).toMatchObject({ ok: false, stage: "binary" });
  });

  test("a missing directory stops before any process starts, and names the fix per kind", () => {
    const f = fake();
    const absent = io({ isDirectory: () => false });
    expect(confirmProfile(managed, ENV, f.spawn, absent.impl)).toMatchObject({ ok: false, stage: "directory", fix: expect.stringContaining("--setup-profile personal") });
    expect(confirmProfile(external(), ENV, f.spawn, absent.impl)).toMatchObject({ ok: false, stage: "directory" });
    expect(f.calls.length).toBe(0);
  });

  test.each([
    ["a relative path", "claude"],
    ["a .cmd shim", "C:\\tools\\claude.cmd"],
    ["a .bat shim", "/opt/claude/claude.bat"],
    ["a .ps1 shim", "/opt/claude/claude.ps1"],
  ])("a stored binary that is %s is refused at run time", (_label, binary) => {
    const f = fake();
    expect(confirmProfile(external({ binary }), ENV, f.spawn, io().impl)).toMatchObject({ ok: false, stage: "binary" });
    expect(f.calls.length).toBe(0);
  });

  test("a stored binary that is not an executable file is refused", () => {
    const f = fake();
    const nope = io({ isExecutableFile: () => false });
    expect(confirmProfile(external({ binary: BIN }), ENV, f.spawn, nope.impl)).toMatchObject({ ok: false, stage: "binary", problem: expect.stringContaining(BIN) });
    expect(f.calls.length).toBe(0);
  });

  test("Wachiman looks at the directory itself and never at anything inside it", () => {
    const f = fake({ auth: { stdout: signedIn() } });
    const probe = io();
    confirmProfile(external({ binary: BIN }), ENV, f.spawn, probe.impl);
    expect(probe.looked.length).toBeGreaterThan(0);
    for (const path of probe.looked) expect(path === DIR || path === BIN || path === join(DIR)).toBe(true);
    expect(probe.looked.some((p) => p.startsWith(`${DIR}/`))).toBe(false);
  });

  test("a failed confirmation never claims anything about the network", () => {
    const f = fake({ auth: { status: 1, stdout: "{}" } });
    const result = confirmProfile(managed, ENV, f.spawn, io().impl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.auth?.networkObserved).toBe("unknown");
  });
});
