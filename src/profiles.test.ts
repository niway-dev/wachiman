import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./config";
import { inspectIsolatedProfile, parseProfile, profileDir, setupProfile } from "./profiles";
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
  test("default, a bare isolated, and a named isolated profile", () => {
    expect(parseProfile("default")).toEqual({ kind: "default" });
    expect(parseProfile("isolated")).toEqual({ kind: "isolated", name: "isolated" });
    expect(parseProfile("isolated:work")).toEqual({ kind: "isolated", name: "work" });
  });

  test.each(["Work", "isolated:", "isolated:../x", "isolated:Work", "isolated:-x", "other", ""])(
    "%p is a usage error",
    (value) => {
      expect(() => parseProfile(value)).toThrow(UsageError);
    },
  );
});

describe("profileDir", () => {
  test("is claude-<name> under ~/.wachiman", () => {
    expect(profileDir("work", "/home/me")).toBe("/home/me/.wachiman/claude-work");
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
  const parentEnv = (home: string) => ({
    PATH: "/usr/bin:/bin",
    HOME: home,
    USER: "me",
    CLAUDE_CONFIG_DIR: "/elsewhere",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GH_TOKEN: "t",
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
    const dir = join(home, ".wachiman", "claude-work");
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, ".wachiman")).mode & 0o777).toBe(0o700);
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
      "Wachiman did not check whether the sign-in succeeded; run `agent-review local --profile isolated:work` to find out.",
    );
  });

  test("the default name is isolated, and its hint needs no name", () => {
    const home = temp("profile-home-");
    const lines = setupProfile({ home, env: parentEnv(home), print: () => {}, spawn: () => ({ status: 0 }) });
    expect(existsSync(join(home, ".wachiman", "claude-isolated"))).toBe(true);
    expect(lines.at(-1)).toContain("`agent-review local --profile isolated`");
  });

  test("a populated directory is refused before claude is launched", () => {
    const home = temp("profile-home-");
    const dir = join(home, ".wachiman", "claude-work");
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
});
