/** The grade table of ADR 0033 / spec section 3: first matching row wins. Pure, no model. */
import { describe, expect, test } from "bun:test";
import { KIND_LEVEL, buildRiskMap } from "../risk";
import { FACT_LEVEL, buildFidelity, computeGrade, groupByFile, trialBound, type GradeInput } from "./grade";
import type { Claim, OpenFinding } from "./types";

const confirmed = (text: string, path: string): Claim => ({
  text,
  status: "confirmed",
  evidence: [{ path, line: 10, endLine: 20 }],
});

const lowMap = { level: "low", facts: [], judgement: [], pathReasons: [], droppedFacts: 0 } as const;

/** Two confirmed claims, each with its file, a finished run, a low risk map: an A. */
function input(over: Partial<GradeInput> = {}): GradeInput {
  return {
    claims: [confirmed("Adds an export button", "src/Toolbar.tsx"), confirmed("Adds an export function", "src/export.ts")],
    assignments: [
      { path: "src/Toolbar.tsx", claim: 0 },
      { path: "src/export.ts", claim: 1 },
    ],
    changedFiles: [{ path: "src/Toolbar.tsx" }, { path: "src/export.ts" }],
    openFindings: [],
    riskMap: lowMap,
    run: {
      finished: true,
      unreadFiles: 0,
      reviewedCommit: "abc1234",
      headCommit: "abc1234",
      digestAtRead: "d1",
      digestAtWrite: "d1",
    },
    ...over,
  };
}

const withRun = (run: Partial<GradeInput["run"]>): GradeInput => {
  const base = input();
  return { ...base, run: { ...base.run, ...run } };
};

const finding = (severity: OpenFinding["severity"], over: Partial<OpenFinding> = {}): OpenFinding => ({
  severity,
  path: "src/export.ts",
  line: 12,
  title: "Something",
  ...over,
});

const fact = (kind: "money" | "auth" | "concurrency" | "dependency", path = "src/export.ts", line = 12) => ({
  kind,
  path,
  line,
  why: `${kind} here`,
});

describe("the acceptance fixtures", () => {
  test("two confirmed claims and one file no claim explains give B and name that file", () => {
    const r = computeGrade(
      input({ changedFiles: [{ path: "src/Toolbar.tsx" }, { path: "src/export.ts" }, { path: "src/session.ts" }] }),
    );
    expect(r.grade).toBe("B");
    expect(r.unexplainedFiles).toEqual(["src/session.ts"]);
    expect(r.reasons[0]).toBe("One unexplained change");
    expect(r.questions.map((q) => q.path)).toContain("src/session.ts");
    expect(r.trial).toBe(false);
  });

  test("the same fixture without that file gives A marked trial", () => {
    const r = computeGrade(input());
    expect(r.grade).toBe("A");
    expect(r.trial).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.unexplainedFiles).toEqual([]);
  });

  test("a title and body that name nothing checkable give C with the stated reason", () => {
    const vague: Claim = { text: "Improves things", status: "vague", evidence: [] };
    const r = computeGrade(input({ claims: [vague], assignments: [{ path: "src/export.ts", claim: 0 }] }));
    expect(r.grade).toBe("C");
    expect(r.reasons[0]).toBe("The pull request does not say what it changes");
  });

  test("no claim at all gives the same C", () => {
    const r = computeGrade(input({ claims: [], assignments: [] }));
    expect(r.grade).toBe("C");
    expect(r.reasons).toEqual(["The pull request does not say what it changes"]);
  });

  test("a money risk fact gives at most B, built through the real risk map", () => {
    const riskMap = buildRiskMap({
      files: [{ path: "src/export.ts", changedLines: 5 }],
      facts: [fact("money")],
      judgement: [],
      unreadFiles: 0,
      lineExists: () => true,
    });
    expect(riskMap.level).toBe("high");
    const r = computeGrade(input({ riskMap }));
    expect(r.grade).toBe("B");
    expect(r.trial).toBe(false);
  });

  test("a money fact caps at B even if the map's own level was left low", () => {
    const r = computeGrade(input({ riskMap: { ...lowMap, facts: [fact("money")] } }));
    expect(r.grade).toBe("B");
  });

  test("a run stopped by the spend ceiling gives cannot say", () => {
    const r = computeGrade(withRun({ finished: false, stoppedBy: "spend-ceiling" }));
    expect(r.grade).toBe("cannot say");
    expect(r.reasons).toEqual(["The run stopped at the spend ceiling"]);
    expect(r.trial).toBe(false);
  });
});

