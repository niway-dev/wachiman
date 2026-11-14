import { describe, expect, test } from "bun:test";
import { loadCatalog, loadRepoChoice } from "./catalog";
import { bareAdrMentions, checkDescription, type CheckInput } from "./check";
import { HIGH, LOW, MEDIUM, type Risk } from "./pr-risk";
import { renderTemplate } from "./render";
import { resolveTemplate } from "./resolve";
import { stripDescription } from "./strip";
import {
  ADR_LINK, BREAKING_HYPHEN, BREAKING_TEXT, fixture, HEAD, TITLE, validBody, validCustomBody, withDecisions,
} from "./fixtures/check/load";

const catalog = loadCatalog();
const defaultTemplate = resolveTemplate(catalog, null);
const customTemplate = () => resolveTemplate(catalog, loadRepoChoice(fixture("custom-template.json"), catalog));

type Overrides = Partial<Omit<CheckInput, "body" | "template">> & { template?: CheckInput["template"] };

/** The finding codes for a body; the risk floor defaults to Low, as the earlier suite's helper did. */
function codes(body: string = validBody(), o: Overrides = {}): string[] {
  return checkDescription({
    body,
    title: TITLE,
    head: HEAD,
    template: defaultTemplate,
    catalog,
    risk: LOW,
    commitMessages: [],
    ...o,
  }).findings.map((f) => f.code);
}

const swap = (body: string, a: string, b: string, c: string) => {
  const [i, j, k] = [body.indexOf(a), body.indexOf(b), body.indexOf(c)];
  return body.slice(0, i) + body.slice(j, k) + body.slice(i, j) + body.slice(k);
};

describe("ValidBodyTest", () => {
  test("filled template passes", () => {
    expect(codes()).toEqual([]);
  });

  test("filled template with decisions passes", () => {
    expect(codes(withDecisions(ADR_LINK))).toEqual([]);
  });

  test("unfilled template fails", () => {
    const raw = renderTemplate(defaultTemplate, catalog.version);
    const got = new Set(codes(raw));
    for (const code of ["needs-you-empty", "risk-unstated", "footer-missing"]) expect(got.has(code)).toBe(true);
  });

  test("template comments in table rows close on their line", () => {
    const raw = renderTemplate(defaultTemplate, catalog.version);
    for (const line of raw.split("\n")) {
      if (line.trimStart().startsWith("|") && line.includes("<!--")) {
        expect(line.split("<!--").length).toBe(line.split("-->").length);
      }
    }
  });

  test("the generated template has no breaking-change text", () => {
    expect(renderTemplate(defaultTemplate, catalog.version)).not.toMatch(/BREAKING[ -]CHANGE/);
  });

  test("the generated template has no bang or adr number", () => {
    const raw = renderTemplate(defaultTemplate, catalog.version);
    expect(bareAdrMentions(raw.replace(/<!--[\s\S]*?-->/g, ""))).toEqual([]);
  });

  test("a description filled in from the generated template passes", () => {
    let body = renderTemplate(defaultTemplate, catalog.version);
    const row = (label: string, value: string) => {
      body = body.replace(new RegExp(`(\\| \\*\\*${label}\\*\\* \\| )<!--[\\s\\S]*?-->( \\|)`), (_m, a: string, b: string) => `${a}${value}${b}`);
    };
    for (const [label, value] of [["Type", "Docs"], ["Issue", "None"], ["Risk", "🟢 Low, docs only"], ["Rollout", "No production effect"], ["Release", "No release"], ["Evidence", "Command output"], ["Decisions", "None"]] as const) {
      row(label, value);
    }
    body = body.replace("**Before merge**\n- [ ]\n\n**After merge**\n- [ ]\n", "Nothing. Merge when checks are green.\n");
    const section = (heading: string, text: string) => {
      body = body.replace(new RegExp(`(## ${heading}\\n<!--[\\s\\S]*?-->\\n)`), (_m, a: string) => `${a}${text}\n`);
    };
    section("What", "The format is documented.");
    section("Why", "Descriptions had no fixed shape.");
    body = body.replace("| Criterion | Evidence |\n|---|---|\n", "| Criterion | Evidence |\n|---|---|\n| Format documented | [output](https://example.com/o) |\n");
    body = body.replace("| Change | Before | After | Where to look |\n|---|---|---|---|\n", "| Change | Before | After | Where to look |\n|---|---|---|---|\n| Template exists | none | one file | docs/format.md |\n");
    body = body.slice(0, body.indexOf("## Decisions")) + body.slice(body.indexOf("<details><summary><b>Changes"));
    body = body.replace("Describes commit {sha}.", `Describes commit ${HEAD.slice(0, 12)}.`);
    expect(codes(body)).toEqual([]);
    expect(codes(stripDescription(body))).toEqual([]);
  });
});

