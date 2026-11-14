import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commit, emptyRepo, removeTempRepos } from "../../test/support/temp-repo";
import { UsageError } from "../config";
import { analyzeUnmanaged, mergeAdoption } from "./adopt";
import { loadCatalog, loadRepoChoice } from "./catalog";
import { parseInstallArgs, runInstall } from "./install";
import { renderTemplate } from "./render";
import { resolveTemplate } from "./resolve";

afterAll(removeTempRepos);

const catalog = loadCatalog();
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "adopt", name), "utf8");
const adopt = (text: string, ctx = {}) => analyzeUnmanaged(text, { catalog, ...ctx });
const generated = (text: string) => {
  const merged = mergeAdoption(null, adopt(text));
  const choice = loadRepoChoice(JSON.stringify(merged), catalog);
  return { merged, choice, output: renderTemplate(resolveTemplate(catalog, choice), catalog.version) };
};

/** Runs `install` on a repository whose only template is `old`; returns the exit code, the log and what was written. */
function installOver(old: string) {
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n", ".github/pull_request_template.md": old }, "init");
  const err: string[] = [];
  const code = runInstall(parseInstallArgs([]) as Parameters<typeof runInstall>[0], repo, { stdout: () => {}, stderr: (l: string) => void err.push(l) }, { now: () => "2026-11-14T10:00:00.000Z" });
  const choicePath = join(repo, ".github", "pr-template.json");
  return { code, log: err.join("\n"), choice: existsSync(choicePath) ? (JSON.parse(readFileSync(choicePath, "utf8")) as Record<string, unknown>) : null, template: readFileSync(join(repo, ".github", "pull_request_template.md"), "utf8") };
}

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

