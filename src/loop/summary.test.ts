/**
 * The "Review summary — local" comment, pinned by golden files in `fixtures/summary/`. Each case is
 * a loop state and its verdicts; the output must equal the file byte for byte. After a deliberate
 * change to the format, regenerate with `UPDATE_GOLDEN=1 bun test src/loop/summary.test.ts` and read
 * the diff of the `.md` files.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { duration, modelName, renderSummary, roundsText, SUMMARY_KIND, SUMMARY_MARKER, type SummaryFinding } from "./summary";
import type { LoopRound, LoopState, RoundReview } from "./state";
import type { LoopStatus } from "./stop-rule";

const GOLDEN = join(import.meta.dir, "fixtures", "summary");
const sha = (n: number) => n.toString(16).padStart(7, "0").padEnd(40, "0");

/** The Wachiman and model each round ran under, unless a case says otherwise. */
const SONNET = { model: "claude-sonnet-5-5", effort: "high" };
function review(from: number, to: number, over: Partial<RoundReview> = {}): RoundReview {
  return { base: sha(from), version: "1.15.0", reviewer: SONNET, costUsd: 0.25, durationMs: 62_000, findings: 0, newFindings: 0, ...over };
}
/** Round `n` whose head is commit `n`; its review read the commits since round `n - 1`. */
const round = (n: number, over: Partial<RoundReview> | null = {}): LoopRound => ({
  round: n,
  head: sha(n),
  at: "2026-11-14T10:00:00.000Z",
  ...(over === null ? {} : { review: review(n - 1, n, over) }),
});
const state = (rounds: LoopRound[], over: Partial<LoopState> = {}, ledger: LoopState["ledger"] = []): LoopState => ({
  format: "wachiman.loop-state/2",
  branch: "feat/x",
  base: "main",
  status: "converged",
  maxRounds: 5,
  rounds,
  ledger,
  ...over,
});
const finding = (id: string, over: Partial<SummaryFinding> = {}): SummaryFinding => ({
  id,
  path: "src/a.ts",
  line: 2,
  severity: "fix",
  topic: "bug",
  title: `Finding ${id}`,
  status: "probably-fixed" as LoopStatus,
  refuted: false,
  round: 1,
  ...over,
});
const wrong = (reason: string) => ({ verdict: "wrong" as const, reason });

const CASES: Record<string, Parameters<typeof renderSummary>[0]> = {
  "single-version": {
    state: state([round(1, { findings: 3, newFindings: 3 }), round(2, { findings: 1, newFindings: 0 }), round(3)]),
    findings: [finding("aaaa000001", { severity: "blocker" }), finding("aaaa000002", { round: 1 }), finding("aaaa000003", { severity: "consider", status: "open", round: 1 })],
  },
  "two-versions": {
    state: state([round(1, { version: "1.14.0", newFindings: 2, findings: 2 }), round(2, { version: "1.14.0" }), round(3, { newFindings: 1, findings: 1 }), { ...round(4, null), head: sha(3) }]),
    findings: [finding("bbbb000001"), finding("bbbb000002", { round: 1 }), finding("bbbb000003", { round: 3, severity: "blocker" })],
    agent: "Claude Code",
  },
  "verifier-on": {
    state: state([
      round(1, { reviewer: { model: "claude-haiku-5-5", effort: "high" }, verifier: { model: "claude-opus-5-5", effort: "high" }, costUsd: 0.55, durationMs: 190_000, findings: 2, newFindings: 2 }),
      round(2, { reviewer: { model: "claude-haiku-5-5", effort: "high" }, verifier: { model: "claude-opus-5-5", effort: "high" }, costUsd: 0.4, durationMs: 120_500 }),
    ]),
    findings: [finding("cccc000001"), finding("cccc000002", { refuted: true, status: "open" })],
  },
  "models-differ": {
    state: state([round(1, { newFindings: 1, findings: 1 }), round(2, { reviewer: { model: "claude-opus-5-5", effort: "medium" } })]),
    findings: [finding("dddd000001")],
  },
  "v1-state": {
    state: state([round(1, null), round(2, null)], { format: "wachiman.loop-state/2", maxRounds: undefined }, []),
    findings: [finding("eeee000001", { round: undefined }), finding("eeee000002", { round: undefined, status: "unknown" as LoopStatus })],
  },
  "partly-recorded": {
    state: state([round(1, null), round(2, null), round(3, { newFindings: 1, findings: 1, costUsd: 1.5, durationMs: 677_000 })]),
    findings: [finding("ffff000001", { round: undefined })],
  },
  "no-findings": { state: state([round(1)]), findings: [] },
  "needs-judgment": {
    state: state([round(1, { findings: 5, newFindings: 5 }), round(2)], { status: "open" }),
    findings: [
      finding("1111000001", { severity: "blocker", status: "open" }),
      finding("1111000002", { severity: "fix", status: "not-repeated" }),
      finding("1111000003", { severity: "fix", status: "open", verdict: wrong("The cache is cleared on line 40, so the stale read cannot happen.") }),
      finding("1111000004", { severity: "blocker", status: "open", verdict: wrong("") }),
      finding("1111000005", { severity: "fix", status: "probably-fixed", verdict: { verdict: "partial", reason: "Fixed for the API, still wrong in the CLI." } }),
      finding("1111000006", { severity: "consider", status: "open" }),
    ],
  },
  "stopped-at-budget": {
    state: state([round(1, { newFindings: 2, findings: 2 }), round(2, { findings: 2 })], { status: "open", maxRounds: 2 }),
    findings: [finding("2222000001", { severity: "blocker", status: "open" }), finding("2222000002", { status: "open" })],
  },
  escaping: {
    state: state([round(1, { newFindings: 1, findings: 1 })], { status: "open" }),
    findings: [
      finding("3333000001", {
        severity: "blocker",
        status: "open",
        title: "Pipe | in <b>title</b>, a --> comment and @someone\nover two lines </details>",
        path: "src/a|b.ts",
      }),
    ],
    agent: "Agent <x> | y",
  },
};

