import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CTRL_C, ESC, scripted } from "../../test/support/scripted-prompt";
import { fakeToolchain, signedIn, type RecordedCall, type Tools } from "../../test/support/fake-toolchain";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { snapshotTree } from "../../test/support/tree-snapshot";
import { type AccountDeps, type InteractiveSpawn } from "../accounts/commands";
import { readConfig, updateConfig, type WachimanConfigV1 } from "../accounts/config";
import { repositoryKey } from "../history/store";
import { UsageError } from "../config";
import { parseSetupFlags } from "./args";
import { runSetupCommand, type SetupDeps } from "./run";
import { createPrompter } from "../wizard/prompt";

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

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error("setup must not use the network");
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const NOW = "2026-11-09T12:00:00.000Z";

function world(opts: { profiles?: Record<string, unknown>; defaultProfile?: string; projects?: Record<string, unknown>; tools?: Tools } = {}) {
  const home = join(temp("wachiman-wiz-"), ".wachiman");
  const userHome = temp("wachiman-wiz-user-");
  const workA = temp("claude-work-a-");
  const workB = temp("claude-work-b-");
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n" }, "init");
  git(repo, "remote", "add", "origin", "https://user:token@github.com/acme/app.git");
  const key = repositoryKey(repo).key;
  mkdirSync(home, { recursive: true });
  const initial = {
    version: 1,
    profiles: opts.profiles ?? {
      "work-a": { kind: "external", configDir: workA, createdAt: "t" },
      "work-b": { kind: "external", configDir: workB, binary: undefined, createdAt: "t" },
    },
    projects: opts.projects ?? {},
    ...(opts.defaultProfile ? { defaultProfile: opts.defaultProfile } : {}),
  };
  writeFileSync(join(home, "config.json"), JSON.stringify(initial));
  const toolchain = fakeToolchain(opts.tools ?? {});
  const interactiveCalls: { binary: string; args: string[]; cwd: string; env: Record<string, string> }[] = [];
  let signIn: (call: { binary: string; env: Record<string, string> }) => void = () => {};
  const w = {
    home,
    userHome,
    workA,
    workB,
    repo,
    key,
    env: { PATH: "/usr/bin", HOME: userHome, USER: "me", WACHIMAN_HOME: home } as Record<string, string>,
    out: [] as string[],
    err: [] as string[],
    calls: toolchain.calls as RecordedCall[],
    interactiveCalls,
    onInteractive: (fn: typeof signIn) => void (signIn = fn),
    io: undefined as unknown as { stdout: (t: string) => void; stderr: (l: string) => void },
    configText: () => readFileSync(join(home, "config.json"), "utf8"),
    config: () => {
      const read = readConfig(home);
      return read.kind === "ok" ? (read.config as WachimanConfigV1) : undefined;
    },
    deps(extra: SetupDeps = {}): SetupDeps {
      const interactiveSpawn: InteractiveSpawn = (binary, args, o) => {
        interactiveCalls.push({ binary, args, cwd: o.cwd, env: o.env });
        signIn({ binary, env: o.env });
        return { status: 0 };
      };
      return {
        spawn: (binary, args, o) => (args[0] === "auth" && args[1] === "--help" ? { status: 0, stdout: "Commands:\n  login\n  status\n", stderr: "" } : toolchain.spawn(binary, args, o)),
        interactiveSpawn,
        now: () => NOW,
        userHome,
        interactive: true,
        doctor: { version: "1.9.0", install: { kind: "source", root: "/opt/wachiman" }, platform: "darwin", arch: "arm64", userHome },
        ...extra,
      };
    },
  };
  w.io = { stdout: (t) => void w.out.push(t), stderr: (l) => void w.err.push(l) };
  return w;
}
type World = ReturnType<typeof world>;

const setup = (w: World, argv: string[], lines: string[], extra: SetupDeps = {}) => {
  const io = scripted(lines);
  const run = runSetupCommand(parseSetupFlags(argv, w.repo), w.env, w.io, w.deps({ promptIO: io, ...extra }));
  return { io, run };
};
const errText = (w: World) => w.err.join("\n");

