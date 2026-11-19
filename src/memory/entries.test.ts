import { describe, expect, test } from "bun:test";
import { entryId, parseIndexMap, parseMemoryFile } from "./entries";

const BODY = (id: string) => `### ${id} ADR wording edits do not need a status bump

- kind: exception
- scope: docs/adr/**
- rule: Only a change to the Decision section requires updating the status line.
  Do not report a stale date on other edits.
- why: ADRs version themselves when a decision changes.
- evidence:
  - 2026-11-18 operator instruction, pull request 709
- added: 2026-11-18
`;

const FIELDS = {
  kind: "exception" as const,
  scope: "docs/adr/**",
  rule: "Only a change to the Decision section requires updating the status line. Do not report a stale date on other edits.",
  why: "ADRs version themselves when a decision changes.",
};

describe("entryId", () => {
  test("is seven hex characters and ignores whitespace layout", () => {
    const id = entryId(FIELDS);
    expect(id).toMatch(/^[0-9a-f]{7}$/);
    expect(entryId({ ...FIELDS, rule: `  ${FIELDS.rule.replace(". ", ".\n   ")}  ` })).toBe(id);
  });

  test("changes with kind, scope, rule, why and holds while, and not with anything else", () => {
    const id = entryId(FIELDS);
    expect(entryId({ ...FIELDS, kind: "convention" })).not.toBe(id);
    expect(entryId({ ...FIELDS, scope: "docs/**" })).not.toBe(id);
    expect(entryId({ ...FIELDS, rule: "other" })).not.toBe(id);
    expect(entryId({ ...FIELDS, why: "other" })).not.toBe(id);
    expect(entryId({ ...FIELDS, holdsWhile: "src/gateway.ts" })).not.toBe(id);
  });
});

describe("parseMemoryFile", () => {
  test("reads every field of an entry, with the file and the line of its heading", () => {
    const id = entryId(FIELDS);
    const { entries, problems } = parseMemoryFile("docs-adr.md", `# Docs\n\n${BODY(id)}`);
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      {
        id,
        title: "ADR wording edits do not need a status bump",
        kind: "exception",
        scope: "docs/adr/**",
        rule: FIELDS.rule,
        why: FIELDS.why,
        evidence: ["2026-11-18 operator instruction, pull request 709"],
        added: "2026-11-18",
        file: "docs-adr.md",
        line: 3,
      },
    ]);
  });

  test("holds while is read when present", () => {
    const text = BODY("0000000").replace("- added:", "- holds while: src/gateway.ts\n- added:");
    const { entries } = parseMemoryFile("a.md", text);
    expect(entries[0].holdsWhile).toBe("src/gateway.ts");
  });

  test("a heading id that does not match the digest is a problem at the heading's line", () => {
    const { problems } = parseMemoryFile("a.md", `\n${BODY("abcdef0")}`);
    const real = entryId(FIELDS);
    expect(problems).toEqual([{ file: "a.md", line: 2, message: `entry id abcdef0 does not match its digest ${real}` }]);
  });

  test.each([
    ["kind", "- kind: exception\n", "- kind: rule\n", 'kind must be "convention" or "exception", got "rule"'],
    ["scope", "- scope: docs/adr/**\n", "", "missing scope"],
    ["rule", /- rule:[\s\S]*?- why/, "- why", "missing rule"],
    ["why", "- why: ADRs version themselves when a decision changes.\n", "", "missing why"],
    ["added", "- added: 2026-11-18\n", "- added: yesterday\n", 'added must be a date like 2026-11-18, got "yesterday"'],
    ["evidence", /- evidence:\n {2}- .*\n/, "", "missing evidence"],
  ])("a malformed %s is reported with its file and line", (_name, from, to, message) => {
    const id = entryId(FIELDS);
    const text = BODY(id).replace(from as string, to as string);
    const { problems } = parseMemoryFile("a.md", text);
    expect(problems.some((p) => p.message === message && p.file === "a.md" && p.line >= 1)).toBe(true);
  });

  test("an unknown field and a stray line inside an entry are problems with their own lines", () => {
    const id = entryId(FIELDS);
    const text = BODY(id).replace("- added:", "- colour: red\nstray text\n- added:");
    const { problems } = parseMemoryFile("a.md", text);
    expect(problems.map((p) => [p.line, p.message])).toEqual([
      [10, 'unknown field "colour"'],
      [11, "unexpected line inside an entry"],
    ]);
  });

  test.each([
    ["a paragraph", "Some free prose about this entry.\nIt runs two lines.\n"],
    ["a Markdown table", "| Glob | File |\n| --- | --- |\n| `apps/**` | `apps.md` |\n"],
  ])("%s after an entry, with no heading between, is not a defect", (_name, extra) => {
    const id = entryId(FIELDS);
    const { entries, problems } = parseMemoryFile("index.md", `${BODY(id)}\n${extra}`);
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ...FIELDS, added: "2026-11-18", evidence: ["2026-11-18 operator instruction, pull request 709"] });
  });

  test("a malformed field line after the free text is still reported", () => {
    const id = entryId(FIELDS);
    const { problems } = parseMemoryFile("a.md", `${BODY(id)}\nSome prose.\n\n- colour: red\n`);
    expect(problems.map((p) => p.message)).toEqual(['unknown field "colour"']);
  });

  test("a heading that is not `### <id> <title>` is a problem", () => {
    const { problems, entries } = parseMemoryFile("a.md", "### no id here\n\n- kind: convention\n");
    expect(entries).toEqual([]);
    expect(problems[0]).toEqual({ file: "a.md", line: 1, message: "entry heading must be `### <id> <title>` with a 7-character hex id" });
  });

  test("an example entry inside a fenced code block is neither an entry nor a problem", () => {
    const example = BODY("4c1e9a2").trimEnd();
    for (const fence of ["```", "~~~", "````"]) {
      const { entries, problems } = parseMemoryFile("index.md", `# Memory\n\nHow to write one:\n\n${fence}markdown\n${example}\n### not an entry\n${fence}\n`);
      expect(entries).toEqual([]);
      expect(problems).toEqual([]);
    }
  });

  test("a real entry after a fenced example is still read, and a ### heading after the fence is still a problem", () => {
    const real = BODY(entryId({ ...FIELDS }));
    const { entries, problems } = parseMemoryFile("index.md", `\`\`\`\n### no id\n\`\`\`\n\n${real}\n### no id here\n`);
    expect(entries).toHaveLength(1);
    expect(problems).toEqual([{ file: "index.md", line: 5 + real.split("\n").length, message: "entry heading must be `### <id> <title>` with a 7-character hex id" }]);
  });

  test("text outside entries (headings, prose, tables) is allowed", () => {
    const { entries, problems } = parseMemoryFile("index.md", "# Memory\n\nSome prose.\n\n| Glob | File |\n| --- | --- |\n");
    expect(entries).toEqual([]);
    expect(problems).toEqual([]);
  });
});

describe("parseIndexMap", () => {
  test("reads glob and file rows of a table, with their lines, and skips the header", () => {
    const text = "# Index\n\n| Glob | File |\n| --- | --- |\n| `apps/desktop/**` | `apps-desktop.md` |\n| packages/ui/** | packages-ui.md |\n";
    expect(parseIndexMap(text)).toEqual([
      { glob: "apps/desktop/**", file: "apps-desktop.md", line: 5 },
      { glob: "packages/ui/**", file: "packages-ui.md", line: 6 },
    ]);
  });
});
