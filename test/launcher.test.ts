/**
 * The npm launcher (`bin/wachiman.js`) is a dependency-free Node script. Its argv builder and its
 * `launch` function live in `bin/launcher-args.js`, imported here by Bun, so the tests exercise the
 * very code Node runs. No model, no network; the real `bun` is spawned only by the end-to-end test.
 */
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUN_INSTALL_LINE, bundledBunPath, findBun, launch, launcherArgs, missingBunLines, parseBunVersion, probeBun, resolveBun, versionAtLeast } from "../bin/launcher-args.js";

const root = join(import.meta.dir, "..");

describe("launcherArgs", () => {
  test("begins with the isolation flags and the package's own entry point, then the user's argv untouched", () => {
    const pkg = join("/opt", "lib", "node_modules", "wachiman");
    const argv = ["local", "--base", "main", "--repo-dir", "/work/repo", "--", "-x"];
    expect(launcherArgs(pkg, argv)).toEqual([
      "--no-env-file",
      `--config=${join(pkg, "bunfig.toml")}`,
      join(pkg, "src", "cli.ts"),
      ...argv,
    ]);
  });

  test("does not copy, translate or drop an argument, and does not read the environment", () => {
    const argv = ["local", "--profile", "isolated:work", "ANTHROPIC_API_KEY=x", "--no-env-file"];
    const frozen = Object.freeze([...argv]);
    const before = JSON.stringify(process.env);
    const out = launcherArgs("/p", frozen as string[]);
    expect(out.slice(3)).toEqual(argv);
    expect(JSON.stringify(process.env)).toBe(before);
  });

  test("a package directory with spaces stays one argument each", () => {
    const pkg = join("/Users/Some One/AppData", "wachiman");
    const out = launcherArgs(pkg, []);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(`--config=${join(pkg, "bunfig.toml")}`);
  });
});

describe("bundledBunPath", () => {
  test("is bin/bun.exe inside the directory of the resolved bun package, on every OS", () => {
    const manifest = join("/opt", "wachiman", "node_modules", "bun", "package.json");
    expect(bundledBunPath(() => manifest)).toBe(join("/opt", "wachiman", "node_modules", "bun", "bin", "bun.exe"));
  });

  test("keeps a path with spaces in one piece", () => {
    const manifest = join("/Users/Some One/AppData", "node_modules", "bun", "package.json");
    expect(bundledBunPath(() => manifest)).toBe(join("/Users/Some One/AppData", "node_modules", "bun", "bin", "bun.exe"));
  });

  test("is null when the bun package is not installed", () => {
    expect(
      bundledBunPath(() => {
        throw new Error("Cannot find module 'bun/package.json'");
      }),
    ).toBeNull();
  });

  test("the real lookup starts from the launcher's own directory, not from the working directory", () => {
    // The real module lookup (no injection): a node_modules/bun planted in the cwd must not be found.
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "bundled-hostile-"));
    try {
      const planted = join(dir, "node_modules", "bun");
      mkdirSync(planted, { recursive: true });
      writeFileSync(join(planted, "package.json"), '{"name":"bun","version":"9.9.9"}');
      process.chdir(dir);
      const found = bundledBunPath();
      expect(found === null || !found.startsWith(dir)).toBe(true);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseBunVersion and versionAtLeast", () => {
  test("reads the first numbers of the output and nothing else", () => {
    expect(parseBunVersion("1.4.2\n")).toEqual([1, 4, 2]);
    expect(parseBunVersion("v1.3.0")).toEqual([1, 3, 0]);
    expect(parseBunVersion("1.3.4+abcdef")).toEqual([1, 3, 4]);
    expect(parseBunVersion("")).toBeNull();
    expect(parseBunVersion("stub")).toBeNull();
    expect(parseBunVersion(undefined)).toBeNull();
  });

  test("1.3.0 is the floor", () => {
    expect(versionAtLeast([1, 3, 0])).toBe(true);
    expect(versionAtLeast([1, 2, 99])).toBe(false);
    expect(versionAtLeast([0, 9, 9])).toBe(false);
    expect(versionAtLeast([2, 0, 0])).toBe(true);
    expect(versionAtLeast([1, 10, 0])).toBe(true);
  });
});

type Sync = { status?: number | null; stdout?: string; error?: Error };
/** A fake `spawnSync` that answers per binary and records every call. */
function fakeProbe(answers: Record<string, Sync>, fallback: Sync = { status: 0, stdout: "1.4.2\n" }) {
  const calls: { binary: string; args: string[]; options: Record<string, unknown> }[] = [];
  const spawnSync = (binary: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ binary, args, options });
    return answers[binary] ?? fallback;
  };
  return { calls, spawnSync };
}

