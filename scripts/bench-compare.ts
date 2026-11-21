#!/usr/bin/env bun
/**
 * Compares the `bun run bench --json` output of a base checkout and a head checkout and prints a
 * Markdown table: per case, the base median, the head median and the change in percent.
 *
 *   bun scripts/bench-compare.ts --threshold 15 --base b1.json b2.json --head h1.json h2.json [--base-commit sha] [--head-commit sha] [--out table.md]
 *
 * Each side may be several files (rounds measured one after the other, interleaved with the other
 * side, so runner noise lands on both). A case's figure for a side is the median of that side's
 * per-round medians. A case regresses when head is slower than base by more than the threshold in
 * percent AND by at least `--min-delta-ms` (default 10): on a case of a few milliseconds a large
 * percentage is just timer noise. A case present on one side only is listed and never fails.
 * Exit 1 when any case regressed, 2 on bad arguments or unreadable input.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** The harness copy dirties the base checkout; the table names the commit. */
const clean = (c?: string) => (c ?? "unknown").replace(/-dirty$/, "");

/** First line of the PR comment: how the workflow finds the comment to update. */
export const MARKER = "<!-- wachiman-bench -->";

export type BenchRun = { commit?: string; date?: string; results: { case: string; median_ms: number }[] };
export type Options = { thresholdPct: number; minDeltaMs: number };
export type Row = { case: string; baseMs: number | null; headMs: number | null; changePct: number | null; regressed: boolean };

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[Math.floor(mid)];
}

function side(runs: BenchRun[]): Map<string, number> {
  const perCase = new Map<string, number[]>();
  for (const r of runs) for (const x of r.results) perCase.set(x.case, [...(perCase.get(x.case) ?? []), x.median_ms]);
  return new Map([...perCase].map(([name, xs]) => [name, median(xs)]));
}

export function compare(base: BenchRun[], head: BenchRun[], opts: Options): { rows: Row[]; failed: boolean } {
  const b = side(base);
  const h = side(head);
  const names = [...new Set([...b.keys(), ...h.keys()])];
  const rows = names.map((name): Row => {
    const baseMs = b.get(name) ?? null;
    const headMs = h.get(name) ?? null;
    if (baseMs === null || headMs === null) return { case: name, baseMs, headMs, changePct: null, regressed: false };
    const changePct = baseMs === 0 ? 0 : ((headMs - baseMs) / baseMs) * 100;
    return { case: name, baseMs, headMs, changePct, regressed: changePct > opts.thresholdPct && headMs - baseMs >= opts.minDeltaMs };
  });
  return { rows, failed: rows.some((r) => r.regressed) };
}

const ms = (n: number | null) => (n === null ? "n/a" : `${n.toFixed(1)} ms`);
const pct = (n: number | null) => (n === null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

export function render(
  result: { rows: Row[]; failed: boolean },
  info: { thresholdPct: number; rounds: number; baseCommit: string; headCommit: string },
): string {
  const lines = [
    MARKER,
    "### Wachiman benchmark: base vs head",
    "",
    `Base \`${info.baseCommit}\`, head \`${info.headCommit}\`. Median of ${info.rounds} interleaved round${info.rounds === 1 ? "" : "s"} on the same runner; a case fails when it is more than ${info.thresholdPct}% slower.`,
    "",
    "| case | base | head | change | status |",
    "| --- | ---: | ---: | ---: | --- |",
    ...result.rows.map((r) => `| ${r.case} | ${ms(r.baseMs)} | ${ms(r.headMs)} | ${pct(r.changePct)} | ${r.regressed ? "regressed" : "ok"} |`),
    "",
    result.failed ? "At least one case regressed beyond the threshold." : "No case regressed beyond the threshold.",
  ];
  return lines.join("\n") + "\n";
}

export function parseArgs(argv: string[]) {
  const out = { base: [] as string[], head: [] as string[], thresholdPct: 15, minDeltaMs: 10, out: undefined as string | undefined, baseCommit: undefined as string | undefined, headCommit: undefined as string | undefined };
  let target: "base" | "head" | null = null;
  const num = (name: string, v: string | undefined) => {
    const n = Number(v);
    if (v === undefined || v === "" || !Number.isFinite(n) || n < 0) throw new Error(`--${name} needs a non-negative number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=", 2);
    if (flag === "--base" || flag === "--head") {
      target = flag === "--base" ? "base" : "head";
      if (inline !== undefined) out[target].push(inline);
    } else if (flag === "--threshold") {
      out.thresholdPct = num("threshold", inline ?? argv[++i]);
      target = null;
    } else if (flag === "--min-delta-ms") {
      out.minDeltaMs = num("min-delta-ms", inline ?? argv[++i]);
      target = null;
    } else if (flag === "--base-commit" || flag === "--head-commit") {
      out[flag === "--base-commit" ? "baseCommit" : "headCommit"] = inline ?? argv[++i];
      target = null;
    } else if (flag === "--out") {
      out.out = inline ?? argv[++i];
      target = null;
    } else if (!flag.startsWith("--") && target) out[target].push(argv[i]);
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (out.base.length === 0) throw new Error("--base needs at least one JSON file");
  if (out.head.length === 0) throw new Error("--head needs at least one JSON file");
  return out;
}

if (import.meta.main) {
  let args: ReturnType<typeof parseArgs>;
  let base: BenchRun[];
  let head: BenchRun[];
  try {
    args = parseArgs(process.argv.slice(2));
    const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as BenchRun;
    base = args.base.map(read);
    head = args.head.map(read);
  } catch (e) {
    console.error(`bench-compare: ${(e as Error).message}`);
    process.exit(2);
  }
  const result = compare(base, head, args);
  const md = render(result, {
    thresholdPct: args.thresholdPct,
    rounds: Math.min(base.length, head.length),
    baseCommit: args.baseCommit ?? clean(base[0].commit),
    headCommit: args.headCommit ?? clean(head[0].commit),
  });
  if (args.out) writeFileSync(args.out, md);
  else process.stdout.write(md);
  process.exit(result.failed ? 1 : 0);
}
