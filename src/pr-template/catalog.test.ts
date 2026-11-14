import { describe, expect, test } from "bun:test";
import { PrTemplateConfigError, loadCatalog, loadRepoChoice, parseCatalog } from "./catalog";
import { UsageError } from "../config";

const catalog = loadCatalog();
const choice = (value: unknown) => loadRepoChoice(JSON.stringify(value), catalog);
const rejects = (value: unknown, pattern: RegExp) => {
  let caught: unknown;
  try {
    choice(value);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PrTemplateConfigError);
  expect(caught).toBeInstanceOf(UsageError);
  expect((caught as Error).message).toMatch(pattern);
};

describe("the shipped catalog", () => {
  test("the intro agrees with custom sections: headings come from the template, not from a ban on new ones", () => {
    expect(catalog.intro).not.toMatch(/never add a new heading/i);
    expect(catalog.intro).toContain(".github/pr-template.json");
    expect(catalog.intro).toContain("goes in Notes");
  });

  test("is version 1 and lists the sections of the default template in order", () => {
    expect(catalog.version).toBe(1);
    const defaults = catalog.sections.filter((e) => e.default).map((e) => e.id);
    expect(defaults).toEqual([
      "type", "issue", "risk", "rollout", "release", "evidence-status", "decisions-status",
      "needs-you", "what", "why", "evidence", "decisions",
      "changes", "how-to-test", "not-verified", "checks", "agent-context", "notes",
      "wachiman", "footer",
    ]);
  });

  test("locks the risk row, needs you, the Wachiman block and the footer, and only those", () => {
    expect(catalog.sections.filter((e) => e.locked).map((e) => e.id)).toEqual(["risk", "needs-you", "wachiman", "footer"]);
  });

  test("requires the headings the earlier checker requires and keeps its rules", () => {
    const get = (id: string) => catalog.sections.find((e) => e.id === id)!;
    for (const id of ["needs-you", "what", "why", "evidence"]) expect(get(id).required).toBe(true);
    expect(get("decisions").required).toBe(false);
    for (const id of ["changes", "how-to-test", "not-verified", "checks", "notes"]) expect(get(id).required).toBe(false);
    expect(get("changes").rule).toBe("max-rows:7");
    expect(get("risk").rule).toBe("risk-floor");
    expect(get("needs-you").rule).toBe("not-empty");
    expect(get("footer").rule).toBe("commit-is-head");
  });

  test("offers screenshots and a rollback block without putting them in the default", () => {
    const screenshots = catalog.sections.find((e) => e.id === "screenshots")!;
    expect(screenshots).toMatchObject({ kind: "section", heading: "Screenshots", required: true, default: false });
    expect(catalog.sections.find((e) => e.id === "rollback")).toMatchObject({ kind: "details", default: false });
  });

  test("tells the author to start from `wachiman pr-template risk`", () => {
    expect(catalog.sections.find((e) => e.id === "risk")!.guide).toContain("`wachiman pr-template risk`");
  });
});

describe("catalog validation", () => {
  const minimal = (sections: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, sections, ...extra });
  const row = { id: "risk", kind: "status-row", label: "Risk", locked: true, rule: "risk-floor" };
  const block = { id: "wachiman", kind: "block", locked: true, start: "<!-- a -->", end: "<!-- b -->" };
  const footer = { id: "footer", kind: "footer", locked: true, text: "Describes commit {sha}." };
  const ok = [row, block, footer];

  test("accepts a minimal catalog", () => {
    expect(parseCatalog(minimal(ok)).sections).toHaveLength(3);
  });

  test("names the problem for each broken catalog", () => {
    const cases: [string, string, RegExp][] = [
      ["not JSON", "{", /not valid JSON/],
      ["unknown top key", minimal(ok, { extra: 1 }), /unknown key "extra"/],
      ["bad version", JSON.stringify({ version: 0, sections: ok }), /positive integer/],
      ["duplicate id", minimal([row, { ...row, label: "Other" }, block, footer]), /used twice/],
      ["unknown rule", minimal([{ ...row, rule: "magic" }, block, footer]), /unknown rule "magic"/],
      ["footer with <sha>", minimal([row, block, { ...footer, text: "Describes commit <sha>." }]), /placeholder|{sha}/],
      ["footer not last", minimal([row, footer, block]), /footer must be the last/],
      ["no risk row", minimal([{ id: "type", kind: "status-row", label: "Type" }, block, footer]), /risk-floor/],
      ["risk row not locked", minimal([{ ...row, locked: false }, block, footer]), /must have a locked status row with the risk-floor rule/],
      ["locked but not default", minimal([{ ...row, default: false }, block, footer]), /locked/],
      ["guide closes the comment", minimal([{ ...row, guide: "x --> y" }, block, footer]), /must not contain/],
      ["pipe in a row guide", minimal([{ ...row, guide: "a | b" }, block, footer]), /one line/],
      ["rows after sections", minimal([row, { id: "what", kind: "section", heading: "What" }, { id: "t", kind: "status-row", label: "T" }, block, footer]), /status rows must come first/],
    ];
    for (const [, text, pattern] of cases) {
      expect(() => parseCatalog(text)).toThrow(pattern);
    }
  });

  test("every catalog error is a PrTemplateConfigError", () => {
    expect(() => parseCatalog("[]")).toThrow(PrTemplateConfigError);
  });
});

