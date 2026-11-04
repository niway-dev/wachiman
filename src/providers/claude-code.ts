/**
 * The Claude Code adapter (`claude -p`): everything specific to that CLI lives here. Its
 * hardening is documented in docs/providers/claude-code.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import type { TokenUsage } from "../cost";
import { locatePrompt } from "./locate";
import { classifyProviderError } from "./errors";
import { DEFAULT_CALL_TIMEOUT_S, DEFAULT_EFFORT, type Effort, type NeutralTool, type ProviderAdapter, ProviderRequest, ProviderResult } from "./types";

const BINARY = "claude";
const SETTINGS_FILE = "claude-code.settings.json";
const KEY_SHAPE = /sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}/;

const TOOL_NAMES: Record<NeutralTool, string> = { read: "Read", glob: "Glob", grep: "Grep" };

export function toolNames(tools: NeutralTool[]): string {
  return tools
    .map((t) => {
      const name = TOOL_NAMES[t];
      if (!name) throw new Error(`Unknown tool "${t}" for the Claude Code adapter.`);
      return name;
    })
    .join(",");
}

/** "claude-sonnet-5-5" becomes "Claude Sonnet 5.5"; a name of another shape is returned as is. */
export function prettyModel(model: string): string {
  const match = model.match(/^claude-([a-z]+)-(\d+(?:-\d+)*)(?:-\d{8})?$/);
  if (!match) return model;
  const family = match[1][0].toUpperCase() + match[1].slice(1);
  return `Claude ${family} ${match[2].replaceAll("-", ".")}`;
}

export function leaksKey(texts: string[], key: string) {
  return texts.some((t) => (key !== "" && t.includes(key)) || KEY_SHAPE.test(t));
}

/**
 * The only variables the agent CLI inherits. An allowlist, not "everything but two names": the
 * parent process holds `GH_TOKEN` and may carry anything a runner or a repository file added
 * (`ANTHROPIC_BASE_URL`, `HTTPS_PROXY`, `NODE_OPTIONS`, `BUN_*`), and any of those could send the
 * API key to another host or run code in the agent.
 */
export const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TERM",
  "LANG",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CONFIG_DIR",
  "CI",
  "GITHUB_ACTIONS",
] as const;

/** `LC_ALL`, `LC_CTYPE`, … along with the exact names above. */
const LOCALE_PREFIX = "LC_";

/**
 * `api-key`: the CI path, billed to `ANTHROPIC_API_KEY`. `subscription`: the local review, on the
 * developer's own signed-in `claude` (ADR 0019 decision 3); the key is refused and never forwarded.
 */
export type ClaudeAuth = "api-key" | "subscription";

/** D10: set in every local call; what each one switches off is in docs/providers/claude-code.md. */
export const SUBSCRIPTION_ENV = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
} as const;

/**
 * The child's environment. In subscription mode the allowlist loses `ANTHROPIC_API_KEY` and gains
 * `USER` (without it, `claude` on macOS cannot find its own sign-in: spec D17) and the D10
 * switches; `configDir` (an isolated profile) replaces any `CLAUDE_CONFIG_DIR` of the parent. The
 * sign-in itself is never read here: the binary finds it through `HOME`, `USER` and
 * `CLAUDE_CONFIG_DIR`.
 */
export function buildChildEnv(
  env: Record<string, string | undefined>,
  opts: { auth?: ClaudeAuth; configDir?: string } = {},
) {
  const subscription = opts.auth === "subscription";
  const child: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (subscription && name === "ANTHROPIC_API_KEY") continue;
    if ((CHILD_ENV_ALLOWLIST as readonly string[]).includes(name) || name.startsWith(LOCALE_PREFIX)) {
      child[name] = value;
    }
  }
  if (!subscription) return child;
  if (env.USER !== undefined) child.USER = env.USER;
  Object.assign(child, SUBSCRIPTION_ENV);
  if (opts.configDir) child.CLAUDE_CONFIG_DIR = opts.configDir;
  return child;
}

/** Subscription mode: the developer stopped `claude` (Ctrl-C reaches the whole process group). */
export class InterruptedError extends Error {}

/** The refusal of D4: a key in the environment would bill the key instead of the subscription. */
export const SUBSCRIPTION_KEY_REFUSAL =
  "ANTHROPIC_API_KEY is set. The local review runs on your signed-in `claude`; unset the variable, or run the GitHub mode.";

/** The adapter's own settings, next to this file. */
export function findEngineSettings(dir: string) {
  const path = join(dir, SETTINGS_FILE);
  // Never run without it: the deny rules and the hardening flags come together.
  if (existsSync(path)) return path;
  throw new Error(`${SETTINGS_FILE} not found in ${dir}`);
}

