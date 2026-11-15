import { describe, expect, test } from "bun:test";
import { PrTemplateConfigError, loadCatalog, loadRepoChoice, parseCatalog, type Catalog } from "./catalog";
import { displayWidth, formatTable, normalizeForStamp, parseStamp, renderTemplate, stampHashOf, templateState } from "./render";
import { resolveTemplate } from "./resolve";
import { golden, reformat } from "./fixtures/golden/load";

const catalog = loadCatalog();
const render = (choice: unknown = null, cat: Catalog = catalog) =>
  renderTemplate(resolveTemplate(cat, choice === null ? null : loadRepoChoice(JSON.stringify(choice), cat)), cat.version);
const MARKER = ["BREAKING", "CHANGE"].join(" ");

describe("renderTemplate, default", () => {
  const text = render();
  const lines = text.split("\n");

  test("the first line is the stamp and its hash covers everything below it", () => {
    const stamp = parseStamp(text)!;
    expect(lines[0]).toBe(`<!-- wachiman:pr-template version=1 sha256=${stamp.sha256} -->`);
    expect(stamp.version).toBe(1);
    expect(stamp.sha256).toBe(stampHashOf(text.slice(text.indexOf("\n") + 1)));
  });

  test("status rows, headings and details come in the earlier checker's order", () => {
    const rows = [...text.matchAll(/^\| \*\*(.+?)\*\*\s+\|/gm)].map((m) => m[1]);
    expect(rows).toEqual(["Type", "Issue", "Risk", "Rollout", "Release", "Evidence", "Decisions"]);
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(["Needs you", "What", "Why", "Evidence", "Decisions"]);
    expect([...text.matchAll(/<summary><b>(.+?)<\/b>/g)].map((m) => m[1])).toEqual([
      "Changes", "How to test", "Not verified", "Checks", "Agent context", "Notes",
    ]);
  });

  test("carries the Wachiman block and a footer with a {sha} placeholder", () => {
    expect(text).toContain("<!-- wachiman:confidence:start -->\n<!-- wachiman:confidence:end -->");
    expect(text.trimEnd().endsWith("<sub>Describes commit {sha}.</sub>")).toBe(true);
    expect(text).not.toMatch(/<model>|<sha>/);
    expect(text).not.toContain("Written by");
  });

  test("keeps the details summaries with their counters and the risk guide", () => {
    expect(text).toContain("<details><summary><b>Changes</b>: N facts, F files, +A −D</summary>");
    expect(text).toContain("<details><summary><b>Not verified</b> (N)</summary>");
    expect(text.replace(/\s+/g, " ")).toContain("Start from `wachiman pr-template risk`");
    expect(text).toContain("     Issue: [ABC-123: issue title](link), or None\n");
    expect(text).toContain("<!-- Status table guide, one line per row.\n     Type: One of: Feature");
    expect(text).not.toMatch(/^\| \*\*.*<!--/m);
  });

  test("names no private repository or company", () => {
    expect(text).not.toMatch(/cs-tack|cs-write-handoff|pento|\.claude/i);
  });

  test("guide comments are wrapped and end with a newline", () => {
    expect(text.endsWith("\n")).toBe(true);
    for (const line of lines) if (!line.startsWith("| **") && !line.startsWith("<!-- wachiman") && !line.startsWith("<!-- PR")) expect(line.length).toBeLessThan(110);
  });

  test("is deterministic", () => {
    expect(render()).toBe(text);
    expect(render({})).toBe(text);
  });
});

describe("renderTemplate, with a repository choice", () => {
  test("the preamble sits under the intro comment and above the status table", () => {
    const text = render({ preamble: ["- [ ] I said whether an AI tool wrote part of this.", "- [ ] **Outside contributors only:** I accept CLA.md."] });
    const body = text.split("\n").slice(1).join("\n");
    const first = body.indexOf("- [ ] I said");
    expect(first).toBeGreaterThan(body.indexOf("-->"));
    expect(first).toBeLessThan(body.indexOf("|               |"));
    expect(text).toContain("- [ ] I said whether an AI tool wrote part of this.\n- [ ] **Outside contributors only:** I accept CLA.md.\n\n<!-- Status table guide");
  });

  test("a multi-line preamble entry stays together", () => {
    const text = render({ preamble: ["- [ ] wrapped\n      line two"] });
    expect(text).toContain("- [ ] wrapped\n      line two\n\n<!-- Status table guide");
  });

  test("added, dropped and custom entries show up in the output", () => {
    const text = render({
      add: ["screenshots"],
      drop: ["decisions"],
      custom: [
        { id: "migration-notes", kind: "section", heading: "Migration notes", after: "evidence", guide: "Say what to run." },
        { id: "team", kind: "status-row", label: "Team", guide: "Owning team" },
      ],
    });
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(["Needs you", "What", "Why", "Evidence", "Migration notes", "Screenshots"]);
    expect(text).toContain("     Team: Owning team -->\n\n|");
    expect(text).toMatch(/^\| \*\*Team\*\*\s+\|\s+\|$/m);
    expect(text).toContain("<!-- Say what to run. -->");
  });

  test("a custom row without a guide leaves an empty cell", () => {
    expect(render({ custom: [{ id: "team", kind: "status-row", label: "Team" }] })).toMatch(/^\| \*\*Team\*\*\s+\|\s+\|$/m);
  });
});