describe("probeBun", () => {
  const env = { PATH: "/usr/bin" };
  test("runs --version with no shell, a timeout and the caller's environment, and accepts exit 0 with 1.3 or later", () => {
    const { calls, spawnSync } = fakeProbe({});
    expect(probeBun("/b/bun", { env, cwd: "/pkg", spawnSync })).toEqual({ ok: true, version: "1.4.2" });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["--version"]);
    expect(calls[0].options.shell).toBe(false);
    expect(calls[0].options.env).toBe(env);
    expect(typeof calls[0].options.timeout).toBe("number");
  });

  test("a placeholder that exits 1, a missing executable and garbage output are all unusable", () => {
    const unusable = { ok: false, reason: "unusable" };
    const probe = (answer: Sync) => probeBun("/b/bun", { env, spawnSync: fakeProbe({}, answer).spawnSync });
    expect(probe({ status: 1, stdout: "" })).toEqual(unusable);
    expect(probe({ status: null, error: Object.assign(new Error("spawnSync ENOEXEC"), { code: "ENOEXEC" }) })).toEqual(unusable);
    expect(probe({ status: 0, stdout: "not a version\n" })).toEqual(unusable);
    expect(probe({ status: 0, stdout: "" })).toEqual(unusable);
  });

  test("a timeout is its own reason, whether reported as ETIMEDOUT or by the kill signal", () => {
    const probe = (answer: Record<string, unknown>) => probeBun("/b/bun", { env, spawnSync: (() => answer) as never });
    expect(probe({ status: null, error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }) })).toEqual({ ok: false, reason: "timeout" });
    expect(probe({ status: null, signal: "SIGTERM" })).toEqual({ ok: false, reason: "timeout" });
  });

  test("the default timeout allows a slow first start (15 seconds)", () => {
    const { calls, spawnSync } = fakeProbe({});
    probeBun("/b/bun", { env, spawnSync });
    expect(calls[0].options.timeout).toBe(15000);
  });

  test("a placeholder that cannot run (ENOEXEC) is unusable", () => {
    const spawnSync = (() => ({ error: { code: "ENOEXEC" } })) as never;
    expect(probeBun("/b/bun", { env, spawnSync })).toEqual({ ok: false, reason: "unusable" });
  });

  test("a throwing spawnSync is unusable, not a crash", () => {
    const spawnSync = () => {
      throw new Error("boom");
    };
    expect(probeBun("/b/bun", { env, spawnSync })).toEqual({ ok: false, reason: "unusable" });
  });

  test("a Bun older than 1.3 is rejected with its version", () => {
    const { spawnSync } = fakeProbe({}, { status: 0, stdout: "1.2.23\n" });
    expect(probeBun("/b/bun", { env, spawnSync })).toEqual({ ok: false, reason: "old", version: "1.2.23" });
  });
});

