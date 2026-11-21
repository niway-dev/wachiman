import { describe, expect, test } from "bun:test";
import type { Finding, ReviewFile, ReviewOutput } from "../engine";
import type { ResultVerificationV2 } from "../formats";
import type { RiskMap } from "../risk";
import { contract, SHA, SINCE } from "./fixtures/views";
import { computeStatus } from "./status";
import { buildView, countFindingRows, type ViewInput } from "./view";

const finding = (over: Partial<Finding> & Record<string, unknown> = {}) => ({
  path: "src/a.ts",
  line: 3,
  severity: "fix" as const,
  topic: "bug" as const,
  confidence: "high" as const,
  title: "a title",
  body: "a body",
  ...over,
});

const file = (filename: string): ReviewFile => ({ filename, additions: 1, deletions: 0 });

const input = (over: Partial<ViewInput> & { findings?: ReturnType<typeof finding>[]; output?: Partial<ReviewOutput> } = {}): ViewInput => {
  const { findings = [], output, ...rest } = over;
  const files = rest.files ?? [file("src/a.ts"), file("src/b.ts")];
  return {
    output: {
      files_reviewed: files.map((f) => f.filename),
      files_skipped: [],
      findings,
      thread_replies: [],
      summary: "Looks fine.",
      ...output,
    },
    files,
    headSha: SHA,
    since: null,
    scoped: false,
    footer: { costLine: "<sub>m via c · $0.10</sub>", markers: ["<!-- wachi:review -->"] },
    ...rest,
  } as ViewInput;
};

const riskMap = (over: Partial<RiskMap> = {}): RiskMap => ({
  level: "medium",
  floor: false,
  facts: [],
  judgement: [],
  pathReasons: [],
  readFirst: [],
  unreadFiles: 0,
  droppedFacts: 0,
  ...over,
});

describe("buildView: where each finding goes", () => {
  test("a Blocker or Fix of this pull request goes to To fix, with its thread, whatever its anchor", () => {
    const view = buildView(
      input({
        findings: [
          finding({ severity: "fix", anchor: "diff", title: "on a line" }),
          finding({ severity: "blocker", anchor: "outside", title: "off the diff", path: "src/b.ts" }),
        ],
      }),
    );
    expect(view.findings.toFix.map((r) => [r.title, r.inlineThread, r.outsideDiff])).toEqual([
      ["off the diff", false, true],
      ["on a line", true, false],
    ]);
  });

  test("without an anchor, the file's commentable lines decide", () => {
    const view = buildView(
      input({
        findings: [finding({ line: 3 }), finding({ line: 9, title: "far" })],
        commentable: new Map([["src/a.ts", new Set([3])]]),
      }),
    );
    expect(view.findings.toFix.map((r) => [r.line, r.inlineThread, r.outsideDiff])).toEqual([
      [3, true, false],
      [9, false, true],
    ]);
  });

  test("Consider goes to To consider; Info goes to For your information and never has a thread", () => {
    const view = buildView(
      input({
        findings: [
          finding({ severity: "consider", anchor: "diff" }),
          finding({ severity: "info", anchor: "diff", title: "fyi" }),
        ],
      }),
    );
    expect(view.findings.consider).toHaveLength(1);
    expect(view.findings.consider[0].inlineThread).toBe(true);
    expect(view.findings.info.map((r) => [r.title, r.inlineThread, r.outsideDiff, r.priority])).toEqual([["fyi", false, false, "fyi"]]);
  });

  test("a pre-existing finding goes to its own slot, of any severity but Info, with no thread", () => {
    const view = buildView(
      input({
        findings: [
          finding({ severity: "fix", origin: "pre-existing", anchor: "diff" }),
          finding({ severity: "consider", origin: "pre-existing" }),
          finding({ severity: "info", origin: "pre-existing", title: "fyi" }),
        ],
      }),
    );
    expect(view.findings.preExisting.map((r) => r.severity)).toEqual(["fix", "consider"]);
    expect(view.findings.preExisting.every((r) => !r.inlineThread && !r.outsideDiff)).toBe(true);
    expect(view.findings.info.map((r) => r.title)).toEqual(["fyi"]);
    expect(view.findings.toFix).toEqual([]);
  });

  test("an inconclusive Blocker or Fix goes to Needs investigation; one the verifier never reached stays in To fix", () => {
    const view = buildView(
      input({
        findings: [
          finding({ severity: "blocker", verification: { status: "inconclusive", reason: "x", checked: [] }, title: "settled by nobody" }),
          finding({ severity: "fix", verification: { status: "inconclusive", reason: "not verified: budget", checked: [], unreached: true }, title: "never reached" }),
          finding({ severity: "consider", verification: { status: "inconclusive", reason: "x", checked: [] }, title: "a nit" }),
        ],
      }),
    );
    expect(view.findings.investigate.map((r) => r.title)).toEqual(["settled by nobody"]);
    expect(view.findings.toFix.map((r) => r.title)).toEqual(["never reached"]);
    expect(view.findings.consider.map((r) => r.title)).toEqual(["a nit"]);
  });

  test("a row carries severity, priority word, topic, confidence, origin, title, line and the model's raw body", () => {
    const [r] = buildView(input({ findings: [finding({ severity: "blocker", topic: "security", confidence: "low", title: "x | y", body: "line one\nline two", priority: "could" })] })).findings.toFix;
    expect(r).toMatchObject({ severity: "blocker", priority: "could", topic: "security", confidence: "low", origin: "unknown", line: 3, title: "x | y", body: "line one\nline two", path: "src/a.ts" });
  });

  test("a result written before priority existed is priced on the fly", () => {
    const [r] = buildView(input({ findings: [finding({ severity: "blocker" })] })).findings.toFix;
    expect(r.priority).toBe("must");
  });

  test("To fix lists Blockers first and keeps the engine's order otherwise", () => {
    const view = buildView(input({ findings: [finding({ title: "fix 1" }), finding({ severity: "blocker", title: "blocker" }), finding({ title: "fix 2" })] }));
    expect(view.findings.toFix.map((r) => r.title)).toEqual(["blocker", "fix 1", "fix 2"]);
  });
});

