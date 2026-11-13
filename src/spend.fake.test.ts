import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  GhError,
  LedgerStopped,
  SpendLimitReached,
  SIGNATURE,
  answer,
  comment,
  limitFooter,
  marker,
  readAutoCost,
  readLimitNotice,
  review,
  threadReplies,
  type Deps,
  type GhFn,
  type RawThread,
  type ReviewOutput,
  LEDGER_BYPASSED_FOOTER,
  LEDGER_FORCED_FOOTER,
  LEDGER_NOT_COUNTED_NOTE,
} from "./engine";
import { costLogLine, type CallCost } from "./cost";
import { readReceipt, type CurlFn } from "./ledger";
import type { ProviderAdapter, ProviderAuth, ProviderRequest, ProviderResult } from "./providers/types";

// The engine reserves from the spend ledger before a run and settles after it. The ledger is a
// fake `curl`; the model is a fake provider. Both write to one event log, so the tests can assert
// the order of the calls.
//
// No golden prompts here: this feature changes no prompt (the ledger only decides the budget),
// and the prompts a fake run sends are already pinned by `ceiling.fake` and `threads.fake`.
// Recording a third copy would pin the same bytes again and add a fixture to keep in sync.

const HEAD = "head1234567";
const FILE = { filename: "a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" };
const LEDGER = "https://ledger.test";
const DAY = "2026-11-06";
const WEEK = "2026-11-02";

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
  auth: ProviderAuth | undefined;
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
  /** Make the id-token request fail: `true` is GitHub's endpoint answering 403, a number is that status. */
  noToken?: boolean | number;
  /** After the reserve, every `gh` call whose arguments contain this text fails with a 502. */
  failAfterReserve?: string;
  /** Make every curl call fail at the network level. */
  down?: boolean;
  /** Reserve works, then the ledger goes away: settle fails at the network level. */
  downAfterReserve?: boolean;
  /** `/v1/record` answers 503. */
  recordFails?: boolean;
}

/** A fake `curl` for GitHub's token endpoint and the ledger; `events` and the bodies sent are what it saw. */
function fakeLedger(events: string[], opts: LedgerOpts = {}) {
  const reserves: Record<string, unknown>[] = [];
  const settles: Record<string, unknown>[] = [];
  const records: Record<string, unknown>[] = [];
  const urls: string[] = [];
  let reserved = false;
  const curl: CurlFn = (args) => {
    urls.push(args[args.length - 1]!);
    if (opts.down) return { status: 7, stdout: "", stderr: "could not connect" };
    const url = args[args.length - 1]!;
    const data = args.includes("--data") ? (JSON.parse(args[args.indexOf("--data") + 1]!) as Record<string, unknown>) : undefined;
    const reply = (status: number, body: unknown) => ({ status: 0, stdout: `${JSON.stringify(body)}\n${status}`, stderr: "" });
    if (url.startsWith("https://tokens.test/")) {
      events.push("token");
      return opts.noToken ? reply(typeof opts.noToken === "number" ? opts.noToken : 403, {}) : reply(200, { value: "jwt" });
    }
    if (url === `${LEDGER}/v1/reserve`) {
      events.push("reserve");
      reserves.push(data!);
      const wanted = data!.wantedUsd as number;
      const answered = opts.reserve?.(wanted) ?? {
        status: 200,
        body: { reservationId: "res-1", grantedUsd: wanted, accountLeftUsd: 10, repositoryLeftUsd: null, day: DAY, week: WEEK, weekLeftUsd: null },
      };
      reserved = answered.status === 200;
      return reply(answered.status, answered.body);
    }
    if (url === `${LEDGER}/v1/settle`) {
      events.push("settle");
      settles.push(data!);
      if (opts.downAfterReserve && reserved) return { status: 28, stdout: "", stderr: "timed out" };
      return reply(200, {
        receipt: { account: "acme", repository: "o/r", run_id: "1", usd: data!.spentUsd, day: DAY },
        signature: "c2lnbmF0dXJl",
      });
    }
    if (url === `${LEDGER}/v1/record`) {
      events.push("record");
      records.push(data!);
      if (opts.recordFails) return reply(503, {});
      return reply(200, { id: "rec-1", day: DAY, week: WEEK });
    }
    throw new Error(`unexpected curl call: ${args.join(" ")}`);
  };
  return { curl, reserves, settles, records, urls };
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
  /** What pays for the model calls: unset is an API key. */
  auth?: ProviderAuth;
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
  if (opts.auth) provider.auth = opts.auth;
  const logs: string[] = [];
  const costs: CallCost[] = [];
  const notes: string[] = [];
  const failing = opts.ledger?.failAfterReserve;
  const guarded: GhFn = (args, input) => {
    if (failing && events.includes("reserve") && args.join(" ").includes(failing)) throw new GhError("gh: Bad Gateway (HTTP 502)", 502, "Bad Gateway");
    return gh(args, input);
  };
  const deps: Deps = {
    gh: guarded,
    provider,
    config: loadConfig({ AGENT_REVIEW_OPERATOR: "owner", ...opts.env }),
    repoDir: dir,
    curl: fake.curl,
    ledgerEnv: TOKEN_ENV,
    costs,
    ledgerNotes: notes,
    log: (line) => void logs.push(line),
    warn: () => {},
    sleep: () => {},
  };
  return { deps, provider, events, posted, replies, comments, logs, notes, costs, ...fake };
}


