import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// NIW2-726: a review that cannot finish (its budget is spent, or a model skipped files) leaves
// files unreviewed. The next push must resume with those files, not start the whole review over
// and stop at the same place. The sequence below is the one observed on a real pull request: eight
// batches, the budget spent in batch 7, then a push that changes one already reviewed file.

const BASE = "b".repeat(40);

interface PrFile {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
  sha?: string;
}

const NAMES = Array.from({ length: 16 }, (_, i) => `src/f${String(i + 1).padStart(2, "0")}.ts`);
const [F01, F02, F03, , F05, , , , , F10, , , F13, F14, F15, F16] = NAMES;

/** The pull request's own change to one file: ten added lines whose text names the file and its revision. */
const whole = (filename: string, rev = 0): PrFile => ({
  filename,
  additions: 10,
  deletions: 0,
  patch: `@@ -0,0 +1,10 @@\n${Array.from({ length: 10 }, (_, k) => `+${filename} r${rev} line ${k}`).join("\n")}`,
});
const allFiles = (revs: Record<string, number> = {}) => NAMES.map((n) => whole(n, revs[n] ?? 0));

/** What the owner's open thread looks like to GraphQL: a finding of Wachiman's, then the owner's reply. */
const thread = (id: number, path: string) => ({
  isResolved: false,
  path,
  line: 2,
  comments: {
    nodes: [
      { databaseId: id, author: { login: "github-actions" }, authorAssociation: "NONE", body: `Important · 🟠🐛 **Fix · bug: old**\n\nOld finding.\n\n<!-- wachi:finding -->`, createdAt: "2026-10-30T00:00:00Z" },
      { databaseId: id + 1000, author: { login: "owner" }, authorAssociation: "OWNER", body: "Done, please check.", createdAt: "2026-10-30T00:01:00Z" },
    ],
  },
});

/** One pull request as GitHub shows it: the commits it went through and every review the bot wrote. */
class World {
  commits = new Map<string, PrFile[]>();
  head = "";
  status = "ahead";
  reviews: { body: string; submitted_at: string }[] = [];
  inlineReplies: string[] = [];
  threads: unknown[] = [];
  private clock = 0;

  push(sha: string, files: PrFile[], status = "ahead") {
    this.commits.set(sha, files);
    this.head = sha;
    this.status = status;
  }

  private files(sha: string) {
    const files = this.commits.get(sha);
    if (!files) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    return files;
  }

  readonly gh: GhFn = (args, input) => {
    const line = args.join(" ");
    if (args.includes("POST")) {
      if (line.includes("/pulls/7/reviews")) {
        const body = JSON.parse(input ?? "{}").body as string;
        this.reviews.push({ body, submitted_at: new Date(Date.UTC(2026, 10, 1, 0, this.clock++)).toISOString() });
      } else if (line.includes("/replies")) this.inlineReplies.push(args[args.length - 1]);
      return "{}";
    }
    if (line.startsWith("pr view"))
      return JSON.stringify({ headRefOid: this.head, title: "t", body: "b", author: { login: "u" } });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.includes("/pulls/7/files")) return this.files(this.head).map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews")) return this.reviews.map((r) => JSON.stringify(r)).join("\n");
    if (line.includes("/pulls/7/comments")) return this.inlineReplies.map((body) => JSON.stringify({ body })).join("\n");
    if (line.startsWith("api graphql"))
      return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: this.threads } } } } });
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    const compare = line.match(/compare\/(\S+?)\.\.\.(\S+)/);
    if (compare) {
      const [, from, to] = compare;
      if (from === BASE) return JSON.stringify({ status: "ahead", files: this.files(to) });
      // `from...to`: what changed between two commits. A changed file's patch says so in its text.
      const before = new Map(this.files(from).map((f) => [f.filename, f.patch]));
      const changed = this.files(to)
        .filter((f) => before.get(f.filename) !== f.patch)
        .map((f) => ({ ...f, additions: 1, deletions: 1, patch: `@@ -1,1 +1,1 @@\n-before\n+SINCE ${f.filename}` }));
      return JSON.stringify({ status: this.status, total: 1, commits: [{ sha: "c1", parents: 1 }], files: changed });
    }
    throw new Error(`unexpected gh call: ${line}`);
  };
}

interface Step {
  cost: number;
  /** The files the answer lists as reviewed; every file of the part by default. */
  reviewed?: string[];
  /** The call ends on its budget and returns no review. */
  budget?: boolean;
}

