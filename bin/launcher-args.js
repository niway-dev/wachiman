// The launcher's logic, in one dependency-free module (Node built-ins only). `bin/wachiman.js`
// calls `launch`; the Bun tests import this same file, so no second copy of the argv exists.
//
// The launcher's one job is to make the npm install portable. It never changes the environment,
// never turns a variable into a flag, and never downloads anything.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

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
 * Runs the engine under Bun and returns the exit code. Everything it touches is a parameter, so a
 * test can replace `spawn` and `stderr`; `env` is handed to the child as the same object it was
 * given and is never written to.
 */
export function launch({ pkgDir, argv, platform = process.platform, env = process.env, spawn = spawnSync, stderr = (line) => console.error(line) }) {
  const result = spawn(bunBinary(platform), launcherArgs(pkgDir, argv), { stdio: "inherit", env });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      stderr(BUN_INSTALL_LINE);
      return 2;
    }
    stderr(`wachiman: could not start bun: ${result.error.message}`);
    return 1;
  }
  if (result.status !== null && result.status !== undefined) return result.status;
  return result.signal === "SIGINT" ? 130 : 1;
}
