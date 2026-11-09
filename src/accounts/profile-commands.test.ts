import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { buildChildEnv } from "../providers/claude-code";
import { readConfig, type WachimanConfigV1 } from "./config";
import { type AccountDeps, type InteractiveSpawn, parseProfileArgs, runProfile } from "./commands";
import type { SpawnFn } from "./confirm";

const scratch: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

const NOW = "2026-11-09T12:00:00.000Z";

interface Harness {
  home: string;
  userHome: string;
  env: Record<string, string>;
  out: string[];
  err: string[];
  asked: string[];
  interactiveCalls: { binary: string; args: string[]; cwd: string; env: Record<string, string>; stdio: string }[];
  probes: { binary: string; args: string[] }[];
  run: (argv: string[], deps?: AccountDeps) => number;
  config: () => WachimanConfigV1 | undefined;
}

/** A Wachiman home and a user home in temp directories; every spawn is recorded and nothing real runs. */
function harness(opts: { answers?: ("yes" | "no" | "cancel")[]; authHelp?: string; probeStatus?: number } = {}): Harness {
  const home = join(temp("wachiman-home-"), ".wachiman");
  const userHome = temp("wachiman-user-");
  const env = { PATH: "/usr/bin", HOME: userHome, USER: "me", WACHIMAN_HOME: home };
  const answers = [...(opts.answers ?? [])];
  const h: Harness = {
    home,
    userHome,
    env,
    out: [],
    err: [],
    asked: [],
    interactiveCalls: [],
    probes: [],
    run(argv, deps = {}) {
      const spawn: SpawnFn = (binary, args) => {
        h.probes.push({ binary, args });
        return { status: opts.probeStatus ?? 0, stdout: opts.authHelp ?? "Commands:\n  login [options]   Sign in\n  logout\n  status [options]\n", stderr: "" };
      };
      const interactiveSpawn: InteractiveSpawn = (binary, args, o) => {
        h.interactiveCalls.push({ binary, args, cwd: o.cwd, env: o.env, stdio: o.stdio });
        return { status: 0 };
      };
      return runProfile(parseProfileArgs(argv), env, { stdout: (t) => h.out.push(t), stderr: (l) => h.err.push(l) }, {
        spawn,
        interactiveSpawn,
        now: () => NOW,
        userHome,
        ask: (q) => (h.asked.push(q), answers.shift() ?? "cancel"),
        interactive: true,
        ...deps,
      });
    },
    config() {
      const read = readConfig(home);
      return read.kind === "ok" ? read.config : undefined;
    },
  };
  return h;
}

/** An executable regular file standing in for a `claude` binary; nothing ever runs it. */
function fakeBinary(name = "claude", mode = 0o755) {
  const path = join(temp("wachiman-bin-"), name);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, mode);
  return path;
}

const seed = (h: Harness, config: Partial<WachimanConfigV1>) => {
  mkdirSync(h.home, { recursive: true });
  writeFileSync(join(h.home, "config.json"), JSON.stringify({ version: 1, profiles: {}, projects: {}, ...config }));
};
const binding = (profile: string) => ({ profile, keyedBy: "path" as const, name: "r", boundAt: "t", boundFrom: "/r" });

