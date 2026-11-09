/**
 * `wachiman doctor`: resolves what a local run would use, runs the checks declared in `checks.ts`
 * in order, and prints the report. No model call, no install, no Wachiman-owned network request.
 */
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { readConfig, wachimanHome, type WachimanConfigV1 } from "../accounts/config";
import { confirmProfile, type ConfirmIo, type SpawnFn } from "../accounts/confirm";
import { buildProfileList, managedDir } from "../accounts/profile-list";
import { parseProfileRef, resolveProfile } from "../accounts/resolve";
import { UsageError } from "../config";
import { type GitRunner } from "../evidence";
import { parseFlags } from "../flags";
import { repositoryKey } from "../history/store";
import { CHECKS, detectInstall, PROFILE_SCOPED, realDoctorFs, tierOf, type DoctorContext, type DoctorFs, type DoctorReport, type InstallKind, type Target } from "./checks";
import { redactReport, renderJson, renderText } from "./render";

export interface DoctorOptions {
  repoDir: string;
  profile?: string;
  allProfiles: boolean;
  json: boolean;
  redactPaths: boolean;
}

export const doctorUsage = "wachiman doctor [--json] [--profile <name> | --all-profiles] [--repo-dir <dir>] [--redact-paths]";

/** The arguments after `doctor` (`--repo-dir` is already taken out and arrives as `repoDir`). */
export function parseDoctorArgs(argv: string[], repoDir: string): DoctorOptions | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const { positionals, values, booleans } = parseFlags(argv, { values: ["--profile"], booleans: ["--json", "--all-profiles", "--redact-paths"] }, "doctor");
  if (positionals.length > 0) throw new UsageError(`doctor takes no argument "${positionals[0]}".`);
  const profile = values["--profile"];
  if (profile !== undefined && booleans["--all-profiles"]) throw new UsageError("--profile and --all-profiles cannot be used together.");
  if (profile !== undefined) parseProfileRef(profile);
  return {
    repoDir,
    ...(profile !== undefined ? { profile } : {}),
    allProfiles: booleans["--all-profiles"] === true,
    json: booleans["--json"] === true,
    redactPaths: booleans["--redact-paths"] === true,
  };
}

export interface DoctorDeps {
  spawn?: SpawnFn;
  confirmIo?: ConfirmIo;
  git?: GitRunner;
  fs?: DoctorFs;
  install?: InstallKind;
  version?: string;
  platform?: string;
  arch?: string;
  userHome?: string;
  neutralDir?: string;
}

const defaultSpawn: SpawnFn = (binary, args, options) => {
  const run = spawnSync(binary, args, options);
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", error: run.error };
};

export function buildDoctorReport(opts: DoctorOptions, env: Record<string, string | undefined>, deps: DoctorDeps = {}): DoctorReport {
  const home = wachimanHome(env);
  const fs = deps.fs ?? realDoctorFs;
  const spawn = deps.spawn ?? defaultSpawn;
  const version = deps.version ?? "unknown";
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const config = readConfig(home);
  const accounts: WachimanConfigV1 | undefined = config.kind === "ok" ? config.config : undefined;

  let repository: DoctorContext["repository"];
  try {
    repository = { ok: true, value: repositoryKey(opts.repoDir, deps.git) };
  } catch {
    repository = { ok: false, reason: `${opts.repoDir} is not a git repository` };
  }
  const binding =
    repository.ok && accounts && Object.hasOwn(accounts.projects, repository.value.key) ? accounts.projects[repository.value.key] : undefined;

  /** Resolves one spelling (or the full precedence when `flag` is undefined) and confirms the result. */
  const resolve = (flag: string | undefined) =>
    resolveProfile({
      flag,
      binding: flag === undefined ? binding : undefined,
      env: { WACHIMAN_PROFILE: env.WACHIMAN_PROFILE },
      config: accounts,
      managedDirExists: (name) => fs.isDirectory(managedDir(home, name)),
      home,
    });
  const targetFor = (flag: string | undefined, name?: string): Target => {
    if (config.kind === "corrupt") return { kind: "unavailable", reason: "the configuration is corrupt", name };
    const result = resolve(flag);
    if (!result.ok) return { kind: "failure", failure: result.failure, name };
    return { kind: "profile", resolved: result.resolved, confirmation: confirmProfile(result.resolved, env, spawn, deps.confirmIo), name };
  };

  const primaryResolution = config.kind === "corrupt" ? undefined : resolve(opts.profile);
  const primary = primaryResolution?.ok ? primaryResolution.resolved : undefined;
  const base = {
    home,
    userHome: deps.userHome ?? homedir(),
    env,
    spawn,
    fs,
    neutralDir: deps.neutralDir ?? tmpdir(),
    version,
    install: deps.install ?? detectInstall(version),
    platform,
    arch,
    config,
    repository,
    primary,
  };

  let targets: Target[];
  if (opts.allProfiles && config.kind !== "corrupt") {
    const names = buildProfileList(home, accounts).profiles.map((p) => p.name);
    targets = names.length > 0 ? names.map((name) => targetFor(name, name)) : [targetFor(undefined)];
  } else if (primary && primaryResolution?.ok) {
    targets = [{ kind: "profile", resolved: primary, confirmation: confirmProfile(primary, env, spawn, deps.confirmIo) }];
  } else {
    targets = [targetFor(opts.profile)];
  }

  const checks = CHECKS.flatMap((check) =>
    PROFILE_SCOPED.includes(check.id) ? targets.map((target) => check.run({ ...base, target })) : [check.run({ ...base, target: targets[0] })],
  );
  const failedRequired = checks.filter((r) => r.level === "required" && r.status === "fail").length;
  const install = base.install.kind;
  const report: DoctorReport = {
    format: "wachiman.doctor/1",
    version,
    install,
    platform: `${platform}-${arch}`,
    tier: tierOf(platform, arch),
    ...(primary
      ? { profile: { name: primary.profile.kind === "default" ? "default" : primary.profile.name, kind: primary.profile.kind, rung: primary.rung } }
      : {}),
    checks,
    failedRequired,
    exitCode: failedRequired > 0 ? 1 : 0,
  };
  return opts.redactPaths ? redactReport(report, { home, userHome: base.userHome }) : report;
}

export function runDoctor(
  opts: DoctorOptions,
  env: Record<string, string | undefined>,
  io: { stdout: (text: string) => void; stderr: (line: string) => void },
  deps: DoctorDeps = {},
): number {
  const report = buildDoctorReport(opts, env, deps);
  io.stdout(opts.json ? renderJson(report) : renderText(report));
  return report.exitCode;
}
