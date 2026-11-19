import { describe, expect, test } from "bun:test";
import {
  askFindingThread,
  branded,
  confidenceMeter,
  inlineFindingBody,
  label,
  legacyFindingComment,
  moveCommentsToBody,
  openBotThreads,
  SIGNATURE,
  type Finding,
  type Review,
} from "./engine";
import { parseLabel } from "./precision";

const finding = (over: Partial<Finding> = {}): Finding => ({
  path: "a.ts",
  line: 1,
  severity: "consider",
  topic: "docs",
  title: "`base` field is shown but never defined",
  body: "The field is read but nothing sets it.",
  confidence: "medium",
  ...over,
});

/** What the engine posted before the table: the comment the model must keep reading. */
const oldComment = (f: Finding) => `${branded(label(f))}\n\n${f.body}\n\n${SIGNATURE.finding}`;
const newComment = (f: Finding) => `${inlineFindingBody(f)}\n\n${SIGNATURE.finding}`;

describe("confidenceMeter", () => {
  test("fills one red square per level, from the left, always three squares", () => {
    expect(confidenceMeter("high")).toBe("🟥🟥🟥 High");
    expect(confidenceMeter("medium")).toBe("🟥🟥⬜ Medium");
    expect(confidenceMeter("low")).toBe("🟥⬜⬜ Low");
  });
});

describe("inlineFindingBody", () => {
  test("is the brand table, a blank line, then the body unchanged", () => {
    expect(inlineFindingBody(finding())).toBe(
      [
        "| 👮 **Wachiman** | \\`base\\` field is shown but never defined |",
        "|:--|:--|",
        "| **Severity** | 🟡 Consider · Nit |",
        "| **Area** | 📝 docs |",
        "| **Confidence** | 🟥🟥⬜ Medium |",
        "",
        "The field is read but nothing sets it.",
      ].join("\n"),
    );
  });

  test("a blocker is Important, and the brand is the first cell of the first row", () => {
    const body = inlineFindingBody(finding({ severity: "blocker", topic: "security", confidence: "high" }));
    expect(body.startsWith("| 👮 **Wachiman** | ")).toBe(true);
    expect(body).toContain("| **Severity** | 🔴 Blocker · Important |");
    expect(body).toContain("| **Area** | 🔐 security |");
    expect(body).toContain("| **Confidence** | 🟥🟥🟥 High |");
  });

  test("escapes pipe, backtick and newline in the title cell", () => {
    const head = inlineFindingBody(finding({ title: "a | b\nc `d`" })).split("\n")[0];
    expect(head).toBe("| 👮 **Wachiman** | a \\| b c \\`d\\` |");
  });

  test("a finding with no confidence has no Confidence row", () => {
    expect(inlineFindingBody(finding({ confidence: undefined }))).not.toContain("Confidence");
  });
});

describe("parseLabel reads both shapes", () => {
  test("the table", () => {
    expect(parseLabel(newComment(finding()))).toEqual({ severity: "consider", topic: "docs", confidence: "medium" });
    expect(parseLabel(newComment(finding({ severity: "fix", topic: "bug", confidence: "low" })))).toEqual({
      severity: "fix",
      topic: "bug",
      confidence: "low",
    });
  });
  test("the table without a confidence row", () => {
    expect(parseLabel(newComment(finding({ confidence: undefined })))).toEqual({ severity: "consider", topic: "docs" });
  });
  test("the one-line label", () => {
    expect(parseLabel(oldComment(finding()))).toEqual({ severity: "consider", topic: "docs", confidence: "medium" });
  });
});

describe("the model reads today's first line, never the table", () => {
  const thread = (body: string) => ({
    isResolved: false,
    path: "a.ts",
    line: 1,
    comments: {
      nodes: [{ databaseId: 3, author: { login: "github-actions" }, authorAssociation: "NONE", body, createdAt: "2026-11-15T00:00:00Z" }],
    },
  });

  test("a table thread gives the same threads.json input as the old thread", () => {
    const f = finding();
    expect(openBotThreads([thread(newComment(f))])).toEqual(openBotThreads([thread(oldComment(f))]));
  });

  test("an old thread passes through untouched", () => {
    const f = finding({ confidence: undefined, severity: "fix", topic: "bug" });
    expect(openBotThreads([thread(oldComment(f))])[0].finding).toBe(oldComment(f));
  });

  test("a title with | and backticks comes back as the model saw it before", () => {
    const f = finding({ title: "a | b `c` <!-- x -->", severity: "blocker", topic: "security", confidence: "high" });
    expect(legacyFindingComment(newComment(f))).toBe(oldComment(f));
  });

  test("a title with a newline comes back with a space", () => {
    const f = finding({ title: "one\ntwo" });
    expect(legacyFindingComment(newComment(f))).toBe(oldComment({ ...f, title: "one two" }));
  });
});

describe("a review GitHub would not anchor", () => {
  test("moveCommentsToBody lists the legacy label, not a flattened table", () => {
    const f = finding();
    const review: Review = {
      body: "x; 1 on their lines. Reply in a comment's thread to answer it.\n\n<!-- wachi:review -->",
      comments: [{ path: "a.ts", line: 1, side: "RIGHT", body: newComment(f) }],
    };
    const moved = moveCommentsToBody(review).body;
    expect(moved).toContain(`- \`a.ts:1\`: ${branded(label(f))} ${f.body}`);
    expect(moved).not.toContain("|:--|");
  });

  test("the ask prompt reads today's label too, not the table", () => {
    const f = finding({ title: "a | b", severity: "fix", topic: "bug", confidence: "high" });
    const raw = {
      isResolved: false,
      path: "a.ts",
      line: 1,
      comments: { nodes: [{ databaseId: 3, author: { login: "github-actions" }, authorAssociation: "NONE", body: newComment(f), createdAt: "2026-11-15T00:00:00Z" }] },
    };
    expect(askFindingThread(raw as never).finding).toBe(oldComment(f));
  });
});
