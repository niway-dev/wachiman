import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding } from "./engine";
import { applyVerdicts, buildVerifyPrompt, selectCandidates, snippet, verificationSegment, type VerifierVerdict } from "./verify";

const f = (over: Partial<Finding>): Finding => ({ path: "a.ts", line: 2, severity: "fix", topic: "bug", confidence: "high", title: "t", body: "b", ...over });
const lines = (counts: Record<string, number>) => (path: string) => counts[path] ?? null;

describe("selectCandidates", () => {
  test("sends every finding above info, in order, with ids", () => {
    const info = f({ severity: "info", topic: "adr" });
    const blocker = f({ severity: "blocker" });
    const consider = f({ severity: "consider" });
    expect(selectCandidates([info, blocker, consider])).toEqual([
      { id: "c1", finding: blocker },
      { id: "c2", finding: consider },
    ]);
  });
});

describe("applyVerdicts", () => {
  const counts = lines({ "a.ts": 10, "b.ts": 3 });
  const run = (findings: Finding[], verdicts: VerifierVerdict[]) => applyVerdicts(findings, selectCandidates(findings), verdicts, counts, "/head");

  test("a refutation drops only with a disproof that exists, an absolute path under the head included", () => {
    const x = f({ line: 1 });
    const y = f({ line: 2 });
    const z = f({ line: 3 });
    const { findings, entries } = run([x, y, z], [
      { id: "c1", verdict: "refuted", reason: "r", disproof: { path: "/head/b.ts", line: 3 } },
      { id: "c2", verdict: "refuted", reason: "r", disproof: { path: "b.ts", line: 4 } },
      { id: "c3", verdict: "refuted", reason: "r" },
    ]);
    expect(findings).toEqual([{ ...y, confidence: "low" }, { ...z, confidence: "low" }]);
    expect(entries.map((e) => [e.outcome, e.claimed])).toEqual([
      ["dropped", undefined],
      ["degraded", "refuted"],
      ["degraded", "refuted"],
    ]);
    expect(entries[0].disproof).toEqual({ path: "b.ts", line: 3 });
  });

  test("a disproof at line 0 or in a missing file is not a disproof", () => {
    const { entries } = run([f({}), f({ line: 3 })], [
      { id: "c1", verdict: "refuted", reason: "r", disproof: { path: "a.ts", line: 0 } },
      { id: "c2", verdict: "refuted", reason: "r", disproof: { path: "gone.ts", line: 1 } },
    ]);
    expect(entries.map((e) => e.outcome)).toEqual(["degraded", "degraded"]);
  });

  test("confirmed keeps the finding; a severity one step away is applied, two steps or the same is not", () => {
    const { findings, entries } = run([f({ severity: "blocker" }), f({ severity: "blocker", line: 3 }), f({ severity: "consider", line: 4 })], [
      { id: "c1", verdict: "confirmed", reason: "r", severity: "fix" },
      { id: "c2", verdict: "confirmed", reason: "r", severity: "consider" },
      { id: "c3", verdict: "confirmed", reason: "r", severity: "consider" },
    ]);
    expect(findings.map((x) => x.severity)).toEqual(["fix", "blocker", "consider"]);
    expect(entries.map((e) => [e.outcome, e.severityAfter])).toEqual([
      ["moved", "fix"],
      ["kept", undefined],
      ["kept", undefined],
    ]);
  });

  test("no verdict, an unknown verdict, an unknown id or a repeated id: doubt, never a drop", () => {
    const a = f({ line: 1 });
    const b = f({ line: 2 });
    const c = f({ line: 3 });
    const { findings, entries } = run([a, b, c], [
      { id: "c9", verdict: "refuted", reason: "r", disproof: { path: "a.ts", line: 1 } },
      { id: "c2", verdict: "maybe" as never, reason: "r" },
      { id: "c3", verdict: "confirmed", reason: "first" },
      { id: "c3", verdict: "refuted", reason: "second", disproof: { path: "a.ts", line: 1 } },
    ]);
    expect(findings).toEqual([{ ...a, confidence: "low" }, { ...b, confidence: "low" }, c]);
    expect(entries.map((e) => [e.outcome, e.claimed, e.reason])).toEqual([
      ["degraded", "none", ""],
      ["degraded", "none", "r"],
      ["kept", undefined, "first"],
    ]);
  });

  test("info findings pass through untouched and keep their place", () => {
    const info = f({ severity: "info", topic: "adr", line: 0 });
    const fix = f({});
    const { findings } = applyVerdicts([info, fix], selectCandidates([info, fix]), [{ id: "c1", verdict: "confirmed", reason: "r" }], counts, "/head");
    expect(findings).toEqual([info, fix]);
  });
});

describe("the prompt", () => {
  test("holds each candidate with its numbered code and the hunks of the cited files only", () => {
    const head = mkdtempSync(join(tmpdir(), "verify-prompt-"));
    writeFileSync(join(head, "a.ts"), Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n"));
    const prompt = buildVerifyPrompt({
      describe: "branch x",
      headSha: "1234567890abcdef",
      headDir: head,
      candidates: selectCandidates([f({ line: 20 })]),
      files: [
        { filename: "a.ts", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+line 1" },
        { filename: "other.ts", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+unrelated" },
      ],
    });
    expect(prompt).toContain("at commit 1234567890ab");
    expect(prompt).toContain(" 5  line 5");
    expect(prompt).toContain("35  line 35");
    expect(prompt).not.toContain("36  line 36");
    expect(prompt).toContain('<file-diff path="a.ts">');
    expect(prompt).not.toContain("unrelated");
    expect(prompt).toContain("Never add a finding of your own");
  });

  test("a whole-file finding shows the start of the file; a missing file says so", () => {
    const head = mkdtempSync(join(tmpdir(), "verify-snippet-"));
    writeFileSync(join(head, "a.ts"), "x\ny\n");
    expect(snippet(head, { path: "a.ts", line: 0 })).toStartWith("1  x");
    expect(snippet(head, { path: "nope.ts", line: 3 })).toBe("(the file is not in the head)");
  });

  test("the newline that ends a file is not shown as one more line", () => {
    const head = mkdtempSync(join(tmpdir(), "verify-snippet-"));
    writeFileSync(join(head, "a.ts"), "x\ny\n");
    expect(snippet(head, { path: "a.ts", line: 2 })).toBe("1  x\n2  y");
  });

  test("a path that leaves the head is never read, through .. or a symlink", () => {
    const outside = mkdtempSync(join(tmpdir(), "verify-outside-"));
    writeFileSync(join(outside, "secret.txt"), "token\n");
    const head = mkdtempSync(join(tmpdir(), "verify-snippet-"));
    symlinkSync(join(outside, "secret.txt"), join(head, "link.txt"));
    const relative = join("..", outside.split("/").pop() ?? "", "secret.txt");
    for (const path of [relative, "link.txt", join(outside, "secret.txt")])
      expect(snippet(head, { path, line: 1 })).toBe("(the file is not in the head)");
  });
});

describe("verificationSegment", () => {
  const base = { model: "m", effort: "high", label: "Opus", costUsd: 0.31, entries: [], dropped: 0 };
  test("names the verifier, what it dropped and its cost; says nothing when nothing was sent", () => {
    expect(verificationSegment({ ...base, status: "verified", dropped: 3 })).toBe("verified by Opus: 3 dropped, 0 unconfirmed, $0.31");
    expect(verificationSegment({ ...base, status: "failed" })).toBe("verification failed (Opus, $0.31)");
    expect(verificationSegment({ ...base, status: "nothing" })).toBeUndefined();
  });
});
