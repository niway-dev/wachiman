/**
 * Claude Code profiles for the local review (spec open question 4, ADR 0019).
 *
 * `default` is the developer's own `claude`, as their shell finds it. `isolated[:<name>]` is a
 * separate Claude Code configuration directory, `~/.wachiman/claude-<name>`, that holds only a
 * sign-in: no `CLAUDE.md`, skills, hooks or MCP servers of the developer's reach the review.
 *
 * Nothing here reads a credential. The sign-in files (`.credentials.json`, `.claude.json`, the
 * macOS keychain) are never opened: the only file read is `settings.json`, for its `hooks` and
 * `mcpServers` keys. The rest is checked by name.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, updateConfig, type WachimanConfigV1 } from "./accounts/config";
import { checkProfileName, ISOLATED_NAME, parseProfileRef } from "./accounts/resolve";
import { UsageError } from "./config";
import { buildChildEnv } from "./providers/claude-code";

/** The name a bare `isolated` and a bare `--setup-profile` mean. */
export const DEFAULT_ISOLATED_NAME = ISOLATED_NAME;

/**
 * A `--profile` value as `resolveProfile` takes it: `default`, `isolated`, `isolated:<name>` or a
 * profile name. Only the spelling is checked here; whether it names a profile is the resolver's
 * business, because that depends on the config and the home directory.
 */
export function parseProfile(value: string): string {
  parseProfileRef(value);
  return value;
}

/** A managed profile's directory under the Wachiman home (`WACHIMAN_HOME`, else `~/.wachiman`). */
export function profileDir(name: string, wachimanHome: string) {
  return join(wachimanHome, `claude-${checkProfileName(name)}`);
}

/** Files and folders whose presence alone means the profile is not only a sign-in. */
const CUSTOMISATIONS = ["CLAUDE.md", ".mcp.json"] as const;
const CUSTOMISATION_DIRS = ["hooks", "skills", "agents", "commands"] as const;

/**
 * What in an isolated profile is more than a sign-in, as names to print; empty when it is clean.
 * `--restricted` and `--strict-mcp-config` already neutralise these in every call: this check
 * keeps the word "isolated" true. `read` is injectable so a test can record what was opened.
 */
export function inspectIsolatedProfile(dir: string, read: (path: string) => string = (p) => readFileSync(p, "utf8")): string[] {
  const found: string[] = [];
  for (const name of CUSTOMISATIONS) if (existsSync(join(dir, name))) found.push(name);
  for (const name of CUSTOMISATION_DIRS) if (existsSync(join(dir, name))) found.push(`${name}/`);
  const settings = join(dir, "settings.json");
  if (existsSync(settings)) {
    let parsed: { hooks?: unknown; mcpServers?: unknown } | null = null;
    try {
      parsed = JSON.parse(read(settings));
    } catch {
      found.push("settings.json (unreadable)");
    }
    if (parsed && typeof parsed === "object") {
      if (parsed.hooks !== undefined) found.push("settings.json (hooks)");
      const servers = parsed.mcpServers;
      if (servers && typeof servers === "object" && Object.keys(servers).length > 0) found.push("settings.json (mcpServers)");
    }
  }
  return found;
}

/** The refusal for a populated isolated profile. */
export function populatedProfileError(dir: string, found: string[]) {
  return new UsageError(
    `The isolated profile ${dir} holds more than a sign-in: ${found.join(", ")}. Remove them, or use another profile name.`,
  );
}

type SpawnFn = (
  command: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; stdio: "inherit" },
) => { status: number | null; error?: Error };

const defaultSpawn: SpawnFn = (command, args, opts) => spawnSync(command, args, opts);

/**
 * `wachiman --setup-profile [<name>]`: creates `<home>/claude-<name>` (mode 0700), registers it as
 * a managed profile in `<home>/config.json`, and launches the developer's `claude` in it, interactively, from an empty directory, so they can
 * sign in with Claude Code's own flow. The binary is spawned directly, without a shell, with the
 * subscription environment: a `claude` shell function or alias cannot change its
 * `CLAUDE_CONFIG_DIR`. Wachiman never sees the sign-in and does not check that it worked.
 */
/** The config mutation of `profile create`, re-checked under the config lock: an external entry that appeared since the pre-check is never replaced. */
export function claimManagedProfile(c: WachimanConfigV1, name: string, dir: string): WachimanConfigV1 {
  const current = c.profiles[name];
  if (current?.kind === "external") throw new UsageError(`"${name}" is already registered as an external profile; choose another name.`);
  if (current?.kind === "managed") return c;
  return { ...c, profiles: { ...c.profiles, [name]: { kind: "managed", configDir: dir, createdAt: new Date().toISOString() } } };
}

export function setupProfile(p: {
  name?: string;
  /** The Wachiman home itself (`wachimanHome(env)`), not the user's home directory. */
  home: string;
  env: Record<string, string | undefined>;
  print?: (line: string) => void;
  spawn?: SpawnFn;
}): string[] {
  const name = checkProfileName(p.name ?? DEFAULT_ISOLATED_NAME);
  const dir = profileDir(name, p.home);
  const print = p.print ?? ((line: string) => console.error(line));
  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
    print(line);
  };
  // Before anything is created or launched: a corrupt store, or a name an external profile holds.
  const existing = readConfig(p.home, undefined, { structural: true });
  if (existing.kind === "corrupt") throw new UsageError(`${existing.path} is corrupt (${existing.problem}); fix or remove it.`);
  if (existing.kind === "ok" && existing.config.profiles[name]?.kind === "external") {
    throw new UsageError(`"${name}" is already registered as an external profile; choose another name.`);
  }
  if (existsSync(dir)) {
    const found = inspectIsolatedProfile(dir);
    if (found.length > 0) throw populatedProfileError(dir, found);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(p.home, 0o700);
  chmodSync(dir, 0o700);
  updateConfig({ home: p.home }, (c) => claimManagedProfile(c, name, dir));
  const flag = name === DEFAULT_ISOLATED_NAME ? "isolated" : `isolated:${name}`;
  say(`Setting up the isolated profile ${dir}.`);
  say("Claude Code starts next: run /login and sign in with the account the review should use, then /exit.");
  const cwd = mkdtempSync(join(tmpdir(), "wachiman-setup-"));
  let status: number | null = null;
  try {
    const run = (p.spawn ?? defaultSpawn)("claude", [], {
      cwd,
      env: buildChildEnv(p.env, { auth: "subscription", configDir: dir }),
      stdio: "inherit",
    });
    if (run.error) throw new Error(`claude did not start: ${run.error.message}`);
    status = run.status;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  if (status !== 0) say(`claude exited with status ${status}.`);
  say(`Wachiman did not check whether the sign-in succeeded; run \`wachiman local --profile ${flag}\` to find out.`);
  return lines;
}
