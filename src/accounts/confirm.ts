/**
 * The confirmation a review passes before its first model call (ADR 0029 decision 4): the profile's
 * directory exists, its binary answers `--version`, and `claude auth status`, run under the
 * profile's own environment, reports a claude.ai sign-in in that directory.
 *
 * Wachiman opens no credential file here: it looks at the directory itself and at the binary, and
 * lets `claude` report on its own sign-in. It cannot see what that process does on the network, so
 * every result says `networkObserved: "unknown"`.
 *
 * `auth status` has no flag for the engine's hardening settings (`claude auth status --help` lists
 * only `--json` and `--text`), so the probe runs with the allowlisted subscription environment and
 * an empty working directory, which is all the installed CLI lets it apply. There is no fallback
 * to an unrestricted helper.
 */
import { spawn as spawnChild, spawnSync } from "node:child_process";
import { accessSync, constants, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { buildChildEnv } from "../providers/claude-code";
import type { ResolvedProfile } from "./resolve";

export type Env = Record<string, string | undefined>;
export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}
export type SpawnFn = (
  binary: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeout: number; maxBuffer: number; shell: false; encoding: "utf8" },
) => SpawnResult;

const defaultSpawn: SpawnFn = (binary, args, options) => {
  const run = spawnSync(binary, args, options);
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", error: run.error };
};

/** The same call without blocking the event loop, so a spinner keeps turning while `claude` runs. */
export type AsyncSpawnFn = (...args: Parameters<SpawnFn>) => Promise<SpawnResult>;

/** Like `spawnSync` with `timeout` and `maxBuffer`: a process that outlives the timeout is killed and reports ETIMEDOUT; output past the buffer reports ENOBUFS. */
export const defaultAsyncSpawn: AsyncSpawnFn = (binary, args, options) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    let settled = false;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr, ...(failure ? { error: failure } : {}) });
    };
    const child = spawnChild(binary, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const fail = (code: string) => {
      failure ??= Object.assign(new Error(`spawn ${binary} ${code}`), { code });
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => fail("ETIMEDOUT"), options.timeout);
    // Decode the stream, not each chunk, so a character split across two chunks stays whole, and count bytes like spawnSync.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let bytes = 0;
    const collect = (which: "stdout" | "stderr") => (chunk: string) => {
      if (which === "stdout") stdout += chunk;
      else stderr += chunk;
      bytes += Buffer.byteLength(chunk);
      if (bytes > options.maxBuffer) fail("ENOBUFS");
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", (error) => {
      failure ??= error;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });

/** What the confirmation looks at on disk: the directory and the binary themselves, nothing inside. */
export interface ConfirmIo {
  isDirectory: (path: string) => boolean;
  isExecutableFile: (path: string) => boolean;
  realpath: (path: string) => string;
}

