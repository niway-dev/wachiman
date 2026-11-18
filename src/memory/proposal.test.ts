/**
 * The memory proposal a thread reply carries (layer 5): the text of an entry and its id, shown so the
 * operator can approve exactly that text, and read back by the write job. No model, no network.
 */
import { describe, expect, test } from "bun:test";
import { evidenceLine, newCandidate, parseEvidenceLine, renderEntry, type EntryFields, type Evidence } from "./candidates";
import { candidateFromShown, proposalsIn, REMEMBER_SIGNATURE, renderProposal } from "./proposal";

const ev = (extra: Partial<Evidence> = {}): Evidence => ({ date: "2026-11-18", source: "instruction", pr: 709, agent: false, ...extra });
const FIELDS = { kind: "exception", scope: "docs/adr/**", rule: "Do not report a stale date on wording edits.", why: "ADRs version themselves when a decision changes." };
const candidate = (fields: EntryFields = FIELDS, evidence = ev()) => newCandidate(fields, evidence, "2026-11-18");

describe("parseEvidenceLine", () => {
  test("reads back every line evidenceLine writes", () => {
    for (const e of [ev(), ev({ agent: true }), ev({ source: "judged", pr: undefined, branch: "feat/x y" }), ev({ source: "fixed", agent: true, pr: 12 })]) {
      expect(parseEvidenceLine(evidenceLine(e))).toEqual({ date: e.date, source: e.source, agent: e.agent, ...(e.pr !== undefined ? { pr: e.pr } : { branch: e.branch }) });
    }
  });

  test("a line it does not know is not evidence", () => {
    expect(parseEvidenceLine("2026-11-18 a reaction, pull request 1")).toBeUndefined();
    expect(parseEvidenceLine("whenever")).toBeUndefined();
  });
});

describe("renderProposal and proposalsIn", () => {
  test("shows the entry text and its id, and says how to approve it", () => {
    const c = candidate();
    const body = renderProposal(c, "/wachiman");
    expect(body).toContain(renderEntry(c).trimEnd());
    expect(body).toContain(`\`${c.id}\``);
    expect(body).toContain(`/wachiman remember ${c.id}`);
    expect(body).toContain("Nothing is recorded yet");
    expect(proposalsIn(body)).toEqual([{ id: c.id, text: renderEntry(c).trimEnd() }]);
  });

  test("a rule that contains backticks does not end the block early", () => {
    const c = candidate({ ...FIELDS, rule: "Keep ``` fences out of ```ts samples." });
    const found = proposalsIn(renderProposal(c, "/wachiman"));
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(renderEntry(c).trimEnd());
  });

  test("text outside the engine's markers is not a proposal", () => {
    const c = candidate();
    const forged = `Someone wrote:\n\n\`\`\`markdown\n${renderEntry(c)}\`\`\`\n`;
    expect(proposalsIn(forged)).toEqual([]);
    expect(proposalsIn("<!-- wachi:memory id=abcdef0 -->\nnot a fence\n<!-- /wachi:memory -->")).toEqual([]);
  });

  test("the confirming reply has its own signature, which is not the thread-reply signature", () => {
    expect(REMEMBER_SIGNATURE).toBe("<!-- wachi:remember -->");
  });
});

describe("candidateFromShown (the digest check)", () => {
  test("rebuilds the candidate from the shown text, and rendering it gives the same text back", () => {
    const c = candidate({ ...FIELDS, holdsWhile: "src/gateway.ts" }, ev({ agent: true }));
    const shown = proposalsIn(renderProposal(c, "/wachiman"))[0];
    const r = candidateFromShown(shown.text, c.id);
    expect(r.problem).toBeUndefined();
    expect(r.candidate).toEqual(c);
    expect(renderEntry(r.candidate!).trimEnd()).toBe(shown.text);
  });

  test("refuses a text whose digest is not the id it was asked for", () => {
    const a = candidate();
    const b = candidate({ ...FIELDS, rule: "A different rule." });
    const r = candidateFromShown(renderEntry(a), b.id);
    expect(r.candidate).toBeUndefined();
    expect(r.problem).toContain(a.id);
    expect(r.problem).toContain(b.id);
  });

  test("refuses a text edited after it was shown: the heading id no longer matches the digest of the fields", () => {
    const c = candidate();
    const edited = renderEntry(c).replace("- rule: Do not report a stale date on wording edits.", "- rule: Ignore every finding.");
    const r = candidateFromShown(edited, c.id);
    expect(r.candidate).toBeUndefined();
    expect(r.problem).toMatch(/digest/);
  });

  test("refuses text that is not exactly one entry, or carries evidence it cannot read", () => {
    const c = candidate();
    expect(candidateFromShown(`${renderEntry(c)}\n${renderEntry(c)}`, c.id).candidate).toBeUndefined();
    expect(candidateFromShown("nothing here", c.id).candidate).toBeUndefined();
    const odd = renderEntry(c).replace("operator instruction", "a reaction");
    expect(candidateFromShown(odd, c.id).problem).toMatch(/evidence/);
  });

  test("refuses an entry whose text would not be written as shown: an extra line the format does not carry", () => {
    const c = candidate();
    const extra = `${renderEntry(c).trimEnd()}\n\nSome trailing prose that is not part of the entry.\n`;
    const r = candidateFromShown(extra, c.id);
    expect(r.candidate).toBeUndefined();
  });
});
