import { describe, expect, test } from "bun:test";
import {
  askFindingThread,
  earlierThreadText,
  branded,
  confidenceMeter,
  inlineFindingBody,
  label,
  parseInlineTable,
  legacyFindingComment,
  legacyLabel,
  moveCommentsToBody,
  openBotThreads,
  SIGNATURE,
  type Finding,
  type Review,
} from "./engine";
import { parseLabel } from "./precision";
import type { Arm } from "./priority";

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
const oldComment = (f: Finding) => `${branded(legacyLabel(f))}\n\n${f.body}\n\n${SIGNATURE.finding}`;
const newComment = (f: Finding, arm?: Arm) => `${inlineFindingBody(f, arm)}\n\n${SIGNATURE.finding}`;

describe("confidenceMeter", () => {
  test("fills one red square per level, from the left, always three squares", () => {
    expect(confidenceMeter("high")).toBe("🟥🟥🟥 High");
    expect(confidenceMeter("medium")).toBe("🟥🟥⬜ Medium");
    expect(confidenceMeter("low")).toBe("🟥⬜⬜ Low");
  });
});

describe("inlineFindingBody, priority arm (AC2)", () => {
  test("is the brand table with the Priority row first, a blank line, then the body unchanged", () => {
    expect(inlineFindingBody(finding({ confidence: "high" }))).toBe(
      [
        "| 👮 **Wachiman** | \\`base\\` field is shown but never defined |",
        "|:--|:--|",
        "| **Priority** | **Should** · a change is expected; answer if you disagree |",
        "| **Severity** | 🟡 Consider |",
        "| **Area** | 📝 docs |",
        "| **Confidence** | 🟥🟥🟥 High |",
        "| **Track record** | no record yet · seed |",
        "",
        "The field is read but nothing sets it.",
      ].join("\n"),
    );
  });

  test("the four glosses", () => {
    const row = (f: Partial<Finding>) => inlineFindingBody(finding(f)).split("\n")[2];
    expect(row({ severity: "blocker", topic: "security", confidence: "high" })).toBe("| **Priority** | **Must** · blocks the merge |");
    expect(row({ severity: "fix", topic: "bug", confidence: "high" })).toBe("| **Priority** | **Should** · a change is expected; answer if you disagree |");
    expect(row({ confidence: "medium" })).toBe("| **Priority** | **Could** · worth a look; change on the merits |");
    expect(row({ severity: "info", topic: "adr", confidence: undefined })).toBe("| **Priority** | **FYI** · context, no code decision |");
  });

  test("a pre-existing origin appends its badge to the Priority cell and keeps the word", () => {
    const row = inlineFindingBody({ ...finding({ severity: "blocker", topic: "bug", confidence: "high" }), origin: "pre-existing" }).split("\n")[2];
    expect(row).toBe("| **Priority** | **Must** · blocks the merge · Pre-existing |");
  });

  test("a stored priority wins over the table: the row shows what the result says", () => {
    expect(inlineFindingBody({ ...finding(), priority: "must" }).split("\n")[2]).toContain("**Must**");
  });

  test("the brand is the first cell of the first row; area and confidence rows", () => {
    const body = inlineFindingBody(finding({ severity: "blocker", topic: "security", confidence: "high" }));
    expect(body.startsWith("| 👮 **Wachiman** | ")).toBe(true);
    expect(body).toContain("| **Severity** | 🔴 Blocker |");
    expect(body).toContain("| **Area** | 🔐 security |");
    expect(body).toContain("| **Confidence** | 🟥🟥🟥 High |");
  });

  test("escapes pipe, backtick and newline in the title cell", () => {
    const head = inlineFindingBody(finding({ title: "a | b\nc `d`" })).split("\n")[0];
    expect(head).toBe("| 👮 **Wachiman** | a \\| b c \\`d\\` |");
  });

  test("a finding with no confidence has no Confidence row, and still a Track record row", () => {
    const body = inlineFindingBody(finding({ confidence: undefined }));
    expect(body).not.toContain("Confidence");
    expect(body).toContain("| **Track record** | no record yet · seed |");
  });
});

describe("inlineFindingBody, word arm (AC13)", () => {
  test("is today's table, the tier word in the Severity cell and no Priority row, plus the Track record row", () => {
    expect(inlineFindingBody(finding(), "word")).toBe(
      [
        "| 👮 **Wachiman** | \\`base\\` field is shown but never defined |",
        "|:--|:--|",
        "| **Severity** | 🟡 Consider · Nit |",
        "| **Area** | 📝 docs |",
        "| **Confidence** | 🟥🟥⬜ Medium |",
        "| **Track record** | no record yet · seed |",
        "",
        "The field is read but nothing sets it.",
      ].join("\n"),
    );
    expect(inlineFindingBody(finding({ severity: "blocker", topic: "security", confidence: "high" }), "word")).toContain("| **Severity** | 🔴 Blocker · Important |");
  });

  test("both arms differ only in the Priority row and the tier word", () => {
    const f = finding({ severity: "fix", topic: "bug", confidence: "high" });
    const strip = (body: string) => body.split("\n").filter((l) => !l.startsWith("| **Priority**")).join("\n").replace(/ · (Important|Nit) \|/, " |");
    expect(strip(inlineFindingBody(f, "word"))).toBe(strip(inlineFindingBody(f, "priority")));
  });
});

