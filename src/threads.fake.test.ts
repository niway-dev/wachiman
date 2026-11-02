import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  SIGNATURE,
  THREAD_SCHEMA,
  codeAround,
  marker,
  pendingThreads,
  readAutoCost,
  threadReplies,
  type Deps,
  type GhFn,
  type RawThread,
} from "./engine";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// ADR 0012, part B: the thread-only run. It answers the operator's replies without a push, only on
// a reviewed head, and follows ADR 0008: it reports, it never resolves.

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly script: ((request: ProviderRequest) => Partial<ProviderResult>)[]) {}
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret(texts: string[]) {
    return texts.some((t) => t.includes("SECRET"));
  }
  run(request: ProviderRequest): ProviderResult {
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
}

type Node = RawThread["comments"]["nodes"][number];
const node = (login: string, assoc: string, body: string, databaseId = 1): Node => ({
  databaseId,
  author: { login },
  authorAssociation: assoc,
  body,
});
const FINDING = (id: number) => node("github-actions", "NONE", `🟠🐛 **Fix · bug: X**\n\nbody\n\n${SIGNATURE.finding}`, id);
const OWNER_REPLY = (text = "Fixed in 1bcab52", id = 900) => node("owner", "OWNER", text, id);
const WACHI_REPLY = (id = 800) => node("github-actions", "NONE", `👮 **Wachiman** · **Still applies** at \`abc1234\`: no.\n\n${SIGNATURE.reply}`, id);
const thread = (nodes: Node[], over: Partial<RawThread> = {}): RawThread => ({
  isResolved: false,
  path: "src/a.ts",
  line: 3,
  comments: { nodes },
  ...over,
});

describe("pendingThreads", () => {
  test("a thread whose latest comment is the owner's reply is pending", () => {
    const [t] = pendingThreads([thread([FINDING(7), OWNER_REPLY()])]);
    expect(t.comment_id).toBe(7);
    expect(t.wachi_replies).toBe(0);
    expect(t.replies).toEqual([{ author: "owner", body: "Fixed in 1bcab52" }]);
  });

  test("a thread nobody replied to, or whose latest comment is Wachiman's, is not pending", () => {
    expect(pendingThreads([thread([FINDING(7)])])).toEqual([]);
    expect(pendingThreads([thread([FINDING(7), OWNER_REPLY(), WACHI_REPLY()])])).toEqual([]);
  });

  test("an owner reply after Wachiman's first reply is pending again, with one reply counted", () => {
    const [t] = pendingThreads([thread([FINDING(7), OWNER_REPLY(), WACHI_REPLY(), OWNER_REPLY("Still wrong?", 901)])]);
    expect(t.wachi_replies).toBe(1);
  });

  test("a third reply in a thread with two Wachiman replies gets no answer", () => {
    const nodes = [FINDING(7), OWNER_REPLY(), WACHI_REPLY(800), OWNER_REPLY("again", 901), WACHI_REPLY(801), OWNER_REPLY("and again", 902)];
    expect(pendingThreads([thread(nodes)])).toEqual([]);
  });

  test("only a reply signed as the engine's counts toward the cap", () => {
    const imitation = node("github-actions", "NONE", "👮 **Wachiman** · another workflow said this", 802);
    const [t] = pendingThreads([thread([FINDING(7), OWNER_REPLY(), imitation, WACHI_REPLY(801), OWNER_REPLY("x", 902)])]);
    // The imitation is the latest-but-one comment, not a Wachiman reply: one real reply so far.
    expect(t.wachi_replies).toBe(1);
  });

  test("a stranger's latest reply does not make a thread pending", () => {
    expect(pendingThreads([thread([FINDING(7), node("rando", "NONE", "lol")])])).toEqual([]);
    expect(pendingThreads([thread([FINDING(7), node("rando", "CONTRIBUTOR", "lol")])])).toEqual([]);
  });

  test("a collaborator's reply counts, and resolved or foreign threads never do", () => {
    expect(pendingThreads([thread([FINDING(7), node("mate", "COLLABORATOR", "done")])])).toHaveLength(1);
    expect(pendingThreads([thread([FINDING(7), OWNER_REPLY()], { isResolved: true })])).toEqual([]);
    const foreign = node("github-actions", "NONE", "Some other workflow's comment", 5);
    expect(pendingThreads([thread([foreign, OWNER_REPLY()])])).toEqual([]);
  });
});

