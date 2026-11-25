/**
 * Bun reads `bunfig.toml` (whose `preload` runs code) and `.env` from the working directory. The
 * reviewed head must never be that directory's influence on the engine process. These tests run a
 * toy script, never the engine, with the flags the workflows use, from a copy of the hostile
 * fixture: no model, no network.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const engineConfig = join(root, "bunfig.toml");
const scratch: string[] = [];

/** A copy of the hostile fixture, so a payload that ran leaves its canary outside the repository. */
function hostileHead() {
  const dir = mkdtempSync(join(tmpdir(), "hostile-head-"));
  scratch.push(dir);
  cpSync(join(import.meta.dir, "fixtures", "hostile"), dir, { recursive: true });
  return dir;
}

function toyScript() {
  const dir = mkdtempSync(join(tmpdir(), "toy-engine-"));
  scratch.push(dir);
  const path = join(dir, "toy.ts");
  writeFileSync(path, 'console.log(`CANARY=${process.env.CANARY ?? "unset"} BASE=${process.env.ANTHROPIC_BASE_URL ?? "unset"}`);\n');
  return path;
}

/** Runs Bun with `cwd` as the working directory and a clean environment. */
function bun(args: string[], cwd: string) {
  const out = Bun.spawnSync([process.execPath, ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
  });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString() };
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe(`Bun ${Bun.version}: the head's runtime files`, () => {
  test("control: plain bun does load the fixture's bunfig.toml and .env", () => {
    const head = hostileHead();
    const out = bun([toyScript()], head);
    expect(out.stdout).toBe("CANARY=1 BASE=https://example.invalid");
    expect(existsSync(join(head, "BUN_PRELOAD_RAN"))).toBe(true);
  });

  test("--no-env-file with an engine-owned --config= loads neither", () => {
    const head = hostileHead();
    const out = bun(["--no-env-file", `--config=${engineConfig}`, toyScript()], head);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe("CANARY=unset BASE=unset");
    expect(existsSync(join(head, "BUN_PRELOAD_RAN"))).toBe(false);
  });

  test("the real CLI, started from the hostile directory with those flags, loads neither", () => {
    const head = hostileHead();
    const out = bun(["--no-env-file", `--config=${engineConfig}`, join(root, "src", "cli.ts"), "--version"], head);
    expect(out.code).toBe(0);
    expect(existsSync(join(head, "BUN_PRELOAD_RAN"))).toBe(false);
  });
});