/** Answers each call with `decide(files of the part, call number)`, and every thread it was given. */
class Provider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly decide: (files: string[], call: number) => Step) {}
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const files = partFiles(request.prompt);
    const step = this.decide(files, this.requests.length);
    const base = { costUsd: step.cost, turns: 1, durationMs: 1, raw: {} };
    if (step.budget) return { ...base, terminalReason: "budget", isError: true };
    const threadsFile = join(request.addDirs[0], "threads.json");
    const threads: { comment_id: number }[] = existsSync(threadsFile) ? JSON.parse(readFileSync(threadsFile, "utf8")) : [];
    const output: ReviewOutput = {
      files_reviewed: step.reviewed ?? files,
      files_skipped: [],
      findings: [],
      contracts: [],
      thread_replies: threads.map((t) => ({ comment_id: t.comment_id, status: "still_open" as const, reply: "Still applies." })),
      summary: "ok",
    };
    return { ...base, terminalReason: "success", isError: false, structuredOutput: output };
  }
}

const partFiles = (prompt: string) =>
  [...prompt.split("This part holds exactly these files")[1].split("\n\n")[0].matchAll(/^- (\S+) \+/gm)].map((m) => m[1]);

/** Every file a run sent to a model, with the diff text it saw. */
const sentFiles = (provider: Provider) => provider.requests.flatMap((r) => partFiles(r.prompt));
const promptOf = (provider: Provider, file: string) =>
  provider.requests.map((r) => r.prompt).find((p) => partFiles(p).includes(file)) ?? "";

function run(world: World, provider: Provider, env: Record<string, string> = {}, words: string[] = []) {
  const logs: string[] = [];
  const warns: string[] = [];
  const deps: Deps = {
    gh: world.gh,
    provider,
    config: loadConfig({
      AGENT_REVIEW_VERIFY: "0",
      AGENT_REVIEW_TRIGGER: "synchronize",
      AGENT_REVIEW_BATCH_LINES: "20",
      AGENT_REVIEW_BUDGET_USD: "3",
      AGENT_REVIEW_AUTO_BUDGET_USD: "6",
      ...env,
    }),
    repoDir: mkdtempSync(join(tmpdir(), "resume-head-")),
    log: (l) => void logs.push(l),
    warn: (l) => void warns.push(l),
    lineCounter: () => 100,
    sleep: () => {},
  };
  const before = world.reviews.length;
  review(deps, "o/r", 7, words);
  return { posted: world.reviews.slice(before).map((r) => r.body), logs: logs.join("\n"), warns };
}

/** The 591 shape: six batches finish, the seventh stops on its budget, the eighth is never started. */
const stopsInBatchSeven = () =>
  new Provider((_files, call) => (call < 7 ? { cost: 0.45 } : { cost: 0.3, budget: true }));
const reviewsEverything = (cost = 0.2) => new Provider(() => ({ cost }));

const COMPLETE_MARKER = (sha: string) => `<!-- agent-review sha=${sha} -->`;

/** A world where the first review is the 591 partial one, at commit `aaaa0001`. */
function afterPartialReview() {
  const world = new World();
  world.push("aaaa0001", allFiles());
  const first = stopsInBatchSeven();
  const r = run(world, first);
  return { world, first, r };
}

