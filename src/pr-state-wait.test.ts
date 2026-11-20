import { describe, expect, test } from "bun:test";
import { UsageError } from "./config";
import { SIGNATURE, marker, type GhFn } from "./engine";
import { buildStateBlock, encodeStateBlock, noFindings } from "./review-state";
import { parsePrStateArgs } from "./pr-state";
import { DEFAULT_INTERVAL_S, DEFAULT_TIMEOUT_S, MIN_INTERVAL_S, listenerOver, openGhEventListener, runPrStateWait, type Listener, type WaitDeps } from "./pr-state-wait";

const REPO = "o/r";
const HEAD = "a".repeat(40);
const ATTEMPT = "00000001-1111-1111-1111-111111111111";
const completeReview = `Review\n\n${SIGNATURE.review}\n\n${marker(HEAD)}\n\n${encodeStateBlock(buildStateBlock({ status: "complete", findings: noFindings() }, { engine: "1.18.0", head: HEAD, attempt: ATTEMPT }, 0))}`;

/** A fake clock and a fake GitHub on it: the review of HEAD lands `reviewAtMs` after the start; the check run exists from the start. */
function world(opts: { reviewAtMs: number; closedAtMs?: number }) {
  let now = 0;
  const readsAt: number[] = [];
  const gh: GhFn = (args) => {
    const joined = args.join(" ");
    if (args[1] === "graphql") {
      readsAt.push(now);
      return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } } });
    }
    if (joined.includes("/reviews")) return now >= opts.reviewAtMs ? JSON.stringify({ login: "github-actions[bot]", body: completeReview, submitted_at: "2026-11-19T00:01:00Z" }) : "";
    if (joined.includes("/check-runs")) return JSON.stringify({ name: "Wachiman review", status: now >= opts.reviewAtMs ? "completed" : "in_progress" });
    if (joined.includes("pulls/")) return JSON.stringify({ state: opts.closedAtMs !== undefined && now >= opts.closedAtMs ? "closed" : "open", head: HEAD });
    throw new Error(`unexpected gh call: ${joined}`);
  };
  const sleeps: number[] = [];
  const base: WaitDeps = {
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    openListener: () => null,
  };
  return { gh, readsAt, sleeps, base, advance: (ms: number) => { now += ms; }, clock: () => now };
}

async function run(w: ReturnType<typeof world>, args: Parameters<typeof runPrStateWait>[0], deps: Partial<WaitDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runPrStateWait(args, w.gh, { stdout: (t) => out.push(t), stderr: (l) => err.push(l) }, { ...w.base, ...deps });
  return { code, out, err, json: out.length ? JSON.parse(out.join("")) : null };
}
const ARGS = { pr: 1, repo: REPO, wait: true, timeoutS: 540, intervalS: 30 };