const ANSWER = { sections: [{ title: "Answer", body: "Because of the guard.", refs: [] }], not_answered: "" };
const WITH_LEDGER = { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "opened" };
const COMMENT = { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" };

const CALL_KEYS = [
  "auth",
  "cache_read_tokens",
  "cache_write_tokens",
  "costKnown",
  "cost_usd",
  "duration_ms",
  "input_tokens",
  "label",
  "model",
  "operation",
  "output_tokens",
  "terminal_reason",
  "turns",
];

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000 + 30_000).toISOString();

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
}

describe("review() with no ledger_url", () => {
  test("no curl call of any kind and no token request: the run is what it was before the ledger existed", () => {
    const t = setup({ env: { AGENT_REVIEW_TRIGGER: "opened" } });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.events).toEqual(["model"]);
    expect(t.urls).toEqual([]);
    expect(readReceipt(t.posted[0]!)).toBeNull();
    expect(t.posted[0]).not.toContain("Not counted");
    expect(t.notes).toEqual([]);
  });

  test("the same for a thread run and an answer", () => {
    const thread = setup({ env: { AGENT_REVIEW_TRIGGER: "thread" }, reviewedAt: HEAD, threads: [THREAD], script: [() => ({ costUsd: 0.1, structuredOutput: THREAD_REPLY })] });
    threadReplies(thread.deps, "o/r", 7, "owner");
    expect(thread.urls).toEqual([]);
    const asked = setup({ env: { AGENT_REVIEW_TRIGGER: "comment" }, script: [() => ({ costUsd: 0.2, structuredOutput: ANSWER })] });
    answer(asked.deps, "o/r", 7, "why?");
    expect(asked.urls).toEqual([]);
    expect(asked.events).toEqual(["model"]);
  });
});

describe("review() with the spend ledger", () => {
  test("a run reserves before its first model call with min(budget, ceiling room) and settles with the real cost; the footer carries the receipt before the cost line", () => {
    const t = setup({ env: WITH_LEDGER });
    review(t.deps, "o/r", 7, []);
    expect(t.events).toEqual(["token", "reserve", "model", "token", "settle"]);
    expect(t.reserves[0]).toEqual({ wantedUsd: 3, trigger: "opened", forced: false, pr: 7 });
    expect(t.settles[0]!.reservationId).toBe("res-1");
    expect(t.settles[0]!.spentUsd).toBe(0.1);

    const body = t.posted[0]!;
    expect(readReceipt(body)?.receipt).toMatchObject({ account: "acme", usd: 0.1, day: DAY });
    const lines = body.split("\n\n");
    const receiptAt = lines.findIndex((l) => l.startsWith("<!-- wachi:receipt "));
    const costAt = lines.findIndex((l) => l.startsWith("<sub>"));
    expect(receiptAt).toBeGreaterThan(-1);
    expect(receiptAt + 1).toBe(costAt);
    expect(lines.slice(costAt + 1, costAt + 3)).toEqual([SIGNATURE.auto, SIGNATURE.review]);
    expect(readAutoCost(body)).toBeCloseTo(0.1, 10);
    expect(t.notes).toEqual([]);
  });

  test("the reserve asks for min(budget, what the ceiling leaves)", () => {
    const spent = `x\n\n<sub>m · $1.90</sub>\n\n${SIGNATURE.auto}\n\n${SIGNATURE.review}`;
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_AUTO_BUDGET_USD: "2" }, reviews: [spent] });
    review(t.deps, "o/r", 7, []);
    expect(t.reserves[0]!.wantedUsd as number).toBeCloseTo(0.1, 10);
  });

  test("the repository's own daily and weekly budgets are sent as the caller's limits", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_DAILY_BUDGET_USD: "1.5", AGENT_REVIEW_WEEKLY_BUDGET_USD: "6" } });
    review(t.deps, "o/r", 7, []);
    expect(t.reserves[0]).toMatchObject({ callerLimitUsd: 1.5, callerWeeklyLimitUsd: 6 });
    const unset = setup({ env: WITH_LEDGER });
    review(unset.deps, "o/r", 7, []);
    expect(Object.keys(unset.reserves[0]!).sort()).toEqual(["forced", "pr", "trigger", "wantedUsd"]);
  });

  test("a grant smaller than wanted caps the run budget: $0.30 granted runs with $0.30", () => {
    const t = setup({
      env: WITH_LEDGER,
      ledger: {
        reserve: () => ({
          status: 200,
          body: { reservationId: "res-1", grantedUsd: 0.3, accountLeftUsd: 0.3, repositoryLeftUsd: null, day: DAY, week: WEEK, weekLeftUsd: 0.3 },
        }),
      },
    });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.provider.requests[0]!.maxBudgetUsd).toBeCloseTo(0.3, 10);
  });

  test("the settle carries only the reservation, the amount and the calls; each call has exactly the wachiman-cost fields that describe it", () => {
    const t = setup({ env: WITH_LEDGER });
    review(t.deps, "o/r", 7, []);
    expect(Object.keys(t.settles[0]!).sort()).toEqual(["calls", "reservationId", "spentUsd"]);
    const calls = t.settles[0]!.calls as Record<string, unknown>[];
    expect(calls).toHaveLength(t.costs.length);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(Object.keys(call).sort()).toEqual(CALL_KEYS);
    // Same names and values as the line the engine printed for the call, minus where it ran.
    const printed = t.logs.filter((l) => l.startsWith("wachiman-cost ")).map((l) => JSON.parse(l.slice("wachiman-cost ".length)) as Record<string, unknown>);
    expect(printed).toHaveLength(calls.length);
    printed.forEach((line, i) => {
      for (const key of ["repo", "pr", "trigger", "countedUsd"]) delete line[key];
      expect(calls[i]).toEqual(line);
    });
    // Nothing of the pull request travels: not its title, body, a path, nor a credential.
    const sent = JSON.stringify([t.reserves, t.settles]);
    for (const secret of ["\"t\"", "src/a.ts", "a.ts", "jwt", "bearer", "row 1"]) expect(sent).not.toContain(secret);
  });

  test("a subscription-token run and an API-key run both settle with the auth of each call", () => {
    const token = setup({ env: WITH_LEDGER, auth: "oauth-token" });
    review(token.deps, "o/r", 7, []);
    expect((token.settles[0]!.calls as { auth: string }[]).map((c) => c.auth)).toEqual(token.costs.map(() => "oauth-token"));
    const key = setup({ env: WITH_LEDGER });
    review(key.deps, "o/r", 7, []);
    expect((key.settles[0]!.calls as { auth: string }[]).map((c) => c.auth)).toEqual(key.costs.map(() => "api-key"));
  });

  test("a call whose cost is unknown settles as cost_usd null and costKnown false, counted at its cap in spentUsd", () => {
    const t = setup({
      env: WITH_LEDGER,
      script: [() => ({ costUsd: 0.5, costKnown: false, terminalReason: "timeout", isError: true }), () => ({ costUsd: 0.5, costKnown: false, terminalReason: "timeout", isError: true })],
    });
    review(t.deps, "o/r", 7, []);
    const calls = t.settles[0]!.calls as { cost_usd: number | null; costKnown: boolean }[];
    expect(calls[0]).toMatchObject({ cost_usd: null, costKnown: false });
    expect(t.settles[0]!.spentUsd as number).toBeGreaterThan(0.4);
  });
});

