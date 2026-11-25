/**
 * Size fitting and the 422 body (spec "The review body"): whole slots go from a named list in a
 * fixed order, the row tables are cut only when the never-dropped slots alone are too long, and
 * the findings, the cost line and the markers stay. Views are built by hand, so a change of wording
 * does not move these tests; the goldens in `render.test.ts` show the same rules on whole bodies.
 */
import { describe, expect, test } from "bun:test";
import type { Contract } from "../contracts";
import { renderReviewBody } from "./render";
import { computeStatus } from "./status";
import { countFindingRows, refusedView, type FindingRow, type ReviewView } from "./view";
import { SHA, contract, makeView, partial, person, row } from "./fixtures/views";

const MARKERS = ["<!-- wachi:auto -->", "<!-- wachi:review -->", `<!-- wachiman sha=${SHA} -->`];
const COST = "<sub>Model via Tool 1.0 · effort high · review · $0.10</sub>";
const footer = { costLine: COST, markers: MARKERS };
const para = (n: number, word = "word") => Array.from({ length: n }, () => word).join(" ");

const rows = (n: number, over: Partial<FindingRow> = {}, name = "Finding") =>
  Array.from({ length: n }, (_, i) =>
    row({ title: `${name} ${i + 1}`, path: `src/f${i}.ts`, displayPath: `f${i}.ts`, location: `f${i}.ts:${i + 1}`, line: i + 1, ...over }),
  );

/** Every collapsible slot present and long enough that the order of the drops is visible. */
function fullView(extra: Partial<ReviewView> = {}): ReviewView {
  const closed: Contract[] = Array.from({ length: 6 }, (_, i) => ({
    ...contract("closed"),
    action: `closed action ${i}`,
    visible_effect: para(40),
  }));
  const findings = {
    toFix: rows(2, { severity: "blocker", priority: "must" }, "Blocker").concat(rows(2, {}, "Fix")),
    consider: rows(10, { severity: "consider", priority: "could", inlineThread: true }, "Consider"),
    preExisting: rows(4, { severity: "consider", origin: "pre-existing", inlineThread: false }, "Old"),
    info: rows(6, { severity: "info", priority: "fyi", inlineThread: false }, "Info"),
  };
  return makeView({
    findings,
    glance: [
      { key: "findings", ...countFindingRows({ ...findings, investigate: [] }) },
      { key: "coverage", reviewed: 5, total: 45, scope: "whole" },
    ],
    contracts: { open: [], closed },
    batchProse: para(300),
    coverage: {
      rows: Array.from({ length: 12 }, (_, i) => ({
        label: `Batch ${i + 1} of 12`,
        files: 3,
        lines: 40,
        maxRisk: 3,
        status: "reviewed",
        turns: 5,
        costUsd: 0.1,
      })),
      estimate: false,
    },
    ...partial(40, 45),
    footer,
    ...extra,
  });
}

const SLOT_MARKS: [string, string][] = [
  ["checked", "<summary>What the reviewer checked"],
  ["connects", "<summary>What the change connects to"],
  ["coverage", "<summary>Coverage by batch"],
  ["files", "<summary>Files not reviewed"],
  ["info", "For your information"],
  ["preExisting", "Pre-existing ("],
];

describe("slot 7: questions for you", () => {
  const open = {
    ...contract("open"),
    action: "the new button",
    location: "src/a.ts:7",
    open_question: "does the server accept it?",
    candidates: ["docs/api.md"],
  };
  const view = makeView({ needsPerson: [person()], contracts: { open: [open], closed: [] }, footer });
  const body = renderReviewBody(view);

  test("lists the needs-a-person items, then every open question with its location, outside any collapsed block", () => {
    expect(body).toContain("### Questions for you (2)");
    const section = body.slice(body.indexOf("### Questions for you"));
    const items = section.split("\n\n")[1]!.split("\n");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("x.md:3");
    expect(items[0]).toContain("trade-off");
    expect(items[1]).toContain("src/a.ts:7");
    expect(items[1]).toContain("does the server accept it?");
    expect(items[1]).toContain("docs/api.md");
    expect(body.indexOf("### Questions for you")).toBeLessThan(body.indexOf("<details>"));
  });

  test("the status counts both, and the heading counts what the status counts", () => {
    expect(computeStatus(view).lead).toBe("2 questions for you");
    expect(body.split("\n")[0]).toContain("🟣 **2 questions for you**");
  });

  test("an open question alone is a visible slot too", () => {
    const only = renderReviewBody(makeView({ contracts: { open: [open], closed: [] }, footer }));
    expect(only).toContain("### Questions for you (1)");
    expect(only.indexOf("### Questions for you")).toBeLessThan(only.indexOf("<details>"));
  });

  test("a location that is not path:line is shown as written", () => {
    const text = renderReviewBody(makeView({ contracts: { open: [{ ...open, location: "the deploy script" }], closed: [] }, footer }));
    expect(text).toContain("`the deploy script`");
  });
});

