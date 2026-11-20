import { describe, expect, test } from "bun:test";
import { GhError, SIGNATURE, marker, partialMarker, type GhFn } from "./engine";
import { buildStateBlock, encodeStateBlock, countFindings, noFindings, type ReviewStateDraft } from "./review-state";
import { EXIT_FOR, PR_STATE_FORMAT, parsePrStateArgs, readPrState, runPrState, type Next } from "./pr-state";

// A fake GitHub: answers the calls `readPrState` makes from plain data, and counts them.

const REPO = "o/r";
const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const OWN = "github-actions[bot]";
const ATTEMPT = (n: number) => `${String(n).padStart(8, "0")}-1111-1111-1111-111111111111`;

interface Review { login?: string; body: string; at: string }
interface Thread { id?: string; resolved?: boolean; outdated?: boolean; path?: string; line?: number | null; comments: { login: string; body: string }[] }
interface World {
  state?: string;
  /** The head each successive read of the pull request returns; the last one repeats. */
  heads?: string[];
  reviews?: Review[];
  checks?: { name: string; status: string }[];
  threads?: Thread[];
}

function fake(w: World) {
  const calls: string[][] = [];
  let pulls = 0;
  const gh: GhFn = (args) => {
    calls.push(args);
    const joined = args.join(" ");
    if (args[1] === "graphql") {
      const after = args.find((a) => a.startsWith("after="))?.slice(6);
      const all = w.threads ?? [];
      const from = after === undefined ? 0 : Number(after);
      const nodes = all.slice(from, from + 100).map((t, i) => {
        const c = t.comments.map((x) => ({ author: { login: x.login }, body: x.body, createdAt: "2026-11-19T00:00:00Z", url: `https://github.com/${REPO}/pull/1#discussion_r${from + i}` }));
        return {
          id: t.id ?? `T${from + i}`, isResolved: t.resolved ?? false, isOutdated: t.outdated ?? false, path: t.path ?? "a.ts", line: t.line === undefined ? 10 : t.line, originalLine: 10,
          first: { nodes: c.slice(0, 1) }, last: { nodes: c.slice(-1) },
        };
      });
      const end = from + 100;
      return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: end < all.length, endCursor: String(end) }, nodes } } } } });
    }
    if (joined.includes("/reviews")) {
      return (w.reviews ?? []).map((r) => JSON.stringify({ login: r.login ?? OWN, body: r.body, submitted_at: r.at })).join("\n");
    }
    if (joined.includes("/check-runs")) return (w.checks ?? []).map((c) => JSON.stringify(c)).join("\n");
    if (joined.includes(`pulls/`)) {
      const heads = w.heads ?? [HEAD];
      const head = heads[Math.min(pulls++, heads.length - 1)];
      return JSON.stringify({ state: w.state ?? "open", head });
    }
    throw new Error(`unexpected gh call: ${joined}`);
  };
  return { gh, calls };
}

// Review bodies as the engine writes them.

const draft = (over: Partial<ReviewStateDraft> = {}): ReviewStateDraft => ({ status: "complete", findings: noFindings(), ...over });
function block(head: string, n: number, over: Partial<ReviewStateDraft> = {}) {
  return encodeStateBlock(buildStateBlock(draft(over), { engine: "1.18.0", head, attempt: ATTEMPT(n) }, 0));
}
const complete = (head: string, n = 1, over: Partial<ReviewStateDraft> = {}) =>
  `Review\n\n<sub>m · $0.10</sub>\n\n${SIGNATURE.review}\n\n${marker(head)}\n\n${block(head, n, over)}\n\n<!-- wachi:attempt id=${ATTEMPT(n)} -->`;
const notice = (head: string, reason: NonNullable<ReviewStateDraft["reason"]>, n = 1) =>
  `Not reviewed\n\n${SIGNATURE.review}\n\n${block(head, n, { status: "not-reviewed", reason })}`;
const partial = (head: string, n = 1) =>
  `Partial\n\n${SIGNATURE.review}\n\n${partialMarker({ sha: head, rest: ["b.ts"], tried: [] })}\n\n${block(head, n, { status: "partial" })}`;