describe("a limit refuses the run", () => {
  const body = (reason: string, over: Record<string, unknown> = {}) => ({
    status: 402,
    body: { reason, accountSpentUsd: 6.12, accountLimitUsd: 6, day: DAY, week: WEEK, resetsAt: inHours(5 + 12 / 60), ...over },
  });
  const CASES = [
    { reason: "limit", period: "day", over: {}, says: ["daily spend limit", "$6.12 of $6.00", "today", "(in 5 h 12 min)"], key: `limit:${DAY}` },
    {
      reason: "weekly_limit",
      period: "week",
      over: { accountSpentUsd: 31.5, accountLimitUsd: 30, resetsAt: inHours(3 * 24 + 5) },
      says: ["weekly spend limit", "$31.50 of $30.00", "this week", "(in 3 d 5 h)"],
      key: `weekly_limit:${WEEK}`,
    },
    {
      reason: "repository_limit",
      period: "day",
      over: { period: "day" },
      says: ["own daily limit", "`daily_budget_usd`", "(in 5 h 12 min)"],
      absent: ["$6.12", "$6.00", "the account has spent", "across its repositories"],
      key: `repository_limit:${DAY}`,
    },
    {
      reason: "repository_limit",
      period: "week",
      over: { period: "week", resetsAt: inHours(24 + 2) },
      says: ["own weekly limit", "`weekly_budget_usd`", "(in 1 d 2 h)"],
      absent: ["$6.12", "$6.00", "the account has spent", "across its repositories", "today"],
      key: `repository_limit:${WEEK}`,
    },
  ];

  for (const c of CASES) {
    for (const mode of ["fail", "notice"] as const) {
      test(`${c.reason} (${c.period}) in ${mode} mode: one notice says the period, the amounts and the reset; no model call; the error carries the mode`, () => {
        const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_LIMIT_MODE: mode }, ledger: { reserve: () => body(c.reason, c.over) } });
        const thrown = thrownBy(() => review(t.deps, "o/r", 7, []));
        expect(thrown).toBeInstanceOf(SpendLimitReached);
        expect((thrown as SpendLimitReached).mode).toBe(mode);
        expect((thrown as SpendLimitReached).refusal.reason).toBe(c.reason);
        expect(t.provider.requests).toHaveLength(0);
        expect(t.events).toEqual(["token", "reserve"]);
        expect(t.posted).toHaveLength(1);
        expect(t.posted[0]).toContain("**Spend limit reached.**");
        for (const text of c.says) expect(t.posted[0]).toContain(text);
        for (const text of c.absent ?? []) expect(t.posted[0]).not.toContain(text);
        expect(t.posted[0]).toContain("/wachiman review --force");
        expect(t.posted[0]).not.toMatch(/hard (maximum|limit|cap)/i);
        expect(readLimitNotice(t.posted[0]!.replace(/\n\n<!-- wachi:attempt id=[0-9a-f-]+ -->$/, ""))).toBe(c.key);
        expect(t.notes[0]).toContain("refused this run");

        // The same period, the notice is already on the pull request: still refused, nothing more posted.
        expect(() => review(t.deps, "o/r", 7, [])).toThrow(SpendLimitReached);
        expect(t.posted).toHaveLength(1);
      });
    }
  }

  test("on a subscription token the figures are marked as estimates", () => {
    const t = setup({ env: WITH_LEDGER, auth: "oauth-token", ledger: { reserve: () => body("limit") } });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(SpendLimitReached);
    expect(t.posted[0]).toContain("API-equivalent estimate, not a bill");
    const key = setup({ env: WITH_LEDGER, ledger: { reserve: () => body("limit") } });
    expect(() => review(key.deps, "o/r", 7, [])).toThrow(SpendLimitReached);
    expect(key.posted[0]).not.toContain("estimate");
  });

  test("a refusal that names no amounts still says which limit and when it resets", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { reserve: () => ({ status: 402, body: { reason: "weekly_limit" } }) } });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(SpendLimitReached);
    expect(t.posted[0]).toContain("weekly spend limit is reached");
    expect(t.posted[0]).toMatch(/resets at \*\*\d{4}-\d{2}-\d{2} 00:00 UTC/);
  });

  test("in a dry run the notice is logged by postReview, not posted", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_DRY_RUN: "1" }, ledger: { reserve: () => body("limit") } });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(SpendLimitReached);
    expect(t.posted).toHaveLength(0);
    expect(t.logs.some((l) => l.includes("Spend limit reached"))).toBe(true);
  });

  test("the limit footer is read only at the signed footer position", () => {
    const footer = limitFooter("weekly_limit", WEEK);
    const text = `Notice\n\n${SIGNATURE.review}\n\n${footer}`;
    expect(readLimitNotice(text)).toBe(`weekly_limit:${WEEK}`);
    expect(readLimitNotice(`${text}\n\n<!-- wachi:attempt id=11111111-1111-1111-1111-111111111111 -->`)).toBe(`weekly_limit:${WEEK}`);
    expect(readLimitNotice(footer)).toBeNull();
    expect(readLimitNotice(`${text}\n\nmore text`)).toBeNull();
  });
});

