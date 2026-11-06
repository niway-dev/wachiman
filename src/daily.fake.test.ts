import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  DailyLimitReached,
  GhError,
  SIGNATURE,
  answer,
  comment,
  marker,
  noCreditsFooter,
  readAutoCost,
  readNoCreditsDay,
  review,
  threadReplies,
  type Deps,
  type GhFn,
  type RawThread,
  type ReviewOutput,
  LEDGER_BYPASSED_FOOTER,
  LEDGER_FORCED_FOOTER,
} from "./engine";
import { LedgerUnavailable, readReceipt, type CurlFn } from "./ledger";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "./providers/types";

// ADR 0021: the engine reserves from the daily ledger before a run and settles after it. The
// ledger is a fake `curl`; the model is a fake provider. Both write to one event log, so the
// tests can assert the order of the calls.
//
// No golden prompts here: this feature changes no prompt (the ledger only decides the budget),
// and the prompts a fake run sends are already pinned by `ceiling.fake` and `threads.fake`.
// Recording a third copy would pin the same bytes again and add a fixture to keep in sync.

const HEAD = "head1234567";
const FILE = { filename: "a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" };
const LEDGER = "https://ledger.test";
const DAY = "2026-11-06";

const out = (over: Partial<ReviewOutput> = {}): ReviewOutput => ({
  files_reviewed: ["a.ts"],
  files_skipped: [],
  findings: [],
  contracts: [],
  thread_replies: [],
  summary: "ok",
  ...over,
});

type Step = (request: ProviderRequest) => Partial<ProviderResult>;

class FakeProvider implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(
    private readonly script: Step[],
    private readonly events: string[],
  ) {}
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret() {
    return false;
  }
  run(request: ProviderRequest): ProviderResult {
    this.events.push("model");
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (!step) throw new Error("the fake provider has no answer left");
    return { costUsd: 0, turns: 1, durationMs: 1, terminalReason: "success", isError: false, raw: {}, ...step(request) };
  }
}

interface LedgerOpts {
  /** The answer to `/v1/reserve`; default grants what was wanted. */
  reserve?: (wanted: number) => { status: number; body: unknown };
  /** Make the id-token request fail (no `id-token: write`). */
  noToken?: boolean;
  /** Make every curl call fail at the network level. */
  down?: boolean;
}

/** A fake `curl` for GitHub's token endpoint and the ledger; `events` and `reserves` are what it saw. */
function fakeLedger(events: string[], opts: LedgerOpts = {}) {
  const reserves: Record<string, unknown>[] = [];
  const settles: Record<string, unknown>[] = [];
  const curl: CurlFn = (args) => {
    if (opts.down) return { status: 7, stdout: "", stderr: "could not connect" };
    const url = args[args.length - 1]!;
    const data = args.includes("--data") ? (JSON.parse(args[args.indexOf("--data") + 1]!) as Record<string, unknown>) : undefined;
    const reply = (status: number, body: unknown) => ({ status: 0, stdout: `${JSON.stringify(body)}\n${status}`, stderr: "" });
    if (url.startsWith("https://tokens.test/")) {
      events.push("token");
      return opts.noToken ? reply(403, {}) : reply(200, { value: "jwt" });
    }
    if (url === `${LEDGER}/v1/reserve`) {
      events.push("reserve");
      reserves.push(data!);
      const wanted = data!.wanted_usd as number;
      const answered = opts.reserve?.(wanted) ?? {
        status: 200,
        body: { reservation_id: "res-1", granted_usd: wanted, account_left_usd: 10, repository_left_usd: null, day: DAY },
      };
      return reply(answered.status, answered.body);
    }
    if (url === `${LEDGER}/v1/settle`) {
      events.push("settle");
      settles.push(data!);
      return reply(200, {
        receipt: { account: "acme", repository: "o/r", run_id: "1", usd: data!.spent_usd, day: DAY },
        signature: "c2lnbmF0dXJl",
      });
    }
    throw new Error(`unexpected curl call: ${args.join(" ")}`);
  };
  return { curl, reserves, settles };
}

const TOKEN_ENV = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://tokens.test/token?api=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "bearer" };

interface Opts {
  env?: Record<string, string>;
  reviews?: string[];
  script?: Step[];
  ledger?: LedgerOpts;
  threads?: RawThread[];
  /** Whether the head was already reviewed (the thread run needs it). */
  reviewedAt?: string;
}