const scoped = (head: string, n = 1) => `Scoped\n\n${SIGNATURE.review}\n\n${block(head, n, { status: "scoped", scope: 2 })}`;
const withCounts = (inline: number, body: number, blockingBody = 0) => {
  const sev = (k: "fix" | "info") => ({ severity: k });
  const all = [...Array(inline).fill(sev("fix")), ...Array(body).fill(sev(blockingBody > 0 ? "fix" : "info"))];
  return countFindings(all, all.slice(0, inline), []).findings;
};
const at = (n: number) => `2026-11-19T00:0${n}:00Z`;
const rev = (body: string, n: number): Review => ({ body, at: at(n) });
const FINDING = "| 👮 **Wachiman** | Off by one |\n|:--|:--|\n| **Priority** | **Should** · x |\n| **Severity** | 🟠 Fix |\n| **Area** | 🐛 bug |\n| **Track record** | no record yet · seed |\n\nFails.\n\n" + SIGNATURE.finding;
const thread = (over: Partial<Thread> = {}): Thread => ({ comments: [{ login: "github-actions", body: FINDING }], ...over });

const read = (w: World) => readPrState(fake(w).gh, REPO, 1);
const exitOf = (w: World) => {
  const out: string[] = [];
  const code = runPrState({ pr: 1, repo: REPO }, fake(w).gh, { stdout: (t) => out.push(t), stderr: () => {} });
  return { code, json: out.length ? JSON.parse(out.join("")) : null };
};

describe("AC7: the rule table, row by row, and its exit code", () => {
  const rows: { row: number; world: World; next: Next; why: string }[] = [
    { row: 1, world: { state: "closed", reviews: [rev(complete(HEAD), 1)] }, next: "closed", why: "closed" },
    { row: 1, world: { state: "closed", heads: [HEAD, OLD] }, next: "closed", why: "closed" },
    { row: 2, world: { heads: [HEAD, OLD], reviews: [rev(complete(HEAD), 1)] }, next: "wait", why: "head_moved" },
    { row: 3, world: { checks: [{ name: "Wachiman review", status: "queued" }] }, next: "wait", why: "review_running" },
    { row: 3, world: { checks: [{ name: "Wachiman review", status: "in_progress" }] }, next: "wait", why: "review_running" },
    { row: 3, world: { checks: [{ name: "review / Wachiman review", status: "in_progress" }] }, next: "wait", why: "review_running" },
    { row: 4, world: {}, next: "wait", why: "review_not_started" },
    { row: 4, world: { checks: [{ name: "Some other job", status: "completed" }] }, next: "wait", why: "review_not_started" },
    { row: 5, world: { reviews: [rev(notice(HEAD, "billing"), 1)] }, next: "blocked", why: "billing" },
    { row: 5, world: { reviews: [rev(notice(HEAD, "ceiling"), 1)], threads: [thread()] }, next: "blocked", why: "ceiling" },
    { row: 6, world: { checks: [{ name: "Wachiman review", status: "completed" }] }, next: "blocked", why: "review_missing" },
    { row: 7, world: { reviews: [rev(complete(HEAD), 1)], threads: [thread()] }, next: "act", why: "findings_open" },
    { row: 7, world: { reviews: [rev(complete(HEAD, 1, { findings: withCounts(0, 1, 1) }), 1)] }, next: "act", why: "findings_open" },
    { row: 8, world: { reviews: [rev(partial(HEAD), 1)] }, next: "blocked", why: "partial" },
    { row: 8, world: { reviews: [rev(`Partial\n\n${SIGNATURE.review}\n\n${partialMarker({ sha: HEAD, rest: ["b.ts"], tried: [] })}`, 1)] }, next: "blocked", why: "partial" },
    { row: 9, world: { reviews: [rev(complete(HEAD), 1)] }, next: "done", why: "clean" },
    { row: 10, world: { reviews: [rev(`R\n\n${SIGNATURE.review}\n\n${marker(HEAD)}`, 1)] }, next: "done", why: "clean_legacy" },
    { row: 10, world: { reviews: [rev(`R\n\n${SIGNATURE.review}\n\n${marker(HEAD)}`, 1)], threads: [thread()] }, next: "act", why: "findings_open" },
    { row: 9, world: { reviews: [rev(complete(HEAD, 1, { findings: withCounts(0, 2) }), 1)] }, next: "done", why: "clean" },
  ];
  for (const { row, world, next, why } of rows) {
    test(`row ${row}: ${next}/${why}${world.checks ? ` with check ${world.checks[0].status}` : ""}`, () => {
      const { code, json } = exitOf(world);
      expect([json.next, json.why]).toEqual([next, why]);
      expect(code).toBe(EXIT_FOR[next]);
    });
  }
  test("the exit codes are 0, 0, 20, 21, 22", () => {
    expect(EXIT_FOR).toEqual({ closed: 0, done: 0, act: 20, wait: 21, blocked: 22 });
  });
  test("a GitHub error exits 1 with nothing on stdout, and a usage error is thrown for exit 2", () => {
    const out: string[] = [];
    const err: string[] = [];
    const broken: GhFn = () => { throw new GhError("gh api failed: HTTP 502", 502, "Bad Gateway"); };
    expect(runPrState({ pr: 1, repo: REPO }, broken, { stdout: (t) => out.push(t), stderr: (l) => err.push(l) })).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toContain("pr-state");
    expect(() => parsePrStateArgs(["abc"])).toThrow(/pull request number/);
    expect(() => parsePrStateArgs(["1", "2"])).toThrow(/one pull request/);
    expect(() => parsePrStateArgs(["--wait"])).toThrow(/Unknown option/);
    expect(() => parsePrStateArgs(["--repo", "nope"])).toThrow(/owner/);
  });
});

