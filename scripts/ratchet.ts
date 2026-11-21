#!/usr/bin/env bun
/**
 * The ratchet: the repository may not get worse under `bun lint` or `bun check`, and may get better.
 * Bun has no baseline mode for either, so this script counts what each reports, by rule (or error
 * code) and by file, and compares the counts with `scripts/ratchet-baseline.json`.
 *
 *   bun scripts/ratchet.ts [lint|check|all] [--update]
 *
 * A count that is higher than the baseline's (a new file or a new rule counts from zero) fails with
 * exit 1 and names the rule and file. A lower count passes and is reported; `--update` rewrites the
 * baseline to the current counts, which is how an improvement is locked in. `--update` of one tool
 * keeps the other tool's recorded counts. A tool that crashes, or reports failure with nothing the
 * script can read, exits 2: a broken run must never pass as a clean one.
 *
 * The tools are run through `bunx bun@<exact version>`, so a developer's own Bun does not change the
 * result. The consumer runtime (the `bun` dependency in package.json) is not involved: see ADR 0061.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** `fmt` and `check` run on this stable release. */
export const CHECK_BUN = "1.4.5";
/** `bun lint` is not in a stable release yet (1.4.5 has none): this canary is the first with it. Move to the stable release that ships it (ADR 0061). */
export const LINT_BUN = "1.4.5-canary.20261121.1";

export type Tool = "lint" | "check";
/** Count by rule (lint) or error code (check), then by file. */
export type Counts = Record<string, Record<string, number>>;
export type Baseline = Record<Tool, Counts>;
export type Runner = (tool: Tool) => { status: number | null; stdout: string; stderr: string };
export type Change = { rule: string; file: string; was: number; now: number };

const root = join(import.meta.dir, "..");
const BASELINE_PATH = join(import.meta.dir, "ratchet-baseline.json");

/** Counts from `bun lint --format json`: an array with one entry per file, each with its `messages`. Paths are made relative to `dir`. */
export function countLint(output: string, dir: string): Counts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("lint did not print JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("lint printed JSON that is not a list of files");
  const counts: Counts = {};
  for (const entry of parsed as { filePath: string; messages?: { ruleId: string | null }[] }[]) {
    const file = relative(dir, entry.filePath).split(sep).join("/");
    for (const message of entry.messages ?? []) {
      const rule = message.ruleId ?? "(no rule)";
      counts[rule] ??= {};
      counts[rule][file] = (counts[rule][file] ?? 0) + 1;
    }
  }
  return counts;
}

/** The line `bun check --no-pretty` prints for an error, like `tsc --pretty false`. Continuation lines are indented and annotation lines start with `::`. */
const CHECK_LINE = /^(\S.*)\((\d+),(\d+)\): error (TS\d+):/;
/** An error that belongs to no file: a `tsconfig.json` problem or a missing type package. */
const CHECK_GLOBAL_LINE = /^error (TS\d+):/;

/** Counts from `bun check --no-pretty` output. */
export function countCheck(output: string): Counts {
  const counts: Counts = {};
  for (const line of output.split("\n")) {
    const match = CHECK_LINE.exec(line);
    const global = match ? null : CHECK_GLOBAL_LINE.exec(line);
    if (!match && !global) continue;
    const code = match ? match[4]! : global![1]!;
    const file = match ? match[1]! : "(no file)";
    counts[code] ??= {};
    counts[code][file] = (counts[code][file] ?? 0) + 1;
  }
  return counts;
}

const byRuleThenFile = (a: Change, b: Change) =>
  a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0;

/** Every (rule, file) whose count rose or fell. A fall in one place never pays for a rise in another. */
export function compare(baseline: Counts, now: Counts): { rises: Change[]; falls: Change[] } {
  const rises: Change[] = [];
  const falls: Change[] = [];
  for (const rule of new Set([...Object.keys(baseline), ...Object.keys(now)])) {
    for (const file of new Set([...Object.keys(baseline[rule] ?? {}), ...Object.keys(now[rule] ?? {})])) {
      const was = baseline[rule]?.[file] ?? 0;
      const count = now[rule]?.[file] ?? 0;
      if (count > was) rises.push({ rule, file, was, now: count });
      if (count < was) falls.push({ rule, file, was, now: count });
    }
  }
  return { rises: rises.sort(byRuleThenFile), falls: falls.sort(byRuleThenFile) };
}