describe("the same file after a repository formatter padded its tables and added blank lines", () => {
  // fixtures/adopt/version-0-formatted.md is fixtures/adopt/version-0.md printed by `bunx prettier@3 --parser markdown` (3.10.1).
  const plain = adopt(fixture("version-0.md"));
  const formatted = adopt(fixture("version-0-formatted.md"));

  test("adopts to the same preamble, custom entries and additions, with nothing moved that the catalog generates", () => {
    expect(formatted.preamble).toEqual(plain.preamble);
    expect(formatted.custom).toEqual(plain.custom);
    expect(formatted.add).toEqual(plain.add);
    expect(formatted.report.filter((l) => l.startsWith("moved to preamble"))).toEqual(plain.report.filter((l) => l.startsWith("moved to preamble")));
  });

  test("a padded table row of the catalog's own body is structure, not the repository's text", () => {
    const a = adopt("## Evidence\n\n| Criterion | Evidence   |\n| --------- | ---------- |\n");
    expect(a.preamble).toEqual([]);
  });

  test("the status guide comment of a generated file is a guide, not the repository's comment", () => {
    const a = adopt("<!-- Status table guide, one line per row.\n     Type: One of: Feature, Fix\n     Issue: the link -->\n\n| | |\n|-|-|\n| **Type** | |\n");
    expect(a.preamble).toEqual([]);
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
    const rows = [...output.matchAll(/^\| \*\*(.+?)\*\*\s+\|/gm)].map((m) => m[1]);
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

  test("a custom section named C# keeps its #, and a closing sequence after a space is removed", () => {
    const a = adopt("## C#\n\nx\n\n## Tools ##\n\ny\n");
    expect(a.custom.map((c) => ("name" in c ? c.name : (c as { heading?: string }).heading))).toEqual(["C#", "Tools"]);
  });

  test("a section reusing a locked name is not a custom entry", () => {
    const a = adopt("<details><summary><b>Risk</b></summary>\n\n</details>\n");
    expect(a.custom).toEqual([]);
  });

  test("a details block that goes to the preamble keeps its closing tag, and the generated file stays balanced", () => {
    const text = "<details><summary><b>Risk</b></summary>\n\nOur own note.\n\n</details>\n";
    const { merged, output } = generated(text);
    const preamble = (merged.preamble as string[]).join("\n");
    expect(preamble).toContain("<details><summary><b>Risk</b></summary>");
    expect(preamble).toContain("Our own note.");
    expect(preamble).toContain("</details>");
    expect((output.match(/<details\b/gi) ?? []).length).toBe((output.match(/<\/details>/gi) ?? []).length);
    expect(output).toContain("Our own note.");
  });

  test("a nested custom details inside a moved one does not take the closing tag of the outer", () => {
    const a = adopt("<details>\n<summary>Outer</summary>\n<details><summary>Inner notes</summary>\ntext\n</details>\n</details>\n");
    const kept = a.preamble.join("\n");
    expect((kept.match(/<details\b/gi) ?? []).length).toBe((kept.match(/<\/details>/gi) ?? []).length);
  });

  test("a Wachiman start marker with no end marker is dropped and reported, everything after it is kept, and install succeeds", () => {
    const old = "<!-- wachiman:confidence:start -->\n- [ ] keep me\n\n## Why\n<!-- g -->\nafter the why\n";
    const a = adopt(old);
    const kept = a.preamble.join("\n");
    expect(kept).not.toContain("wachiman:confidence");
    expect(kept).toContain("- [ ] keep me");
    expect(kept).toContain("after the why");
    expect(a.report.join("\n")).toMatch(/start marker has no end marker; the marker line was dropped/);
    expect(a.report.join("\n")).not.toContain("replaced the Wachiman block");
    expect(() => generated(old)).not.toThrow();
    const done = installOver(old);
    expect(done.code).toBe(0);
    expect((done.choice!.preamble as string[]).join("\n")).toContain("after the why");
  });

  test("a Wachiman marker inside a line of text is dropped from the preamble too", () => {
    const old = "- [ ] keep <!-- wachiman:confidence:end --> this\n";
    expect(() => generated(old)).not.toThrow();
    expect(adopt(old).report.join("\n")).toMatch(/Wachiman marker/);
  });

  test("a name the loader would reject is not a custom entry: its lines stay in the preamble, balanced and reported, and install succeeds", () => {
    const longHeading = `## ${"Very long heading ".repeat(8)}`.trimEnd();
    const old = `${longHeading}\n<!-- g -->\nbody of the long one\n\n| | |\n|---|---|\n| **Owner | Team** | <!-- who --> |\n| **Ticket** | <!-- id --> |\n\n## Fine heading <b>\n\n<details><summary><b>Has > sign</b></summary>\ninside\n</details>\n`;
    const a = adopt(old);
    expect(a.custom.map((c) => c.name)).toEqual(["Ticket"]);
    const kept = a.preamble.join("\n");
    expect(kept).toContain(longHeading);
    expect(kept).toContain("| **Owner | Team** |");
    expect(kept).toContain("## Fine heading <b>");
    expect(kept).toContain("Has > sign");
    expect(kept).toContain("</details>");
    expect(a.report.join("\n")).toMatch(/cannot be a custom section.*heading is \d+ characters/);
    expect(a.report.join("\n")).toMatch(/cannot be a custom status row.*must not contain "\|"/);
    expect(() => generated(old)).not.toThrow();
    const done = installOver(old);
    expect(done.code).toBe(0);
    expect((done.choice!.preamble as string[]).join("\n")).toContain("| **Owner | Team** |");
  });

  test("a comment opened and never closed refuses the adoption before anything is written", () => {
    for (const old of ["- [ ] ok\n\nsee <!-- note\nmore text\n", "<!-- opened here\n- [ ] ok\n", "an arrow --> here\n"]) {
      expect(() => adopt(old)).toThrow(UsageError);
      expect(() => adopt(old)).toThrow(/comment|-->/);
    }
    const repo = emptyRepo();
    commit(repo, { "README.md": "x\n", ".github/pull_request_template.md": "see <!-- note\n- [ ] ok\n" }, "init");
    expect(() => runInstall(parseInstallArgs([]) as Parameters<typeof runInstall>[0], repo, { stdout: () => {}, stderr: () => {} }, { now: () => "2026-11-14T10:00:00.000Z" })).toThrow(/close|unclosed|never closed/);
    expect(existsSync(join(repo, ".github", "pr-template.json"))).toBe(false);
  });

  test("a start marker with its end marker is still replaced by the catalog's block", () => {
    const a = adopt("<!-- wachiman:confidence:start -->\nold block\n<!-- wachiman:confidence:end -->\n- [ ] keep\n");
    expect(a.preamble).toEqual(["- [ ] keep"]);
    expect(a.report.join("\n")).toContain("replaced the Wachiman block");
  });

  test("a comment under an entry that is already custom is reported as not kept", () => {
    const existing = [{ id: "migration-notes", kind: "section" as const, name: "Migration notes", required: false }];
    const a = adopt("## Migration notes\n<!-- Steps an operator runs. -->\n", { existingCustom: existing });
    const report = a.report.join("\n");
    expect(report).not.toContain("kept the comment under");
    expect(report).toContain("not kept");
    expect(a.custom).toEqual([]);
  });

  test("a table cell of a row that is already custom is reported as not kept", () => {
    const existing = [{ id: "ticket", kind: "status-row" as const, name: "Ticket", required: false }];
    const a = adopt("| | |\n|---|---|\n| **Ticket** | <!-- The ticket --> |\n", { existingCustom: existing });
    const report = a.report.join("\n");
    expect(report).not.toContain("kept the cell of");
    expect(report).toContain("not kept");
  });

  test("the cell of an unknown status row becomes its guide, and a row with more cells refuses the adoption", () => {
    const a = adopt("| | |\n|---|---|\n| **Team** | Keep this |\n");
    expect(a.custom).toEqual([expect.objectContaining({ kind: "status-row", name: "Team", guide: "Keep this" })]);
    const old = "| | |\n|---|---|\n| **Team** | Keep this | extra |\n";
    expect(() => adopt(old)).toThrow(UsageError);
    expect(() => adopt(old)).toThrow(/line 3/);
    expect(() => adopt("| | |\n|---|---|\n| **Team** | a <!-- b --> c |\n")).toThrow(/line 3/);
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
