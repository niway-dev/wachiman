import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeUnmanaged, mergeAdoption } from "./adopt";
import { loadCatalog, loadRepoChoice } from "./catalog";
import { renderTemplate } from "./render";
import { resolveTemplate } from "./resolve";

const catalog = loadCatalog();
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "adopt", name), "utf8");
const adopt = (text: string, ctx = {}) => analyzeUnmanaged(text, { catalog, ...ctx });
const generated = (text: string) => {
  const merged = mergeAdoption(null, adopt(text));
  const choice = loadRepoChoice(JSON.stringify(merged), catalog);
  return { merged, choice, output: renderTemplate(resolveTemplate(catalog, choice), catalog.version) };
};

describe("the earlier hand-copied template (version 0)", () => {
  const text = fixture("version-0.md");
  const { merged, output } = generated(text);

  test("both checkboxes go to the preamble, the wrapped one as one block", () => {
    const preamble = merged.preamble as string[];
    expect(preamble).toHaveLength(2);
    expect(preamble[0]).toBe("- [ ] I said whether an AI tool wrote part of this change, and I ran it.");
    expect(preamble[1]).toContain("**Outside contributors only:** I have read [CLA.md]");
    expect(preamble[1]).toContain("\n      not merge this pull request without it.");
  });

  test("nothing else of the old file stays: no custom entry, no add", () => {
    expect(merged.custom).toBeUndefined();
    expect(merged.add).toBeUndefined();
  });

  test("the old guide comments and the old footer are gone, and no tag placeholder is left", () => {
    expect(output).not.toContain("pr_body.py");
    expect(output).not.toContain("link the ADR by title");
    expect(output).not.toMatch(/<model>|<sha>/);
    expect(output).toContain("<sub>Describes commit {sha}.</sub>");
    expect(output).toContain("- [ ] I said whether an AI tool wrote part of this change, and I ran it.");
  });

  test("the report names the replaced guide comments and the checkboxes that moved", () => {
    const report = adopt(text).report.join("\n");
    expect(report).toContain("treated as a guide comment and replaced: Context that fits no other section.");
    expect(report).toContain("replaced the footer by the catalog's.");
    expect(report).toContain("moved to preamble: - [ ] I said whether an AI tool wrote");
  });
});

describe("a team template with its own comment, section and row", () => {
  const text = fixture("team-template.md");
  const { merged, output } = generated(text);

  test("the contributor reminder is kept in the preamble", () => {
    expect(merged.preamble).toEqual(["<!-- Reminder: outside contributors sign the contributor agreement once, before their first merge. -->"]);
  });

  test("the unknown section and row become optional custom entries after the entries that preceded them", () => {
    expect(merged.custom).toEqual([
      { id: "ticket", kind: "status-row", label: "Ticket", required: false, guide: "The ticket this change closes", after: "type" },
      { id: "migration-notes", kind: "section", heading: "Migration notes", required: false, guide: "Steps an operator runs when this is deployed, or None.", after: "why" },
    ]);
  });

  test("the generated file has them where they were, and no catalog guide of the old wording", () => {
    const headings = [...output.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings.indexOf("Migration notes")).toBe(headings.indexOf("Why") + 1);
    const rows = [...output.matchAll(/^\| \*\*(.+?)\*\* \|/gm)].map((m) => m[1]);
    expect(rows.indexOf("Ticket")).toBe(rows.indexOf("Type") + 1);
    expect(output).not.toContain("Say what changed.");
    expect(output).not.toMatch(/<sha>/);
  });
});

describe("block recognition", () => {
  test("a comment that follows no known element and matches no old guide is the repository's", () => {
    const a = adopt("<!-- Keep this branch rebased. -->\n\n## What\n\n<!-- Keep this branch rebased. -->\n");
    expect(a.preamble).toEqual(["<!-- Keep this branch rebased. -->"]);
    expect(a.report.join("\n")).toContain("treated as a guide comment and replaced: Keep this branch rebased.");
  });

  test("a comment after a known heading is a guide whatever it says; a second one is the repository's", () => {
    const a = adopt("## Why\n<!-- anything at all -->\n<!-- Ask the owner first. -->\n");
    expect(a.preamble).toEqual(["<!-- Ask the owner first. -->"]);
  });

  test("an old guide comment is recognised away from any heading, wrapped over lines", () => {
    const a = adopt("<!-- Only commands CI does not run,\n     with their exit codes. -->\n");
    expect(a.preamble).toEqual([]);
    expect(a.report.join("\n")).toContain("Only commands CI does not run, with their exit codes.");
  });

  test("the old header comment is recognised by its prefix alone", () => {
    const a = adopt("<!-- PR description template. Whatever it said after this. -->\n");
    expect(a.preamble).toEqual([]);
  });

  test("lines in a known section that the catalog does not have move to the preamble", () => {
    const a = adopt("## Needs you\n<!-- g -->\n**Before merge**\n- [ ]\n- [ ] Run the migration by hand\n");
    expect(a.preamble).toEqual(["- [ ] Run the migration by hand"]);
  });

  test("a footer-like line without a commit is not the footer", () => {
    expect(adopt("<sub>Thanks for contributing.</sub>\n").preamble).toEqual(["<sub>Thanks for contributing.</sub>"]);
  });

  test("a model or sha tag in a kept line becomes a placeholder", () => {
    const a = adopt("Drafted by <model> at <sha>\n");
    expect(a.preamble).toEqual(["Drafted by {model} at {sha}"]);
  });

  test("a catalog section that is not in the default is added back so it stays", () => {
    const a = adopt("## Screenshots\n<!-- g -->\n");
    expect(a.add).toEqual(["screenshots"]);
  });

  test("a section reusing a locked name is not a custom entry", () => {
    const a = adopt("<details><summary><b>Risk</b></summary>\n\n</details>\n");
    expect(a.custom).toEqual([]);
  });

  test("preamble blocks that were apart are kept apart with a blank line", () => {
    const a = adopt("- [ ] one\n\n- [ ] two\n- [ ] three\n");
    expect(a.preamble).toEqual(["- [ ] one", "", "- [ ] two", "- [ ] three"]);
  });
});

describe("merging into an existing definition", () => {
  const base = { base: "default", drop: ["decisions"], custom: [{ id: "ticket", kind: "status-row", label: "Ticket", required: false }], preamble: ["- [ ] one"] };

  test("existing entries stay, new ones are appended, and nothing is duplicated", () => {
    const choice = loadRepoChoice(JSON.stringify(base), catalog);
    const adoption = adopt("- [ ] one\n\n- [ ] two\n\n| | |\n|---|---|\n| **Ticket** | <!-- x --> |\n| **Owner** | <!-- who --> |\n", { existingCustom: choice.custom, existingDrop: choice.drop });
    const merged = mergeAdoption(base, adoption);
    expect(merged.drop).toEqual(["decisions"]);
    expect((merged.custom as { id: string }[]).map((c) => c.id)).toEqual(["ticket", "owner"]);
    expect(merged.preamble).toEqual(["- [ ] one", "", "- [ ] two"]);
    expect(() => loadRepoChoice(JSON.stringify(merged), catalog)).not.toThrow();
  });
});
