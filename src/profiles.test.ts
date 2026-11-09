import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./config";
import { readConfig, updateConfig } from "./accounts/config";
import { claimManagedProfile, inspectIsolatedProfile, parseProfile, profileDir, setupProfile } from "./profiles";
import { SUBSCRIPTION_ENV } from "./providers/claude-code";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("parseProfile", () => {
  test("returns the spelling for resolveProfile: default, isolated, isolated:<name> or a profile name", () => {
    for (const value of ["default", "isolated", "isolated:work", "work-a"]) expect(parseProfile(value)).toBe(value);
  });

  test.each(["Work", "isolated:", "isolated:../x", "isolated:Work", "isolated:-x", ""])(
    "%p is a usage error",
    (value) => {
      expect(() => parseProfile(value)).toThrow(UsageError);
    },
  );
});

describe("profileDir", () => {
  test("is claude-<name> under the Wachiman home", () => {
    expect(profileDir("work", "/home/me/.wachiman")).toBe("/home/me/.wachiman/claude-work");
  });
});

describe("inspectIsolatedProfile", () => {
  /** Records every path the check opens, so a test can prove what it never read. */
  const recording = () => {
    const opened: string[] = [];
    const read = (path: string) => {
      opened.push(path);
      return readFileSync(path, "utf8");
    };
    return { opened, read };
  };

  test("an empty directory, or one with only a sign-in, holds nothing to refuse", () => {
    const dir = temp("profile-empty-");
    expect(inspectIsolatedProfile(dir)).toEqual([]);
    writeFileSync(join(dir, ".credentials.json"), '{"claudeAiOauth":{"accessToken":"secret"}}');
    writeFileSync(join(dir, ".claude.json"), '{"oauthAccount":{"emailAddress":"me@example.com"},"mcpServers":{"a":{}}}');
    const { opened, read } = recording();
    expect(inspectIsolatedProfile(dir, read)).toEqual([]);
    // The sign-in and the account file are never opened; only settings.json would be.
    expect(opened).toEqual([]);
  });

  test("names every customisation it finds", () => {
    const dir = temp("profile-full-");
    writeFileSync(join(dir, "CLAUDE.md"), "rules");
    for (const sub of ["hooks", "skills", "agents", "commands"]) mkdirSync(join(dir, sub));
    writeFileSync(join(dir, ".mcp.json"), "{}");
    expect(inspectIsolatedProfile(dir).sort()).toEqual([".mcp.json", "CLAUDE.md", "agents/", "commands/", "hooks/", "skills/"]);
  });

  test("a settings.json with hooks or MCP servers is refused; one without either is not", () => {
    const dir = temp("profile-settings-");
    const settings = join(dir, "settings.json");
    const { opened, read } = recording();
    writeFileSync(settings, '{"hooks":{}}');
    expect(inspectIsolatedProfile(dir, read)).toEqual(["settings.json (hooks)"]);
    writeFileSync(settings, '{"mcpServers":{"a":{}}}');
    expect(inspectIsolatedProfile(dir, read)).toEqual(["settings.json (mcpServers)"]);
    writeFileSync(settings, '{"mcpServers":{},"theme":"dark"}');
    expect(inspectIsolatedProfile(dir, read)).toEqual([]);
    writeFileSync(settings, "not json");
    expect(inspectIsolatedProfile(dir, read)).toEqual(["settings.json (unreadable)"]);
    expect(new Set(opened)).toEqual(new Set([settings]));
  });
});