describe("refusing the breaking-change marker", () => {
  const rejected = (choice: unknown) => expect(() => render(choice)).toThrow(PrTemplateConfigError);

  test("in a custom guide comment", () => {
    rejected({ custom: [{ id: "m", kind: "section", heading: "M", guide: `Never write ${MARKER}: here` }] });
    rejected({ custom: [{ id: "m", kind: "section", heading: "M", guide: "the breaking-change footer" }] });
  });

  test("in the preamble, whatever the case or the separator", () => {
    rejected({ preamble: [`${MARKER.toLowerCase()}: x`] });
    rejected({ preamble: ["BREAKING-CHANGE: x"] });
  });

  test("as a title-style marker", () => {
    rejected({ preamble: ["feat!: drop the flag"] });
    rejected({ preamble: ["fix(api)!: rename"] });
  });

  test("in a custom heading", () => {
    rejected({ custom: [{ id: "m", kind: "section", heading: `${MARKER} notes` }] });
  });

  test("the shipped default carries none", () => {
    expect(() => render()).not.toThrow();
  });
});

describe("parseStamp", () => {
  test("round trips and returns the body", () => {
    const text = render();
    const stamp = parseStamp(text)!;
    expect(`<!-- wachiman:pr-template version=${stamp.version} sha256=${stamp.sha256} -->\n${stamp.body}`).toBe(text);
  });

  test("is null without a stamp, with a malformed one, or when it is not the first line", () => {
    expect(parseStamp("# hello\n")).toBeNull();
    expect(parseStamp("<!-- wachiman:pr-template version=x sha256=abc -->\n")).toBeNull();
    expect(parseStamp(`\n${render()}`)).toBeNull();
  });
});

describe("templateState", () => {
  const input = (fileText: string | null, choiceText: string | null = null) => ({ catalog, fileText, choiceText });
  const fresh = render();

  test("missing", () => {
    expect(templateState(input(null))).toEqual({ state: "missing", version: 1, installedVersion: null });
  });

  test("unmanaged", () => {
    expect(templateState(input("## What\n"))).toEqual({ state: "unmanaged", version: 1, installedVersion: null });
  });

  test("current, also with Windows line endings", () => {
    expect(templateState(input(fresh))).toEqual({ state: "current", version: 1, installedVersion: 1 });
    expect(templateState(input(fresh.replace(/\n/g, "\r\n"))).state).toBe("current");
  });

  test("edited by hand when the body no longer matches its hash", () => {
    expect(templateState(input(`${fresh}extra line\n`)).state).toBe("edited-by-hand");
    expect(templateState(input(fresh.replace("## What", "## Whut"))).state).toBe("edited-by-hand");
  });

  test("outdated when the JSON changed after install", () => {
    const next = JSON.stringify({ add: ["screenshots"] });
    expect(templateState(input(fresh, next))).toEqual({ state: "outdated", version: 1, installedVersion: 1 });
  });

  test("outdated when the catalog moved to a newer version", () => {
    const bumped = parseCatalog(JSON.stringify({ ...JSON.parse(JSON.stringify(catalog)), version: 2 }));
    expect(templateState({ catalog: bumped, fileText: fresh, choiceText: null })).toEqual({ state: "outdated", version: 2, installedVersion: 1 });
  });

  test("a custom template is current against its own JSON, not outdated for differing from the default", () => {
    const json = JSON.stringify({ drop: ["decisions"], preamble: ["- [ ] hi"] });
    const custom = render(JSON.parse(json));
    expect(custom).not.toBe(fresh);
    expect(templateState(input(custom, json)).state).toBe("current");
  });

  test("invalid when the JSON breaks a rule, even when the file is missing, without falling back", () => {
    const bad = JSON.stringify({ drop: ["footer"] });
    const state = templateState(input(fresh, bad));
    expect(state).toMatchObject({ state: "invalid", version: 1, installedVersion: 1 });
    expect(state.problem).toMatch(/"footer" is locked/);
    expect(templateState(input(null, "{")).state).toBe("invalid");
  });

  test("invalid when the repository's text would carry the breaking-change marker", () => {
    const json = JSON.stringify({ preamble: ["feat!: x"] });
    expect(templateState(input(fresh, json)).state).toBe("invalid");
  });
});