describe("buildView: counts and the glance table add up", () => {
  const view = buildView(
    input({
      findings: [
        finding({ severity: "blocker" }),
        finding({ severity: "fix" }),
        finding({ severity: "consider" }),
        finding({ severity: "consider" }),
        finding({ severity: "info" }),
        finding({ severity: "fix", origin: "pre-existing" }),
        finding({ severity: "fix", verification: { status: "inconclusive", reason: "x", checked: [] } }),
      ],
    }),
  );

  test("the total is this pull request's findings, Info included; the other origins come after it", () => {
    const counts = countFindingRows(view.findings);
    expect(counts).toMatchObject({ blockers: 1, fixes: 1, considers: 2, info: 1, total: 5, preExisting: 1, preExistingDemanding: 1, investigate: 1 });
    expect(counts.total).toBe(counts.blockers + counts.fixes + counts.considers + counts.info);
    expect(Object.values(counts.byPriority).reduce((a, b) => a + b, 0)).toBe(counts.total);
  });

  test("the first glance row is the Findings row with those counts", () => {
    expect(view.glance[0]).toMatchObject({ key: "findings", total: 5, preExisting: 1, investigate: 1 });
  });
});

describe("buildView: the glance rows", () => {
  test("a bare review has Findings and Coverage; no Risk, Needs a person, Earlier threads or Read first", () => {
    const view = buildView(input());
    expect(view.glance.map((g) => g.key)).toEqual(["findings", "coverage"]);
    expect(view.glance[1]).toEqual({ key: "coverage", reviewed: 2, total: 2, scope: "whole" });
  });

  test("with a risk map: Risk with its top reason, Needs a person only when there is one, Read first", () => {
    const view = buildView(
      input({
        riskMap: riskMap({
          level: "high",
          facts: [{ kind: "auth", path: "src/a.ts", line: 3, why: "changes who may log in" }],
          judgement: [{ kind: "tradeoff", path: "src/b.ts", line: 2, why: "a person decides" }],
          readFirst: ["src/a.ts"],
        }),
      }),
    );
    expect(view.glance.map((g) => g.key)).toEqual(["findings", "risk", "needsPerson", "coverage", "readFirst"]);
    expect(view.glance[1]).toMatchObject({ key: "risk", level: "high", topReason: "changes who may log in" });
    expect(view.glance[2]).toMatchObject({ key: "needsPerson", count: 1, kinds: ["tradeoff"] });
    expect(buildView(input({ riskMap: riskMap() })).glance.map((g) => g.key)).toEqual(["findings", "risk", "coverage"]);
  });

  test("the Earlier threads row shows on a re-review, or whenever there are threads or they could not be counted", () => {
    const keys = (over: Partial<ViewInput>) => buildView(input(over)).glance.map((g) => g.key);
    expect(keys({})).not.toContain("earlierThreads");
    expect(keys({ earlierThreads: 2 })).toContain("earlierThreads");
    expect(keys({ earlierThreads: "unknown" })).toContain("earlierThreads");
    expect(keys({ since: SINCE })).toContain("earlierThreads");
  });

  test("PR Confidence is a row when the pull request was graded", () => {
    const fidelity = { grade: "B", trial: true, reasons: ["one claim has no evidence"] } as unknown as ViewInput["fidelity"];
    const row = buildView(input({ fidelity })).glance.find((g) => g.key === "confidence");
    expect(row).toEqual({ key: "confidence", grade: "B", trial: true, reasons: ["one claim has no evidence"] });
  });
});

