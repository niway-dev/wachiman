import { describe, expect, test } from "bun:test";
import {
  MAX_BODY_CHARS,
  MAX_PARTIAL_MARKER_CHARS,
  SIGNATURE,
  buildReview,
  lastEngineMarker,
  lastEngineState,
  marker,
  moveCommentsToBody,
  partialMarker,
  readAutoCost,
  readSignedMarker,
  readSignedState,
  type ReviewOutput,
  type ReviewState,
} from "./engine";

// ADR 0036: what a partial review records so that the next run can resume. The marker is read only
// from the engine's signed footer, and any file name GitHub allows must survive it.

const SHA = "abc1234def5678";
const signed = (footer: string, attempt = false) =>
  [
    "👮 **Wachiman** · ⚠️ **Partial review**: text",
    "<sub>m · $0.40</sub>",
    SIGNATURE.review,
    footer,
    ...(attempt ? ["<!-- wachi:attempt id=11111111-1111-1111-1111-111111111111 -->"] : []),
  ].join("\n\n");

const AWKWARD = [
  "src/a b.ts",
  "docs/ünï/文件.md",
  "weird-->name.ts",
  "--!>.ts",
  "<!-- not a comment -->.txt",
  'quote".ts',
  "back`tick`.ts",
  "emoji 🙂/x.ts",
  "a%2Fb.ts",
  "-.ts",
  "tab\tname.ts",
];

describe("the partial marker", () => {
  test("round-trips every awkward file name, and which of them were tried", () => {
    const state: ReviewState = { sha: SHA, rest: AWKWARD, tried: [AWKWARD[2], AWKWARD[7]] };
    const text = partialMarker(state);
    expect(text).not.toBeNull();
    expect(readSignedState(signed(text as string))).toEqual(state);
    // The attempt line `postReview` adds after the marker does not hide it.
    expect(readSignedState(signed(text as string, true))).toEqual(state);
    expect(readSignedMarker(signed(text as string))).toBe(SHA);
  });

  test("cannot end the HTML comment early, whatever a file is called", () => {
    const text = partialMarker({ sha: SHA, rest: AWKWARD, tried: [] }) as string;
    expect(text.startsWith("<!-- wachi:partial ")).toBe(true);
    // The only `-->` is the closing one; no other comment opener or closer is inside.
    expect(text.indexOf("-->")).toBe(text.length - 3);
    expect(text.indexOf("--!>")).toBe(-1);
    expect(text.slice(4).indexOf("<!--")).toBe(-1);
    // Nothing a file name holds appears as it is.
    for (const name of AWKWARD) expect(text).not.toContain(name);
  });

  test("a complete marker reads as a state with nothing left over", () => {
    expect(readSignedState(signed(marker(SHA)))).toEqual({ sha: SHA, rest: [], tried: [] });
    expect(readSignedMarker(signed(marker(SHA)))).toBe(SHA);
  });

  test("a tried file that is not in the list is not written", () => {
    const text = partialMarker({ sha: SHA, rest: ["a.ts"], tried: ["gone.ts", "a.ts"] }) as string;
    expect(readSignedState(signed(text))?.tried).toEqual(["a.ts"]);
  });

  test("is read only from the engine's signed footer", () => {
    const text = partialMarker({ sha: SHA, rest: ["a.ts"], tried: [] }) as string;
    // Not signed at all: another workflow's review, or text someone pasted.
    expect(readSignedState(`a review\n\n<sub>m · $0.40</sub>\n\n${text}`)).toBeNull();
    expect(lastEngineState([{ body: `a review\n\n${text}` }])).toBeNull();
    // Signed, but the marker is not the footer: in the middle of the body, or before the signature.
    expect(readSignedState(`${SIGNATURE.review}\n\n${text}\n\nmore text`)).toBeNull();
    expect(readSignedState(`${text}\n\n${SIGNATURE.review}`)).toBeNull();
    expect(readSignedState(`x\n\n${text}\n\n${SIGNATURE.review}\n\n${marker(SHA)}`)?.rest).toEqual([]);
  });

  test("a state that is not what the engine writes is ignored, not guessed at", () => {
    const bad = (state: string) => `<!-- wachi:partial sha=${SHA} state=${state} -->`;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const state of [
      "!!!",
      encode("text"),
      encode({ r: "a.ts", t: [] }),
      encode({ r: [1], t: [] }),
      encode({ r: ["a.ts"], t: [1] }),
      encode({ r: ["a.ts"], t: [-1] }),
      encode({ r: ["a.ts"] }),
      Buffer.from("{not json").toString("base64url"),
    ])
      expect(readSignedState(signed(bad(state)))).toBeNull();
  });

  test("the last review's state wins; a signed review with no marker (a scoped one) does not erase it", () => {
    const partial = partialMarker({ sha: "aaa1111", rest: ["x.ts"], tried: [] }) as string;
    const reviews = [
      { body: signed(marker("old0000")) },
      { body: signed(partial) },
      { body: `a scoped review\n\n${SIGNATURE.review}` },
    ];
    expect(lastEngineState(reviews)).toEqual({ sha: "aaa1111", rest: ["x.ts"], tried: [] });
    // `lastEngineMarker` keeps answering with the commit, which is all a thread-only run needs.
    expect(lastEngineMarker(reviews)).toBe("aaa1111");
    expect(lastEngineState([...reviews, { body: signed(marker("new2222")) }])).toEqual({ sha: "new2222", rest: [], tried: [] });
  });

  test("a partial review's footer still records its cost for the pull request's ceiling", () => {
    const text = partialMarker({ sha: SHA, rest: ["a.ts"], tried: [] }) as string;
    const body = (attempt: boolean) =>
      ["review", "<sub>m · $1.25</sub>", SIGNATURE.auto, SIGNATURE.review, text, ...(attempt ? ["<!-- wachi:attempt id=11111111-1111-1111-1111-111111111111 -->"] : [])].join("\n\n");
    expect(readAutoCost(body(false))).toBe(1.25);
    expect(readAutoCost(body(true))).toBe(1.25);
  });

  test("a list too long to store writes no marker", () => {
    const short = Array.from({ length: 50 }, (_, i) => `src/module/file-${i}.ts`);
    expect(partialMarker({ sha: SHA, rest: short, tried: [] })).not.toBeNull();
    const long = Array.from({ length: 400 }, (_, i) => `packages/some-long-package-name/src/features/feature-${i}/handler.ts`);
    expect(partialMarker({ sha: SHA, rest: long, tried: [] })).toBeNull();
    // The limit is on the marker's own length.
    const text = partialMarker({ sha: SHA, rest: short, tried: [] }) as string;
    expect(text.length).toBeLessThanOrEqual(MAX_PARTIAL_MARKER_CHARS);
  });
});

