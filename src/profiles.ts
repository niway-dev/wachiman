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
import { UsageError } from "./config";
import { buildChildEnv } from "./providers/claude-code";

export type ProfileChoice = { kind: "default" } | { kind: "isolated"; name: string };

/** The name a bare `isolated` and a bare `--setup-profile` mean. */
export const DEFAULT_ISOLATED_NAME = "isolated";
const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

function checkName(name: string) {
  if (!NAME.test(name)) {
    throw new UsageError(
      `"${name}" is not a profile name: use 1 to 32 lowercase letters, digits or dashes, starting with a letter or digit.`,
    );
  }
  return name;
}

/** `default`, `isolated` (the name `isolated`) or `isolated:<name>`. */
export function parseProfile(value: string): ProfileChoice {
  if (value === "default") return { kind: "default" };
  if (value === "isolated") return { kind: "isolated", name: DEFAULT_ISOLATED_NAME };
  if (value.startsWith("isolated:")) return { kind: "isolated", name: checkName(value.slice("isolated:".length)) };
  throw new UsageError(`--profile must be default, isolated or isolated:<name>, got "${value}".`);
}

export function profileDir(name: string, home: string) {
  return join(home, ".wachiman", `claude-${checkName(name)}`);
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
 * `wachiman --setup-profile [<name>]`: creates `~/.wachiman/claude-<name>` (mode 0700) and
 * launches the developer's `claude` in it, interactively, from an empty directory, so they can
 * sign in with Claude Code's own flow. The binary is spawned directly, without a shell, with the
 * subscription environment: a `claude` shell function or alias cannot change its
 * `CLAUDE_CONFIG_DIR`. Wachiman never sees the sign-in and does not check that it worked.
 */
export function setupProfile(p: {
  name?: string;
  home: string;
  env: Record<string, string | undefined>;
  print?: (line: string) => void;
  spawn?: SpawnFn;
}): string[] {
  const name = checkName(p.name ?? DEFAULT_ISOLATED_NAME);
  const dir = profileDir(name, p.home);
  const print = p.print ?? ((line: string) => console.error(line));
  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
    print(line);
  };
  if (existsSync(dir)) {
    const found = inspectIsolatedProfile(dir);
    if (found.length > 0) throw populatedProfileError(dir, found);
  }
  const parent = join(p.home, ".wachiman");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  chmodSync(dir, 0o700);
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
