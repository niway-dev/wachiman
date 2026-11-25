/**
 * ripgrep, the search backend of the call-site evidence step (`src/evidence-search.ts`): which
 * binary Wachiman would run, and how it installs a pinned one.
 *
 * Resolution order, first hit wins:
 *   1. `WACHIMAN_RIPGREP`, an absolute path to an `rg` the person chose;
 *   2. the binary Wachiman installed itself, `<Wachiman home>/bin/rg`;
 *   3. `rg` on `PATH`.
 * Each candidate must answer `--version` with ripgrep 15 or newer: the search needs the `-w`
 * word boundaries of that line. A candidate that fails the test is skipped, and the reason is
 * kept so the warning can say what was tried. When nothing qualifies the engine uses `git grep`.
 *
 * The installer downloads the pinned release from the upstream project, compares the SHA-256 of
 * the archive with the table below before anything is unpacked, and only then makes `rg`
 * executable. The table is committed, not read from the release: a compromised release page
 * cannot change what this code accepts. It is modelled on `src/install-claude-code.sh`.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { wachimanHome } from "./accounts/config";

/** The release Wachiman installs and tests against. Bump it together with the table below. */
export const RIPGREP_VERSION = "15.2.0";

/** Oldest major version accepted from the override, the installed copy or `PATH`. */
export const RIPGREP_MIN_MAJOR = 15;

/** The environment variable that points at an `rg` binary; it wins over every other source. */
export const RIPGREP_ENV = "WACHIMAN_RIPGREP";

export interface RipgrepAsset {
  /** Release asset (a `.tar.gz`), under `https://github.com/BurntSushi/ripgrep/releases/download/<version>/`. */
  asset: string;
  /** SHA-256 of that archive, computed from the download and checked against the release's own `.sha256` file. */
  sha256: string;
}

