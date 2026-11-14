import { describe, expect, test } from "bun:test";
import { linesText, parseDescription, sectionNamed, statusRow } from "./describe";
import { fixture, validBody } from "./fixtures/check/load";

describe("parseDescription", () => {
  const parsed = parseDescription(validBody());

  test("status rows come with their line and value, comments removed", () => {
    expect(parsed.statusRows.map((r) => r.label)).toEqual(["Type", "Issue", "Risk", "Rollout", "Release", "Evidence", "Decisions"]);
    expect(statusRow(parsed, "Risk")!.value).toBe("🟢 Low, docs only");
    expect(parsed.lines[statusRow(parsed, "Risk")!.line]).toContain("**Risk**");
    expect(parseDescription("| **Type** | <!-- one of --> |\n").statusRows[0]!.value).toBe("");
  });

  test("sections run to the next heading and know where their own text stops", () => {
    expect(parsed.headings.map((h) => h.name)).toEqual(["Needs you", "What", "Why", "Evidence"]);
    const evidence = sectionNamed(parsed, "Evidence")!;
    expect(evidence.clean).toContain("Format documented");
    expect(evidence.endLine).toBe(parsed.lines.length);
    expect(parsed.lines[evidence.bodyEndLine]).toContain("<details><summary><b>Changes");
    const needs = sectionNamed(parsed, "Needs you")!;
    expect(needs.endLine).toBe(sectionNamed(parsed, "What")!.startLine);
    expect(needs.bodyEndLine).toBe(needs.endLine);
  });

  test("details blocks come with their name, summary and lines", () => {
    expect(parsed.details.map((d) => d.name)).toEqual(["Changes", "How to test", "Not verified", "Checks", "Agent context", "Notes"]);
    const changes = parsed.details[0]!;
    expect(changes.summary).toContain(": 1 fact");
    expect(parsed.lines[changes.startLine]).toStartWith("<details>");
    expect(parsed.lines[changes.endLine]).toBe("</details>");
    expect(changes.clean).toContain("Template exists");
  });

  test("the Wachiman block and the footer are found", () => {
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.lines[parsed.blocks[0]!.startLine]).toBe("<!-- wachiman:confidence:start -->");
    expect(parsed.lines[parsed.blocks[0]!.endLine]).toBe("<!-- wachiman:confidence:end -->");
    expect(parsed.subs.map((s) => s.text)).toEqual(["Describes commit cfd77e4aaaaa."]);
  });

  test("comments know their place, and the markers are marked", () => {
    const text = "<!-- top -->\nx <!-- inline --> y\n<!-- wachiman:confidence:start -->\n<!-- inner -->\n<!-- wachiman:confidence:end -->\n";
    const p = parseDescription(text);
    expect(p.comments.map((c) => [c.text, c.wholeLine, c.marker, c.inBlock])).toEqual([
      ["top", true, null, false],
      ["inline", false, null, false],
      ["wachiman:confidence:start", true, "start", false],
      ["inner", true, null, true],
      ["wachiman:confidence:end", true, "end", false],
    ]);
    expect(p.clean).toHaveLength(p.source.length);
    expect(p.clean).not.toContain("top");
  });

  test("a multi-line comment keeps the lines it spans", () => {
    const p = parseDescription("a\n<!--\nlong\n-->\nb\n");
    expect(p.comments[0]).toMatchObject({ startLine: 1, endLine: 3, wholeLine: true });
    expect(p.clean.split("\n")).toHaveLength(p.lines.length);
  });

  test("headings in code fences, comments and the Wachiman block are not headings", () => {
    const p = parseDescription(fixture("block-with-review.md") + "\n```\n## fenced\n```\n<!--\n## commented\n-->\n## Real\n");
    expect(p.headings.map((h) => h.name)).toEqual(["Real"]);
    expect(p.details).toHaveLength(0);
  });

  test("a marker with no partner is only a comment", () => {
    const p = parseDescription("<!-- wachiman:confidence:start -->\n## What\n");
    expect(p.blocks).toHaveLength(0);
    expect(p.headings.map((h) => h.name)).toEqual(["What"]);
  });

  test("segments cover every line once, in order", () => {
    for (const text of [validBody(), fixture("block-with-review.md"), "", "just text", "## A\n## B\n<details><summary><b>X</b></summary>\n\n</details>\ntail\n"]) {
      const p = parseDescription(text);
      let at = 0;
      for (const s of p.segments) {
        expect(s.startLine).toBe(at);
        expect(s.endLine).toBeGreaterThan(s.startLine);
        at = s.endLine;
      }
      expect(at).toBe(p.lines.length === 0 ? 0 : p.lines.length);
    }
  });

  test("segment kinds follow the layout of the description", () => {
    expect(parsed.segments[0]).toMatchObject({ kind: "preface", startLine: 0 });
    const kinds = parsed.segments.map((s) => s.kind);
    expect(kinds.filter((k) => k === "section")).toHaveLength(4);
    expect(kinds.filter((k) => k === "details")).toHaveLength(6);
    expect(kinds.filter((k) => k === "wachiman")).toHaveLength(1);
    expect(kinds.filter((k) => k === "footer")).toHaveLength(1);
  });

  test("nothing is lost: the lines join back to the input, with either line ending", () => {
    const text = validBody();
    expect(parsed.lines.join(parsed.eol)).toBe(text);
    const crlf = text.replaceAll("\n", "\r\n");
    const p = parseDescription(crlf);
    expect(p.eol).toBe("\r\n");
    expect(p.lines.join(p.eol)).toBe(crlf);
    expect(p.headings.map((h) => h.name)).toEqual(parsed.headings.map((h) => h.name));
    expect(linesText(p, 0, 2)).toBe("| | |\r\n|---|---|");
  });
});
