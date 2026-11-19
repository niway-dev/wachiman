import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  GhError,
  SIGNATURE,
  automaticSpend,
  baseUpdateNotice,
  marker,
  readAutoCost,
  refusalMarker,
  refusalNotice,
  review,
  type Deps,
  type GhFn,
} from "./engine";
import type { ProviderAdapter, ProviderAuth, ProviderErrorClass, ProviderRequest, ProviderResult } from "./providers/types";

// Not-reviewed notices and the base-update notice (ADR 0055): the "What to do" table, a $0 refusal
// edited in place with one PUT, and the one-line notice that makes no model call.

const BASE = "b".repeat(40);
const HEAD1 = "1111111" + "0".repeat(33);
const HEAD2 = "2222222" + "0".repeat(33);
const BOT = "github-actions[bot]";
const CREDIT = "Credit balance is too low";

const FILE = { filename: "src/a.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+one\n+two" };

/** A provider that refuses every call, optionally after spending some money. */
class Refusing implements ProviderAdapter {
  readonly name = "fake";
  readonly requests: ProviderRequest[] = [];
  constructor(
    private readonly kind: ProviderErrorClass,
    private readonly text: string,
    readonly auth: ProviderAuth | undefined = undefined,
    private readonly costUsd = 0,
  ) {}
  preflight() {}
  modelLabel() {
    return "Fake Model";
  }
  leaksSecret() {
    return false;
  }
  async run(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    return {
      costUsd: this.costUsd,
      turns: 1,
      durationMs: 1,
      terminalReason: "error",
      isError: true,
      raw: {},
      errorText: this.text,
      providerError: this.kind,
    };
  }
}

interface Item {
  id: number;
  user: { login: string };
  body: string;
}

/** One pull request as GitHub shows it, with the reviews on it and every write the engine made. */
function world(initial: Item[] = []) {
  const reviews = [...initial];
  const writes: { kind: "post" | "put"; id?: number; body: string }[] = [];
  const calls: string[] = [];
  let head = HEAD1;
  let nextId = 900;
  /** Errors the next PUTs throw, one per attempt, before one succeeds. */
  const putErrors: GhError[] = [];
  const gh: GhFn = (args, input) => {
    const line = args.join(" ");
    calls.push(line);
    if (args.includes("PUT")) {
      const id = Number(line.match(/reviews\/(\d+)/)?.[1]);
      const failure = putErrors.shift();
      if (failure) throw failure;
      const found = reviews.find((r) => r.id === id);
      if (!found) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
      found.body = JSON.parse(input ?? "{}").body;
      writes.push({ kind: "put", id, body: found.body });
      return JSON.stringify({ id, html_url: `https://github.com/o/r/pull/7#pullrequestreview-${id}` });
    }
    if (args.includes("POST") && line.includes("/pulls/7/reviews")) {
      const body = JSON.parse(input ?? "{}").body as string;
      const id = nextId++;
      reviews.push({ id, user: { login: BOT }, body });
      writes.push({ kind: "post", id, body });
      return JSON.stringify({ id, html_url: `https://github.com/o/r/pull/7#pullrequestreview-${id}` });
    }
    if (line.includes("/pulls/7/reviews"))
      // `gh --jq` already filtered to the bot and projected the fields; mirror that here.
      return reviews
        .filter((r) => r.user.login === BOT)
        .map((r) => JSON.stringify({ id: r.id, body: r.body, submitted_at: "2026-11-18T00:00:00Z" }))
        .join("\n");
    if (line.includes("/pulls/7/comments") || line.includes("/issues/7/comments")) return "";
    if (line.startsWith("pr view")) return JSON.stringify({ headRefOid: head, baseRefName: "main", title: "t", body: "b", author: { login: "u" } });
    if (line.startsWith("api repos/o/r/pulls/7 ")) return BASE;
    if (line.includes("/pulls/7/files")) return JSON.stringify(FILE);
    if (line.startsWith("api graphql")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (line.includes("/contents/")) throw new GhError("gh: Not Found (HTTP 404)", 404, "Not Found");
    throw new Error(`unexpected gh call: ${line}`);
  };
  return {
    gh,
    reviews,
    writes,
    calls,
    putErrors,
    push: (sha: string) => void (head = sha),
    /** The bodies, without the `wachi:attempt` line a POST adds. */
    bodies: () => reviews.map((r) => r.body.replace(/\n\n<!-- wachi:attempt id=[0-9a-f-]{36} -->$/, "")),
  };
}

async function run(
  w: ReturnType<typeof world>,
  provider: ProviderAdapter,
  env: Record<string, string> = {},
) {
  const warnings: string[] = [];
  const sleeps: number[] = [];
  const deps: Deps = {
    gh: w.gh,
    provider,
    config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "synchronize", WACHIMAN_MODEL: "claude-sonnet-5-5", ...env }),
    repoDir: mkdtempSync(join(tmpdir(), "notices-head-")),
    log: () => {},
    warn: (l) => void warnings.push(l),
    lineCounter: () => 100,
    sleep: (ms) => void sleeps.push(ms),
    rateLimitBackoffMs: 0,
    engineVersion: "1.2.3",
  };
  await review(deps, "o/r", 7, []);
  return { warnings, sleeps };
}

