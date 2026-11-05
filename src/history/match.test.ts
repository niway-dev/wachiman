import { describe, expect, test } from "bun:test";
import type { ReviewFile, ReviewResult } from "../engine";
import { titleKey } from "./fingerprint";
import { reconcile, replay } from "./match";
import { HISTORY_RUN_FORMAT, type HistoryRun, type VerdictLine } from "./types";

interface F {
  path: string;
  line: number;
  title: string;
  /** The stripped text of the cited line at this head; absent = no line hash. */
  text?: string;
  topic?: string;
  severity?: string;
}
interface Step {
  head: string;
  findings: F[];
  reviewed: string[];
  files?: Partial<ReviewFile>[];
  /** Tracked findings (by first title) whose cited region changed. */
  changed?: string[];
  blobs?: Record<string, string>;
}

/** Runs `reconcile` on a hand-built result and appends the run it would have saved. */
function step(runs: HistoryRun[], s: Step) {
  const result = {
    format: "wachiman.review-result/1",
    change: { head: { sha: s.head } },
    coverage: { reviewed: s.reviewed, expected: s.reviewed, skipped: [] },
    findings: s.findings.map((f) => ({ path: f.path, line: f.line, title: f.title, topic: f.topic ?? "bug", severity: f.severity ?? "fix", body: "b" })),
  } as unknown as ReviewResult;
  const textOf = new Map(s.findings.map((f) => [`${f.path}:${f.line}:${f.title}`, f.text]));
  const out = reconcile({
    open: replay(runs, new Map()).findings,
    result,
    files: (s.files ?? []).map((f) => ({ additions: 0, deletions: 0, ...f }) as ReviewFile),
    key: "k",
    fingerprint: (f) => {
      const text = textOf.get(`${f.path}:${f.line}:${f.title}`);
      return { titleKey: titleKey(f.title), lineHash: text ? `H:${text}` : undefined, lineText: text, blobSha: s.blobs?.[f.path] };
    },
    regionChanged: (_path, t) => (s.changed ?? []).includes(t.title),
  });
  runs.push({
    format: HISTORY_RUN_FORMAT,
    savedAt: `2026-11-0${runs.length + 1}T10:00:00.000Z`,
    engine: { version: "0" },
    repository: { key: "k", name: "k", keyedBy: "path", path: "/k" },
    result,
    tracking: out.tracking,
    settled: out.settled,
    unknown: out.unknown,
    unknownIds: out.unknownIds,
  });
  return out;
}

const A = { path: "src/a.ts", line: 2, title: "Off by one in the loop", text: "returnitems[i+1];" };