describe("profile add", () => {
  test("registers an external profile with its directory, binary and note, and opens nothing inside the directory", () => {
    const h = harness();
    const dir = temp("claude-work-a-");
    const binary = fakeBinary();
    expect(h.run(["add", "work-a", "--config-dir", dir, "--binary", binary, "--note", "the work account"])).toBe(0);
    expect(h.config()?.profiles["work-a"]).toEqual({ kind: "external", configDir: dir, binary, createdAt: NOW, note: "the work account" });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a leading ~ in --config-dir is expanded to the user's home", () => {
    const h = harness();
    mkdirSync(join(h.userHome, ".claude-work-b"));
    expect(h.run(["add", "work-b", "--config-dir", "~/.claude-work-b"])).toBe(0);
    expect(h.config()?.profiles["work-b"]).toMatchObject({ kind: "external", configDir: join(h.userHome, ".claude-work-b") });
    expect(h.config()?.profiles["work-b"]).not.toHaveProperty("binary");
  });

  test("refuses a relative, missing or non-directory --config-dir and writes nothing", () => {
    const h = harness();
    const file = join(temp("wachiman-file-"), "f");
    writeFileSync(file, "x");
    expect(() => h.run(["add", "w", "--config-dir", "relative/dir"])).toThrow(/absolute/);
    expect(() => h.run(["add", "w", "--config-dir", join(tmpdir(), "wachiman-does-not-exist-xyz")])).toThrow(/does not exist/);
    expect(() => h.run(["add", "w", "--config-dir", file])).toThrow(/not a directory/);
    expect(existsSync(join(h.home, "config.json"))).toBe(false);
  });

  test("refuses a directory under the Wachiman home, also through a symbolic link", () => {
    const h = harness();
    const inside = join(h.home, "claude-other");
    mkdirSync(inside, { recursive: true });
    expect(() => h.run(["add", "w", "--config-dir", inside])).toThrow(/under the Wachiman home/);
    const link = join(temp("wachiman-link-"), "link");
    symlinkSync(inside, link);
    expect(() => h.run(["add", "w", "--config-dir", link])).toThrow(/under the Wachiman home/);
    expect(existsSync(join(h.home, "config.json"))).toBe(false);
  });

  test("refuses a --binary that is relative, missing, not a regular file, not executable or an npm shim", () => {
    const h = harness();
    const dir = temp("claude-w-");
    const add = (binary: string) => h.run(["add", "w", "--config-dir", dir, "--binary", binary]);
    expect(() => add("claude")).toThrow(/absolute/);
    expect(() => add(join(tmpdir(), "wachiman-no-such-binary"))).toThrow(/does not exist/);
    expect(() => add(temp("wachiman-bin-dir-"))).toThrow(/not a regular file/);
    expect(() => add(fakeBinary("claude", 0o644))).toThrow(/not executable/);
    for (const shim of ["claude.cmd", "claude.bat", "claude.ps1"]) {
      expect(() => add(fakeBinary(shim))).toThrow(/npm shim.*claude\.exe/);
    }
    expect(existsSync(join(h.home, "config.json"))).toBe(false);
  });

  test("refuses the reserved names, a bad name, a registered name and the name of a managed directory", () => {
    const h = harness();
    const dir = temp("claude-w-");
    expect(() => h.run(["add", "default", "--config-dir", dir])).toThrow(/reserved/);
    expect(() => h.run(["add", "isolated", "--config-dir", dir])).toThrow(/reserved/);
    expect(() => h.run(["add", "Bad_Name", "--config-dir", dir])).toThrow(/not a profile name/);
    mkdirSync(join(h.home, "claude-taken"), { recursive: true });
    expect(() => h.run(["add", "taken", "--config-dir", dir])).toThrow(/managed directory/);
    expect(h.run(["add", "first", "--config-dir", dir])).toBe(0);
    expect(() => h.run(["add", "first", "--config-dir", dir])).toThrow(/already registered/);
    expect(Object.keys(h.config()!.profiles)).toEqual(["first"]);
  });

  test("needs a name and --config-dir", () => {
    const h = harness();
    expect(() => h.run(["add", "--config-dir", "/x"])).toThrow(UsageError);
    expect(() => h.run(["add", "w"])).toThrow(/--config-dir/);
  });
});

