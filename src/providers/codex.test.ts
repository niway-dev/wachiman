import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import {
  buildChildEnv,
  buildCodexArgs,
  CodexProvider,
  costOf,
  DISABLED_FEATURES,
  leaksKey,
  locatePrompt,
  parsePrice,
  prettyModel,
  readEvents,
} from "./codex";
import { DEFAULT_MODELS, getProvider, PROVIDER_NAMES } from "./index";

describe("buildCodexArgs", () => {
  const args = buildCodexArgs({ model: "gpt-6.1-sol", workDir: "/w", schemaFile: "/s.json", lastMessageFile: "/o.txt" });
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  const configs = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));

  test("runs read-only, never asks for approval, and reads no user config, rules or session files", () => {
    expect(args[0]).toBe("exec");
    expect(after("--sandbox")).toBe("read-only");
    expect(configs).toContain('approval_policy="never"');
    for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--json"]) {
      expect(args).toContain(flag);
    }
  });

  test("closes every network path and keeps the environment out of the model's shell", () => {
    expect(configs).toContain('web_search="disabled"');
    expect(configs).toContain('shell_environment_policy.inherit="none"');
    const disabled = args.flatMap((a, i) => (args[i - 1] === "--disable" ? [a] : []));
    expect(disabled).toEqual([...DISABLED_FEATURES]);
    for (const f of ["browser_use", "computer_use", "multi_agent", "hooks", "plugins", "shell_snapshot", "unified_exec"]) {
      expect(disabled).toContain(f);
    }
  });

  test("starts in the scratch work directory, with the schema, and the prompt on stdin", () => {
    expect(after("--cd")).toBe("/w");
    expect(after("--output-schema")).toBe("/s.json");
    expect(after("--output-last-message")).toBe("/o.txt");
    expect(args.at(-1)).toBe("-");
    expect(configs.some((c) => c.startsWith("model_reasoning_effort"))).toBe(false);
  });

  test("receives the shared effort setting through getProvider", () => {
    expect(getProvider("codex", { model: "gpt-6.1-sol", dryRun: false, effort: "medium" }).name).toBe("codex");
  });

  test("passes a reasoning effort only when set", () => {
    const withEffort = buildCodexArgs({ model: "m", workDir: "/w", lastMessageFile: "/o", reasoningEffort: "high" });
    expect(withEffort).toContain('model_reasoning_effort="high"');
    expect(withEffort).not.toContain("--output-schema");
  });
});

describe("the child environment", () => {
  const env = buildChildEnv(
    {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      CI: "true",
      OPENAI_API_KEY: "sk-proj-test",
      OPENAI_BASE_URL: "https://evil.invalid",
      CODEX_HOME: "/home/runner/.codex",
      GH_TOKEN: "ghs_x",
      GITHUB_TOKEN: "ghs_y",
      HTTPS_PROXY: "http://evil.invalid:3128",
      NODE_OPTIONS: "--require /tmp/evil.js",
      ANTHROPIC_API_KEY: "sk-ant-x",
    },
    { home: "/scratch/home", codexHome: "/scratch/codex-home" },
  );

  test("keeps only the allowlist, with the adapter's own homes and the key as CODEX_API_KEY", () => {
    expect(env).toEqual({
      PATH: "/usr/bin",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      CI: "true",
      HOME: "/scratch/home",
      CODEX_HOME: "/scratch/codex-home",
      CODEX_API_KEY: "sk-proj-test",
    });
  });
});

describe("prices and cost", () => {
  test("cached input is billed at its own price; reasoning is inside output", () => {
    const usage = { input_tokens: 1_000_000, cached_input_tokens: 400_000, output_tokens: 100_000 };
    // 0.6M × $2 + 0.4M × $0.10 + 0.1M × $10 = 1.2 + 0.04 + 1.0
    expect(costOf(usage, { input: 2, cachedInput: 0.1, output: 10 })).toBeCloseTo(2.24, 6);
  });

  test("parses an override and rejects a malformed one", () => {
    expect(parsePrice("1.25, 0.125, 10")).toEqual({ input: 1.25, cachedInput: 0.125, output: 10 });
    expect(() => parsePrice("1,2")).toThrow("AGENT_REVIEW_PRICE_PER_MTOK");
    expect(() => parsePrice("a,b,c")).toThrow("AGENT_REVIEW_PRICE_PER_MTOK");
  });
});

describe("readEvents", () => {
  // The shape of `codex exec --json` output, as recorded from Codex 0.153.4.
  const stream = [
    '{"type":"thread.started","thread_id":"t"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"cat a.ts","exit_code":0}}',
    '{"type":"item.completed","item":{"id":"i2","type":"command_execution","command":"rg x","exit_code":0}}',
    '{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"{}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":39761,"cached_input_tokens":25728,"cache_write_input_tokens":0,"output_tokens":241,"reasoning_output_tokens":0}}',
  ].join("\n");

  test("totals usage and counts commands", () => {
    expect(readEvents(stream)).toEqual({
      usage: { input_tokens: 39761, cached_input_tokens: 25728, output_tokens: 241 },
      commands: 2,
      failure: null,
    });
  });

  test("reports a failed turn", () => {
    const failed = '{"type":"error","message":"model not found"}\n{"type":"turn.failed","error":{"message":"The model is not supported"}}';
    expect(readEvents(failed).failure).toBe("The model is not supported");
  });
});

test("locatePrompt points the model at the head and forbids running it", () => {
  const text = locatePrompt("Review pr.json", "/runner/head", ["/tmp/scratch"]);
  expect(text).toContain("checked out at /runner/head");
  expect(text).toContain("under /tmp/scratch");
  expect(text).toContain("never build, test or run");
  expect(text).toEndWith("Review pr.json");
});