/** Keys in sorted order, so the committed file changes only where a count changes. */
function sorted(counts: Counts): Counts {
  const out: Counts = {};
  for (const rule of Object.keys(counts).sort()) {
    out[rule] = {};
    for (const file of Object.keys(counts[rule]!).sort()) out[rule][file] = counts[rule]![file]!;
  }
  return out;
}

const total = (counts: Counts) => Object.values(counts).reduce((sum, files) => sum + Object.values(files).reduce((a, b) => a + b, 0), 0);

const noun: Record<Tool, string> = { lint: "lint diagnostics", check: "type errors" };

export function ratchet(options: {
  which: Tool | "all";
  update: boolean;
  root: string;
  baselinePath: string;
  run: Runner;
  log: (line: string) => void;
}): number {
  const { which, update, baselinePath, run, log } = options;
  const tools: Tool[] = which === "all" ? ["lint", "check"] : [which];
  const exists = existsSync(baselinePath);
  if (!exists && !update) {
    log(`no baseline at ${baselinePath}: run \`bun scripts/ratchet.ts --update\` to record the current counts`);
    return 2;
  }
  const baseline: Baseline = exists ? { lint: {}, check: {}, ...JSON.parse(readFileSync(baselinePath, "utf8")) } : { lint: {}, check: {} };

  let failed = false;
  for (const tool of tools) {
    const result = run(tool);
    let now: Counts;
    try {
      if (result.status !== 0 && result.status !== 1)
        throw new Error(`${tool} exited with status ${result.status}: ${result.stderr.trim().split("\n")[0] ?? ""}`);
      now = tool === "lint" ? countLint(result.stdout, options.root) : countCheck(result.stdout);
      if (tool === "check" && result.status === 1 && total(now) === 0)
        throw new Error(`check failed but printed no error line it can count: ${result.stderr.trim().split("\n")[0] ?? ""}`);
    } catch (error) {
      log(`${tool}: ${(error as Error).message}`);
      return 2;
    }

    if (update) {
      baseline[tool] = sorted(now);
      log(`${tool}: baseline recorded, ${total(now)} ${noun[tool]}`);
      continue;
    }
    const { rises, falls } = compare(baseline[tool], now);
    for (const c of rises) log(`${tool}: ${c.rule} in ${c.file} rose from ${c.was} to ${c.now}`);
    if (rises.length > 0) {
      failed = true;
      log(`${tool}: FAILED, ${rises.length} count(s) rose over the baseline. Fix them: the baseline only goes down.`);
    }
    for (const c of falls) log(`${tool}: ${c.rule} in ${c.file} fell from ${c.was} to ${c.now}`);
    if (falls.length > 0) log(`${tool}: ${falls.length} count(s) fell. Lock it in with \`bun scripts/ratchet.ts ${tool} --update\`.`);
    if (rises.length === 0) log(`${tool}: ok, ${total(now)} ${noun[tool]}, baseline ${total(baseline[tool])}`);
  }

  if (update) writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  return failed ? 1 : 0;
}

/** Runs the pinned tool. `--no-script`: the repository's own `lint` and `check` scripts are this ratchet, so the tool must not run them again. */
function realRunner(dir: string): Runner {
  return (tool) => {
    const [version, args] = tool === "lint" ? [LINT_BUN, ["lint", "--format", "json"]] : [CHECK_BUN, ["check", "--no-pretty", "--all"]];
    const run = spawnSync("bunx", [`bun@${version}`, ...args, "--no-script"], { cwd: dir, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? run.error?.message ?? "" };
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const names = args.filter((a) => !a.startsWith("--"));
  const which = names[0] ?? "all";
  if (
    names.length > 1 ||
    (which !== "lint" && which !== "check" && which !== "all") ||
    args.some((a) => a.startsWith("--") && a !== "--update")
  ) {
    console.error("usage: bun scripts/ratchet.ts [lint|check|all] [--update]");
    process.exit(2);
  }
  process.exit(ratchet({ which, update, root, baselinePath: BASELINE_PATH, run: realRunner(root), log: (line) => console.log(line) }));
}