/**
 * The `claude` arguments; the prompt itself goes through stdin, never as an argument, unless the
 * request says otherwise. `--restricted` drops the code-running tools and ignores the head's user,
 * project and local settings (so its `.claude/` hooks do not load); `--strict-mcp-config` skips
 * MCP servers; `--tools` names the only tools that exist. The `/proc` deny rules are not verified
 * under `--restricted`: it confines file tools to the working directories, which may already
 * exclude `/proc`, but nothing here proves it.
 */
export function buildClaudeArgs(opts: {
  addDirs: string[];
  budgetUsd: number;
  /** `--max-turns`, omitted when undefined. Print mode only; exits with `error_max_turns` when reached. */
  maxTurns?: number;
  model: string;
  /** Always passed: Claude Code's own default effort has changed between releases (`--effort` since 2.1.72). */
  effort: Effort;
  settings: string;
  tools: NeutralTool[];
  schema?: object;
  prompt?: string;
  /** False in subscription mode: `--no-session-persistence` keeps the transcript out of the profile's `projects/`. */
  sessionPersistence?: boolean;
}) {
  const tools = toolNames(opts.tools);
  return [
    "-p",
    "--model",
    opts.model,
    "--effort",
    opts.effort,
    "--max-budget-usd",
    String(opts.budgetUsd),
    ...(opts.maxTurns === undefined ? [] : ["--max-turns", String(opts.maxTurns)]),
    "--restricted",
    "--strict-mcp-config",
    "--tools",
    tools,
    "--settings",
    opts.settings,
    ...opts.addDirs.flatMap((d) => ["--add-dir", d]),
    "--allowedTools",
    tools,
    "--disallowedTools",
    "Bash,Read(//proc/**),Grep(//proc/**),Glob(//proc/**)",
    ...(opts.sessionPersistence === false ? ["--no-session-persistence"] : []),
    "--output-format",
    "json",
    ...(opts.schema ? ["--json-schema", JSON.stringify(opts.schema)] : []),
    ...(opts.prompt === undefined ? [] : [opts.prompt]),
  ];
}

interface ClaudeResult {
  is_error: boolean;
  subtype: string;
  /** Claude Code 2.1.316 also sends this (`max_turns` for the turn cap). */
  terminal_reason?: string;
  num_turns: number;
  total_cost_usd: number;
  duration_ms: number;
  result?: string;
  structured_output?: unknown;
  /** Token counts of the whole call; `input_tokens` excludes the cache fields. */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** The `usage` object of a `claude -p --output-format json` result; any missing field is 0. */
export function usageOf(raw: Pick<ClaudeResult, "usage">): TokenUsage {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    input: n(raw.usage?.input_tokens),
    output: n(raw.usage?.output_tokens),
    cacheRead: n(raw.usage?.cache_read_input_tokens),
    cacheWrite: n(raw.usage?.cache_creation_input_tokens),
  };
}

/**
 * How a `claude -p` result ended. The spend cap and the turn cap are separate subtypes
 * (`error_max_budget_usd`, `error_max_turns`); Claude Code 2.1.316 also reports
 * `terminal_reason: "max_turns"` for the second, which is accepted as a fallback.
 */
export function terminalReasonOf(raw: Pick<ClaudeResult, "subtype" | "is_error"> & { terminal_reason?: string }) {
  const subtype = raw.subtype ?? "";
  if (/budget/i.test(subtype)) return "budget";
  if (/max_turns/i.test(subtype) || raw.terminal_reason === "max_turns") return "turns";
  return subtype === "success" && !raw.is_error ? "success" : "error";
}

export class ClaudeCodeProvider implements ProviderAdapter {
  readonly name = "claude-code";
  private version: string | null = null;
  private readonly binary: string;
  private readonly settingsDir: string;

  constructor(
    private readonly opts: {
      model: string;
      requireApiKey: boolean;
      effort?: Effort;
      /** Wall-clock limit per call when the request names none. Default `DEFAULT_CALL_TIMEOUT_S`. */
      timeoutMs?: number;
      /** Default `api-key`. */
      auth?: ClaudeAuth;
      /** Subscription mode only: the isolated profile's directory, forced as `CLAUDE_CONFIG_DIR`. */
      configDir?: string;
      /** For tests: another executable, and another folder for the settings file. */
      binary?: string;
      settingsDir?: string;
    },
  ) {
    this.binary = opts.binary ?? BINARY;
    this.settingsDir = opts.settingsDir ?? import.meta.dir;
  }

  private get subscription() {
    return this.opts.auth === "subscription";
  }

  private childEnv() {
    return buildChildEnv(process.env, { auth: this.opts.auth, configDir: this.opts.configDir });
  }