describe("AC6: the document", () => {
  test("has every field of wachiman.pr-state/1", () => {
    const doc = read({ reviews: [rev(complete(HEAD, 3), 1)], threads: [thread({ id: "PRRT_1", path: "src/a.ts", line: 12, outdated: true })] });
    expect(doc).toEqual({
      format: PR_STATE_FORMAT,
      repo: REPO,
      pr: 1,
      head: HEAD,
      review: { state: "complete", reason: null, reviewed_head: HEAD, attempt: ATTEMPT(3), engine: "1.18.0", source: "block" },
      findings: {
        open: [{ thread_id: "PRRT_1", url: `https://github.com/${REPO}/pull/1#discussion_r0`, path: "src/a.ts", line: 12, severity: "fix", outdated: true, awaiting: "fix_or_reply" }],
        unthreaded: { blocking: 0, body: 0, outside_diff: 0 },
      },
      next: "act",
      why: "findings_open",
    });
  });
  test("a not-reviewed head carries its reason", () => {
    expect(read({ reviews: [rev(notice(HEAD, "turn_limit"), 1)] }).review).toMatchObject({ state: "not-reviewed", reason: "turn_limit", source: "block" });
  });
  test("an engine without --repo asks gh, and with no number takes the current branch's pull request", () => {
    const w = fake({ reviews: [rev(complete(HEAD), 1)] });
    const seen: string[][] = [];
    const gh: GhFn = (args, input) => {
      seen.push(args);
      if (args[0] === "repo") return "o/r\n";
      if (args[0] === "pr") return JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7" });
      return w.gh(args, input);
    };
    const out: string[] = [];
    expect(runPrState({}, gh, { stdout: (t) => out.push(t), stderr: () => {} })).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ repo: "o/r", pr: 7 });
    expect(runPrState({ pr: 3 }, gh, { stdout: () => {}, stderr: () => {} })).toBe(0);
    expect(seen.some((a) => a[0] === "repo")).toBe(true);
  });
  test("a review that lands between the reads never turns into a false review_missing", () => {
    // The review posts and the check run finishes right after the first of those two reads.
    const before: World = { checks: [{ name: "Wachiman review", status: "in_progress" }] };
    const after: World = { reviews: [rev(complete(HEAD), 1)], checks: [{ name: "Wachiman review", status: "completed" }] };
    const a = fake(before);
    const b = fake(after);
    let landed = false;
    const gh: GhFn = (args, input) => {
      const joined = args.join(" ");
      const racing = joined.includes("/reviews") || joined.includes("/check-runs");
      const out = (landed ? b : a).gh(args, input);
      if (racing) landed = true;
      return out;
    };
    const doc = readPrState(gh, REPO, 1);
    expect(doc.why).not.toBe("review_missing");
    expect(["wait", "done"]).toContain(doc.next);
  });
  test("it only reads: every gh call is a GET or a graphql query", () => {
    const f = fake({ reviews: [rev(complete(HEAD), 1)], threads: [thread()] });
    readPrState(f.gh, REPO, 1);
    for (const args of f.calls) {
      expect(args[0]).toBe("api");
      expect(args).not.toContain("-X");
      expect(args).not.toContain("--method");
      if (args[1] === "graphql") expect(args.find((a) => a.startsWith("query="))).not.toContain("mutation");
    }
  });
});