describe("setupProfile", () => {
  /** `home` here is the Wachiman home itself (`~/.wachiman`), not the user's home. */
  const parentEnv = (home: string) => ({
    PATH: "/usr/bin:/bin",
    HOME: home,
    USER: "me",
    CLAUDE_CONFIG_DIR: "/elsewhere",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GH_TOKEN: "t",
  });

  test("an existing Wachiman home keeps its mode, and a home it creates is private", () => {
    const shared = temp("profile-home-");
    chmodSync(shared, 0o755);
    setupProfile({ name: "work", home: shared, env: parentEnv(shared), print: () => {}, spawn: () => ({ status: 0 }) });
    expect(statSync(shared).mode & 0o777).toBe(0o755);
    expect(statSync(join(shared, "claude-work")).mode & 0o777).toBe(0o700);

    const fresh = join(temp("profile-home-"), "made-by-wachiman");
    setupProfile({ name: "work", home: fresh, env: parentEnv(fresh), print: () => {}, spawn: () => ({ status: 0 }) });
    expect(statSync(fresh).mode & 0o777).toBe(0o700);
  });

  test("creates the directory, launches claude in an empty directory with the forced config dir, and cleans up", () => {
    const home = temp("profile-home-");
    const calls: { command: string; args: string[]; cwd: string; env: Record<string, string>; stdio: string; listed: string[] }[] = [];
    const printed: string[] = [];
    const lines = setupProfile({
      name: "work",
      home,
      env: parentEnv(home),
      print: (line) => printed.push(line),
      spawn: (command, args, opts) => {
        calls.push({ ...opts, command, args, listed: readdirSync(opts.cwd) });
        return { status: 0 };
      },
    });
    const dir = join(home, "claude-work");
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.command).toBe("claude");
    expect(call.args).toEqual([]);
    expect(call.stdio).toBe("inherit");
    expect(call.listed).toEqual([]);
    expect(call.cwd.startsWith(dir)).toBe(false);
    expect(existsSync(call.cwd)).toBe(false);
    expect(call.env).toEqual({ PATH: "/usr/bin:/bin", HOME: home, USER: "me", CLAUDE_CONFIG_DIR: dir, ...SUBSCRIPTION_ENV });
    expect(printed).toEqual(lines);
    expect(lines.join("\n")).toContain("/login");
    expect(lines.join("\n")).toContain("/exit");
    expect(lines.at(-1)).toBe(
      "Wachiman did not check whether the sign-in succeeded; run `wachiman local --profile isolated:work` to find out.",
    );
  });

  test("the default name is isolated, and its hint needs no name", () => {
    const home = temp("profile-home-");
    const lines = setupProfile({ home, env: parentEnv(home), print: () => {}, spawn: () => ({ status: 0 }) });
    expect(existsSync(join(home, "claude-isolated"))).toBe(true);
    expect(lines.at(-1)).toContain("`wachiman local --profile isolated`");
  });

  test("a populated directory is refused before claude is launched", () => {
    const home = temp("profile-home-");
    const dir = join(home, "claude-work");
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "rules");
    let launched = false;
    const run = () =>
      setupProfile({
        name: "work",
        home,
        env: parentEnv(home),
        print: () => {},
        spawn: () => {
          launched = true;
          return { status: 0 };
        },
      });
    expect(run).toThrow(UsageError);
    expect(run).toThrow("CLAUDE.md, skills/");
    expect(launched).toBe(false);
  });

  test("an invalid name is a usage error", () => {
    const home = temp("profile-home-");
    expect(() => setupProfile({ name: "../x", home, env: parentEnv(home), print: () => {}, spawn: () => ({ status: 0 }) })).toThrow(UsageError);
  });

  const readOk = (home: string) => {
    const read = readConfig(home);
    if (read.kind !== "ok") throw new Error(`config is ${read.kind}`);
    return read.config;
  };
  const noSpawn = () => ({ status: 0 });

  test("registers the managed profile in the config, keeps every other entry, and is idempotent", () => {
    const home = temp("profile-home-");
    updateConfig({ home }, (c) => ({
      ...c,
      profiles: { "work-a": { kind: "external", configDir: "/Users/me/.claude-work-a", createdAt: "t" } },
      future: { keep: true },
    } as typeof c));
    setupProfile({ name: "work", home, env: parentEnv(home), print: () => {}, spawn: noSpawn });
    setupProfile({ name: "work", home, env: parentEnv(home), print: () => {}, spawn: noSpawn });
    const config = readOk(home);
    expect(Object.keys(config.profiles).sort()).toEqual(["work", "work-a"]);
    expect(config.profiles.work).toMatchObject({ kind: "managed", configDir: join(home, "claude-work") });
    expect(typeof (config.profiles.work as { createdAt: string }).createdAt).toBe("string");
    expect((config as unknown as { future: unknown }).future).toEqual({ keep: true });
  });

  test("a name that an external profile already holds is refused before anything is created or launched", () => {
    const home = temp("profile-home-");
    updateConfig({ home }, (c) => ({ ...c, profiles: { work: { kind: "external", configDir: "/Users/me/.claude-work", createdAt: "t" } } }));
    let launched = false;
    expect(() =>
      setupProfile({ name: "work", home, env: parentEnv(home), print: () => {}, spawn: () => ((launched = true), { status: 0 }) }),
    ).toThrow(/external/);
    expect(launched).toBe(false);
    expect(existsSync(join(home, "claude-work"))).toBe(false);
  });

  test("a corrupt config stops the setup before claude is launched", () => {
    const home = temp("profile-home-");
    writeFileSync(join(home, "config.json"), "{ nope");
    let launched = false;
    expect(() =>
      setupProfile({ name: "work", home, env: parentEnv(home), print: () => {}, spawn: () => ((launched = true), { status: 0 }) }),
    ).toThrow(UsageError);
    expect(launched).toBe(false);
    expect(existsSync(join(home, "claude-work"))).toBe(false);
  });
});

describe("claimManagedProfile", () => {
  const config = (profiles: Record<string, any>): any => ({ version: 1, profiles, projects: {} });

  test("refuses when an external entry appeared under the name after the pre-check, and changes nothing", () => {
    const external = { kind: "external", configDir: "/Users/me/.claude-work", binary: "/opt/claude/claude", createdAt: "2026-11-09T10:00:00Z" };
    const current = config({ work: external });
    expect(() => claimManagedProfile(current, "work", "/wh/claude-work")).toThrow('"work" is already registered as an external profile');
    expect(current.profiles.work).toBe(external);
  });

  test("adds a managed entry when the name is free and keeps an existing managed one", () => {
    const added = claimManagedProfile(config({}), "work", "/wh/claude-work");
    expect(added.profiles.work).toMatchObject({ kind: "managed", configDir: "/wh/claude-work" });
    const managed = config({ work: { kind: "managed", configDir: "/wh/claude-work", createdAt: "x" } });
    expect(claimManagedProfile(managed, "work", "/wh/claude-work")).toBe(managed);
  });
});