describe("the summary against its golden files", () => {
  for (const [name, input] of Object.entries(CASES)) {
    test(name, () => {
      const file = join(GOLDEN, `${name}.md`);
      const out = renderSummary(input);
      if (process.env.UPDATE_GOLDEN === "1") {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, out);
      }
      expect(existsSync(file)).toBe(true);
      expect(out).toBe(readFileSync(file, "utf8"));
    });
  }
});

describe("the summary's shape", () => {
  test("it starts with the kind-tagged marker, which the kind constant alone decides", () => {
    expect(SUMMARY_KIND).toBe("local");
    expect(SUMMARY_MARKER).toBe("<!-- wachiman-review-summary:local -->");
    for (const input of Object.values(CASES)) expect(renderSummary(input).split("\n")[0]).toBe(SUMMARY_MARKER);
  });

  test("the same state gives the same text", () => {
    for (const input of Object.values(CASES)) expect(renderSummary(input)).toBe(renderSummary(structuredClone(input)));
  });

  test("a missing cost is never counted as zero, and the rounds without data are named", () => {
    const out = renderSummary(CASES["partly-recorded"]);
    expect(out).toContain("| **Wachiman cost** | $1.50 API-equivalent, 11 min 17 s (not recorded for rounds 1-2) |");
    expect(renderSummary(CASES["v1-state"])).toContain("| **Wachiman cost** | not recorded |");
  });

  test("a code span in a title keeps its angle brackets; the text around it is still escaped", () => {
    const out = renderSummary({ state: state([round(1)]), findings: [finding("f1", { title: "`gh pr list --head <branch>` matches a | b and @user <b>" })] });
    expect(out).toContain("| `src/a.ts:2` `gh pr list --head <branch>` matches a \\| b and @&#8203;user &lt;b&gt; |");
    expect(out).not.toContain("&lt;branch&gt;");
  });

  test("a pipe inside a code span is escaped for the table, and an unclosed backtick leaves plain escaped text", () => {
    const out = renderSummary({
      state: state([round(1)]),
      findings: [finding("f1", { title: "`a | b` ok" }), finding("f2", { title: "a ` b <i> | c" })],
    });
    expect(out).toContain("`src/a.ts:2` `a \\| b` ok |");
    expect(out).toContain("`src/a.ts:2` a ` b &lt;i&gt; \\| c |");
  });

  test("no findings table and Findings is 0 when nothing was found", () => {
    const out = renderSummary(CASES["no-findings"]);
    expect(out).toContain("| **Findings** | 0 |");
    expect(out).not.toContain("| id | round | severity |");
    expect(out).not.toContain("Needs your judgment");
  });

  test("a model's text cannot add a mention, a tag, a comment or a table cell", () => {
    const out = renderSummary(CASES.escaping);
    expect(out).not.toContain("</details>\n |");
    expect(out.match(/<\/details>/g)).toHaveLength(1);
    expect(out).not.toContain("@someone");
    expect(out).not.toContain("--> comment");
    expect(out).not.toContain("<b>");
    expect(out.split("\n").filter((l) => l.startsWith("| `3333000001`"))).toHaveLength(1);
  });

  test("the ranges of consecutive rounds meet: each starts where the one before ended", () => {
    const out = renderSummary({ state: state([round(1), round(2), round(3)]), findings: [] });
    expect(out).toContain(`\`${sha(0).slice(0, 7)}..${sha(1).slice(0, 7)}\``);
    expect(out).toContain(`\`${sha(1).slice(0, 7)}..${sha(2).slice(0, 7)}\``);
    expect(out).toContain(`\`${sha(2).slice(0, 7)}..${sha(3).slice(0, 7)}\``);
    expect(out).toContain(`| **Reviewed** | \`${sha(0).slice(0, 7)}..${sha(3).slice(0, 7)}\` |`);
  });
});

describe("the small formatters", () => {
  test.each([
    [0, "0 s"],
    [41_600, "42 s"],
    [60_000, "1 min 00 s"],
    [677_000, "11 min 17 s"],
    [3_720_000, "1 h 02 min"],
  ])("duration %p ms is %p", (ms, text) => expect(duration(ms)).toBe(text));

  test.each([
    [[3], "round 3"],
    [[1, 2, 3, 4], "rounds 1-4"],
    [[1, 2, 4], "rounds 1-2, 4"],
  ])("roundsText %p is %p", (rounds, text) => expect(roundsText(rounds)).toBe(text));

  test("a model id reads as its name, and an unknown id stays as it is", () => {
    expect(modelName("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelName("claude-haiku-5-5-20261101")).toBe("Claude Haiku 5.5");
    expect(modelName("gpt-6.1-sol")).toBe("gpt-6.1-sol");
  });
});