/** Keyed by `<process.platform>-<process.arch>`. Linux builds are static musl, so they run on any distribution. */
export const RIPGREP_ASSETS: Readonly<Record<string, RipgrepAsset>> = {
  "darwin-arm64": {
    asset: `ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`,
    sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
  },
  "darwin-x64": {
    asset: `ripgrep-${RIPGREP_VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
  },
  "linux-x64": {
    asset: `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c",
  },
  "linux-arm64": {
    asset: `ripgrep-${RIPGREP_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    sha256: "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915",
  },
};

export const RIPGREP_RELEASE_URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}`;

type Env = Record<string, string | undefined>;

/** Where the installed binary lives: `<Wachiman home>/bin`. */
export const ripgrepInstallDir = (env: Env) => join(wachimanHome(env), "bin");
export const ripgrepInstallPath = (env: Env) => join(ripgrepInstallDir(env), "rg");

export interface RipgrepFound {
  path: string;
  version: string;
  source: "env" | "installed" | "path";
  /** Sources tried before this one that did not qualify, and why. Absent when there were none. */
  skipped?: string[];
}

export type RipgrepResolution =
  | ({ found: true } & RipgrepFound)
  | { found: false; /** One line per source that was tried and why it did not qualify. */ tried: string[] };

/** What `--version` returned; a test replaces it. */
export type VersionProbe = (binary: string) => { status: number | null; stdout: string; error?: Error };

const defaultProbe =
  (env: Env): VersionProbe =>
  (binary) => {
    const run = spawnSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { status: run.status, stdout: run.stdout ?? "", error: run.error };
  };

/** `ripgrep 15.2.0 (rev ...)` gives `15.2.0`; anything that is not ripgrep gives `undefined`. */
export function parseRipgrepVersion(output: string): string | undefined {
  return output.match(/^ripgrep (\d+\.\d+\.\d+)/)?.[1];
}

const majorOf = (version: string) => Number(version.split(".")[0]);

function check(binary: string, probe: VersionProbe): { ok: true; version: string } | { ok: false; why: string } {
  const run = probe(binary);
  if (run.error || run.status !== 0)
    return { ok: false, why: `${binary} did not answer --version${run.error ? ` (${run.error.message})` : ""}` };
  const version = parseRipgrepVersion(run.stdout);
  if (!version) return { ok: false, why: `${binary} is not ripgrep` };
  if (majorOf(version) < RIPGREP_MIN_MAJOR)
    return { ok: false, why: `${binary} is ripgrep ${version}; ${RIPGREP_MIN_MAJOR} or newer is needed` };
  return { ok: true, version };
}

/** Finds the `rg` to run, in the order documented at the top of this file. Never throws. */
export function resolveRipgrep(
  env: Env,
  probe: VersionProbe = defaultProbe(env),
  exists: (path: string) => boolean = existsSync,
): RipgrepResolution {
  const tried: string[] = [];
  const attempt = (source: RipgrepFound["source"], binary: string): RipgrepResolution | undefined => {
    const result = check(binary, probe);
    if (result.ok)
      return { found: true, path: binary, version: result.version, source, ...(tried.length > 0 ? { skipped: [...tried] } : {}) };
    tried.push(result.why);
    return undefined;
  };

  const override = env[RIPGREP_ENV];
  if (override !== undefined && override !== "") {
    if (!isAbsolute(override)) tried.push(`${RIPGREP_ENV} must be an absolute path, got "${override}"`);
    else {
      const hit = attempt("env", override);
      if (hit) return hit;
    }
  }
  let installed: string | undefined;
  try {
    installed = ripgrepInstallPath(env);
  } catch (error) {
    tried.push(`the Wachiman home is unusable: ${(error as Error).message}`);
  }
  if (installed !== undefined && exists(installed)) {
    const hit = attempt("installed", installed);
    if (hit) return hit;
  }
  // Only an absolute path is ever probed or run: a bare `rg`, or a relative PATH entry, would
  // resolve against the repository the search runs in, where a file of the pull request could win.
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    if (entry === "" || !isAbsolute(entry)) continue;
    const candidate = join(entry, "rg");
    if (!exists(candidate)) continue;
    const hit = attempt("path", candidate);
    if (hit) return hit;
  }
  return { found: false, tried };
}

export type InstallResult =
  | { status: "installed"; path: string; version: string }
  | { status: "unsupported"; reason: string }
  /** The download failed or the archive could not be unpacked: nothing was installed, and nothing wrong was installed. */
  | { status: "unavailable"; reason: string }
  /** The archive is not the pinned one. Nothing was unpacked. */
  | { status: "refused"; reason: string };

export interface InstallDeps {
  platform?: string;
  arch?: string;
  /** Returns the archive's bytes; a test replaces it. Default: `fetch` with redirects. */
  download?: (url: string) => Promise<Uint8Array>;
  /** Replaces the pinned table; a test supplies its own archive and hash. */
  assets?: Readonly<Record<string, RipgrepAsset>>;
  /** Replaces the release base URL. */
  releaseUrl?: string;
}

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Downloads the pinned ripgrep for this platform into `<Wachiman home>/bin/rg`. The SHA-256 of
 * the archive is checked before `tar` sees it, and `rg` is made executable only after that. A
 * mismatch refuses and leaves whatever binary was there untouched. Never throws.
 */
export async function installRipgrep(env: Env, deps: InstallDeps = {}): Promise<InstallResult> {
  const key = `${deps.platform ?? process.platform}-${deps.arch ?? process.arch}`;
  const entry = (deps.assets ?? RIPGREP_ASSETS)[key];
  if (!entry) return { status: "unsupported", reason: `no pinned ripgrep build for ${key}` };
  let bytes: Uint8Array;
  const url = `${deps.releaseUrl ?? RIPGREP_RELEASE_URL}/${entry.asset}`;
  try {
    bytes = await (deps.download ?? fetchBytes)(url);
  } catch (error) {
    return { status: "unavailable", reason: `could not download ${url}: ${(error as Error).message}` };
  }
  const actual = sha256Of(bytes);
  if (actual !== entry.sha256) {
    return {
      status: "refused",
      reason: `SHA-256 mismatch for ${entry.asset}: expected ${entry.sha256}, got ${actual}. Nothing was installed.`,
    };
  }
  const work = mkdtempSync(join(tmpdir(), "wachiman-rg-"));
  try {
    const archive = join(work, entry.asset);
    writeFileSync(archive, bytes);
    const unpacked = spawnSync("tar", ["-xzf", archive, "-C", work], { encoding: "utf8", timeout: 60_000 });
    if (unpacked.error || unpacked.status !== 0) {
      return { status: "unavailable", reason: `could not unpack ${entry.asset}: ${unpacked.error?.message ?? unpacked.stderr}` };
    }
    const binary = join(work, entry.asset.replace(/\.tar\.gz$/, ""), "rg");
    if (!existsSync(binary)) return { status: "unavailable", reason: `${entry.asset} holds no rg binary` };
    const dir = ripgrepInstallDir(env);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "rg");
    const staged = join(dir, `rg.tmp-${process.pid}`);
    writeFileSync(staged, readFileSync(binary));
    chmodSync(staged, 0o755);
    renameSync(staged, target);
    return { status: "installed", path: target, version: RIPGREP_VERSION };
  } catch (error) {
    return { status: "unavailable", reason: `could not install ripgrep: ${(error as Error).message}` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The install step shared by `wachiman setup` and the CI script: says what it does in plain
 * lines, installs only when no usable ripgrep resolves, and reports the outcome. Returns false
 * only when the archive was refused (a hash mismatch is a failure, a missing network is not:
 * the review then runs on `git grep`).
 */
export async function ensureRipgrep(
  env: Env,
  print: (line: string) => void,
  deps: InstallDeps & { probe?: VersionProbe; exists?: (path: string) => boolean } = {},
): Promise<{ ok: boolean; result: RipgrepResolution | InstallResult }> {
  const resolved = resolveRipgrep(env, deps.probe, deps.exists);
  if (resolved.found) {
    print(
      `ripgrep ${resolved.version} found (${resolved.source === "env" ? RIPGREP_ENV : resolved.source === "installed" ? "installed by Wachiman" : "on PATH"}): ${resolved.path}`,
    );
    return { ok: true, result: resolved };
  }
  let dir: string;
  try {
    dir = ripgrepInstallDir(env);
  } catch (error) {
    const result: InstallResult = { status: "unavailable", reason: `could not install ripgrep: ${(error as Error).message}` };
    print(
      `ripgrep was not installed: ${result.reason}. Reviews still work; the call-site evidence uses git grep, which is slower on large repositories.`,
    );
    return { ok: true, result };
  }
  print(`Installing ripgrep ${RIPGREP_VERSION} (fast search for call-site evidence) into ${dir}...`);
  const result = await installRipgrep(env, deps);
  if (result.status === "installed") {
    print(`ripgrep ${result.version} installed: ${result.path}`);
    return { ok: true, result };
  }
  if (result.status === "refused") {
    print(`ripgrep was NOT installed: ${result.reason}`);
    return { ok: false, result };
  }
  print(
    `ripgrep was not installed: ${result.reason}. Reviews still work; the call-site evidence uses git grep, which is slower on large repositories.`,
  );
  return { ok: true, result };
}

/** The reasons worth showing for `tried`: "did not answer --version (spawn rg ENOENT)" only says the binary is not there. */
export function rejectionReasons(tried: string[]): string[] {
  return tried.filter((t) => !t.includes("ENOENT"));
}