describe("buildView: display paths (decision 19, S7)", () => {
  test("findings in src/init/run.ts and src/setup/run.ts show init/run.ts and setup/run.ts", () => {
    const view = buildView(
      input({
        files: [file("src/init/run.ts"), file("src/setup/run.ts")],
        findings: [finding({ path: "src/init/run.ts", line: 10 }), finding({ path: "src/setup/run.ts", line: 20 }), finding({ path: "src/engine.ts", line: 1 })],
      }),
    );
    expect(view.findings.toFix.map((r) => r.location)).toEqual(["init/run.ts:10", "setup/run.ts:20", "engine.ts:1"]);
    expect(view.findings.toFix[0].path).toBe("src/init/run.ts");
  });

  test("the rule runs across slots: a finding and a needs-a-person item share one table of names", () => {
    const view = buildView(
      input({
        findings: [finding({ path: "src/init/run.ts", line: 10 })],
        riskMap: riskMap({
          judgement: [{ kind: "direction", path: "src/setup/run.ts", line: 4, why: "w" }],
          facts: [{ kind: "auth", path: "lib/init/run.ts", line: 5, why: "w" }],
        }),
      }),
    );
    expect(view.findings.toFix[0].location).toBe("src/init/run.ts:10");
    expect(view.needsPerson[0].location).toBe("setup/run.ts:4");
    expect(view.risk?.facts[0].location).toBe("lib/init/run.ts:5");
  });

  test("a finding about the whole file has no line in its location", () => {
    expect(buildView(input({ findings: [finding({ line: 0 })] })).findings.toFix[0].location).toBe("a.ts");
  });
});

describe("buildView: coverage, partial and scope", () => {
  test("files not reviewed are grouped by reason, in the order of the pull request's files, with the count of each", () => {
    const files = ["a", "b", "c", "d", "e"].map((n) => file(`src/${n}.ts`));
    const view = buildView(
      input({
        files,
        output: {
          files_reviewed: ["src/a.ts"],
          files_skipped: [
            { path: "src/b.ts", reason: "not reached: the pull request's budget was spent" },
            { path: "src/c.ts", reason: "not reached: the call ran out of its budget" },
            { path: "src/d.ts", reason: "not reached: the pull request's budget was spent" },
          ],
        },
      }),
    );
    expect(view.files).toMatchObject({ total: 5, reviewed: 1 });
    expect(view.files.notReviewed).toEqual([
      { reason: "not reached: the pull request's budget was spent", paths: ["src/b.ts", "src/d.ts"] },
      { reason: "not reached: the call ran out of its budget", paths: ["src/c.ts"] },
      { reason: "", paths: ["src/e.ts"] },
    ]);
    expect(view.files.notReviewed.reduce((n, g) => n + g.paths.length, 0)).toBe(view.files.total - view.files.reviewed);
    expect(computeStatus(view).lead).toBe("Partial: 4 of 5 files not reviewed");
  });

  test("a file that came back not reviewed after an earlier try is named as tried twice, unless it was never reached", () => {
    const files = ["a", "b", "c"].map((n) => file(`src/${n}.ts`));
    const base = { files, output: { files_reviewed: [], files_skipped: [{ path: "src/a.ts", reason: "not reached: budget" }, { path: "src/b.ts", reason: "the call failed" }] }, tried: ["src/a.ts", "src/b.ts", "src/c.ts"] };
    expect(buildView(input(base)).files.notReviewedTwice).toEqual(["src/b.ts", "src/c.ts"]);
    expect(buildView(input({ ...base, scoped: true })).files.notReviewedTwice).toEqual([]);
  });

  test("scope: whole, since, after a rebase, with the head and the carried files", () => {
    expect(buildView(input()).scope).toEqual({ kind: "whole", since: null, head: SHA, carried: 0, commits: [] });
    expect(buildView(input({ since: SINCE })).scope.kind).toBe("since");
    expect(buildView(input({ since: SINCE, rebased: true })).scope.kind).toBe("rebase");
    expect(buildView(input({ since: SINCE, carried: ["src/a.ts", "gone.ts"] })).scope.carried).toBe(1);
    expect(buildView(input({ since: SINCE, commits: ["c1", "c2"] })).scope.commits).toEqual(["c1", "c2"]);
  });

  test("the memory notices the engine appends to the summary are split from the model's prose", () => {
    const notice = "**Muted by memory** (not posted as comments; each was matched by an exception the owner approved):\n- x (`a.ts:1`): muted by entry `e1`";
    const stale = "ℹ️ **Memory entry `e1` may be out of date** (\"t\"): its `holds while` paths are touched by this diff (a.ts).";
    const view = buildView(input({ output: { summary: `Prose one.\n\nProse two.\n\n${stale}\n\n${notice}` } }));
    expect(view.batchProse).toBe("Prose one.\n\nProse two.");
    expect(view.memoryNotices).toBe(`${stale}\n\n${notice}`);
    expect(buildView(input({ output: { summary: "Only prose." } })).memoryNotices).toBe("");
    expect(buildView(input({ output: { summary: notice } })).batchProse).toBe("");
  });

  test("the row's tier word and the arm, mention and repo pass through", () => {
    const view = buildView(input({ arm: "word", mention: "/w", repo: "o/r", output: { findings: [{ path: "a.ts", line: 1, severity: "fix", topic: "bug", title: "t", body: "b", anchor: "diff" }] } }));
    expect(view.findings.toFix[0].tier).toBe("Important");
    expect([view.arm, view.mention, view.repo]).toEqual(["word", "/w", "o/r"]);
    expect(buildView(input()).arm).toBe("priority");
  });

  test("coverage rows, the estimate flag, the prose and the notices pass through", () => {
    const batches = [{ label: "batch 1", files: 2, lines: 40, maxRisk: 3, status: "reviewed", turns: 5, costUsd: 0.1 }];
    const view = buildView(input({ batches, estimate: true, instructionChanges: { files: ["REVIEW.md"], baseSha: SINCE }, pathPolicyChange: { baseSha: SINCE }, unreviewable: [{ path: "x.png", reason: "binary" }] }));
    expect(view.coverage).toEqual({ rows: batches, estimate: true });
    expect(view.batchProse).toBe("Looks fine.");
    expect(view.notices).toEqual({ instructionChanges: { files: ["REVIEW.md"], baseSha: SINCE }, pathPolicyChange: { baseSha: SINCE } });
    expect(view.files.notReviewable).toEqual([{ path: "x.png", reason: "binary" }]);
    expect(buildView(input({ instructionChanges: { files: [], baseSha: SINCE } })).notices).toEqual({});
  });

  test("contracts are split into open and closed", () => {
    const view = buildView(input({ output: { contracts: [contract("open"), contract("closed"), contract("open")] } }));
    expect([view.contracts.open.length, view.contracts.closed.length]).toEqual([2, 1]);
  });
});

