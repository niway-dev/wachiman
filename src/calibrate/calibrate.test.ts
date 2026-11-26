import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GhError,
  inlineFindingBody,
  SIGNATURE,
  type Confidence as EngineConfidence,
  type Severity as EngineSeverity,
  type GhFn,
} from "../engine";
import { TABLE_V1 } from "../priority";
import {
  authorKind,
  classifyReply,
  classifyThread,
  decideThread,
  readFindings,
  type AuthorKind,
  type Confidence,
  type Outcome,
  type Severity,
} from "./outcomes";
import { calibrateUsage, parseCalibrateArgs, runCalibrate, type CalibrateArgs, type Judgement } from "./command";
import { hideWord, titleOf } from "./sample";

describe("classifyReply", () => {
  test.each([
    ["Fixed in 64198cf. The guard now runs first.", "fixed"],
    ["done", "fixed"],
    ["Addressed in the last commit", "fixed"],
    ["Applied the suggestion.", "fixed"],
    ["Declined: the retry is intentional.", "declined"],
    ["Keeping it as is, the loop needs it.", "declined"],
    ["This is by design.", "declined"],
    ["Won't fix, tracked in the backlog", "declined"],
    ["No change needed here", "declined"],
    ["Declined: the check is done elsewhere", "declined"],
    ["Fixed in abc1234. Not fixing the second half.", "fixed"],
    ["Verdict: wrong. The guard is two lines above.", "wrong"],
    ["**Verdict: wrong (false positive).** Fixed nothing.", "wrong"],
    ["Verdict: correct", "none"],
    ["Thanks, looking", "none"],
    ["Unfixed yet", "none"],
    ["", "none"],
    ["Out of scope here: `init` reading the config. Noted as a follow-up.", "declined"],
    ["On purpose: the retry is unbounded.", "declined"],
    ["Not changing the design: the engine owns the budget.", "declined"],
    ["Settled in the build: the engine clamps the value.", "fixed"],
    ["No longer applies: the rework removed the loop.", "declined"],
    ["As intended, the default stays.", "declined"],
    ["Kept as is for now.", "declined"],
    ["Resolved by the rename.", "fixed"],
    ["Updated the test to match.", "fixed"],
    ["Added in 250b5207: the missing guard.", "fixed"],
    ["Added both tests in da36037fb: one per branch.", "fixed"],
    ["Agreed: the docblock now says so.", "fixed"],
    ["Not changed here: the copy is the approved text.", "declined"],
    ["Verified: the call is guarded upstream.", "declined"],
    ["Confirmed: the default is intended.", "declined"],
    ["Checked against the spec; it matches.", "declined"],
    ["I re-read it and the claim holds, but the cost is fine.", "declined"],
    ["Unadded", "none"],
  ] as [string, Outcome][])("%s -> %s", (body, expected) => expect(classifyReply(body)).toBe(expected));

  test("only the first meaningful line counts", () => {
    expect(classifyReply("Looking into it.\nFixed in a1b2c3d.")).toBe("none");
  });

  const callout = "> [!NOTE]\n> 🤖 **Claude Sonnet 5.5 responding on behalf of Owner Name**\n\n";

  test("a callout header is skipped and marks the reply as an agent's", () => {
    const reply = `${callout}Out of scope here: \`init\` reading ... Noted as a follow-up.`;
    expect(classifyReply(reply)).toBe("declined");
    expect(decideThread([{ body: reply }])).toEqual({ outcome: "declined", kind: "agent" });
    expect(decideThread([{ body: "Fixed in abc1234." }])).toEqual({ outcome: "fixed", kind: "owner" });
    expect(decideThread([{ body: "Thanks" }])).toEqual({ outcome: "none" });
    expect(classifyReply(`${callout}Thanks, looking.`)).toBe("none");
  });

  test("the deciding reply sets the kind, not an earlier undecided one", () => {
    expect(decideThread([{ body: `${callout}Looking.` }, { body: "Fixed in abc" }])).toEqual({ outcome: "fixed", kind: "owner" });
  });

  test("the first decisive reply of a thread wins", () => {
    expect(classifyThread([{ body: "Thanks" }, { body: "Declined: by design" }, { body: "Fixed in abc" }])).toBe("declined");
    expect(classifyThread([])).toBe("none");
  });
});