describe("resolveBun", () => {
  const present = (...files: string[]) => (path: string) => files.includes(path);

  test("on Windows the first absolute PATH entry holding bun.exe wins", () => {
    const env = { PATH: "C:\\one;C:\\two;C:\\three" };
    const exists = present("C:\\two\\bun.exe", "C:\\three\\bun.exe");
    expect(resolveBun("win32", env, exists)).toBe("C:\\two\\bun.exe");
  });

  test("on Windows an empty or relative entry is ignored even if a bun.exe would exist there", () => {
    const env = { PATH: ";.;bin;..\\x;C:\\real" };
    const always = (path: string) => !path.startsWith("C:\\real");
    expect(resolveBun("win32", env, always)).toBeNull();
    expect(resolveBun("win32", env, present("C:\\real\\bun.exe"))).toBe("C:\\real\\bun.exe");
  });

  test("on Windows the variable may be spelled Path", () => {
    expect(resolveBun("win32", { Path: "C:\\tools" }, present("C:\\tools\\bun.exe"))).toBe("C:\\tools\\bun.exe");
  });

  test("on Windows it finds the npm-global layout next to the bun.cmd shim, and a path with spaces", () => {
    const global = "C:\\Users\\Some One\\AppData\\Roaming\\npm";
    expect(resolveBun("win32", { PATH: global }, present(`${global}\\node_modules\\bun\\bin\\bun.exe`))).toBe(`${global}\\node_modules\\bun\\bin\\bun.exe`);
  });

  test("on Windows it is null when no entry holds bun.exe or there is no PATH", () => {
    expect(resolveBun("win32", { PATH: "C:\\one;C:\\two" }, () => false)).toBeNull();
    expect(resolveBun("win32", {}, () => true)).toBeNull();
  });

  test("on POSIX the first absolute PATH entry holding bun wins", () => {
    expect(resolveBun("linux", { PATH: "/a:/b:/c" }, present("/b/bun", "/c/bun"))).toBe("/b/bun");
    expect(resolveBun("darwin", { PATH: "/Users/Some One/.bun/bin" }, present("/Users/Some One/.bun/bin/bun"))).toBe("/Users/Some One/.bun/bin/bun");
  });

  test("on POSIX an empty, relative or . entry is ignored even if a bun would exist there", () => {
    const env = { PATH: ":.:bin:../x:/real" };
    const fake = (path: string) => !path.startsWith("/real");
    expect(resolveBun("linux", env, fake)).toBeNull();
    expect(resolveBun("linux", env, present("/real/bun"))).toBe("/real/bun");
  });

  test("on POSIX it is null when there is no PATH or nothing is found", () => {
    expect(resolveBun("linux", {}, () => true)).toBeNull();
    expect(resolveBun("linux", { PATH: "/usr/bin" }, () => false)).toBeNull();
  });
});

