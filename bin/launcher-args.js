// The launcher's logic, in one dependency-free module (Node built-ins only). `bin/wachiman.js`
// calls `launch`; the Bun tests import this same file, so no second copy of the argv exists.
//
// The launcher's one job is to make the npm install portable. It never changes the environment,
// never turns a variable into a flag, and never downloads anything.
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { join, win32 } from "node:path";

export const BUN_INSTALL_LINE = "wachiman needs Bun 1.3 or later: https://bun.sh";

/**
 * Pure. The argv the launcher gives to `bun`: the isolation flags first (Bun reads `.env` and a
 * `bunfig.toml`, which can run code, from its working directory, and that directory is the
 * reviewed repository), then the package's own entry point, then the user's arguments untouched.
 */
export function launcherArgs(pkgDir, argv) {
  return ["--no-env-file", `--config=${join(pkgDir, "bunfig.toml")}`, join(pkgDir, "src", "cli.ts"), ...argv];
}

/** The executable name looked up on PATH. */
export function bunBinary(platform) {
  return platform === "win32" ? "bun.exe" : "bun";
}

/**
 * Pure apart from `exists`. The `bun` to spawn. On POSIX the name is returned as is and the OS
 * looks it up on PATH. On Windows a bare name is looked up in the working directory first, and
 * that directory is the reviewed repository, so the PATH is scanned here instead: only absolute
 * entries count (an empty or relative entry means the working directory), and the first
 * `bun.exe` that exists wins. Returns null when there is none.
 */
export function resolveBun(platform, env, exists = existsSync) {
  if (platform !== "win32") return "bun";
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path");
  const value = key === undefined ? "" : env[key] ?? "";
  for (const raw of value.split(";")) {
    const entry = raw.trim().replace(/^"(.*)"$/, "$1");
    if (entry === "" || !win32.isAbsolute(entry)) continue;
    const candidate = win32.join(entry, "bun.exe");
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Runs the engine under Bun and resolves to the exit code. Everything it touches is a parameter,
 * so a test can replace `spawn` and `stderr`; `env` is handed to the child as the same object it
 * was given and is never written to. While the child runs the launcher ignores SIGINT (the
 * terminal already delivers it to the child's process group, and the child cleans up on its own
 * schedule) and forwards SIGTERM and SIGHUP; it exits with the child's code, or 128+n when the
 * child died from signal n. A SIGINT sent to the launcher's pid alone is dropped; use SIGTERM,
 * which is forwarded. On Windows Bun is resolved from the absolute PATH entries only, so a
 * `bun.exe` in the reviewed repository (the cwd) is never run.
 */
export function launch({ pkgDir, argv, platform = process.platform, env = process.env, spawn = nodeSpawn, stderr = (line) => console.error(line), exists = existsSync }) {
  return new Promise((resolve) => {
    const binary = resolveBun(platform, env, exists);
    if (binary === null) {
      stderr(BUN_INSTALL_LINE);
      resolve(2);
      return;
    }
    const child = spawn(binary, launcherArgs(pkgDir, argv), { stdio: "inherit", env });
    const ignore = () => {};
    const forward = { SIGTERM: () => child.kill("SIGTERM"), SIGHUP: () => child.kill("SIGHUP") };
    process.on("SIGINT", ignore);
    for (const [name, handler] of Object.entries(forward)) process.on(name, handler);
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      process.off("SIGINT", ignore);
      for (const [name, handler] of Object.entries(forward)) process.off(name, handler);
      resolve(code);
    };
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        stderr(BUN_INSTALL_LINE);
        finish(2);
      } else {
        stderr(`wachiman: could not start bun: ${error.message}`);
        finish(1);
      }
    });
    child.on("close", (code, signal) => {
      if (code !== null && code !== undefined) finish(code);
      else finish(signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1);
    });
  });
}