describe("AC8: done only with a complete head and no unresolved Wachiman thread", () => {
  test("a thread Wachiman wrote last waits for a fix or a reply", () => {
    const doc = read({ reviews: [rev(complete(HEAD), 1)], threads: [thread()] });
    expect(doc.findings.open.map((f) => f.awaiting)).toEqual(["fix_or_reply"]);
    expect(doc.next).toBe("act");
  });
  test("a thread someone else replied to last is still listed, awaiting resolve, and keeps act", () => {
    const doc = read({ reviews: [rev(complete(HEAD), 1)], threads: [thread({ comments: [{ login: "github-actions", body: FINDING }, { login: "dev", body: "fixed" }] })] });
    expect(doc.findings.open).toHaveLength(1);
    expect(doc.findings.open[0].awaiting).toBe("resolve");
    expect(doc.next).toBe("act");
  });
  test("a resolved thread does not count; an unrelated thread (a person's, or another bot's) is not a finding", () => {
    const doc = read({
      reviews: [rev(complete(HEAD), 1)],
      threads: [thread({ resolved: true }), { comments: [{ login: "dev", body: FINDING }] }, { comments: [{ login: "github-actions", body: "just a note" }] }],
    });
    expect(doc.findings.open).toEqual([]);
    expect(doc.next).toBe("done");
  });
  test("an outdated unresolved thread stays in the answer", () => {
    const doc = read({ reviews: [rev(complete(HEAD), 1)], threads: [thread({ outdated: true, line: null })] });
    expect(doc.findings.open[0]).toMatchObject({ outdated: true, line: 10 });
    expect(doc.next).toBe("act");
  });
  test("a partial or not-reviewed head is never done, even with zero findings", () => {
    for (const body of [partial(HEAD), notice(HEAD, "budget"), notice(HEAD, "size_gate")]) {
      const doc = read({ reviews: [rev(body, 1)] });
      expect(doc.next).toBe("blocked");
      expect(doc.review.state === "partial" || doc.review.state === "not-reviewed").toBe(true);
    }
    expect(read({ reviews: [rev(partial(HEAD), 1)], threads: [thread()] }).next).toBe("act");
  });
  test("a base-update line counts as complete for its head and repeats the earlier counts", () => {
    const line = `Base moved\n\n${SIGNATURE.review}\n\n${marker(HEAD)}\n\n${block(HEAD, 2, { carriedFrom: OLD, findings: withCounts(0, 1, 1) })}`;
    const doc = read({ reviews: [rev(complete(OLD, 1), 1), rev(line, 2)] });
    expect(doc.review).toMatchObject({ state: "complete", reviewed_head: HEAD });
    expect(doc.findings.unthreaded).toEqual({ blocking: 1, body: 1, outside_diff: 0 });
    expect(doc.next).toBe("act");
    expect(read({ reviews: [rev(complete(OLD, 1), 1), rev(`Base moved\n\n${SIGNATURE.review}\n\n${marker(HEAD)}\n\n${block(HEAD, 2, { carriedFrom: OLD })}`, 2)] }).next).toBe("done");
  });
});

describe("AC9: the head moves while reading", () => {
  test("a different head at the end is wait/head_moved, whatever else says done", () => {
    const doc = read({ heads: [HEAD, OLD], reviews: [rev(complete(HEAD), 1)] });
    expect(doc).toMatchObject({ next: "wait", why: "head_moved", head: HEAD });
  });
  test("a stable head is read twice and changes nothing", () => {
    const f = fake({ reviews: [rev(complete(HEAD), 1)] });
    expect(readPrState(f.gh, REPO, 1).next).toBe("done");
    expect(f.calls.filter((a) => a.join(" ").includes(`pulls/1 `) || a[1] === `repos/${REPO}/pulls/1`)).toHaveLength(2);
  });
});