const defaultIo: ConfirmIo = {
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  isExecutableFile: (p) => {
    try {
      if (!statSync(p).isFile()) return false;
      if (process.platform !== "win32") accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  realpath: (p) => realpathSync(p),
};

export type AuthMethod = "none" | "claude.ai" | "oauth_token" | "api_key" | "api_key_helper" | "third_party" | "unknown";
const AUTH_METHODS: readonly string[] = ["none", "claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party", "unknown"];

export interface AuthStatus {
  /** `claude auth status` exit code: 0 signed in, 1 not. */
  exitCode: number | null;
  authMethod: AuthMethod | undefined;
  /** As the binary reports it; undefined on older binaries. */
  configDirectory?: string;
  directory: "matches" | "differs" | "unverified" | "n/a";
  /** Wachiman cannot see what the subprocess did on the network. Always "unknown". */
  networkObserved: "unknown";
  /** One line, never the raw JSON, never an e-mail address. */
  summary: string;
}

export type Confirmation =
  | { ok: true; binary: { path: string; version: string }; auth: AuthStatus }
  | {
      ok: false;
      stage: "directory" | "binary" | "auth";
      problem: string;
      fix: string;
      /** The status, when `auth status` was reached; lets `doctor` show what was found. */
      auth?: AuthStatus;
    };

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 64 * 1024;
const WINDOWS_SHIMS = /\.(cmd|bat|ps1)$/i;

/** First line of a process's output, trimmed for a message. */
const brief = (text: string) => text.trim().split("\n")[0].slice(0, 160);

function samePath(a: string, b: string, io: ConfirmIo) {
  if (resolve(a) === resolve(b)) return true;
  try {
    return io.realpath(a) === io.realpath(b);
  } catch {
    return false;
  }
}

/**
 * Runs `<binary> --version` and `<binary> auth status` (JSON, the documented default) with
 * `buildChildEnv(env, { auth: "subscription", configDir })`, from an empty temporary directory,
 * 15 s and 64 KiB each. Both `local` and `doctor` call it before any model call.
 *
 * The steps are one generator that yields each process it wants run and gets the result back, so
 * the blocking `confirmProfile` and the non-blocking `confirmProfileAsync` share every check.
 */
export function confirmProfile(p: ResolvedProfile, env: Env, spawn: SpawnFn = defaultSpawn, io: ConfirmIo = defaultIo): Confirmation {
  const steps = confirmSteps(p, env, io);
  let step = steps.next();
  while (!step.done) step = steps.next(spawn(...step.value));
  return step.value;
}

/** The same confirmation with `claude` run off the event loop; the default spawn is asynchronous. */
export async function confirmProfileAsync(p: ResolvedProfile, env: Env, spawn: AsyncSpawnFn = defaultAsyncSpawn, io: ConfirmIo = defaultIo): Promise<Confirmation> {
  const steps = confirmSteps(p, env, io);
  let step = steps.next();
  while (!step.done) step = steps.next(await spawn(...step.value));
  return step.value;
}

function* confirmSteps(p: ResolvedProfile, env: Env, io: ConfirmIo): Generator<Parameters<SpawnFn>, Confirmation, SpawnResult> {
  const { profile } = p;
  const label = profile.kind === "default" ? "default" : profile.name;
  const login =
    profile.kind === "default" ? "sign in with your own `claude` (run it and use /login)" : `wachiman profile login ${profile.name}`;
  const configDir = profile.kind === "default" ? undefined : profile.configDir;

  if (configDir !== undefined && !io.isDirectory(configDir)) {
    return {
      ok: false,
      stage: "directory",
      problem: `The directory of profile "${label}", ${configDir}, does not exist.`,
      fix:
        profile.kind === "managed"
          ? `wachiman --setup-profile ${profile.name}`
          : `check the path, or register the profile again with \`wachiman profile add ${label}\``,
    };
  }

  const stored = profile.kind === "external" ? profile.binary : undefined;
  if (stored !== undefined) {
    const bad = !isAbsolute(stored) && !/^[A-Za-z]:[\\/]/.test(stored)
      ? "is not an absolute path"
      : WINDOWS_SHIMS.test(stored)
        ? "is a script shim, which is never run"
        : !io.isExecutableFile(stored)
          ? "is not an executable file"
          : undefined;
    if (bad) {
      return {
        ok: false,
        stage: "binary",
        problem: `The binary of profile "${label}", ${stored}, ${bad}.`,
        fix: `register the profile again with an absolute path to the real claude executable: \`wachiman profile add ${label}\``,
      };
    }
  }
  const binary = stored ?? "claude";

  const cwd = mkdtempSync(join(tmpdir(), "wachiman-confirm-"));
  try {
    const options = {
      cwd,
      env: buildChildEnv(env, { auth: "subscription", configDir }),
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: false as const,
      encoding: "utf8" as const,
    };

    const probe = yield [binary, ["--version"], options];
    if (probe.error || probe.status !== 0) {
      return {
        ok: false,
        stage: "binary",
        problem: `"${binary}" did not answer --version: ${probe.error ? probe.error.message : brief(probe.stderr) || `exit ${probe.status}`}.`,
        fix: stored ? "check the stored path, or register the profile again" : "install Claude Code, or put `claude` on your PATH",
      };
    }
    const version = probe.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? brief(probe.stdout);

    const run = yield [binary, ["auth", "status"], options];
    if (run.error) {
      return {
        ok: false,
        stage: "auth",
        problem: `\`${binary} auth status\` did not finish: ${run.error.message}.`,
        fix: "run it by hand under the profile's directory to see what it does",
      };
    }
    let json: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(run.stdout);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      // Not JSON: no method to read, which is a failure below.
    }
    const method = typeof json.authMethod === "string" ? json.authMethod : undefined;
    const authMethod: AuthMethod | undefined = method === undefined ? undefined : AUTH_METHODS.includes(method) ? (method as AuthMethod) : "unknown";
    const reported = typeof json.configDirectory === "string" && json.configDirectory !== "" ? json.configDirectory : undefined;
    const directory: AuthStatus["directory"] =
      configDir === undefined ? "n/a" : reported === undefined ? "unverified" : samePath(reported, configDir, io) ? "matches" : "differs";
    const auth: AuthStatus = {
      exitCode: run.status,
      authMethod,
      ...(reported !== undefined ? { configDirectory: reported } : {}),
      directory,
      networkObserved: "unknown",
      summary: `exit ${run.status}; method ${authMethod ?? "not reported"}; directory ${directory}`,
    };
    const fail = (problem: string, fix: string): Confirmation => ({ ok: false, stage: "auth", problem, fix, auth });

    if (run.status !== 0) return fail(`\`claude auth status\` reports no sign-in for profile "${label}" (exit ${run.status}).`, login);
    if (authMethod === undefined) return fail(`\`claude auth status\` did not report an authentication method for profile "${label}".`, "update Claude Code, then run wachiman doctor");
    if (authMethod === "api_key") {
      return fail(`Profile "${label}" signs in with an API key: a local run would be billed to a key.`, "remove the key from that profile and sign in with your subscription");
    }
    if (authMethod !== "claude.ai") {
      return fail(`Profile "${label}" signs in with ${authMethod}, which is unsupported by the local mode (it needs a claude.ai sign-in).`, login);
    }
    if (directory === "differs") {
      return fail(
        `The binary reports another directory, ${reported}, for profile "${label}" (expected ${configDir}); a shell function or an inherited setting may be interfering.`,
        "run the binary by path from a plain shell, or unset the setting that redirects it",
      );
    }
    if (directory === "unverified") {
      return fail(
        `This claude cannot report its configuration directory, so profile "${label}" stays unverified.`,
        "update Claude Code to a version whose `auth status` reports configDirectory",
      );
    }
    return { ok: true, binary: { path: binary, version }, auth };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
