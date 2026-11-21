import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { githubReview, label, summaryLine, type ReviewResult } from "./engine";
import { parseLabel } from "./precision";
import { sectionOf, tierWord } from "./verify";

// ADR 0030: the tier word leads every label, GitHub's included, and some findings leave the inline threads.

const fixture = (): ReviewResult =>
  JSON.parse(readFileSync(join(import.meta.dir, "../test/fixtures/formats/review-result.v2.example.json"), "utf8"));

const github = {
  since: null,
  rebased: false,
  scoped: false,
  mention: "/wachiman",
  automatic: false,
  instructionChanges: { files: [], baseSha: "b".repeat(40) },
};

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
  const f = (over: object) => ({
    severity: "fix" as const,
    origin: "unknown" as const,
    verification: { status: "supported" as const, reason: "ok", checked: [] },
    ...over,
  });
  test("pre-existing and inconclusive fix findings leave the main list", () => {
    expect(sectionOf(f({}))).toBe("main");
    expect(sectionOf(f({ origin: "pre-existing" }))).toBe("pre-existing");
    expect(sectionOf(f({ verification: { status: "inconclusive", reason: "the guard may hold", checked: [] } }))).toBe("inconclusive");
  });
  test("a finding the verifier never reached, a nit and an info notice stay in the main list", () => {
    expect(sectionOf(f({ verification: { status: "inconclusive", reason: "not verified: budget", checked: [], unreached: true } }))).toBe(
      "main",
    );
    // A model-written reason that starts like the code's does not make the finding unreached.
    expect(sectionOf(f({ verification: { status: "inconclusive", reason: "not verified: looks fine", checked: [] } }))).toBe(
      "inconclusive",
    );
    expect(sectionOf(f({ severity: "consider", verification: { status: "inconclusive", reason: "unclear", checked: [] } }))).toBe("main");
    expect(sectionOf(f({ severity: "info", origin: "pre-existing" }))).toBe("main");
  });
});

describe("the GitHub label", () => {
  test("the priority word leads, outside the bold, and the precision parser still reads the label", () => {
    const [store] = fixture().findings;
    const line = label(store);
    expect(line).toBe("Should · 🟠🐛 **Fix · bug: The store drops the last session (confidence high)**");
    expect(parseLabel(line)).toEqual({ severity: "fix", topic: "bug", confidence: "high" });
    expect(parseLabel(`👮 **Wachiman** · ${line}`)).toEqual({ severity: "fix", topic: "bug", confidence: "high" });
  });

  test("a finding without verification fields is labelled by its severity", () => {
    expect(label({ path: "a", line: 1, severity: "consider", topic: "cleanup", title: "t", body: "b" })).toStartWith("Could · 🟡");
  });
});

describe("the summary line (AC16)", () => {
  const f = (severity: "blocker" | "fix" | "consider" | "info", confidence?: "high" | "medium" | "low") => ({
    path: "a.ts",
    line: 1,
    severity,
    topic: "bug" as const,
    title: "t",
    body: "b",
    ...(confidence ? { confidence } : {}),
  });

  test("counts per priority in order, zero counts left out, then the findings at high confidence", () => {
    const findings = [
      f("blocker", "high"),
      ...Array.from({ length: 4 }, (_, i) => f("fix", i < 3 ? "high" : "medium")),
      ...Array.from({ length: 3 }, () => f("consider", "medium")),
      f("info", "high"),
    ];
    expect(summaryLine(findings)).toBe("**9 findings:** 1 Must, 4 Should, 3 Could, 1 FYI · 5 at high confidence");
  });

  test("one finding is singular, a priority with none is omitted, and a finding without confidence is not high", () => {
    expect(summaryLine([f("consider", "low")])).toBe("**1 finding:** 1 Could · 0 at high confidence");
    expect(summaryLine([f("fix"), f("info")])).toBe("**2 findings:** 1 Should, 1 FYI · 0 at high confidence");
  });

  test("the word arm counts by tier word, zero counts left out, singular for one", () => {
    const pre = { ...f("fix", "high"), origin: "pre-existing" as const };
    const findings = [f("blocker", "high"), f("fix", "high"), f("consider", "medium"), f("info"), pre];
    expect(summaryLine(findings, "word")).toBe("**5 findings:** 2 Important, 2 Nit, 1 Pre-existing · 3 at high confidence");
    expect(summaryLine(findings, "priority")).toBe(summaryLine(findings));
    expect(summaryLine([f("consider", "low")], "word")).toBe("**1 finding:** 1 Nit · 0 at high confidence");
    expect(summaryLine([f("fix", "high")], "word")).toBe("**1 finding:** 1 Important · 1 at high confidence");
  });

  test("no findings, no line", () => {
    expect(summaryLine([])).toBeNull();
  });

  test("a stored priority wins over the table, so a recomputed word never disagrees with the thread", () => {
    expect(summaryLine([{ ...f("fix", "high"), priority: "could" as const }])).toBe("**1 finding:** 1 Could · 1 at high confidence");
  });

  test("the review body carries it right after the count line, each arm in its own word; none without findings", () => {
    const result = fixture();
    expect(summaryLine(result.findings) as string).toStartWith(`**${result.findings.length} finding`);
    for (const arm of [undefined, "priority", "word"] as const) {
      const expected = summaryLine(result.findings, arm) as string;
      const body = githubReview(arm ? { ...result, arm } : result, github).body;
      expect(body).toContain(expected);
      expect(body.indexOf(expected)).toBeGreaterThan(body.indexOf("finding(s)"));
    }
    const none = githubReview({ ...result, findings: [] }, github).body;
    expect(none).not.toContain("**0 finding");
    expect(none).not.toMatch(/\*\*\d+ findings?:\*\*/);
  });
});

