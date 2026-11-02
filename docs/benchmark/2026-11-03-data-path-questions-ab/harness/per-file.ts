#!/usr/bin/env bun
/** Which file of each fired batch triggers each question: bun per-file.ts <engine-B dir> <clone> */
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { prFiles } from "./ab.ts";
const [engineDir, clone] = process.argv.slice(2);
const { QUESTIONS } = await import(join(resolve(engineDir), "src/questions/index.ts"));
const { addedLinesOf } = await import(join(resolve(engineDir), "src/evidence.ts"));
const { planBatches, filterFiles, DEFAULT_EXCLUDE } = await import(join(resolve(engineDir), "src/engine.ts"));
const rows = readFileSync(new URL("./batches.tsv", import.meta.url), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
const report: Record<string, Record<string, string[]>> = {};
for (const row of rows) {
  const [id, , base, head, file] = row.split("\t");
  const { files } = prFiles(clone, base, head);
  const { kept } = filterFiles(files, [...DEFAULT_EXCLUDE], []);
  const batch = planBatches(kept, { maxLines: 1000, maxChars: 140000 }).find((b: any) => b.files.some((f: any) => f.filename === file));
  const byQ: Record<string, string[]> = {};
  for (const q of QUESTIONS) {
    const hits = batch.files.filter((f: any) => {
      const lines = addedLinesOf(f.patch);
      return lines.length > 0 && q.applies(lines, f.filename);
    });
    if (hits.length) byQ[q.id] = hits.map((f: any) => f.filename.replace("apps/kaipu-record/src/", ""));
  }
  report[id] = byQ;
}
console.log(JSON.stringify(report, null, 2));
