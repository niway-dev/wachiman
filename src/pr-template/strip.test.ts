import { describe, expect, test } from "bun:test";
import { loadCatalog, loadRepoChoice } from "./catalog";
import { checkDescription } from "./check";
import { renderTemplate } from "./render";
import { resolveTemplate } from "./resolve";
import { stripDescription } from "./strip";
import { HEAD, TITLE, validBody } from "./fixtures/check/load";

const catalog = loadCatalog();
const rendered = (choice: unknown = null) =>
  renderTemplate(resolveTemplate(catalog, choice === null ? null : loadRepoChoice(JSON.stringify(choice), catalog)), catalog.version);
const commentCount = (text: string) => (text.match(/<!--/g) ?? []).length;

describe("StripTest", () => {
  test("keeps wachiman markers and drops other comments", () => {
    const out = stripDescription(rendered());
    expect(out).toContain("<!-- wachiman:confidence:start -->");
    expect(out).toContain("<!-- wachiman:confidence:end -->");
    expect(commentCount(out)).toBe(2);
    expect(out).not.toContain("Anything that fits no section");
    expect(out).not.toContain("wachiman:pr-template version");
  });

  test("the status table's guide comment goes, with a custom row's line in it, and the table stays", () => {
    const out = stripDescription(rendered({ custom: [{ id: "team", kind: "status-row", label: "Team", guide: "Owning team" }] }));
    expect(out).not.toContain("Status table guide");
    expect(out).not.toContain("Owning team");
    expect(out).toMatch(/^\| \*\*Team\*\*\s+\|\s+\|$/m);
    expect(commentCount(out)).toBe(2);
  });

  test("a comment of the repository above the status table is kept", () => {
    const text = rendered({ preamble: ["<!-- Reminder: sign the agreement once. -->"] });
    expect(stripDescription(text)).toContain("<!-- Reminder: sign the agreement once. -->");
  });

  test("the older layout, a guide in a status row's cell, still goes", () => {
    expect(stripDescription("| | |\n|---|---|\n| **Type** | <!-- One of: Feature --> |\n")).toBe("| | |\n|---|---|\n| **Type** |  |\n");
  });

  test("collapses blank runs", () => {
    expect(stripDescription("a\n\n<!-- x -->\n\n<!-- y -->\n\nb\n", { all: true })).toBe("a\n\nb\n");
  });

  test("inline and multiline comments", () => {
    expect(stripDescription("| **Type** | <!-- one\nof --> Docs |\n<!--\nlong\n-->\nend\n", { all: true })).toBe(
      "| **Type** |  Docs |\nend\n",
    );
    expect(stripDescription("## What\n<!--\nlong\n-->\nend\n")).toBe("## What\nend\n");
    expect(stripDescription("| **Type** | <!-- one\nof --> Docs |\nend\n")).toBe("| **Type** |  Docs |\nend\n");
  });

  test("text after whole line looking comment survives", () => {
    expect(stripDescription("<!-- note --> Keep this\nmiddle line\n<!-- other -->\nend\n", { all: true })).toBe(
      " Keep this\nmiddle line\nend\n",
    );
  });

  test("text between two comments survives", () => {
    expect(stripDescription("a <!-- one --> b\nkeep me\nc <!-- two -->\nend\n", { all: true })).toBe("a  b\nkeep me\nc\nend\n");
  });

  test("stripped filled body still passes", () => {
    const result = checkDescription({
      body: stripDescription(validBody()),
      title: TITLE,
      head: HEAD,
      template: resolveTemplate(catalog, null),
      catalog,
      risk: 0,
    });
    expect(result.findings).toEqual([]);
  });

  test("the strip command text", () => {
    expect(stripDescription("## What\n<!-- gone -->\nx\n<!-- wachiman:confidence:start -->\n")).toBe(
      "## What\nx\n<!-- wachiman:confidence:start -->\n",
    );
  });
});