describe("findBun", () => {
  const env = { PATH: "/usr/bin" };
  const base = { platform: "linux", env, cwd: "/pkg", exists: (path: string) => path === "/usr/bin/bun" };

  test("the bundled Bun is preferred over the one on PATH, and the PATH one is not even run", () => {
    const { calls, spawnSync } = fakeProbe({ "/m/bun/bin/bun.exe": { status: 0, stdout: "1.3.4\n" } });
    expect(findBun({ ...base, spawnSync, bundled: () => "/m/bun/bin/bun.exe" })).toEqual({ binary: "/m/bun/bin/bun.exe", version: "1.3.4" });
    expect(calls.map((c) => c.binary)).toEqual(["/m/bun/bin/bun.exe"]);
  });

  test("a bundled stub that exits 1 falls back to the Bun on PATH", () => {
    const { calls, spawnSync } = fakeProbe({ "/m/bun/bin/bun.exe": { status: 1, stdout: "" }, "/usr/bin/bun": { status: 0, stdout: "1.4.2\n" } });
    expect(findBun({ ...base, spawnSync, bundled: () => "/m/bun/bin/bun.exe" })).toEqual({ binary: "/usr/bin/bun", version: "1.4.2" });
    expect(calls.map((c) => c.binary)).toEqual(["/m/bun/bin/bun.exe", "/usr/bin/bun"]);
  });

  test("no bundled package at all falls back to the Bun on PATH", () => {
    const { spawnSync } = fakeProbe({});
    expect(findBun({ ...base, spawnSync, bundled: () => null }).binary).toBe("/usr/bin/bun");
  });

  test("an old bundled Bun with a good one on PATH uses the PATH one", () => {
    const { spawnSync } = fakeProbe({ "/m/bun.exe": { status: 0, stdout: "1.2.0\n" } });
    expect(findBun({ ...base, spawnSync, bundled: () => "/m/bun.exe" }).binary).toBe("/usr/bin/bun");
  });

  test("nothing usable: binary is null and an old Bun is reported with its version and path", () => {
    const stub = fakeProbe({ "/usr/bin/bun": { status: 0, stdout: "1.2.23\n" } }, { status: 1 });
    expect(findBun({ ...base, spawnSync: stub.spawnSync, bundled: () => "/m/bun.exe" })).toEqual({ binary: null, old: { version: "1.2.23", path: "/usr/bin/bun" }, failed: "/m/bun.exe" });
    const none = fakeProbe({}, { status: 1 });
    expect(findBun({ ...base, exists: () => false, spawnSync: none.spawnSync, bundled: () => null })).toEqual({ binary: null, old: null });
    expect(none.calls).toHaveLength(0);
  });

  test("a hostile working directory holding a bun is never probed or used (POSIX)", () => {
    // The reviewed repository is the cwd and holds ./bun; PATH has an empty and a relative entry.
    const { calls, spawnSync } = fakeProbe({});
    const hostile = (path: string) => path === "/work/repo/bun" || path === "bun" || path === "./bun" || path === "bin/bun";
    const found = findBun({ platform: "linux", env: { PATH: ":.:bin:/nowhere" }, cwd: "/work/repo", exists: hostile, spawnSync, bundled: () => null });
    expect(found).toEqual({ binary: null, old: null });
    expect(calls).toHaveLength(0);
  });

  test("a hostile working directory holding bun.exe is never probed or used (win32)", () => {
    const { calls, spawnSync } = fakeProbe({});
    const hostile = (path: string) => path === "C:\\work\\repo\\bun.exe" || path === "bun.exe" || path === ".\\bun.exe";
    const found = findBun({ platform: "win32", env: { Path: ";.;C:\\work\\repo\\..\\nope\\x;rel" }, cwd: "C:\\work\\repo", exists: hostile, spawnSync, bundled: () => null });
    expect(found).toEqual({ binary: null, old: null });
    expect(calls).toHaveLength(0);
  });

  test("a bundled path with spaces is passed to the probe as one binary string, never through a shell", () => {
    const spaced = "C:\\Users\\Some One\\node_modules\\bun\\bin\\bun.exe";
    const { calls, spawnSync } = fakeProbe({});
    expect(findBun({ platform: "win32", env: { Path: "" }, cwd: "C:\\pkg", exists: () => false, spawnSync, bundled: () => spaced }).binary).toBe(spaced);
    expect(calls[0].binary).toBe(spaced);
    expect(calls[0].options.shell).toBe(false);
  });
});

describe("missingBunLines", () => {
  test("not found: the Bun line first, then npm and the site; the PowerShell line only on Windows", () => {
    const posix = missingBunLines({ old: null }, "linux");
    expect(posix[0]).toBe(BUN_INSTALL_LINE);
    expect(posix.join("\n")).toContain("npm install -g bun");
    expect(posix.join("\n")).toContain("https://bun.sh");
    expect(posix.join("\n")).not.toContain("powershell");
    const win = missingBunLines({ old: null }, "win32").join("\n");
    expect(win).toContain("npm install -g bun");
    expect(win).toContain('powershell -c "irm bun.sh/install.ps1|iex"');
    expect(win).toContain("open a new terminal");
  });

  test("not found keeps its original text; a candidate that did not run gets a neutral line with its path", () => {
    expect(missingBunLines({ old: null }, "linux")[1]).toContain("and no Bun is on PATH. Install one:");
    const failed = missingBunLines({ old: null, failed: "/m/bun/bin/bun.exe" }, "linux");
    expect(failed[0]).toBe(BUN_INSTALL_LINE);
    expect(failed[1]).toContain("A Bun was found (/m/bun/bin/bun.exe) but did not run");
    expect(failed[1]).toContain("placeholder that cannot run");
    expect(failed[1]).toContain("try again");
    expect(failed[1]).not.toContain("no Bun is on PATH");
  });

  test("found but too old: names the version and the path, and differs from not found", () => {
    const old = missingBunLines({ old: { version: "1.2.23", path: "/usr/bin/bun" } }, "linux");
    expect(old[0]).toContain("found Bun 1.2.23");
    expect(old[0]).toContain("/usr/bin/bun");
    expect(old[0]).not.toBe(BUN_INSTALL_LINE);
    expect(old.join("\n")).toContain("npm install -g bun");
  });
});

