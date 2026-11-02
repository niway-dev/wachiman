import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACT_SCHEMA,
  checkContracts,
  citationProblem,
  countLines,
  mergeContracts,
  parseContracts,
  repoLineCounter,
  type Contract,
  type LineCounter,
} from "./contracts";

const entry = (over: Record<string, unknown> = {}) => ({
  action: "Back from the card's page",
  location: "src/card.ts:12",
  equivalent_path: "",
  before_after: "",
  visible_effect: "the card re-floats",
  failure_mode: "",
  status: "closed",
  evidence: ["src/card.ts:12"],
  open_question: "",
  candidates: [],
  ...over,
});

const contract = (over: Partial<Contract> = {}): Contract => ({
  action: "drag a ready copy",
  location: "src/panel.ts:174",
  status: "closed",
  evidence: ["src/panel.ts:174"],
  ...over,
});

/** A head with two files: `src/a.ts` has 10 lines, `src/empty.ts` has none. */
const head: LineCounter = (path) => ({ "src/a.ts": 10, "src/card.ts": 40, "src/panel.ts": 200, "src/empty.ts": 0 })[path] ?? null;

describe("CONTRACT_SCHEMA", () => {
  test("requires every field, so a strict-schema provider accepts it, and allows two statuses", () => {
    expect([...CONTRACT_SCHEMA.required].sort()).toEqual(Object.keys(CONTRACT_SCHEMA.properties).sort());
    expect(CONTRACT_SCHEMA.properties.status.enum).toEqual(["closed", "open"]);
    expect(CONTRACT_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("parseContracts", () => {
  test("turns empty strings and lists into absent fields", () => {
    const [c] = parseContracts([entry()], () => {});
    expect(c).toEqual({
      action: "Back from the card's page",
      location: "src/card.ts:12",
      visible_effect: "the card re-floats",
      status: "closed",
      evidence: ["src/card.ts:12"],
    });
  });

  test("keeps an open question and its candidates", () => {
    const [c] = parseContracts(
      [entry({ status: "open", evidence: [], open_question: "Who calls it?", candidates: ["src/x.ts", ""] })],
      () => {},
    );
    expect(c).toMatchObject({ status: "open", open_question: "Who calls it?", candidates: ["src/x.ts"] });
  });

  test("a missing contracts is an empty list and says nothing", () => {
    const warnings: string[] = [];
    expect(parseContracts(undefined, (w) => warnings.push(w))).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("drops a malformed entry with a warning and keeps the good ones", () => {
    const warnings: string[] = [];
    const bad = [
      "text",
      entry({ action: "" }),
      entry({ location: 3 }),
      entry({ status: "maybe" }),
      entry({ evidence: "src/a.ts:1" }),
      entry({ evidence: [1] }),
      entry({ failure_mode: 5 }),
      entry({ candidates: "x" }),
    ];
    const kept = parseContracts([...bad, entry({ action: "good" })], (w) => warnings.push(w));
    expect(kept.map((c) => c.action)).toEqual(["good"]);
    expect(warnings).toHaveLength(bad.length);
    expect(warnings[3]).toContain("status");
  });

  test("a contracts value that is not a list is ignored with a warning", () => {
    const warnings: string[] = [];
    expect(parseContracts({ action: "x" }, (w) => warnings.push(w))).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe("citationProblem", () => {
  test("accepts a line inside an existing file, a range, and the last line", () => {
    expect(citationProblem("src/a.ts:1", head)).toBeNull();
    expect(citationProblem("src/a.ts:10", head)).toBeNull();
    expect(citationProblem("src/a.ts:3-10", head)).toBeNull();
  });

  test("names a file that is missing", () => {
    expect(citationProblem("src/gone.ts:3", head)).toBe("src/gone.ts does not exist in the head");
  });

  test("names a line past the end, with the file's length", () => {
    expect(citationProblem("src/a.ts:11", head)).toBe("src/a.ts:11 is past the end of src/a.ts (10 lines)");
    expect(citationProblem("src/a.ts:8-12", head)).toContain("past the end");
    expect(citationProblem("src/empty.ts:1", head)).toContain("0 lines");
  });

  test("rejects line zero, a backwards range and a citation with no line", () => {
    expect(citationProblem("src/a.ts:0", head)).toContain("not a valid line range");
    expect(citationProblem("src/a.ts:5-2", head)).toContain("not a valid line range");
    expect(citationProblem("src/a.ts", head)).toContain("not path:line");
    expect(citationProblem("the toast's drag", head)).toContain("not path:line");
  });
});

describe("checkContracts", () => {
  test("marks an entry whose citations all resolve as checked, with no warning", () => {
    const warnings: string[] = [];
    const [c] = checkContracts([contract()], head, (w) => warnings.push(w));
    expect(c.evidence_checked).toBe(true);
    expect(warnings).toEqual([]);
  });

  test("marks an entry with a missing file or an out-of-range line unchecked, warns once, and changes nothing else", () => {
    const warnings: string[] = [];
    const input = contract({ evidence: ["src/panel.ts:174", "src/gone.ts:3", "src/a.ts:99"] });
    const [c] = checkContracts([input], head, (w) => warnings.push(w));
    expect(c.evidence_checked).toBe(false);
    expect(c.status).toBe("closed");
    expect(c.evidence).toEqual(input.evidence);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("src/gone.ts does not exist");
    expect(warnings[0]).toContain("past the end of src/a.ts");
  });

  test("a closed entry with no citation is unchecked; an open one with none is fine", () => {
    const warnings: string[] = [];
    const [closed, open] = checkContracts(
      [contract({ evidence: [] }), contract({ status: "open", evidence: [], open_question: "?" })],
      head,
      (w) => warnings.push(w),
    );
    expect(closed.evidence_checked).toBe(false);
    expect(open.evidence_checked).toBe(true);
    expect(warnings).toHaveLength(1);
  });
});

describe("mergeContracts", () => {
  test("keeps one entry per action and location, ignoring case and spacing", () => {
    const merged = mergeContracts([contract(), contract({ action: "Drag a  READY copy" }), contract({ location: "src/other.ts:1" })]);
    expect(merged).toHaveLength(2);
  });

  test("prefers a closed, checked answer over an unchecked one, and any closed over open", () => {
    const open = contract({ status: "open", evidence: [] });
    const unchecked = contract({ evidence_checked: false });
    const checked = contract({ evidence_checked: true, visible_effect: "checked" });
    expect(mergeContracts([open, unchecked, checked])).toEqual([checked]);
    expect(mergeContracts([open, unchecked])).toEqual([unchecked]);
    expect(mergeContracts([checked, open])).toEqual([checked]);
  });

  test("on a tie, the first stays", () => {
    const first = contract({ visible_effect: "first", evidence_checked: true });
    const second = contract({ visible_effect: "second", evidence_checked: true });
    expect(mergeContracts([first, second])).toEqual([first]);
  });
});

describe("countLines", () => {
  test("counts a trailing newline once and an empty file as zero", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("\n")).toBe(1);
  });
});

describe("repoLineCounter", () => {
  const dir = mkdtempSync(join(tmpdir(), "contracts-head-"));
  const outside = mkdtempSync(join(tmpdir(), "contracts-outside-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "one\ntwo\nthree\n");
  writeFileSync(join(outside, "secret.txt"), "a\nb\nc\nd\n");
  symlinkSync(join(outside, "secret.txt"), join(dir, "src", "link.txt"));
  const lines = repoLineCounter(dir);

  test("counts the lines of a file in the head", () => {
    expect(lines("src/a.ts")).toBe(3);
  });

  test("a missing file, a directory and an empty path do not exist", () => {
    expect(lines("src/nope.ts")).toBeNull();
    expect(lines("src")).toBeNull();
    expect(lines("")).toBeNull();
  });

  test("never reads outside the head: parent paths, absolute paths and symlinks that point out", () => {
    const rel = `../${outside.split("/").pop()}/secret.txt`;
    expect(lines(rel)).toBeNull();
    expect(lines(join(outside, "secret.txt"))).toBeNull();
    expect(lines("src/link.txt")).toBeNull();
  });

  test("a head that does not exist has no files", () => {
    expect(repoLineCounter(join(dir, "missing"))("src/a.ts")).toBeNull();
  });
});