describe("AC13: --wait returns as soon as next is not wait, or times out", () => {
  test("it returns at once, with one read, when the answer is already not wait", async () => {
    const w = world({ reviewAtMs: 0 });
    const r = await run(w, ARGS);
    expect([r.code, r.json.next, r.json.why]).toEqual([0, "done", "clean"]);
    expect(w.readsAt).toEqual([0]);
    expect(w.sleeps).toEqual([]);
  });

  test("it waits an interval at a time and returns on the first read that is not wait", async () => {
    const w = world({ reviewAtMs: 70_000 });
    const r = await run(w, ARGS);
    expect([r.code, r.json.next]).toEqual([0, "done"]);
    expect(w.readsAt).toEqual([0, 30_000, 60_000, 90_000]);
    expect(r.out).toHaveLength(1);
  });

  test("a closed pull request ends the wait with exit 0", async () => {
    const w = world({ reviewAtMs: 10 ** 9, closedAtMs: 40_000 });
    const r = await run(w, ARGS);
    expect([r.code, r.json.next]).toEqual([0, "closed"]);
  });

  test("on timeout it prints the last state with why timeout and exits 21, without reading past the deadline", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const r = await run(w, { ...ARGS, timeoutS: 100 });
    expect([r.code, r.json.next, r.json.why]).toEqual([21, "wait", "timeout"]);
    expect(r.json.format).toBe("wachiman.pr-state/1");
    expect(r.out).toHaveLength(1);
    expect(w.readsAt).toEqual([0, 30_000, 60_000, 90_000]);
    expect(w.clock()).toBe(100_000);
  });

  test("the defaults are under ten minutes for the timeout and at least 20 seconds for the interval", () => {
    expect(DEFAULT_TIMEOUT_S).toBeLessThan(600);
    expect(MIN_INTERVAL_S).toBeGreaterThanOrEqual(20);
    expect(DEFAULT_INTERVAL_S).toBeGreaterThanOrEqual(MIN_INTERVAL_S);
    expect(parsePrStateArgs(["1", "--wait"])).toEqual({ pr: 1, wait: true, timeoutS: DEFAULT_TIMEOUT_S, intervalS: DEFAULT_INTERVAL_S });
  });

  test("the flags are validated: bad values are usage errors", () => {
    expect(parsePrStateArgs(["--wait", "--timeout", "90", "--interval=25"])).toEqual({ wait: true, timeoutS: 90, intervalS: 25 });
    for (const bad of [["--interval", "10"], ["--interval", "19"], ["--interval", "abc"], ["--interval", "30.5"], ["--interval"], ["--timeout", "0"], ["--timeout", "-5"], ["--timeout", "x"], ["--timeout"]]) {
      expect(() => parsePrStateArgs(["--wait", ...bad])).toThrow(UsageError);
    }
    expect(() => parsePrStateArgs(["--timeout", "60"])).toThrow(/--wait/);
    expect(() => parsePrStateArgs(["--interval", "30"])).toThrow(/--wait/);
  });

  test("a GitHub error while waiting is exit 1 with nothing on stdout", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    let n = 0;
    const flaky: GhFn = (a) => { if (a[1] === "graphql" && ++n === 2) throw new Error("HTTP 502"); return w.gh(a); };
    const out: string[] = [];
    const err: string[] = [];
    const code = await runPrStateWait(ARGS, flaky, { stdout: (t) => out.push(t), stderr: (l) => err.push(l) }, w.base);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toContain("pr-state");
  });
});

/** A fake `gh event listen`: an event every `everyMs` of fake time, or a failure after `failAfterMs`. */
function fakeListener(w: ReturnType<typeof world>, o: { everyMs?: number; failAfterMs?: number }): { listener: Listener; closed: () => boolean } {
  let closed = false;
  let last = 0;
  return {
    closed: () => closed,
    listener: {
      wake: async (ms) => {
        const start = w.clock();
        const eventIn = o.everyMs === undefined ? Infinity : Math.max(0, last + o.everyMs - start);
        const failIn = o.failAfterMs === undefined ? Infinity : Math.max(0, o.failAfterMs - start);
        const step = Math.min(ms, eventIn, failIn);
        w.advance(step);
        last = w.clock();
        if (step === failIn && failIn <= eventIn) return "failed";
        return step === eventIn && eventIn <= ms ? "event" : "elapsed";
      },
      close: () => { closed = true; },
    },
  };
}

describe("AC14: at most one state read per interval, however many events arrive", () => {
  test("polling alone reads once per interval", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    await run(w, { ...ARGS, timeoutS: 300 });
    const gaps = w.readsAt.slice(1).map((t, i) => t - w.readsAt[i]);
    expect(gaps.every((g) => g >= 30_000)).toBe(true);
  });

  test("an event every second never makes two reads within an interval", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const { listener } = fakeListener(w, { everyMs: 1_000 });
    await run(w, { ...ARGS, timeoutS: 300 }, { openListener: () => listener });
    expect(w.readsAt.length).toBeGreaterThan(2);
    const gaps = w.readsAt.slice(1).map((t, i) => t - w.readsAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30_000);
    expect(w.readsAt.length).toBeLessThanOrEqual(1 + 300 / 30);
  });

  test("an event moves the next read earlier than the slower safety poll, never sooner than one interval", async () => {
    // The review lands at 40 s; an event arrives at 41 s. With a listener the safety poll is slower than the interval,
    // so only the event can bring the read at 60 s (one interval after the read at 30 s... the last read was at 0 and 30).
    const w = world({ reviewAtMs: 40_000 });
    let fired = false;
    const listener: Listener = {
      wake: async (ms) => {
        if (!fired && w.clock() >= 0) { fired = true; w.advance(Math.min(ms, 41_000)); return "event"; }
        w.advance(ms);
        return "elapsed";
      },
      close: () => {},
    };
    const r = await run(w, ARGS, { openListener: () => listener });
    expect(r.json.next).toBe("done");
    // Polling alone would read at 30 s and again at 60 s. The event at 41 s brings the second read to 41 s: after one interval, before the safety poll.
    expect(w.readsAt).toEqual([0, 41_000]);
  });

  test("an event is only a wake signal: its content is never read, the state is read again", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const { listener } = fakeListener(w, { everyMs: 5_000 });
    const r = await run(w, { ...ARGS, timeoutS: 60 }, { openListener: () => listener });
    expect(r.json.why).toBe("timeout");
    expect(w.readsAt.length).toBeGreaterThanOrEqual(2);
  });
});