describe("profile list", () => {
  test("--json prints ProfileList: registered profiles, unregistered managed directories, the default and who uses each", () => {
    const h = harness();
    const dir = temp("claude-w-");
    seed(h, {
      defaultProfile: "work-a",
      profiles: { "work-a": { kind: "external", configDir: dir, binary: "/opt/claude/claude", createdAt: "t" } },
      projects: { "app-aaaaaaaa": binding("work-a"), "lib-bbbbbbbb": binding("isolated:scratch"), "x-cccccccc": binding("default") },
    });
    mkdirSync(join(h.home, "claude-scratch"));
    mkdirSync(join(h.home, "not-a-profile"));
    expect(h.run(["list", "--json"])).toBe(0);
    expect(JSON.parse(h.out.join(""))).toEqual({
      format: "wachiman.profiles/1",
      defaultProfile: "work-a",
      profiles: [
        { name: "work-a", kind: "external", configDir: dir, binary: "/opt/claude/claude", registered: true, usedBy: ["app-aaaaaaaa"] },
        { name: "scratch", kind: "managed", configDir: join(h.home, "claude-scratch"), registered: false, usedBy: ["lib-bbbbbbbb"] },
      ],
    });
    expect(h.out.join("").trim().split("\n").length).toBeGreaterThan(1);
  });

  test("the text output marks the default and the unregistered directory, and works with no config at all", () => {
    const h = harness();
    expect(h.run(["list"])).toBe(0);
    expect(h.out.join("")).toContain("No profiles registered");
    const dir = temp("claude-w-");
    seed(h, { defaultProfile: "work-a", profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
    mkdirSync(join(h.home, "claude-scratch"));
    h.out.length = 0;
    expect(h.run(["list"])).toBe(0);
    const text = h.out.join("");
    expect(text).toMatch(/work-a +external .*\(default\)/);
    expect(text).toMatch(/scratch +managed .*unregistered/);
  });

  test("lists an external profile whose directory is gone without looking at it, and a corrupt config is a usage error", () => {
    const h = harness();
    seed(h, { profiles: { gone: { kind: "external", configDir: join(tmpdir(), "wachiman-vanished-dir"), createdAt: "t" } } });
    expect(h.run(["list", "--json"])).toBe(0);
    expect(JSON.parse(h.out.join("")).profiles[0].name).toBe("gone");
    writeFileSync(join(h.home, "config.json"), "{ not json");
    expect(() => h.run(["list"])).toThrow(/corrupt/);
  });
});

describe("profile remove", () => {
  const managedWithDir = (h: Harness, name = "scratch") => {
    const dir = join(h.home, `claude-${name}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  test("without --delete-dir the entry goes and the directory stays", () => {
    const h = harness();
    const dir = managedWithDir(h);
    writeFileSync(join(dir, "marker"), "kept");
    seed(h, { profiles: { scratch: { kind: "managed", configDir: dir, createdAt: "t" } } });
    expect(h.run(["remove", "scratch", "--yes"])).toBe(0);
    expect(h.config()?.profiles).toEqual({});
    expect(readFileSync(join(dir, "marker"), "utf8")).toBe("kept");
  });

  test("clears the default and removes every binding that names it, listing them, and leaves the others", () => {
    const h = harness();
    const dir = temp("claude-w-");
    seed(h, {
      defaultProfile: "work-a",
      profiles: {
        "work-a": { kind: "external", configDir: dir, createdAt: "t" },
        "work-b": { kind: "external", configDir: temp("claude-b-"), createdAt: "t" },
      },
      projects: { "app-aaaaaaaa": binding("work-a"), "lib-bbbbbbbb": binding("work-b") },
    });
    expect(h.run(["remove", "work-a"], { interactive: true, ask: (q) => (h.asked.push(q), "yes") })).toBe(0);
    expect(h.asked.join("\n")).toContain("app-aaaaaaaa");
    const config = h.config()!;
    expect(config.defaultProfile).toBeUndefined();
    expect(Object.keys(config.profiles)).toEqual(["work-b"]);
    expect(Object.keys(config.projects)).toEqual(["lib-bbbbbbbb"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("--delete-dir on an external profile is a usage error that changes nothing", () => {
    const h = harness();
    const dir = temp("claude-w-");
    seed(h, { profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
    expect(() => h.run(["remove", "work-a", "--delete-dir", "--yes"])).toThrow(/managed/);
    expect(h.config()?.profiles["work-a"]).toBeDefined();
    expect(existsSync(dir)).toBe(true);
  });

  test("--delete-dir on a managed profile deletes the directory after the entry, names it and mentions the Keychain", () => {
    const h = harness({ answers: ["yes", "yes"] });
    const dir = managedWithDir(h);
    writeFileSync(join(dir, "anything"), "x");
    seed(h, { profiles: { scratch: { kind: "managed", configDir: dir, createdAt: "t" } } });
    expect(h.run(["remove", "scratch", "--delete-dir"])).toBe(0);
    expect(existsSync(dir)).toBe(false);
    expect(h.config()?.profiles).toEqual({});
    expect(h.asked.some((q) => q.includes(dir) && /Keychain/.test(q))).toBe(true);
  });

  test("declining or cancelling a confirm changes nothing (0 for no, 130 for cancel); no TTY without --yes is a usage error", () => {
    const h = harness({ answers: ["no", "cancel"] });
    const dir = temp("claude-w-");
    seed(h, { profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
    expect(h.run(["remove", "work-a"])).toBe(0);
    expect(h.run(["remove", "work-a"])).toBe(130);
    expect(h.config()?.profiles["work-a"]).toBeDefined();
    expect(() => h.run(["remove", "work-a"], { interactive: false })).toThrow(/--yes/);
    expect(h.config()?.profiles["work-a"]).toBeDefined();
  });

  test("an unknown name is a usage error; a dangling reference can still be removed by name", () => {
    const h = harness();
    expect(() => h.run(["remove", "ghost", "--yes"])).toThrow(/not registered/);
    seed(h, { projects: { "app-aaaaaaaa": binding("ghost"), "lib-bbbbbbbb": binding("default") } });
    expect(() => h.run(["list"])).toThrow(/corrupt/);
    expect(h.run(["remove", "ghost", "--yes"])).toBe(0);
    expect(Object.keys(h.config()!.projects)).toEqual(["lib-bbbbbbbb"]);
  });

  test("an unregistered managed directory is removed only with --delete-dir", () => {
    const h = harness();
    const dir = managedWithDir(h);
    expect(() => h.run(["remove", "scratch", "--yes"])).toThrow(/not registered/);
    expect(h.run(["remove", "scratch", "--delete-dir", "--yes"])).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("profile default", () => {
  test("sets the default to a name that resolves, clears it with --none, and refuses a name that resolves to nothing", () => {
    const h = harness();
    const dir = temp("claude-w-");
    seed(h, { profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
    expect(h.run(["default", "work-a"])).toBe(0);
    expect(h.config()?.defaultProfile).toBe("work-a");
    expect(() => h.run(["default", "ghost"])).toThrow(/not registered/);
    expect(h.config()?.defaultProfile).toBe("work-a");
    expect(h.run(["default", "--none"])).toBe(0);
    expect(h.config()?.defaultProfile).toBeUndefined();
    expect(() => h.run(["default"])).toThrow(UsageError);
    expect(() => h.run(["default", "work-a", "--none"])).toThrow(UsageError);
  });
});

describe("profile create", () => {
  test("creates the managed directory, registers it and starts claude in an empty directory with the subscription environment", () => {
    const h = harness();
    expect(h.run(["create", "scratch"])).toBe(0);
    const dir = join(h.home, "claude-scratch");
    expect(h.config()?.profiles.scratch).toMatchObject({ kind: "managed", configDir: dir });
    const [call] = h.interactiveCalls;
    expect(call.binary).toBe("claude");
    expect(call.args).toEqual([]);
    expect(call.stdio).toBe("inherit");
    expect(call.env).toEqual(buildChildEnv(h.env, { auth: "subscription", configDir: dir }));
  });
});

describe("profile login", () => {
  test("runs `auth login` on the stored binary, under the profile's directory, and never reads the outcome", () => {
    const h = harness();
    const dir = temp("claude-w-");
    const binary = fakeBinary();
    seed(h, { profiles: { "work-a": { kind: "external", configDir: dir, binary, createdAt: "t" } } });
    expect(h.run(["login", "work-a"])).toBe(0);
    expect(h.probes).toEqual([{ binary, args: ["auth", "--help"] }]);
    const [call] = h.interactiveCalls;
    expect(call.binary).toBe(binary);
    expect(call.args).toEqual(["auth", "login"]);
    expect(call.env).toEqual(buildChildEnv(h.env, { auth: "subscription", configDir: dir }));
    expect(existsSync(call.cwd)).toBe(false); // an empty temporary directory, removed afterwards
    expect(h.err.join("\n")).toContain("wachiman doctor --profile work-a");
  });

  test("without a terminal it refuses with a usage error and starts nothing", () => {
    const h = harness();
    const dir = temp("claude-w-");
    seed(h, { profiles: { "work-a": { kind: "external", configDir: dir, binary: fakeBinary(), createdAt: "t" } } });
    expect(() => h.run(["login", "work-a"], { interactive: false })).toThrow(/needs a terminal/);
    expect(h.probes).toEqual([]);
    expect(h.interactiveCalls).toEqual([]);
  });

  test("a binary without `auth login` gets no arguments and the /login instruction", () => {
    const h = harness({ authHelp: "Commands:\n  status\n" });
    const dir = temp("claude-w-");
    seed(h, { profiles: { "work-a": { kind: "external", configDir: dir, createdAt: "t" } } });
    expect(h.run(["login", "work-a"])).toBe(0);
    expect(h.interactiveCalls[0].binary).toBe("claude");
    expect(h.interactiveCalls[0].args).toEqual([]);
    expect(h.err.join("\n")).toContain("/login");
  });

  test("a managed profile signs in under its own directory; `default` and unknown names are usage errors", () => {
    const h = harness();
    mkdirSync(join(h.home, "claude-scratch"), { recursive: true });
    expect(h.run(["login", "isolated:scratch"])).toBe(0);
    expect(h.interactiveCalls[0].env.CLAUDE_CONFIG_DIR).toBe(join(h.home, "claude-scratch"));
    expect(() => h.run(["login", "default"])).toThrow(/your own claude/);
    expect(() => h.run(["login", "ghost"])).toThrow(/not registered/);
    expect(h.interactiveCalls.length).toBe(1);
  });

  test("a stored binary that stopped being executable is refused before anything starts", () => {
    const h = harness();
    const dir = temp("claude-w-");
    const binary = fakeBinary();
    seed(h, { profiles: { "work-a": { kind: "external", configDir: dir, binary, createdAt: "t" } } });
    chmodSync(binary, 0o644);
    expect(() => h.run(["login", "work-a"])).toThrow(/not executable/);
    expect(h.interactiveCalls).toEqual([]);
  });
});

describe("parseProfileArgs", () => {
  test("normalises each subcommand and rejects what the contract does not provide", () => {
    expect(parseProfileArgs(["list", "--json"])).toEqual({ kind: "list", json: true });
    expect(parseProfileArgs(["create"])).toEqual({ kind: "create", name: "isolated" });
    expect(parseProfileArgs(["remove", "a", "--delete-dir", "--yes"])).toEqual({ kind: "remove", name: "a", deleteDir: true, yes: true });
    expect(parseProfileArgs(["default", "--none"])).toEqual({ kind: "default", profile: null });
    expect(parseProfileArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseProfileArgs(["add", "--help"])).toEqual({ kind: "help" });
    expect(() => parseProfileArgs([])).toThrow(/subcommand/);
    expect(() => parseProfileArgs(["set", "x"])).toThrow(/Unknown profile subcommand/);
    expect(() => parseProfileArgs(["list", "extra"])).toThrow(UsageError);
    expect(() => parseProfileArgs(["login"])).toThrow(UsageError);
  });
});