describe("codeAround", () => {
  test("numbers the head's lines around the finding, and never reads outside the head", () => {
    const dir = mkdtempSync(join(tmpdir(), "head-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/a.ts"), Array.from({ length: 40 }, (_, i) => `row ${i + 1}`).join("\n"));
    const text = codeAround(dir, "src/a.ts", 20) ?? "";
    expect(text.split("\n")[0]).toBe("8: row 8");
    expect(text).toContain("20: row 20");
    expect(text.split("\n").at(-1)).toBe("32: row 32");
    expect(codeAround(dir, "src/a.ts", null)).toBeNull();
    expect(codeAround(dir, "src/missing.ts", 3)).toBeNull();
    expect(codeAround(dir, "../outside.ts", 3)).toBeNull();
    expect(codeAround(dir, "/etc/passwd", 1)).toBeNull();
  });
});

describe("threadReplies (cli.ts threads)", () => {
  const HEAD = "head1234567";
  const OTHER_HEAD = "moved7654321";

  interface Opts {
    /** The marker's commit in the last review, or null for none. */
    reviewedAt?: string | null;
    /** Threads GitHub lists, per graphql call (the last one repeats). */
    threads?: RawThread[][];
    /** Heads `pr view` answers, per call (the last one repeats). */
    heads?: string[];
    spent?: number;
    ceiling?: string;
    operator?: string;
    script?: ((request: ProviderRequest) => Partial<ProviderResult>)[];
    env?: Record<string, string>;
    files?: Record<string, string>;
    existingNotice?: string;
  }

  function setup(opts: Opts = {}) {
    const dir = mkdtempSync(join(tmpdir(), "head-"));
    for (const [path, text] of Object.entries(opts.files ?? { "src/a.ts": Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join("\n") })) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const reviewedAt = opts.reviewedAt === undefined ? HEAD : opts.reviewedAt;
    const reviews: string[] = [];
    if (reviewedAt) reviews.push(`👮 review\n\n<sub>m · $0.20</sub>\n\n${SIGNATURE.review}\n\n${marker(reviewedAt)}`);
    if (opts.spent) reviews.push(`x\n\n<sub>m · $${opts.spent.toFixed(2)}</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`);
    if (opts.existingNotice) reviews.push(`Paused\n\n${SIGNATURE.review}\n\n<!-- wachi:ceiling usd=${opts.existingNotice} -->`);
    const calls: string[] = [];
    const replies: { id: number; body: string }[] = [];
    const notices: string[] = [];
    let graphql = 0;
    let views = 0;
    const threads = opts.threads ?? [[thread([FINDING(7), OWNER_REPLY()])]];
    const heads = opts.heads ?? [HEAD];
    const gh: GhFn = (args, input) => {
      const line = args.join(" ");
      calls.push(line);
      if (line.startsWith("pr view") && line.includes("headRefOid"))
        return JSON.stringify({ headRefOid: heads[Math.min(views++, heads.length - 1)] });
      if (line.startsWith("pr view")) return JSON.stringify({ title: "t", body: "b", author: { login: "u" } });
      if (line.includes("/pulls/7/reviews") && !args.includes("POST"))
        return reviews.map((body) => JSON.stringify({ body, submitted_at: "2026-11-02T00:00:00Z" })).join("\n");
      if (line.includes("/pulls/7/comments") && !args.includes("POST")) return "";
      if (line.includes("-X POST repos/o/r/pulls/7/reviews")) {
        const body = JSON.parse(input ?? "{}").body as string;
        notices.push(body);
        reviews.push(body);
        return "{}";
      }
      const reply = line.match(/-X POST repos\/o\/r\/pulls\/7\/comments\/(\d+)\/replies -f body=([\s\S]*)$/);
      if (reply) {
        replies.push({ id: Number(reply[1]), body: reply[2] });
        return "{}";
      }
      if (line.startsWith("api graphql")) {
        const nodes = threads[Math.min(graphql++, threads.length - 1)];
        return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } });
      }
      throw new Error(`unexpected gh call: ${line}`);
    };
    const provider = new FakeProvider(
      opts.script ?? [
        () => ({
          costUsd: 0.12,
          structuredOutput: {
            thread_replies: [{ comment_id: 7, status: "addressed", reply: "The guard now runs first.", cites: ["src/a.ts:3"] }],
          },
        }),
      ],
    );
    const deps: Deps = {
      gh,
      provider,
      config: { ...loadConfig({ AGENT_REVIEW_OPERATOR: opts.operator ?? "owner", ...opts.env }), trigger: "thread" },
      repoDir: dir,
      log: () => {},
      warn: () => void warnings.push("w"),
      sleep: () => {},
    };
    const warnings: string[] = [];
    return { deps, provider, calls, replies, notices, warnings, dir };
  }

  const resolves = (calls: string[]) => calls.filter((c) => /resolveReviewThread|unresolve/i.test(c));

  test("an operator reply on a reviewed head gets one reply in the thread citing path:line; the thread is not resolved", () => {
    const t = setup();
    threadReplies(t.deps, "o/r", 7, "owner");
    expect(t.provider.requests).toHaveLength(1);
    expect(t.replies).toHaveLength(1);
    expect(t.replies[0].id).toBe(7);
    expect(t.replies[0].body).toContain("**Appears addressed in `src/a.ts:3`**");
    expect(t.replies[0].body).toContain("The guard now runs first.");
    expect(t.replies[0].body.trimEnd().endsWith(SIGNATURE.reply)).toBe(true);
    expect(resolves(t.calls)).toEqual([]);
    expect(t.calls.some((c) => /graphql.*mutation/.test(c))).toBe(false);
  });

  test("the call is one provider call with the thread schema, the read-only tools and the thread budget", () => {
    const t = setup();
    threadReplies(t.deps, "o/r", 7);
    const request = t.provider.requests[0];
    expect(request.outputSchema).toBe(THREAD_SCHEMA);
    expect(request.allowedTools).toEqual(["read", "glob", "grep"]);
    expect(request.maxBudgetUsd).toBe(0.25);
    expect(request.prompt).toContain("threads.json");
    expect(request.prompt).toContain("do not report new findings");
    expect(request.prompt).toContain("never \"tested\"");
  });

  test("threads.json holds the finding, the replies, the reply count and the head's code at the lines", () => {
    const t = setup();
    threadReplies(t.deps, "o/r", 7);
    const dir = t.provider.requests[0].addDirs[0];
    const file = JSON.parse(readFileSync(join(dir, "threads.json"), "utf8"));
    expect(file).toHaveLength(1);
    expect(file[0]).toMatchObject({ comment_id: 7, path: "src/a.ts", line: 3, wachi_replies: 0 });
    expect(file[0].replies).toEqual([{ author: "owner", body: "Fixed in 1bcab52" }]);
    expect(file[0].code).toContain("3: row 3");
  });

  test("the first reply records the run's cost, flagged automatic, for the ceiling; later ones carry none", () => {
    const t = setup({
      threads: [[thread([FINDING(7), OWNER_REPLY()]), thread([FINDING(8), OWNER_REPLY("nope", 901)])]],
      script: [
        () => ({
          costUsd: 0.12,
          structuredOutput: {
            thread_replies: [
              { comment_id: 7, status: "addressed", reply: "Yes.", cites: ["src/a.ts:3"] },
              { comment_id: 8, status: "still_open", reply: "No, because of row 5.", cites: ["src/a.ts:5"] },
            ],
          },
        }),
      ],
    });
    threadReplies(t.deps, "o/r", 7);
    expect(t.replies.map((r) => r.id)).toEqual([7, 8]);
    expect(readAutoCost(t.replies[0].body)).toBe(0.12);
    expect(readAutoCost(t.replies[1].body)).toBeNull();
    expect(t.replies[1].body).toContain("**Still applies**");
  });

  test("an unreviewed push: no model call, no reply (the push's review will answer)", () => {
    const t = setup({ reviewedAt: "old1111111" });
    threadReplies(t.deps, "o/r", 7, "owner");
    expect(t.provider.requests).toHaveLength(0);
    expect(t.replies).toEqual([]);
    expect(t.notices).toEqual([]);
    // It did not even read the threads.
    expect(t.calls.some((c) => c.startsWith("api graphql"))).toBe(false);
  });

  test("a pull request never reviewed: no model call", () => {
    const t = setup({ reviewedAt: null });
    threadReplies(t.deps, "o/r", 7);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.replies).toEqual([]);
  });

  test("a reply by someone who is not the operator starts nothing", () => {
    const t = setup();
    threadReplies(t.deps, "o/r", 7, "stranger");
    expect(t.provider.requests).toHaveLength(0);
    expect(t.calls).toEqual([]);
    expect(t.warnings.length).toBeGreaterThan(0);
  });

  test("the operator comparison ignores case, and a placeholder operator is refused", () => {
    const t = setup({ operator: "Owner" });
    threadReplies(t.deps, "o/r", 7, "OWNER");
    expect(t.replies).toHaveLength(1);
    const bad = setup({ operator: "your-github-login" });
    expect(() => threadReplies(bad.deps, "o/r", 7, "your-github-login")).toThrow("placeholder");
    expect(bad.calls).toEqual([]);
    const empty = setup({ operator: "" });
    expect(() => threadReplies({ ...empty.deps, config: { ...empty.deps.config, operator: "" } }, "o/r", 7)).toThrow("empty");
  });

  test("a third owner reply in a thread with two Wachiman replies gets no answer and no model call", () => {
    const t = setup({
      threads: [[thread([FINDING(7), OWNER_REPLY(), WACHI_REPLY(800), OWNER_REPLY("2", 901), WACHI_REPLY(801), OWNER_REPLY("3", 902)])]],
    });
    threadReplies(t.deps, "o/r", 7);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.replies).toEqual([]);
  });

  test("no pending thread: no model call", () => {
    const t = setup({ threads: [[thread([FINDING(7)])]] });
    threadReplies(t.deps, "o/r", 7);
    expect(t.provider.requests).toHaveLength(0);
  });

  test("a thread that is not Wachiman's is never offered to the model", () => {
    const foreign = thread([node("github-actions", "NONE", "Other workflow", 5), OWNER_REPLY()]);
    const t = setup({ threads: [[foreign, thread([FINDING(7), OWNER_REPLY()])]] });
    threadReplies(t.deps, "o/r", 7);
    const file = JSON.parse(readFileSync(join(t.provider.requests[0].addDirs[0], "threads.json"), "utf8"));
    expect(file.map((x: { comment_id: number }) => x.comment_id)).toEqual([7]);
  });

  test("a reply for a thread the engine did not hand over, or one given twice, is ignored", () => {
    const t = setup({
      script: [
        () => ({
          costUsd: 0.05,
          structuredOutput: {
            thread_replies: [
              { comment_id: 999, status: "still_open", reply: "Elsewhere", cites: [] },
              { comment_id: 7, status: "still_open", reply: "First", cites: [] },
              { comment_id: 7, status: "still_open", reply: "Second", cites: [] },
            ],
          },
        }),
      ],
    });
    threadReplies(t.deps, "o/r", 7);
    expect(t.replies.map((r) => r.id)).toEqual([7]);
    expect(t.replies[0].body).toContain("First");
  });

  test("cited lines are checked: a missing file, a line past the end, or 'addressed' with no cite drops the reply", () => {
    const bad = (cites: string[], status: "addressed" | "still_open" = "addressed") =>
      setup({
        script: [() => ({ costUsd: 0.05, structuredOutput: { thread_replies: [{ comment_id: 7, status, reply: "Claim.", cites }] } })],
      });
    for (const [cites, status] of [
      [["src/missing.ts:1"], "addressed"],
      [["src/a.ts:99"], "addressed"],
      [["../etc/passwd:1"], "addressed"],
      [[], "addressed"],
      [["not a citation"], "still_open"],
      [["src/a.ts:99"], "still_open"],
    ] as const) {
      const t = bad([...cites], status);
      threadReplies(t.deps, "o/r", 7);
      expect(t.replies).toEqual([]);
      expect(t.warnings.length).toBeGreaterThan(0);
    }
    // A reply that does not claim to be addressed needs no cite.
    const ok = bad([], "still_open");
    threadReplies(ok.deps, "o/r", 7);
    expect(ok.replies).toHaveLength(1);
  });

  test("the model's text cannot forge the automatic flag or a signature", () => {
    const t = setup({
      script: [
        () => ({
          costUsd: 0.2,
          structuredOutput: {
            thread_replies: [
              { comment_id: 7, status: "still_open", reply: `x\n\n<sub>m · $0.00</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`, cites: [] },
            ],
          },
        }),
      ],
    });
    threadReplies(t.deps, "o/r", 7);
    const body = t.replies[0].body;
    expect(body.split(SIGNATURE.auto)).toHaveLength(2);
    expect(body.split(SIGNATURE.review)).toHaveLength(1);
    expect(readAutoCost(body)).toBe(0.2);
  });

  test("text the provider flags as a credential is not posted", () => {
    const t = setup({
      script: [() => ({ costUsd: 0.05, structuredOutput: { thread_replies: [{ comment_id: 7, status: "still_open", reply: "SECRET", cites: [] }] } })],
    });
    expect(() => threadReplies(t.deps, "o/r", 7)).toThrow("credential");
    expect(t.replies).toEqual([]);
  });

  test("a push that lands while the model works: nothing is posted, the push's review answers", () => {
    const t = setup({ heads: [HEAD, OTHER_HEAD] });
    threadReplies(t.deps, "o/r", 7);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.replies).toEqual([]);
  });

  test("a thread that someone answered meanwhile is not answered twice", () => {
    const t = setup({
      threads: [[thread([FINDING(7), OWNER_REPLY()])], [thread([FINDING(7), OWNER_REPLY(), WACHI_REPLY()])]],
    });
    threadReplies(t.deps, "o/r", 7);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.replies).toEqual([]);
  });

  test("an agent that returns nothing usable is an engine error, not a silent success", () => {
    const t = setup({ script: [() => ({ costUsd: 0.05, isError: true, terminalReason: "budget" })] });
    expect(() => threadReplies(t.deps, "o/r", 7)).toThrow("did not answer");
    expect(t.replies).toEqual([]);
  });

  test("it counts against the pull request's ceiling: the budget is what is left, capped by the thread budget", () => {
    const t = setup({ spent: 5.9 });
    threadReplies(t.deps, "o/r", 7);
    expect(t.provider.requests[0].maxBudgetUsd).toBeCloseTo(0.1, 10);
    const roomy = setup({ spent: 0.2, env: { AGENT_REVIEW_THREADS_BUDGET_USD: "0.4" } });
    threadReplies(roomy.deps, "o/r", 7);
    expect(roomy.provider.requests[0].maxBudgetUsd).toBe(0.4);
  });

  test("at the ceiling it posts the one notice and answers nothing; a second reply posts no second notice", () => {
    const t = setup({ spent: 6.0 });
    threadReplies(t.deps, "o/r", 7);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.replies).toEqual([]);
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toContain("Automatic reviews paused: $6.00 of $6.00");
    threadReplies(t.deps, "o/r", 7);
    expect(t.notices).toHaveLength(1);
  });

  test("with a notice already posted for this ceiling, nothing is posted", () => {
    const t = setup({ spent: 6.0, existingNotice: "6.00" });
    threadReplies(t.deps, "o/r", 7);
    expect(t.notices).toEqual([]);
    expect(t.provider.requests).toHaveLength(0);
  });

  test("a dry run logs the reply and posts nothing", () => {
    const t = setup({ env: { AGENT_REVIEW_DRY_RUN: "1" } });
    const logs: string[] = [];
    threadReplies({ ...t.deps, log: (l) => void logs.push(l) }, "o/r", 7);
    expect(t.replies).toEqual([]);
    expect(logs.join("\n")).toContain("Appears addressed");
  });
});