describe("AC15: gh event listen is optional", () => {
  test("when it is missing, it polls and says so once on stderr, and stdout stays one JSON object", async () => {
    const w = world({ reviewAtMs: 70_000 });
    const r = await run(w, ARGS, { openListener: () => null });
    expect(r.err.filter((l) => l.includes("gh event listen"))).toHaveLength(1);
    expect(r.out).toHaveLength(1);
    expect(r.json.next).toBe("done");
  });

  test("when it fails mid-wait, it falls back to polling, says so once, and keeps the one-read-per-interval bound", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const { listener, closed } = fakeListener(w, { everyMs: 2_000, failAfterMs: 50_000 });
    const r = await run(w, { ...ARGS, timeoutS: 300 }, { openListener: () => listener });
    expect(r.err.filter((l) => l.includes("gh event listen"))).toHaveLength(1);
    expect(closed()).toBe(true);
    expect(r.out).toHaveLength(1);
    expect(r.json.why).toBe("timeout");
    const gaps = w.readsAt.slice(1).map((t, i) => t - w.readsAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30_000);
  });

  test("a working listener says nothing on stderr and is closed when the wait ends", async () => {
    const w = world({ reviewAtMs: 40_000 });
    const { listener, closed } = fakeListener(w, { everyMs: 10_000 });
    const r = await run(w, ARGS, { openListener: () => listener });
    expect(r.err).toEqual([]);
    expect(closed()).toBe(true);
    expect(r.json.next).toBe("done");
  });

  test("it is not opened when the first read already answers", async () => {
    const w = world({ reviewAtMs: 0 });
    let opened = 0;
    await run(w, ARGS, { openListener: () => (opened++, null) });
    expect(opened).toBe(0);
  });
});

describe("AC15: the process listener, over a fake process", () => {
  const encoder = new TextEncoder();
  function fakeProcess() {
    let push!: (s: string) => void;
    let end!: () => void;
    let endStream!: () => void;
    const events = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(encoder.encode(s));
        endStream = () => c.close();
      },
    });
    const ended = new Promise<void>((r) => (end = r));
    let killed = false;
    return { events, ended, kill: () => { killed = true; }, push, exit: () => { endStream(); end(); }, killed: () => killed };
  }

  test("an event line wakes it before the time is up, and the content is ignored", async () => {
    const p = fakeProcess();
    const l = listenerOver(p.events, p.ended, p.kill);
    const woke = l.wake(5_000);
    p.push('{"type":"anything at all"}\n');
    expect(await woke).toBe("event");
    l.close();
  });

  test("an event that arrives between two waits is kept for the next one", async () => {
    const p = fakeProcess();
    const l = listenerOver(p.events, p.ended, p.kill);
    p.push("{}\n");
    await Bun.sleep(5);
    expect(await l.wake(5_000)).toBe("event");
    expect(await l.wake(10)).toBe("elapsed");
    l.close();
  });

  test("the time running out is elapsed", async () => {
    const p = fakeProcess();
    const l = listenerOver(p.events, p.ended, p.kill);
    expect(await l.wake(10)).toBe("elapsed");
    l.close();
  });

  test("the process ending is a failure, now and on every later wake", async () => {
    const p = fakeProcess();
    const l = listenerOver(p.events, p.ended, p.kill);
    const woke = l.wake(5_000);
    p.exit();
    expect(await woke).toBe("failed");
    expect(await l.wake(10)).toBe("failed");
  });

  test("closing kills the process", () => {
    const p = fakeProcess();
    listenerOver(p.events, p.ended, p.kill).close();
    expect(p.killed()).toBe(true);
  });

  test("this machine's gh has no event command, so the real opener returns null (or a listener that fails into polling)", () => {
    // Skipped in effect on a gh that has it: only the missing case is asserted.
    let has = false;
    try {
      has = Bun.spawnSync(["gh", "event", "listen", "--help"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
    } catch {
      // No gh at all: the opener must return null too.
    }
    if (!has) expect(openGhEventListener(REPO)).toBeNull();
  });
});