describe("authorKind", () => {
  test.each([
    [{ body: "Fix the bug\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)", author: { login: "owner" } }, "agent"],
    [{ body: "Generated with Codex", author: { login: "owner" } }, "agent"],
    [{ body: "bump", author: { login: "dependabot[bot]" } }, "agent"],
    [{ body: "bump", author: { login: "app/renovate", is_bot: true } }, "agent"],
    [{ body: "A plain description", author: { login: "owner" } }, "owner"],
    [{ body: null, author: null }, "owner"],
  ] as [Parameters<typeof authorKind>[0], AuthorKind][])("%j -> %s", (pr, expected) => expect(authorKind(pr)).toBe(expected));
});

// ---- fixtures -----------------------------------------------------------------------------------

let nextId = 1000;
const finding = (severity: Severity, confidence: Confidence, title = "A finding", priorityOf?: "word" | "priority") =>
  `${inlineFindingBody({ path: "a.ts", line: 3, severity: severity as EngineSeverity, topic: "bug", confidence: confidence as EngineConfidence, title, body: "The body says you should check this." }, priorityOf ?? "priority")}\n\n${SIGNATURE.finding}`;

interface FakeComment {
  id: number;
  user: { login: string };
  body: string;
  in_reply_to_id?: number;
  path?: string;
  line?: number;
}
interface FakePr {
  number: number;
  body?: string;
  author?: string;
  comments: FakeComment[];
}

const root = (severity: Severity, confidence: Confidence, replies: string[] = [], title?: string): FakeComment[] => {
  const id = nextId++;
  return [
    { id, user: { login: "github-actions[bot]" }, body: finding(severity, confidence, title), path: "a.ts", line: 3 },
    ...replies.map((body) => ({ id: nextId++, user: { login: "owner" }, body, in_reply_to_id: id })),
  ];
};

const fakeGh =
  (prs: FakePr[]): GhFn =>
  (args) => {
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify(prs.map((p) => ({ number: p.number, body: p.body ?? "", author: { login: p.author ?? "owner" } })));
    }
    const match = args[3]?.match(/pulls\/(\d+)\/comments$/);
    if (args[0] === "api" && match) return JSON.stringify([prs.find((p) => p.number === Number(match[1]))!.comments]);
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };

const home = () => mkdtempSync(join(tmpdir(), "calibrate-"));
const run = (argv: string[], homeDir: string, gh: GhFn, now = new Date("2026-11-19T10:00:00Z")) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCalibrate(
    parseCalibrateArgs(argv),
    { WACHIMAN_HOME: homeDir },
    { stdout: (t) => out.push(t), stderr: (l) => err.push(l), now: () => now },
    gh,
  );
  return { code, out: out.join(""), err };
};

const CALLOUT = "> [!NOTE]\n> 🤖 **Claude Sonnet 5.5 responding on behalf of Owner Name**\n\n";

const reportFixture = (): FakePr[] => [
  {
    number: 1,
    author: "owner",
    comments: [
      ...root("consider", "medium", ["Fixed in 64198cf."]),
      ...root("consider", "medium", ["Declined: intentional."]),
      ...root("fix", "high"),
      ...root("consider", "high", ["Verdict: wrong. The guard is above."]),
    ],
  },
  {
    number: 2,
    body: "Generated with [Claude Code](https://claude.com/claude-code)",
    comments: [...root("consider", "medium", [`${CALLOUT}done`]), ...root("consider", "medium"), ...root("fix", "low")],
  },
  { number: 3, author: "owner", comments: [{ id: 1, user: { login: "someone" }, body: "a human comment" }] },
];

describe("readFindings", () => {
  test("reads roots only, outcomes from human replies, and the owner/agent split", () => {
    const found = readFindings(fakeGh(reportFixture()), "o/r", 50);
    expect(found).toHaveLength(7);
    expect(found.filter((f) => f.kind === "agent")).toHaveLength(3);
    expect(found.map((f) => f.outcome)).toEqual(["fixed", "declined", "none", "wrong", "fixed", "none", "none"]);
  });
});

