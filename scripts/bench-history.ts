#!/usr/bin/env bun
/**
 * The history of `bun run bench` on `main`: one JSON object per line (JSONL), one line per commit.
 *
 *   bun scripts/bench-history.ts --append history.jsonl --parent p1.json p2.json --commit c1.json c2.json
 *       add a line for the commit (nothing when that commit is already there)
 *   bun scripts/bench-history.ts history.jsonl [--last N]
 *       Markdown table of the change per commit, oldest first
 *
 * CI keeps the file on the `bench-history` branch (see .github/workflows/bench.yml). Each line is a
 * controlled measurement: the job measured the commit AND its first parent on the same runner,
 * interleaved, the way a pull request compares base and head. A line holds, per case, the parent
 * median, the commit median and the change in percent, plus the runner identity (OS, architecture,
 * CPU model) and the Bun version. Absolute medians are only comparable within one line, never
 * across lines (runners differ by up to 2.5x): the trend to read is the per-commit change.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { clean, side, type BenchRun } from "./bench-compare";

export type CaseRow = { parent_ms: number; commit_ms: number; change_pct: number };
export type Runner = { os: string; arch: string; cpu: string };
export type Entry = {
  commit: string;
  date: string;
  bun: string;
  platform: string;
  parent: string;
  runner: Runner;
  cases: Record<string, CaseRow>;
};
type Meta = { commit?: string; bun?: string; platform?: string; cpu?: string };
type Run = BenchRun & Meta;

/** Builds a controlled row from the interleaved rounds of the parent and of the commit. */
export function toEntry(parent: Run[], commit: Run[], date: string, runner: { os?: string; arch?: string } = {}): Entry {
  const p = side(parent);
  const c = side(commit);
  const cases: Record<string, CaseRow> = {};
  for (const [name, commitMs] of c) {
    const parentMs = p.get(name);
    if (parentMs === undefined) continue;
    cases[name] = { parent_ms: parentMs, commit_ms: commitMs, change_pct: parentMs === 0 ? 0 : ((commitMs - parentMs) / parentMs) * 100 };
  }
  const first = commit[0] ?? {};
  const [platOs, platArch] = (first.platform ?? "unknown-unknown").split("-");
  return {
    commit: clean(first.commit),
    parent: clean(parent[0]?.commit),
    date,
    bun: first.bun ?? "unknown",
    platform: first.platform ?? "unknown",
    runner: { os: runner.os || platOs, arch: runner.arch || platArch, cpu: first.cpu ?? "unknown" },
    cases,
  };
}

export function parseHistory(text: string): Entry[] {
  return text
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, n }) => {
      try {
        return JSON.parse(line) as Entry;
      } catch {
        throw new Error(`history line ${n} is not JSON`);
      }
    });
}

export function appendEntry(text: string, entry: Entry): string {
  if (parseHistory(text).some((e) => e.commit === entry.commit)) return text;
  return (text === "" || text.endsWith("\n") ? text : text + "\n") + JSON.stringify(entry) + "\n";
}

export function renderTable(entries: Entry[]): string {
  const cases = [...new Set(entries.flatMap((e) => Object.keys(e.cases)))];
  const cell = (e: Entry, c: string) => {
    const r = e.cases[c];
    return r === undefined ? "n/a" : `${r.change_pct >= 0 ? "+" : ""}${r.change_pct.toFixed(1)}%`;
  };
  const lines = [
    `| date | commit | runner | ${cases.join(" | ")} |`,
    `| --- | --- | --- | ${cases.map(() => "---:").join(" | ")} |`,
    ...entries.map(
      (e) => `| ${e.date.slice(0, 10)} | ${e.commit} | ${e.runner.os}-${e.runner.arch} | ${cases.map((c) => cell(e, c)).join(" | ")} |`,
    ),
  ];
  return lines.join("\n") + "\n";
}

/** Parses `<history.jsonl> --parent <json...> --commit <json...>`: the file, then the rounds of each side. */
export function parseAppendArgs(argv: string[]): { parent: string[]; commit: string[]; file: string } {
  const out = { parent: [] as string[], commit: [] as string[] };
  let target: "parent" | "commit" | null = null;
  let file: string | undefined;
  for (const a of argv) {
    if (a === "--parent" || a === "--commit") target = a === "--parent" ? "parent" : "commit";
    else if (a.startsWith("--")) throw new Error(`Unknown argument ${a}`);
    else if (target) out[target].push(a);
    else if (file === undefined) file = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  if (out.parent.length === 0 || out.commit.length === 0 || !file) {
    throw new Error("usage: --append <history.jsonl> --parent <json...> --commit <json...>");
  }
  return { ...out, file };
}

/** Parses the arguments of the table mode: `<history.jsonl> [--last N | --last=N]`. */
export function parseTableArgs(argv: string[]): { file: string; last: number } {
  let file: string | undefined;
  let last = Infinity;
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf("=");
    const flag = eq === -1 ? argv[i] : argv[i].slice(0, eq);
    const inline = eq === -1 ? undefined : argv[i].slice(eq + 1);
    if (flag === "--last") {
      last = Number(inline ?? argv[++i]);
      if (!(last >= 1)) throw new Error("--last needs a positive number");
    } else if (flag.startsWith("--")) throw new Error(`Unknown argument ${argv[i]}`);
    else if (file === undefined) file = argv[i];
    else throw new Error(`Unexpected argument ${argv[i]}`);
  }
  if (!file) throw new Error("usage: <history.jsonl> [--last N]");
  return { file, last };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  try {
    if (argv[0] === "--append") {
      const { parent, commit, file } = parseAppendArgs(argv.slice(1));
      const readRun = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Run;
      const entry = toEntry(parent.map(readRun), commit.map(readRun), new Date().toISOString(), {
        os: process.env.RUNNER_OS,
        arch: process.env.RUNNER_ARCH,
      });
      writeFileSync(file, appendEntry(read(file), entry));
    } else {
      const { file, last } = parseTableArgs(argv);
      const entries = parseHistory(read(file));
      process.stdout.write(renderTable(Number.isFinite(last) ? entries.slice(-last) : entries));
    }
  } catch (e) {
    console.error(`bench-history: ${(e as Error).message}`);
    process.exit(2);
  }
}
