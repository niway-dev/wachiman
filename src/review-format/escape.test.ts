import { describe, expect, test } from "bun:test";
import { neutralise as engineNeutralise } from "../engine";
import { defuseDetails, escapeCell, neutralise } from "./escape";

describe("neutralise", () => {
  test("is the engine's own function, so the two can never drift apart", () => {
    expect(engineNeutralise).toBe(neutralise);
  });

  test("defuses the opening and the closing of an HTML comment", () => {
    expect(neutralise("a <!-- wachi:review --> b")).toBe("a &lt;!-- wachi:review --&gt; b");
  });
});

describe("defuseDetails", () => {
  test("neutralises an opening and a closing details tag, in any case", () => {
    expect(defuseDetails("a </details> b <DETAILS open> c")).toBe("a &lt;/details> b &lt;details open> c");
  });
});

describe("escapeCell", () => {
  test("a long run of spaces with no line break is linear", () => {
    // A quadratic pattern takes minutes on 200,000 spaces; a linear one takes milliseconds.
    // The bound is that loose so a loaded CI runner cannot fail it.
    const start = performance.now();
    expect(escapeCell(`a${" ".repeat(200_000)}b`)).toBe(`a${" ".repeat(200_000)}b`);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  test("escapes a pipe so it cannot end the cell", () => {
    expect(escapeCell("a | b")).toBe("a \\| b");
  });

  test("turns a newline (LF, CRLF, CR, and the Unicode separators) into one space", () => {
    expect(escapeCell("first\nsecond")).toBe("first second");
    expect(escapeCell("first\r\nsecond")).toBe("first second");
    expect(escapeCell("first\rsecond")).toBe("first second");
    expect(escapeCell("first\u2028second")).toBe("first second");
    expect(escapeCell("first\u2029second")).toBe("first second");
    expect(escapeCell("first\u0085second")).toBe("first second");
    expect(escapeCell("first\n\n\n  second")).toBe("first second");
  });

  test("defuses a details tag so a cell cannot close the collapsed block around it", () => {
    expect(escapeCell("x </details> y")).not.toContain("</details");
  });

  test("escapes a backtick so it cannot open a code span that swallows the next cell", () => {
    expect(escapeCell("use `x` here")).toBe("use \\`x\\` here");
    expect(escapeCell("lone ` tick")).toBe("lone \\` tick");
  });

  test("defuses an HTML comment, also one split by a newline after the first call's collapse", () => {
    const text = escapeCell("<!-- wachiman sha=abc --> and <!\n-- not a comment -->");
    expect(text).not.toContain("<!--");
    expect(text).not.toContain("-->");
    expect(text).toContain("&lt;!-- wachiman sha=abc --&gt;");
  });

  test("trims leading and trailing whitespace", () => {
    expect(escapeCell("  \t padded \n ")).toBe("padded");
  });

  test("a backslash cannot cancel the escape placed after it", () => {
    // `a\|b` must stay one cell: the backslash is doubled, then the pipe escaped.
    expect(escapeCell("a\\|b")).toBe("a\\\\\\|b");
    expect(escapeCell("a\\`b")).toBe("a\\\\\\`b");
  });

  test("a hostile title keeps a table row to its cells", () => {
    const row = `| 🟠 Fix | ${escapeCell("x |\n| injected | row `code` <!-- wachi:review -->")} |`;
    expect(row.split("\n")).toHaveLength(1);
    // Every pipe that is not a delimiter is preceded by a backslash.
    expect(row.replace(/\\\|/g, "").match(/\|/g)).toHaveLength(3);
  });

  test("leaves ordinary text alone and an empty string empty", () => {
    expect(escapeCell("plain title: it works")).toBe("plain title: it works");
    expect(escapeCell("")).toBe("");
    expect(escapeCell("   ")).toBe("");
  });
});