describe("HeadingTest", () => {
  test("heading missing", () => {
    expect(codes(validBody().replace("## Why\n", ""))).toEqual(["heading-missing"]);
  });

  test("heading order", () => {
    const body = validBody();
    expect(codes(swap(body, "## What", "## Why", "## Evidence"))).toEqual(["heading-order"]);
  });

  test("heading unknown", () => {
    expect(codes(`${validBody()}\n## Rollback plan\nText.\n`)).toEqual(["heading-unknown"]);
  });

  test("heading inside code fence or comment is ignored", () => {
    const body = validBody().replace("The format is documented.", "```\n## Not a heading\n```\n<!--\n## Also not\n-->\nThe format is documented.");
    expect(codes(body)).toEqual([]);
  });

  test("subheading is not checked", () => {
    expect(codes(`${validBody()}\n### Detail\n`)).toEqual([]);
  });
});

describe("StatusRowTest", () => {
  test("status row missing", () => {
    expect(codes(validBody().replace(/\| \*\*Rollout\*\* \|[^\n]*\n/, ""))).toEqual(["status-row-missing"]);
  });
});

describe("NeedsYouTest", () => {
  test("needs you empty", () => {
    expect(codes(validBody().replace("Nothing. Merge when checks are green.\n", "**Before merge**\n- [ ]\n"))).toEqual(["needs-you-empty"]);
  });

  test("checkbox with text counts", () => {
    expect(codes(validBody().replace("Nothing. Merge when checks are green.\n", "**Before merge**\n- [ ] Read the template\n"))).toEqual([]);
  });
});

describe("AdrTest", () => {
  test("adr bare number in text", () => {
    for (const text of ["ADR 0033", "ADR-0033", "ADR 33", "adr 0033"]) {
      expect(codes(validBody().replace("The format is documented.", `Follows ${text} here.`))).toEqual(["adr-bare-number"]);
    }
  });

  test("adr titled link is fine", () => {
    expect(codes(validBody().replace("The format is documented.", `Follows ${ADR_LINK} here.`))).toEqual([]);
  });

  test("adr link with only the number as text is bare", () => {
    expect(codes(validBody().replace("The format is documented.", "Follows [ADR 0033](../adr/0033-x.md)."))).toEqual(["adr-bare-number"]);
  });

  test("adr in url is not a mention", () => {
    expect(codes(validBody().replace("The format is documented.", "See https://example.com/adr-0033-x.md now."))).toEqual([]);
  });

  test("decisions record with bare number", () => {
    expect(codes(withDecisions("0033"))).toEqual(["adr-bare-number"]);
  });

  test("decisions record without link", () => {
    expect(codes(withDecisions("the template ADR"))).toEqual(["adr-bare-number"]);
  });

  test("decisions record link with number text", () => {
    expect(codes(withDecisions("[0033](../adr/0033-x.md)"))).toEqual(["adr-bare-number"]);
  });

  test("decisions record none is fine", () => {
    expect(codes(withDecisions("None"))).toEqual([]);
  });
});

describe("BreakingTest", () => {
  test("bang in title", () => {
    expect(codes(validBody(), { title: "feat(api)!: drop v1" })).toEqual(["breaking-change"]);
    expect(codes(validBody(), { title: "feat!: drop v1" })).toEqual(["breaking-change"]);
  });

  test("breaking change in body comment", () => {
    const body = validBody() + fixture("breaking-in-comment.md").replace("{{BREAKING}}", BREAKING_TEXT);
    expect(codes(body)).toEqual(["breaking-change"]);
  });

  test("breaking hyphen form", () => {
    expect(codes(`${validBody()}\n${BREAKING_HYPHEN}: x\n`)).toEqual(["breaking-change"]);
  });

  test("breaking change in commit message", () => {
    expect(codes(validBody(), { commitMessages: [`fix: a\n\n${BREAKING_TEXT}: b`] })).toEqual(["breaking-change"]);
  });

  test("allow breaking overrides", () => {
    expect(codes(validBody(), { title: "feat!: drop v1", commitMessages: [`${BREAKING_TEXT}: b`], allowBreaking: true })).toEqual([]);
  });

  test("normal titles pass", () => {
    expect(codes(validBody(), { title: "fix(parser): handle !important" })).toEqual([]);
  });

  test("the marker is found inside the Wachiman block too", () => {
    const body = validBody().replace("<!-- wachiman:confidence:end -->", `<!-- ${BREAKING_TEXT}: x -->\n<!-- wachiman:confidence:end -->`);
    expect(codes(body)).toEqual(["breaking-change"]);
  });
});