describe("configuration errors are not outages", () => {
  for (const unavailable of ["run", "stop"]) {
    test(`not_linked, unauthorized and a missing OIDC permission stop the run before any model call with ledger_unavailable: ${unavailable}`, () => {
      const env = { ...WITH_LEDGER, AGENT_REVIEW_LEDGER_UNAVAILABLE: unavailable };
      const unlinked = setup({ env, ledger: { reserve: () => ({ status: 403, body: { reason: "not_linked" } }) } });
      expect(thrownBy(() => review(unlinked.deps, "o/r", 7, []))).toBeInstanceOf(LedgerStopped);
      expect(unlinked.notes[0]).toContain("not linked");
      expect(unlinked.provider.requests).toHaveLength(0);
      expect(unlinked.posted).toHaveLength(0);

      const refused = setup({ env, ledger: { reserve: () => ({ status: 401, body: { reason: "unauthorized" } }) } });
      expect(() => review(refused.deps, "o/r", 7, [])).toThrow(/did not accept this job's identity token/);
      expect(refused.provider.requests).toHaveLength(0);

      const noPermission = setup({ env });
      noPermission.deps.ledgerEnv = {};
      expect(() => review(noPermission.deps, "o/r", 7, [])).toThrow(/review-platform\.yml.*id-token: write/);
      expect(noPermission.provider.requests).toHaveLength(0);
      expect(noPermission.urls).toEqual([]);
      expect(noPermission.posted).toHaveLength(0);
    });
  }
});

describe("an unreachable ledger", () => {
  test("ledger_unavailable run (the default): the review runs under its normal budgets, says it was not counted, and records the run", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { down: true } });
    // The ledger comes back for the record at the end.
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.provider.requests[0]!.maxBudgetUsd).toBeGreaterThan(0.5);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain(LEDGER_NOT_COUNTED_NOTE);
    expect(readReceipt(t.posted[0]!)).toBeNull();
    expect(readAutoCost(t.posted[0]!)).toBeCloseTo(0.1, 10);
    // The note sits right before the cost line, so the footer still reads.
    const lines = t.posted[0]!.split("\n\n");
    expect(lines[lines.findIndex((l) => l === LEDGER_NOT_COUNTED_NOTE) + 1]!.startsWith("<sub>")).toBe(true);
    // Down for good: the record failed too, and the summary says so.
    expect(t.notes.join(" ")).toContain("not counted against the spend limit");
    expect(t.notes.join(" ")).toContain("not recorded");
  });

  test("when the ledger is back at the end, the run is recorded once with the allowed fields; the summary says recorded", () => {
    const t = setup({ env: WITH_LEDGER });
    const real = t.deps.curl!;
    let reserves = 0;
    t.deps.curl = (args) => {
      if (args[args.length - 1]!.endsWith("/v1/reserve") && reserves++ === 0) return { status: 28, stdout: "", stderr: "timed out" };
      return real(args);
    };
    review(t.deps, "o/r", 7, []);
    expect(t.events.filter((e) => e === "record")).toHaveLength(1);
    expect(t.events.filter((e) => e === "settle")).toHaveLength(0);
    expect(Object.keys(t.records[0]!).sort()).toEqual(["calls", "pr", "reason", "spentUsd", "trigger"]);
    expect(t.records[0]).toMatchObject({ spentUsd: 0.1, trigger: "opened", pr: 7, reason: "unreserved" });
    for (const call of t.records[0]!.calls as Record<string, unknown>[]) expect(Object.keys(call).sort()).toEqual(CALL_KEYS);
    expect(t.notes.join(" ")).toContain("recorded afterwards");
    expect(t.posted[0]).toContain(LEDGER_NOT_COUNTED_NOTE);
  });

  test("a 5xx at reserve is an outage too; a record that fails does not fail the run", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { reserve: () => ({ status: 503, body: "down" }), recordFails: true } });
    review(t.deps, "o/r", 7, []);
    expect(t.provider.requests).toHaveLength(1);
    expect(t.events).toEqual(["token", "reserve", "model", "token", "record"]);
    expect(t.posted).toHaveLength(1);
    expect(t.notes.join(" ")).toContain("not recorded");
  });

  test("GitHub's token endpoint failing with a 5xx or 429 is an outage; a 403 is a configuration error that stops the run", () => {
    for (const status of [500, 503, 429]) {
      const t = setup({ env: WITH_LEDGER, ledger: { noToken: status } });
      review(t.deps, "o/r", 7, []);
      expect(t.provider.requests).toHaveLength(1);
      expect(t.posted[0]).toContain(LEDGER_NOT_COUNTED_NOTE);
    }
    const refused = setup({ env: WITH_LEDGER, ledger: { noToken: true } });
    expect(() => review(refused.deps, "o/r", 7, [])).toThrow(/id-token: write/);
    expect(refused.provider.requests).toHaveLength(0);
    expect(refused.posted).toHaveLength(0);
  });

  test("ledger_unavailable stop: the run ends before any model call and posts nothing", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_LEDGER_UNAVAILABLE: "stop" }, ledger: { down: true } });
    const thrown = thrownBy(() => review(t.deps, "o/r", 7, []));
    expect(thrown).toBeInstanceOf(LedgerStopped);
    expect((thrown as Error).message).toContain("ledger_unavailable");
    expect(t.provider.requests).toHaveLength(0);
    expect(t.posted).toHaveLength(0);
    expect(t.events).toEqual([]);
    expect(t.notes[0]).toContain("could not be reached");
  });

  test("unreachable at settle after a successful reserve: the result stands; the summary says the settlement was not delivered", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { downAfterReserve: true } });
    review(t.deps, "o/r", 7, []);
    expect(t.posted).toHaveLength(1);
    expect(readReceipt(t.posted[0]!)).toBeNull();
    expect(t.posted[0]).not.toContain(LEDGER_NOT_COUNTED_NOTE);
    expect(readAutoCost(t.posted[0]!)).toBeCloseTo(0.1, 10);
    expect(t.events.filter((e) => e === "record")).toHaveLength(0);
    expect(t.notes.join(" ")).toContain("settlement was not delivered");
  });
});