describe("repository choice", () => {
  test("accepts an empty object and defaults every field", () => {
    expect(choice({})).toEqual({ base: "default", add: [], drop: [], custom: [], preamble: [] });
  });

  test("parses add, drop, custom and preamble", () => {
    const parsed = choice({
      base: "default",
      add: ["screenshots"],
      drop: ["decisions"],
      custom: [{ id: "migration-notes", kind: "section", heading: "Migration notes", required: false, after: "evidence" }],
      preamble: ["- [ ] I accept CLA.md."],
    });
    expect(parsed.add).toEqual(["screenshots"]);
    expect(parsed.drop).toEqual(["decisions"]);
    expect(parsed.custom[0]).toEqual({ id: "migration-notes", kind: "section", name: "Migration notes", required: false, after: "evidence" });
    expect(parsed.preamble).toEqual(["- [ ] I accept CLA.md."]);
  });

  test("JSON that does not parse", () => {
    expect(() => loadRepoChoice("{", catalog)).toThrow(/pr-template.json is not valid JSON/);
    expect(() => loadRepoChoice("", catalog)).toThrow(PrTemplateConfigError);
  });

  test("unknown ids in add and drop", () => {
    rejects({ add: ["nope"] }, /"add" names the unknown section "nope"/);
    rejects({ drop: ["nope"] }, /"drop" names the unknown section "nope"/);
  });

  test("dropping a locked section", () => {
    for (const id of ["risk", "needs-you", "wachiman", "footer"]) rejects({ drop: [id] }, new RegExp(`"${id}" is locked`));
  });

  test("dropping a required section", () => {
    rejects({ drop: ["what"] }, /"what" is required/);
  });

  test("a custom entry reusing a locked heading or label, whatever the case", () => {
    rejects({ custom: [{ id: "mine", kind: "section", heading: "needs YOU" }] }, /reuses the locked name "Needs you"/);
    rejects({ custom: [{ id: "mine", kind: "status-row", label: "risk" }] }, /reuses the locked name "Risk"/);
    rejects({ custom: [{ id: "mine", kind: "details", summary: "RISK" }] }, /reuses the locked name/);
  });

  test("a custom entry reusing the id of an existing section or of another custom entry", () => {
    rejects({ custom: [{ id: "what", kind: "section", heading: "Other" }] }, /id is already used/);
    rejects({
      custom: [
        { id: "mine", kind: "section", heading: "One" },
        { id: "mine", kind: "section", heading: "Two" },
      ],
    }, /id is already used/);
  });

  test("a custom entry repeating the name of a section the template shows", () => {
    rejects({ custom: [{ id: "mine", kind: "section", heading: "what" }] }, /already the name of the section "what"/);
  });

  test("a custom name that could change the template's structure is rejected, naming the entry", () => {
    const entry = (kind: "section" | "status-row" | "details", name: string) => ({
      custom: [{ id: "mine", kind, [kind === "section" ? "heading" : kind === "status-row" ? "label" : "summary"]: name }],
    });
    // the checker reads a heading trimmed and with spaces collapsed, so the template it generated would not pass
    rejects({ custom: [{ id: "mine", kind: "section", heading: " Team " }] }, /custom entry "mine": the heading must not start or end with whitespace/);
    rejects({ custom: [{ id: "mine", kind: "section", heading: "Two  spaces" }] }, /run of spaces/);
    rejects({ custom: [{ id: "mine", kind: "status-row", label: "Owner " }] }, /the label must not start or end with whitespace/);
    // a second heading smuggled in through a newline, a carriage return or another control character
    rejects(entry("section", "Notes\n## Injected"), /custom entry "mine": the heading must be one line/);
    rejects(entry("section", "Notes\r## Injected"), /custom entry "mine": the heading must be one line/);
    rejects(entry("details", "Tab\there"), /custom entry "mine": the summary must be one line/);
    rejects(entry("status-row", "Bell\u0007"), /custom entry "mine": the label must be one line/);
    rejects(entry("section", "Line\u2028break"), /the heading must be one line/);
    // empty and too long
    rejects(entry("section", "   "), /must not be empty/);
    rejects(entry("section", "x".repeat(81)), /custom entry "mine": the heading is 81 characters; the limit is 80/);
    expect(choice(entry("section", "x".repeat(80))).custom[0]!.name).toHaveLength(80);
    // a status row is a table row
    rejects(entry("status-row", "Owner | Team"), /custom entry "mine": the label must not contain "\|"/);
    expect(choice(entry("section", "Owner | Team")).custom[0]!.name).toBe("Owner | Team");
    // HTML that would open a tag or close the guide comment
    rejects(entry("section", "<b>Mine</b>"), /custom entry "mine": the heading must not contain "<" or ">"/);
    rejects(entry("details", "a > b"), /the summary must not contain "<" or ">"/);
    rejects(entry("section", "Mine --> done"), /the heading must not contain "-->"/);
  });

  test("a custom after naming an unknown id", () => {
    rejects({ custom: [{ id: "mine", kind: "section", heading: "Mine", after: "nowhere" }] }, /unknown id "nowhere"/);
  });

  test("a custom entry after the marked block, the footer, or the wrong kind of entry", () => {
    rejects({ custom: [{ id: "mine", kind: "section", heading: "Mine", after: "footer" }] }, /nothing can be placed after "footer"/);
    rejects({ custom: [{ id: "mine", kind: "section", heading: "Mine", after: "type" }] }, /cannot be placed after "type"/);
    rejects({ custom: [{ id: "mine", kind: "status-row", label: "Mine", after: "what" }] }, /cannot be placed after "what"/);
  });

  test("unknown keys and wrong types", () => {
    rejects({ surprise: true }, /unknown key "surprise"/);
    rejects({ add: "screenshots" }, /"add" must be a list of strings/);
    rejects({ drop: [1] }, /"drop" must be a list of strings/);
    rejects({ preamble: "line" }, /"preamble" must be a list of strings/);
    rejects({ custom: {} }, /"custom" must be a list/);
    rejects({ custom: [{ id: "mine", kind: "section", heading: "Mine", colour: "red" }] }, /unknown key "colour"/);
    rejects({ custom: [{ id: "mine", kind: "section", heading: "Mine", required: "yes" }] }, /"required" must be true or false/);
    rejects({ custom: [{ id: "mine", kind: "block", heading: "Mine" }] }, /"kind" must be status-row, section or details/);
    rejects([], /must be a JSON object/);
  });

  test("an unsupported base", () => {
    rejects({ base: "strict" }, /unsupported base "strict"/);
    rejects({ base: 2 }, /unsupported base 2/);
  });

  test("a preamble line must not carry a Wachiman marker", () => {
    rejects({ preamble: ["<!-- wachiman:confidence:start -->"] }, /Wachiman marker/);
  });

  test("the preamble must not leave a code fence open, and any Wachiman marker comment is refused", () => {
    rejects({ preamble: ["```"] }, /preamble opens a fenced code block/);
    rejects({ preamble: ["  ~~~ts", "code"] }, /fenced code block/);
    rejects({ preamble: ["````", "```"] }, /fenced code block/);
    rejects({ preamble: ["<!-- wachiman:other -->"] }, /Wachiman marker/);
    expect(choice({ preamble: ["```", "x", "```", "~~~\ny\n~~~"] }).preamble).toHaveLength(4);
  });

  test("a preamble entry must not open a comment it does not close, or close one it did not open", () => {
    rejects({ preamble: ["fine", "<!-- never closed"] }, /preamble\[1\] opens a comment/);
    rejects({ preamble: ["text --> more"] }, /preamble\[0\] contains a stray "-->"/);
    rejects({ preamble: ["--> <!-- a -->"] }, /stray "-->"/);
    rejects({ preamble: ["<!-- a --> then <!-- b"] }, /opens a comment/);
    expect(choice({ preamble: ["<!-- a --> b <!-- c -->", "<!--\nmulti\n-->"] }).preamble).toHaveLength(2);
  });
});
