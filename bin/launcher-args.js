// The launcher's logic, in one dependency-free module (Node built-ins only). `bin/wachiman.js`
// calls `launch`; the Bun tests import this same file, so no second copy of the argv exists.
//
// The launcher's one job is to make the npm install portable. It never changes the environment,
// never turns a variable into a flag, and never downloads or installs anything: the Bun it runs is
// the one the package's own `bun` dependency installed, or one already on PATH.
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { dirname, join, posix, win32 } from "node:path";

export const BUN_INSTALL_LINE = "wachiman needs Bun 1.3 or later: https://bun.sh";
export const MIN_BUN = [1, 3, 0];

/**
 * Pure. The argv the launcher gives to `bun`: the isolation flags first (Bun reads `.env` and a
 * `bunfig.toml`, which can run code, from its working directory, and that directory is the
 * reviewed repository), then the package's own entry point, then the user's arguments untouched.
 */
export function launcherArgs(pkgDir, argv) {
  return ["--no-env-file", `--config=${join(pkgDir, "bunfig.toml")}`, join(pkgDir, "src", "cli.ts"), ...argv];
}

/**
 * Where the official npm package `bun` (a regular dependency of this package) keeps its binary:
 * `<package>/bin/bun.exe`, on every OS. Resolved from this file's own location through Node's
 * module lookup, never from the working directory, so a `node_modules/bun` inside the reviewed
 * repository is never reached. Null when the package is not installed. The file may still be the
 * stub the package ships when its postinstall did not run (`--ignore-scripts`): see `probeBun`.
 */
export function bundledBunPath(resolve = createRequire(import.meta.url).resolve) {
  try {
    return join(dirname(resolve("bun/package.json")), "bin", "bun.exe");
  } catch {
    return null;
  }
}

/** Pure. `[major, minor, patch]` from the first line of `bun --version` output, or null. */
export function parseBunVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? "").trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Pure. True when version `a` is the same as or later than version `b` (both `[major, minor, patch]`). */
export function versionAtLeast(a, b = MIN_BUN) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/**
 * Runs `<binary> --version` and judges the answer. A file that exists is not enough: with
 * `--ignore-scripts` the `bun` package leaves a stub in `bin/bun.exe` that exits 1 (or is not an
 * executable at all). Returns `{ ok: true, version }`, `{ ok: false, reason: "old", version }`
 * or `{ ok: false, reason: "unusable" }`. No shell, a short timeout, the caller's environment.
 */
export function probeBun(binary, { env, cwd, spawnSync = nodeSpawnSync, timeout = 5000 }) {
  let result;
  try {
    result = spawnSync(binary, ["--version"], { shell: false, timeout, env, cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch {
    return { ok: false, reason: "unusable" };
  }
  if (!result || result.error || result.status !== 0) return { ok: false, reason: "unusable" };
  const version = parseBunVersion(String(result.stdout ?? "").split("\n")[0]);
  if (version === null) return { ok: false, reason: "unusable" };
  const text = version.join(".");
  return versionAtLeast(version) ? { ok: true, version: text } : { ok: false, reason: "old", version: text };
}

/**
 * Pure apart from `exists`. The first `bun` found on PATH, or null. Only absolute entries count,
 * on every OS: an empty or relative entry (or ".") means the working directory, which is the
 * reviewed repository, and a binary there must never run. On Windows a bare name would also be
 * looked up in the working directory first, so the PATH is always scanned here. Each entry may
 * hold `bun` (`bun.exe` on Windows) or, on Windows, the npm-global layout
 * `node_modules\bun\bin\bun.exe` that `npm install -g bun` creates next to its `bun.cmd` shim.
 */
export function resolveBun(platform, env, exists = existsSync) {
  const windows = platform === "win32";
  const path = windows ? win32 : posix;
  const key = Object.keys(env).find((name) => (windows ? name.toLowerCase() === "path" : name === "PATH"));
  const value = key === undefined ? "" : env[key] ?? "";
  for (const raw of value.split(windows ? ";" : ":")) {
    const entry = windows ? raw.trim().replace(/^"(.*)"$/, "$1") : raw;
    if (entry === "" || !path.isAbsolute(entry)) continue;
    const candidates = windows ? [path.join(entry, "bun.exe"), path.join(entry, "node_modules", "bun", "bin", "bun.exe")] : [path.join(entry, "bun")];
    for (const candidate of candidates) if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * The Bun to run: the bundled one when it works, else a Bun on PATH when it works, else the
 * reason there is none. Returns `{ binary, version }`, or `{ binary: null, old }` where `old` is
 * the `{ version, path }` of the first Bun that runs but is older than 1.3 (null when none).
 */
export function findBun({ platform, env, cwd, exists = existsSync, spawnSync = nodeSpawnSync, bundled = bundledBunPath }) {
  let old = null;
  const candidates = [bundled(), resolveBun(platform, env, exists)].filter((path) => path !== null && path !== undefined);
  for (const binary of [...new Set(candidates)]) {
    const probe = probeBun(binary, { env, cwd, spawnSync });
    if (probe.ok) return { binary, version: probe.version };
    if (probe.reason === "old" && old === null) old = { version: probe.version, path: binary };
  }
  return { binary: null, old };
}

/** Pure. The stderr lines for "no usable Bun": which case it is, then the commands. */
export function missingBunLines(found, platform) {
  const first = found.old
    ? `wachiman needs Bun 1.3 or later, but found Bun ${found.old.version} (${found.old.path}): https://bun.sh`
    : BUN_INSTALL_LINE;
  const lines = [
    first,
    found.old ? "Upgrade it, or install a newer one:" : "The Bun that npm installs with wachiman did not run (an install with --ignore-scripts leaves a stub) and no Bun is on PATH. Install one:",
    "  npm install -g bun",
  ];
  if (platform === "win32") lines.push('  powershell -c "irm bun.sh/install.ps1|iex"   (then open a new terminal)');
  lines.push("  https://bun.sh");
  return lines;
}

/**
 * Runs the engine under Bun and resolves to the exit code. Everything it touches is a parameter,
 * so a test can replace `spawn` and `stderr`; `env` is handed to the child as the same object it
 * was given and is never written to. While the child runs the launcher ignores SIGINT (the
 * terminal already delivers it to the child's process group, and the child cleans up on its own
 * schedule) and forwards SIGTERM and SIGHUP; it exits with the child's code, or 128+n when the
 * child died from signal n. A SIGINT sent to the launcher's pid alone is dropped; use SIGTERM,
 * which is forwarded. The Bun comes from the package's own `bun` dependency or from the absolute
 * PATH entries only (see `findBun`), so a `bun` in the reviewed repository (the cwd) is never run.
 */
export function launch({ pkgDir, argv, platform = process.platform, env = process.env, spawn = nodeSpawn, stderr = (line) => console.error(line), exists = existsSync, spawnSync = nodeSpawnSync, bundled = bundledBunPath }) {
  return new Promise((resolve) => {
    const { binary, old } = findBun({ platform, env, cwd: pkgDir, exists, spawnSync, bundled });
    if (binary === null) {
      for (const line of missingBunLines({ old }, platform)) stderr(line);
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