describe("the operator's --force, a bypass and a failed run", () => {
  test("/wachiman review --force by the operator reserves with forced: true; the same words from an automatic trigger reserve with forced: false; a non-operator's --force does nothing", () => {
    const operator = setup({ env: COMMENT });
    comment(operator.deps, "o/r", 7, "/wachiman review --force", "owner");
    expect(operator.reserves[0]).toMatchObject({ forced: true, trigger: "comment" });

    const unset = setup({ env: { AGENT_REVIEW_LEDGER_URL: LEDGER } });
    comment(unset.deps, "o/r", 7, "/wachiman review --force", "owner");
    expect(unset.reserves[0]).toMatchObject({ forced: true, trigger: "cli" });

    const stranger = setup({ env: COMMENT });
    comment(stranger.deps, "o/r", 7, "/wachiman review --force", "someone-else");
    expect(stranger.events).toEqual([]);

    const automatic = setup({ env: WITH_LEDGER });
    comment(automatic.deps, "o/r", 7, "/wachiman review --force", "owner");
    expect(automatic.reserves[0]).toMatchObject({ forced: false, trigger: "opened" });

    const plain = setup({ env: COMMENT });
    comment(plain.deps, "o/r", 7, "/wachiman review", "owner");
    expect(plain.reserves[0]).toMatchObject({ forced: false });
  });

  test("the operator's --force run says forced next to its receipt; a normal run does not, and an automatic run's cost still reads", () => {
    const forced = setup({ env: COMMENT });
    comment(forced.deps, "o/r", 7, "/wachiman review --force", "owner");
    expect(forced.posted[0]).toContain(LEDGER_FORCED_FOOTER);
    expect(readReceipt(forced.posted[0]!)).not.toBeNull();
    const plain = setup({ env: COMMENT });
    comment(plain.deps, "o/r", 7, "/wachiman review", "owner");
    expect(plain.posted[0]).not.toContain(LEDGER_FORCED_FOOTER);
    const automatic = setup({ env: WITH_LEDGER });
    review(automatic.deps, "o/r", 7, []);
    expect(automatic.posted[0]).not.toContain(LEDGER_FORCED_FOOTER);
    expect(readAutoCost(automatic.posted[0]!)).toBeCloseTo(0.1, 10);
  });

  test("--force is not taken as a path", () => {
    const t = setup({ env: COMMENT });
    comment(t.deps, "o/r", 7, "/wachiman review --force a.ts", "owner");
    expect(t.provider.requests).toHaveLength(1);
    expect(t.posted[0]).not.toContain(marker(HEAD));
  });

  test("bypass makes no ledger call, logs ledger bypassed, and the footer says so", () => {
    const t = setup({ env: { ...WITH_LEDGER, AGENT_REVIEW_LIMIT_BYPASS: "true" } });
    review(t.deps, "o/r", 7, []);
    expect(t.events).toEqual(["model"]);
    expect(t.urls).toEqual([]);
    expect(t.logs).toContain("ledger bypassed");
    expect(t.posted[0]).toContain(LEDGER_BYPASSED_FOOTER);
    expect(t.posted[0]).toContain("Spend limit bypassed for this repository");
    expect(readAutoCost(t.posted[0]!)).toBeCloseTo(0.1, 10);
  });

  test("a failed run (no batch output) still settles and its notice carries the receipt", () => {
    const t = setup({
      env: WITH_LEDGER,
      script: [() => ({ costUsd: 0.6, terminalReason: "budget", isError: true }), () => ({ costUsd: 0.4, terminalReason: "budget", isError: true })],
    });
    review(t.deps, "o/r", 7, []);
    expect(t.events.filter((e) => e === "settle")).toHaveLength(1);
    expect(t.settles[0]!.spentUsd as number).toBeGreaterThan(0.5);
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("ran out of its budget");
    expect(readReceipt(t.posted[0]!)).not.toBeNull();
    expect(readAutoCost(t.posted[0]!)).toBeGreaterThan(0.5);
  });

  test("a failed manual --force review keeps its receipt and forced footer, and does not count toward the ceiling", () => {
    const t = setup({
      env: COMMENT,
      script: [() => ({ costUsd: 0.6, terminalReason: "budget", isError: true }), () => ({ costUsd: 0.4, terminalReason: "budget", isError: true })],
    });
    comment(t.deps, "o/r", 7, "/wachiman review --force", "owner");
    expect(t.posted).toHaveLength(1);
    expect(t.posted[0]).toContain("ran out of its budget");
    expect(readReceipt(t.posted[0]!)).not.toBeNull();
    expect(t.posted[0]).toContain(LEDGER_FORCED_FOOTER);
    expect(readAutoCost(t.posted[0]!)).toBeNull();
  });

  test("a run that throws after a reservation still settles what its calls cost", () => {
    const t = setup({
      env: WITH_LEDGER,
      script: [
        () => {
          throw new Error("the model process died");
        },
      ],
    });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow();
    expect(t.events.filter((e) => e === "settle")).toHaveLength(1);
    expect(t.settles[0]!.calls as unknown[]).not.toHaveLength(0);
  });
});