describe("buildReview and the partial marker", () => {
  const out = (over: Partial<ReviewOutput>): ReviewOutput => ({
    files_reviewed: [],
    files_skipped: [],
    findings: [],
    contracts: [],
    thread_replies: [],
    summary: "ok",
    ...over,
  });
  const file = (filename: string) => ({ filename, additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" });
  const base = {
    headSha: SHA,
    since: null,
    scoped: false,
    costUsd: 0.4,
    modelLabel: "m",
  };

  test("a partial review lists what it did not reach in a marker at the head; a complete one writes the plain marker", () => {
    const partial = buildReview({
      ...base,
      output: out({ files_reviewed: ["a.ts"], files_skipped: [{ path: "c.ts", reason: "not reached: the pull request's budget was spent" }] }),
      files: [file("a.ts"), file("b.ts"), file("c.ts")],
    }).body;
    expect(readSignedState(partial)).toEqual({ sha: SHA, rest: ["b.ts", "c.ts"], tried: ["b.ts"] });
    expect(partial).not.toContain("agent-review sha=");

    const complete = buildReview({ ...base, output: out({ files_reviewed: ["a.ts"] }), files: [file("a.ts")] }).body;
    expect(complete.endsWith(`${SIGNATURE.review}\n\n${marker(SHA)}`)).toBe(true);
    expect(readSignedState(complete)).toEqual({ sha: SHA, rest: [], tried: [] });
  });

  test("a scoped review writes neither marker", () => {
    const body = buildReview({
      ...base,
      scoped: true,
      output: out({ files_reviewed: ["a.ts"] }),
      files: [file("a.ts"), file("b.ts")],
    }).body;
    expect(body).toContain("⚠️ **Partial review**");
    expect(body).not.toContain("wachi:partial");
    expect(body).not.toContain("agent-review sha=");
  });

  test("a file not reached keeps being carried; one sent and not reviewed gets a second try, then is named and left out", () => {
    const notReached = { path: "late.ts", reason: "not reached: the call ran out of its budget" };
    const run = (tried: string[], skipped = [notReached]) =>
      buildReview({
        ...base,
        since: "old0000",
        carried: ["late.ts", "stubborn.ts"],
        tried,
        output: out({ files_reviewed: ["fresh.ts"], files_skipped: skipped }),
        files: ["fresh.ts", "late.ts", "stubborn.ts"].map(file),
      }).body;

    // First time: both go to the list; only the one a model was sent is marked tried.
    expect(readSignedState(run([]))).toEqual({ sha: SHA, rest: ["late.ts", "stubborn.ts"], tried: ["stubborn.ts"] });
    // Second time: the stubborn one has had its two tries. It is named, not carried, and the notice says so.
    const second = run(["stubborn.ts"]);
    expect(readSignedState(second)).toEqual({ sha: SHA, rest: ["late.ts"], tried: [] });
    expect(second).toContain("Not reviewed after two tries, so the next push will not carry it: `stubborn.ts`.");
    expect(second).toContain("review <paths>");
    // A file tried before and now not reached is not reviewed after two tries: it stays, tried.
    expect(readSignedState(run(["late.ts"]))?.tried).toEqual(["late.ts", "stubborn.ts"]);
    // When only the exhausted file was left, the review is partial but writes the complete marker.
    const last = buildReview({
      ...base,
      since: "old0000",
      carried: ["stubborn.ts"],
      tried: ["stubborn.ts"],
      output: out({ files_reviewed: ["fresh.ts"] }),
      files: ["fresh.ts", "stubborn.ts"].map(file),
    }).body;
    expect(last).toContain("⚠️ **Partial review**");
    expect(last.endsWith(`${SIGNATURE.review}\n\n${marker(SHA)}`)).toBe(true);
  });

  test("says in the headline that it covered the changes since and the files the previous review did not reach", () => {
    const body = buildReview({
      ...base,
      since: "old0000111",
      carried: ["x.ts", "y.ts"],
      output: out({ files_reviewed: ["fresh.ts", "x.ts", "y.ts"] }),
      files: ["fresh.ts", "x.ts", "y.ts"].map(file),
    }).body;
    expect(body.split("\n")[0]).toBe(
      "👮 **Wachiman** · review of the changes since `old0000` and the 2 files the previous review did not reach, at `abc1234`: all 3 files reviewed.",
    );
    const only = buildReview({
      ...base,
      since: "old0000111",
      carried: ["x.ts"],
      output: out({ files_reviewed: ["x.ts"] }),
      files: [file("x.ts")],
    }).body;
    expect(only.split("\n")[0]).toContain("review of the 1 file the previous review did not reach, at `abc1234`: all 1 files reviewed.");
  });

  test("a list too long to store writes no partial marker, warns, and still fits the body", () => {
    const names = Array.from({ length: 400 }, (_, i) => `packages/some-long-package-name/src/features/feature-${i}/handler.ts`);
    const warnings: string[] = [];
    const built = buildReview({
      ...base,
      output: out({}),
      files: names.map(file),
      warn: (line) => void warnings.push(line),
    });
    expect(built.body).toContain("⚠️ **Partial review**");
    expect(built.body).not.toContain("wachi:partial");
    expect(built.body).not.toContain("agent-review sha=");
    expect(built.body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("400 file(s)");
    expect(warnings[0]).toContain(String(MAX_PARTIAL_MARKER_CHARS));
  });

  test("the marker survives the fitting to the body limit, even when the findings fill the body", () => {
    const names = Array.from({ length: 40 }, (_, i) => `src/unread-${i}.ts`);
    const findings = Array.from({ length: 150 }, (_, i) => ({
      path: "big.ts",
      line: 100 + i,
      severity: "fix" as const,
      topic: "bug" as const,
      confidence: "high" as const,
      title: `finding ${i}`,
      body: "x".repeat(900),
      // Listed in the body, in a section the fitting cuts to fit.
      origin: "pre-existing" as const,
    }));
    const built = buildReview({
      ...base,
      output: out({ files_reviewed: ["big.ts"], findings, summary: "s".repeat(5_000) }),
      files: [file("big.ts"), ...names.map(file)],
    });
    expect(readSignedState(built.body)?.rest).toEqual(names);
    expect(built.body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    // Inline comments refused by GitHub move into the body: the marker is still the footer.
    const moved = moveCommentsToBody({ body: built.body, comments: [{ path: "big.ts", line: 1, side: "RIGHT", body: "c".repeat(30_000) }] });
    expect(moved.body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(readSignedState(moved.body)?.rest).toEqual(names);
  });
});
