import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { GhError, SIGNATURE, SIZE_GATE_MARKER, comment, partialMarker, readAutoCost, review, type Deps, type GhFn, type ReviewOutput } from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// The room gate (ADR 0062): a review whose estimate is above the room the run may spend is not
// started, spends nothing and gets one comment, updated on each push. The estimate is priced from
// the diff alone. The operator approves one head with `--budget N --head SHA`.

const BASE = "b".repeat(40);
const HEAD = "abc1234" + "0".repeat(33);

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const files = [...request.prompt.split("This part holds exactly these files")[1].split("\n\n")[0].matchAll(/^- (\S+) \+/gm)].map((m) => m[1]);
    const output: ReviewOutput = { files_reviewed: files, files_skipped: [], findings: [], contracts: [], thread_replies: [], summary: "ok" };
    return { costUsd: 0.2, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, structuredOutput: output };
  }
}

/** One file of `lines` added lines, each in its own directory so no two share a module. */
const bigFile = (i: number, lines = 1000) => ({
  filename: `pkg${i}/mod.ts`,
  additions: lines,
  deletions: 0,
  patch: `@@ -0,0 +1,${lines} @@\n${Array.from({ length: lines }, (_, k) => `+line ${k}`).join("\n")}`,
});

interface Comment {
  id: number;
  user: { login: string };
  body: string;
}

/** A pull request as GitHub shows it, and every write the engine made to it. */
function world(files: unknown[], comments: Comment[] = [], base: Record<string, string> = {}, reviews: string[] = []) {
  const calls: string[] = [];
  const posted: { kind: "comment" | "patch" | "review"; target?: number; body: string }[] = [];
  let listed = 0;
  const gh: GhFn = (args, input) => {
    const line = args.join(" ");
    calls.push(line);
    if (line.startsWith("pr comment")) {
      posted.push({ kind: "comment", body: input ?? "" });
      return "";
    }
    if (args.includes("PATCH")) {
      const id = Number(line.match(/issues\/comments\/(\d+)/)?.[1]);
      posted.push({ kind: "patch", target: id, body: args[args.length - 1].replace(/^body=/, "") });
      return "{}";
    }
    if (args.includes("POST")) {
      if (line.includes("/pulls/7/reviews")) posted.push({ kind: "review", body: JSON.parse(input ?? "{}").body });
      return "{}";
    }
    if (line.includes("/issues/7/comments")) {
      listed += 1;
      // `gh --jq` already applied the bot filter and the projection; mirror that here.
      return comments
        .filter((c) => c.user.login === "github-actions[bot]")
        .map((c) => JSON.stringify({ id: c.id, body: c.body }))
        .join("\n");
    }
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.includes("/pulls/7/files")) return files.map((f) => JSON.stringify(f)).join("\n");
    if (line.includes("/pulls/7/reviews"))
      return reviews.map((body) => JSON.stringify({ body, submitted_at: "2026-11-06T00:00:00Z" })).join("\n");
    if (line.includes("/pulls/7/comments")) return "";
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (line.includes("/contents/")) {
      const m = line.match(/contents\/(.+)\?ref=(.+)$/);
      if (m && m[2] === BASE && base[m[1]] !== undefined) {
        return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(base[m[1]]).toString("base64") });
      }
      throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    }
    const compare = line.match(/compare\/(\S+?)\.\.\.(\S+)/);
    if (compare) return JSON.stringify({ status: "ahead", files });
    throw new Error(`unexpected gh call: ${line}`);
  };
  return { gh, calls, posted, listCalls: () => listed };
}

async function run(w: ReturnType<typeof world>, env: Record<string, string> = {}, words: string[] = []) {
  const provider = new FakeProvider();
  const logs: string[] = [];
  const deps: Deps = {
    gh: w.gh,
    provider,
    config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "synchronize", WACHIMAN_MODEL: "claude-sonnet-5-5", WACHIMAN_OPERATOR: "owner", ...env }),
    repoDir: mkdtempSync(join(tmpdir(), "size-gate-head-")),
    log: (l) => void logs.push(l),
    warn: () => {},
    lineCounter: () => 100,
    sleep: () => {},
  };
  await review(deps, "o/r", 7, words);
  return { provider, logs: logs.join("\n") };
}