describe("AC10: attempts and stale reviews", () => {
  test("the most recent attempt on the head decides, by creation time, not by the order GitHub lists them", () => {
    const first = rev(complete(HEAD, 1), 1);
    const second = rev(notice(HEAD, "rate_limit", 2), 2);
    expect(read({ reviews: [first, second] })).toMatchObject({ next: "blocked", why: "rate_limit" });
    expect(read({ reviews: [second, first] })).toMatchObject({ next: "blocked", why: "rate_limit" });
    const rerun = rev(complete(HEAD, 3), 3);
    expect(read({ reviews: [rerun, second, first] })).toMatchObject({ next: "done", review: { attempt: ATTEMPT(3) } });
  });
  test("a newer push makes the older review stale", () => {
    const doc = read({ reviews: [rev(complete(OLD, 1), 1)], checks: [{ name: "Wachiman review", status: "completed" }] });
    expect(doc.review).toMatchObject({ state: "stale", reviewed_head: OLD });
    expect(doc).toMatchObject({ next: "blocked", why: "review_missing" });
    expect(read({ reviews: [rev(complete(OLD, 1), 1)] })).toMatchObject({ next: "wait", why: "review_not_started", review: { state: "stale" } });
    expect(read({ reviews: [rev(complete(OLD, 1), 1)], checks: [{ name: "Wachiman review", status: "queued" }] }).review.state).toBe("running");
  });
});

describe("AC11: reviews from an engine without the block", () => {
  test("a complete review is read from `wachiman sha=` and a partial one from `wachi:partial`", () => {
    const completeLegacy = `Review\n\n<sub>m · $0.1</sub>\n\n${SIGNATURE.review}\n\n${marker(HEAD)}`;
    const partialLegacy = `Partial\n\n${SIGNATURE.review}\n\n${partialMarker({ sha: HEAD, rest: ["b.ts"], tried: [] })}`;
    expect(read({ reviews: [rev(completeLegacy, 1)] })).toMatchObject({ next: "done", why: "clean_legacy", review: { state: "complete", source: "legacy-markers", attempt: null, engine: null }, findings: { unthreaded: null } });
    expect(read({ reviews: [rev(partialLegacy, 1)] })).toMatchObject({ next: "blocked", why: "partial", review: { state: "partial", source: "legacy-markers" } });
  });
  test("a legacy notice without a sha is none, never complete", () => {
    for (const marker of ["<!-- wachi:refusal kind=billing -->", "<!-- wachi:ceiling usd=1.50 -->", "<!-- wachi:limit reason=limit on=2026-11-18 -->"]) {
      const body = `Notice\n\n${marker}\n\n${SIGNATURE.review}`;
      const doc = read({ reviews: [rev(body, 1)] });
      expect(doc.review).toMatchObject({ state: "none", source: null });
      expect(doc.next).toBe("wait");
    }
  });
  describe("an unsigned review from before signatures existed (the engine's legacy window)", () => {
    const unsigned = (head: string) => `Review\n\n<sub>m · $0.1</sub>\n\n${marker(head)}`;
    const BEFORE = "2026-10-15T00:00:00Z";
    const AFTER = "2026-11-19T00:00:00Z";
    test("is read as legacy-markers inside the window: before the cutoff and before any signed review", () => {
      const doc = read({ reviews: [{ body: unsigned(HEAD), at: BEFORE }] });
      expect(doc).toMatchObject({ next: "done", why: "clean_legacy", review: { state: "complete", source: "legacy-markers" } });
    });
    test("is not read after the cutoff", () => {
      const doc = read({ reviews: [{ body: unsigned(HEAD), at: AFTER }] });
      expect(doc.review).toMatchObject({ state: "none", source: null });
      expect(doc.next).toBe("wait");
    });
    test("is not read once a signed review came before it, even inside the date window", () => {
      const signed = { body: complete(OLD, 1), at: "2026-10-14T00:00:00Z" };
      const doc = read({ reviews: [signed, { body: unsigned(HEAD), at: BEFORE }] });
      expect(doc.review).toMatchObject({ state: "stale", reviewed_head: OLD });
    });
  });
  test("a legacy review of an older head is stale, not a review of this one", () => {
    const doc = read({ reviews: [rev(`R\n\n${SIGNATURE.review}\n\n${marker(OLD)}`, 1)] });
    expect(doc.review).toMatchObject({ state: "stale", source: "legacy-markers" });
  });
});