type Call = { binary: string; args: string[]; options: Record<string, unknown> };
/** A fake child: reports `error`, or closes with the given status and signal, on the next tick. */
function stub(result: Record<string, unknown>) {
  const calls: Call[] = [];
  const spawn = (binary: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ binary, args, options });
    const child = Object.assign(new EventEmitter(), { kill: () => true });
    setImmediate(() => {
      if (result.error) child.emit("error", result.error);
      else child.emit("close", result.status ?? null, result.signal ?? null);
    });
    return child;
  };
  return { calls, spawn };
}
type Options = { platform?: string; exists?: (path: string) => boolean; bundled?: () => string | null; probes?: Record<string, Sync>; probeDefault?: Sync };
async function run(result: Record<string, unknown>, options: Options = {}) {
  const { platform = "linux", exists = () => true, bundled = () => null, probes = {}, probeDefault } = options;
  const { calls, spawn } = stub(result);
  const probe = fakeProbe(probes, probeDefault);
  const env = { PATH: platform === "win32" ? "C:\\bin" : "/usr/bin", WACHIMAN_PROFILE: "isolated:x", ANTHROPIC_API_KEY: "k" };
  const snapshot = { ...env };
  const errors: string[] = [];
  const code = await launch({ pkgDir: "/pkg", argv: ["--version"], platform, env, spawn, stderr: (line: string) => errors.push(line), exists, spawnSync: probe.spawnSync, bundled });
  return { calls, probeCalls: probe.calls, env, snapshot, errors, code };
}