const RERUN = 'the "Wachiman review" job in the Actions tab, or push again';

/** The automatic billing refusal of an API key, with the footer of an automatic run that spent nothing. */
const billingNotice = (prSoFar: string, runs: string) =>
  [
    "👮 **Wachiman** · ⛔ **Not reviewed**: the Anthropic account has no credit",
    [
      "| What to do | |",
      "| --- | --- |",
      "| **Who** | The repository owner, who holds the `ANTHROPIC_API_KEY` secret |",
      `| **Fix** | Add credit to that Anthropic account, then re-run ${RERUN} |`,
      `| **Spent** | Nothing this run · PR so far ${prSoFar} |`,
      `| **Provider said** | \`${CREDIT}\` |`,
    ].join("\n"),
    "<!-- wachi:refusal kind=billing -->",
    `<sub>Fake Model · effort high · review · PR so far ${prSoFar} over ${runs} · $0.00</sub>`,
    SIGNATURE.auto,
    SIGNATURE.review,
  ].join("\n\n");

describe("a $0 refusal is edited in place", () => {
  test("two pushes with the same billing refusal leave one review, edited once", async () => {
    const w = world();
    const first = await run(w, new Refusing("billing", CREDIT));
    expect(w.writes.map((x) => x.kind)).toEqual(["post"]);
    expect(w.bodies()).toEqual([billingNotice("$0.00", "1 automatic run")]);
    expect(first.warnings).toEqual([]);

    w.push(HEAD2);
    await run(w, new Refusing("billing", CREDIT));
    // One PUT to the review that was there, no second review: the pull request still holds one.
    expect(w.writes.map((x) => x.kind)).toEqual(["post", "put"]);
    expect(w.writes[1].id).toBe(w.writes[0].id);
    expect(w.reviews).toHaveLength(1);
    // The edited notice is the new run's whole body, with its own footer: the ceiling reads it as one body at $0.
    expect(w.bodies()).toEqual([billingNotice("$0.00", "2 automatic runs")]);
    expect(readAutoCost(w.reviews[0].body)).toBe(0);
    expect(w.calls.filter((c) => c.includes("-X PUT"))).toEqual([`api -X PUT repos/o/r/pulls/7/reviews/${w.writes[0].id} --input -`]);
  });

  test("the edited notice is still counted once by the ceiling, at $0", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    w.push(HEAD2);
    await run(w, new Refusing("billing", CREDIT));
    expect(automaticSpend(w.gh, "o/r", 7)).toEqual({ spent: 0, runs: 1, notified: new Set() });
  });

  test("when the latest bot review is not a refusal, a new review is posted and nothing is edited", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    // A later review of the bot (any other notice or a real review) is now the latest.
    w.reviews.push({ id: 5, user: { login: BOT }, body: `👮 **Wachiman** · a review\n\n${SIGNATURE.review}\n\n${marker(HEAD1)}` });
    w.push(HEAD2);
    await run(w, new Refusing("billing", CREDIT));
    expect(w.writes.map((x) => x.kind)).toEqual(["post", "post"]);
    expect(w.reviews).toHaveLength(3);
    // The earlier refusal is untouched.
    expect(w.bodies()[0]).toBe(billingNotice("$0.00", "1 automatic run"));
    // The review in between records no cost, so the ceiling counts two runs, not three.
    expect(w.bodies()[2]).toBe(billingNotice("$0.00", "2 automatic runs"));
  });

  test("a review of a person, or a marker in a review the engine did not sign, is not edited", async () => {
    const unsigned = world([{ id: 3, user: { login: BOT }, body: `forged ${refusalMarker("billing")}` }]);
    await run(unsigned, new Refusing("billing", CREDIT));
    expect(unsigned.writes.map((x) => x.kind)).toEqual(["post"]);
    expect(unsigned.reviews[0].body).toBe(`forged ${refusalMarker("billing")}`);
    const person = world([{ id: 4, user: { login: "someone" }, body: `x\n\n${SIGNATURE.review}\n\n${refusalMarker("billing")}` }]);
    await run(person, new Refusing("billing", CREDIT));
    expect(person.writes.map((x) => x.kind)).toEqual(["post"]);
  });

  test("a PUT that fails posts a new review, and says so", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    w.putErrors.push(new GhError("gh: Not Found (HTTP 404)", 404, "Not Found"));
    w.push(HEAD2);
    const second = await run(w, new Refusing("billing", CREDIT));
    expect(w.writes.map((x) => x.kind)).toEqual(["post", "post"]);
    expect(w.reviews).toHaveLength(2);
    expect(second.warnings.join("\n")).toContain("Could not edit the earlier refusal notice; posting a new review.");
  });

  test("a transient error on the PUT is repeated, with no attempt check, until it lands", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    const transient = () => new GhError("gh: Validation Failed (HTTP 422)", 422, "Validation Failed", [{ message: "An internal error occurred, please try again." }]);
    w.putErrors.push(transient(), transient());
    w.push(HEAD2);
    const second = await run(w, new Refusing("billing", CREDIT));
    expect(w.writes.map((x) => x.kind)).toEqual(["post", "put"]);
    expect(w.calls.filter((c) => c.includes("-X PUT"))).toHaveLength(3);
    expect(second.sleeps).toEqual([1_000, 3_000]);
    // Nothing looked for the attempt line: the reviews were listed once to find the refusal, once for the ceiling.
    expect(w.reviews).toHaveLength(1);
  });

  test("a transient error that outlasts the retries posts a new review", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    const transient = () => new GhError("gh: Validation Failed (HTTP 422)", 422, "Validation Failed", [{ message: "An internal error occurred, please try again." }]);
    w.putErrors.push(transient(), transient(), transient());
    w.push(HEAD2);
    await run(w, new Refusing("billing", CREDIT));
    expect(w.writes.map((x) => x.kind)).toEqual(["post", "post"]);
  });

  test("a refusal that spent money is a new review with no marker, and is never edited over", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    w.push(HEAD2);
    await run(w, new Refusing("billing", CREDIT, undefined, 0.07));
    expect(w.writes.map((x) => x.kind)).toEqual(["post", "post"]);
    const [free, paid] = w.bodies();
    expect(free).toContain(refusalMarker("billing"));
    expect(paid).not.toContain("wachi:refusal");
    expect(paid).toContain("| **Spent** | $0.07 this run · PR so far $0.07 |");
    expect(readAutoCost(paid)).toBe(0.07);
    expect(automaticSpend(w.gh, "o/r", 7).spent).toBeCloseTo(0.07);
  });

  test("a dry run edits and posts nothing", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    w.push(HEAD2);
    await run(w, new Refusing("billing", CREDIT), { WACHIMAN_DRY_RUN: "1" });
    expect(w.writes.map((x) => x.kind)).toEqual(["post"]);
  });
});

