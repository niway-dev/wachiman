import { describe, expect, test } from "bun:test";
import { benchLabel, FIELD_ROUNDS } from "./runs.ts";
import { decide, idfOf, locsOf, mdTables, parseFieldDoc, parseReplayDoc, tokensOf, type Finding } from "./labels.ts";
import { originalPrOf, roundOf, runOfReview, toolOfComment } from "./normalize.ts";

describe("normalize helpers", () => {
  test("the original PR comes from the head ref of a replay, else from the PR itself", () => {
    const pr = { number: 18, head: { ref: "replay/pr-465/head-r4" }, body: "", title: "[replay r4] feat(desktop): recording detail" };
    expect(originalPrOf("kaipu-bench-wachi", pr)).toBe("465");
    expect(originalPrOf("kaipu-record", { number: 478, head: { ref: "feature/x" }, body: "", title: "x" })).toBe("478");
    expect(originalPrOf("kaipu-bench-wachi", { number: 1, head: { ref: "main" }, body: "", title: "setup" })).toBe("");
  });

  test("the round comes from the title; the first round carries no number", () => {
    expect(roundOf("[replay r4] fix(desktop): x")).toBe("r4");
    expect(roundOf("[replay] fix(desktop): x")).toBe("r1");
    expect(roundOf("feat: not a replay")).toBe("");
  });

  test("the tool is the one whose signature the comment carries", () => {
    expect(toolOfComment({ user: { login: "github-actions[bot]" }, body: "👮 **Wachiman** · 🟡🧪 **Consider · tests: x**" })).toBe("wachiman");
    expect(toolOfComment({ user: { login: "pullfrog[bot]" }, body: "This closes" })).toBe("pullfrog");
    expect(toolOfComment({ user: { login: "coderabbitai[bot]" }, body: "x" })).toBe("coderabbit");
    expect(toolOfComment({ user: { login: "csdev19" }, body: "thanks" })).toBeNull();
  });

  test("a review belongs to the run whose window contains its submission, preferring the run with a log", () => {
    const runs = [
      { databaseId: 1, createdAt: "2026-11-02T03:12:00Z", updatedAt: "2026-11-02T03:12:30Z" },
      { databaseId: 2, createdAt: "2026-11-02T03:13:07Z", updatedAt: "2026-11-02T03:20:00Z" },
    ] as never;
    expect(runOfReview("2026-11-02T03:19:58Z", runs, new Map())?.databaseId).toBe(2);
    expect(runOfReview("2026-11-02T05:00:00Z", runs, new Map())).toBeNull();
  });
});

describe("run map", () => {
  test("replay rounds map to the labels of the analysis docs", () => {
    expect(benchLabel("kaipu-bench-wachi", 3, "465", "r1", "[replay] x").label).toBe("W-R1");
    expect(benchLabel("kaipu-bench-wachi", 18, "465", "r4", "[replay r4] x")).toMatchObject({ label: "W4", confidence: "derived", version: "v1.4.0" });
    expect(benchLabel("kaipu-bench-wachi", 33, "465", "r7", "[replay r7] x")).toMatchObject({ label: "S7", model: "claude-sonnet-5-5" });
    expect(benchLabel("kaipu-bench-pullfrog-v2", 4, "465", "r1", "[replay] x").label).toBe("PF-v2");
    expect(benchLabel("kaipu-bench-coderabbit-v2", 4, "465", "r1", "[replay] x").label).toBe("CR-v2");
  });

  test("what no doc covers is flagged as guessed", () => {
    expect(benchLabel("kaipu-bench-wachi", 46, "402", "r1", "[replay] perf(record)")).toMatchObject({ confidence: "guessed" });
    expect(benchLabel("kaipu-bench-coderabbit", 7, "255", "r1", "[replay] Bug")).toMatchObject({ confidence: "guessed" });
    expect(benchLabel("kaipu-bench-pullfrog-v2", 1, "465", "r1", "[setup] register kaipu-record workflows").notes).toContain("setup");
  });

  test("the field legends cover the seven kaipu-record PRs", () => {
    expect(Object.keys(FIELD_ROUNDS).sort()).toEqual(["439", "449", "478", "479", "482", "483", "484"]);
    expect(FIELD_ROUNDS["478"]?.c573b8e?.version).toBe("v1.4.0");
  });
});

// Rows copied from docs/benchmark/2026-11-02/prs/pr-465.md.
const DOC_465 = `## Expected issues

| ID | Issue | Severity | Difficulty | v1.3.0 | W4 | W5 | W6 | Label given | Contract-only? |
|----|-------|----------|-----------|--------|----|----|----|-------------|----------------|
| E1 | "Open in Export" test never checks the button is absent without \`onOpenExport\` (master-copies-panel.test.tsx:140) | Low | 2 | 3/3 | yes | yes | yes | \`Consider · tests\` in all three | no |
| E3 | Drag handle skips \`markCopySeen\` (master-copies-panel.tsx:171-175) | Medium | 4 | 0/3 | yes | no (see note) | yes | \`Consider · bug\` (W4 conf. medium, W6 conf. high) | W5: yes |

## Baseline additional findings

| ID | Finding | Verdict (baseline) | W4 | W5 | W6 | Label given |
|----|---------|--------------------|----|----|----|-------------|
| A1 | Failed probe leaves destination cards on "…" forever | Valid, Medium | yes (destinations-panel.tsx:91) | yes | yes | W4 \`Consider\` |
| A5 | PR body says "seven destinations", code has six | Unconfirmed (PR body not readable) | yes, posted as \`Info · docs\` in the review body (prepare-screen.md:114) | summary text only, not a finding | summary text only, not a finding | W4 \`Info\` |

## New findings

| ID | Finding | Verdict | Real severity | Label | Runs |
|----|---------|---------|---------------|-------|------|
| N1 | In \`MasterCopiesPanel\`, every test renders with \`probe\` set | Valid | Low (weak test) | \`Consider · tests\` | W5 |
`;