describe("setup on a terminal", () => {
  test("lists the registered profiles with the default marked, offers register and create, and shows the binding before saving", async () => {
    const w = world({ defaultProfile: "work-b" });
    const { io, run } = setup(w, [], ["", "2", ""]); // set up? / pick work-a / bind?
    expect(await run).toBe(0);
    const printed = io.printed();
    expect(printed).toMatch(/2\. work-a {2}external/);
    expect(printed).toContain(`${w.workA}, claude from PATH`);
    expect(printed).toMatch(/3\. work-b {2}external {2}.*\(global default\) \(default\)/);
    expect(printed).toContain("5. Register an existing Claude configuration directory (external)");
    expect(printed).toContain("4. Create a new isolated profile (managed)");
    // The final summary shows name, kind, directory, binary and the scope, before the question.
    const summary = printed.slice(printed.indexOf("Bind this repository:"));
    expect(summary).toContain("profile:    work-a");
    expect(summary).toContain("kind:       external");
    expect(summary).toContain(`directory:  ${w.workA}`);
    expect(summary).toContain("binary:     claude from PATH");
    expect(summary).toContain("keyed by origin: https://github.com/acme/app");
    expect(summary).toContain("every clone and worktree of this origin will use it");
    expect(summary.indexOf("scope:")).toBeLessThan(summary.indexOf("Bind app to work-a?"));
  });

  test("it saves only the binding, then ends with the doctor summary and the local line, and calls no model", async () => {
    const w = world();
    const before = w.config()!;
    const { run } = setup(w, [], ["", "2", ""]);
    expect(await run).toBe(0);
    const after = w.config()!;
    expect(after.profiles).toEqual(before.profiles);
    expect(after.projects[w.key]).toMatchObject({ profile: "work-a", keyedBy: "remote", name: "app", boundAt: NOW, boundFrom: w.repo });
    const said = errText(w);
    expect(said).toContain("bound: app → work-a (home config; nothing written in the repository)");
    expect(said).toContain("doctor:");
    expect(said).toContain("All required checks passed.");
    expect(said.indexOf("bound:")).toBeLessThan(said.indexOf("doctor:"));
    expect(said.trimEnd().split("\n").pop()).toBe(`next: wachiman local --repo-dir ${w.repo}`);
    // The only processes started are version and auth probes; no `claude -p`, no terminal child.
    expect(w.calls.every((c) => c.args[0] === "--version" || (c.args[0] === "auth" && c.args[1] === "status"))).toBe(true);
    expect(w.interactiveCalls).toEqual([]);
    expect(w.out).toEqual([]);
  });

  test("nothing is written in the repository", async () => {
    const w = world();
    const before = snapshotTree(w.repo);
    const { run } = setup(w, [], ["", "2", ""]);
    await run;
    expect(snapshotTree(w.repo)).toEqual(before);
  });

  test("defaults taken by Enter equal the printed defaults: the global default row", async () => {
    const w = world({ defaultProfile: "work-b" });
    const { io, run } = setup(w, [], ["", "", ""]); // every question: Enter
    await run;
    expect(io.printed()).toContain("Set up this repository? [Y/n]");
    expect(io.printed()).toMatch(/3\. work-b.*\(default\)/);
    expect(io.printed()).toContain("Choice [3]:");
    expect(w.config()!.projects[w.key].profile).toBe("work-b");
  });

  test("defaults by Enter: the current binding wins over the global default, and re-running keeps it", async () => {
    const w = world({ defaultProfile: "work-b" });
    const first = setup(w, ["--profile", "work-a"], ["", ""]);
    await first.run;
    expect(w.config()!.projects[w.key].profile).toBe("work-a");
    const again = setup(w, [], ["", "", ""]);
    await again.run;
    expect(again.io.printed()).toContain("currently bound to work-a");
    expect(again.io.printed()).toMatch(/2\. work-a.*\(current\).*\(default\)/);
    expect(w.config()!.projects[w.key].profile).toBe("work-a");
  });

  test("a fresh home uses the current Claude session without registering a profile", async () => {
    const w = world({ profiles: {} });
    const { io, run } = setup(w, [], ["", "", ""]);
    expect(await run).toBe(0);
    expect(io.printed()).toMatch(/1\. Use my current Claude session.*\(default\)/);
    expect(io.printed()).not.toContain("Configuration directory (absolute");
    expect(w.config()!.profiles).toEqual({});
    expect(w.config()!.projects[w.key].profile).toBe("default");
  });

  test("a binding to default wins over a registered global default", async () => {
    const w = world({ defaultProfile: "work-b" });
    await setup(w, ["--profile", "default"], ["", ""]).run;
    const again = setup(w, [], ["", "", ""]);
    expect(await again.run).toBe(0);
    expect(again.io.printed()).toMatch(/1\. Use my current Claude session.*\(current\).*\(default\)/);
    expect(w.config()!.projects[w.key].profile).toBe("default");
  });

  test("a global default session is the printed selection", async () => {
    const w = world({ defaultProfile: "default" });
    const { io, run } = setup(w, [], ["", "", ""]);
    expect(await run).toBe(0);
    expect(io.printed()).toMatch(/1\. Use my current Claude session.*\(global default\).*\(default\)/);
    expect(w.config()!.projects[w.key].profile).toBe("default");
  });

  test("a signed-out current session keeps its binding and reports repair without choosing another account", async () => {
    const w = world({ profiles: {}, tools: { auth: () => ({ status: 1, stdout: JSON.stringify({ loggedIn: false }) }) } });
    const { run } = setup(w, [], ["", "", ""]);
    expect(await run).toBe(1);
    expect(w.config()!.projects[w.key].profile).toBe("default");
    expect(w.config()!.profiles).toEqual({});
    expect(errText(w)).toContain("sign in with your own `claude` (run it and use /login)");
    expect(w.interactiveCalls).toEqual([]);
  });

  test("answering no to Set up this repository? exits 0 and writes nothing", async () => {
    const w = world();
    const before = w.configText();
    const { run } = setup(w, [], ["n"]);
    expect(await run).toBe(0);
    expect(w.configText()).toBe(before);
    expect(errText(w)).toContain("nothing saved");
  });

  test("--profile on a terminal skips the profile question, and an unknown name is exit 2 before any prompt", async () => {
    const w = world();
    const ok = setup(w, ["--profile", "work-b"], ["", ""]);
    expect(await ok.run).toBe(0);
    expect(ok.io.printed()).not.toContain("Which account profile");
    expect(w.config()!.projects[w.key].profile).toBe("work-b");
    const bad = setup(w, ["--profile", "ghost"], [""]);
    await expect(bad.run).rejects.toBeInstanceOf(UsageError);
    expect(bad.io.printed()).toBe("");
  });

  test("--json prints the project document on stdout alone", async () => {
    const w = world();
    const { run } = setup(w, ["--json"], ["", "2", ""]);
    await run;
    expect(w.out).toHaveLength(1);
    expect(JSON.parse(w.out[0])).toMatchObject({ format: "wachiman.project/1", binding: { profile: "work-a" } });
  });

  test("a doctor failure after the save still exits 1 and says the binding was written", async () => {
    const w = world({ tools: { git: null } });
    const { run } = setup(w, ["--profile", "work-a"], ["", ""]);
    expect(await run).toBe(1);
    expect(errText(w)).toContain("the binding was written");
    expect(w.config()!.projects[w.key].profile).toBe("work-a");
  });
});

