import { describe, expect, test } from "bun:test";
import type { GhFn } from "../engine";
import { BLOCK_END, BLOCK_START, claimsDigest } from "./digest";
import { RESET_REASON, failClosed, publishConfidence, resetConfidence, type SinkDeps } from "./sink";
import type { Fidelity } from "./types";

const COMMIT = "a".repeat(40);
const NEWER = "b".repeat(40);
const TITLE = "Retry uploads";
const BODY = "Retries failed uploads.\n\n- also logs\n";

const fidelity = (over: Partial<Fidelity> = {}): Fidelity => ({
  claims: [{ text: "Retries failed uploads.", status: "confirmed", evidence: [{ path: "src/upload.ts", line: 2 }] }],
  unexplainedFiles: [],
  grade: "A",
  reasons: [],
  trial: true,
  judgedAGrades: 0,
  questions: [],
  sensitivePaths: [],
  digest: claimsDigest(TITLE, BODY),
  reviewedCommit: COMMIT,
  ...over,
});

/** A pull request whose description and head can be changed between calls; every PATCH is kept. */
function fakeGithub(live: { headRefOid: string; title: string; body: string }) {
  const state = { ...live };
  const patches: { path: string; body: string }[] = [];
  const calls: string[] = [];
  let failPatch = false;
  const gh: GhFn = (args, input) => {
    calls.push(args.join(" "));
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify(state);
    if (args.includes("PATCH")) {
      if (failPatch) throw new Error("gh api failed: HTTP 403");
      const body = JSON.parse(input ?? "{}").body as string;
      patches.push({ path: args.find((a) => a.startsWith("repos/")) ?? "", body });
      state.body = body;
      return "{}";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  return { gh, state, patches, calls, failNextPatches: () => (failPatch = true) };
}

const sinkDeps = (gh: GhFn, over: Partial<SinkDeps> = {}): SinkDeps & { logs: string[]; warnings: string[] } => {
  const logs: string[] = [];
  const warnings: string[] = [];
  return { gh, dryRun: false, now: () => Date.parse("2026-11-11T12:00:00Z"), log: (l) => logs.push(l), warn: (l) => warnings.push(l), logs, warnings, ...over };
};

const PUBLISH = { headSha: COMMIT, permalinkBase: "https://github.com/o/r", reviewUrl: "https://github.com/o/r/pull/7#pullrequestreview-1" };

describe("failing closed at the moment of writing", () => {
  const live = { headCommit: COMMIT, title: TITLE, body: BODY };

  test("a review whose commit and text still match keeps its grade", () => {
    const f = fidelity();
    expect(failClosed(f, live)).toBe(f);
  });

  test("a pull request that has a newer commit gives cannot say, with no letter and no trial mark", () => {
    const out = failClosed(fidelity(), { ...live, headCommit: NEWER });
    expect(out.grade).toBe("cannot say");
    expect(out.trial).toBe(false);
    expect(out.reasons).toEqual(["The review of the new commit has not finished"]);
  });

  test("a title or body edited since the claims were read gives cannot say", () => {
    for (const edit of [{ title: "Retry downloads" }, { body: `${BODY}\nNow also deletes the cache.` }]) {
      const out = failClosed(fidelity({ grade: "B", reasons: ["One unexplained change"] }), { ...live, ...edit });
      expect(out.grade).toBe("cannot say");
      expect(out.reasons).toEqual(["The pull request text changed while the review was running"]);
    }
  });

  test("Wachiman's own block in the body is not an edit", () => {
    const body = `${BLOCK_START}\nold\n${BLOCK_END}\n\n${BODY}`;
    const f = fidelity();
    expect(failClosed(f, { ...live, body })).toBe(f);
  });
});

describe("writing the description block", () => {
  test("the block goes at the top, the author's text is byte-identical, and the review is linked at its commit", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    const deps = sinkDeps(github.gh);
    publishConfidence(deps, "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    expect(github.patches).toHaveLength(1);
    const written = github.patches[0]!.body;
    expect(github.patches[0]!.path).toBe("repos/o/r/pulls/7");
    expect(written.startsWith(BLOCK_START)).toBe(true);
    expect(written.endsWith(`${BLOCK_END}\n\n${BODY}`)).toBe(true);
    expect(written).toContain("TIP");
    expect(written).toContain("(trial)");
    expect(written).toContain(PUBLISH.reviewUrl);
    expect(written).toContain("2026-11-11");
  });

  test("the links to code point at the reviewed commit, never at HEAD", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    const b = fidelity({
      grade: "B",
      trial: false,
      reasons: ["One unexplained change"],
      unexplainedFiles: ["src/upload.ts"],
      questions: [{ kind: "unexplained", path: "src/upload.ts", line: 2, text: "no claim in the pull request explains this change." }],
    });
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, fidelity: b });
    const written = github.patches[0]!.body;
    expect(written).toContain(`https://github.com/o/r/blob/${COMMIT}/src/upload.ts#L2`);
    expect(written).not.toContain("blob/HEAD");
  });

  test("a second run replaces the block and adds no second one", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, fidelity: fidelity({ grade: "B", trial: false, reasons: ["One unexplained change"], unexplainedFiles: ["src/x.ts"] }) });
    const final = github.state.body;
    expect(final.split(BLOCK_START)).toHaveLength(2);
    expect(final.split(BLOCK_END)).toHaveLength(2);
    expect(final).toContain("WARNING");
    expect(final).not.toContain("TIP");
    expect(final.endsWith(`${BLOCK_END}\n\n${BODY}`)).toBe(true);
  });

  test("the live description is what the block is put into, so an edit made during the review is kept", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    // The author adds a line after the claims were read: the digest differs, and the new line stays.
    github.state.body = `${BODY}\nAdded while the review ran.`;
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    const written = github.patches[0]!.body;
    expect(written).toContain("Added while the review ran.");
    expect(written).toContain("IMPORTANT");
    expect(written).toContain("The pull request text changed while the review was running");
  });

  test("a newer head means a newer run owns the block: this run leaves it alone, even a finished grade", () => {
    const finished = `${BLOCK_START}\n## PR Confidence\n> A (trial) for ${NEWER.slice(0, 7)}\n${BLOCK_END}\n\n${BODY}`;
    const github = fakeGithub({ headRefOid: NEWER, title: TITLE, body: finished });
    const deps = sinkDeps(github.gh);
    publishConfidence(deps, "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    expect(github.patches).toEqual([]);
    expect(github.state.body).toBe(finished);
    expect(deps.logs.join("\n")).toContain("newer commit");
    // A partial review is stale in the same way.
    publishConfidence(deps, "o/r", 7, { ...PUBLISH, partialReason: "Only part" });
    expect(github.patches).toEqual([]);
  });

  test("a review with no grade (a partial review) writes cannot say with its reason", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, partialReason: "This review covered only the changes since the last one" });
    const written = github.patches[0]!.body;
    expect(written).toContain("IMPORTANT");
    expect(written).toContain("This review covered only the changes since the last one");
    expect(written).not.toContain("TIP");
  });

  test("a failed write is a warning, never an error: the review stays posted", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    github.failNextPatches();
    const deps = sinkDeps(github.gh);
    expect(() => publishConfidence(deps, "o/r", 7, { ...PUBLISH, fidelity: fidelity() })).not.toThrow();
    expect(deps.warnings.join("\n")).toContain("description could not be updated");
    expect(deps.warnings.join("\n")).toContain("HTTP 403");
  });

  test("a failed read is a warning too", () => {
    const deps = sinkDeps(() => {
      throw new Error("gh pr view failed");
    });
    expect(() => publishConfidence(deps, "o/r", 7, { ...PUBLISH, fidelity: fidelity() })).not.toThrow();
    expect(deps.warnings.join("\n")).toContain("description could not be updated");
  });

  test("a dry run prints the block and writes nothing", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    const deps = sinkDeps(github.gh, { dryRun: true });
    publishConfidence(deps, "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    expect(github.patches).toEqual([]);
    expect(deps.logs.join("\n")).toContain(BLOCK_START);
  });

  test("a description that already holds this exact block is not written again", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    expect(github.patches).toHaveLength(1);
  });
});