describe("calibrate report (AC6)", () => {
  test("prints n, fixed, declined, wrong and unanswered per cell, split by owner and agent", () => {
    const { code, out } = run(["o/r"], home(), fakeGh(reportFixture()));
    expect(code).toBe(0);
    const cell = (section: string, name: string) => {
      const block = section === "all" ? out.split("\n\n")[1] : out.split(section)[1].split("\n\n")[0];
      return block
        .split("\n")
        .find((l) => l.startsWith(name))!
        .trim()
        .split(/\s{2,}/);
    };
    // all: consider·medium has 4 findings, 2 fixed, 1 declined, 0 wrong, 1 unanswered
    expect(cell("all", "Consider · medium")).toEqual(["Consider · medium", "4", "67%", "33%", "0%", "25%"]);
    expect(cell("all", "Consider · high")).toEqual(["Consider · high", "1", "—", "—", "100%", "0%"]);
    expect(cell("Owner: the deciding reply", "Consider · medium")).toEqual(["Consider · medium", "2", "50%", "50%", "0%", "0%"]);
    expect(cell("Agent: the deciding reply", "Consider · medium")).toEqual(["Consider · medium", "2", "100%", "0%", "0%", "50%"]);
    expect(out).toContain("reported, never fitted");
  });

  test("--json prints the same counts", () => {
    const { out } = run(["o/r", "--json"], home(), fakeGh(reportFixture()));
    const parsed = JSON.parse(out);
    expect(parsed.format).toBe("wachiman.calibration/1");
    const cell = parsed.cells.find((c: { severity: string; confidence: string }) => c.severity === "consider" && c.confidence === "medium");
    expect(cell.all).toEqual({ n: 4, fixed: 2, declined: 1, wrong: 0, unanswered: 1 });
    expect(cell.agent.n).toBe(2);
  });

  test("a gh failure exits 1 with a message", () => {
    const failing: GhFn = () => {
      throw new GhError("gh pr list failed", 404, "Not Found", []);
    };
    const { code, err } = run(["o/r"], home(), failing);
    expect(code).toBe(1);
    expect(err[0]).toContain("gh pr list failed");
  });
});

describe("arguments", () => {
  test("usage covers the three forms", () => expect(calibrateUsage.split("\n")).toHaveLength(3));
  test("accepts --x v and --x=v", () => {
    expect(parseCalibrateArgs(["o/r", "--judge", "--count=10", "--seed", "3", "--prs=20"])).toMatchObject({
      repo: "o/r",
      judge: true,
      count: 10,
      seed: 3,
      prs: 20,
    });
  });
  test.each([
    [[], "needs a repository"],
    [["nope"], "needs a repository"],
    [["o/r", "--judge", "--propose"], "separate steps"],
    [["o/r", "--count", "5"], "only go with --judge"],
    [["o/r", "--prs", "0"], "at least 1"],
    [["o/r", "--bogus"], "Unknown option"],
    [["o/r", "--judge", "--json"], "--json only"],
  ])("%j is a usage error", (argv, message) => expect(() => parseCalibrateArgs(argv as string[])).toThrow(message));
});

describe("hideWord", () => {
  test("drops the Priority row and the tier word, in both arms and in the old label", () => {
    const priority = finding("fix", "high");
    expect(priority).toContain("| **Priority** |");
    const hidden = hideWord(priority);
    expect(hidden).not.toContain("Priority");
    expect(hidden).not.toMatch(/\*\* \| .*\b(Must|Should|Could|FYI)\b.*\|$/m);
    const word = hideWord(finding("fix", "high", "A finding", "word"));
    expect(word).toContain("| **Severity** | 🟠 Fix |");
    expect(word).not.toMatch(/Important|Nit/);
    expect(hideWord("**Should fix (correctness): the loop**\nbody should stay")).toBe("**fix (correctness): the loop**\nbody should stay");
  });
  test("a priority word in the model's own title stays", () => {
    expect(hideWord("**Should fix (correctness): Should the loop stop? Could be**\nbody")).toBe(
      "**fix (correctness): Should the loop stop? Could be**\nbody",
    );
  });
  test("removing the tier word leaves no stray separator", () => {
    expect(hideWord("👮 **Wachiman** · Nit · 🟠🧪 **Fix · tests: X (confidence high)**")).toBe(
      "👮 **Wachiman** · 🟠🧪 **Fix · tests: X (confidence high)**",
    );
  });
  test("titleOf reads the table and the one-line label", () => {
    expect(titleOf(finding("fix", "high", "Off by one"))).toBe("Off by one");
    expect(titleOf("**Fix · bug: Off by one (confidence high)**\nbody")).toBe("Off by one");
  });
});

// ---- --judge --------------------------------------------------------------------------------------

/** 10 PRs, each with consider·medium x2 (one unanswered), fix·low, blocker·low, info·low (never sampled), and one of each other movable cell. */
const bigFixture = (): FakePr[] =>
  Array.from({ length: 10 }, (_, i) => ({
    number: i + 1,
    comments: [
      ...root("consider", "medium", ["Fixed in abc1234."]),
      ...root("consider", "medium"),
      ...root("fix", "low"),
      ...root("blocker", "low"),
      ...root("info", "low"),
      ...root("fix", "high"),
      ...root("consider", "high"),
      ...root("consider", "low"),
      ...root("fix", "medium"),
    ],
  }));

