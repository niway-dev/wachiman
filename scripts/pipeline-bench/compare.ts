// Turns the results of two engines (base and head) into a Markdown report, one section per case.
// Usage: bun compare.ts --base <results.jsonl> --head <results.jsonl> [--out <file.md>]
// A results file holds one JSON line per case, as printed by run.ts.
import { readFileSync, writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const basePath = arg("base");
const headPath = arg("head");
if (!basePath || !headPath) {
  console.error("usage: bun compare.ts --base <results.jsonl> --head <results.jsonl> [--out <file.md>]");
  process.exit(2);
}

interface Result {
  case: string;
  repo: string;
  sha: string;
  tier: string;
  runs: number;
  deterministic: Record<string, number | string | null>;
  stable?: boolean;
  timingMs: Record<string, number | null>;
}
const read = (path: string): Result[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));
const base = read(basePath);
const head = read(headPath);

const SIZE: [string, string][] = [
  ["filesChanged", "files changed"],
  ["filesKept", "files kept after exclusions"],
  ["filesReviewable", "files reviewable"],
  ["linesChanged", "lines changed (reviewable)"],
  ["batches", "batches planned"],
  ["providerCalls", "provider calls"],
  ["promptCharsTotal", "prompt characters, total"],
  ["evidenceBytesTotal", "evidence bytes, total"],
  ["evidenceSymbols", "evidence symbols searched"],
  ["evidenceCallSites", "evidence call sites found"],
  ["evidenceHash", "evidence digest (SHA-256, first 12)"],
  ["promptHash", "prompt digest (SHA-256, first 12)"],
];
const TIME: [string, string][] = [
  ["input", "input build (git diff + snapshot)"],
  ["filter", "filter files"],
  ["split", "split unreviewable"],
  ["planBatches", "plan batches"],
  ["reviewChange", "reviewChange, total"],
  ["evidenceSum", "evidence, sum over batches"],
  ["evidenceMaxBatch", "evidence, slowest batch"],
];

const num = (n: number) => n.toLocaleString("en-US");
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : ms >= 10 ? `${ms.toFixed(0)} ms` : `${ms.toFixed(2)} ms`);
const show = (v: number | string | null | undefined, hash: boolean) =>
  v === null || v === undefined ? "n/a" : hash ? String(v).slice(0, 12) : num(v as number);
function delta(b: number | null, h: number | null, fmt: (n: number) => string) {
  if (b === null || h === null) return ["n/a", "n/a"];
  const d = h - b;
  const sign = d > 0 ? "+" : d < 0 ? "-" : "";
  const pct = b === 0 ? (d === 0 ? "0%" : "n/a") : `${sign}${Math.abs((d / b) * 100).toFixed(1)}%`;
  return [d === 0 ? "0" : `${sign}${fmt(Math.abs(d))}`, d === 0 ? "0%" : pct];
}

const out: string[] = [];
out.push("## Pipeline baseline: the code path without the model", "");
out.push(
  "A stub provider answers instantly, so every figure is the engine's own work. Base and head ran one after the other on the same runner; timings are medians of the runs listed and still move a few percent between runs. Size metrics are exact: a row marked **changed** differs between base and head.",
  "",
);
const ids = [...new Set([...base.map((r) => r.case), ...head.map((r) => r.case)])];
if (ids.length === 0) out.push("No case produced a result.", "");
for (const id of ids) {
  const b = base.find((r) => r.case === id);
  const h = head.find((r) => r.case === id);
  const meta = h ?? b!;
  out.push(`### ${id} (${meta.repo} @ ${meta.sha.slice(0, 10)}, tier ${meta.tier})`, "");
  if (!b || !h) {
    out.push(`No result for ${!b ? "base" : "head"}; the harness or the engine failed on this case.`, "");
    continue;
  }
  const eb = b.deterministic.evidenceHash;
  const eh = h.deterministic.evidenceHash;
  out.push(
    `Evidence identical: **${eb === null || eh === null ? "n/a" : eb === eh ? "yes" : "no"}**. Prompts identical: **${b.deterministic.promptHash === h.deterministic.promptHash ? "yes" : "no"}**.`,
    `Timing runs: base ${b.runs}, head ${h.runs}.${b.stable === false || h.stable === false ? " **The digests were not stable between runs of the same engine.**" : ""}`,
    "",
    "| Size metric | Base | Head | Delta | Delta % | |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  );
  for (const [key, name] of SIZE) {
    const hash = key.endsWith("Hash");
    const bv = b.deterministic[key] ?? null;
    const hv = h.deterministic[key] ?? null;
    const [d, p] = hash || typeof bv !== "number" || typeof hv !== "number" ? ["", ""] : delta(bv, hv, num);
    out.push(`| ${name} | ${show(bv, hash)} | ${show(hv, hash)} | ${d} | ${p} | ${bv !== hv ? "**changed**" : ""} |`);
  }
  out.push("", "| Time | Base | Head | Delta | Delta % |", "| --- | ---: | ---: | ---: | ---: |");
  for (const [key, name] of TIME) {
    const bv = b.timingMs[key] ?? null;
    const hv = h.timingMs[key] ?? null;
    const [d, p] = delta(bv, hv, fmtMs);
    out.push(`| ${name} | ${bv === null ? "n/a" : fmtMs(bv)} | ${hv === null ? "n/a" : fmtMs(hv)} | ${d} | ${p} |`);
  }
  out.push("");
}
const text = `${out.join("\n")}\n`;
const dest = arg("out");
if (dest) writeFileSync(dest, text);
else process.stdout.write(text);