  preflight() {
    // First, before anything runs: with a key present, `claude -p` would bill the key.
    if (this.subscription && process.env.ANTHROPIC_API_KEY) throw new UsageError(SUBSCRIPTION_KEY_REFUSAL);
    findEngineSettings(this.settingsDir);
    const probe = spawnSync(this.binary, ["--version"], {
      encoding: "utf8",
      env: this.childEnv(),
    });
    if (probe.error || probe.status !== 0) {
      throw new Error(
        `The Claude Code binary "${this.binary}" did not run (--version): ${probe.error ?? probe.stderr}`,
      );
    }
    this.version = probe.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    if (this.opts.requireApiKey && !process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
  }

  modelLabel() {
    return `${prettyModel(this.opts.model)} via Claude Code${this.version ? ` ${this.version}` : ""}`;
  }

  leaksSecret(texts: string[]) {
    return leaksKey(texts, process.env.ANTHROPIC_API_KEY ?? "");
  }

  run(request: ProviderRequest): ProviderResult {
    // The agent never gets a GitHub token, a base URL or a proxy: see CHILD_ENV_ALLOWLIST.
    const childEnv = this.childEnv();
    // The session starts in an empty scratch directory, never in the head: Claude Code discovers
    // `CLAUDE.md` (and `.claude/`) from its working directory and its parents, and a pull request
    // must not supply instructions. The head is only an `--add-dir`, which does not load them.
    const workDir = mkdtempSync(join(tmpdir(), "agent-review-claude-"));
    const prompt = locatePrompt(request.prompt, request.cwd, request.addDirs, { shell: false });
    const args = buildClaudeArgs({
      addDirs: [request.cwd, ...request.addDirs],
      budgetUsd: request.maxBudgetUsd,
      maxTurns: request.maxTurns,
      model: this.opts.model,
      effort: this.opts.effort ?? DEFAULT_EFFORT,
      settings: findEngineSettings(this.settingsDir),
      tools: request.allowedTools,
      schema: request.outputSchema,
      prompt: request.promptViaStdin ? undefined : prompt,
      sessionPersistence: !this.subscription,
    });
    const timeoutMs = request.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_S * 1000;
    const started = Date.now();
    let run: ReturnType<typeof spawnSync<string>>;
    try {
      run = spawnSync(this.binary, args, {
        cwd: workDir,
        input: request.promptViaStdin ? prompt : undefined,
        env: childEnv,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        // The call is synchronous, so the kill cannot wait for a graceful exit and escalate: a
        // process that ignored SIGTERM would block this call forever. `claude -p` prints its result
        // only when it ends, so a SIGTERM grace period would save nothing either.
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
    const durationMs = Date.now() - started;
    if ((run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
      // Nothing was printed, so the spend is unknown: say so, and let the engine count the cap.
      return {
        costUsd: 0,
        costKnown: false,
        model: this.opts.model,
        turns: 0,
        durationMs,
        terminalReason: "timeout",
        isError: true,
        raw: { timedOut: true, timeoutMs, stderr: run.stderr?.slice(-2000) },
      };
    }
    // Only locally: a Ctrl-C there means "stop the review", not "this batch failed, try the next".
    if (this.subscription && (run.signal === "SIGINT" || run.signal === "SIGTERM")) {
      throw new InterruptedError(`claude was stopped by ${run.signal}`);
    }
    if (run.error || !run.stdout) {
      throw new Error(`claude did not run (status ${run.status}): ${run.error ?? run.stderr}`);
    }
    const raw = JSON.parse(run.stdout) as ClaudeResult;
    // Known only when the CLI printed a real dollar figure; an error result without one is not a free call.
    const reported = raw.total_cost_usd;
    const costKnown = typeof reported === "number" && Number.isFinite(reported) && reported >= 0;
    const terminalReason = terminalReasonOf(raw);
    const isError = Boolean(raw.is_error);
    // Claude Code writes the API's error message in `result`; stderr may hold more.
    const errorText = isError
      ? [typeof raw.result === "string" ? raw.result : "", run.stderr?.slice(-2000) ?? ""]
          .map((s) => s.trim())
          .filter(Boolean)
          .join("\n")
      : undefined;
    return {
      structuredOutput: raw.structured_output,
      text: raw.result,
      costUsd: costKnown ? reported : 0,
      costKnown,
      model: this.opts.model,
      usage: usageOf(raw),
      turns: raw.num_turns ?? 0,
      durationMs: raw.duration_ms ?? 0,
      terminalReason,
      isError,
      ...(errorText !== undefined ? { errorText } : {}),
      ...(isError && terminalReason === "error" ? { providerError: classifyProviderError(errorText ?? "") } : {}),
      raw,
    };
  }
}
