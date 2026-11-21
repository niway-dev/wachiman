/**
 * The size limit is a promise: whatever the view holds, the body fits GitHub's limit, keeps the cost
 * line and the hidden markers, and keeps the Blocker and Fix rows (or the note that says how many were cut).
 */
import { describe, expect, test } from "bun:test";
import { MAX_BODY_CHARS, readAutoCost } from "../engine";
import { scenarios } from "./fixtures/scenarios";
import { renderReviewBody } from "./render";
import { buildView, refusedView, type ViewInput } from "./view";

type Found = ViewInput["output"]["findings"][number];

const base = scenarios["first-review"]!;
const SEVERITIES = ["blocker", "fix", "consider", "info"] as const;

const finding = (i: number, over: Partial<Found> = {}): Found => ({
  path: `src/f${i % 40}.ts`,
  line: i + 1,
  severity: "fix",
  topic: "bug",
  confidence: "high",
  title: `Finding ${i}`,
  body: `Finding ${i}: the explanation.`,
  anchor: "diff",
  ...over,
});

const withOutput = (findings: Found[], over: Partial<ViewInput["output"]> = {}): ViewInput => ({
  ...base,
  output: { ...base.output, findings, ...over },
});

const render = (input: ViewInput, refused: boolean, limit = MAX_BODY_CHARS) => {
  const view = buildView(input);
  return renderReviewBody(refused ? refusedView(view) : view, limit);
};

describe("a retained finding cannot push the body over the limit", () => {
  test("one outside-diff Fix with a 60,000-character body", () => {
    const body = render(withOutput([finding(0, { anchor: "outside", body: "x".repeat(60_000) })]), false);
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(body).toContain("| Finding 0 |");
  });
});

describe("the 422 body shrinks its Consider and Info rows", () => {
  test("300 Consider findings with 240-character titles", () => {
    const findings = Array.from({ length: 300 }, (_, i) => finding(i, { severity: "consider", title: `${"t".repeat(240)} ${i}` }));
    const body = render(withOutput(findings), true);
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(body).toContain("not shown because of GitHub's size limit");
  });

  test("300 Info findings with 240-character titles", () => {
    const findings = Array.from({ length: 300 }, (_, i) => finding(i, { severity: "info", title: `${"t".repeat(240)} ${i}` }));
    expect(render(withOutput(findings), true).length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });
});

describe("open-question text cannot open or close a details block", () => {
  test("an open contract with a details tag in its question and its action", () => {
    const open = {
      action: "</details><details>",
      location: "src/store.ts:10",
      visible_effect: "x",
      failure_mode: "y",
      status: "open" as const,
      open_question: "<details><summary>hidden</summary>",
      evidence: [],
    };
    const body = render(withOutput([], { contracts: [open] }), false);
    expect(body).toContain("&lt;details><summary>hidden");
    expect(body.split("<details").length).toBe(body.split("</details>").length);
  });
});

describe("whatever the view holds, the body fits and keeps what must survive", () => {
  const shapes: Record<string, Found[]> = {
    "huge bodies, outside the diff": Array.from({ length: 30 }, (_, i) => finding(i, { anchor: "outside", body: `${"b".repeat(20_000)}\n\nsecond paragraph` })),
    "hundreds of each priority": SEVERITIES.flatMap((severity, s) => Array.from({ length: 150 }, (_, i) => finding(s * 1000 + i, { severity }))),
    "hundreds of outside-diff Fix findings with long bodies": Array.from({ length: 300 }, (_, i) => finding(i, { anchor: "outside", title: `${"T".repeat(200)} ${i}`, body: "p".repeat(5_000) })),
    "huge titles": Array.from({ length: 200 }, (_, i) => finding(i, { severity: SEVERITIES[i % 4], title: `${"T".repeat(400)} ${i}` })),
  };
  for (const [name, findings] of Object.entries(shapes)) {
    for (const refused of [false, true]) {
      test(`${name}${refused ? ", 422 body" : ""}`, () => {
        const input = withOutput(findings);
        const body = render(input, refused);
        expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
        expect(readAutoCost(body)).not.toBeNull();
        for (const marker of input.footer.markers) expect(body).toContain(marker);
        // A Blocker or Fix row survives: the first of each is in the body, and a cut table says how many it left out.
        const demanding = buildView(input).findings.toFix;
        expect(demanding.length).toBeGreaterThan(0);
        expect(body).toContain("### To fix");
        expect(body).toContain(`| ${demanding[0]!.title} |`);
        if (!body.includes(`| ${demanding[demanding.length - 1]!.title} |`)) expect(body).toMatch(/- … and \d+ more not shown because of GitHub's size limit/);
      });
    }
  }
});
