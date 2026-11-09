import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { readConfig, updateConfig, wachimanHome, type WachimanConfigV1 } from "./config";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const KEY = "kaipu-record-3f9a1c2d";

/** A valid config for `home`; each corruption test breaks one field of it. */
function valid(home: string): Record<string, any> {
  return {
    version: 1,
    defaultProfile: "personal",
    profiles: {
      personal: { kind: "managed", configDir: join(home, "claude-personal"), createdAt: "2026-11-09T10:00:00Z" },
      "work-a": { kind: "external", configDir: "/Users/me/.claude-work-a", binary: "/opt/claude/claude", createdAt: "2026-11-09T10:05:00Z" },
    },
    projects: {
      [KEY]: { profile: "work-a", keyedBy: "remote", remote: "ssh://github.com/acme/kaipu-record", name: "kaipu-record", boundAt: "2026-11-09T10:10:00Z", boundFrom: "/Users/me/src/kaipu-record" },
    },
  };
}

/** `readConfig` over an in-memory file: nothing on disk, and the managed directories "exist" only if listed. */
function readOf(home: string, config: unknown, existing: string[] = []) {
  const path = join(home, "config.json");
  return readConfig(home, {
    read: (p) => {
      expect(p).toBe(path);
      return typeof config === "string" ? config : JSON.stringify(config);
    },
    exists: (p) => p === path || existing.includes(p),
  });
}

describe("wachimanHome", () => {
  test("WACHIMAN_HOME when set, else .wachiman under the user's home directory", () => {
    expect(wachimanHome({ WACHIMAN_HOME: "/srv/wachiman" })).toBe("/srv/wachiman");
    expect(wachimanHome({})).toBe(join(require("node:os").homedir(), ".wachiman"));
    // HOME is no longer consulted from the passed environment.
    expect(wachimanHome({ HOME: "/somewhere/else" })).toBe(join(require("node:os").homedir(), ".wachiman"));
  });

  test("a relative or empty WACHIMAN_HOME is a usage error, not a silent fallback", () => {
    expect(() => wachimanHome({ WACHIMAN_HOME: "relative/dir" })).toThrow(UsageError);
    expect(wachimanHome({ WACHIMAN_HOME: "" })).toBe(join(require("node:os").homedir(), ".wachiman"));
  });
});

