/**
 * What `wachiman doctor` checks, declared as data (types spec section 2, command contract 5.6).
 *
 * A check is impure only through the context it is handed: spawn, file system and environment are
 * injected, so a test runs every row on a fixture machine. No check installs anything, calls a
 * model or makes a Wachiman-owned network request, and none opens a credential file or anything
 * inside an external profile's directory. What `claude` itself does on the network is not observed,
 * and the `auth` row says so.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ConfigRead } from "../accounts/config";
import type { Confirmation, Env, SpawnFn } from "../accounts/confirm";
import { failureText, RUNG_LABEL, type ProfileRef, type ResolveFailure, type ResolvedProfile } from "../accounts/resolve";
import type { HistoryRepository } from "../history/types";
import { detectInstall, type InstallKind } from "../install-kind";
import { inspectIsolatedProfile } from "../profiles";
import { buildChildEnv } from "../providers/claude-code";
import { effectiveSettings, OLD_SETTINGS_PATH, parseRepoSettings, SETTINGS_PATH } from "../repo-settings";
import { UsageError } from "../config";

export type CheckLevel = "required" | "optional";
export type CheckStatus = "ok" | "fail" | "warn" | "skip";
export type CheckId = "wachiman" | "bun" | "git" | "tar" | "config" | "profile" | "auth" | "environment" | "project" | "settings" | "history" | "skills" | "isolation";

export interface DoctorRow {
  id: CheckId;
  level: CheckLevel;
  status: CheckStatus;
  /** One line, what was observed. */
  evidence: string;
  fix?: string;
  /** Row-specific structured detail; the `auth` row always carries `networkObserved: "unknown"`. */
  detail?: Record<string, string | number | boolean | null>;
}

/** Moved to `src/install-kind.ts`; re-exported so the doctor's public names stay as they were. */
export { detectInstall, type InstallKind };

export type Tier = "supported" | "built-and-smoke-tested" | "built-untested";

export function tierOf(platform: string, arch: string): Tier {
  if ((platform === "darwin" && (arch === "arm64" || arch === "x64")) || (platform === "linux" && arch === "x64")) return "supported";
  if (platform === "win32" && arch === "x64") return "built-and-smoke-tested";
  return "built-untested";
}

/** The file system a check may look at, as small functions a test can replace. */
export interface DoctorFs {
  exists: (path: string) => boolean;
  isDirectory: (path: string) => boolean;
  /** The names in a directory; empty when it cannot be listed. */
  list: (path: string) => string[];
  /** Permission bits, or undefined where the platform has none. */
  mode: (path: string) => number | undefined;
  /** Used only for a managed profile's `settings.json`. */
  read: (path: string) => string;
}

export const realDoctorFs: DoctorFs = {
  exists: (p) => existsSync(p),
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  list: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
  mode: (p) => {
    try {
      return process.platform === "win32" ? undefined : statSync(p).mode & 0o777;
    } catch {
      return undefined;
    }
  },
  read: (p) => readFileSync(p, "utf8"),
};

/** What one pass of the profile-scoped checks looks at: a profile, why it cannot be resolved, or why nothing can be. */
export type Target =
  | { kind: "profile"; resolved: ResolvedProfile; confirmation: Confirmation; name?: string }
  | { kind: "failure"; failure: ResolveFailure; name?: string }
  | { kind: "unavailable"; reason: string; name?: string };

export interface DoctorContext {
  home: string;
  userHome: string;
  env: Env;
  spawn: SpawnFn;
  fs: DoctorFs;
  /** A directory that is not the repository, for the tool-version probes. */
  neutralDir: string;
  version: string;
  install: InstallKind;
  platform: string;
  arch: string;
  config: ConfigRead;
  /** The repository of `--repo-dir`, or why there is none. */
  repository: { ok: true; value: HistoryRepository } | { ok: false; reason: string };
  /** The top of the working tree of `--repo-dir` (where `.wachiman.yml` is looked for); undefined when it is not one. */
  root?: string;
  /** The profile the full resolution picks (or the one `--profile` names); undefined when it resolves to nothing. */
  primary: ResolvedProfile | undefined;
  /** The profile this pass of `profile`, `auth` and `isolation` looks at. */
  target: Target;
}