describe("renderTemplate is formatter-canonical", () => {
  // The goldens are what Prettier prints for the output of renderTemplate, and equal that output
  // byte for byte. Regenerate one only to follow a deliberate change of the template:
  //   bun <script that prints renderTemplate(resolveTemplate(catalog, choice), catalog.version)> | bunx prettier@3 --parser markdown
  // run with Prettier 3.10.1 (`bunx prettier@3 --version`); `bunx prettier@3 --check` and
  // `oxfmt --check` both accept the files unchanged. The custom one is rendered from
  // fixtures/golden/custom-choice.json (an added, a dropped and a custom entry of each kind, three
  // status rows with an ASCII, an emoji and a wide-character label, and a preamble).
  test("the default template equals its golden, byte for byte", () => {
    expect(render()).toBe(golden("default-template.md"));
  });

  test("a custom template, with padding for its own labels, equals its golden", () => {
    const choice = JSON.parse(golden("custom-choice.json"));
    expect(render(choice)).toBe(golden("custom-template.md"));
  });

  test("a blank line follows every heading, and no table is compact", () => {
    for (const text of [render(), golden("custom-template.md")]) {
      const lines = text.split("\n");
      lines.forEach((l, i) => {
        if (/^#{1,6} /.test(l)) expect(lines[i + 1]).toBe("");
      });
      expect(text).not.toMatch(/^\|-{1,2}\|/m);
      expect(text).not.toContain("| | |");
    }
  });

  test("the output is its own normalization input and its own fixed point", () => {
    const body = render().slice(render().indexOf("\n") + 1);
    expect(normalizeForStamp(body)).toBe(normalizeForStamp(normalizeForStamp(body)));
  });
});

describe("displayWidth and formatTable", () => {
  test("ASCII counts one, an emoji and a wide character two, combining marks zero", () => {
    expect(displayWidth("Type")).toBe(4);
    expect(displayWidth("Ship 🚀")).toBe(7);
    expect(displayWidth("负责人")).toBe(6);
    expect(displayWidth("e\u0301")).toBe(1);
    expect(displayWidth("")).toBe(0);
  });

  test("columns are as wide as their widest cell, at least three, and the separator matches", () => {
    expect(formatTable(["", ""], [["**Ship 🚀**", ""], ["**Type**", ""]])).toEqual([
      "|             |     |",
      "| ----------- | --- |",
      "| **Ship 🚀** |     |",
      "| **Type**    |     |",
    ]);
    expect(formatTable(["A", "Bb"], [["x"]])).toEqual(["| A   | Bb  |", "| --- | --- |", "| x   |     |"]);
  });
});

describe("normalizeForStamp", () => {
  const n = normalizeForStamp;

  test("line endings do not matter", () => {
    expect(n("a\r\nb\r\n")).toBe(n("a\nb\n"));
    expect(n("a\rb\r")).toBe("a\nb\n");
  });

  test("trailing spaces and tabs go, on every line", () => {
    expect(n("a  \nb\t\n<!-- c  \n     d -->  \n")).toBe("a\nb\n<!-- c\n     d -->\n");
  });

  test("table padding is ignored, a changed cell is not", () => {
    expect(n("| **Type**      |     |\n")).toBe(n("| **Type** | |\n"));
    expect(n("| **Type** | Docs |\n")).toBe(n("| **Type**   |   Docs   |\n"));
    expect(n("| **Type** | Docs |\n")).not.toBe(n("| **Type** | Fix |\n"));
    expect(n("| **Type** | Docs |\n")).not.toBe(n("| **Type** | Docs  extra |\n"));
  });

  test("separator rows ignore dash counts and alignment colons", () => {
    expect(n("| a | b |\n| --------- | -------- |\n")).toBe(n("| a | b |\n|---|---|\n"));
    expect(n("| a | b |\n| :--- | ---: |\n")).toBe(n("| a | b |\n|-|-|\n"));
    expect(n("| a | b |\n|---|---|\n")).not.toBe(n("| a | b |\n|---|---|---|\n"));
  });

  test("runs of blank lines collapse to one and the edges are trimmed", () => {
    expect(n("\n\n a\n\n\n\nb\n\n\n")).toBe(" a\n\nb\n");
    expect(n("a\n  \n \t\nb\n")).toBe("a\n\nb\n");
    expect(n("")).toBe("");
    expect(n("\n\n")).toBe("");
  });

  test("a missing blank line is a difference", () => {
    expect(n("## What\ntext\n")).not.toBe(n("## What\n\ntext\n"));
  });

  test("spaces in ordinary text are kept", () => {
    expect(n("two  spaces here\n")).not.toBe(n("two spaces here\n"));
    expect(n("  indented\n")).toBe("  indented\n");
    expect(n("- [ ]  item\n")).toBe("- [ ]  item\n");
  });

  test("spaces inside a comment are kept, also when the comment sits in a table row", () => {
    expect(n("<!-- a  b -->\n")).toBe("<!-- a  b -->\n");
    expect(n("<!-- one\n     two  three -->\n")).toBe("<!-- one\n     two  three -->\n");
    expect(n("| **Type**   | <!-- a  b -->   |\n")).toBe("| **Type** | <!-- a  b --> |\n");
    expect(n("| **Type** | <!-- a  b --> |\n")).not.toBe(n("| **Type** | <!-- a b --> |\n"));
    expect(n("| a    | <!-- open  here\n")).toBe("| a | <!-- open  here\n");
  });

  test("a line that looks like a table row inside a multi-line comment or a code fence is kept", () => {
    expect(n("<!-- note\n|  a  |  b  |\n-->\n")).toBe("<!-- note\n|  a  |  b  |\n-->\n");
    expect(n("```\n|  a  |  b  |\n|-----|-----|\n```\n")).toBe("```\n|  a  |  b  |\n|-----|-----|\n```\n");
    expect(n("```\n| a |\n```\n| a    |\n")).toBe("```\n| a |\n```\n| a |\n");
  });

  test("the hash ignores formatting and sees any other change", () => {
    const body = render().slice(render().indexOf("\n") + 1);
    expect(stampHashOf(body)).toBe(stampHashOf(reformat(body)));
    expect(stampHashOf("a one\n")).not.toBe(stampHashOf("a two\n"));
    expect(stampHashOf(body)).not.toBe(stampHashOf(body.replace("## What", "## Whut")));
    expect(stampHashOf(body)).not.toBe(stampHashOf(body.replace("Detail in ## Evidence", "Detail in ## Evidences")));
    expect(stampHashOf(body)).not.toBe(stampHashOf(body.replace("\n- [ ]\n", "\n- [x]\n")));
  });
});

describe("templateState and a formatter", () => {
  const input = (fileText: string | null, choiceText: string | null = null) => ({ catalog, fileText, choiceText });
  /** The file with its body rewritten and the stamp line left as it was. */
  const rewritten = (file: string, change: (body: string) => string) => {
    const at = file.indexOf("\n") + 1;
    return file.slice(0, at) + change(file.slice(at));
  };
  const fresh = render();

  test("a reformatted default file (padding, trailing spaces, extra blank lines, CRLF) is still current", () => {
    const formatted = rewritten(fresh, reformat);
    expect(formatted).not.toBe(fresh);
    expect(templateState(input(formatted))).toEqual({ state: "current", version: 1, installedVersion: 1 });
    expect(templateState(input(formatted.replace(/\n/g, "\r\n"))).state).toBe("current");
    expect(templateState(input(rewritten(fresh, (b) => `\n\n${b}\n\n`))).state).toBe("current");
  });

  test("indenting the table rows (Markdown then renders code, not a table) is an edit by hand", () => {
    const indented = rewritten(fresh, (b) => b.replace(/^\|/gm, "    |"));
    expect(indented).not.toBe(fresh);
    expect(templateState(input(indented)).state).toBe("edited-by-hand");
    expect(normalizeForStamp("    | a  | b |\n")).toBe("    | a | b |\n");
  });

  test("a reformatted custom file is current against its own JSON", () => {
    const json = golden("custom-choice.json");
    const custom = golden("custom-template.md");
    expect(templateState(input(rewritten(custom, reformat), json)).state).toBe("current");
  });

  test("a reformatted file is outdated, not edited, when the JSON asks for something else", () => {
    expect(templateState(input(rewritten(fresh, reformat), JSON.stringify({ add: ["screenshots"] }))).state).toBe("outdated");
  });

  test("a real edit still reads edited by hand, reformatted or not", () => {
    const edits: ((body: string) => string)[] = [
      (b) => b.replace("## What", "## Whut"),
      (b) => b.replace("\n## Why\n", "\n"),
      (b) => b.replace("Describes commit {sha}.", "Describes the commit {sha}."),
      (b) => b.replace("One of: Feature", "One of: Features"),
      (b) => b.replace(/^(\| \*\*Type\*\*\s*\|)\s*\|/m, "$1 Docs |"),
      (b) => b.replace("- [ ]", "- [x]"),
    ];
    for (const edit of edits) {
      expect(templateState(input(rewritten(fresh, edit))).state).toBe("edited-by-hand");
      expect(templateState(input(rewritten(rewritten(fresh, edit), reformat))).state).toBe("edited-by-hand");
    }
  });
});