describe("size fitting: whole slots go in the named order", () => {
  const view = fullView();
  const whole = renderReviewBody(view);

  test("the fixture really has every slot of the list", () => {
    for (const [name, mark] of SLOT_MARKS) expect(whole, name).toContain(mark);
  });

  test("at every limit the missing slots are a prefix of 12, 11, 13, 13a, 10, 9, and the body fits", () => {
    const order = ["checked", "connects", "coverage", "files", "info", "preExisting"];
    for (let limit = whole.length; limit > 2500; limit -= 137) {
      const body = renderReviewBody(view, limit);
      const missing = SLOT_MARKS.filter(([, mark]) => !body.includes(mark)).map(([name]) => name);
      expect(missing, `limit ${limit}`).toEqual(order.slice(0, missing.length));
      expect(body.length, `limit ${limit}`).toBeLessThanOrEqual(limit);
    }
  });

  test("a body that fits is returned whole", () => {
    expect(renderReviewBody(view, whole.length)).toBe(whole);
  });

  test("slots 1 to 3, 7, 15 and 16 are never dropped, and a Blocker and a Fix keep their rows", () => {
    const withPerson = fullView({ needsPerson: [person()] });
    for (const limit of [9000, 5000, 3500, 3000]) {
      const body = renderReviewBody(withPerson, limit);
      expect(body.length).toBeLessThanOrEqual(limit);
      expect(body.startsWith("👮 **Wachiman** · ")).toBe(true);
      expect(body).toContain("| At a glance |");
      expect(body).toContain("### Questions for you (1)");
      expect(body).toContain(COST);
      for (const m of MARKERS) expect(body).toContain(m);
      for (const title of ["Blocker 1", "Blocker 2", "Fix 1", "Fix 2"]) expect(body, title).toContain(title);
    }
  });

  test("Pre-existing that holds a Fix is never dropped", () => {
    const v = fullView({
      findings: {
        ...fullView().findings,
        preExisting: rows(3, { severity: "fix", origin: "pre-existing", inlineThread: false }, "Old fix"),
      },
    });
    const body = renderReviewBody(v, 3600);
    expect(body).toContain("Old fix 1");
    expect(body.length).toBeLessThanOrEqual(3600);
  });
});