const judgingFiles = (dir: string) =>
  readdirSync(join(dir, "calibration", "o__r"))
    .filter((f) => f.startsWith("judging-"))
    .sort();
const readRows = (dir: string, file: string) =>
  readFileSync(join(dir, "calibration", "o__r", file), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Judgement);

describe("calibrate --judge (AC14)", () => {
  test("writes a blind, stratified sample with unanswered findings and a null wouldAct", () => {
    const dir = home();
    const { code, out } = run(["o/r", "--judge", "--seed", "7"], dir, fakeGh(bigFixture()));
    expect(code).toBe(0);
    expect(judgingFiles(dir)).toEqual(["judging-2026-11-19.jsonl"]);
    const rows = readRows(dir, "judging-2026-11-19.jsonl");
    expect(rows).toHaveLength(40);
    expect(out).toContain("judging-2026-11-19.jsonl");
    expect(out).toContain("wouldAct");
    expect(out).toContain("--propose");
    for (const r of rows) {
      expect(r.wouldAct).toBeNull();
      expect(r.body).not.toContain("**Priority**");
      expect(r.body).not.toMatch(/\| \*\*Severity\*\* \|.*(Must|Should|Could|FYI|Important|Nit)/);
      expect(r.cell.severity).not.toBe("info");
      expect(r.url).toContain("github.com");
    }
    const perCell = new Map<string, number>();
    for (const r of rows)
      perCell.set(`${r.cell.severity}|${r.cell.confidence}`, (perCell.get(`${r.cell.severity}|${r.cell.confidence}`) ?? 0) + 1);
    expect(perCell.size).toBe(7);
    for (const n of perCell.values()) expect(n === 5 || n === 6).toBe(true);
    // The pool has 10 unanswered consider·medium findings; the sample is not limited to answered ones.
    expect(rows.some((r) => r.cell.severity === "fix" && r.cell.confidence === "low")).toBe(true);
  });

  test("includes unanswered findings", () => {
    const dir = home();
    const prs = [{ number: 1, comments: root("consider", "medium") }];
    run(["o/r", "--judge"], dir, fakeGh(prs));
    expect(readRows(dir, judgingFiles(dir)[0])).toHaveLength(1);
  });

  test("the same seed draws the same findings; a second draw skips what was drawn", () => {
    const gh = fakeGh(bigFixture());
    const a = home();
    const b = home();
    run(["o/r", "--judge", "--seed", "7", "--count", "20"], a, gh);
    run(["o/r", "--judge", "--seed", "7", "--count", "20"], b, gh);
    const idsA = readRows(a, "judging-2026-11-19.jsonl").map((r) => r.id);
    expect(readRows(b, "judging-2026-11-19.jsonl").map((r) => r.id)).toEqual(idsA);

    const second = run(["o/r", "--judge", "--seed", "8", "--count", "20"], a, gh);
    expect(second.code).toBe(0);
    expect(judgingFiles(a)).toEqual(["judging-2026-11-19-2.jsonl", "judging-2026-11-19.jsonl"]);
    const idsSecond = readRows(a, "judging-2026-11-19-2.jsonl").map((r) => r.id);
    expect(idsSecond).toHaveLength(20);
    expect(idsSecond.filter((id) => idsA.includes(id))).toEqual([]);
  });

  test("a different seed gives a different draw", () => {
    const gh = fakeGh(bigFixture());
    const a = home();
    const b = home();
    run(["o/r", "--judge", "--seed", "1", "--count", "10"], a, gh);
    run(["o/r", "--judge", "--seed", "2", "--count", "10"], b, gh);
    expect(readRows(a, "judging-2026-11-19.jsonl").map((r) => r.id)).not.toEqual(readRows(b, "judging-2026-11-19.jsonl").map((r) => r.id));
  });
});

// ---- --propose ------------------------------------------------------------------------------------

const judgement = (severity: Severity, confidence: Confidence, pr: number, i: number, wouldAct: boolean | null): Judgement => ({
  id: `o/r#${pr}:${severity}${confidence}${i}`,
  repo: "o/r",
  pr,
  url: "u",
  path: "a.ts",
  line: 1,
  title: "t",
  body: "b",
  cell: { severity, confidence },
  wouldAct,
});

const writeJudging = (dir: string, name: string, rows: Judgement[]) => {
  const d = join(dir, "calibration", "o__r");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, name), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
};

