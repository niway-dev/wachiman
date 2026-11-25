import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const result = (over: { harnessMismatch?: number; batches?: number; evidenceHash?: string; reviewChange?: number }) =>
  JSON.stringify({
    case: "demo-1",
    repo: "owner/demo",
    sha: "a".repeat(40),
    tier: "pr",
    runs: 3,
    harnessMismatch: over.harnessMismatch,
    deterministic: {
      filesChanged: 10,
      batches: over.batches ?? 4,
      evidenceHash: over.evidenceHash ?? "e".repeat(64),
      promptHash: "p".repeat(64),
      evidenceBytesTotal: null,
    },
    timingMs: { reviewChange: over.reviewChange ?? 1000, evidenceSum: null },
  });

function compare(base: string, head: string) {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-bench-compare-"));
  try {
    writeFileSync(join(dir, "base.jsonl"), `${base}\n`);
    writeFileSync(join(dir, "head.jsonl"), `${head}\n`);
    const r = Bun.spawnSync([
      "bun",
      join(import.meta.dir, "compare.ts"),
      "--base",
      join(dir, "base.jsonl"),
      "--head",
      join(dir, "head.jsonl"),
    ]);
    expect(r.exitCode).toBe(0);
    return r.stdout.toString();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("identical results show no change and identical evidence", () => {
  const md = compare(result({}), result({}));
  expect(md).toContain("### demo-1 (owner/demo @ aaaaaaaaaa, tier pr)");
  expect(md).toContain("Evidence identical: **yes**");
  expect(md).not.toMatch(/\| \*\*changed\*\* \|/);
});

test("a differing size metric is flagged, with its delta, and a timing delta is a percentage", () => {
  const md = compare(result({}), result({ batches: 5, evidenceHash: "f".repeat(64), reviewChange: 1500 }));
  expect(md).toMatch(/\| batches planned \| 4 \| 5 \| \+1 \| \+25\.0% \| \*\*changed\*\* \|/);
  expect(md).toContain("Evidence identical: **no**");
  expect(md).toMatch(/\| reviewChange, total \| 1\.0 s \| 1\.5 s \| \+500 ms \| \+50\.0% \|/);
});

test("a metric the engine could not report is n/a, and a missing side is said so", () => {
  const md = compare(result({}), result({}));
  expect(md).toMatch(/\| evidence bytes, total \| n\/a \| n\/a \|/);
  expect(compare(result({}), "")).toContain("No result for head");
});

test("a harness mismatch on either side is a visible warning", () => {
  expect(compare(result({}), result({}))).not.toContain("harness mismatch");
  expect(compare(result({}), result({ harnessMismatch: 2 }))).toMatch(/Warning: harness mismatch.*base 0 batch\(es\), head 2/);
  expect(compare(result({ harnessMismatch: 1 }), result({}))).toContain("harness mismatch");
});