describe("buildView: the verifier", () => {
  const record = (over: Partial<ResultVerificationV2>): ResultVerificationV2 => ({ status: "verified", model: "m", effort: "high", costUsd: 0.1, entries: [], dropped: 0, inconclusive: 0, ...over });
  const entry = (unreached: boolean) => ({ id: "c", path: "a", line: 1, title: "t", topic: "bug", severity: "fix", status: "inconclusive", origin: "unknown", reason: "r", checked: [], outcome: "kept", ...(unreached ? { unreached: true } : {}) }) as ResultVerificationV2["entries"][number];

  test("no verifier is 'none'", () => {
    expect(buildView(input()).verifier).toEqual({ status: "none", notChecked: 0 });
  });

  test("a partial verifier counts the findings it never reached, and says why it stopped", () => {
    const view = buildView(input({ verification: record({ status: "partial", stop: { kind: "budget", detail: "x" }, entries: [entry(true), entry(false), entry(true)] }) }));
    expect(view.verifier).toEqual({ status: "partial", stop: "budget", notChecked: 2 });
  });

  test("a failed verifier with no record checked none of the findings it was asked about", () => {
    const view = buildView(input({ verification: record({ status: "failed" }), findings: [finding(), finding({ severity: "info" }), finding({ severity: "consider" })] }));
    expect(view.verifier.notChecked).toBe(2);
  });
});

describe("buildView: the footer and the earlier threads", () => {
  test("the receipt, the cost line and the markers are passed through unchanged", () => {
    const footer = { receipt: "<!-- wachi:receipt abc.def -->", costLine: "<sub>m via c · this run $0.10</sub>", markers: ["<!-- wachi:auto -->", "<!-- wachi:review -->", "<!-- wachiman sha=abc -->"] };
    expect(buildView(input({ footer })).footer).toBe(footer);
  });

  test("earlier threads default to none, and unknown stays unknown", () => {
    expect(buildView(input()).earlierThreads).toBe(0);
    expect(buildView(input({ earlierThreads: "unknown" })).earlierThreads).toBe("unknown");
  });
});

describe("buildView and computeStatus together", () => {
  test("a re-review with no new Fix but an open earlier thread is never clean", () => {
    const view = buildView(input({ since: SINCE, earlierThreads: 1 }));
    expect(computeStatus(view).lead).not.toBe("Wachiman found nothing to fix");
    expect(computeStatus(view).mode).toBe(7);
  });

  test("a review of the #281 shape, with one open question and nothing else, leads with the question", () => {
    const view = buildView(input({ output: { contracts: [contract("open")] } }));
    expect(computeStatus(view).lead).toBe("1 question for you");
  });
});