describe("cannot say", () => {
  test("a run that did not finish", () => {
    const r = computeGrade(withRun({ finished: false }));
    expect(r.grade).toBe("cannot say");
    expect(r.reasons).toEqual(["The run did not finish"]);
  });

  test("a run stopped by the depth cap", () => {
    const r = computeGrade(withRun({ finished: false, stoppedBy: "depth-cap" }));
    expect(r.grade).toBe("cannot say");
    expect(r.reasons).toEqual(["The run stopped at the depth cap"]);
  });

  test("a stop reason wins even when the run says it finished", () => {
    expect(computeGrade(withRun({ stoppedBy: "spend-ceiling" })).grade).toBe("cannot say");
  });

  test("files left unread", () => {
    expect(computeGrade(withRun({ unreadFiles: 1 })).reasons).toEqual(["One file was not read"]);
    expect(computeGrade(withRun({ unreadFiles: 3 })).reasons).toEqual(["3 files were not read"]);
    expect(computeGrade(withRun({ unreadFiles: 3 })).grade).toBe("cannot say");
  });

  test("the review of a new commit has not finished", () => {
    const r = computeGrade(withRun({ headCommit: "def5678" }));
    expect(r.grade).toBe("cannot say");
    expect(r.reasons).toEqual(["The review of the new commit has not finished"]);
  });

  test("the author's text changed between the read and the write", () => {
    const r = computeGrade(withRun({ digestAtWrite: "d2" }));
    expect(r.grade).toBe("cannot say");
    expect(r.reasons).toEqual(["The pull request text changed while the review was running"]);
  });

  test("lists every reason that applies", () => {
    const r = computeGrade(withRun({ unreadFiles: 2, digestAtWrite: "d2" }));
    expect(r.reasons).toEqual(["2 files were not read", "The pull request text changed while the review was running"]);
  });
});

describe("first matching row wins", () => {
  test("cannot say beats C: no claim and a spend ceiling is cannot say", () => {
    const r = computeGrade({ ...withRun({ finished: false, stoppedBy: "spend-ceiling" }), claims: [], assignments: [] });
    expect(r.grade).toBe("cannot say");
    expect(r.reasons).not.toContain("The pull request does not say what it changes");
  });

  test("cannot say beats a Blocker, a contradiction and high risk", () => {
    const r = computeGrade({
      ...withRun({ unreadFiles: 1 }),
      openFindings: [finding("blocker")],
      riskMap: { ...lowMap, facts: [fact("money")] },
    });
    expect(r.grade).toBe("cannot say");
  });

  test("C beats B: a contradicted claim with an unexplained file is C", () => {
    const r = computeGrade(
      input({
        claims: [{ text: "Adds an export button", status: "contradicted", evidence: [{ path: "src/Toolbar.tsx", line: 3 }] }],
        assignments: [],
        changedFiles: [{ path: "src/Toolbar.tsx" }],
      }),
    );
    expect(r.grade).toBe("C");
  });

  test("B beats A-: a Fix with a medium fact is B", () => {
    const r = computeGrade(input({ openFindings: [finding("fix")], riskMap: { ...lowMap, facts: [fact("concurrency")] } }));
    expect(r.grade).toBe("B");
  });

  test("a Blocker with high risk is C, not B", () => {
    expect(computeGrade(input({ openFindings: [finding("blocker")], riskMap: { ...lowMap, level: "high" } })).grade).toBe("C");
  });
});

