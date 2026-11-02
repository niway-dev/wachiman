/**
 * The Codex CLI adapter (`codex exec`), for reviews by an OpenAI model such as GPT Sol. Everything
 * specific to that CLI lives here. Its hardening, and what was verified about it, is documented in
 * docs/providers/codex.md.
 *
 * Codex has no read-only file tools: the model reads by running shell commands (`cat`, `rg`, `nl`)
 * inside Codex's own sandbox. The adapter therefore leans on the sandbox and on isolation instead
 * of a tool list:
 *   - `--sandbox read-only`: no writes, and no network for the commands the model runs.
 *   - The session starts in an empty scratch directory, never in the pull request's head, with
 *     `HOME` and `CODEX_HOME` pointed at fresh directories. Codex discovers project config
 *     (`.codex/`), skills (`.agents/skills/`) and `AGENTS.md` from its working directory and home;
 *     a skill planted in the head was loaded and obeyed when the session started inside it.
 *   - Every feature that opens a network path, starts other agents or runs hooks is disabled.
 *   - The model's shell inherits no environment. `inherit = "none"` alone was not enough: a
 *     variable still reached the shell until `shell_snapshot` and `unified_exec` were disabled.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locatePrompt as locate } from "./locate";
import {
  DEFAULT_CALL_TIMEOUT_S,
  type NeutralTool,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResult,
} from "./types";

const BINARY = "codex";
/** Any OpenAI key shape: `sk-…`, `sk-proj-…`, `sk-svcacct-…`. Also matches other vendors' `sk-` keys, which is fine. */
const KEY_SHAPE = /sk-[A-Za-z0-9_-]*[A-Za-z0-9]{20,}/;

/** The three neutral tools are all reads, which the read-only sandbox allows; nothing else is. */
const READ_TOOLS: readonly NeutralTool[] = ["read", "glob", "grep"];

/**
 * Features Codex enables by default that this adapter turns off. Each is a path to the network, to
 * another agent, or to code the reviewed branch controls.
 */
export const DISABLED_FEATURES = [
  "apps",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "skill_mcp_dependency_install",
  // Without these two, `shell_environment_policy.inherit = "none"` did not stop a variable from
  // reaching the model's shell (verified with Codex 0.153.4).
  "shell_snapshot",
  "unified_exec",
] as const;

/** USD per million tokens. Cached input is part of input; reasoning tokens are part of output. */
export interface Price {
  input: number;
  cachedInput: number;
  output: number;
}

/**
 * List prices of the models this adapter has been set up for. A model not listed here needs
 * `AGENT_REVIEW_PRICE_PER_MTOK`: the engine's budgets are in dollars, and Codex reports tokens.
 */
export const PRICES: Record<string, Price> = {
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10 },
  "gpt-6-sol": { input: 2, cachedInput: 0.1, output: 10 },
};

/** `"2,0.1,10"` (input, cached input, output) as a price, or a usage error. */
export function parsePrice(raw: string): Price {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(
      `AGENT_REVIEW_PRICE_PER_MTOK must be "input,cached_input,output" in USD per million tokens, got "${raw}".`,
    );
  }
  return { input: parts[0], cachedInput: parts[1], output: parts[2] };
}

export interface Usage {
  input_tokens: number;
  cached_input_tokens?: number;
  output_tokens: number;
}

export function costOf(usage: Usage, price: Price): number {
  const cached = usage.cached_input_tokens ?? 0;
  return (
    ((usage.input_tokens - cached) * price.input + cached * price.cachedInput + usage.output_tokens * price.output) /
    1_000_000
  );
}

/** "gpt-6.1-sol" becomes "GPT-6.1 Sol"; a name of another shape is returned as is. */
export function prettyModel(model: string): string {
  const match = model.match(/^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/);
  if (!match) return model;
  return `GPT-${match[1]} ${match[2][0].toUpperCase()}${match[2].slice(1)}`;
}

export function leaksKey(texts: string[], key: string) {
  return texts.some((t) => (key !== "" && t.includes(key)) || KEY_SHAPE.test(t));
}

