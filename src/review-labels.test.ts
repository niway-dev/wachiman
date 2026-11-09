import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { githubReview, label, type ReviewResult } from "./engine";
import { parseLabel } from "./precision";
import { sectionOf, tierWord } from "./verify";

// ADR 0030: the tier word leads every label, GitHub's included, and some findings leave the inline threads.

const fixture = (): ReviewResult =>
  JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-result.v2.example.json"), "utf8"));

const github = { since: null, rebased: false, scoped: false, mention: "/wachiman", automatic: false, instructionChanges: { files: [], baseSha: "b".repeat(40) } };

describe("tierWord", () => {
  test("Pre-existing first, then Important for blocker and fix, else Nit", () => {
    expect(tierWord({ severity: "fix", origin: "pre-existing" })).toBe("Pre-existing");
    expect(tierWord({ severity: "blocker", origin: "introduced" })).toBe("Important");
    expect(tierWord({ severity: "fix" })).toBe("Important");
    expect(tierWord({ severity: "consider" })).toBe("Nit");
    expect(tierWord({ severity: "info" })).toBe("Nit");
  });
});

describe("sectionOf", () => {
  const f = (over: object) => ({ severity: "fix" as const, origin: "unknown" as const, verification: { status: "supported" as const, reason: "ok", checked: [] }, ...over });
  test("pre-existing and inconclusive fix findings leave the main list", () => {
    expect(sectionOf(f({}))).toBe("main");
    expect(sectionOf(f({ origin: "pre-existing" }))).toBe("pre-existing");
    expect(sectionOf(f({ verification: { status: "inconclusive", reason: "the guard may hold", checked: [] } }))).toBe("inconclusive");
  });
  test("a finding the verifier never reached, a nit and an info notice stay in the main list", () => {
    expect(sectionOf(f({ verification: { status: "inconclusive", reason: "not verified: budget", checked: [] } }))).toBe("main");
    expect(sectionOf(f({ severity: "consider", verification: { status: "inconclusive", reason: "unclear", checked: [] } }))).toBe("main");
    expect(sectionOf(f({ severity: "info", origin: "pre-existing" }))).toBe("main");
  });
});

describe("the GitHub label", () => {
  test("the tier word leads, outside the bold, and the precision parser still reads the label", () => {
    const [store] = fixture().findings;
    const line = label(store);
    expect(line).toBe("Important · 🟠🐛 **Fix · bug: The store drops the last session (confidence high)**");
    expect(parseLabel(line)).toEqual({ severity: "fix", topic: "bug", confidence: "high" });
    expect(parseLabel(`👮 **Wachiman** · ${line}`)).toEqual({ severity: "fix", topic: "bug", confidence: "high" });
  });

  test("a finding without verification fields is labelled by its severity", () => {
    expect(label({ path: "a", line: 1, severity: "consider", topic: "cleanup", title: "t", body: "b" })).toStartWith("Nit · 🟡");
  });
});

describe("githubReview with verified findings", () => {
  test("a pre-existing finding is listed in the body, not opened as a thread", () => {
    const review = githubReview(fixture(), github);
    expect(review.comments.map((c) => c.path)).toEqual(["apps/api/src/main/session/store.ts"]);
    expect(review.comments[0].body).toContain("👮 **Wachiman** · Important · 🟠🐛 **Fix · bug: The store drops the last session (confidence high)**");
    expect(review.body).toContain("### Pre-existing");
    expect(review.body).toMatch(/### Pre-existing\n\n- Pre-existing · 🟠🐛 \*\*Fix · bug: The manager never closes the store \(confidence high\)\*\* \(`apps\/api\/src\/main\/session\/session-manager\.ts:3`\)/);
  });

  test("a fix the verifier could not settle goes to an Inconclusive section; one it never reached stays where it was", () => {
    const result = fixture();
    const [first] = result.findings;
    result.findings.push({
      ...first,
      line: 3,
      title: "The flush may race",
      verification: { status: "inconclusive", reason: "The lock on line 9 may serialise it.", checked: [], claimed: "inconclusive" },
    });
    result.findings.push({ ...first, line: 3, title: "Never reached", verification: { status: "inconclusive", reason: "not verified: budget", checked: [] } });
    const review = githubReview(result, github);
    expect(review.body).toMatch(/### Inconclusive\n\n- Important · .*The flush may race/);
    expect(review.body).not.toMatch(/### Inconclusive\n\n[^#]*Never reached/);
    expect(review.comments.some((c) => c.body.includes("Never reached"))).toBe(true);
    expect(review.comments.some((c) => c.body.includes("The flush may race"))).toBe(false);
  });
});