describe("launch", () => {
  test("spawns the Bun it found, by absolute path, with inherited stdio, no shell, and the environment object it was given", async () => {
    const r = await run({ status: 0, signal: null });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].binary).toBe("/usr/bin/bun");
    expect(r.calls[0].args).toEqual(launcherArgs("/pkg", ["--version"]));
    expect(r.calls[0].options.stdio).toBe("inherit");
    expect(r.calls[0].options.shell ?? false).toBe(false);
    expect(r.calls[0].options.env).toBe(r.env);
  });

  test("sets, unsets and translates no environment variable, WACHIMAN_PROFILE and ANTHROPIC_API_KEY included", async () => {
    const r = await run({ status: 0, signal: null });
    expect(r.env).toEqual(r.snapshot);
    expect(r.calls[0].args.join(" ")).not.toContain("--profile");
  });

  test("the bundled Bun is run in preference to the one on PATH", async () => {
    const bundled = join("/opt", "wachiman", "node_modules", "bun", "bin", "bun.exe");
    const r = await run({ status: 0, signal: null }, { bundled: () => bundled });
    expect(r.code).toBe(0);
    expect(r.calls[0].binary).toBe(bundled);
    expect(r.probeCalls.map((c) => c.binary)).toEqual([bundled]);
  });

  test("a bundled stub (--ignore-scripts) that exits 1 falls back to the Bun on PATH", async () => {
    const bundled = "/opt/wachiman/node_modules/bun/bin/bun.exe";
    const r = await run({ status: 0, signal: null }, { bundled: () => bundled, probes: { [bundled]: { status: 1, stdout: "" } } });
    expect(r.code).toBe(0);
    expect(r.calls[0].binary).toBe("/usr/bin/bun");
    expect(r.errors).toEqual([]);
  });

  test("a path with spaces is spawned as one binary", async () => {
    const bundled = "/Users/Some One/lib/node_modules/bun/bin/bun.exe";
    const r = await run({ status: 0, signal: null }, { bundled: () => bundled });
    expect(r.calls[0].binary).toBe(bundled);
  });

  test("an old Bun is rejected, never spawned, and the message names its version and says it is too old", async () => {
    const r = await run({ status: 0, signal: null }, { probeDefault: { status: 0, stdout: "1.2.23\n" } });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.errors[0]).toContain("found Bun 1.2.23");
    expect(r.errors.join("\n")).toContain("npm install -g bun");
    expect(r.errors).not.toContain(BUN_INSTALL_LINE);
  });

  test("a candidate that timed out is reported as found but not run, never as 'no Bun is on PATH'", async () => {
    const r = await run({ status: 0, signal: null }, { bundled: () => "/m/bun.exe", probeDefault: { status: null, error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }) } });
    expect(r.code).toBe(2);
    expect(r.errors[0]).toBe(BUN_INSTALL_LINE);
    expect(r.errors[1]).toContain("A Bun was found (/m/bun.exe) but did not run");
    expect(r.errors.join("\n")).not.toContain("no Bun is on PATH");
  });

  test("nothing usable: it never spawns the engine, exits 2 and prints the Bun line and the install commands", async () => {
    const r = await run({ status: 0, signal: null }, { bundled: () => "/m/bun.exe", probeDefault: { status: 1, stdout: "" } });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.errors[0]).toBe(BUN_INSTALL_LINE);
    expect(r.errors.join("\n")).toContain("npm install -g bun");
    expect(r.errors.join("\n")).toContain("https://bun.sh");
  });

  test("on Windows it spawns the absolute bun.exe found on PATH", async () => {
    const r = await run({ status: 0, signal: null }, { platform: "win32", exists: (path) => path === "C:\\bin\\bun.exe" });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].binary).toBe("C:\\bin\\bun.exe");
  });

  test("on Windows with no bundled Bun and no bun.exe on an absolute PATH entry it never spawns, exits 2 and adds the PowerShell line", async () => {
    const r = await run({ status: 0, signal: null }, { platform: "win32", exists: () => false });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.probeCalls).toHaveLength(0);
    expect(r.errors[0]).toBe(BUN_INSTALL_LINE);
    expect(r.errors.join("\n")).toContain('powershell -c "irm bun.sh/install.ps1|iex"');
  });

  test("exits with the child's exit code", async () => {
    expect((await run({ status: 1, signal: null })).code).toBe(1);
    expect((await run({ status: 2, signal: null })).code).toBe(2);
    expect((await run({ status: 137, signal: null })).code).toBe(137);
  });

  test("a child killed by signal n gives 128+n", async () => {
    expect((await run({ status: null, signal: "SIGINT" })).code).toBe(130);
    expect((await run({ status: null, signal: "SIGKILL" })).code).toBe(137);
  });

  test("a Bun that disappears between the check and the spawn prints the install line and exits 2", async () => {
    const enoent = Object.assign(new Error("spawn bun ENOENT"), { code: "ENOENT" });
    const r = await run({ status: null, signal: null, error: enoent });
    expect(r.code).toBe(2);
    expect(r.errors).toEqual(["wachiman needs Bun 1.3 or later: https://bun.sh"]);
    expect(BUN_INSTALL_LINE).toBe("wachiman needs Bun 1.3 or later: https://bun.sh");
  });

  test("any other spawn failure is exit 1 with the reason, never the install line", async () => {
    const eacces = Object.assign(new Error("spawn bun EACCES"), { code: "EACCES" });
    const r = await run({ status: null, signal: null, error: eacces });
    expect(r.code).toBe(1);
    expect(r.errors.join("\n")).toContain("EACCES");
    expect(r.errors.join("\n")).not.toContain("https://bun.sh");
  });
});