const FINDING: RawThread["comments"]["nodes"][number] = {
  databaseId: 7,
  author: { login: "github-actions" },
  authorAssociation: "NONE",
  body: `🟠🐛 **Fix · bug: X**\n\nbody\n\n${SIGNATURE.finding}`,
};
const OWNER: RawThread["comments"]["nodes"][number] = { databaseId: 900, author: { login: "owner" }, authorAssociation: "OWNER", body: "Fixed" };
const THREAD: RawThread = { isResolved: false, path: "src/a.ts", line: 3, comments: { nodes: [FINDING, OWNER] } };
const THREAD_REPLY = { thread_replies: [{ comment_id: 7, status: "addressed", reply: "The guard runs first.", cites: ["src/a.ts:3"] }] };

describe("threadReplies and answer with the spend ledger", () => {
  test("threadReplies reserves, runs, settles with the call's cost; the first reply carries the receipt before the cost line", () => {
    const t = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "thread" },
      reviewedAt: HEAD,
      threads: [THREAD],
      script: [() => ({ costUsd: 0.12, structuredOutput: THREAD_REPLY })],
    });
    threadReplies(t.deps, "o/r", 7, "owner");
    expect(t.events).toEqual(["token", "reserve", "model", "token", "settle"]);
    expect(t.reserves[0]).toEqual({ wantedUsd: 0.25, trigger: "thread", forced: false, pr: 7 });
    expect(t.settles[0]!.spentUsd).toBe(0.12);
    expect(t.replies).toHaveLength(1);
    const lines = t.replies[0]!.split("\n\n");
    const receiptAt = lines.findIndex((l) => l.startsWith("<!-- wachi:receipt "));
    expect(receiptAt).toBeGreaterThan(-1);
    expect(lines[receiptAt + 1]!.startsWith("<sub>")).toBe(true);
    expect(readAutoCost(t.replies[0]!)).toBe(0.12);
  });

  test("answer reserves, runs, settles with the call's cost; the receipt line comes before the cost line", () => {
    const t = setup({ env: COMMENT, script: [() => ({ costUsd: 0.2, structuredOutput: ANSWER })] });
    answer(t.deps, "o/r", 7, "why?");
    expect(t.events).toEqual(["token", "reserve", "model", "token", "settle"]);
    expect(t.reserves[0]).toEqual({ wantedUsd: 1, trigger: "comment", forced: false, pr: 7 });
    expect(t.settles[0]!.spentUsd).toBe(0.2);
    const lines = t.comments[0]!.split("\n\n");
    const receiptAt = lines.findIndex((l) => l.startsWith("<!-- wachi:receipt "));
    expect(receiptAt).toBeGreaterThan(-1);
    expect(lines[receiptAt + 1]!.startsWith("<sub>")).toBe(true);
  });

  test("a refused threadReplies posts the notice and runs nothing; an unreachable ledger lets it run and marks the first reply", () => {
    const refused = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "thread" },
      reviewedAt: HEAD,
      threads: [THREAD],
      ledger: { reserve: () => ({ status: 402, body: { reason: "limit", accountSpentUsd: 6, accountLimitUsd: 6, day: DAY } }) },
    });
    expect(() => threadReplies(refused.deps, "o/r", 7, "owner")).toThrow(SpendLimitReached);
    expect(refused.provider.requests).toHaveLength(0);
    expect(refused.posted[0]).toContain("**Spend limit reached.**");

    const down = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "thread" },
      reviewedAt: HEAD,
      threads: [THREAD],
      ledger: { down: true },
      script: [() => ({ costUsd: 0.12, structuredOutput: THREAD_REPLY })],
    });
    threadReplies(down.deps, "o/r", 7, "owner");
    expect(down.replies[0]).toContain(LEDGER_NOT_COUNTED_NOTE);
    expect(readAutoCost(down.replies[0]!)).toBe(0.12);
  });
});

