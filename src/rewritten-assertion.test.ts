import { describe, expect, test } from "bun:test";
import { buildBatchPrompt, REWRITTEN_ASSERTION_RULE } from "./engine";
import { findRewrittenAssertions, renderRewrittenAssertionHint, rewrittenAssertionLines } from "./rewritten-assertion";

// Illustrative diffs shaped like a `>=` to `>` change and the test rewritten to match.
const SOURCE = {
  filename: "src/stock.ts",
  additions: 1,
  deletions: 1,
  patch: "@@ -40,3 +40,3 @@\n function canReserve(n) {\n-  return stock >= n;\n+  return stock > n;\n }",
};
const REWRITTEN_TEST = {
  filename: "src/stock.test.ts",
  additions: 1,
  deletions: 1,
  patch: [
    "@@ -22,6 +22,6 @@",
    ' test("reserves the last unit", () => {',
    "   const s = makeStock(1);",
    "-  expect(s.canReserve(1)).toBe(true);",
    "+  expect(s.canReserve(1)).toBe(false);",
    " });",
  ].join("\n"),
};
const NEW_CASE_TEST = {
  filename: "src/stock.test.ts",
  additions: 4,
  deletions: 0,
  patch: ["@@ -30,0 +31,4 @@", '+test("rejects zero", () => {', "+  expect(makeStock(1).canReserve(0)).toBe(false);", "+});", "+"].join(
    "\n",
  ),
};

describe("rewrittenAssertionLines", () => {
  test("reports the head line of a changed expected value", () => {
    expect(rewrittenAssertionLines(REWRITTEN_TEST.patch)).toEqual([24]);
  });
  test("ignores a patch that only adds test cases", () => {
    expect(rewrittenAssertionLines(NEW_CASE_TEST.patch)).toEqual([]);
  });
  test("ignores a whitespace-only change and a removed assertion", () => {
    expect(rewrittenAssertionLines("@@ -1,1 +1,1 @@\n-expect(a).toBe(1);\n+expect( a ).toBe( 1 );")).toEqual([]);
    expect(rewrittenAssertionLines("@@ -1,2 +1,1 @@\n-expect(a).toBe(1);\n x")).toEqual([]);
  });
  test("handles other frameworks and no patch", () => {
    expect(rewrittenAssertionLines("@@ -3,1 +3,1 @@\n-    self.assertEqual(f(1), 2)\n+    self.assertEqual(f(1), 3)")).toEqual([3]);
    expect(rewrittenAssertionLines(undefined)).toEqual([]);
  });
});

describe("findRewrittenAssertions", () => {
  test("needs a source change in the same batch", () => {
    expect(findRewrittenAssertions([REWRITTEN_TEST]).assertions).toEqual([]);
    expect(findRewrittenAssertions([SOURCE, REWRITTEN_TEST])).toEqual({
      sources: ["src/stock.ts"],
      assertions: [{ path: "src/stock.test.ts", line: 24 }],
    });
  });
  test("does not fire when only new test cases accompany the source change", () => {
    expect(renderRewrittenAssertionHint([SOURCE, NEW_CASE_TEST])).toBe("");
  });
});

describe("the batch prompt", () => {
  const ctx = {
    describe: "pull request #1",
    headSha: "a".repeat(40),
    paths: [],
    dropped: 0,
    everyFile: "",
    meta: {},
    instructions: "",
  } as unknown as Parameters<typeof buildBatchPrompt>[0];
  const prompt = (files: unknown[]) =>
    buildBatchPrompt(ctx, files as Parameters<typeof buildBatchPrompt>[1], false, { index: 1, total: 1 }, "/run", "");

  test("always carries the rule, at severity fix and never a blocker", () => {
    expect(prompt([SOURCE])).toContain(REWRITTEN_ASSERTION_RULE);
    expect(REWRITTEN_ASSERTION_RULE).toContain('"fix" at least');
    expect(REWRITTEN_ASSERTION_RULE).toContain('never a "blocker"');
  });
  test("carries the hint only when an assertion was rewritten next to a source change", () => {
    expect(prompt([SOURCE, REWRITTEN_TEST])).toContain("src/stock.test.ts:24");
    expect(prompt([SOURCE, NEW_CASE_TEST])).not.toContain("The engine noticed that this part changes logic");
  });
});
