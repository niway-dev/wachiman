/**
 * A cheap, deterministic hint for the batch prompt: the batch changes logic in a source file and,
 * in the same diff, rewrites the expected value of an assertion in a test. A test edited to match
 * new behavior is the classic way a regression gets approved, so the reviewer is told where it is
 * and asked whether the new expectation matches the documented behavior. It is a text match on the
 * diff, never a verdict: it cannot tell a deliberate change from a masked bug.
 */
import { fileKind } from "./engine";
import { isSourceFile } from "./evidence";

/** One rewritten assertion: the test file and the line of the new expectation at the head. */
export interface RewrittenAssertion {
  path: string;
  line: number;
}

interface BatchFile {
  filename: string;
  patch?: string;
  additions: number;
  deletions: number;
}

/** A line that asserts: `expect(...)`, `assertEqual(`, `t.is(`, `should.equal`, a bare `assert x`. */
const ASSERTION = /\b(?:expect|assert\w*|should|t\.(?:is|equal|deepEqual))\b\s*[(.!]|^\s*assert\s/;

/** Test files `fileKind` does not know: `foo_test.go`, `test_foo.py`, `foo_test.py`, `FooTest.java`, `FooTests.kt`. */
const OTHER_TEST_FILE = /(?:^|\/)(?:test_[^/]*\.py|[^/]*_test\.(?:go|py|rs)|[^/]*Tests?\.(?:java|kt|swift))$/;
const isTestFile = (path: string) => fileKind(path) === "test" || OTHER_TEST_FILE.test(path);

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * Head line numbers of the assertions a test patch rewrites: a run of changed lines that removes
 * an assertion and adds a different one. A run that only adds assertions (a new test case) or
 * only removes them does not count.
 */
export function rewrittenAssertionLines(patch: string | undefined): number[] {
  if (!patch) return [];
  const found: number[] = [];
  let line = 0;
  let removed: string[] = [];
  let added: { text: string; line: number }[] = [];
  const flush = () => {
    if (removed.length > 0) {
      const before = new Set(removed.map(squash));
      const changed = added.find((a) => !before.has(squash(a.text)));
      if (changed) found.push(changed.line);
    }
    removed = [];
    added = [];
  };
  for (const row of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
    if (hunk) {
      flush();
      line = Number(hunk[1]);
    } else if (row.startsWith("+")) {
      if (ASSERTION.test(row.slice(1))) added.push({ text: row.slice(1), line });
      line++;
    } else if (row.startsWith("-")) {
      if (ASSERTION.test(row.slice(1))) removed.push(row.slice(1));
    } else if (!row.startsWith("\\")) {
      flush();
      line++;
    }
  }
  flush();
  return found;
}

/** The batch's rewritten assertions, only when the same batch also changes a source file. */
export function findRewrittenAssertions(files: readonly BatchFile[]): { sources: string[]; assertions: RewrittenAssertion[] } {
  const sources = files
    .filter((f) => fileKind(f.filename) === "code" && !isTestFile(f.filename) && isSourceFile(f.filename) && f.additions + f.deletions > 0)
    .map((f) => f.filename);
  if (sources.length === 0) return { sources, assertions: [] };
  const assertions = files
    .filter((f) => isTestFile(f.filename))
    .flatMap((f) => rewrittenAssertionLines(f.patch).map((line) => ({ path: f.filename, line })));
  return { sources, assertions };
}

const MAX_LISTED = 5;

/** The hint paragraph, or "" when no assertion was rewritten next to a source change. */
export function renderRewrittenAssertionHint(files: readonly BatchFile[]): string {
  const { sources, assertions } = findRewrittenAssertions(files);
  if (assertions.length === 0) return "";
  const where = assertions
    .slice(0, MAX_LISTED)
    .map((a) => `${a.path}:${a.line}`)
    .join(", ");
  const more = assertions.length > MAX_LISTED ? ` (and ${assertions.length - MAX_LISTED} more)` : "";
  return `The engine noticed that this part changes logic in ${sources.slice(0, MAX_LISTED).join(", ")} and, in the same diff, rewrites
the expected value of an existing assertion at ${where}${more}. Apply the rule on rewritten
assertions to it. This is a text match on the diff, not a verdict.`;
}