describe("RiskRowTest", () => {
  test("stated below computed", () => {
    expect(codes(validBody(), { risk: HIGH })).toEqual(["risk-below-floor"]);
    expect(codes(validBody({ risk: "🟡 Medium, CI" }), { risk: HIGH })).toEqual(["risk-below-floor"]);
  });

  test("stated may be raised", () => {
    expect(codes(validBody({ risk: "🔴 High, I know more" }), { risk: LOW })).toEqual([]);
    expect(codes(validBody({ risk: "🟡 Medium, CI" }), { risk: MEDIUM })).toEqual([]);
  });

  test("word instead of emoji", () => {
    expect(codes(validBody({ risk: "High: touches auth" }), { risk: HIGH })).toEqual([]);
    expect(codes(validBody({ risk: "Low" }), { risk: HIGH })).toEqual(["risk-below-floor"]);
  });

  test("risk unstated", () => {
    expect(codes(validBody({ risk: "not sure yet" }))).toEqual(["risk-unstated"]);
  });

  test("risk object accepted and none skips comparison", () => {
    const risk: Risk = { level: HIGH, rule: "database migrations or schema", path: "db/migrations/1.sql" };
    expect(codes(validBody(), { risk })).toEqual(["risk-below-floor"]);
    expect(codes(validBody(), { risk: null })).toEqual([]);
  });

  test("the floor can be computed from the changed files", () => {
    const files = [{ path: "src/auth/session.ts" }];
    expect(codes(validBody(), { risk: undefined, files })).toEqual(["risk-below-floor"]);
    expect(codes(validBody({ risk: "🔴 High, auth" }), { risk: undefined, files })).toEqual([]);
  });
});

describe("FooterTest", () => {
  test("footer missing", () => {
    expect(codes(validBody().replace(/<sub>.*?<\/sub>/s, ""))).toEqual(["footer-missing"]);
  });

  test("footer placeholder sha is missing", () => {
    expect(codes(validBody().replace(HEAD.slice(0, 12), "<sha>"))).toEqual(["footer-missing"]);
    expect(codes(validBody().replace(HEAD.slice(0, 12), "{sha}"))).toEqual(["footer-missing"]);
  });

  test("footer head mismatch", () => {
    expect(codes(validBody(), { head: `0123456${"b".repeat(33)}` })).toEqual(["footer-head-mismatch"]);
  });

  test("footer short sha prefix matches", () => {
    expect(codes(validBody({ head: HEAD.slice(0, 7) }), { head: HEAD })).toEqual([]);
  });

  test("no head skips comparison", () => {
    expect(codes(validBody(), { head: null })).toEqual([]);
  });

  test("a full sha, backticks and words around the sha are accepted", () => {
    const body = validBody().replace(/<sub>.*?<\/sub>/s, `<sub>Drafted by an agent. Describes commit \`${HEAD}\`, reviewed.</sub>`);
    expect(codes(body)).toEqual([]);
  });

  test("an abbreviated head matches a longer footer sha", () => {
    expect(codes(validBody(), { head: HEAD.slice(0, 9) })).toEqual([]);
  });
});