/** A pull request with one file; POSTed reviews, replies and comments are collected. */
function setup(opts: Opts = {}) {
  const events: string[] = [];
  const reviews = [...(opts.reviews ?? [])];
  if (opts.reviewedAt) reviews.push(`👮 review\n\n<sub>m · $0.20</sub>\n\n${SIGNATURE.review}\n\n${marker(opts.reviewedAt)}`);
  const posted: string[] = [];
  const replies: string[] = [];
  const comments: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "head-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join("\n"));
  const gh: GhFn = (args, input) => {
    const line = args.join(" ");
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    if (line.startsWith("pr view") && line.includes("headRefOid,title")) {
      return JSON.stringify({ headRefOid: HEAD, title: "t", body: "b", author: { login: "u" } });
    }
    if (line.startsWith("pr view") && line.includes("headRefOid")) return JSON.stringify({ headRefOid: HEAD });
    if (line.startsWith("pr view")) return JSON.stringify({ title: "t", body: "b", author: { login: "u" }, files: [] });
    if (line.startsWith("pr diff")) return "diff";
    if (line.startsWith("pr comment")) {
      comments.push(input ?? "");
      return "{}";
    }
    if (line.includes("/pulls/7/files")) return JSON.stringify(FILE);
    if (line.includes("/pulls/7/reviews") && !args.includes("POST"))
      return reviews.map((body) => JSON.stringify({ body, submitted_at: "2026-11-06T00:00:00Z" })).join("\n");
    if (line.includes("/pulls/7/comments") && !args.includes("POST")) return "";
    if (line.includes("-X POST repos/o/r/pulls/7/reviews")) {
      const body = JSON.parse(input ?? "{}").body as string;
      posted.push(body);
      reviews.push(body);
      return "{}";
    }
    const reply = line.match(/-X POST repos\/o\/r\/pulls\/7\/comments\/\d+\/replies -f body=([\s\S]*)$/);
    if (reply) {
      replies.push(reply[1]!);
      return "{}";
    }
    if (line.startsWith("api repos/o/r/pulls/7 ")) return "b".repeat(40);
    if (line.startsWith("api graphql"))
      return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: opts.threads ?? [] } } } } });
    throw new Error(`unexpected gh call: ${line}`);
  };
  const fake = fakeLedger(events, opts.ledger);
  const provider = new FakeProvider(opts.script ?? [() => ({ costUsd: 0.1, structuredOutput: out() })], events);
  const logs: string[] = [];
  const deps: Deps = {
    gh,
    provider,
    config: loadConfig({ AGENT_REVIEW_OPERATOR: "owner", ...opts.env }),
    repoDir: dir,
    curl: fake.curl,
    ledgerEnv: TOKEN_ENV,
    log: (line) => void logs.push(line),
    warn: () => {},
    sleep: () => {},
  };
  return { deps, provider, events, posted, replies, comments, logs, ...fake };
}

const WITH_LEDGER = { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "opened" };