describe("a push after a partial review resumes with the files it did not reach", () => {
  test("the setup is the observed one: seven calls, 12 of 16 files, the rest never reached", () => {
    const { first, r } = afterPartialReview();
    expect(first.requests).toHaveLength(7);
    expect(r.posted).toHaveLength(1);
    expect(r.posted[0]).toContain("⚠️ **Partial review**");
    expect(r.posted[0]).toContain("reviewed 12 of 16 files");
    expect(r.posted[0]).not.toContain(COMPLETE_MARKER("aaaa0001"));
  });

  test("the 591 sequence: the second run sends only the changed file and the unread ones, then the marker is complete", () => {
    const { world } = afterPartialReview();
    world.threads = [thread(501, F02)];
    // The author edits one file the first run had already reviewed.
    world.push("aaaa0002", allFiles({ [F01]: 1 }));
    const second = reviewsEverything();
    const r2 = run(world, second);

    // The reviewed, unchanged files are not sent again; the changed one and the four unread files are.
    expect(sentFiles(second).sort()).toEqual([F01, F13, F14, F15, F16].sort());
    // The changed file goes with what changed since the last review, the unread files with their whole diff.
    expect(promptOf(second, F01)).toContain(`SINCE ${F01}`);
    expect(promptOf(second, F13)).toContain(`${F13} r0 line 0`);
    expect(promptOf(second, F13)).not.toContain(`SINCE ${F13}`);
    // The prompt tells the model why those files come whole.
    expect(second.requests.map((r) => r.prompt).join("\n")).toContain("did not reach");
    // The pending thread gets its reply on this push, as on any push.
    expect(world.inlineReplies).toHaveLength(1);
    expect(world.inlineReplies[0]).toContain("Still applies.");
    // Everything is reviewed: the headline says so and the complete marker moves to the head.
    expect(r2.posted[0]).toContain("the 4 files the previous review did not reach");
    expect(r2.posted[0]).toContain("all 5 files reviewed");
    expect(r2.posted[0]).toContain(COMPLETE_MARKER("aaaa0002"));
    expect(r2.posted[0]).not.toContain("wachi:partial");

    // A third push takes the normal incremental path.
    world.push("aaaa0003", allFiles({ [F01]: 1, [F05]: 1 }));
    const third = reviewsEverything();
    const r3 = run(world, third);
    expect(sentFiles(third)).toEqual([F05]);
    expect(third.requests[0].prompt).toContain("only the changes since commit aaaa0002");
    expect(third.requests[0].prompt).not.toContain("did not reach");
    expect(r3.posted[0]).toContain(COMPLETE_MARKER("aaaa0003"));
  });

  test("a second partial in a row keeps only what is still not reviewed", () => {
    const { world } = afterPartialReview();
    world.push("aaaa0002", allFiles({ [F01]: 1 }));
    // Five files are due. The first part is reviewed; the second stops on its budget, the third is not started.
    const second = new Provider((_files, call) => (call === 1 ? { cost: 0.4 } : { cost: 0.5, budget: true }));
    const r2 = run(world, second, { AGENT_REVIEW_BUDGET_USD: "0.9" });
    expect(second.requests).toHaveLength(2);
    expect(r2.posted[0]).toContain("⚠️ **Partial review**");
    expect(r2.posted[0]).toContain("reviewed 2 of 5 files");
    expect(r2.posted[0]).not.toContain(COMPLETE_MARKER("aaaa0002"));

    // The next push reads the shorter list: the files the second run did read are not carried again.
    world.push("aaaa0003", allFiles({ [F01]: 1, [F05]: 1 }));
    const third = reviewsEverything();
    run(world, third);
    expect(sentFiles(third).sort()).toEqual([F05, F14, F15, F16].sort());
  });

  test("the same head with no push, by a comment or by ready for review, reviews only the unread files", () => {
    for (const trigger of ["comment", "ready_for_review"]) {
      const { world } = afterPartialReview();
      const again = reviewsEverything();
      const r = run(world, again, { AGENT_REVIEW_TRIGGER: trigger }, []);
      expect(sentFiles(again).sort()).toEqual([F13, F14, F15, F16].sort());
      expect(r.logs).not.toContain("Already reviewed");
      expect(r.posted[0]).toContain("the 4 files");
      expect(r.posted[0]).toContain("did not reach");
      expect(r.posted[0]).toContain(COMPLETE_MARKER("aaaa0001"));
      // Now the head is reviewed for good.
      const last = reviewsEverything();
      const r2 = run(world, last, { AGENT_REVIEW_TRIGGER: trigger }, []);
      expect(last.requests).toHaveLength(0);
      expect(r2.posted[0]).toContain("Already reviewed");
    }
  });

  test("a rebase with no content change after a partial review reviews the unread files and does not stop early", () => {
    const { world } = afterPartialReview();
    // The same change over a new head, reached by a rewrite of the branch.
    world.push("aaaa0002", allFiles(), "diverged");
    const second = reviewsEverything();
    const r = run(world, second);
    expect(sentFiles(second).sort()).toEqual([F13, F14, F15, F16].sort());
    expect(r.posted[0]).not.toContain("Rebased onto");
    expect(r.posted[0]).toContain("did not reach");
    expect(r.posted[0]).toContain(COMPLETE_MARKER("aaaa0002"));
  });

  test("with nothing unread left the early exits are the ones they were, and the marker is complete", () => {
    const { world } = afterPartialReview();
    // The four unread files left the pull request; the rest of the change is the one reviewed.
    world.push("aaaa0002", allFiles().filter((f) => ![F13, F14, F15, F16].includes(f.filename)), "diverged");
    const second = reviewsEverything();
    const r = run(world, second);
    expect(second.requests).toHaveLength(0);
    expect(r.posted[0]).toContain("Rebased onto");
    expect(r.posted[0]).toContain(COMPLETE_MARKER("aaaa0002"));
  });

  test("an unread file that left the pull request, or is excluded now, is dropped without a word", () => {
    const { world } = afterPartialReview();
    world.push("aaaa0002", allFiles({ [F01]: 1 }).filter((f) => f.filename !== F14));
    const second = reviewsEverything();
    const r = run(world, second, { AGENT_REVIEW_EXCLUDE: F15 });
    expect(sentFiles(second).sort()).toEqual([F01, F13, F16].sort());
    expect(r.posted[0]).toContain("all 3 files reviewed");
    expect(r.posted[0]).not.toContain(F14);
    expect(r.posted[0]).not.toContain(F15);
    expect(r.posted[0]).toContain(COMPLETE_MARKER("aaaa0002"));
  });

  test("a file that is both unread and changed since is sent once, with its whole diff", () => {
    const { world } = afterPartialReview();
    world.push("aaaa0002", allFiles({ [F13]: 1 }));
    const second = reviewsEverything();
    run(world, second);
    expect(sentFiles(second).sort()).toEqual([F13, F14, F15, F16].sort());
    expect(promptOf(second, F13)).toContain(`${F13} r1 line 0`);
    expect(promptOf(second, F13)).not.toContain(`SINCE ${F13}`);
  });

  test("a scoped review writes no marker and leaves the unread files for the next unscoped run", () => {
    const { world } = afterPartialReview();
    const scoped = reviewsEverything();
    const r = run(world, scoped, { AGENT_REVIEW_TRIGGER: "comment" }, [F01]);
    expect(sentFiles(scoped)).toEqual([F01]);
    expect(r.posted[0]).not.toContain("agent-review sha=");
    expect(r.posted[0]).not.toContain("wachi:partial");
    const next = reviewsEverything();
    run(world, next, { AGENT_REVIEW_TRIGGER: "comment" }, []);
    expect(sentFiles(next).sort()).toEqual([F13, F14, F15, F16].sort());
  });

  test("a file the model was sent and did not review is retried once, then named and left out for good", () => {
    const world = new World();
    world.push("aaaa0001", allFiles());
    // Every call reviews every file but F03, which the model keeps leaving out (the retry included).
    const leavesOutF03 = (cost: number) =>
      new Provider((files) => ({ cost, reviewed: files.filter((f) => f !== F03) }));
    const first = leavesOutF03(0.05);
    const r1 = run(world, first);
    expect(r1.posted[0]).toContain("⚠️ **Partial review**");
    expect(r1.posted[0]).toContain("reviewed 15 of 16 files");

    // A push: F03 is carried and sent again; the model still does not review it.
    world.push("aaaa0002", allFiles({ [F10]: 1 }));
    const second = leavesOutF03(0.05);
    const r2 = run(world, second);
    expect(sentFiles(second)).toContain(F03);
    expect(promptOf(second, F03)).toContain(`${F03} r0 line 0`);
    expect(r2.posted[0]).toContain("after two tries");
    expect(r2.posted[0]).toContain(F03);
    expect(r2.posted[0]).toContain(`review <paths>`);
    // It left the list for good, so the marker is complete and the next push does not carry it.
    expect(r2.posted[0]).toContain(COMPLETE_MARKER("aaaa0002"));
    world.push("aaaa0003", allFiles({ [F10]: 1, [F05]: 1 }));
    const third = reviewsEverything();
    run(world, third);
    expect(sentFiles(third)).toEqual([F05]);
  });

  test("a file the run did not reach is carried as long as the pull request's ceiling allows", () => {
    const { world } = afterPartialReview();
    // Two more runs that again stop before F16: it is "not reached" each time, never "sent and not reviewed".
    for (const sha of ["aaaa0002", "aaaa0003"]) {
      world.push(sha, allFiles({ [F01]: sha === "aaaa0002" ? 1 : 2 }));
      const next = new Provider((_files, call) => (call === 1 ? { cost: 0.4 } : { cost: 0.5, budget: true }));
      const r = run(world, next, { AGENT_REVIEW_BUDGET_USD: "0.9" });
      expect(r.posted[0]).not.toContain("after two tries");
    }
    world.push("aaaa0004", allFiles({ [F01]: 2 }));
    const last = reviewsEverything();
    run(world, last);
    expect(sentFiles(last)).toContain(F16);
  });
});