describe("DetailsTest", () => {
  const row = "| c | b | a | w |\n";
  const only = "| Template exists | none | one file | docs/format.md |\n";

  test("changes too many rows", () => {
    expect(codes(validBody().replace(only, row.repeat(8)))).toEqual(["changes-too-many-rows"]);
  });

  test("changes seven rows is fine", () => {
    expect(codes(validBody().replace(only, row.repeat(7)))).toEqual([]);
  });

  test("details order", () => {
    expect(codes(swap(validBody(), "<details><summary><b>How to test", "<details><summary><b>Not verified", "<details><summary><b>Checks"))).toEqual(["details-order"]);
  });

  test("details unknown", () => {
    expect(codes(validBody().replace("<details><summary><b>Notes</b>", "<details><summary><b>Rollback</b>"))).toEqual(["details-unknown"]);
  });

  test("omitted details are fine", () => {
    expect(codes(validBody().replace(/<details><summary><b>Notes<\/b>.*?<\/details>\n\n/s, ""))).toEqual([]);
  });

  test("the Agent context block is allowed between Checks and Notes", () => {
    const body = validBody();
    expect(body.indexOf("<b>Checks")).toBeLessThan(body.indexOf("<b>Agent context"));
    expect(body.indexOf("<b>Agent context")).toBeLessThan(body.indexOf("<b>Notes"));
    expect(codes(body)).toEqual([]);
    expect(codes(swap(body, "<details><summary><b>Checks", "<details><summary><b>Agent context", "<details><summary><b>Notes"))).toEqual(["details-order"]);
  });

  test("a summary with no bold title is unknown", () => {
    expect(codes(validBody().replace("<details><summary><b>Notes</b>", "<details><summary>Notes"))).toEqual(["details-unknown"]);
  });

  test("a details element with attributes on its opening tag is still a collapsed block", () => {
    const open = validBody().replace("<details><summary><b>Notes</b>", "<details open><summary><b>Notes</b>");
    expect(open).toContain("<details open>");
    expect(codes(open)).toEqual([]);
    // it is read as the Notes block, not skipped: an unknown title in an open block is still reported
    expect(codes(open.replace("<b>Notes</b>", "<b>Extras</b>"))).toEqual(["details-unknown"]);
    // and a required block written that way is found
    const template = requiredDetailsTemplate();
    expect(codes(withMigrationPlan("<details open>"), { template })).toEqual([]);
  });
});

/** A repository that requires a "Migration plan" collapsed block, after Notes. */
const requiredDetailsTemplate = () =>
  resolveTemplate(catalog, loadRepoChoice(JSON.stringify({ custom: [{ id: "migration-plan", kind: "details", summary: "Migration plan", required: true, after: "notes" }] }), catalog));

/** `validBody()` with the Migration plan block before the Wachiman block; `opening` is its opening tag. */
const withMigrationPlan = (opening: string) =>
  validBody().replace("<!-- wachiman:confidence:start -->", `${opening}<summary><b>Migration plan</b></summary>\n\nNone.\n\n</details>\n\n<!-- wachiman:confidence:start -->`);

describe("a custom template", () => {
  const custom = () => customTemplate();
  const run = (body: string) => codes(body, { template: custom() });

  test("a description in the custom shape passes", () => {
    expect(run(validCustomBody())).toEqual([]);
  });

  test("a custom required section missing fails", () => {
    expect(run(validCustomBody().replace("## Migration notes\nNo data moves.\n\n", ""))).toEqual(["section-missing"]);
  });

  test("a custom optional section may be missing and may be present", () => {
    expect(run(validCustomBody())).toEqual([]);
    expect(run(validCustomBody().replace("## Screenshots", "## Reviewer's note\nSee the diff.\n\n## Screenshots"))).toEqual([]);
  });

  test("a custom required status row missing fails", () => {
    expect(run(validCustomBody().replace(/\| \*\*Ticket\*\* \|[^\n]*\n/, ""))).toEqual(["status-row-missing"]);
  });

  test("an optional section dropped by the repository passes without it", () => {
    // the default template offers the Decisions section and the Agent context block; this repository drops both
    const ids = (t: typeof defaultTemplate) => t.sections.map((e) => e.id);
    expect(ids(defaultTemplate)).toEqual(expect.arrayContaining(["decisions", "agent-context"]));
    expect(ids(custom())).not.toEqual(expect.arrayContaining(["decisions"]));
    expect(ids(custom())).not.toEqual(expect.arrayContaining(["agent-context"]));
    const body = validCustomBody();
    expect(body).not.toContain("## Decisions");
    expect(body).not.toContain("<b>Agent context");
    expect(run(body)).toEqual([]);
  });

  test("a dropped section that is written anyway is not an allowed heading", () => {
    const body = validCustomBody().replace("## Screenshots", "## Decisions\nNone.\n\n## Screenshots");
    expect(run(body)).toEqual(["heading-unknown"]);
  });

  test("a section the repository added is required when the catalog says so", () => {
    expect(run(validCustomBody().replace("## Screenshots\nNot applicable, no screen changes.\n\n", ""))).toEqual(["heading-missing"]);
  });

  test("a details block the repository added is allowed, one it dropped is not", () => {
    expect(run(validCustomBody())).toEqual([]);
    const body = validCustomBody().replace("<!-- wachiman:confidence:start -->", "<details><summary><b>Agent context</b></summary>\n\nx\n\n</details>\n\n<!-- wachiman:confidence:start -->");
    expect(run(body)).toEqual(["details-unknown"]);
  });

  test("a required collapsed block that is missing fails, and passes once it is there", () => {
    const template = requiredDetailsTemplate();
    const result = checkDescription({ body: validBody(), title: TITLE, head: HEAD, template, catalog, risk: LOW, commitMessages: [] });
    expect(result.findings.map((f) => f.code)).toEqual(["section-missing"]);
    expect(result.findings[0]!.message).toContain('"Migration plan" collapsed block');
    expect(codes(withMigrationPlan("<details>"), { template })).toEqual([]);
  });

  test("a heading is checked in the template's order", () => {
    const body = validCustomBody();
    expect(run(swap(body, "## Migration notes", "## Screenshots", "<details><summary><b>Changes"))).toEqual(["heading-order"]);
  });
});

