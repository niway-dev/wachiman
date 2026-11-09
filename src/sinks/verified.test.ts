import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewResult } from "../engine";
import { agentPrompt } from "./agent-prompt";
import { renderMarkdown } from "./markdown";
import { renderTerminal } from "./terminal";

// ADR 0030: what a local report shows of verification. The fixture is the /2 example: one supported
// introduced fix, one supported pre-existing fix, an inconclusive nit that was never reached, and an info notice.

const fixture = (): ReviewResult =>
  JSON.parse(readFileSync(join(import.meta.dir, "../../test/fixtures/formats/review-result.v2.example.json"), "utf8"));

/** The fixture plus a fix the verifier looked at and could not settle. */
const withInconclusiveFix = (): ReviewResult => {
  const r = fixture();
  const [first] = r.findings;
  r.findings.push({
    ...first,
    line: 5,
    title: "The flush may race",
    anchor: "diff",
    verification: { status: "inconclusive", reason: "The lock on line 9 may serialise it.", checked: [], claimed: "inconclusive" },
    origin: "unknown",
  });
  return r;
};

describe("terminal", () => {
  test("every label leads with its tier word and ends with what the verifier found", () => {
    const text = renderTerminal(fixture(), { agentPrompt: false });
    expect(text).toContain("Important · 🟠🐛 Fix · bug: The store drops the last session (confidence high, supported)");
    expect(text).toContain("Pre-existing · 🟠🐛 Fix · bug: The manager never closes the store (confidence high, supported)");
    expect(text).toContain("Nit · 🟡🧪 Consider · tests: No test covers the export (confidence low, inconclusive)");
    // An info notice nobody verified shows no status.
    expect(text).toContain("Nit · ⚪🏛️ Info · adr: Edits an accepted decision record\n");
  });

  test("a supported finding shows why and the lines the verifier read; an inconclusive one shows what it could not settle", () => {
    const text = renderTerminal(withInconclusiveFix(), { agentPrompt: false });
    expect(text).toContain("    Verified: Line 2 assigns y over x before the flush on line 3.\n    Checked: apps/api/src/main/session/store.ts:2, apps/api/src/main/session/store.ts:3");
    expect(text).toContain("    Inconclusive: The lock on line 9 may serialise it.");
    // A base citation says so.
    expect(text).toContain("Pre-existing: The same missing call is in the base version of this function.");
    expect(text).toContain("base:apps/api/src/main/session/session-manager.ts:3");
  });

  test("pre-existing and inconclusive fixes are grouped after the findings of this change", () => {
    const text = renderTerminal(withInconclusiveFix(), { agentPrompt: false });
    const at = (needle: string) => text.indexOf(needle);
    expect(at("Important · 🟠🐛 Fix · bug: The store drops")).toBeLessThan(at("Inconclusive (the verifier could not settle these):"));
    expect(at("Inconclusive (the verifier could not settle these):")).toBeLessThan(at("The flush may race"));
    expect(at("The flush may race")).toBeLessThan(at("Pre-existing (true, but not introduced by this change):"));
    expect(at("Pre-existing (true, but not introduced by this change):")).toBeLessThan(at("The manager never closes"));
    // The nit that was never reached stays with the main findings.
    expect(at("No test covers the export")).toBeLessThan(at("Inconclusive (the verifier could not settle these):"));
  });

  test("the footer says how the verification went", () => {
    expect(renderTerminal(fixture(), { agentPrompt: false })).toContain("partly verified by Claude Code · claude-opus-5-5 (stopped: budget)");
  });

  test("a result without verification shows no status and no section", () => {
    const r = fixture();
    delete r.verification;
    r.findings = r.findings.map((f) => ({ ...f, origin: "unknown", tier: "Important", verification: { status: "unverified", reason: "", checked: [] } }));
    const text = renderTerminal(r, { agentPrompt: false });
    expect(text).toContain("Important · 🟠🐛 Fix · bug: The store drops the last session (confidence high)\n");
    expect(text).not.toContain("Pre-existing (true");
    expect(text).not.toContain("Verified:");
  });
});

describe("markdown", () => {
  test("labels, verification lines and sections", () => {
    const md = renderMarkdown(withInconclusiveFix(), {});
    expect(md).toContain("### Important · 🟠🐛 **Fix · bug: The store drops the last session (confidence high, supported)**");
    expect(md).toContain("### Nit · 🟡🧪 **Consider · tests: No test covers the export (confidence low, inconclusive)**");
    expect(md).toContain("Verified: Line 2 assigns y over x before the flush on line 3.\n\nChecked: `apps/api/src/main/session/store.ts:2`, `apps/api/src/main/session/store.ts:3`");
    expect(md).toContain("## Inconclusive\n\nThe verifier looked at these and could not settle them.\n\n### Important · ");
    expect(md).toContain("Inconclusive: The lock on line 9 may serialise it.");
    expect(md).toContain("## Pre-existing\n\nTrue, but not introduced by this change.\n\n### Pre-existing · 🟠🐛 **Fix · bug: The manager never closes the store (confidence high, supported)**");
    expect(md.indexOf("## Findings")).toBeLessThan(md.indexOf("## Inconclusive"));
    expect(md.indexOf("## Inconclusive")).toBeLessThan(md.indexOf("## Pre-existing"));
    expect(md.indexOf("## Pre-existing")).toBeLessThan(md.indexOf("## Summary"));
    expect(md).not.toContain("Verified: Searched");
  });

  test("the history label stays with its finding when the findings are grouped", () => {
    const history = { byIndex: new Map([[1, { status: "new" as const, firstHead: "a".repeat(40), runs: 1, id: "f0f0f0f0f0" }]]), settled: [], unknown: 0 };
    const md = renderMarkdown(fixture(), { history });
    const pre = md.slice(md.indexOf("## Pre-existing"));
    expect(pre).toContain("History: new, id `f0f0f0f0f0`");
    expect(md.slice(0, md.indexOf("## Pre-existing"))).not.toContain("f0f0f0f0f0");
  });
});

describe("the agent prompt", () => {
  test("carries the tier word and the status", () => {
    expect(agentPrompt(fixture())).toContain("1. apps/api/src/main/session/store.ts:2 · Important · 🟠🐛 Fix · bug: The store drops the last session (confidence high, supported)");
  });
});
