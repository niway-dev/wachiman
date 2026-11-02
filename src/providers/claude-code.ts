/**
 * The Claude Code adapter (`claude -p`): everything specific to that CLI lives here. Its
 * hardening is documented in docs/providers/claude-code.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locatePrompt } from "./locate";
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

export function buildChildEnv(env: Record<string, string | undefined>) {
  const child: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if ((CHILD_ENV_ALLOWLIST as readonly string[]).includes(name) || name.startsWith(LOCALE_PREFIX)) {
      child[name] = value;
    }
  }
  return child;
}

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
      /** For tests: another executable, and another folder for the settings file. */
      binary?: string;
      settingsDir?: string;
    },
  ) {
    this.binary = opts.binary ?? BINARY;
    this.settingsDir = opts.settingsDir ?? import.meta.dir;
  }

  preflight() {
    findEngineSettings(this.settingsDir);
    const probe = spawnSync(this.binary, ["--version"], {
      encoding: "utf8",
      env: buildChildEnv(process.env),
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
    const childEnv = buildChildEnv(process.env);
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
      // Nothing was printed, so the spend is unknown: report 0 rather than invent a figure.
      return {
        costUsd: 0,
        turns: 0,
        durationMs,
        terminalReason: "timeout",
        isError: true,
        raw: { timedOut: true, timeoutMs, stderr: run.stderr?.slice(-2000) },
      };
    }
    if (run.error || !run.stdout) {
      throw new Error(`claude did not run (status ${run.status}): ${run.error ?? run.stderr}`);
    }
    const raw = JSON.parse(run.stdout) as ClaudeResult;
    return {
      structuredOutput: raw.structured_output,
      text: raw.result,
      costUsd: raw.total_cost_usd ?? 0,
      turns: raw.num_turns ?? 0,
      durationMs: raw.duration_ms ?? 0,
      terminalReason: terminalReasonOf(raw),
      isError: Boolean(raw.is_error),
      raw,
    };
  }
}
