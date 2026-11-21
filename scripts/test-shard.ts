#!/usr/bin/env bun
/**
 * Splits the test files into shards so CI can run them in parallel jobs. Bun 1.3.4, the version CI
 * pins, has no `--shard`, so the split is done here, by file.
 *
 *   bun scripts/test-shard.ts <index> <total>   print the files of shard <index> (1-based), one per line
 *   bun scripts/test-shard.ts --check [total]   exit 1 unless every file this script finds is in exactly one
 *                                                shard and no tracked test file is outside what it finds
 *
 * Files are packed greedily, slowest first, into the shard with the least time so far, using the
 * seconds per file in `scripts/test-timings.json`. A file missing from it gets the median of the
 * others, so a new test file is always assigned. The result depends only on the file list and the
 * timings, never on the machine.
 *
 * Refresh the timings when the suite changes a lot: read the per-file times from a CI run of
 * `bun test` (the time between one file's header and the next) and rewrite the JSON as
 * `{ "path/to/file.test.ts": seconds }`, rounded to 0.01.
 * `--check` warns about files with no entry. Stale entries for deleted files are ignored.
 *
 * Paths are printed with a leading `./`: Bun treats an argument that starts with `./` as a file
 * and any other argument as a substring filter.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const TIMINGS_PATH = join(import.meta.dir, "test-timings.json");

/** What `bun test` discovers: `.test`, `_test`, `.spec` and `_spec` with a JS or TS extension. */
const TEST_FILE = /[._](test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/** Every test file under `dir`, as a sorted list of `/`-separated paths relative to it. Skips `node_modules` and dot directories, as Bun does. */
export function discover(dir: string = root): string[] {
  const found: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
        found.push(rel ? `${rel}/${entry.name}` : entry.name);
      }
    }
  };
  walk("");
  return found.sort();
}

export function loadTimings(path: string = TIMINGS_PATH): Record<string, number> {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

/** A file costs at least this much (process start, imports), even when its recorded time rounds to zero. */
const MIN_SECONDS = 0.05;

/** The weight of a file when packing: its recorded seconds, floored; `fallback` when it has no entry. */
export function weight(file: string, timings: Record<string, number>, fallback: number): number {
  return Math.max(timings[file] ?? fallback, MIN_SECONDS);
}

/** The weight a file with no recorded time gets: the median of the recorded ones. */
export function fallbackWeight(files: string[], timings: Record<string, number>): number {
  return Math.max(median(files.filter((f) => f in timings).map((f) => timings[f]!)), MIN_SECONDS);
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** `total` shards of `files`, each a sorted list. Greedy, slowest file first, into the lightest shard (lowest index on a tie). */
export function assign(files: string[], timings: Record<string, number>, total: number): string[][] {
  const fallback = fallbackWeight(files, timings);
  const seconds = (f: string) => weight(f, timings, fallback);
  const order = [...files].sort((a, b) => seconds(b) - seconds(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards: string[][] = Array.from({ length: total }, () => []);
  const load = new Array<number>(total).fill(0);
  for (const file of order) {
    let best = 0;
    for (let i = 1; i < total; i++) if (load[i]! < load[best]!) best = i;
    shards[best]!.push(file);
    load[best]! += seconds(file);
  }
  return shards.map((s) => s.sort());
}

/** Problems with a split: files in no shard, in several shards, or not on disk. Empty when it is exact. */
export function checkSplit(files: string[], shards: string[][]): string[] {
  const problems: string[] = [];
  const count = new Map<string, number>();
  for (const shard of shards) for (const f of shard) count.set(f, (count.get(f) ?? 0) + 1);
  for (const f of files) if (!count.has(f)) problems.push(`not in any shard: ${f}`);
  for (const [f, n] of count) {
    if (n > 1) problems.push(`in ${n} shards: ${f}`);
    if (!files.includes(f)) problems.push(`not a test file: ${f}`);
  }
  shards.forEach((s, i) => s.length === 0 && problems.push(`shard ${i + 1} is empty`));
  return problems;
}

/** Tracked test files that `discover()` misses (a symlink, a dot directory): Bun might run them, the shards would not. */
export function missedByDiscovery(files: string[], dir: string = root): string[] {
  const out = spawnSync("git", ["ls-files", "-z"], { cwd: dir, encoding: "utf8" });
  if (out.status !== 0) return [];
  const have = new Set(files);
  return out.stdout
    .split("\0")
    .filter((f) => f && TEST_FILE.test(f) && !f.split("/").includes("node_modules") && !have.has(f))
    .sort();
}

function main(args: string[]): number {
  const files = discover();
  if (files.length === 0) {
    console.error("no test files found");
    return 1;
  }
  if (args[0] === "--check") {
    const total = Number(args[1] ?? 4);
    if (!Number.isInteger(total) || total < 1) {
      console.error("usage: test-shard.ts --check [total]");
      return 2;
    }
    const timings = loadTimings();
    const problems = checkSplit(files, assign(files, timings, total));
    for (const f of missedByDiscovery(files)) problems.push(`tracked test file the shards cannot see: ${f}`);
    const untimed = files.filter((f) => !(f in timings));
    if (untimed.length > 0) console.error(`warning: no recorded time for ${untimed.length} file(s), weighed as the median: ${untimed.join(", ")}`);
    for (const p of problems) console.error(p);
    if (problems.length === 0) console.error(`ok: ${files.length} test files in ${total} shards, each exactly once`);
    return problems.length === 0 ? 0 : 1;
  }
  const index = Number(args[0]);
  const total = Number(args[1]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
    console.error("usage: test-shard.ts <index> <total>   (1 <= index <= total)");
    return 2;
  }
  const shard = assign(files, loadTimings(), total)[index - 1]!;
  if (shard.length === 0) {
    console.error(`shard ${index} of ${total} has no files`);
    return 1;
  }
  console.log(shard.map((f) => `./${f}`).join("\n"));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