describe("readConfig", () => {
  const home = "/wh";

  test("no file is absent: no profiles, no bindings, no default", () => {
    expect(readConfig(home, { read: () => "never", exists: () => false })).toEqual({ kind: "absent" });
  });

  test("a real missing config.json on disk is absent", () => {
    expect(readConfig(temp("wh-absent-"))).toEqual({ kind: "absent" });
  });

  test("a dangling config.json symlink is corrupt, naming the path, never absent", () => {
    const real = temp("wh-dangling-");
    symlinkSync(join(real, "nowhere.json"), join(real, "config.json"));
    const read = readConfig(real);
    expect(read.kind).toBe("corrupt");
    if (read.kind === "corrupt") expect(read.path).toBe(join(real, "config.json"));
  });

  test("a Wachiman home that is a dangling symlink is corrupt, naming the home, never absent", () => {
    const parent = temp("wh-dangling-home-");
    const home = join(parent, "home");
    symlinkSync(join(parent, "unmounted-volume"), home);
    const read = readConfig(home);
    expect(read.kind).toBe("corrupt");
    if (read.kind === "corrupt") expect(read.path).toBe(home);
  });

  test("a valid file is returned as it is, with its path", () => {
    const config = valid(home);
    const read = readOf(home, config);
    expect(read).toEqual({ kind: "ok", config, path: join(home, "config.json") });
  });

  test("an unregistered managed directory that exists satisfies a reference", () => {
    const config = valid(home);
    config.defaultProfile = "isolated:old";
    config.projects[KEY].profile = "old2";
    expect(readOf(home, config).kind).toBe("corrupt");
    expect(readOf(home, config, [join(home, "claude-old"), join(home, "claude-old2")]).kind).toBe("ok");
  });

  const corruptions: [string, (c: Record<string, any>) => unknown, string][] = [
    ["not JSON", () => "{ not json", "not valid JSON"],
    ["a JSON array", () => [], "object"],
    ["a wrong version", (c) => ({ ...c, version: 2 }), "version"],
    ["a missing version", (c) => ({ ...c, version: undefined }), "version"],
    ["profiles not an object", (c) => ({ ...c, profiles: [] }), "profiles"],
    ["profiles missing", (c) => ({ ...c, profiles: undefined }), "profiles"],
    ["projects not an object", (c) => ({ ...c, projects: "x" }), "projects"],
    ["an entry that is not an object", (c) => ({ ...c, profiles: { ...c.profiles, bad: "x" } }), "profiles.bad"],
    ["an entry without a kind", (c) => ({ ...c, profiles: { ...c.profiles, bad: { configDir: "/x" } } }), "profiles.bad.kind"],
    ["an entry with an unknown kind", (c) => ({ ...c, profiles: { ...c.profiles, bad: { kind: "cloud", configDir: "/x" } } }), "profiles.bad.kind"],
    ["a relative external configDir", (c) => ({ ...c, profiles: { ...c.profiles, "work-a": { ...c.profiles["work-a"], configDir: "rel/dir" } } }), "profiles.work-a.configDir"],
    ["a missing external configDir", (c) => ({ ...c, profiles: { ...c.profiles, "work-a": { kind: "external" } } }), "profiles.work-a.configDir"],
    ["a relative binary", (c) => ({ ...c, profiles: { ...c.profiles, "work-a": { ...c.profiles["work-a"], binary: "claude" } } }), "profiles.work-a.binary"],
    ["a non-string binary", (c) => ({ ...c, profiles: { ...c.profiles, "work-a": { ...c.profiles["work-a"], binary: 3 } } }), "profiles.work-a.binary"],
    ["a managed configDir elsewhere than <home>/claude-<name>", (c) => ({ ...c, profiles: { ...c.profiles, personal: { ...c.profiles.personal, configDir: "/elsewhere/claude-personal" } } }), "profiles.personal.configDir"],
    ["a profile name that breaks the rule", (c) => ({ ...c, profiles: { ...c.profiles, "Bad Name": c.profiles["work-a"] } }), "profiles.Bad Name"],
    ["a profile named default", (c) => ({ ...c, profiles: { ...c.profiles, default: c.profiles["work-a"] } }), "profiles.default"],
    ["an external profile named isolated", (c) => ({ ...c, profiles: { ...c.profiles, isolated: c.profiles["work-a"] } }), "profiles.isolated"],
    ["a project key that fails the key pattern", (c) => ({ ...c, projects: { "../evil": c.projects[KEY] } }), "projects.../evil"],
    ["a binding that is not an object", (c) => ({ ...c, projects: { [KEY]: "work-a" } }), `projects.${KEY}`],
    ["a dangling binding", (c) => ({ ...c, projects: { [KEY]: { ...c.projects[KEY], profile: "gone" } } }), `projects.${KEY}.profile`],
    ["a binding with a malformed name", (c) => ({ ...c, projects: { [KEY]: { ...c.projects[KEY], profile: "Work" } } }), `projects.${KEY}.profile`],
    ["a dangling defaultProfile", (c) => ({ ...c, defaultProfile: "gone" }), "defaultProfile"],
    ["a non-string defaultProfile", (c) => ({ ...c, defaultProfile: 4 }), "defaultProfile"],
    ["isolated:<n> pointing at an external profile", (c) => ({ ...c, defaultProfile: "isolated:work-a" }), "defaultProfile"],
  ];

  test.each(corruptions)("%s is corrupt and names the field", (_name, corrupt, field) => {
    const read = readOf(home, corrupt(valid(home)));
    expect(read.kind).toBe("corrupt");
    if (read.kind === "corrupt") {
      expect(read.path).toBe(join(home, "config.json"));
      expect(read.problem).toContain(field);
    }
  });

  test("a structural read leaves a dangling reference alone but still rejects broken shape", () => {
    const dangling = valid(home);
    dangling.defaultProfile = "gone";
    const io = { read: () => JSON.stringify(dangling), exists: (p: string) => p === join(home, "config.json") };
    expect(readConfig(home, io).kind).toBe("corrupt");
    expect(readConfig(home, io, { structural: true }).kind).toBe("ok");
    const broken = { ...dangling, profiles: [] };
    expect(readConfig(home, { read: () => JSON.stringify(broken), exists: (p: string) => p === join(home, "config.json") }, { structural: true }).kind).toBe("corrupt");
  });

  test("unknown extra fields at any level are kept, never a reason to fail", () => {
    const config = valid(home);
    config.future = { a: 1 };
    config.profiles.personal.extra = true;
    config.projects[KEY].extra = [1];
    const read = readOf(home, config);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") expect(read.config).toEqual(config as WachimanConfigV1);
  });
});