describe("the refusal notice names who acts and what to do", () => {
  test("a rate limit on a subscription token says to re-run later, and carries its own marker", async () => {
    const w = world();
    const provider = new Refusing("rate_limit", "API Error: 429 rate_limit_error", "oauth-token");
    await run(w, provider);
    expect(provider.requests).toHaveLength(2);
    expect(w.bodies()).toEqual([
      [
        "👮 **Wachiman** · ⛔ **Not reviewed**: Claude kept rate-limiting the reviewer",
        [
          "| What to do | |",
          "| --- | --- |",
          "| **Who** | Anyone who can re-run workflows |",
          `| **Fix** | Re-run later: ${RERUN} |`,
          "| **Spent** | Nothing this run · PR so far $0.00 |",
          "| **Provider said** | `API Error: 429 rate_limit_error` |",
        ].join("\n"),
        "<!-- wachi:refusal kind=rate_limit -->",
        "<sub>Fake Model · effort high · review · PR so far $0.00 over 1 automatic run · Claude subscription: API-equivalent estimate, not a bill · $0.00</sub>",
        SIGNATURE.auto,
        SIGNATURE.review,
      ].join("\n\n"),
    ]);
  });

  test("a rate limit is edited in place by the next one, whatever the kind of the earlier refusal", async () => {
    const w = world();
    await run(w, new Refusing("billing", CREDIT));
    w.push(HEAD2);
    await run(w, new Refusing("rate_limit", "API Error: 429 rate_limit_error"));
    expect(w.writes.map((x) => x.kind)).toEqual(["post", "put"]);
    expect(w.reviews).toHaveLength(1);
    expect(w.reviews[0].body).toContain("<!-- wachi:refusal kind=rate_limit -->");
    expect(w.reviews[0].body).not.toContain("kind=billing");
  });

  test("an API key and a subscription token get different Who and Fix, for every kind", () => {
    const base = { detail: "", spentUsd: 0 };
    const rows = (kind: "billing" | "auth" | "rate_limit", auth: ProviderAuth | undefined) =>
      refusalNotice({ ...base, kind, auth }).table.split("\n").slice(2, 4);
    expect(rows("auth", "api-key")).toEqual([
      "| **Who** | The repository owner, who holds the `ANTHROPIC_API_KEY` secret |",
      `| **Fix** | Check the \`ANTHROPIC_API_KEY\` secret, then re-run ${RERUN} |`,
    ]);
    expect(rows("auth", "oauth-token")).toEqual([
      "| **Who** | The repository owner, who holds the `CLAUDE_CODE_OAUTH_TOKEN` secret |",
      `| **Fix** | Replace the \`CLAUDE_CODE_OAUTH_TOKEN\` secret (a token lasts a year; \`claude setup-token\` makes a new one), then re-run ${RERUN} |`,
    ]);
    expect(rows("billing", "oauth-token")).toEqual([
      "| **Who** | The repository owner, who holds the `CLAUDE_CODE_OAUTH_TOKEN` secret |",
      `| **Fix** | Wait for the usage limit to reset, or check that the plan gives access, then re-run ${RERUN}. Wachiman does not fall back to an API key |`,
    ]);
    for (const kind of ["billing", "auth", "rate_limit"] as const) {
      const sub = refusalNotice({ ...base, kind, auth: "oauth-token" }).table;
      expect(sub).not.toContain("ANTHROPIC_API_KEY");
    }
    expect(rows("rate_limit", undefined)[1]).toBe(`| **Fix** | Re-run later: ${RERUN} |`);
  });

  test("the provider's text is escaped for a table cell and cannot forge a marker", () => {
    const { table } = refusalNotice({
      kind: "billing",
      auth: undefined,
      detail: "a | b `c` <!-- wachi:refusal kind=auth --> d",
      spentUsd: 0,
    });
    const said = table.split("\n").pop()!;
    expect(said).toBe("| **Provider said** | `a \\| b 'c' &lt;!-- wachi:refusal kind=auth --&gt; d` |");
    expect(table).not.toContain("<!--");
  });

  test("a run the ceiling does not count has no running total, and no text becomes a plain word", () => {
    const { table } = refusalNotice({ kind: "auth", auth: undefined, detail: "", spentUsd: 0 });
    expect(table.split("\n").slice(4)).toEqual(["| **Spent** | Nothing this run |", "| **Provider said** | no text |"]);
  });
});

