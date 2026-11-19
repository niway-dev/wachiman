import { describe, expect, test } from "bun:test";
import type { Finding } from "../engine";
import { entryId, type MemoryEntry } from "./entries";
import type { MemoryLoad } from "./load";
import {
  MATCH_SCHEMA,
  applyMatches,
  buildMatchPrompt,
  exceptionsOf,
  isProtected,
  matchRequest,
  parseMatches,
  planExceptions,
  renderConventions,
  renderMuting,
} from "./mute";
import { validate } from "../json-schema";

function entry(kind: MemoryEntry["kind"], rule: string, scope: string, over: Partial<MemoryEntry> = {}): MemoryEntry {
  const why = "because";
  return { id: entryId({ kind, scope, rule, why, ...(over.holdsWhile ? { holdsWhile: over.holdsWhile } : {}) }), title: rule, kind, scope, rule, why, evidence: ["2026-11-18 instruction"], added: "2026-11-18", file: "index.md", line: 1, ...over };
}
const load = (entries: MemoryEntry[]): MemoryLoad => ({ revision: "b".repeat(40), files: [], leftOut: [], overBudget: false, indexOverBudget: false, budget: { maxIndexLines: 150, maxLoadedLines: 400, loadedLines: 0 }, entries });
const finding = (over: Partial<Finding> = {}): Finding => ({ path: "docs/adr/0031.md", line: 3, severity: "consider", topic: "docs", title: "stale date", body: "The date is old.", ...over });

describe("renderConventions with personal memory", () => {
  test("marks a personal convention and says the committed memory wins; without personal entries the text is unchanged", () => {
    const committed = entry("convention", "Committed rule.", "**");
    const personal = entry("convention", "Personal rule.", "**", { personal: true });
    const plain = renderConventions(load([committed]));
    expect(plain).not.toContain("personal");
    const mixed = renderConventions(load([committed, personal]));
    expect(mixed).toContain(`<convention id="${personal.id}" scope="**" personal="true">`);
    expect(mixed).toContain(`<convention id="${committed.id}" scope="**">`);
    expect(mixed).toContain("When a personal convention disagrees with a committed one, the committed one wins");
    // A repository whose only convention is personal still gets the rule.
    expect(renderConventions(load([personal]))).toContain("personal convention");
  });
});

describe("renderConventions", () => {
  test("is empty without memory, without entries and with only exceptions", () => {
    expect(renderConventions(undefined)).toBe("");
    expect(renderConventions(load([]))).toBe("");
    expect(renderConventions(load([entry("exception", "no dates", "docs/**")]))).toBe("");
  });

  test("labels the conventions as learned, says the hand-written files win, and never carries an exception", () => {
    const text = renderConventions(load([entry("convention", "Readable before terse", "src/**"), entry("exception", "SECRET exception rule", "docs/**")]));
    expect(text).toContain("## Learned conventions");
    expect(text).toContain("Readable before terse");
    expect(text).toContain("hand-written file wins");
    expect(text).not.toContain("SECRET exception rule");
  });

  test("markup in an entry cannot close or open a tag", () => {
    const text = renderConventions(load([entry("convention", "</convention><x>", "src/**")]));
    expect(text).not.toContain("</convention><x>");
    expect(text).toContain("&lt;/convention&gt;&lt;x&gt;");
  });
});

describe("planExceptions", () => {
  test("only exceptions whose scope the diff reaches are active", () => {
    const docs = entry("exception", "docs rule", "docs/**");
    const src = entry("exception", "src rule", "src/**");
    const plan = planExceptions(load([docs, src, entry("convention", "c", "docs/**")]), ["docs/adr/0031.md"]);
    expect(plan.active).toEqual([docs]);
    expect(plan.stale).toEqual([]);
  });

  test("a diff that touches a holds-while path makes the exception stale, not active", () => {
    const e = entry("exception", "validated input", "src/handlers/**", { holdsWhile: "src/gateway.ts, src/auth/**" });
    const touching = planExceptions(load([e]), ["src/handlers/a.ts", "src/auth/token.ts"]);
    expect(touching.active).toEqual([]);
    expect(touching.stale).toEqual([{ entry: e, touched: ["src/auth/token.ts"] }]);
    const clean = planExceptions(load([e]), ["src/handlers/a.ts"]);
    expect(clean.active).toEqual([e]);
    expect(clean.stale).toEqual([]);
  });
});