describe("githubReview and the trial arm (AC13)", () => {
  test("without an arm every table shows the Priority row and every list the priority word", () => {
    const review = githubReview(fixture(), github);
    expect(review.comments[0].body).toContain(
      "| **Priority** | **Should** · a change is expected; answer if you disagree |\n| **Severity** | 🟠 Fix |",
    );
    expect(review.comments[0].body).toContain("| **Track record** | no record yet · seed |");
    expect(review.body).toContain("- FYI · ⚪🏛️ **Info · adr:");
  });

  test("the priority arm is the same as no arm", () => {
    expect(githubReview({ ...fixture(), arm: "priority" }, github)).toEqual(githubReview(fixture(), github));
  });

  test("the word arm shows today's table and tier words, plus the Track record row; the order of findings is unchanged", () => {
    const priority = githubReview({ ...fixture(), arm: "priority" }, github);
    const word = githubReview({ ...fixture(), arm: "word" }, github);
    expect(word.comments[0].body).toContain("| **Severity** | 🟠 Fix · Important |");
    expect(word.comments[0].body).not.toContain("**Priority**");
    expect(word.comments[0].body).toContain("| **Track record** | no record yet · seed |");
    expect(word.body).toContain("- Pre-existing · 🟠🐛 **Fix · bug: The manager never closes the store");
    expect(word.body).toContain("- Nit · ⚪🏛️ **Info · adr:");
    expect(word.comments.map((c) => [c.path, c.line])).toEqual(priority.comments.map((c) => [c.path, c.line]));
  });
});

describe("githubReview with verified findings", () => {
  test("a pre-existing finding is listed in the body, not opened as a thread", () => {
    const review = githubReview(fixture(), github);
    expect(review.comments.map((c) => c.path)).toEqual(["apps/api/src/main/session/store.ts"]);
    expect(review.comments[0].body).toContain("| 👮 **Wachiman** | The store drops the last session |");
    expect(review.comments[0].body).toContain("| **Confidence** | 🟥🟥🟥 High |");
    expect(review.body).toContain("### Pre-existing");
    expect(review.body).toMatch(
      /### Pre-existing\n\n- Should · Pre-existing · 🟠🐛 \*\*Fix · bug: The manager never closes the store \(confidence high\)\*\* \(`apps\/api\/src\/main\/session\/session-manager\.ts:3`\)/,
    );
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
    result.findings.push({
      ...first,
      line: 3,
      title: "Never reached",
      verification: { status: "inconclusive", reason: "not verified: budget", checked: [], unreached: true },
    });
    const review = githubReview(result, github);
    expect(review.body).toMatch(/### Inconclusive\n\n- Should · .*The flush may race/);
    expect(review.body).not.toMatch(/### Inconclusive\n\n[^#]*Never reached/);
    expect(review.comments.some((c) => c.body.includes("Never reached"))).toBe(true);
    expect(review.comments.some((c) => c.body.includes("The flush may race"))).toBe(false);
  });
});