/** The operator's (or anyone's) comment, through the same handler the workflow calls. */
async function say(w: ReturnType<typeof world>, request: string, author = "owner", env: Record<string, string> = {}) {
  const provider = new FakeProvider();
  const logs: string[] = [];
  const deps: Deps = {
    gh: w.gh,
    provider,
    config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "comment", WACHIMAN_MODEL: "claude-sonnet-5-5", WACHIMAN_OPERATOR: "owner", ...env }),
    repoDir: mkdtempSync(join(tmpdir(), "size-gate-head-")),
    log: (l) => void logs.push(l),
    warn: (l) => void logs.push(l),
    lineCounter: () => 100,
    sleep: () => {},
  };
  await comment(deps, "o/r", 7, request, author);
  return { provider, logs: logs.join("\n") };
}

/** A signed automatic review that spent `cost`, as the ceiling reads it. */
const spentReview = (cost: number) => `👮 review\n\n<sub>m · $${cost.toFixed(2)}</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;

/** 30 files of 1,000 lines: 30 batches, about $9.60 at the Sonnet figure, above the $6 default gate. */
const LARGE = Array.from({ length: 30 }, (_, i) => bigFile(i));
const SMALL = [bigFile(0, 20), bigFile(1, 20)];

describe("a review the run cannot pay for in full is skipped with one comment", () => {
  test("no model call, one comment with the marker, no review and no review marker", async () => {
    const w = world(LARGE);
    const { provider, logs } = await run(w);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted).toHaveLength(1);
    const [c] = w.posted;
    expect(c.kind).toBe("comment");
    expect(c.body).toContain(SIZE_GATE_MARKER);
    expect(c.body).toContain("Not reviewed: this review would cost more than the run can spend.");
    expect(c.body).not.toContain("wachiman sha=");
    expect(w.posted.some((p) => p.kind === "review")).toBe(false);
    expect(logs).toContain("room");
  });

  test("AC4: pull request 287's numbers: $5.76 estimated against a $3 budget makes no call and posts one comment", async () => {
    const w = world(Array.from({ length: 18 }, (_, i) => bigFile(i)));
    const { provider } = await run(w);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted.map((p) => p.kind)).toEqual(["comment"]);
    expect(w.posted[0].body).toContain("about **$5.76**");
    expect(w.posted[0].body).toContain("room for **$3.00**");
  });

  test("AC5: the comment names the estimate, the room, the short head and the command that approves this head", async () => {
    const w = world(LARGE);
    await run(w);
    expect(w.posted[0].body).toBe(
      [
        "👮 **Wachiman** · **Not reviewed: this review would cost more than the run can spend.** Reviewing all of it would cost about **$9.60**, and this run has room for **$3.00**, so nothing was sent to a model and nothing was spent.",
        "The estimate: 30 batches × $0.32 a batch for `claude-sonnet-5-5` (30 files, 30,000 changed lines), from the diff alone, before any model call. It can be off by about 40% either way. The room is **$3.00**: the run budget (`budget_usd`) is $3.00.",
        "To review all of it, the operator comments this, which approves a budget of **$15** for the head `abc1234` and for no other:",
        "```\n/wachiman review --budget 15 --head abc1234\n```",
        "The run may pass the approved figure by about one call. A push cancels the approval, and the next automatic run estimates the new head. To review part of it now, comment `/wachiman review <path> [path…]`.",
        "<sub>Estimated at `abc1234`. A run can pass its budget by about one call. This comment is updated on each push instead of a new one.</sub>",
        SIZE_GATE_MARKER,
      ].join("\n\n"),
    );
  });

  test("an estimate above approve_max_usd offers no command that would be skipped again", async () => {
    // 60 files: $19.20, so N is $29, above the $20 default.
    const w = world(Array.from({ length: 60 }, (_, i) => bigFile(i)));
    await run(w);
    const body = w.posted[0].body;
    expect(body).not.toContain("--budget");
    expect(body).toContain("**$29**");
    expect(body).toContain("`approve_max_usd` ($20.00)");
    expect(body).toContain("/wachiman review <path> [path…]");
    // Raising the cap makes the command appear.
    const raised = world(Array.from({ length: 60 }, (_, i) => bigFile(i)));
    await run(raised, { WACHIMAN_APPROVE_MAX_USD: "30" });
    expect(raised.posted[0].body).toContain("/wachiman review --budget 29 --head abc1234");
  });

  test("AC15: with verify on, the room and N include the reserves", async () => {
    const w = world(LARGE);
    await run(w, { WACHIMAN_VERIFY: "1" });
    const body = w.posted[0].body;
    expect(body).toContain("this run has room for **$2.00**");
    expect(body).toContain("$3.00, less $1.00 that the verifier and memory matching keep");
    expect(body).toContain("--budget 16 --head abc1234");
  });

  test("an operator's review is skipped the same way and gets the approval command", async () => {
    const w = world(LARGE);
    const { provider } = await run(w, { WACHIMAN_TRIGGER: "comment" });
    expect(provider.requests).toHaveLength(0);
    expect(w.posted[0].body).toContain("/wachiman review --budget 15 --head abc1234");
  });

  test("the comment carries no cost line, so the per-pull-request ceiling does not count it", async () => {
    const w = world(LARGE);
    await run(w);
    expect(readAutoCost(w.posted[0].body)).toBeNull();
  });

  test("an existing comment of the bot is updated, not duplicated", async () => {
    const w = world(LARGE, [
      { id: 11, user: { login: "github-actions[bot]" }, body: `old\n\n${SIZE_GATE_MARKER}` },
      { id: 12, user: { login: "github-actions[bot]" }, body: `newer\n\n${SIZE_GATE_MARKER}` },
    ]);
    await run(w);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]).toMatchObject({ kind: "patch", target: 12 });
    expect(w.posted[0].body).toContain("Not reviewed");
    expect(w.posted.filter((p) => p.kind === "comment")).toHaveLength(0);
  });

  test("a marker planted by a person is ignored: the bot posts its own comment", async () => {
    const w = world(LARGE, [{ id: 5, user: { login: "someone" }, body: `fake\n\n${SIZE_GATE_MARKER}` }]);
    await run(w);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].kind).toBe("comment");
  });

  test("a dry run logs the comment and calls no write", async () => {
    const w = world(LARGE);
    const { logs } = await run(w, { WACHIMAN_DRY_RUN: "1" });
    expect(logs).toContain("--- size gate comment ---");
    expect(w.posted).toHaveLength(0);
    expect(w.calls.some((c) => c.includes("/issues/7/comments"))).toBe(false);
  });

  test("a scoped run is estimated on the scoped files only", async () => {
    const w = world(LARGE);
    const { provider } = await run(w, { WACHIMAN_TRIGGER: "comment" }, ["pkg0/mod.ts"]);
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(w.posted.some((p) => p.body.includes(SIZE_GATE_MARKER))).toBe(false);
  });
});

describe("the ceiling is read before the comparison (AC15)", () => {
  /** 7 files: $2.24, which the $3 budget covers but a nearly spent ceiling does not. */
  const TWO_DOLLARS = Array.from({ length: 7 }, (_, i) => bigFile(i));

  test("$5.50 of the $6 ceiling spent and a $2.24 estimate: skipped with room $0.50, and plain `/wachiman review` lifts it", async () => {
    const w = world(TWO_DOLLARS, [], {}, [spentReview(5.5)]);
    const { provider } = await run(w);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted.map((p) => p.kind)).toEqual(["comment"]);
    const body = w.posted[0].body;
    expect(body).toContain("this run has room for **$0.50**");
    expect(body).toContain("what is left of the pull request's automatic ceiling (`auto_budget_usd`) is $0.50");
    expect(body).toContain("comment `/wachiman review`");
    expect(body).not.toContain("--budget");
  });

  test("with less than $0.05 of the ceiling left, today's pause notice is posted, not the priced comment", async () => {
    const w = world(TWO_DOLLARS, [], {}, [spentReview(5.97)]);
    const { provider } = await run(w);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted.map((p) => p.kind)).toEqual(["review"]);
    expect(w.posted[0].body).toContain("Automatic reviews paused");
    expect(w.posted.some((p) => p.body.includes(SIZE_GATE_MARKER))).toBe(false);
  });

  test("with $0.10 left and a $2.24 estimate it is the priced comment", async () => {
    const w = world(TWO_DOLLARS, [], {}, [spentReview(5.9)]);
    await run(w);
    expect(w.posted.map((p) => p.kind)).toEqual(["comment"]);
    expect(w.posted[0].body).toContain("this run has room for **$0.10**");
  });

  test("the ceiling and budget_usd both below the estimate: it offers --budget, never a plain review that would be skipped again", async () => {
    const w = world(LARGE, [], {}, [spentReview(5.5)]);
    await run(w);
    const body = w.posted[0].body;
    expect(body).toContain("/wachiman review --budget 15 --head abc1234");
    expect(body).not.toContain("comment `/wachiman review`");
  });

  test("an estimate the room covers is reviewed", async () => {
    const w = world(SMALL, [], {}, [spentReview(5.5)]);
    const { provider } = await run(w);
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(w.posted.some((p) => p.kind === "review")).toBe(true);
  });
});

describe("the room lifts", () => {
  test("budget_usd alone lifts it for /wachiman review, but an automatic run also needs the ceiling", async () => {
    const env = { WACHIMAN_BUDGET_USD: "12" };
    const operator = world(LARGE);
    const a = await run(operator, { ...env, WACHIMAN_TRIGGER: "comment" });
    expect(a.provider.requests.length).toBeGreaterThan(0);
    expect(operator.posted.some((p) => p.body.includes(SIZE_GATE_MARKER))).toBe(false);

    const automatic = world(LARGE);
    const b = await run(automatic, env);
    expect(b.provider.requests).toHaveLength(0);
    expect(automatic.posted.map((p) => p.kind)).toEqual(["comment"]);
    // The ceiling is the short term and the budget covers the estimate: plain review.
    expect(automatic.posted[0].body).toContain("comment `/wachiman review`");

    const both = world(LARGE);
    const c = await run(both, { ...env, WACHIMAN_AUTO_BUDGET_USD: "12" });
    expect(c.provider.requests.length).toBeGreaterThan(0);
  });

  test("a raised WACHIMAN_SIZE_GATE_USD no longer lifts anything (AC9)", async () => {
    const w = world(LARGE);
    const { provider } = await run(w, { WACHIMAN_SIZE_GATE_USD: "10" });
    expect(provider.requests).toHaveLength(0);
    expect(w.posted.map((p) => p.kind)).toEqual(["comment"]);
  });
});

describe("the operator approves one head (AC6, AC7, AC8)", () => {
  const APPROVE = "/wachiman review --budget 15 --head abc1234";

  test("AC6: --budget N --head SHA from the operator reviews with budget N, and the footer names it", async () => {
    const w = world(LARGE);
    const { provider } = await say(w, APPROVE);
    expect(provider.requests).toHaveLength(30);
    expect(w.posted.some((p) => p.body.includes(SIZE_GATE_MARKER))).toBe(false);
    const review = w.posted.find((p) => p.kind === "review")!;
    expect(review.body).toContain("approved budget $15.00");
  });

  test("a longer prefix of the head is accepted, upper case too", async () => {
    const w = world(SMALL);
    const { provider } = await say(w, `/wachiman review --budget 2 --head ${HEAD.slice(0, 12).toUpperCase()}`);
    expect(provider.requests.length).toBeGreaterThan(0);
  });

  test("the approval words and their values are not paths: only the named path is reviewed", async () => {
    const w = world(LARGE);
    const { provider, logs } = await say(w, `${APPROVE} pkg0/mod.ts`);
    expect(provider.requests).toHaveLength(1);
    expect(logs).not.toContain("Not paths in this pull request");
  });

  test("AC7: a stale head is refused with one reply and no call", async () => {
    const w = world(LARGE);
    const { provider } = await say(w, "/wachiman review --budget 15 --head def5678");
    expect(provider.requests).toHaveLength(0);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].body).toContain("`def5678` is not the head of this pull request, which is `abc1234`");
    expect(w.posted[0].body).toContain("push");
  });

  test("AC7: a budget that is 0, negative, not a number, infinite or above approve_max_usd is refused with the reason", async () => {
    for (const [value, reason] of [
      ["0", "above 0"],
      ["-3", "above 0"],
      ["NaN", "above 0"],
      ["Infinity", "above 0"],
      ["abc", "above 0"],
      ["1e3", "above 0"],
      ["21", "`approve_max_usd` ($20.00)"],
    ] as const) {
      const w = world(LARGE);
      const { provider } = await say(w, `/wachiman review --budget ${value} --head abc1234`);
      expect(provider.requests).toHaveLength(0);
      expect(w.posted).toHaveLength(1);
      expect(w.posted[0].body).toContain(reason);
    }
  });

  test("AC7: a larger approve_max_usd accepts what the default refuses", async () => {
    const w = world(LARGE);
    const { provider } = await say(w, "/wachiman review --budget 21 --head abc1234", "owner", { WACHIMAN_APPROVE_MAX_USD: "25" });
    expect(provider.requests).toHaveLength(30);
  });

  test("AC7: one word without the other, a missing value and --budget=N are refused, never read as paths", async () => {
    for (const request of [
      "/wachiman review --budget 8",
      "/wachiman review --head abc1234",
      "/wachiman review --budget",
      "/wachiman review --budget=8 --head abc1234",
      "/wachiman review --budget 8 --head",
    ]) {
      const w = world(LARGE);
      const { provider, logs } = await say(w, request);
      expect(provider.requests).toHaveLength(0);
      expect(w.posted).toHaveLength(1);
      expect(w.posted[0].kind).toBe("review");
      expect(logs).not.toContain("Not paths in this pull request");
    }
  });

  test("AC7: from anyone but the operator the command is ignored as today: no call, no reply", async () => {
    for (const env of [{}, { WACHIMAN_ASKERS: "write" }]) {
      const w = world(LARGE);
      const { provider } = await say(w, APPROVE, "someone-else", env);
      expect(provider.requests).toHaveLength(0);
      expect(w.posted).toHaveLength(0);
    }
    // The same for the words that would be refused from the operator.
    const w = world(LARGE);
    await say(w, "/wachiman review --budget 0", "someone-else");
    expect(w.posted).toHaveLength(0);
  });

  test("AC8: a rerun of the approved job on a head whose review is complete spends nothing", async () => {
    const complete = `👮 review\n\n<sub>m · $1.00</sub>\n\n${SIGNATURE.review}\n\n<!-- wachiman sha=${HEAD} -->`;
    const w = world(LARGE, [], {}, [complete]);
    const { provider } = await say(w, APPROVE);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].body).toContain("Already reviewed at `abc1234`");
  });

  test("AC8: after a partial review it resumes the unread files within N", async () => {
    const rest = ["pkg0/mod.ts", "pkg1/mod.ts"];
    const partial = `👮 partial\n\n<sub>m · $3.00</sub>\n\n${SIGNATURE.review}\n\n${partialMarker({ sha: HEAD, rest, tried: [] })}`;
    const w = world(LARGE, [], {}, [partial]);
    const { provider } = await say(w, APPROVE);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.every((r) => r.maxBudgetUsd <= 15)).toBe(true);
    expect(w.posted.find((p) => p.kind === "review")!.body).toContain("approved budget $15.00");
  });
});

describe("a skipped pull request names the critical paths it changes", () => {
  const rules = (...entries: [string, string, string][]) =>
    ["paths:", ...entries.flatMap(([match, severity, reason]) => [`  - match: "${match}"`, `    severity: ${severity}`, `    reason: ${reason}`]), ""].join("\n");
  const THE_COMMENT = "**Critical paths in this change** (from `.wachiman.yml` at the base commit): a person should read these before merging, since nothing was reviewed.";

  test("each changed file a critical rule matches is listed with its reason, after the headline", async () => {
    const w = world(LARGE, [], { ".wachiman.yml": rules(["pkg3/**", "critical", "holds the payment keys"], ["pkg5/**", "high", "not critical"]) });
    const { provider } = await run(w);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted).toHaveLength(1);
    const paragraphs = w.posted[0].body.split("\n\n");
    expect(paragraphs[1]).toBe(`${THE_COMMENT}\n- \`pkg3/mod.ts\`: holds the payment keys`);
    expect(w.posted[0].body).not.toContain("pkg5/mod.ts");
    expect(w.posted[0].body).toContain(SIZE_GATE_MARKER);
  });

  test("a critical match never lifts the gate", async () => {
    const w = world(LARGE, [], { ".wachiman.yml": rules(["**/mod.ts", "critical", "everything"]) });
    const { provider } = await run(w);
    expect(provider.requests).toHaveLength(0);
    expect(w.posted.map((p) => p.kind)).toEqual(["comment"]);
  });

  test("the list stops at 20 and says how many more", async () => {
    const w = world(LARGE, [], { ".wachiman.yml": rules(["**/mod.ts", "critical", "everything"]) });
    await run(w);
    const lines = w.posted[0].body.split("\n").filter((l) => l.startsWith("- `pkg"));
    expect(lines).toHaveLength(20);
    expect(w.posted[0].body).toContain("\n- and 10 more\n");
  });

  test("a gated pull request that edits the path rules lists .wachiman.yml with its reason", async () => {
    const base = rules(["pkg3/**", "critical", "holds the payment keys"]);
    const settings = { filename: ".wachiman.yml", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" };
    // The head has no .wachiman.yml, so the rules at the base were removed: a policy change.
    const w = world([...LARGE, settings], [], { ".wachiman.yml": base });
    await run(w);
    expect(w.posted[0].body).toContain("\n- `.wachiman.yml`: edits the review's path rules");
    expect(w.posted[0].body).toContain("- `pkg3/mod.ts`: holds the payment keys");
  });

  test("a reason is neutralised", async () => {
    const w = world(LARGE, [], { ".wachiman.yml": rules(["pkg1/**", "critical", '"see <!-- wachi:size-gate -->"']) });
    await run(w);
    expect(w.posted[0].body.split(SIZE_GATE_MARKER)).toHaveLength(2);
    expect(w.posted[0].body).toContain("see &lt;!-- wachi:size-gate --&gt;");
  });

  test("with no critical match the comment is the one without a section", async () => {
    const plain = world(LARGE);
    await run(plain);
    for (const base of [{ ".wachiman.yml": rules(["pkg3/**", "high", "r"]) }, { ".wachiman.yml": rules(["nowhere/**", "critical", "r"]) }, { ".wachiman.yml": "effort: high\n" }]) {
      const w = world(LARGE, [], base);
      await run(w);
      expect(w.posted[0].body).toBe(plain.posted[0].body);
    }
  });
});

describe("a pull request below the gate is reviewed as before", () => {
  test("it never lists the issue comments", async () => {
    const w = world(SMALL);
    const { provider } = await run(w);
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(w.listCalls()).toBe(0);
    expect(w.posted.some((p) => p.kind === "review")).toBe(true);
  });
});