describe("updateConfig", () => {
  const addProject = (key: string) => (c: WachimanConfigV1): WachimanConfigV1 => ({
    ...c,
    projects: { ...c.projects, [key]: { profile: "default", keyedBy: "path", name: key, boundAt: "t", boundFrom: "/x" } },
  });

  test("starts from an empty config, creates the home at 0700 and the file at 0600", () => {
    const home = join(temp("wh-update-"), "nested", ".wachiman");
    const next = updateConfig({ home }, addProject("a-00000001"));
    expect(next.version).toBe(1);
    expect(Object.keys(next.projects)).toEqual(["a-00000001"]);
    const text = readFileSync(join(home, "config.json"), "utf8");
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    if (process.platform !== "win32") {
      expect(statSync(home).mode & 0o777).toBe(0o700);
      expect(statSync(join(home, "config.json")).mode & 0o777).toBe(0o600);
    }
    // Nothing else is left behind: no lock, no temp file.
    expect(readdirSync(home)).toEqual(["config.json"]);
  });

  test("unknown extra fields survive a write", () => {
    const home = temp("wh-extra-");
    writeFileSync(join(home, "config.json"), JSON.stringify({ version: 1, profiles: {}, projects: {}, future: { keep: "me" } }));
    updateConfig({ home }, addProject("a-00000001"));
    const written = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(written.future).toEqual({ keep: "me" });
    expect(Object.keys(written.projects)).toEqual(["a-00000001"]);
  });

  test("a corrupt file aborts the write, leaves the file as it was and releases the lock", () => {
    const home = temp("wh-corrupt-");
    writeFileSync(join(home, "config.json"), "{ nope");
    expect(() => updateConfig({ home }, addProject("a-00000001"))).toThrow(UsageError);
    expect(readFileSync(join(home, "config.json"), "utf8")).toBe("{ nope");
    expect(existsSync(join(home, "config.json.lock"))).toBe(false);
  });

  test("a mutation that throws, or produces a dangling reference, writes nothing and releases the lock", () => {
    const home = temp("wh-abort-");
    expect(() =>
      updateConfig({ home }, () => {
        throw new UsageError("refused");
      }),
    ).toThrow("refused");
    expect(() => updateConfig({ home }, (c) => ({ ...c, defaultProfile: "ghost" }))).toThrow(/defaultProfile/);
    expect(existsSync(join(home, "config.json"))).toBe(false);
    expect(readdirSync(home)).toEqual([]);
  });

  test("a store with dangling references can be repaired step by step, but a mutation cannot add a new one", () => {
    const home = temp("wh-repair-");
    const bound = (profile: string) => ({ profile, keyedBy: "path" as const, name: "r", boundAt: "t", boundFrom: "/r" });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ version: 1, profiles: {}, projects: { r_aaaaaaaa: bound("ghost1") }, defaultProfile: "ghost2" }),
    );
    expect(() => updateConfig({ home }, (c) => ({ ...c, defaultProfile: "ghost3" }))).toThrow(/ghost3/);
    expect(() => updateConfig({ home }, (c) => ({ ...c, projects: { ...c.projects, s_bbbbbbbb: bound("ghost4") } }))).toThrow(/ghost4/);
    const unbound = updateConfig({ home }, (c) => ({ ...c, projects: {} }));
    expect(unbound.defaultProfile).toBe("ghost2");
    const { defaultProfile: _gone, ...rest } = unbound;
    expect(updateConfig({ home }, () => rest).defaultProfile).toBeUndefined();
  });

  test("a held lock past the timeout throws naming the lock file and its pid, and is left alone", () => {
    const home = temp("wh-lock-");
    const lock = join(home, "config.json.lock");
    writeFileSync(lock, JSON.stringify({ pid: 424242, token: "other", createdAt: "2026-11-09T10:00:00Z" }));
    const started = Date.now();
    let message = "";
    try {
      updateConfig({ home, timeoutMs: 250 }, addProject("a-00000001"));
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      message = (error as Error).message;
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    expect(message).toContain(lock);
    expect(message).toContain("424242");
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  test("a symlinked config file is refused", () => {
    if (process.platform === "win32") return;
    const home = temp("wh-symlink-");
    const target = join(temp("wh-target-"), "real.json");
    writeFileSync(target, "{}");
    symlinkSync(target, join(home, "config.json"));
    expect(() => updateConfig({ home }, addProject("a-00000001"))).toThrow(/symbolic link/);
    expect(readFileSync(target, "utf8")).toBe("{}");
  });

  test("two concurrent Bun processes on one home keep every entry", async () => {
    const home = temp("wh-race-");
    const script = `
      import { updateConfig } from ${JSON.stringify(join(import.meta.dir, "config.ts"))};
      const [home, prefix] = process.argv.slice(1);
      for (let i = 0; i < 12; i++) {
        updateConfig({ home, timeoutMs: 20000 }, (c) => ({
          ...c,
          projects: { ...c.projects, [prefix + "-0000000" + i.toString(16)]: { profile: "default", keyedBy: "path", name: prefix, boundAt: "t", boundFrom: "/x" } },
        }));
      }
    `;
    const spawn = (prefix: string) => Bun.spawn([process.execPath, "-e", script, home, prefix], { stdout: "pipe", stderr: "pipe" });
    const [a, b] = [spawn("alpha"), spawn("beta")];
    const [codeA, codeB] = await Promise.all([a.exited, b.exited]);
    expect([codeA, codeB, await new Response(a.stderr).text(), await new Response(b.stderr).text()]).toEqual([0, 0, "", ""]);
    const read = readConfig(home, { read: (p) => readFileSync(p, "utf8"), exists: existsSync });
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") {
      const keys = Object.keys(read.config.projects);
      expect(keys.length).toBe(24);
      expect(keys.filter((k) => k.startsWith("alpha")).length).toBe(12);
      expect(keys.filter((k) => k.startsWith("beta")).length).toBe(12);
    }
    expect(readdirSync(home)).toEqual(["config.json"]);
  }, 60_000);
});