describe("a reservation never outlives a step that fails after it", () => {
  const settledEachReservation = (t: ReturnType<typeof setup>) => expect(t.settles.length).toBe(t.reserves.length);

  test("review: a gh failure while reading the base commit or its instructions leaves no unsettled reservation", () => {
    for (const failAfterReserve of ["/contents/", "api repos/o/r/pulls/7 "]) {
      const t = setup({ env: WITH_LEDGER, ledger: { failAfterReserve } });
      try {
        review(t.deps, "o/r", 7, []);
      } catch {
        // A failing read may fail the run; what matters is that nothing is left reserved.
      }
      settledEachReservation(t);
    }
  });

  test("review: a gh failure while posting, after the settle, keeps the settlement", () => {
    const t = setup({ env: WITH_LEDGER, ledger: { failAfterReserve: "-X POST repos/o/r/pulls/7/reviews" } });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(/502/);
    expect(t.reserves).toHaveLength(1);
    expect(t.settles).toHaveLength(1);
  });

  test("threadReplies: a gh failure while reading the pull request or writing its files leaves no unsettled reservation", () => {
    const t = setup({
      env: { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "thread" },
      reviewedAt: HEAD,
      threads: [THREAD],
      script: [() => ({ costUsd: 0.1, structuredOutput: THREAD_REPLY })],
      ledger: { failAfterReserve: "title,body,author" },
    });
    try {
      threadReplies(t.deps, "o/r", 7, "owner");
    } catch {
      // See above.
    }
    settledEachReservation(t);
  });

  test("answer: every read happens before the reserve, and a failing post still follows a settle", () => {
    const t = setup({ env: COMMENT, script: [() => ({ costUsd: 0.2, structuredOutput: ANSWER })], ledger: { failAfterReserve: "pr comment" } });
    expect(() => answer(t.deps, "o/r", 7, "why?")).toThrow(/502/);
    expect(t.reserves).toHaveLength(1);
    expect(t.settles).toHaveLength(1);
  });
});

describe("an answer that is not the ledger's stops the run, whatever ledger_unavailable says", () => {
  const CASES: [number, unknown][] = [
    [404, "Not Found"],
    [405, ""],
    [400, {}],
    [301, ""],
    [200, "<html>"],
    [200, {}],
  ];
  for (const unavailable of ["run", "stop"]) {
    test(`reserve answered 404, 405, 400, 301 or a malformed 200 stops before any model call (ledger_unavailable: ${unavailable})`, () => {
      for (const [status, body] of CASES) {
        const t = setup({
          env: { ...WITH_LEDGER, AGENT_REVIEW_LEDGER_UNAVAILABLE: unavailable },
          ledger: { reserve: () => ({ status, body }) },
        });
        const thrown = thrownBy(() => review(t.deps, "o/r", 7, []));
        expect(thrown).toBeInstanceOf(LedgerStopped);
        expect((thrown as Error).message).toContain("`ledger_url` does not look like the spend ledger");
        expect((thrown as Error).message).toContain(`HTTP ${status}`);
        expect(t.provider.requests).toHaveLength(0);
        expect(t.posted).toHaveLength(0);
        expect(t.notes[0]).toBe((thrown as Error).message);
      }
    });
  }

  test("a 429 and a 5xx are outages: the review runs uncounted", () => {
    for (const status of [429, 500, 502, 504]) {
      const t = setup({ env: WITH_LEDGER, ledger: { reserve: () => ({ status, body: "busy" }) } });
      review(t.deps, "o/r", 7, []);
      expect(t.provider.requests).toHaveLength(1);
      expect(t.posted[0]).toContain(LEDGER_NOT_COUNTED_NOTE);
    }
  });

  test("a grant that is negative stops the run as a malformed answer", () => {
    const t = setup({
      env: WITH_LEDGER,
      ledger: { reserve: () => ({ status: 200, body: { reservationId: "r", grantedUsd: -1, accountLeftUsd: 1, repositoryLeftUsd: null, day: DAY, week: WEEK, weekLeftUsd: null } }) },
    });
    expect(() => review(t.deps, "o/r", 7, [])).toThrow(LedgerStopped);
    expect(t.provider.requests).toHaveLength(0);
  });
});