describe("C", () => {
  test("a contradicted claim, named in the reason and at its evidence", () => {
    const r = computeGrade(
      input({
        claims: [
          confirmed("Adds an export button", "src/Toolbar.tsx"),
          { text: "Keeps the old timeout", status: "contradicted", evidence: [{ path: "src/session.ts", line: 40 }] },
        ],
      }),
    );
    expect(r.grade).toBe("C");
    expect(r.reasons).toEqual(["Claim contradicted: Keeps the old timeout"]);
    expect(r.questions).toContainEqual({
      kind: "contradicted-claim",
      path: "src/session.ts",
      line: 40,
      text: "claim contradicted: Keeps the old timeout",
    });
  });

  test("open Blockers, counted", () => {
    const r = computeGrade(input({ openFindings: [finding("blocker"), finding("blocker", { line: 30 })] }));
    expect(r.grade).toBe("C");
    expect(r.reasons).toEqual(["2 open Blockers"]);
    expect(computeGrade(input({ openFindings: [finding("blocker")] })).reasons).toEqual(["One open Blocker"]);
  });

  test("a vague claim next to a confirmed one is ignored, not a reason for C", () => {
    const r = computeGrade(input({ claims: [...input().claims, { text: "Cleans up", status: "vague", evidence: [] }] }));
    expect(r.grade).toBe("A");
  });
});

describe("B", () => {
  test("an unverified claim", () => {
    const r = computeGrade(
      input({ claims: [confirmed("Adds an export button", "src/Toolbar.tsx"), { text: "Is faster", status: "unverified", evidence: [] }] }),
    );
    expect(r.grade).toBe("B");
    expect(r.reasons).toEqual(["Claim not verified: Is faster"]);
  });

  test("an open Fix", () => {
    const r = computeGrade(input({ openFindings: [finding("fix")] }));
    expect(r.grade).toBe("B");
    expect(r.reasons).toEqual(["One open Fix"]);
    expect(computeGrade(input({ openFindings: [finding("fix"), finding("fix", { line: 2 })] })).reasons).toEqual(["2 open Fixes"]);
  });

  test("a risk level of high from the map, with the facts that set it", () => {
    const r = computeGrade(input({ riskMap: { ...lowMap, level: "high", facts: [fact("auth")] } }));
    expect(r.grade).toBe("B");
    expect(r.reasons).toEqual(["The risk level is high: auth"]);
  });

  test("a high level that comes from a path rule alone has no fact to name", () => {
    const r = computeGrade(input({ riskMap: { ...lowMap, level: "high", pathReasons: [{ path: "src/auth.ts", why: "auth code" }] } }));
    expect(r.grade).toBe("B");
    expect(r.reasons).toEqual(["The risk level is high"]);
    expect(r.sensitivePaths).toEqual(["src/auth.ts"]);
  });

  test("lists every reason of the row, in a fixed order", () => {
    const r = computeGrade(
      input({
        claims: [{ text: "Is faster", status: "unverified", evidence: [] }],
        changedFiles: [{ path: "src/session.ts" }],
        assignments: [],
        openFindings: [finding("fix")],
        riskMap: { ...lowMap, level: "high", facts: [fact("money")] },
      }),
    );
    expect(r.reasons).toEqual([
      "Claim not verified: Is faster",
      "One unexplained change",
      "One open Fix",
      "The risk level is high: money",
    ]);
  });

  test("B is not a trial grade", () => {
    expect(computeGrade(input({ openFindings: [finding("fix")] })).trial).toBe(false);
  });
});

describe("A-", () => {
  test("a medium risk fact", () => {
    const r = computeGrade(input({ riskMap: { ...lowMap, level: "medium", facts: [fact("concurrency")] } }));
    expect(r.grade).toBe("A-");
    expect(r.reasons).toEqual(["One medium-risk fact"]);
    expect(r.trial).toBe(true);
  });

  test("a dropped risk fact lowers A to A-", () => {
    const r = computeGrade(input({ riskMap: { ...lowMap, droppedFacts: 2 } }));
    expect(r.grade).toBe("A-");
    expect(r.reasons).toEqual(["2 risk facts could not be placed in the change"]);
  });

  test("a place that needs a person", () => {
    const r = computeGrade(
      input({ riskMap: { ...lowMap, judgement: [{ kind: "tradeoff", path: "src/export.ts", line: 5, why: "which format" } as never] } }),
    );
    expect(r.grade).toBe("A-");
    expect(r.reasons).toEqual(["One place needs a person"]);
    expect(r.questions).toContainEqual({
      kind: "judgement",
      path: "src/export.ts",
      line: 5,
      text: "needs a person (tradeoff): which format",
    });
  });

  test("an open Consider", () => {
    const r = computeGrade(input({ openFindings: [finding("consider"), finding("consider", { line: 3 })] }));
    expect(r.grade).toBe("A-");
    expect(r.reasons).toEqual(["2 open Consider findings"]);
  });

  test("a low-level fact such as a dependency is listed nowhere and lowers nothing", () => {
    const r = computeGrade(input({ riskMap: { ...lowMap, facts: [fact("dependency")] } }));
    expect(r.grade).toBe("A");
    expect(r.questions).toEqual([]);
    expect(r.sensitivePaths).toEqual([]);
  });

  test("an Info finding is a note and lowers nothing", () => {
    const r = computeGrade(input({ openFindings: [finding("info")] }));
    expect(r.grade).toBe("A");
    expect(r.questions).toEqual([]);
  });
});