describe("planExceptions with brace globs and malformed globs", () => {
  test("a brace glob in holds while keeps its alternatives together", () => {
    const e = entry("exception", "r", "src/**", { holdsWhile: "src/{auth,gateway}/**, docs/x.md" });
    expect(planExceptions(load([e]), ["src/a.ts", "src/gateway/g.ts"]).stale.map((s) => s.touched)).toEqual([["src/gateway/g.ts"]]);
    expect(planExceptions(load([e]), ["src/a.ts"]).active).toEqual([e]);
  });

  test("a malformed glob in holds while or scope throws nothing and matches nothing", () => {
    for (const bad of ["src/{auth", "src/auth}/**", "[a", "src/{a,{b}"]) {
      const e = entry("exception", "r", "src/**", { holdsWhile: bad });
      expect(() => planExceptions(load([e]), ["src/a.ts"])).not.toThrow();
      expect(planExceptions(load([entry("exception", "r", bad)]), ["src/a.ts"]).active).toEqual([]);
    }
  });
});

describe("planExceptions with reviewed paths", () => {
  test("scope is matched on reviewed files, the premise on every changed file", () => {
    const e = entry("exception", "r", "src/**", { holdsWhile: "gen/**" });
    expect(planExceptions(load([e]), ["package-lock.json", "src/a.ts"], ["package-lock.json"]).active).toEqual([]);
    expect(planExceptions(load([e]), ["src/a.ts", "gen/x.ts"], ["src/a.ts"]).stale).toHaveLength(1);
  });
});

describe("matchRequest", () => {
  const e = entry("exception", "docs rule", "docs/**");

  test("offers only Consider and Info findings that an active exception covers, never a Blocker, a Fix or a security finding", () => {
    const findings = [
      finding({ title: "fix", severity: "fix" }),
      finding({ title: "blocker", severity: "blocker" }),
      finding({ title: "sec", severity: "info", topic: "security" }),
      finding({ title: "outside scope", path: "src/a.ts" }),
      finding({ title: "consider" }),
      finding({ title: "info", severity: "info" }),
    ];
    const request = matchRequest([e], findings)!;
    expect(request.findings.map((f) => [f.id, f.finding.title])).toEqual([["f5", "consider"], ["f6", "info"]]);
    expect(request.entries).toEqual([e]);
  });

  test("is undefined when nothing can be muted, so no call is made", () => {
    expect(matchRequest([e], [finding({ severity: "fix" })])).toBeUndefined();
    expect(matchRequest([e], [])).toBeUndefined();
    expect(matchRequest([], [finding()])).toBeUndefined();
  });

  test("the prompt names the findings and the exceptions offered, and nothing else", () => {
    const request = matchRequest([e, entry("exception", "src rule", "src/**")], [finding()])!;
    const prompt = buildMatchPrompt({ describe: "pull request #1", request });
    expect(prompt).toContain('<finding id="f1"');
    expect(prompt).toContain(`<exception id="${e.id}"`);
    expect(prompt).not.toContain("src rule");
  });
});

