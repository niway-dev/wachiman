import { describe, expect, test } from "bun:test";
import { inertText } from "./inert";

const ZWSP = "​";

describe("inertText references", () => {
  test("an issue or pull request reference is broken so GitHub does not cross-reference or close it", () => {
    for (const text of ["fixes #12", "closes owner/repo#12", "see GH-12", "#7 and #8"]) {
      const out = inertText(text);
      expect(out).not.toMatch(/#\d/);
      expect(out).not.toMatch(/GH-\d/i);
      expect(out.replaceAll(ZWSP, "")).toBe(text);
    }
  });

  test("a hash that is not followed by a digit stays as written", () => {
    expect(inertText("C# and #hashtag and ## heading")).toBe("C# and #hashtag and ## heading");
  });

  test("an ampersand is escaped so an HTML entity cannot spell a reference or a mention", () => {
    expect(inertText("fixes &#35;12 by &#64;user").replaceAll(ZWSP, "")).toBe("fixes &amp;#35;12 by &amp;#64;user");
  });
});
