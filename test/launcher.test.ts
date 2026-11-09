/**
 * The npm launcher (`bin/wachiman.js`) is a dependency-free Node script. Its argv builder and its
 * `launch` function live in `bin/launcher-args.js`, imported here by Bun, so the tests exercise the
 * very code Node runs. No model, no network; the real `bun` is spawned only by the end-to-end test.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunBinary, BUN_INSTALL_LINE, launch, launcherArgs } from "../bin/launcher-args.js";

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

describe("bunBinary", () => {
  test("is bun.exe on Windows and bun elsewhere", () => {
    expect(bunBinary("win32")).toBe("bun.exe");
    expect(bunBinary("darwin")).toBe("bun");
    expect(bunBinary("linux")).toBe("bun");
  });
});

type Call = { binary: string; args: string[]; options: Record<string, unknown> };
function stub(result: Record<string, unknown>) {
  const calls: Call[] = [];
  const spawn = (binary: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ binary, args, options });
    return result;
  };
  return { calls, spawn };
}
function run(result: Record<string, unknown>, platform = "linux") {
  const { calls, spawn } = stub(result);
  const env = { PATH: "/usr/bin", WACHIMAN_PROFILE: "isolated:x", ANTHROPIC_API_KEY: "k" };
  const snapshot = { ...env };
  const errors: string[] = [];
  const code = launch({ pkgDir: "/pkg", argv: ["--version"], platform, env, spawn, stderr: (line: string) => errors.push(line) });
  return { calls, env, snapshot, errors, code };
}

describe("launch", () => {
  test("spawns bun by name with inherited stdio, no shell, and the environment object it was given", () => {
    const r = run({ status: 0, signal: null });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].binary).toBe("bun");
    expect(r.calls[0].args).toEqual(launcherArgs("/pkg", ["--version"]));
    expect(r.calls[0].options.stdio).toBe("inherit");
    expect(r.calls[0].options.shell ?? false).toBe(false);
    expect(r.calls[0].options.env).toBe(r.env);
  });

  test("sets, unsets and translates no environment variable, WACHIMAN_PROFILE and ANTHROPIC_API_KEY included", () => {
    const r = run({ status: 0, signal: null });
    expect(r.env).toEqual(r.snapshot);
    expect(r.calls[0].args.join(" ")).not.toContain("--profile");
  });

  test("uses bun.exe on Windows", () => {
    expect(run({ status: 0, signal: null }, "win32").calls[0].binary).toBe("bun.exe");
  });

  test("exits with the child's exit code", () => {
    expect(run({ status: 1, signal: null }).code).toBe(1);
    expect(run({ status: 2, signal: null }).code).toBe(2);
    expect(run({ status: 137, signal: null }).code).toBe(137);
  });

  test("a child stopped by SIGINT exits 130; by any other signal, 1", () => {
    expect(run({ status: null, signal: "SIGINT" }).code).toBe(130);
    expect(run({ status: null, signal: "SIGKILL" }).code).toBe(1);
  });

  test("without Bun on PATH it prints the install line and exits 2", () => {
    const enoent = Object.assign(new Error("spawn bun ENOENT"), { code: "ENOENT" });
    const r = run({ status: null, signal: null, error: enoent });
    expect(r.code).toBe(2);
    expect(r.errors).toEqual(["wachiman needs Bun 1.3 or later: https://bun.sh"]);
    expect(BUN_INSTALL_LINE).toBe("wachiman needs Bun 1.3 or later: https://bun.sh");
  });

  test("any other spawn failure is exit 1 with the reason, never the install line", () => {
    const eacces = Object.assign(new Error("spawn bun EACCES"), { code: "EACCES" });
    const r = run({ status: null, signal: null, error: eacces });
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

  test("with no bun on PATH it exits 2 and prints the Bun install line", () => {
    const empty = mkdtempSync(join(tmpdir(), "no-bun-"));
    try {
      const r = Bun.spawnSync([node!, join(root, "bin", "wachiman.js"), "--version"], { env: clean(empty) });
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toString()).toContain("wachiman needs Bun 1.3 or later: https://bun.sh");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