describe("a grant below the minimum a call needs", () => {
  const small = {
    reserve: () => ({
      status: 200,
      body: { reservationId: "res-1", grantedUsd: 0.01, accountLeftUsd: 0.01, repositoryLeftUsd: null, day: DAY, week: WEEK, weekLeftUsd: 0.01 },
    }),
  };
  const threadEnv = { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "thread" };

  test("threadReplies makes no model call, settles with 0 and says so in the job summary", () => {
    const t = setup({ env: threadEnv, reviewedAt: HEAD, threads: [THREAD], ledger: small });
    threadReplies(t.deps, "o/r", 7, "owner");
    expect(t.provider.requests).toHaveLength(0);
    expect(t.events).toEqual(["token", "reserve", "token", "settle"]);
    expect(t.settles[0]).toMatchObject({ reservationId: "res-1", spentUsd: 0, calls: [] });
    expect(t.replies).toHaveLength(0);
    expect(t.notes.join(" ")).toContain("$0.01, below the $0.05 a call needs");
    expect(t.notes.join(" ")).toContain("settled with $0.00");
  });

  test("an answer makes no model call, settles with 0, tells the asker nothing was spent and says so in the job summary", () => {
    const operator = setup({ env: COMMENT, ledger: small });
    answer(operator.deps, "o/r", 7, "why?");
    expect(operator.provider.requests).toHaveLength(0);
    expect(operator.settles[0]).toMatchObject({ spentUsd: 0, calls: [] });
    expect(operator.comments).toHaveLength(1);
    expect(operator.comments[0]).toContain("Wachiman did not answer: the spend limit leaves too little room");
    expect(operator.comments[0]).toContain("Nothing was spent.");
    expect(operator.comments[0]).not.toContain("<sub>");
    expect(operator.notes.join(" ")).toContain("below the $0.05 a call needs");

    const other = setup({ env: COMMENT, ledger: small });
    answer(other.deps, "o/r", 7, "why?", { asker: "someone" });
    expect(other.provider.requests).toHaveLength(0);
    expect(other.comments[0]).toContain(SIGNATURE.ask);
    // It is not an answer that cost anything: the question ceiling counts nothing for it.
    expect(readAutoCost(other.comments[0]!)).toBeNull();
  });

  test("a grant of exactly the minimum still runs the call", () => {
    const t = setup({
      env: COMMENT,
      script: [() => ({ costUsd: 0.04, structuredOutput: ANSWER })],
      ledger: { reserve: () => ({ status: 200, body: { reservationId: "res-1", grantedUsd: 0.05, accountLeftUsd: 1, repositoryLeftUsd: null, day: DAY, week: WEEK, weekLeftUsd: null } }) },
    });
    answer(t.deps, "o/r", 7, "why?");
    expect(t.provider.requests).toHaveLength(1);
    expect(t.provider.requests[0]!.maxBudgetUsd).toBeCloseTo(0.05, 10);
  });

  test("with no ledger there is no minimum to check", () => {
    const t = setup({ env: { AGENT_REVIEW_TRIGGER: "comment" }, script: [() => ({ costUsd: 0.2, structuredOutput: ANSWER })] });
    answer(t.deps, "o/r", 7, "why?");
    expect(t.provider.requests).toHaveLength(1);
  });
});

describe("the job summary on a subscription token says its dollars are estimates", () => {
  const small = {
    reserve: () => ({
      status: 200,
      body: { reservationId: "res-1", grantedUsd: 0.01, accountLeftUsd: 0.01, repositoryLeftUsd: null, day: DAY, week: WEEK, weekLeftUsd: 0.01 },
    }),
  };

  test("a settlement that was not delivered", () => {
    const token = setup({ env: WITH_LEDGER, auth: "oauth-token", ledger: { downAfterReserve: true } });
    review(token.deps, "o/r", 7, []);
    expect(token.notes.join(" ")).toContain("settlement was not delivered");
    expect(token.notes.join(" ")).toContain("Claude subscription: API-equivalent estimate, not a bill");
    const key = setup({ env: WITH_LEDGER, ledger: { downAfterReserve: true } });
    review(key.deps, "o/r", 7, []);
    expect(key.notes.join(" ")).not.toContain("estimate");
  });

  test("a grant below the minimum", () => {
    const env = { AGENT_REVIEW_LEDGER_URL: LEDGER, AGENT_REVIEW_TRIGGER: "comment" };
    const token = setup({ env, auth: "subscription", ledger: small });
    answer(token.deps, "o/r", 7, "why?");
    expect(token.notes.join(" ")).toContain("API-equivalent estimate, not a bill");
    const key = setup({ env, ledger: small });
    answer(key.deps, "o/r", 7, "why?");
    expect(key.notes.join(" ")).not.toContain("estimate");
  });
});

describe("--force with no ledger", () => {
  test("is still a word that names no file, logged as ignored, exactly as before the ledger existed", () => {
    const t = setup({ env: { AGENT_REVIEW_TRIGGER: "comment" } });
    comment(t.deps, "o/r", 7, "/wachiman review --force", "owner");
    expect(t.logs).toContain("Not paths in this pull request, ignored: --force");
    expect(t.urls).toEqual([]);
    expect(t.provider.requests).toHaveLength(1);
  });

  test("with a ledger it is the operator's flag and no longer a word", () => {
    const t = setup({ env: COMMENT });
    comment(t.deps, "o/r", 7, "/wachiman review --force", "owner");
    expect(t.logs.some((l) => l.includes("ignored"))).toBe(false);
    expect(t.reserves[0]).toMatchObject({ forced: true });
  });
});