describe("size fitting: Files not reviewed (slot 13a)", () => {
  const view = fullView();
  const whole = renderReviewBody(view);
  const limits = Array.from({ length: 900 }, (_, i) => whole.length - i * 11).filter((l) => l > 2500);

  test("it shrinks to one count per reason before it goes, and the callout and the Coverage row stop pointing at it once its names are gone", () => {
    let counts = false;
    let gone = false;
    for (const limit of limits) {
      const body = renderReviewBody(view, limit);
      const summary = body.includes("<summary>Files not reviewed");
      const names = body.includes("src/f0.ts");
      if (summary && !names) {
        counts = true;
        const slot = body.slice(
          body.indexOf("<summary>Files not reviewed"),
          body.indexOf("</details>", body.indexOf("<summary>Files not reviewed")),
        );
        expect(slot).toMatch(/Because the pull request's budget was spent: 40 files/);
      }
      if (!summary) gone = true;
      if (summary && names) {
        expect(body).toContain('They are listed under "Files not reviewed"');
        expect(body).toContain("listed under Files not reviewed");
      } else {
        expect(body, `limit ${limit}`).not.toContain('listed under "Files not reviewed"');
        expect(body, `limit ${limit}`).not.toContain("listed under Files not reviewed");
        expect(body, `limit ${limit}`).toContain("40 not reviewed because the pull request's budget was spent");
        expect(body, `limit ${limit}`).toContain("not listed because of GitHub's size limit");
      }
    }
    expect(counts).toBe(true);
    expect(gone).toBe(true);
  });
});

describe("size fitting: To consider (slot 6) shrinks last among the slots, keeping the rows with no thread", () => {
  const outside = rows(2, { severity: "consider", inlineThread: false, outsideDiff: true, body: para(150) }, "Outside");
  const threaded = rows(6, { severity: "consider", inlineThread: true }, "Threaded");
  const view = makeView({ findings: { toFix: rows(1, { severity: "blocker" }, "Blocker"), consider: [...threaded, ...outside] }, footer });
  const whole = renderReviewBody(view);

  test("the Consider body goes first (with the details), the rows stay while nothing else can go", () => {
    const text = renderReviewBody(view, whole.length - 100);
    expect(text).toContain("Threaded 6");
    expect(text).toContain("Outside 2");
    expect(text).not.toContain("Details of findings with no thread");
  });

  test("when the slot must shrink, the rows with no thread stay and the rest become a count", () => {
    let limit = whole.length;
    let text = whole;
    while (!text.includes("more to consider") && limit > 0) text = renderReviewBody(view, (limit -= 20));
    expect(text).toContain("Outside 1");
    expect(text).toContain("Outside 2");
    expect(text).not.toContain("Threaded 1");
    expect(text).toContain("6 more to consider, on their lines (see Files changed).");
    expect(text).toContain("Blocker 1");
    expect(text.length).toBeLessThanOrEqual(limit);
  });
});

describe("size fitting: the never-dropped slots alone pass the limit", () => {
  const facts = Array.from({ length: 30 }, (_, i) => ({
    kind: "data" as const,
    path: `src/r${i}.ts`,
    line: i + 1,
    displayPath: `r${i}.ts`,
    location: `r${i}.ts:${i + 1}`,
    why: para(12),
  }));
  const view = makeView({
    findings: {
      toFix: [...rows(2, { severity: "blocker" }, "Blocker"), ...rows(40, {}, "Fix")],
      investigate: rows(10, { severity: "fix" }, "Inconclusive"),
      preExisting: rows(10, { severity: "fix", origin: "pre-existing", inlineThread: false }, "Old fix"),
    },
    risk: { level: "high", floor: false, pushOnly: false, facts, pathReasons: [], readFirst: [], unreadFiles: 0, droppedFacts: 0 },
    footer,
  });
  const whole = renderReviewBody(view);

  test("risk facts are cut first, down to the fact that sets the level, then pre-existing, needs investigation and To fix", () => {
    const risky = renderReviewBody(view, whole.length - 400);
    expect(risky).toContain("`r0.ts:1`");
    expect(risky).not.toContain("`r29.ts:30`");
    expect(risky).toMatch(/- … and \d+ more not shown because of GitHub's size limit\n/);
    expect(risky).toContain("Old fix 10");
    expect(risky).toContain("Fix 40");
  });

  test("then each table is cut in turn, Blockers first, and each cut table says how many it leaves out", () => {
    const body = renderReviewBody(view, 2000);
    expect(body.length).toBeLessThanOrEqual(2000);
    expect(body).toContain("Blocker 1");
    expect(body).toContain("Blocker 2");
    expect(body).toMatch(/- … and \d+ more not shown because of GitHub's size limit, they are on their lines\./);
    expect(body).not.toContain("Fix 40");
    expect(body).toContain(COST);
    for (const m of MARKERS) expect(body).toContain(m);
    // Pre-existing rows have no thread: no "on their lines" there.
    const pre = body.slice(body.indexOf("### Pre-existing"));
    const note = pre.slice(pre.indexOf("\n\n") + 2).split(/\n### |<sub>/)[0]!;
    expect(note.length).toBeGreaterThan(0);
    expect(note).not.toContain("on their lines");
  });

  test("the cut To fix table keeps the Blockers before any Fix", () => {
    const body = renderReviewBody(view, 1700);
    expect(body.length).toBeLessThanOrEqual(1700);
    const shown = body.slice(
      body.indexOf("### To fix"),
      body.indexOf("### Needs investigation") === -1 ? undefined : body.indexOf("### Needs investigation"),
    );
    expect(shown).toContain("Blocker 1");
    expect(shown).toContain("Blocker 2");
  });
});

describe("the 422 body", () => {
  const view = refusedView(fullView());
  const body = renderReviewBody(view);

  test("no row is on its line, and each finding is listed once in a numbered table", () => {
    expect(body).not.toContain(", they are on their lines");
    expect(body).not.toContain("(see Files changed)");
    expect(body).not.toContain("Answer a finding in its thread");
    expect(body).toContain("GitHub would not anchor these findings on their lines");
    expect(body).toContain("| # | | Where | Finding |");
    for (const title of ["Blocker 1", "Fix 2", "Consider 10", "Old 4", "Info 6"])
      expect(body.split(`| ${title} |`).length - 1, title).toBe(1);
    const numbers = [...body.matchAll(/^\| (\d+) \| /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    expect(numbers.length).toBe(24);
  });

  test("the details of each finding follow the coverage slots and come before the cost line", () => {
    const at = body.indexOf("<summary>Details of each finding (24)");
    expect(at).toBeGreaterThan(body.indexOf("<summary>Files not reviewed"));
    expect(at).toBeLessThan(body.indexOf(COST));
    expect(body).toContain("**1. Blocker 1");
    expect(body).toContain("**24. Info 6");
    expect(renderReviewBody(fullView())).not.toContain("Details of each finding");
  });

  test("its drop order: 12, then the Consider and Info bodies, then 11, 13, 13a, 10, 9, 6, and the Blocker and Fix bodies last", () => {
    const withBodies = refusedView(
      fullView({
        findings: {
          toFix: [
            ...rows(
              1,
              { severity: "blocker", body: `First paragraph of the blocker.\n\nSecond paragraph of the blocker. ${para(250)}` },
              "Blocker",
            ),
            ...rows(1, { body: `First of the fix.\n\nSecond of the fix. ${para(250)}` }, "Fix"),
          ],
          consider: rows(10, { severity: "consider", body: "A consider body one. A consider body two." }, "Consider"),
          preExisting: rows(3, { severity: "consider", origin: "pre-existing" }, "Old"),
          info: rows(6, { severity: "info" }, "Info"),
          investigate: [],
        },
      }),
    );
    const full = renderReviewBody(withBodies);
    const seen: string[] = [];
    const note = (what: string, present: boolean) => {
      if (!present && !seen.includes(what)) seen.push(what);
    };
    for (let limit = full.length; limit > 2300; limit -= 37) {
      const text = renderReviewBody(withBodies, limit);
      expect(text.length, `limit ${limit}`).toBeLessThanOrEqual(limit);
      note("checked", text.includes("<summary>What the reviewer checked"));
      note("considerBodies", text.includes("A consider body one"));
      note("connects", text.includes("<summary>What the change connects to"));
      note("coverage", text.includes("<summary>Coverage by batch"));
      note("files", text.includes("<summary>Files not reviewed"));
      note("info", text.includes("For your information"));
      note("preExisting", text.includes("Pre-existing ("));
      note("blockerSecond", text.includes("Second paragraph of the blocker"));
      expect(text, `limit ${limit}`).toContain("Blocker 1");
      expect(text, `limit ${limit}`).toContain("First paragraph of the blocker.");
      expect(text, `limit ${limit}`).toContain(COST);
    }
    expect(seen).toEqual(["checked", "considerBodies", "connects", "coverage", "files", "info", "preExisting", "blockerSecond"]);
  });

  test("a 422 body over the limit is fitted from the same view: it fits, and keeps the cost line and the markers", () => {
    const text = renderReviewBody(view, 4000);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain(COST);
    for (const m of MARKERS) expect(text).toContain(m);
    expect(text).toContain("Blocker 1");
  });

  test("a row cut from a 422 table is not 'on its line', and no 'Trimmed' text is appended", () => {
    const text = renderReviewBody(refusedView(makeView({ findings: { toFix: rows(60, {}, "Fix") }, footer })), 3000);
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).toMatch(/- … and \d+ more not shown because of GitHub's size limit\./);
    expect(text).not.toContain(", they are on their lines");
    expect(text).not.toContain("Trimmed");
  });
});
