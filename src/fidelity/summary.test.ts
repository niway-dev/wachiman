import { describe, expect, test } from "bun:test";
import { fidelitySummary } from "./summary";
import type { Fidelity } from "./types";

const base: Fidelity = {
  claims: [],
  unexplainedFiles: [],
  grade: "B",
  reasons: [],
  trial: false,
  judgedAGrades: 0,
  questions: [],
  sensitivePaths: [],
  digest: "d",
  reviewedCommit: "a".repeat(40),
};

/** Every markdown metacharacter must be preceded by an odd number of backslashes (so it is escaped). */
export function unescaped(text: string, chars: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!chars.includes(text[i]!)) continue;
    let slashes = 0;
    while (slashes < i && text[i - 1 - slashes] === "\\") slashes++;
    if (slashes % 2 === 0) found.push(`${text[i]} at ${i}`);
  }
  return found;
}

describe("the short result in the review comment", () => {
  test("names the grade and the reasons on one line, with the trial mark for an A", () => {
    expect(fidelitySummary({ ...base, reasons: ["One unexplained change"] })).toBe("**PR Confidence: B.** One unexplained change.");
    expect(fidelitySummary({ ...base, grade: "A", trial: true })).toContain("A (trial)");
  });

  test("a reason from the author's text cannot open a link, a code span, a tag or a mention", () => {
    const out = fidelitySummary({
      ...base,
      reasons: ["Claim [click](http://evil.example) `code` <b>x</b> @octocat\nsecond line"],
    });
    expect(out.split("\n")).toHaveLength(1);
    expect(out).toContain("\\[click\\]");
    expect(out).not.toMatch(/(?<!\\)\[/);
    expect(out).not.toMatch(/(?<!\\)\]/);
    expect(out).not.toMatch(/(?<!\\)`/);
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("@octocat");
  });

  test("a backslash in the text cannot cancel the escaping of a bracket or a backtick", () => {
    for (const hostile of ["\\[click\\](http://evil.example)", "\\`code\\` and \\\\[x\\\\]"]) {
      const out = fidelitySummary({ ...base, reasons: [hostile] });
      expect(out).toMatch(/[\[`]/);
      expect(unescaped(out, "[]`")).toEqual([]);
    }
  });
});