test("leaksKey catches the job's key and any OpenAI-shaped key", () => {
  const key = "sk-proj-SyntheticSyntheticSynthetic0123456789";
  expect(leaksKey([`oops ${key}`], key)).toBe(true);
  expect(leaksKey(["sk-svcacct-AnotherSyntheticValue0123456789abc"], key)).toBe(true);
  expect(leaksKey(["the guard matches `sk-` literally"], key)).toBe(false);
});

test("prettyModel", () => {
  expect(prettyModel("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
  expect(prettyModel("gpt-6-luna")).toBe("GPT-6 Luna");
  expect(prettyModel("o9")).toBe("o9");
});

/** A stand-in for the `codex` binary: a shell script, so nothing leaves the machine. */
function stubBinary(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "stub-codex-"));
  const path = join(dir, "codex");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** The value after a flag in the stub's "$@", in shell. */
const flagValue = (flag: string) =>
  `prev=""; for a in "$@"; do if [ "$prev" = "${flag}" ]; then echo "$a"; fi; prev="$a"; done`;

describe("CodexProvider with a stub binary", () => {
  const request = {
    prompt: "the prompt",
    cwd: "/runner/head",
    addDirs: ["/tmp/d"],
    allowedTools: ["read" as const, "grep" as const],
    maxBudgetUsd: 0.5,
    outputSchema: { type: "object" },
    promptViaStdin: true,
  };

  test("maps the events and the last message, runs outside the head, and strips GitHub tokens", () => {
    const binary = stubBinary(`
if [ "$1" = "--version" ]; then echo "codex-cli 0.164.0"; exit 0; fi
out=$(${flagValue("--output-last-message")})
stdin=$(cat)
case "$stdin" in *"checked out at /runner/head"*"the prompt") located=yes ;; *) located=no ;; esac
printf '{"located":"%s","cwd":"%s","home":"%s","token":"%s","key":"%s"}' "$located" "$(pwd)" "$HOME" "$GH_TOKEN" "$CODEX_API_KEY" > "$out"
echo '{"type":"item.completed","item":{"type":"command_execution"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}'`);
    process.env.GH_TOKEN = "must-not-reach-the-child";
    process.env.OPENAI_API_KEY = "sk-proj-test";
    const provider = new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: true, binary });
    provider.preflight();
    expect(provider.modelLabel()).toBe("GPT-6.1 Sol via Codex 0.164.0");
    const result = provider.run(request);
    const out = result.structuredOutput as Record<string, string>;
    expect(out.located).toBe("yes");
    expect(out.cwd).toContain("agent-review-codex-");
    expect(out.cwd).not.toBe("/runner/head");
    expect(out.home).toContain("agent-review-codex-");
    expect(out.token).toBe("");
    expect(out.key).toBe("sk-proj-test");
    expect(result).toMatchObject({ costUsd: 2, turns: 2, terminalReason: "success", isError: false });
    delete process.env.GH_TOKEN;
    delete process.env.OPENAI_API_KEY;
  });

  test("an answer that is not the schema's JSON is an error", () => {
    const binary = stubBinary(`out=$(${flagValue("--output-last-message")}); cat >/dev/null; echo "not json" > "$out"; echo '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":1}}'`);
    const result = new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: false, binary }).run(request);
    expect(result).toMatchObject({ isError: true, terminalReason: "error", text: "not json\n" });
  });

  test("a call that runs past the time limit ends as timeout", () => {
    const binary = stubBinary("cat >/dev/null; sleep 5");
    const result = new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: false, binary, timeoutMs: 200 }).run(request);
    expect(result).toMatchObject({ terminalReason: "timeout", isError: true });
  });

  test("the request's time limit wins over the adapter's, and a turn cap is accepted but unused", () => {
    const binary = stubBinary("cat >/dev/null; sleep 5");
    const result = new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: false, binary, timeoutMs: 60_000 }).run({
      ...request,
      timeoutMs: 200,
      maxTurns: 3,
    });
    expect(result.terminalReason).toBe("timeout");
  });

  test("refuses any tool beyond reads", () => {
    const provider = new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: false, binary: "/bin/false" });
    expect(() => provider.run({ ...request, allowedTools: ["shell" as never] })).toThrow("only grants reads");
  });

  test("preflight needs a price, the binary and the key", () => {
    const binary = stubBinary('echo "codex-cli 0.164.0"');
    expect(() => new CodexProvider({ model: "gpt-unknown", requireApiKey: false, binary }).preflight()).toThrow(
      "AGENT_REVIEW_PRICE_PER_MTOK",
    );
    new CodexProvider({ model: "gpt-unknown", requireApiKey: false, binary, priceOverride: "1,0.1,8" }).preflight();
    expect(() => new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: false, binary: "/nonexistent/codex" }).preflight()).toThrow(
      "did not run",
    );
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => new CodexProvider({ model: "gpt-6.1-sol", requireApiKey: true, binary }).preflight()).toThrow("OPENAI_API_KEY");
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
});

describe("selection", () => {
  test("codex is an accepted provider with its own default model", () => {
    expect(PROVIDER_NAMES).toContain("codex");
    expect(getProvider("codex", { model: "gpt-6.1-sol", dryRun: false, effort: "high" }).name).toBe("codex");
    expect(loadConfig({ AGENT_REVIEW_PROVIDER: "codex" }).model).toBe(DEFAULT_MODELS.codex);
    expect(loadConfig({}).model).toBe("claude-sonnet-5-5");
    expect(loadConfig({ AGENT_REVIEW_PROVIDER: "codex", AGENT_REVIEW_MODEL: "gpt-6-sol" }).model).toBe("gpt-6-sol");
  });
});
