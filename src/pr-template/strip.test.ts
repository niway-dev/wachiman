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

  test("collapses blank runs", () => {
    expect(stripDescription("a\n\n<!-- x -->\n\n<!-- y -->\n\nb\n", { all: true })).toBe("a\n\nb\n");
  });

  test("inline and multiline comments", () => {
    expect(stripDescription("| **Type** | <!-- one\nof --> Docs |\n<!--\nlong\n-->\nend\n", { all: true })).toBe("| **Type** |  Docs |\nend\n");
    expect(stripDescription("## What\n<!--\nlong\n-->\nend\n")).toBe("## What\nend\n");
    expect(stripDescription("| **Type** | <!-- one\nof --> Docs |\nend\n")).toBe("| **Type** |  Docs |\nend\n");
  });

  test("text after whole line looking comment survives", () => {
    expect(stripDescription("<!-- note --> Keep this\nmiddle line\n<!-- other -->\nend\n", { all: true })).toBe(" Keep this\nmiddle line\nend\n");
  });

  test("text between two comments survives", () => {
    expect(stripDescription("a <!-- one --> b\nkeep me\nc <!-- two -->\nend\n", { all: true })).toBe("a  b\nkeep me\nc\nend\n");
  });

  test("stripped filled body still passes", () => {
    const result = checkDescription({ body: stripDescription(validBody()), title: TITLE, head: HEAD, template: resolveTemplate(catalog, null), catalog, risk: 0 });
    expect(result.findings).toEqual([]);
  });

  test("the strip command text", () => {
    expect(stripDescription("## What\n<!-- gone -->\nx\n<!-- wachiman:confidence:start -->\n")).toBe("## What\nx\n<!-- wachiman:confidence:start -->\n");
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

  test("a guide comment is recognised by its text wherever it sits", () => {
    const guide = catalog.sections.find((e) => e.id === "what")!.guide!;
    expect(stripDescription(`intro\n\n<!-- ${guide} -->\n\nbody\n`)).toBe("intro\n\nbody\n");
    expect(stripDescription("intro\n\n<!-- my own note -->\n\nbody\n")).toBe("intro\n\n<!-- my own note -->\n\nbody\n");
  });

  test("the result is the same text with the same lines, minus comments", () => {
    const filled = validBody();
    expect(stripDescription(filled).split("\n").filter((l) => l.trim() !== "")).toEqual(filled.split("\n").filter((l) => l.trim() !== ""));
  });
});