describe("locked sections", () => {
  const locked = (labels: string[]) => ({
    ...defaultTemplate,
    sections: defaultTemplate.sections.filter((e) => !labels.includes(e.id)),
  });

  test("a description without Needs you fails whatever the template says", () => {
    const body = validBody().replace("## Needs you\nNothing. Merge when checks are green.\n\n", "");
    expect(codes(body, { template: locked(["needs-you"]) })).toEqual(["heading-missing"]);
    const custom = validCustomBody().replace("## Needs you\nNothing. Merge when checks are green.\n\n", "");
    expect(codes(custom, { template: customTemplate() })).toEqual(["heading-missing"]);
  });

  test("a description without the Risk row fails whatever the template says", () => {
    const body = validBody().replace(/\| \*\*Risk\*\* \|[^\n]*\n/, "");
    expect(codes(body, { template: locked(["risk"]) })).toEqual(["status-row-missing"]);
  });

  test("a description without the Wachiman block fails whatever the template says", () => {
    const body = validBody().replace("<!-- wachiman:confidence:start -->\n<!-- wachiman:confidence:end -->\n\n", "");
    expect(codes(body)).toEqual(["block-missing"]);
    expect(codes(body, { template: locked(["wachiman"]) })).toEqual(["block-missing"]);
  });

  test("a description without the footer fails whatever the template says", () => {
    const body = validBody().replace(/<sub>.*?<\/sub>/s, "");
    expect(codes(body, { template: locked(["footer"]) })).toEqual(["footer-missing"]);
  });

  test("a marker with no partner is not a block", () => {
    const body = validBody().replace("<!-- wachiman:confidence:end -->", "");
    expect(codes(body)).toEqual(["block-missing"]);
  });

  test("a template that relaxes a locked entry is overruled by the catalog", () => {
    const relaxed = {
      ...defaultTemplate,
      sections: defaultTemplate.sections.map((e) => (e.id === "needs-you" ? { ...e, locked: false, required: false } : e)),
    };
    const body = validBody().replace("## Needs you\nNothing. Merge when checks are green.\n\n", "");
    expect(codes(body, { template: relaxed })).toEqual(["heading-missing"]);
  });
});

describe("the Wachiman block", () => {
  test("what the review writes inside the block is not read as the author's structure", () => {
    const filled = validBody().replace("<!-- wachiman:confidence:start -->\n<!-- wachiman:confidence:end -->\n", fixture("block-with-review.md"));
    expect(filled).toContain("## Not a heading of the author");
    expect(codes(filled)).toEqual([]);
  });

  test("the same text outside the block is checked", () => {
    const body = `${validBody()}\n## Not a heading of the author\n`;
    expect(codes(body)).toEqual(["heading-unknown"]);
  });
});