describe("AC12: pagination", () => {
  test("a finding thread past the first 100 threads is reported", () => {
    const threads = Array.from({ length: 150 }, (_, i): Thread => (i === 149 ? thread({ id: "LAST" }) : { resolved: true, comments: [{ login: "dev", body: "x" }] }));
    const f = fake({ reviews: [rev(complete(HEAD), 1)], threads });
    const doc = readPrState(f.gh, REPO, 1);
    expect(doc.findings.open.map((t) => t.thread_id)).toEqual(["LAST"]);
    expect(doc.next).toBe("act");
    expect(f.calls.filter((a) => a[1] === "graphql")).toHaveLength(2);
  });
  test("150 open finding threads are all listed", () => {
    const doc = read({ reviews: [rev(complete(HEAD), 1)], threads: Array.from({ length: 150 }, () => thread()) });
    expect(doc.findings.open).toHaveLength(150);
  });
  test("a thread of more than 100 comments reports who wrote last", () => {
    const comments = [{ login: "github-actions", body: FINDING }, ...Array.from({ length: 149 }, () => ({ login: "dev", body: "again" }))];
    const doc = read({ reviews: [rev(complete(HEAD), 1)], threads: [{ comments }] });
    expect(doc.findings.open.map((t) => t.awaiting)).toEqual(["resolve"]);
  });
  test("a cursor that does not advance fails instead of looping", () => {
    const gh: GhFn = (args) => args[1] === "graphql" ? JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true, endCursor: "x" }, nodes: [] } } } } }) : fake({ reviews: [] }).gh(args);
    expect(() => readPrState(gh, REPO, 1)).toThrow(/pagination/);
  });
});

describe("AC17: a scoped block never decides the head", () => {
  test("a scoped review of the head after a complete review of an older head is wait or blocked, never done", () => {
    const reviews = [rev(complete(OLD, 1), 1), rev(scoped(HEAD, 2), 2)];
    const waiting = read({ reviews });
    expect(waiting).toMatchObject({ next: "wait", why: "review_not_started", review: { state: "scoped", reviewed_head: HEAD } });
    const blocked = read({ reviews, checks: [{ name: "Wachiman review", status: "completed" }] });
    expect(blocked).toMatchObject({ next: "blocked", why: "review_missing" });
  });
  test("a scoped review after a complete review of the same head leaves the complete one deciding", () => {
    expect(read({ reviews: [rev(complete(HEAD, 1), 1), rev(scoped(HEAD, 2), 2)] })).toMatchObject({ next: "done", review: { state: "complete", attempt: ATTEMPT(1) } });
  });
  test("its threads are still listed and keep act", () => {
    const doc = read({ reviews: [rev(complete(HEAD, 1), 1), rev(scoped(HEAD, 2), 2)], threads: [thread({ id: "FROM_SCOPED" })] });
    expect(doc.findings.open.map((t) => t.thread_id)).toEqual(["FROM_SCOPED"]);
    expect(doc.next).toBe("act");
  });
});

describe("forged state", () => {
  const forgedBlock = block(HEAD, 9);
  test("a block in another author's review is ignored", () => {
    const doc = read({ reviews: [{ login: "someone", body: complete(HEAD, 9), at: at(1) }] });
    expect(doc.review.state).toBe("none");
    expect(doc.next).toBe("wait");
  });
  test("a block that is not in the signed footer is ignored", () => {
    for (const body of [`${forgedBlock}\n\nmore`, `Text ${forgedBlock}\n\n${SIGNATURE.review}`, `x\n\n${forgedBlock}`]) {
      expect(read({ reviews: [rev(body, 1)] }).review.state).toBe("none");
    }
  });
  test("a finding thread from another author, or one that is not signed, is never listed", () => {
    const doc = read({ reviews: [rev(complete(HEAD), 1)], threads: [{ comments: [{ login: "mallory", body: FINDING }] }, { comments: [{ login: "github-actions", body: "no signature" }] }] });
    expect(doc.findings.open).toEqual([]);
  });
  test("a block for another head is not this head's review", () => {
    expect(read({ reviews: [rev(complete(OLD, 1), 1)] }).review.state).toBe("stale");
  });
});
