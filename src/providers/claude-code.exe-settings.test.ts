/**
 * The compiled executable has no settings file next to it: the engine settings are embedded, and
 * each call writes them to a private temp file for `--settings` and removes it afterwards. The
 * `spawnSync` of the provider is replaced here, so no process starts on any OS.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ClaudeCodeProvider } from "./claude-code";
import type { EmbeddedAssets } from "../install-kind";

const SETTINGS_NAME = "src/providers/claude-code.settings.json";
// The real file, so the test fails if the engine ever reads something other than the shipped bytes.
const shipped = new Uint8Array(readFileSync(join(import.meta.dir, "claude-code.settings.json")));
const embedded: EmbeddedAssets = {
  has: (name) => name === SETTINGS_NAME,
  read: () => shipped,
};
const exe = { kind: "exe", version: "1.2.3" } as const;
const request = { prompt: "p", cwd: process.cwd(), addDirs: [], allowedTools: ["read" as const], maxBudgetUsd: 0.5, promptViaStdin: true };
const REVIEW = JSON.stringify({ is_error: false, subtype: "success", num_turns: 1, total_cost_usd: 0.01, duration_ms: 5, result: "ok" });

type Seen = { settings: string; bytes: Uint8Array; mode: number; cwd: string };
/** Records the `--settings` file as it is while the "claude" runs. */
function recordingSpawn(seen: Seen[], then: () => unknown = () => ({ status: 0, stdout: REVIEW, stderr: "" })) {
  return ((_cmd: string, args: string[], opts: { cwd: string }) => {
    const settings = args[args.indexOf("--settings") + 1];
    seen.push({ settings, bytes: new Uint8Array(readFileSync(settings)), mode: statSync(settings).mode & 0o777, cwd: opts.cwd });
    return then();
  }) as never;
}

describe("the executable's engine settings", () => {
  test("a call passes --settings a temp file holding the embedded bytes, then removes it", () => {
    const seen: Seen[] = [];
    const provider = new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary: "claude", install: exe, embedded, spawn: recordingSpawn(seen) });
    provider.run(request);
    expect(seen).toHaveLength(1);
    expect(Buffer.from(seen[0].bytes).equals(Buffer.from(shipped))).toBe(true);
    // Never in the scratch directory the session starts in: nothing there is discoverable by the agent.
    expect(dirname(seen[0].settings).startsWith(seen[0].cwd)).toBe(false);
    expect(seen[0].settings.endsWith(".json")).toBe(true);
    expect(existsSync(seen[0].settings)).toBe(false);
    expect(existsSync(dirname(seen[0].settings))).toBe(false);
    expect(existsSync(seen[0].cwd)).toBe(false);
  });

  test.skipIf(process.platform === "win32")("the temp file is readable by its owner only", () => {
    const seen: Seen[] = [];
    new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary: "claude", install: exe, embedded, spawn: recordingSpawn(seen) }).run(request);
    expect(seen[0].mode).toBe(0o600);
  });

  test("every call writes its own file, and the file is gone even when the process could not start", () => {
    const seen: Seen[] = [];
    const failing = recordingSpawn(seen, () => {
      throw new Error("spawn exploded");
    });
    const provider = new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary: "claude", install: exe, embedded, spawn: failing });
    expect(() => provider.run(request)).toThrow("spawn exploded");
    expect(existsSync(seen[0].settings)).toBe(false);
    expect(existsSync(seen[0].cwd)).toBe(false);
    const ok = recordingSpawn(seen);
    new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary: "claude", install: exe, embedded, spawn: ok }).run(request);
    expect(seen[1].settings).not.toBe(seen[0].settings);
  });

  test("preflight refuses an executable whose settings are not embedded, before any process starts", () => {
    const none: EmbeddedAssets = { has: () => false, read: () => new Uint8Array() };
    let spawned = 0;
    const provider = new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary: "claude", install: exe, embedded: none, spawn: (() => (spawned++, { status: 0, stdout: "1.0.0", stderr: "" })) as never });
    expect(() => provider.preflight()).toThrow(/claude-code\.settings\.json.*not embedded/);
    expect(spawned).toBe(0);
  });

  test("preflight accepts an executable with the settings embedded and does not look for a file beside it", () => {
    const provider = new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary: "claude", install: exe, embedded, settingsDir: "/nonexistent", spawn: (() => ({ status: 0, stdout: "2.0.0 (Claude Code)", stderr: "" })) as never });
    provider.preflight();
    expect(provider.modelLabel()).toContain("2.0.0");
  });

  test("outside an executable the on-disk settings file is passed as it is, and nothing is written", () => {
    const seen: Seen[] = [];
    new ClaudeCodeProvider({ model: "m", requireApiKey: false, binary: "claude", install: { kind: "source", root: process.cwd() }, spawn: recordingSpawn(seen) }).run(request);
    expect(seen[0].settings).toEndWith("claude-code.settings.json");
    expect(seen[0].settings).toBe(join(import.meta.dir, "claude-code.settings.json"));
    expect(existsSync(seen[0].settings)).toBe(true);
  });
});
