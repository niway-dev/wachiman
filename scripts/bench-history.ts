#!/usr/bin/env bun
/**
 * The history of `bun run bench` on `main`: one JSON object per line (JSONL), one line per commit.
 *
 *   bun scripts/bench-history.ts --append bench.json history.jsonl   add a line for the bench's commit
 *                                                                     (nothing when that commit is already there)
 *   bun scripts/bench-history.ts history.jsonl [--last N]            Markdown table of the trend, oldest first
 *
 * CI keeps the file on the `bench-history` branch (see .github/workflows/bench.yml). A line holds
 * the commit, the time of the run, the Bun version, the platform and the median in ms per case.
 * Medians from different runner types or Bun versions are not comparable, so the platform and Bun
 * version are stored with every line.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type Entry = { commit: string; date: string; bun: string; platform: string; medians: Record<string, number> };
type Bench = { commit?: string; bun?: string; platform?: string; results: { case: string; median_ms: number }[] };

export function toEntry(b: Bench, date: string): Entry {
  return {
    commit: b.commit ?? "unknown",
    date,
    bun: b.bun ?? "unknown",
    platform: b.platform ?? "unknown",
    medians: Object.fromEntries(b.results.map((r) => [r.case, r.median_ms])),
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
  const cases = [...new Set(entries.flatMap((e) => Object.keys(e.medians)))];
  const cell = (n: number | undefined) => (n === undefined ? "n/a" : n.toFixed(1));
  const lines = [
    `| date | commit | ${cases.join(" | ")} |`,
    `| --- | --- | ${cases.map(() => "---:").join(" | ")} |`,
    ...entries.map((e) => `| ${e.date.slice(0, 10)} | ${e.commit} | ${cases.map((c) => cell(e.medians[c])).join(" | ")} |`),
  ];
  if (entries.length > 1) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    const drift = cases.map((c) => {
      const a = first.medians[c];
      const b = last.medians[c];
      if (a === undefined || b === undefined || a === 0) return "n/a";
      const p = ((b - a) / a) * 100;
      return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
    });
    lines.push(`| change over these rows |  | ${drift.join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  try {
    if (argv[0] === "--append") {
      const [, benchFile, historyFile] = argv;
      if (!benchFile || !historyFile) throw new Error("usage: --append <bench.json> <history.jsonl>");
      const entry = toEntry(JSON.parse(readFileSync(benchFile, "utf8")), new Date().toISOString());
      writeFileSync(historyFile, appendEntry(read(historyFile), entry));
    } else {
      const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--last");
      if (!file) throw new Error("usage: <history.jsonl> [--last N]");
      const li = argv.indexOf("--last");
      const last = li >= 0 ? Number(argv[li + 1]) : Infinity;
      if (li >= 0 && !(last >= 1)) throw new Error("--last needs a positive number");
      const entries = parseHistory(read(file));
      process.stdout.write(renderTable(Number.isFinite(last) ? entries.slice(-last) : entries));
    }
  } catch (e) {
    console.error(`bench-history: ${(e as Error).message}`);
    process.exit(2);
  }
}