describe("trial", () => {
  test("carries the count of judged A-graded pull requests, zero by default", () => {
    expect(computeGrade(input()).judgedAGrades).toBe(0);
    expect(computeGrade(input({ judgedAGrades: 12 })).judgedAGrades).toBe(12);
  });

  test("stays a trial for every A and A- however many were judged", () => {
    expect(computeGrade(input({ judgedAGrades: 100 })).trial).toBe(true);
    expect(computeGrade(input({ judgedAGrades: 100, openFindings: [finding("consider")] })).trial).toBe(true);
  });

  test("cannot say and C carry no trial marker", () => {
    expect(computeGrade(withRun({ unreadFiles: 1 })).trial).toBe(false);
    expect(computeGrade(input({ claims: [], assignments: [] })).trial).toBe(false);
  });

  test("the bound a run of clean judgements supports", () => {
    expect(trialBound(0)).toBeUndefined();
    expect(trialBound(30)).toBeCloseTo(0.095, 3);
    expect(trialBound(299)).toBeCloseTo(0.01, 3);
  });
});

describe("the places that need attention", () => {
  test("are grouped by file, each file once, ordered by path and line, with no cap", () => {
    const many = Array.from({ length: 40 }, (_, i) => finding("consider", { path: i % 2 ? "src/b.ts" : "src/a.ts", line: 100 - i }));
    const r = computeGrade(input({ openFindings: many }));
    expect(r.questions).toHaveLength(40);
    const groups = groupByFile(r.questions);
    expect(groups.map((g) => g.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(40);
    for (const g of groups) {
      const lines = g.items.map((i) => i.line ?? 0);
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
    }
  });

  test("a whole-file finding has no line", () => {
    const r = computeGrade(input({ openFindings: [finding("fix", { line: 0 })] }));
    expect(r.questions[0]?.line).toBeUndefined();
  });

  test("an unexplained file has no line and says why it is listed", () => {
    const r = computeGrade(input({ changedFiles: [{ path: "src/session.ts" }] , assignments: []}));
    expect(r.questions).toEqual([
      { kind: "unexplained", path: "src/session.ts", text: "no claim in the pull request explains this change." },
    ]);
  });

  test("a high-risk fact is listed where it is", () => {
    const r = computeGrade(input({ riskMap: { ...lowMap, level: "high", facts: [fact("auth", "src/login.ts", 8)] } }));
    expect(r.questions).toContainEqual({ kind: "risk-fact", path: "src/login.ts", line: 8, text: "auth: auth here" });
    expect(r.sensitivePaths).toEqual(["src/login.ts"]);
  });

  test("model text with markup is carried as given; the block renderer neutralises it", () => {
    const r = computeGrade(input({ openFindings: [finding("fix", { title: "a <b> @user" })] }));
    expect(r.questions[0]?.text).toContain("a <b> @user");
  });
});

describe("buildFidelity", () => {
  test("adds the claims, the digest the claims were read from and the commit", () => {
    const f = buildFidelity(input());
    expect(f.grade).toBe("A");
    expect(f.claims).toHaveLength(2);
    expect(f.digest).toBe("d1");
    expect(f.reviewedCommit).toBe("abc1234");
  });

  test("a cannot say fidelity still lists the claims it read, and its commit", () => {
    const f = buildFidelity(withRun({ finished: false, stoppedBy: "spend-ceiling" }));
    expect(f.grade).toBe("cannot say");
    expect(f.claims).toHaveLength(2);
  });
});

describe("FACT_LEVEL", () => {
  test("matches the risk map's own levels for every kind", () => {
    expect(FACT_LEVEL).toEqual(KIND_LEVEL);
  });
});