describe("the reset step", () => {
  test("rewrites the block to cannot say for the commit under review, with no old letter and no model call", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    publishConfidence(sinkDeps(github.gh), "o/r", 7, { ...PUBLISH, fidelity: fidelity() });
    expect(github.state.body).toContain("TIP");
    github.state.headRefOid = NEWER;
    const deps = sinkDeps(github.gh);
    resetConfidence(deps, "o/r", 7, NEWER);
    const body = github.state.body;
    expect(body).toContain("IMPORTANT");
    expect(body).toContain(RESET_REASON);
    expect(body).toContain(NEWER.slice(0, 7));
    expect(body).not.toContain("TIP");
    expect(body).not.toContain("(trial)");
    expect(body.split(BLOCK_START)).toHaveLength(2);
    expect(body.endsWith(`${BLOCK_END}\n\n${BODY}`)).toBe(true);
  });

  test("a description with no block gets one at the top", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    resetConfidence(sinkDeps(github.gh), "o/r", 7, COMMIT);
    expect(github.state.body.startsWith(BLOCK_START)).toBe(true);
    expect(github.state.body.endsWith(`\n\n${BODY}`)).toBe(true);
  });

  test("an empty description becomes just the block", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: "" });
    resetConfidence(sinkDeps(github.gh), "o/r", 7, COMMIT);
    expect(github.state.body.startsWith(BLOCK_START)).toBe(true);
  });

  test("a newer push already moved the head: this run is stale and leaves the block alone", () => {
    const github = fakeGithub({ headRefOid: NEWER, title: TITLE, body: BODY });
    const deps = sinkDeps(github.gh);
    resetConfidence(deps, "o/r", 7, COMMIT);
    expect(github.patches).toEqual([]);
    expect(deps.logs.join("\n")).toContain("newer commit");
  });

  test("without a commit it uses the head the pull request has now", () => {
    const github = fakeGithub({ headRefOid: NEWER, title: TITLE, body: BODY });
    resetConfidence(sinkDeps(github.gh), "o/r", 7);
    expect(github.state.body).toContain(NEWER.slice(0, 7));
  });

  test("a failure is a warning: the job goes on to the review", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    github.failNextPatches();
    const deps = sinkDeps(github.gh);
    expect(() => resetConfidence(deps, "o/r", 7, COMMIT)).not.toThrow();
    expect(deps.warnings.join("\n")).toContain("PR Confidence");
  });

  test("a dry run prints and writes nothing", () => {
    const github = fakeGithub({ headRefOid: COMMIT, title: TITLE, body: BODY });
    const deps = sinkDeps(github.gh, { dryRun: true });
    resetConfidence(deps, "o/r", 7, COMMIT);
    expect(github.patches).toEqual([]);
    expect(deps.logs.join("\n")).toContain(BLOCK_START);
  });
});