describe("setup: registering an external directory", () => {
  const external = (w: World) => {
    const dir = join(w.userHome, ".claude-client");
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  test("registration and binding are saved together, only after the final confirmation; the proposed name is the printed default", async () => {
    const w = world();
    const dir = external(w);
    const { io, run } = setup(w, [], ["", "5", "~/.claude-client", "", "", ""]); // set up? / register / dir / binary / name / bind?
    expect(await run).toBe(0);
    expect(io.printed()).toContain("claude binary (leave empty for PATH)");
    expect(io.printed()).toContain("Profile name [claude-client]");
    const config = w.config()!;
    expect(config.profiles["claude-client"]).toEqual({ kind: "external", configDir: dir, createdAt: NOW });
    expect(config.projects[w.key].profile).toBe("claude-client");
    expect(Object.keys(config.profiles).sort()).toEqual(["claude-client", "work-a", "work-b"]);
    expect(errText(w)).toContain("with the new profile claude-client");
    expect(io.printed()).toContain("will write: ");
    expect(io.printed()).toContain("registering claude-client and binding app together");
  });

  test("a stored binary must be an absolute executable; a bad answer is asked again", async () => {
    const w = world();
    external(w);
    const bin = join(temp("fake-bin-"), "claude");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    const { io, run } = setup(w, [], ["", "5", "~/.claude-client", "claude", bin, "", ""]);
    expect(await run).toBe(0);
    expect(io.printed()).toContain("claude is not an absolute path");
    expect(w.config()!.profiles["claude-client"]).toMatchObject({ binary: bin });
    expect(io.printed()).toContain(`binary:     ${bin}`);
  });

  test("a directory that does not exist, is a file, or is under the Wachiman home is refused and asked again", async () => {
    const w = world();
    external(w);
    mkdirSync(join(w.home, "inside"), { recursive: true });
    const file = join(w.userHome, "afile");
    writeFileSync(file, "x");
    const { io, run } = setup(w, [], ["", "5", "relative/dir", join(w.userHome, "missing"), file, join(w.home, "inside"), "~/.claude-client", "", "", ""]);
    expect(await run).toBe(0);
    const printed = io.printed();
    expect(printed).toContain("must be an absolute path");
    expect(printed).toContain("does not exist");
    expect(printed).toContain("is not a directory");
    expect(printed).toContain("is under the Wachiman home");
  });

  test("a name that is taken, reserved or malformed is refused and asked again", async () => {
    const w = world();
    external(w);
    const { io, run } = setup(w, [], ["", "5", "~/.claude-client", "", "work-a", "default", "isolated", "Bad Name", "client", ""]);
    expect(await run).toBe(0);
    const printed = io.printed();
    expect(printed).toContain('"work-a" is already registered');
    expect(printed).toContain('"default" is reserved');
    expect(printed).toContain('"isolated" is reserved');
    expect(printed).toContain("is not a profile name");
    expect(w.config()!.profiles.client).toBeDefined();
  });

  test.each([
    ["Escape", ESC],
    ["Ctrl-C", CTRL_C],
    ["Ctrl-D (the input ends)", undefined],
  ])("%s at the final confirmation exits 130 and leaves the config byte for byte unchanged", async (_n, key) => {
    const w = world();
    external(w);
    const before = w.configText();
    const lines = ["", "5", "~/.claude-client", "", "", ...(key ? [key] : [])];
    const { run } = setup(w, [], lines);
    expect(await run).toBe(130);
    expect(w.configText()).toBe(before);
    expect(errText(w)).toContain("cancelled: no configuration changes saved.");
    expect(errText(w)).not.toContain("already happened");
  });

  test("Escape in the middle of the questions changes nothing either", async () => {
    const w = world();
    external(w);
    const before = w.configText();
    const { run } = setup(w, [], ["", "5", "~/.claude-client", ESC]);
    expect(await run).toBe(130);
    expect(w.configText()).toBe(before);
  });

  test("answering no to the final question exits 0 and saves nothing", async () => {
    const w = world();
    external(w);
    const before = w.configText();
    const { run } = setup(w, [], ["", "5", "~/.claude-client", "", "", "n"]);
    expect(await run).toBe(0);
    expect(w.configText()).toBe(before);
  });

  test("a name registered by someone else while the questions were open is caught under the lock and nothing is saved", async () => {
    const w = world();
    const dir = external(w);
    let tampered = false;
    const { run } = setup(w, [], ["", "5", "~/.claude-client", "", "", ""], {
      now: () => {
        if (!tampered) {
          tampered = true;
          updateConfig({ home: w.home }, (c) => ({ ...c, profiles: { ...c.profiles, "claude-client": { kind: "external", configDir: dir, createdAt: "elsewhere" } } }));
        }
        return NOW;
      },
    });
    await expect(run).rejects.toThrow(/was registered meanwhile/);
    expect(w.config()!.profiles["claude-client"]).toMatchObject({ createdAt: "elsewhere" });
    expect(w.config()!.projects).toEqual({});
  });

  test("nothing is opened inside the external directory and nothing is written there", async () => {
    const w = world();
    const dir = external(w);
    const before = snapshotTree(dir);
    const { run } = setup(w, [], ["", "5", "~/.claude-client", "", "", ""]);
    await run;
    expect(snapshotTree(dir)).toEqual(before);
  });
});

describe("setup: creating a managed profile", () => {
  test("the directory and the Claude sign-in need their own confirmation, and nothing is registered until the final one", async () => {
    const w = world();
    const dir = join(w.home, "claude-isolated");
    const { io, run } = setup(w, [], ["", "4", "", "", ""]); // set up? / create / name / create dir? / bind?
    expect(await run).toBe(0);
    expect(io.printed()).toContain("Profile name [isolated]");
    expect(io.printed()).toContain(`Create ${dir} (mode 0700) and open Claude there so you can sign in?`);
    expect(w.interactiveCalls).toHaveLength(1);
    expect(w.interactiveCalls[0]).toMatchObject({ binary: "claude", args: [] });
    expect(w.interactiveCalls[0].env.CLAUDE_CONFIG_DIR).toBe(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(w.config()!.profiles.isolated).toMatchObject({ kind: "managed", configDir: dir });
    expect(w.config()!.projects[w.key].profile).toBe("isolated");
  });

  test("a cancellation after the directory and the sign-in leaves the config unchanged and reports exactly what happened, never a rollback", async () => {
    const w = world();
    const dir = join(w.home, "claude-isolated");
    const before = w.configText();
    const { run } = setup(w, [], ["", "4", "", "", ESC]);
    expect(await run).toBe(130);
    expect(w.configText()).toBe(before);
    expect(existsSync(dir)).toBe(true);
    const said = errText(w);
    expect(said).toContain("cancelled: no configuration changes saved.");
    expect(said).toContain("These already happened and were not undone:");
    expect(said).toContain(`created the managed directory ${dir}`);
    expect(said).toContain(`opened Claude for the sign-in in ${dir}`);
    expect(said).not.toMatch(/rolled back|removed|deleted/);
  });

  test("declining the final question after creating reports the same effects and exits 0", async () => {
    const w = world();
    const { run } = setup(w, [], ["", "4", "", "", "n"]);
    expect(await run).toBe(0);
    expect(errText(w)).toContain("These already happened and were not undone:");
    expect(w.config()!.profiles.isolated).toBeUndefined();
  });

  test("declining the side effect returns to the list: nothing is created or launched", async () => {
    const w = world();
    const before = w.configText();
    const { io, run } = setup(w, [], ["", "4", "", "n", ESC]);
    expect(await run).toBe(130);
    expect(w.interactiveCalls).toEqual([]);
    expect(existsSync(join(w.home, "claude-isolated"))).toBe(false);
    expect(io.printed().match(/Which account profile should this repository use\?/g)).toHaveLength(2);
    expect(w.configText()).toBe(before);
    expect(errText(w)).not.toContain("already happened");
  });

  test("an existing managed directory that is not registered is listed as unregistered and can be bound without creating anything", async () => {
    const w = world();
    mkdirSync(join(w.home, "claude-scratch"));
    const { io, run } = setup(w, [], ["", "4", ""]);
    expect(await run).toBe(0);
    expect(io.printed()).toMatch(/4\. scratch {2}managed .*\(unregistered\)/);
    expect(w.interactiveCalls).toEqual([]);
    expect(w.config()!.projects[w.key].profile).toBe("scratch");
    expect(w.config()!.profiles.scratch).toBeUndefined();
  });

  test("the reserved name default cannot be created: refused at the question, before any directory or sign-in", async () => {
    const w = world();
    const { io, run } = setup(w, [], ["", "4", "default", ESC]);
    expect(await run).toBe(130);
    expect(io.printed()).toContain('"default" is reserved');
    expect(w.interactiveCalls).toEqual([]);
  });

  test("a name that is already registered cannot be created again", async () => {
    const w = world();
    const { io, run } = setup(w, [], ["", "4", "work-a", ESC]);
    expect(await run).toBe(130);
    expect(io.printed()).toContain('"work-a" is already registered');
    expect(w.interactiveCalls).toEqual([]);
  });
});

describe("setup: a failed sign-in step", () => {
  test("claude missing: the created managed directory is still reported, and the error is unchanged", async () => {
    const w = world();
    const dir = join(w.home, "claude-isolated");
    const { run } = setup(w, [], ["", "4", "", ""], { interactiveSpawn: () => ({ error: new Error("ENOENT") }) });
    await expect(run).rejects.toThrow();
    expect(existsSync(dir)).toBe(true);
    expect(errText(w)).toContain("These already happened and were not undone:");
    expect(errText(w)).toContain(`created the managed directory ${dir}`);
  });
});

describe("setup: the account check after the save", () => {
  const signedOutUntilLogin = (w: World) => {
    let signed = false;
    w.onInteractive(() => void (signed = true));
    return fakeToolchain({ auth: (dir) => (signed ? signedIn(dir) : { status: 1, stdout: JSON.stringify({ loggedIn: false }) }) });
  };

  test("signed out: Sign in now? yes runs profile login and checks again", async () => {
    const w = world();
    const toolchain = signedOutUntilLogin(w);
    const { io, run } = setup(w, ["--profile", "work-a"], ["", "", "y"], { spawn: (b, a, o) => (a[0] === "auth" && a[1] === "--help" ? { status: 0, stdout: "  login\n", stderr: "" } : toolchain.spawn(b, a, o)) });
    expect(await run).toBe(0);
    expect(io.printed()).toContain("Sign in now? [Y/n]");
    expect(w.interactiveCalls).toHaveLength(1);
    expect(w.interactiveCalls[0].args).toEqual(["auth", "login"]);
    expect(w.interactiveCalls[0].env.CLAUDE_CONFIG_DIR).toBe(w.workA);
    expect(errText(w)).toContain("account: signed in");
  });

  test("signed out: yes, but the sign-in did not take, still prints the warning", async () => {
    const w = world();
    const toolchain = fakeToolchain({ auth: () => ({ status: 1, stdout: JSON.stringify({ loggedIn: false }) }) });
    const { run } = setup(w, ["--profile", "work-a"], ["", "", "y"], { spawn: (b, a, o) => (a[0] === "auth" && a[1] === "--help" ? { status: 0, stdout: "  login\n", stderr: "" } : toolchain.spawn(b, a, o)) });
    expect(await run).toBe(1);
    expect(w.interactiveCalls).toHaveLength(1);
    expect(errText(w)).toContain("warning:");
    expect(errText(w)).toContain("Fix:");
  });

  test("the terminal is handed back before the blocking account probe, so typed-ahead input is not read live", async () => {
    const w = world();
    const toolchain = signedOutUntilLogin(w);
    const log: string[] = [];
    const io = scripted(["", "", "n"]);
    const real = createPrompter(io);
    const prompter = { ...real, suspend: () => (log.push("suspend"), real.suspend()) };
    const spawn: SetupDeps["spawn"] = (b, a, o) => (a[0] === "auth" && a[1] === "status" && log.push("probe"), toolchain.spawn(b, a, o));
    await runSetupCommand(parseSetupFlags(["--profile", "work-a"], w.repo), w.env, w.io, w.deps({ prompter, spawn }));
    expect(log.indexOf("suspend")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("suspend")).toBeLessThan(log.indexOf("probe"));
    real.close();
  });

  test("signed out: no keeps going with the warning", async () => {
    const w = world();
    const toolchain = signedOutUntilLogin(w);
    const { run } = setup(w, ["--profile", "work-a"], ["", "", "n"], { spawn: toolchain.spawn });
    expect(await run).toBe(1); // the doctor summary then fails its auth check
    expect(w.interactiveCalls).toEqual([]);
    expect(errText(w)).toContain("wachiman profile login work-a");
    expect(w.config()!.projects[w.key].profile).toBe("work-a");
  });

  test("Escape at Sign in now? exits 130 and says the binding was saved", async () => {
    const w = world();
    const toolchain = signedOutUntilLogin(w);
    const { run } = setup(w, ["--profile", "work-a"], ["", "", ESC], { spawn: toolchain.spawn });
    expect(await run).toBe(130);
    expect(errText(w)).toContain("the binding of app to work-a was saved and stays");
    expect(w.config()!.projects[w.key].profile).toBe("work-a");
  });
});

describe("setup without a terminal", () => {
  test("--profile binds like slice 0 and never prompts", async () => {
    const w = world();
    const io = scripted([]);
    const code = await runSetupCommand(parseSetupFlags(["--profile", "work-a"], w.repo), w.env, w.io, w.deps({ interactive: false, promptIO: io }));
    expect(code).toBe(0);
    expect(io.printed()).toBe("");
    expect(w.config()!.projects[w.key].profile).toBe("work-a");
  });

  test("no --profile is exit 2 and writes nothing; --yes in a terminal behaves the same", async () => {
    const w = world();
    const before = w.configText();
    await expect(runSetupCommand(parseSetupFlags([], w.repo), w.env, w.io, w.deps({ interactive: false }))).rejects.toThrow(/needs --profile <name> when it cannot ask/);
    await expect(runSetupCommand(parseSetupFlags(["--yes"], w.repo), w.env, w.io, w.deps({ interactive: true }))).rejects.toThrow(/needs --profile <name> when it cannot ask/);
    expect(w.configText()).toBe(before);
  });

  test("it never registers or creates a profile", async () => {
    const w = world();
    await expect(runSetupCommand(parseSetupFlags(["--profile", "ghost"], w.repo), w.env, w.io, w.deps({ interactive: false }))).rejects.toBeInstanceOf(UsageError);
    expect(Object.keys(w.config()!.profiles).sort()).toEqual(["work-a", "work-b"]);
  });
});