/** `LC_ALL`, `LC_CTYPE`, … along with the exact names below. */
const LOCALE_PREFIX = "LC_";
const PASSED_THROUGH = ["PATH", "TMPDIR", "TERM", "LANG", "CI", "GITHUB_ACTIONS"] as const;

/**
 * The Codex process's environment, built from an allowlist. `HOME` and `CODEX_HOME` are the
 * adapter's own directories. The key is passed as `CODEX_API_KEY`, which `codex exec` reads; it
 * is never `OPENAI_BASE_URL`, a proxy or `NODE_OPTIONS`, any of which could send it elsewhere.
 */
export function buildChildEnv(
  env: Record<string, string | undefined>,
  dirs: { home: string; codexHome: string },
) {
  const child: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if ((PASSED_THROUGH as readonly string[]).includes(name) || name.startsWith(LOCALE_PREFIX)) child[name] = value;
  }
  child.HOME = dirs.home;
  child.CODEX_HOME = dirs.codexHome;
  if (env.OPENAI_API_KEY) child.CODEX_API_KEY = env.OPENAI_API_KEY;
  return child;
}

/** The `codex exec` arguments. The prompt always goes through stdin (`-`). */
export function buildCodexArgs(opts: {
  model: string;
  workDir: string;
  schemaFile?: string;
  lastMessageFile: string;
  reasoningEffort?: string;
}) {
  return [
    "exec",
    "--json",
    "--model",
    opts.model,
    "--sandbox",
    "read-only",
    "-c",
    'approval_policy="never"',
    "-c",
    'web_search="disabled"',
    "-c",
    'shell_environment_policy.inherit="none"',
    ...(opts.reasoningEffort ? ["-c", `model_reasoning_effort="${opts.reasoningEffort}"`] : []),
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--cd",
    opts.workDir,
    ...DISABLED_FEATURES.flatMap((f) => ["--disable", f]),
    ...(opts.schemaFile ? ["--output-schema", opts.schemaFile] : []),
    "--output-last-message",
    opts.lastMessageFile,
    "-",
  ];
}

/** See `locatePrompt` in locate.ts; Codex's model has a shell, so it may also `cd` into the head. */
export function locatePrompt(prompt: string, repoDir: string, addDirs: string[]) {
  return locate(prompt, repoDir, addDirs, { shell: true });
}

interface CodexEvent {
  type: string;
  usage?: Usage;
  message?: string;
  error?: { message?: string };
  item?: { type?: string };
}

/** Folds the JSONL event stream into the totals the engine needs. */
export function readEvents(stdout: string) {
  const usage: Usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  let commands = 0;
  let failure: string | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    const event = JSON.parse(line) as CodexEvent;
    if (event.type === "turn.completed" && event.usage) {
      usage.input_tokens += event.usage.input_tokens ?? 0;
      usage.cached_input_tokens = (usage.cached_input_tokens ?? 0) + (event.usage.cached_input_tokens ?? 0);
      usage.output_tokens += event.usage.output_tokens ?? 0;
    }
    if (event.type === "item.completed" && event.item?.type === "command_execution") commands++;
    if (event.type === "turn.failed") failure = event.error?.message ?? "turn failed";
    if (event.type === "error" && !failure) failure = event.message ?? "error";
  }
  return { usage, commands, failure };
}

export class CodexProvider implements ProviderAdapter {
  readonly name = "codex";
  private version: string | null = null;
  private readonly binary: string;
  private readonly price: Price | undefined;

  constructor(
    private readonly opts: {
      model: string;
      requireApiKey: boolean;
      /** `AGENT_REVIEW_PRICE_PER_MTOK`, for a model not in `PRICES`. */
      priceOverride?: string;
      reasoningEffort?: string;
      /**
       * The most one call may run when the request names none. Codex has no spend cap and no turn
       * cap, so time is the only hard bound on a call; reaching it is reported as "timeout".
       * Default `DEFAULT_CALL_TIMEOUT_S`.
       */
      timeoutMs?: number;
      /** For tests: another executable. */
      binary?: string;
      /** For tests and a local dry run: the machine's own Codex login instead of a fresh home. */
      codexHome?: string;
    },
  ) {
    this.binary = opts.binary ?? BINARY;
    this.price = opts.priceOverride ? parsePrice(opts.priceOverride) : PRICES[opts.model];
  }