export interface DoctorReport {
  format: "wachiman.doctor/1";
  version: string;
  install: InstallKind["kind"];
  platform: string;
  tier: Tier;
  profile?: { name: string; kind: ProfileRef["kind"]; rung: ResolvedProfile["rung"] };
  checks: DoctorRow[];
  failedRequired: number;
  exitCode: 0 | 1;
}

export interface DoctorCheck {
  id: CheckId;
  /** The usual level; a row may carry another (`isolation` is required for a managed profile). */
  level: CheckLevel;
  run(ctx: DoctorContext): DoctorRow;
}

/** The checks that repeat for each profile under `--all-profiles`. */
export const PROFILE_SCOPED: readonly CheckId[] = ["profile", "auth", "isolation"];

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 64 * 1024;

const firstLine = (text: string) => text.trim().split("\n")[0].slice(0, 160);
const parseVersion = (text: string): [number, number, number] | undefined => {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};
const atLeast = (v: [number, number, number], min: [number, number]) => v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);

const BUN_MIN: [number, number] = [1, 3];
const GIT_MIN: [number, number] = [2, 30];

/** Runs `<tool> --version` from a neutral directory with the allowlisted environment. */
function probe(ctx: DoctorContext, tool: string) {
  return ctx.spawn(tool, ["--version"], { cwd: ctx.neutralDir, env: buildChildEnv(ctx.env, { auth: "subscription" }), timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, shell: false, encoding: "utf8" });
}

function toolRow(ctx: DoctorContext, id: "bun" | "git" | "tar", min?: [number, number]): DoctorRow {
  const run = probe(ctx, id);
  if (run.error || run.status !== 0) {
    return { id, level: "required", status: "fail", evidence: `${id} did not answer --version${run.error ? `: ${run.error.message}` : ` (exit ${run.status})`}`, fix: `install ${id} and put it on your PATH` };
  }
  const line = firstLine(run.stdout);
  const version = parseVersion(line);
  if (min && (!version || !atLeast(version, min))) {
    return {
      id,
      level: "required",
      status: "fail",
      evidence: `${line}: ${id} ${min.join(".")} or newer is required`,
      fix: `upgrade ${id} to ${min.join(".")} or newer`,
      detail: { version: version?.join(".") ?? null },
    };
  }
  return { id, level: "required", status: "ok", evidence: line, detail: { version: version?.join(".") ?? null } };
}

const describeProfile = (p: ProfileRef) =>
  p.kind === "default"
    ? "default, your shell's claude"
    : p.kind === "managed"
      ? `${p.name}, managed, ${p.configDir}${p.registered ? "" : " (unregistered)"}`
      : `${p.name}, external, ${p.configDir}, ${p.binary ? `binary ${p.binary}` : "claude from PATH"}`;

const profileName = (p: ProfileRef) => (p.kind === "default" ? "default" : p.name);

const withProfile = (target: Target, row: DoctorRow): DoctorRow =>
  target.name === undefined ? row : { ...row, detail: { ...row.detail, profile: target.name } };

const NETWORK = { networkObserved: "unknown" } as const;