describe("reconcile", () => {
  test("a finding with no match is new", () => {
    const out = step([], { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    expect(out.tracking).toHaveLength(1);
    expect(out.tracking[0]).toMatchObject({ status: "new", runs: 1, reopened: 0, firstHead: "h1" });
    expect(out.tracking[0].firstId).toBe(out.tracking[0].id);
    expect(out.tracking[0].matchedBy).toBeUndefined();
    expect(out.settled).toEqual([]);
    expect(out.unknown).toBe(0);
  });

  test("the same line text at another line number is open, matched by line", () => {
    const runs: HistoryRun[] = [];
    const first = step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    const out = step(runs, { head: "h2", findings: [{ ...A, line: 9, title: "A reworded complaint" }], reviewed: ["src/a.ts"] });
    expect(out.tracking[0]).toMatchObject({ status: "open", matchedBy: "line", runs: 2, firstHead: "h1", firstId: first.tracking[0].firstId, reopened: 0 });
    expect(out.settled).toEqual([]);
  });

  test("a renamed file keeps its findings open", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    const out = step(runs, {
      head: "h2",
      findings: [{ ...A, path: "src/renamed.ts" }],
      reviewed: ["src/renamed.ts"],
      files: [{ filename: "src/renamed.ts", previous_filename: "src/a.ts" }],
    });
    expect(out.tracking[0]).toMatchObject({ status: "open", matchedBy: "line", firstHead: "h1" });
  });

  test("a reworded title on the same line is open, matched by line", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    const out = step(runs, { head: "h2", findings: [{ ...A, title: "The last element is read out of bounds" }], reviewed: ["src/a.ts"] });
    expect(out.tracking[0]).toMatchObject({ status: "open", matchedBy: "line" });
  });

  test("the same title on an edited line is open, matched by title", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    const out = step(runs, { head: "h2", findings: [{ ...A, text: "returnitems[i+2];" }], reviewed: ["src/a.ts"] });
    expect(out.tracking[0]).toMatchObject({ status: "open", matchedBy: "title" });
  });

  test("a different topic or path never matches", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts", "src/b.ts"] });
    const out = step(runs, {
      head: "h2",
      findings: [{ ...A, topic: "security" }, { ...A, path: "src/b.ts" }],
      reviewed: ["src/a.ts", "src/b.ts"],
    });
    expect(out.tracking.map((t) => t.status)).toEqual(["new", "new"]);
  });

  test("absent, file reviewed, region changed: probably-fixed", () => {
    const runs: HistoryRun[] = [];
    const first = step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    const out = step(runs, { head: "h2", findings: [], reviewed: ["src/a.ts"], changed: [A.title] });
    expect(out.tracking).toEqual([]);
    expect(out.settled).toEqual([{ firstId: first.tracking[0].firstId, status: "probably-fixed", path: "src/a.ts", line: 2, title: A.title, lastHead: "h1" }]);
    expect(out.unknown).toBe(0);
  });

  test("absent, file reviewed, region unchanged: not-repeated", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    const out = step(runs, { head: "h2", findings: [], reviewed: ["src/a.ts"] });
    expect(out.settled.map((s) => s.status)).toEqual(["not-repeated"]);
  });

  test("absent, file not in coverage.reviewed: unknown, counted", () => {
    const runs: HistoryRun[] = [];
    const first = step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    // The file was expected but skipped (quota, scope) ...
    const skipped = step(runs, { head: "h2", findings: [], reviewed: ["src/other.ts"], changed: [A.title] });
    expect(skipped.settled).toEqual([]);
    expect(skipped.unknown).toBe(1);
    expect(skipped.unknownIds).toEqual([first.tracking[0].firstId]);
    // ... or it left the change entirely.
    const gone = step(runs, { head: "h3", findings: [], reviewed: [] });
    expect(gone.settled).toEqual([]);
    expect(gone.unknown).toBe(1);
    expect(replay(runs, new Map()).findings[0].status).toBe("unknown");
  });

  test("a line-0 finding matches by title only and is probably-fixed when the blob changed", () => {
    const runs: HistoryRun[] = [];
    const whole = { path: "src/a.ts", line: 0, title: "The module has no error handling" };
    step(runs, { head: "h1", findings: [whole], reviewed: ["src/a.ts"], blobs: { "src/a.ts": "blob1" } });
    const again = step(runs, { head: "h2", findings: [{ ...whole, text: "ignoredbecauseline0" }], reviewed: ["src/a.ts"], blobs: { "src/a.ts": "blob1" } });
    expect(again.tracking[0]).toMatchObject({ status: "open", matchedBy: "title" });
    const fixed = step(runs, { head: "h3", findings: [], reviewed: ["src/a.ts"], changed: [whole.title], blobs: { "src/a.ts": "blob2" } });
    expect(fixed.settled.map((s) => s.status)).toEqual(["probably-fixed"]);
  });

  test("a settled finding that matches again is open with reopened 1", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    step(runs, { head: "h2", findings: [], reviewed: ["src/a.ts"], changed: [A.title] });
    expect(replay(runs, new Map()).findings[0].status).toBe("probably-fixed");
    const out = step(runs, { head: "h3", findings: [A], reviewed: ["src/a.ts"] });
    expect(out.tracking[0]).toMatchObject({ status: "open", reopened: 1, runs: 2, firstHead: "h1" });
    expect(out.settled).toEqual([]);
    // A settled finding that stays absent is not settled again, nor counted unknown.
    const runs2: HistoryRun[] = [];
    step(runs2, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    step(runs2, { head: "h2", findings: [], reviewed: ["src/a.ts"], changed: [A.title] });
    const quiet = step(runs2, { head: "h3", findings: [], reviewed: [] });
    expect(quiet.settled).toEqual([]);
    expect(quiet.unknown).toBe(0);
  });

  test("one old finding satisfies at most one new finding", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [A], reviewed: ["src/a.ts"] });
    const out = step(runs, {
      head: "h2",
      findings: [
        { ...A, line: 5, text: undefined },
        { ...A, line: 8, text: undefined },
      ],
      reviewed: ["src/a.ts"],
    });
    expect(out.tracking.map((t) => t.status)).toEqual(["open", "new"]);
  });

  test("severity and confidence are not identity", () => {
    const runs: HistoryRun[] = [];
    step(runs, { head: "h1", findings: [{ ...A, severity: "fix" }], reviewed: ["src/a.ts"] });
    const out = step(runs, { head: "h2", findings: [{ ...A, severity: "consider" }], reviewed: ["src/a.ts"] });
    expect(out.tracking[0].status).toBe("open");
    expect(replay(runs, new Map()).findings[0].severity).toBe("consider");
  });
});

describe("replay", () => {
  test("replays three runs and a verdict into the state the listing shows", () => {
    const B = { path: "src/b.ts", line: 4, title: "Unchecked cast", text: "constx=y asT;" };
    const C = { path: "src/c.ts", line: 7, title: "Missing await", text: "save(record);" };
    const runs: HistoryRun[] = [];
    const r1 = step(runs, { head: "h1", findings: [A, B], reviewed: ["src/a.ts", "src/b.ts"] });
    step(runs, { head: "h2", findings: [A, C], reviewed: ["src/a.ts", "src/b.ts", "src/c.ts"], changed: [B.title] });
    step(runs, { head: "h3", findings: [A], reviewed: ["src/a.ts"] });
    const idA = r1.tracking[0].firstId;
    const idB = r1.tracking[1].firstId;
    const verdict: VerdictLine = { at: "t", firstId: idB, verdict: "wrong" };
    const state = replay(runs, new Map([[idB, verdict]]));
    const byTitle = Object.fromEntries(state.findings.map((f) => [f.title, f]));
    expect(byTitle[A.title]).toMatchObject({ firstId: idA, status: "open", firstHead: "h1", lastHead: "h3", runs: 3 });
    expect(byTitle[B.title]).toMatchObject({ status: "probably-fixed", firstHead: "h1", lastHead: "h1", runs: 1, verdict });
    // C was absent at h3 in a run that did not review its file.
    expect(byTitle[C.title]).toMatchObject({ status: "unknown", firstHead: "h2", lastHead: "h2", runs: 1 });
    expect(state.findings.map((f) => f.title)).toEqual([A.title, B.title, C.title]);
    expect(state.counts).toEqual({ correct: 0, partial: 0, wrong: 1, unjudged: 2 });
  });
});