describe("round trip: render, parse, same severity, topic and confidence (AC15)", () => {
  const cases: Partial<Finding>[] = [
    {},
    { severity: "blocker", topic: "security", confidence: "high" },
    { severity: "fix", topic: "bug", confidence: "low" },
    { severity: "info", topic: "adr", confidence: undefined },
    { severity: "consider", topic: "tests", confidence: "medium", title: "a | b `c`" },
  ];
  for (const over of cases) {
    const f = finding(over);
    const expected = { severity: f.severity, topic: f.topic, ...(f.confidence ? { confidence: f.confidence } : {}) };
    for (const arm of ["priority", "word"] as const) {
      test(`${f.severity}/${f.topic}/${f.confidence ?? "none"} in the ${arm} arm`, () => {
        expect(parseLabel(newComment(f, arm))).toEqual(expected);
        const t = parseInlineTable(newComment(f, arm));
        expect(t?.severity.word.toLowerCase()).toBe(f.severity);
        expect(t?.topic.word).toBe(f.topic);
        expect(t?.confidence).toBe(f.confidence);
        // The model reads today's one-line label, whichever arm wrote the table.
        expect(legacyFindingComment(newComment(f, arm))).toBe(oldComment({ ...f, title: f.title?.replace(/\n/g, " ") } as Finding));
      });
    }
    test(`${f.severity}/${f.topic}/${f.confidence ?? "none"} one-line label`, () => {
      expect(parseLabel(oldComment(f))).toEqual(expected);
    });
  }

  test("the model never sees the Priority or Track record rows or any priority word", () => {
    const f = finding({ severity: "fix", topic: "bug", confidence: "high" });
    const text = legacyFindingComment(newComment(f, "priority"));
    for (const hidden of ["Priority", "Track record", "Should", "no record yet", "|:--|"]) expect(text).not.toContain(hidden);
    expect(text.split("\n")[0]).toBe(branded(legacyLabel(f)));
    expect(text).toContain("Important · 🟠🐛 **Fix · bug:");
  });

  test("a table with a pre-existing badge keeps the Pre-existing tier word for the model", () => {
    const f = { ...finding({ severity: "fix", topic: "bug", confidence: "high" }), origin: "pre-existing" as const };
    expect(legacyFindingComment(newComment(f)).split("\n")[0]).toBe(branded(legacyLabel(f)));
  });

  test("the Severity cell is read with or without the tier word", () => {
    const withTier = parseInlineTable(newComment(finding(), "word"));
    const without = parseInlineTable(newComment(finding(), "priority"));
    expect(withTier?.severity).toEqual(without?.severity);
    expect(withTier?.rows).toBe(without ? without.rows - 1 : -1);
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
  test("moveCommentsToBody lists the one-line label the table showed, not a flattened table", () => {
    const f = finding();
    const review = (arm: Arm): Review => ({
      body: "x; 1 on their lines. Reply in a comment's thread to answer it.\n\n<!-- wachi:review -->",
      comments: [{ path: "a.ts", line: 1, side: "RIGHT", body: newComment(f, arm) }],
    });
    const shown = moveCommentsToBody(review("priority")).body;
    expect(shown).toContain(`- \`a.ts:1\`: ${branded(label(f))} ${f.body}`);
    expect(shown).toContain("Could · 🟡📝");
    expect(shown).not.toContain("|:--|");
    // The word arm keeps showing its word here too.
    expect(moveCommentsToBody(review("word")).body).toContain(`- \`a.ts:1\`: ${branded(legacyLabel(f))} ${f.body}`);
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

  test("the thread reply reader shows the earlier finding as today's label, not the table", () => {
    const f = finding({ title: "a | b", severity: "fix", topic: "bug", confidence: "high" });
    const text = earlierThreadText(
      [
        { databaseId: 1, author: { login: "github-actions" }, body: newComment(f) },
        { databaseId: 2, author: { login: "owner" }, body: "fixed" },
      ],
      3,
    );
    expect(text).not.toContain("|:--|");
    expect(text).toContain("**Fix · bug: a | b (confidence high)**");
    expect(text.endsWith("@owner: fixed")).toBe(true);
  });
});