export const CHECKS: DoctorCheck[] = [
  {
    id: "wachiman",
    level: "required",
    run: (ctx) => {
      const { install } = ctx;
      const where = install.kind === "exe" ? process.execPath : install.root;
      const tier = tierOf(ctx.platform, ctx.arch);
      return {
        id: "wachiman",
        level: "required",
        status: "ok",
        evidence: `${ctx.version}, ${install.kind}, ${where}, ${ctx.platform}-${ctx.arch}, tier ${tier}`,
        detail: { version: ctx.version, install: install.kind, path: where, platform: `${ctx.platform}-${ctx.arch}`, tier },
      };
    },
  },
  {
    id: "bun",
    level: "required",
    run: (ctx) =>
      ctx.install.kind === "exe"
        ? { id: "bun", level: "required", status: "skip", evidence: "not needed: this is a compiled executable" }
        : toolRow(ctx, "bun", BUN_MIN),
  },
  { id: "git", level: "required", run: (ctx) => toolRow(ctx, "git", GIT_MIN) },
  { id: "tar", level: "required", run: (ctx) => toolRow(ctx, "tar") },
  {
    id: "config",
    level: "required",
    run: ({ config }) => {
      if (config.kind === "absent") return { id: "config", level: "required", status: "ok", evidence: "no config file: no profiles registered", detail: { profiles: 0, bindings: 0 } };
      if (config.kind === "corrupt") {
        return {
          id: "config",
          level: "required",
          status: "fail",
          evidence: `${config.path} is corrupt: ${config.problem}`,
          fix: `fix or remove ${config.path}`,
        };
      }
      const profiles = Object.keys(config.config.profiles).length;
      const bindings = Object.keys(config.config.projects).length;
      return { id: "config", level: "required", status: "ok", evidence: `${config.path}: ${profiles} profile(s), ${bindings} binding(s)`, detail: { profiles, bindings } };
    },
  },
  {
    id: "profile",
    level: "required",
    run: ({ target }) => {
      if (target.kind === "unavailable") return withProfile(target, { id: "profile", level: "required", status: "skip", evidence: `skipped: ${target.reason}` });
      if (target.kind === "failure") {
        return withProfile(target, {
          id: "profile",
          level: "required",
          status: "fail",
          evidence: failureText(target.failure),
          fix: "run `wachiman profile list` to see the names that exist",
        });
      }
      const { resolved, confirmation } = target;
      const { profile } = resolved;
      const detail = {
        name: profileName(profile),
        kind: profile.kind,
        rung: resolved.rung,
        ...(profile.kind === "default" ? {} : { directory: profile.configDir }),
        ...(profile.kind === "external" && profile.binary ? { binary: profile.binary } : {}),
      };
      if (!confirmation.ok && (confirmation.stage === "directory" || confirmation.stage === "binary")) {
        return withProfile(target, { id: "profile", level: "required", status: "fail", evidence: confirmation.problem, fix: confirmation.fix, detail });
      }
      const overrode = resolved.overridden.map((o) => RUNG_LABEL[o.rung]);
      const version = confirmation.ok ? confirmation.binary.version : undefined;
      return withProfile(target, {
        id: "profile",
        level: "required",
        status: "ok",
        evidence:
          `${describeProfile(profile)}; chosen by ${RUNG_LABEL[resolved.rung]}${overrode.length ? ` (over ${overrode.join(", ")})` : ""}; ` +
          (version ? `claude ${version}` : "the binary answered --version"),
        detail: { ...detail, version: version ?? null },
      });
    },
  },
  {
    id: "auth",
    level: "required",
    run: ({ target }) => {
      const skip = (reason: string) => withProfile(target, { id: "auth", level: "required", status: "skip", evidence: `skipped: ${reason}`, detail: { ...NETWORK } });
      if (target.kind === "unavailable") return skip(target.reason);
      if (target.kind === "failure") return skip("no profile to check");
      const { confirmation } = target;
      if (!confirmation.ok && confirmation.stage !== "auth") return skip("the profile check failed");
      const auth = confirmation.auth;
      const detail = {
        authMethod: auth?.authMethod ?? null,
        exitCode: auth?.exitCode ?? null,
        directory: auth?.directory ?? null,
        ...NETWORK,
      };
      const unobserved = "what claude does on the network is not observed";
      if (confirmation.ok) {
        return withProfile(target, {
          id: "auth",
          level: "required",
          status: "ok",
          evidence: `signed in with claude.ai; directory ${confirmation.auth.directory}; ${unobserved}`,
          detail,
        });
      }
      return withProfile(target, {
        id: "auth",
        level: "required",
        status: "fail",
        evidence: `${confirmation.problem} (${unobserved})`,
        fix: confirmation.fix,
        detail,
      });
    },
  },
  {
    id: "environment",
    level: "required",
    run: ({ env, primary }) => {
      const notes: string[] = [];
      let status: CheckStatus = "ok";
      let fix: string | undefined;
      if (env.ANTHROPIC_API_KEY) {
        status = "fail";
        notes.push("ANTHROPIC_API_KEY is set: a local run would be refused");
        fix = "unset ANTHROPIC_API_KEY for local use (it stays for the GitHub mode)";
      }
      if (env.CLAUDE_CONFIG_DIR) {
        if (primary?.profile.kind === "default") {
          if (status === "ok") status = "warn";
          notes.push("CLAUDE_CONFIG_DIR is exported and the default profile passes it to claude");
          fix ??= "unset CLAUDE_CONFIG_DIR, or choose a profile with --profile";
        } else {
          notes.push("CLAUDE_CONFIG_DIR is exported; the chosen profile's own directory overrides it");
        }
      }
      if (env.WACHIMAN_PROFILE) {
        if (!primary) notes.push("WACHIMAN_PROFILE is set");
        else if (primary.rung === "env") notes.push("WACHIMAN_PROFILE is set and chooses the profile");
        else notes.push(`WACHIMAN_PROFILE is set and ignored: ${RUNG_LABEL[primary.rung]} wins`);
      }
      return {
        id: "environment",
        level: "required",
        status,
        evidence: notes.length ? notes.join("; ") : "no variable that changes the account is set",
        ...(fix ? { fix } : {}),
        detail: { anthropicApiKey: Boolean(env.ANTHROPIC_API_KEY), claudeConfigDir: Boolean(env.CLAUDE_CONFIG_DIR), wachimanProfile: Boolean(env.WACHIMAN_PROFILE) },
      };
    },
  },
  {
    id: "project",
    level: "optional",
    run: ({ repository, config, primary }) => {
      if (!repository.ok) return { id: "project", level: "optional", status: "skip", evidence: repository.reason };
      const repo = repository.value;
      const binding = config.kind === "ok" && Object.hasOwn(config.config.projects, repo.key) ? config.config.projects[repo.key] : undefined;
      const would = primary ? `; would use ${profileName(primary.profile)}, chosen by ${RUNG_LABEL[primary.rung]}` : "";
      return {
        id: "project",
        level: "optional",
        status: "ok",
        evidence:
          `${repo.name} (key ${repo.key}, keyed by ${repo.keyedBy === "remote" ? `origin ${repo.remote ?? "(unparsed)"}` : `path ${repo.path}`}); ` +
          (binding ? `bound to ${binding.profile}` : "not bound") +
          would,
        detail: { key: repo.key, keyedBy: repo.keyedBy, bound: binding !== undefined, profile: binding?.profile ?? null, ...(repo.remote ? { remote: repo.remote } : {}) },
      };
    },
  },
  {
    // Read-only: reports the repository's `.wachiman.yml` (the working tree is fine here; a run reads
    // the base commit) and where the model and the effort of a run would come from. Never writes or moves anything.
    id: "settings",
    level: "optional",
    run: ({ root, env, fs }) => {
      if (root === undefined) return { id: "settings", level: "optional", status: "skip", evidence: "not in a git working tree: no repository settings to read" };
      const file = join(root, SETTINGS_PATH);
      const old = join(root, OLD_SETTINGS_PATH);
      const hasFile = fs.exists(file);
      const hasOld = fs.exists(old);
      let settings: ReturnType<typeof parseRepoSettings> | undefined;
      if (hasFile) {
        try {
          settings = parseRepoSettings(fs.read(file));
        } catch (error) {
          const why = error instanceof UsageError ? error.message : `${SETTINGS_PATH} cannot be read (${error instanceof Error ? error.message : error})`;
          return {
            id: "settings",
            level: "required",
            status: "fail",
            evidence: `the working copy of ${SETTINGS_PATH} is invalid: ${why} Runs read it at the base commit (Actions) or the merge-base (local), so it takes effect once committed and merged; a run with a broken file at that commit ignores it with a warning and uses the defaults.`,
            fix: `fix ${SETTINGS_PATH} (effort is low, medium, high, xhigh or max; model is a model name), or remove it to use the defaults`,
            detail: { file, valid: false },
          };
        }
      }
      const effective = effectiveSettings(env, settings);
      const from = (s: { value: string; source: string }) => `${s.value} (${s.source === "file" ? `from ${SETTINGS_PATH}` : s.source === "env" ? "from the environment" : "default"})`;
      const read = hasFile ? `${SETTINGS_PATH}: kind ${settings?.kind ?? "not set"}, model ${settings?.model ?? "not set"}, effort ${settings?.effort ?? "not set"}` : `no ${SETTINGS_PATH}`;
      const detail = {
        file: hasFile ? file : null,
        valid: true,
        kind: settings?.kind ?? null,
        model: settings?.model ?? null,
        effort: settings?.effort ?? null,
        effectiveModel: effective.model.value,
        modelFrom: effective.model.source,
        effectiveEffort: effective.effort.value,
        effortFrom: effective.effort.source,
      };
      const evidence = `${read}; a run here would use model ${from(effective.model)}, effort ${from(effective.effort)}. GitHub Actions reads the file from the base commit of the pull request, not from the head`;
      if (hasOld) {
        return {
          id: "settings",
          level: "optional",
          status: "warn",
          evidence: `${OLD_SETTINGS_PATH} exists and is never read (the settings file is ${SETTINGS_PATH} at the root); ${evidence}`,
          fix: hasFile ? `merge ${OLD_SETTINGS_PATH} into ${SETTINGS_PATH}, then remove it` : `mv ${OLD_SETTINGS_PATH} ${SETTINGS_PATH}`,
          detail: { ...detail, oldLocation: old },
        };
      }
      return { id: "settings", level: "optional", status: "ok", evidence, detail };
    },
  },
  {
    id: "history",
    level: "optional",
    run: ({ home, fs }) => {
      const dir = join(home, "history");
      if (!fs.isDirectory(dir)) return { id: "history", level: "optional", status: "skip", evidence: `no history kept yet (${dir} does not exist)` };
      const repositories = fs.list(dir).filter((n) => fs.isDirectory(join(dir, n))).length;
      const mode = fs.mode(dir);
      const open = mode !== undefined && (mode & 0o077) !== 0;
      return {
        id: "history",
        level: "optional",
        status: open ? "warn" : "ok",
        evidence: `${dir}: ${repositories} repositor${repositories === 1 ? "y" : "ies"}${open ? `, mode ${mode!.toString(8)} lets other users in` : ""}`,
        ...(open ? { fix: `chmod 700 ${dir}` } : {}),
        detail: { repositories },
      };
    },
  },
  {
    id: "skills",
    level: "optional",
    run: ({ userHome, fs }) => {
      const names = ["wachiman-review", "wachiman-loop", "wachiman-audit"] as const;
      const found = Object.fromEntries(names.map((n) => [n, fs.isDirectory(join(userHome, ".claude", "skills", n))])) as Record<(typeof names)[number], boolean>;
      const where = join(userHome, ".claude", "skills");
      if (!names.some((n) => found[n])) return { id: "skills", level: "optional", status: "skip", evidence: `no Wachiman skill in ${where}`, detail: found };
      return {
        id: "skills",
        level: "optional",
        status: "ok",
        evidence: `${names.filter((n) => found[n]).join(", ")} in ${where}; whether they match this version is not checked yet (no install marker)`,
        detail: found,
      };
    },
  },
  {
    id: "isolation",
    level: "optional",
    run: (ctx) => {
      const { target } = ctx;
      if (target.kind !== "profile") return withProfile(target, { id: "isolation", level: "optional", status: "skip", evidence: "skipped: no profile to inspect" });
      const { profile } = target.resolved;
      if (profile.kind === "default") {
        return withProfile(target, { id: "isolation", level: "optional", status: "skip", evidence: "the default profile is your own claude, as is; nothing to inspect" });
      }
      if (profile.kind === "external") {
        return withProfile(target, {
          id: "isolation",
          level: "optional",
          status: "warn",
          evidence: "external profile: plugins untested, your customisations may apply to a review",
        });
      }
      // A missing directory is the `profile` row's failure; inspecting it would report an empty list as "clean".
      if (!target.confirmation.ok && target.confirmation.stage === "directory") {
        return withProfile(target, { id: "isolation", level: "required", status: "skip", evidence: "skipped: the profile check failed" });
      }
      const found = inspectIsolatedProfile(profile.configDir, ctx.fs.read);
      if (found.length > 0) {
        return withProfile(target, {
          id: "isolation",
          level: "required",
          status: "fail",
          evidence: `the isolated profile ${profile.configDir} holds more than a sign-in: ${found.join(", ")}`,
          fix: "remove those, or use another profile name",
          detail: { found: found.join(", ") },
        });
      }
      return withProfile(target, { id: "isolation", level: "required", status: "ok", evidence: `${profile.configDir} holds only a sign-in` });
    },
  },
];