/** The real script under Node, in a clean copy of the layout: `bin/` and a stand-in `src/cli.ts`. */
const node = Bun.which("node");
describe.skipIf(!node)("bin/wachiman.js under Node", () => {
  function sandbox() {
    const pkg = mkdtempSync(join(tmpdir(), "launcher-pkg-"));
    return pkg;
  }
  const clean = (path: string) => ({ PATH: path, HOME: process.env.HOME ?? "", USERPROFILE: process.env.USERPROFILE ?? "", SystemRoot: process.env.SystemRoot ?? "" });

  test("runs the engine of its own package through bun and passes the exit code through", async () => {
    const pkg = sandbox();
    try {
      const { cpSync, mkdirSync, writeFileSync } = await import("node:fs");
      cpSync(join(root, "bin"), join(pkg, "bin"), { recursive: true });
      cpSync(join(root, "bunfig.toml"), join(pkg, "bunfig.toml"));
      cpSync(join(root, "package.json"), join(pkg, "package.json"));
      mkdirSync(join(pkg, "src"));
      writeFileSync(join(pkg, "src", "cli.ts"), 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(Number(process.argv[2] === "fail" ? 3 : 0));\n');
      const path = [Bun.which("bun") ? join(Bun.which("bun")!, "..") : "", join(node!, "..")].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
      const ok = Bun.spawnSync([node!, join(pkg, "bin", "wachiman.js"), "local", "--x"], { env: clean(path) });
      expect(ok.stdout.toString().trim()).toBe(JSON.stringify(["local", "--x"]));
      expect(ok.exitCode).toBe(0);
      const bad = Bun.spawnSync([node!, join(pkg, "bin", "wachiman.js"), "fail"], { env: clean(path) });
      expect(bad.exitCode).toBe(3);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });

  test("with no bundled Bun and no bun on PATH it exits 2 and prints the Bun install line and the commands", async () => {
    const empty = mkdtempSync(join(tmpdir(), "no-bun-"));
    const pkg = sandbox();
    try {
      // A copy of bin/ with no node_modules above it, so the bundled Bun cannot be found either.
      const { cpSync } = await import("node:fs");
      cpSync(join(root, "bin"), join(pkg, "bin"), { recursive: true });
      const r = Bun.spawnSync([node!, join(pkg, "bin", "wachiman.js"), "--version"], { env: clean(empty) });
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toString()).toContain("wachiman needs Bun 1.3 or later: https://bun.sh");
      expect(r.stderr.toString()).toContain("npm install -g bun");
    } finally {
      rmSync(empty, { recursive: true, force: true });
      rmSync(pkg, { recursive: true, force: true });
    }
  });
});

/** A real child that traps SIGINT and cleans up slowly, run through the launcher under Node. */
describe.skipIf(!node || process.platform === "win32")("signals reach the child, not only the launcher (POSIX signal semantics; Windows has none)", () => {
  function layout() {
    const pkg = mkdtempSync(join(tmpdir(), "launcher-sig-"));
    const { cpSync, mkdirSync, writeFileSync } = require("node:fs");
    cpSync(join(root, "bin"), join(pkg, "bin"), { recursive: true });
    cpSync(join(root, "bunfig.toml"), join(pkg, "bunfig.toml"));
    mkdirSync(join(pkg, "src"));
    return { pkg, writeFileSync };
  }
  const env = () => ({ ...process.env, PATH: [join(Bun.which("bun")!, ".."), join(node!, "..")].join(":") });
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 200 && !predicate(); i++) await Bun.sleep(25);
    expect(predicate()).toBe(true);
  };

  test("on SIGINT the launcher exits only after the child printed cleaned, with 130", async () => {
    const { pkg, writeFileSync } = layout();
    try {
      writeFileSync(join(pkg, "src", "cli.ts"), 'process.on("SIGINT", () => setTimeout(() => { console.log("cleaned"); process.exit(130); }, 500)); console.log("ready"); setInterval(() => {}, 1000);\n');
      // Its own process group, so the signal reaches launcher and child as a terminal's Ctrl-C does.
      const proc = Bun.spawn([node!, join(pkg, "bin", "wachiman.js")], { env: env(), stdout: "pipe", stderr: "ignore", detached: true });
      let out = "";
      (async () => { for await (const chunk of proc.stdout) out += new TextDecoder().decode(chunk); })();
      await waitFor(() => out.includes("ready"));
      process.kill(-proc.pid, "SIGINT");
      const code = await proc.exited;
      expect(out).toContain("cleaned");
      expect(code).toBe(130);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });

  test("a child killed by SIGTERM gives 143", async () => {
    const { pkg, writeFileSync } = layout();
    try {
      writeFileSync(join(pkg, "src", "cli.ts"), 'console.log("ready"); setInterval(() => {}, 1000);\n');
      const proc = Bun.spawn([node!, join(pkg, "bin", "wachiman.js")], { env: env(), stdout: "pipe", stderr: "ignore" });
      let out = "";
      (async () => { for await (const chunk of proc.stdout) out += new TextDecoder().decode(chunk); })();
      await waitFor(() => out.includes("ready"));
      proc.kill("SIGTERM");
      expect(await proc.exited).toBe(143);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });
});