const hashOf = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("calibrate --propose (AC7)", () => {
  test("with no judgements it proposes no change and writes nothing", () => {
    const dir = home();
    const { code, out } = run(["o/r", "--propose"], dir, fakeGh([]));
    expect(code).toBe(0);
    expect(out).toContain("No judgements");
    expect(existsSync(join(dir, "calibration"))).toBe(false);
  });

  test("moves, holds and refuses by the rules, and touches nothing the engine reads", () => {
    const dir = home();
    const priorityFile = join(import.meta.dir, "..", "priority.ts");
    const before = hashOf(priorityFile);
    const rows: Judgement[] = [
      // consider·medium: 20 of 20 across 5 PRs -> could becomes should
      ...Array.from({ length: 20 }, (_, i) => judgement("consider", "medium", (i % 5) + 1, i, true)),
      // consider·high: 7 judgements -> not measured
      ...Array.from({ length: 7 }, (_, i) => judgement("consider", "high", (i % 5) + 1, i, true)),
      // fix·low: 25 of 25 across 5 PRs -> the judgements say should, the floor holds it at could
      ...Array.from({ length: 25 }, (_, i) => judgement("fix", "low", (i % 5) + 1, i, true)),
      // consider·low: 20 judged but only 3 PRs -> not measured
      ...Array.from({ length: 20 }, (_, i) => judgement("consider", "low", (i % 3) + 1, i, true)),
      // blocker·low: skipped nulls are not counted
      ...Array.from({ length: 30 }, (_, i) => judgement("blocker", "low", (i % 6) + 1, i, null)),
    ];
    writeJudging(dir, "judging-2026-11-18.jsonl", rows.slice(0, 40));
    writeJudging(dir, "judging-2026-11-19.jsonl", rows.slice(40));
    const { code, out } = run(["o/r", "--propose"], dir, fakeGh(reportFixture()));
    expect(code).toBe(0);
    expect(out).toMatch(/consider · medium: could → should \(n 20, 5 PRs, interval 0\.8\d–1\.00\)/);
    expect(out).toContain("fixed 67%, declined 33% of 3 answered (reported, not fitted)");
    expect(out).toContain("consider · high: not measured (n 7 of 20)");
    expect(out).toContain("consider · low: not measured (n 20, 3 of 5 PRs)");
    expect(out).toContain("blocker · low: not measured (n 0 of 20, 0 of 5 PRs)");
    expect(out).toMatch(/fix · low: unchanged at could; the judgements say should, capped at could/);

    const proposed = JSON.parse(readFileSync(join(dir, "calibration", "o__r", "proposed-table.json"), "utf8"));
    expect(proposed.version).toBe("v2");
    expect(proposed.cells.consider.medium).toEqual({ word: "should", n: 20, yes: 20, prs: 5, measured: true, provenance: "judged" });
    expect(proposed.cells.consider.high).toMatchObject({ word: "should", measured: false, provenance: "seed" });
    expect(proposed.cells.fix.low.word).toBe("could");
    expect(proposed.cells.blocker.high.word).toBe("must");
    expect(proposed.cells.info.low.word).toBe("fyi");
    // The only file written is the proposal, beside the judging files; nothing the engine reads changed.
    expect(readdirSync(join(dir, "calibration", "o__r")).sort()).toEqual([
      "judging-2026-11-18.jsonl",
      "judging-2026-11-19.jsonl",
      "proposed-table.json",
    ]);
    expect(readdirSync(dir)).toEqual(["calibration"]);
    expect(hashOf(priorityFile)).toBe(before);
    expect(TABLE_V1.cells.consider.medium.priority).toBe("could");
  });

  test("a word moves down too, and a malformed line is skipped with a warning", () => {
    const dir = home();
    writeJudging(
      dir,
      "judging-2026-11-19.jsonl",
      Array.from({ length: 24 }, (_, i) => judgement("consider", "high", (i % 6) + 1, i, false)),
    );
    appendBad(dir);
    const { out, err } = run(["o/r", "--propose"], dir, fakeGh([]));
    expect(out).toMatch(/consider · high: should → fyi \(n 24, 6 PRs/);
    expect(err.join("")).toContain("line 25 is not a judgement line");
  });
});

function appendBad(dir: string) {
  const file = join(dir, "calibration", "o__r", "judging-2026-11-19.jsonl");
  writeFileSync(file, `${readFileSync(file, "utf8")}not json\n`);
}

describe("the table", () => {
  test("CalibrateArgs defaults", () => {
    const args: CalibrateArgs = parseCalibrateArgs(["o/r"]);
    expect(args).toMatchObject({ prs: 50, count: 40, judge: false, propose: false, json: false });
  });
});