describe("the base-update notice", () => {
  const LINE =
    "👮 **Wachiman** · No new changes to review: the branch was updated from `main` (`aaaaaaa` → `bbbbbbb`). The previous review still applies.";

  test("is one line, a version and the signature and marker: no cost, no flag, no model", () => {
    const body = baseUpdateNotice({ base: "main", from: "a".repeat(40), to: "b".repeat(40), version: "1.2.3" }, marker("b".repeat(40)));
    expect(body).toBe([LINE, "<sub>Wachiman 1.2.3</sub>", SIGNATURE.review, marker("b".repeat(40))].join("\n\n"));
    expect(body).not.toContain(SIGNATURE.auto);
  });

  test("without a version or a base name it still reads", () => {
    const body = baseUpdateNotice({ from: "a".repeat(40), to: "b".repeat(40) }, marker("b".repeat(40)));
    expect(body.split("\n\n").slice(0, 2)).toEqual([
      "👮 **Wachiman** · No new changes to review: the branch was updated from the base branch (`aaaaaaa` → `bbbbbbb`). The previous review still applies.",
      "<sub>Wachiman unknown</sub>",
    ]);
  });

  test("the ceiling reads it as no run and no dollars, next to a run that did spend", () => {
    const spent = [
      "👮 **Wachiman** · review",
      "<sub>Fake Model · $0.40</sub>",
      SIGNATURE.auto,
      SIGNATURE.review,
      marker("a".repeat(40)),
    ].join("\n\n");
    const notice = baseUpdateNotice({ base: "main", from: "a".repeat(40), to: "b".repeat(40), version: "1.2.3" }, marker("b".repeat(40)));
    expect(readAutoCost(notice)).toBeNull();
    const w = world([
      { id: 1, user: { login: BOT }, body: spent },
      { id: 2, user: { login: BOT }, body: notice },
    ]);
    expect(automaticSpend(w.gh, "o/r", 7)).toEqual({ spent: 0.4, runs: 1, notified: new Set() });
  });

  test("a push that only merges the base posts it, calls no model and does not look up spend", async () => {
    const prior = `👮 **Wachiman** · review\n\n<sub>x</sub>\n\n${SIGNATURE.review}\n\n${marker(HEAD1)}`;
    const w = world([{ id: 1, user: { login: BOT }, body: prior }]);
    w.push(HEAD2);
    const calls = w.calls;
    const gh = w.gh;
    const wrapped: GhFn = (args, input) => {
      const line = args.join(" ");
      const compare = line.match(/compare\/(\S+?)\.\.\.(\S+)/);
      if (compare) return JSON.stringify({ status: "ahead", files: [] });
      return gh(args, input);
    };
    const provider = new Refusing("other", "must not be called");
    const deps: Deps = {
      gh: wrapped,
      provider,
      config: loadConfig({ WACHIMAN_VERIFY: "0", WACHIMAN_TRIGGER: "synchronize", WACHIMAN_MODEL: "claude-sonnet-5-5" }),
      repoDir: mkdtempSync(join(tmpdir(), "notices-head-")),
      log: () => {},
      warn: () => {},
      lineCounter: () => 100,
      sleep: () => {},
      engineVersion: "1.2.3",
    };
    await review(deps, "o/r", 7, []);
    expect(provider.requests).toHaveLength(0);
    expect(w.bodies()[1]).toBe(
      [
        `👮 **Wachiman** · No new changes to review: the branch was updated from \`main\` (\`1111111\` → \`2222222\`). The previous review still applies.`,
        "<sub>Wachiman 1.2.3</sub>",
        SIGNATURE.review,
        marker(HEAD2),
      ].join("\n\n"),
    );
    expect(calls.filter((c) => c.includes("ledger") || c.includes("-X PUT"))).toEqual([]);
  });
});