describe("verdict docs", () => {
  test("tables are read with their headings and backtick-safe cells", () => {
    const tables = mdTables(DOC_465);
    expect(tables.map((t) => t.heading)).toEqual(["Expected issues", "Baseline additional findings", "New findings"]);
    expect(tables[0]?.rows[0]?.[1]).toContain("`onOpenExport`");
  });

  test("run columns say which run found each verdict", () => {
    const v = parseReplayDoc(DOC_465, "2026-11-02", "465");
    const by = Object.fromEntries(v.map((x) => [x.id, x]));
    expect([...(by.E1?.runs ?? [])].sort()).toEqual(["W4", "W5", "W6"]);
    expect([...(by.E3?.runs ?? [])].sort()).toEqual(["W4", "W6"]);
    expect([...(by.A5?.runs ?? [])]).toEqual(["W4"]);
    expect([...(by.N1?.runs ?? [])]).toEqual(["W5"]);
    expect(by.E3?.kind).toBe("expected");
    expect(by.A1?.kind).toBe("additional");
    expect(by.A1?.verdict).toBe("Valid, Medium");
    expect(by.N1?.kind).toBe("new");
  });

  test("a multi-run column splits on slashes", () => {
    const md = `## Expected issues\n\n| ID | Issue | Severity | Difficulty | Opus W4 / W5 / W6 | S7 | S8 | S9 |\n|---|---|---|---|---|---|---|---|\n| E1 | Camera reopen fails (recording-hub.ts:456-460) | High | 5 | yes / no / partial | yes | no | no |\n`;
    const [e1] = parseReplayDoc(md, "2026-11-02-e1-sonnet", "463");
    expect([...(e1?.runs ?? [])].sort()).toEqual(["S7", "W4", "W6"]);
  });

  test("a field doc row keeps bot, verdict and the duplicate pointer", () => {
    const md = `| ID | Bot | Round | Claim | Bot label | Verdict | Sev | Category | Fixed? | Same issue as | Notes |\n|---|---|---|---|---|---|---|---|---|---|---|\n| F5 | Wachiman | W-full | Roll-forward deletes the whole drag folder | Fix, bug | Valid | Low | race | Yes | F12c | \`move-item.ts:674\` |\n`;
    const [f5] = parseFieldDoc(md, "field", "479");
    expect(f5).toMatchObject({ id: "F5", bot: "Wachiman", verdict: "Valid", sameAs: "F12c", kind: "field" });
  });
});

describe("matching", () => {
  test("locations and tokens", () => {
    expect(locsOf("Drag handle skips markCopySeen (master-copies-panel.tsx:171-175) and sidebar.test.tsx:39, 48")).toEqual([
      { file: "master-copies-panel.tsx", lo: 171, hi: 175 },
      { file: "sidebar.test.tsx", lo: 39, hi: 39 },
      { file: "sidebar.test.tsx", lo: 48, hi: 48 },
    ]);
    expect(tokensOf("The `markCopySeen` call is missing").has("markcopyseen")).toBe(true);
  });

  const verdicts = parseReplayDoc(DOC_465, "2026-11-02", "465");
  const idf = idfOf(verdicts);
  const finding = (over: Partial<Finding>): Finding => ({
    key: "k", tool: "wachiman", original_pr: "465", run_label: "W4", path: "", line: null, commit_id: "", title: "", body: "", severity: "consider", topic: "bug", placement: "inline", ...over,
  });

  test("path, line and wording agree: matched", () => {
    const d = decide(
      finding({ path: "apps/kaipu-record/src/renderer/src/pages/library-detail/master-copies-panel.tsx", line: 174, title: "The copy's Drag handle doesn't mark the copy as seen" , body: "markCopySeen is never called"}),
      verdicts.filter((v) => v.runs.has("W4")), idf,
    );
    expect(d.chosen?.v.id).toBe("E3");
  });

  test("a finding with nothing in common goes unmatched, with its reason", () => {
    const d = decide(finding({ path: "docs/other.md", line: 3, title: "Unrelated typo in the changelog" }), verdicts.filter((v) => v.runs.has("W4")), idf);
    expect(d.chosen).toBeNull();
    expect(d.reason).toContain("below");
  });

  test("a run no verdict lists has no candidates", () => {
    const d = decide(finding({ run_label: "W6" }), [], idf);
    expect(d.chosen).toBeNull();
    expect(d.reason).toContain("no verdict");
  });
});