describe("what strip keeps that the earlier checker removed", () => {
  const claReminder = "<!-- Reminder: contributors sign the CLA once. -->";
  const withPreamble = () => rendered({ preamble: [claReminder, "- [ ] I have read CLA.md."] });

  test("a repository's own comment outside any guide position is kept", () => {
    const out = stripDescription(withPreamble());
    expect(out).toContain(claReminder);
    expect(out).toContain("- [ ] I have read CLA.md.");
    expect(commentCount(out)).toBe(3);
  });

  test("the stamp line goes and so does the intro comment", () => {
    const out = stripDescription(withPreamble());
    expect(out).not.toContain("wachiman:pr-template");
    expect(out.startsWith(claReminder)).toBe(true);
  });

  test("a comment inside the Wachiman block stays, a guide inside a custom section goes", () => {
    const text = rendered({
      custom: [{ id: "migration-notes", kind: "section", heading: "Migration notes", guide: "Say which data moves.", required: false }],
    }).replace(
      "<!-- wachiman:confidence:start -->\n<!-- wachiman:confidence:end -->",
      `<!-- wachiman:confidence:start -->\n<!-- wachiman:digest:${"0".repeat(64)} -->\n<!-- wachiman:confidence:end -->`,
    );
    const out = stripDescription(text);
    expect(out).toContain(`<!-- wachiman:digest:${"0".repeat(64)} -->`);
    expect(out).not.toContain("Say which data moves.");
    expect(out).toContain("## Migration notes");
    expect(commentCount(out)).toBe(3);
  });

  test("only the first comment under a heading is a guide: a second one is the repository's and stays", () => {
    const text = "## Migration notes\n<!-- Say which data moves. -->\n<!-- Ask the owner first. -->\n\nSteps.\n";
    expect(stripDescription(text)).toBe("## Migration notes\n<!-- Ask the owner first. -->\n\nSteps.\n");
  });

  test("only the first comment after a summary line is a guide", () => {
    const text = "<details>\n<summary>Rollback</summary>\n<!-- Say how to roll back. -->\n<!-- Page the owner. -->\nSteps.\n</details>\n";
    expect(stripDescription(text)).toBe("<details>\n<summary>Rollback</summary>\n<!-- Page the owner. -->\nSteps.\n</details>\n");
  });

  test("a guide comment is recognised by its text wherever it sits", () => {
    const guide = catalog.sections.find((e) => e.id === "what")!.guide!;
    expect(stripDescription(`intro\n\n<!-- ${guide} -->\n\nbody\n`)).toBe("intro\n\nbody\n");
    expect(stripDescription("intro\n\n<!-- my own note -->\n\nbody\n")).toBe("intro\n\n<!-- my own note -->\n\nbody\n");
  });

  test("the result is the same text with the same lines, minus comments", () => {
    const filled = validBody();
    expect(
      stripDescription(filled)
        .split("\n")
        .filter((l) => l.trim() !== ""),
    ).toEqual(filled.split("\n").filter((l) => l.trim() !== ""));
  });
});

describe("strip changes only what it removes", () => {
  const fence = "```text\nkeep  \n\n\n\nindented\t\n  trailing   \n```";

  test("whitespace inside a fenced code block stays byte for byte", () => {
    const text = `## What\n<!-- Anything that fits no section -->\n${fence}\n\nafter\n`;
    const out = stripDescription(text, { all: true });
    expect(out).toBe(`## What\n${fence}\n\nafter\n`);
    expect(out).toContain("keep  \n\n\n\nindented\t\n  trailing   \n");
  });

  test("a comment removed next to a fence does not touch the fence", () => {
    expect(stripDescription(`${fence}\n\n<!-- x -->\n\n${fence}\n`, { all: true })).toBe(`${fence}\n\n${fence}\n`);
  });

  test("trailing spaces and runs of blank lines in the author's text stay", () => {
    const text = "a  \n\n\n\nb \t\n<!-- gone -->\nc   \n";
    expect(stripDescription(text, { all: true })).toBe("a  \n\n\n\nb \t\nc   \n");
  });

  test("no comment, no change: text comes back byte for byte, including a missing final newline", () => {
    for (const text of ["x  \n\n\n\ny", "\n\nlead\n", "tail  \n\n\n", "```\n  \n\n\n```\n"]) expect(stripDescription(text)).toBe(text);
  });

  test("the blank run a removal leaves behind collapses, wherever it sits", () => {
    expect(stripDescription("<!-- x -->\n\n\ntext\n", { all: true })).toBe("text\n");
    expect(stripDescription("text\n\n\n<!-- x -->\n", { all: true })).toBe("text\n");
    expect(stripDescription("a\n\n\n<!-- x -->\n\n\nb\n", { all: true })).toBe("a\n\nb\n");
    expect(stripDescription("a\n\n\nb\n\n\n\n<!-- x -->\nc\n", { all: true })).toBe("a\n\n\nb\n\nc\n");
  });

  test("the stamp goes and leaves no extra blank line", () => {
    const stamp = `<!-- wachiman:pr-template version=1 sha256=${"a".repeat(64)} -->`;
    expect(stripDescription(`${stamp}\n\nbody  \n`)).toBe("body  \n");
  });

  test("CRLF input keeps its line endings, mixed endings stay line by line", () => {
    expect(stripDescription("a  \r\n<!-- gone -->\r\nb\r\n", { all: true })).toBe("a  \r\nb\r\n");
    expect(stripDescription("a\r\n\r\n\r\n<!-- x -->\r\n\r\nb\nc\r\n", { all: true })).toBe("a\r\n\r\nb\nc\r\n");
    const same = "x\r\ny\rz\n";
    expect(stripDescription(same)).toBe(same);
  });
});