describe("review() with the daily ledger", () => {
  test("with no ledger_url nothing is reserved and the fake curl is never called", () => {
    const t = setup({ env: { AGENT_REVIEW_TRIGGER: "opened" } });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.events).toEqual(["model"]);
    expect(readReceipt(t.posted[0]!)).toBeNull();
  });

  test("a run reserves before its first model call with min(budget, ceiling room) and settles with the real cost; the footer carries the receipt before the cost line", () => {
    const t = setup({ env: WITH_LEDGER });
    review(t.deps, "o/r", 7, []);
    expect(t.events).toEqual(["token", "reserve", "model", "token", "settle"]);
    expect(t.reserves[0]).toEqual({ wanted_usd: 3, trigger: "opened", forced: false });
    expect(t.settles[0]).toEqual({ reservation_id: "res-1", spent_usd: 0.1 });

    const body = t.posted[0]!;
    expect(readReceipt(body)).not.toBeNull();
    expect(readReceipt(body)?.receipt).toMatchObject({ account: "acme", usd: 0.1, day: DAY });
    const lines = body.split("\n\n");
    const receiptAt = lines.findIndex((l) => l.startsWith("<!-- wachi:receipt "));
    const costAt = lines.findIndex((l) => l.startsWith("<sub>"));
    expect(receiptAt).toBeGreaterThan(-1);
    expect(receiptAt + 1).toBe(costAt);
    expect(lines.slice(costAt + 1, costAt + 3)).toEqual([SIGNATURE.auto, SIGNATURE.review]);
    expect(readAutoCost(body)).toBeCloseTo(0.1, 10);
  });

  test("the reserve asks for min(budget, what the ceiling leaves)", () => {
    const spent = `x\n\n<sub>m · $1.90</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_AUTO_BUDGET_USD: "2" }, reviews: [spent] });
    review(t.deps, "o/r", 7, []);
    expect(t.reserves[0]!.wanted_usd as number).toBeCloseTo(0.1, 10);
  });

  test("the daily_budget_usd of the repository is sent as the caller's limit", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_DAILY_BUDGET_USD: "1.5" } });
    review(t.deps, "o/r", 7, []);
    expect(t.reserves[0]).toMatchObject({ caller_limit_usd: 1.5 });
  });

  test("$0.30 left runs with a $0.30 budget", () => {
    const t = setup({
      env: WITH_LEDGER,
      ledger: {
        reserve: () => ({
          status: 200,
          body: { reservation_id: "res-1", granted_usd: 0.3, account_left_usd: 0.3, repository_left_usd: null, day: DAY },
        }),
      },
    });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.provider.requests[0]!.maxBudgetUsd).toBeCloseTo(0.3, 10);
  });

  const refusal = () => ({
    status: 402,
    body: { reason: "limit", account_spent_usd: 6.12, account_limit_usd: 6, day: DAY, resets_at: new Date(Date.now() + (5 * 60 + 12) * 60_000 + 30_000).toISOString() },
  });

  test("a 402 posts one No credits today review with the amounts and throws DailyLimitReached; a second run the same day posts nothing", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { reserve: refusal } });
    let thrown: unknown;
    try {
      review(t.deps, "o/r", 7, []);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DailyLimitReached);
    expect((thrown as DailyLimitReached).mode).toBe("fail");
    expect((thrown as DailyLimitReached).refusal.reason).toBe("limit");
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("**No credits today.**");
    expect(t.posted[0]).toContain("$6.12 of $6.00");
    expect(t.posted[0]).toContain("(in 5 h 12 min)");
    expect(t.posted[0]).toContain("/wachi review --force");
    expect(readNoCreditsDay(t.posted[0]!.replace(/\n\n<!-- wachi:attempt id=[0-9a-f-]+ -->$/, ""))).toBe(DAY);

    // The same day, the notice is already on the pull request: still refused, nothing more posted.
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(DailyLimitReached);
    expect(t.posted).toHaveLength(1);
  });

  test("the notice mode is carried by the error", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_DAILY_LIMIT_MODE: "notice" }, ledger: { reserve: refusal } });
    try {
      review(t.deps, "o/r", 7, []);
      throw new Error("did not throw");
    } catch (error) {
      expect((error as DailyLimitReached).mode).toBe("notice");
    }
  });

  test("in a dry run the notice is logged by postReview, not posted", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_DRY_RUN: "1" }, ledger: { reserve: refusal } });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(DailyLimitReached);
    expect(t.posted).toHaveLength(0);
    expect(t.logs.some((l) => l.includes("No credits today"))).toBe(true);
  });

  test("an unlinked repository is not a limit: no notice, the refusal propagates", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { reserve: () => ({ status: 403, body: { reason: "not_linked" } }) } });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow("not_linked");
    expect(t.posted).toHaveLength(0);
  });

  test("/wachi review --force by the operator reserves with forced: true; the same words from an automatic trigger reserve with forced: false; a non-operator's --force does nothing", () => {
    const operator = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" } });
    comment(operator.deps, "o/r", 7, "/wachi review --force", "owner");
    expect(operator.reserves[0]).toMatchObject({ forced: true, trigger: "comment" });

    const unset = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER } });
    comment(unset.deps, "o/r", 7, "/wachi review --force", "owner");
    expect(unset.reserves[0]).toMatchObject({ forced: true, trigger: "cli" });

    // Not the operator's comment: the engine does nothing at all.
    const stranger = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" } });
    comment(stranger.deps, "o/r", 7, "/wachi review --force", "someone-else");
    expect(stranger.events).toEqual([]);

    // The words reach `review` from an automatic trigger: never forced.
    const automatic = setup({ env: WITH_LEDGER });
    comment(automatic.deps, "o/r", 7, "/wachi review --force", "owner");
    expect(automatic.reserves[0]).toMatchObject({ forced: false, trigger: "opened" });

    // Without the flag the operator's run is not forced either.
    const plain = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" } });
    comment(plain.deps, "o/r", 7, "/wachi review", "owner");
    expect(plain.reserves[0]).toMatchObject({ forced: false });
  });

  test("the operator's --force run says forced next to its receipt; a normal run does not, and an automatic run's cost still reads", () => {
    const script = [() => ({ costUsd: 0.1, structuredOutput: out() })];
    const forced = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" }, script });
    comment(forced.deps, "o/r", 7, "/wachi review --force", "owner");
    expect(forced.posted[0]).toContain(LEDGER_FORCED_FOOTER);
    expect(readReceipt(forced.posted[0]!)).not.toBeNull();

    const plain = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" }, script });
    comment(plain.deps, "o/r", 7, "/wachi review", "owner");
    expect(plain.posted[0]).not.toContain(LEDGER_FORCED_FOOTER);

    const automatic = setup({ env: WITH_LEDGER });
    review(automatic.deps, "o/r", 7, []);
    expect(automatic.posted[0]).not.toContain(LEDGER_FORCED_FOOTER);
    expect(readAutoCost(automatic.posted[0]!)).toBeCloseTo(0.1, 10);
  });

  test("--force is not taken as a path", () => {
    const t = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" }, script: [() => ({ costUsd: 0.1, structuredOutput: out() })] });
    comment(t.deps, "o/r", 7, "/wachi review --force a.ts", "owner");
    expect(t.provider.requests).toHaveLength(1);
    // A scoped review does not move the incremental marker; a whole one would.
    expect(t.posted[0]).not.toContain(marker(HEAD));
  });

  test("bypass makes no ledger call and logs ledger bypassed", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_DAILY_LIMIT_BYPASS: "true" } });
    review(t.deps, "o/r", 7, []);
    expect(t.events).toEqual(["model"]);
    expect(t.logs).toContain("ledger bypassed");
    expect(t.provider.requests).toHaveLength(1);
    expect(t.posted[0]).toContain(LEDGER_BYPASSED_FOOTER);
  });

  test("an unreachable ledger throws LedgerUnavailable before any model call", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { down: true } });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(LedgerUnavailable);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(0);
  });

  test("a runner without id-token: write throws LedgerUnavailable before any model call", () => {
    const t = setup({ env: WITH_LEDGER });
    t.deps.ledgerEnv = {};
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(LedgerUnavailable);
    expect(t.provider.requests).toHaveLength(0);
  });

  test("a failed run (no batch output) still settles and its notice carries the receipt", () => {
    const t = setup({
      env: WITH_LEDGER,
      script: [() => ({ costUsd: 0.6, terminalReason: "budget", isError: true }), () => ({ costUsd: 0.4, terminalReason: "budget", isError: true })],
    });
    review(t.deps, "o/r", 7, []);
    expect(t.events.filter((e) => e === "settle")).toHaveLength(1);
    expect(t.settles[0]!.spent_usd as number).toBeGreaterThan(0.5);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("ran out of its budget");
    expect(readReceipt(t.posted[0]!)).not.toBeNull();
    expect(readAutoCost(t.posted[0]!)).toBeGreaterThan(0.5);
  });

  test("a failed manual --force review keeps its receipt and forced footer, and does not count toward the ceiling", () => {
    const t = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" },
      script: [() => ({ costUsd: 0.6, terminalReason: "budget", isError: true }), () => ({ costUsd: 0.4, terminalReason: "budget", isError: true })],
    });
    comment(t.deps, "o/r", 7, "/wachi review --force", "owner");
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("ran out of its budget");
    expect(readReceipt(t.posted[0]!)).not.toBeNull();
    expect(t.posted[0]).toContain(LEDGER_FORCED_FOOTER);
    expect(readAutoCost(t.posted[0]!)).toBeNull();
  });

  test("a settle the ledger cannot take does not lose the review; it only has no receipt", () => {
    const t = setup({ env: WITH_LEDGER });
    const real = t.deps.curl!;
    t.deps.curl = (args) => (args[args.length - 1]!.endsWith("/v1/settle") ? { status: 7, stdout: "", stderr: "down" } : real(args));
    review(t.deps, "o/r", 7, []);
    expect(t.posted).toHaveLength(1);
    expect(readReceipt(t.posted[0]!)).toBeNull();
    expect(readAutoCost(t.posted[0]!)).toBeCloseTo(0.1, 10);
  });
});

describe("threadReplies and answer with the daily ledger", () => {
  const FINDING: RawThread["comments"]["nodes"][number] = {
    databaseId: 7,
    author: { login: "github-actions" },
    authorAssociation: "NONE",
    body: `🟠🐛 **Fix · bug: X**\n\nbody\n\n${SIGNATURE.finding}`,
  };
  const OWNER: RawThread["comments"]["nodes"][number] = { databaseId: 900, author: { login: "owner" }, authorAssociation: "OWNER", body: "Fixed" };
  const thread: RawThread = { isResolved: false, path: "src/a.ts", line: 3, comments: { nodes: [FINDING, OWNER] } };

  test("threadReplies reserves, runs, settles with the call's cost; the first reply carries the receipt before the cost line", () => {
    const t = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "thread" },
      reviewedAt: HEAD,
      threads: [thread],
      script: [
        () => ({
          costUsd: 0.12,
          structuredOutput: { thread_replies: [{ comment_id: 7, status: "addressed", reply: "The guard runs first.", cites: ["src/a.ts:3"] }] },
        }),
      ],
    });
    threadReplies(t.deps, "o/r", 7, "owner");
    expect(t.events).toEqual(["token", "reserve", "model", "token", "settle"]);
    expect(t.reserves[0]).toEqual({ wanted_usd: 0.25, trigger: "thread", forced: false });
    expect(t.settles[0]).toEqual({ reservation_id: "res-1", spent_usd: 0.12 });
    expect(t.replies).toHaveLength(1);
    const lines = t.replies[0]!.split("\n\n");
    const receiptAt = lines.findIndex((l) => l.startsWith("<!-- wachi:receipt "));
    expect(receiptAt).toBeGreaterThan(-1);
    expect(lines[receiptAt + 1]!.startsWith("<sub>")).toBe(true);
    expect(readAutoCost(t.replies[0]!)).toBe(0.12);
  });

  test("answer reserves, runs, settles with the call's cost; the receipt line comes before the cost line", () => {
    const t = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" },
      script: [() => ({ costUsd: 0.2, text: "Because of the guard." })],
    });
    answer(t.deps, "o/r", 7, "why?");
    expect(t.events).toEqual(["token", "reserve", "model", "token", "settle"]);
    expect(t.reserves[0]).toEqual({ wanted_usd: 1, trigger: "comment", forced: false });
    expect(t.settles[0]).toEqual({ reservation_id: "res-1", spent_usd: 0.2 });
    const lines = t.comments[0]!.split("\n\n");
    const receiptAt = lines.findIndex((l) => l.startsWith("<!-- wachi:receipt "));
    expect(receiptAt).toBeGreaterThan(-1);
    expect(lines[receiptAt + 1]!.startsWith("<sub>")).toBe(true);
  });

  test("a refused threadReplies posts the notice and runs nothing", () => {
    const t = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "thread" },
      reviewedAt: HEAD,
      threads: [thread],
      ledger: { reserve: () => ({ status: 402, body: { reason: "limit", account_spent_usd: 6, account_limit_usd: 6, day: DAY } }) },
    });
    expect(() => threadReplies(t.deps, "o/r", 7, "owner")).toThrow(DailyLimitReached);
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("**No credits today.**");
  });
});

describe("the No credits today footer", () => {
  test("is read only at the signed footer position", () => {
    const body = `Notice\n\n${SIGNATURE.review}\n\n${noCreditsFooter(DAY)}`;
    expect(readNoCreditsDay(body)).toBe(DAY);
    expect(readNoCreditsDay(`${body}\n\n<!-- wachi:attempt id=11111111-1111-1111-1111-111111111111 -->`)).toBe(DAY);
    expect(readNoCreditsDay(noCreditsFooter(DAY))).toBeNull(); // unsigned
    expect(readNoCreditsDay(`${body}\n\nmore text`)).toBeNull();
  });
});