  preflight() {
    if (!this.price) {
      throw new Error(
        `No price is known for model "${this.opts.model}". Set AGENT_REVIEW_PRICE_PER_MTOK="input,cached_input,output" (USD per million tokens).`,
      );
    }
    const probe = spawnSync(this.binary, ["--version"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    if (probe.error || probe.status !== 0) {
      throw new Error(`The Codex binary "${this.binary}" did not run (--version): ${probe.error ?? probe.stderr}`);
    }
    this.version = probe.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    if (this.opts.requireApiKey && !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  }

  modelLabel() {
    return `${prettyModel(this.opts.model)} via Codex${this.version ? ` ${this.version}` : ""}`;
  }

  leaksSecret(texts: string[]) {
    return leaksKey(texts, process.env.OPENAI_API_KEY ?? "");
  }

  run(request: ProviderRequest): ProviderResult {
    const unknown = request.allowedTools.filter((t) => !READ_TOOLS.includes(t));
    if (unknown.length > 0) throw new Error(`The Codex adapter only grants reads; asked for ${unknown.join(", ")}.`);
    const scratch = mkdtempSync(join(tmpdir(), "agent-review-codex-"));
    try {
      const workDir = join(scratch, "work");
      const home = join(scratch, "home");
      const codexHome = this.opts.codexHome ?? join(scratch, "codex-home");
      for (const dir of [workDir, home, codexHome]) mkdirSync(dir, { recursive: true });
      let schemaFile: string | undefined;
      if (request.outputSchema) {
        schemaFile = join(scratch, "schema.json");
        writeFileSync(schemaFile, JSON.stringify(request.outputSchema));
      }
      const lastMessageFile = join(scratch, "last-message.txt");
      const started = Date.now();
      const run = spawnSync(
        this.binary,
        buildCodexArgs({
          model: this.opts.model,
          workDir,
          schemaFile,
          lastMessageFile,
          reasoningEffort: this.opts.reasoningEffort,
        }),
        {
          cwd: workDir,
          input: locatePrompt(request.prompt, request.cwd, request.addDirs),
          env: buildChildEnv(process.env, { home, codexHome }),
          encoding: "utf8",
          maxBuffer: 256 * 1024 * 1024,
          timeout: request.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_S * 1000,
          killSignal: "SIGKILL",
        },
      );
      const durationMs = Date.now() - started;
      const timedOut = run.signal === "SIGKILL";
      if (!timedOut && (run.error || !run.stdout)) {
        throw new Error(`codex did not run (status ${run.status}): ${run.error ?? run.stderr}`);
      }
      const { usage, commands, failure } = readEvents(run.stdout ?? "");
      let text: string | undefined;
      try {
        text = readFileSync(lastMessageFile, "utf8");
      } catch {
        text = undefined;
      }
      let structuredOutput: unknown;
      if (request.outputSchema && text) {
        try {
          structuredOutput = JSON.parse(text);
        } catch {
          structuredOutput = undefined;
        }
      }
      const isError =
        timedOut || run.status !== 0 || failure !== null || (request.outputSchema !== undefined && !structuredOutput);
      const costUsd = costOf(usage, this.price ?? { input: 0, cachedInput: 0, output: 0 });
      return {
        structuredOutput,
        text,
        costUsd,
        turns: commands + 1,
        durationMs,
        // Codex has no spend or turn cap (`request.maxTurns` is not used: `codex exec` has no such
        // flag); only the time limit ends a call early. The engine totals what it spent.
        terminalReason: timedOut ? "timeout" : isError ? "error" : "success",
        isError,
        raw: { status: run.status, timedOut, failure, usage, stderr: run.stderr?.slice(-2000) },
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