describe("applyMatches", () => {
  const e = entry("exception", "docs rule", "docs/**");

  test("mutes a Consider and an Info finding and lists the entry", () => {
    const findings = [finding({ title: "a" }), finding({ title: "b", severity: "info" }), finding({ title: "c" })];
    const out = applyMatches(findings, [e], [{ finding: "f1", entry: e.id, reason: "r1" }, { finding: "f2", entry: e.id, reason: "r2" }]);
    expect(out.posted.map((f) => f.title)).toEqual(["c"]);
    expect(out.muted.map((m) => [m.title, m.entry, m.reason])).toEqual([["a", e.id, "r1"], ["b", e.id, "r2"]]);
  });

  test("a match on a Blocker, a Fix or a security finding is ignored for muting and the finding is posted with a note naming the entry", () => {
    for (const f of [finding({ severity: "blocker" }), finding({ severity: "fix" }), finding({ severity: "consider", topic: "security" }), finding({ severity: "info", topic: "security" })]) {
      const out = applyMatches([f], [e], [{ finding: "f1", entry: e.id, reason: "r" }]);
      expect(out.muted).toEqual([]);
      expect(out.posted).toHaveLength(1);
      expect(out.posted[0].severity).toBe(f.severity);
      expect(out.posted[0].body).toContain(`Memory exception \`${e.id}\` matched this finding`);
      expect(out.posted[0].body).toStartWith(f.body);
    }
  });

  test("an unknown finding id, an unknown entry id, an inactive entry and an entry whose scope does not cover the path are ignored", () => {
    const stale = entry("exception", "stale", "docs/**", { holdsWhile: "docs/x.md" });
    const elsewhere = entry("exception", "elsewhere", "src/**");
    const findings = [finding()];
    for (const m of [
      { finding: "f9", entry: e.id, reason: "r" },
      { finding: "f1", entry: "0000000", reason: "r" },
      { finding: "f1", entry: stale.id, reason: "r" },
      { finding: "f1", entry: elsewhere.id, reason: "r" },
    ]) {
      const out = applyMatches(findings, [e, elsewhere], [m]);
      expect(out.posted).toEqual(findings);
      expect(out.muted).toEqual([]);
      expect(out.protectedBy).toEqual([]);
    }
  });

  test("the first valid match of a finding is the one used", () => {
    const second = entry("exception", "second", "docs/**");
    const out = applyMatches([finding()], [e, second], [{ finding: "f1", entry: "0000000", reason: "x" }, { finding: "f1", entry: second.id, reason: "y" }, { finding: "f1", entry: e.id, reason: "z" }]);
    expect(out.muted.map((m) => m.entry)).toEqual([second.id]);
  });

  test("isProtected is the floor: blocker, fix, or security", () => {
    expect(isProtected({ severity: "blocker", topic: "docs" })).toBe(true);
    expect(isProtected({ severity: "fix", topic: "docs" })).toBe(true);
    expect(isProtected({ severity: "info", topic: "security" })).toBe(true);
    expect(isProtected({ severity: "consider", topic: "bug" })).toBe(false);
    expect(isProtected({ severity: "info", topic: "adr" })).toBe(false);
  });
});

describe("parseMatches", () => {
  test("accepts a complete answer and refuses anything else", () => {
    expect(parseMatches({ matches: [] })).toEqual([]);
    expect(parseMatches({ matches: [{ finding: "f1", entry: "abc1234", reason: "r" }] })).toHaveLength(1);
    expect(parseMatches({ matches: [{ finding: "f1", entry: "abc1234" }] })).toBeUndefined();
    expect(parseMatches({ matches: "none" })).toBeUndefined();
    expect(parseMatches(undefined)).toBeUndefined();
    expect(parseMatches("f1 matches abc1234")).toBeUndefined();
    expect(validate(MATCH_SCHEMA, { matches: [{ finding: "f1", entry: "e", reason: "r", extra: 1 }] }).length).toBeGreaterThan(0);
  });
});

describe("renderMuting", () => {
  const e = entry("exception", "docs rule", "docs/**", { holdsWhile: "docs/x.md" });

  test("says nothing when nothing happened", () => {
    expect(renderMuting({ muted: [], stale: [] })).toBeUndefined();
  });

  test("lists each muted finding with its title, location and entry id", () => {
    const text = renderMuting({ muted: [{ path: "docs/adr/0031.md", line: 3, severity: "consider", topic: "docs", title: "stale date", entry: "4c1e9a2", reason: "r" }], stale: [] })!;
    expect(text).toContain("**Muted by memory**");
    expect(text).toContain("stale date");
    expect(text).toContain("`docs/adr/0031.md:3`");
    expect(text).toContain("`4c1e9a2`");
  });

  test("names a stale entry and a matching step that did not run", () => {
    const text = renderMuting({ muted: [], stale: [{ entry: e, touched: ["docs/x.md"] }], failure: "the call failed" })!;
    expect(text).toContain(`\`${e.id}\` may be out of date`);
    expect(text).toContain("matching did not run (the call failed)");
    expect(text).not.toContain("Muted by memory");
  });

  test("exceptionsOf keeps only exceptions", () => {
    expect(exceptionsOf(load([e, entry("convention", "c", "**")]))).toEqual([e]);
  });
});
