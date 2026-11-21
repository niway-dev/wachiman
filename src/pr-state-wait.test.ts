import { describe, expect, test } from "bun:test";
import { UsageError } from "./config";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhTimeoutError, SIGNATURE, ghWithin, marker, type GhFn } from "./engine";
import { buildStateBlock, encodeStateBlock, noFindings } from "./review-state";
import { parsePrStateArgs, type PrState } from "./pr-state";
import { DEFAULT_INTERVAL_S, DEFAULT_TIMEOUT_S, MIN_INTERVAL_S, listenerOver, makeGhProbe, openGhEventListener, processSignals, realGhProbe, realWaitDeps, runPrStateWait, type GhProbe, type Listener, type WaitDeps, type WaitSignal } from "./pr-state-wait";

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
    signals: { install: () => () => {} },
    // A read that never settles loses to this timer, which then moves the fake clock to the deadline; a read that settles cancels it first.
    timeout: (ms) => {
      let live = true;
      const promise = new Promise<null>((resolve) => setTimeout(() => { if (live) { now += ms; resolve(null); } }, 5));
      return { promise, cancel: () => { live = false; } };
    },
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

  test("a timeout while only finding the repository is exit 1 with nothing on stdout, not a timeout document", async () => {
    for (const args of [{ ...ARGS, repo: undefined }, { ...ARGS, pr: undefined }]) {
      const w = world({ reviewAtMs: 10 ** 9 });
      const r = await run(w, args, { limitGh: () => () => { throw new GhTimeoutError(["repo", "view"]); } });
      expect(r.code).toBe(1);
      expect(r.out).toEqual([]);
      expect(r.err[0]).toContain("pr-state");
    }
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

  test("an event inside the interval does not bring the read sooner than one interval after the last read", async () => {
    // The review lands at 40 s. The one event arrives at 5 s, inside the 30 s interval that follows the read at 0 s.
    // Without the clamp the second read would happen at 5 s; with it, at 30 s.
    const w = world({ reviewAtMs: 40_000 });
    let fired = false;
    const listener: Listener = {
      wake: async (ms) => {
        if (!fired) { fired = true; w.advance(Math.min(ms, 5_000)); return "event"; }
        w.advance(ms);
        return "elapsed";
      },
      close: () => {},
    };
    const r = await run(w, ARGS, { openListener: () => listener });
    expect(r.json.next).toBe("done");
    expect(w.readsAt[1]).toBe(30_000);
    const gaps = w.readsAt.slice(1).map((t, i) => t - w.readsAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30_000);
  });

  test("an event's content is never trusted: a payload that says the review is done changes nothing, the state is read again", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const encoder = new TextEncoder();
    let push!: (s: string) => void;
    const events = new ReadableStream<Uint8Array>({ start: (c) => { push = (t) => c.enqueue(encoder.encode(t)); } });
    const inner = listenerOver(events, new Promise<void>(() => {}), () => {});
    const listener: Listener = {
      wake: async (ms) => { push('{"type":"pull_request_review","state":"done","next":"done"}\n'); await Bun.sleep(1); return inner.wake(ms); },
      close: () => inner.close(),
    };
    const r = await run(w, { ...ARGS, timeoutS: 100 }, { openListener: () => listener });
    expect([r.json.next, r.json.why]).toEqual(["wait", "timeout"]);
    expect(w.readsAt.length).toBeGreaterThanOrEqual(3);
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
    let breakStream!: (e: Error) => void;
    const events = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(encoder.encode(s));
        endStream = () => c.close();
        breakStream = (e) => c.error(e);
      },
    });
    const ended = new Promise<void>((r) => (end = r));
    let killed = false;
    return { events, ended, kill: () => { killed = true; }, push, endStream: () => endStream(), breakStream: (e: Error) => breakStream(e), exit: () => { endStream(); end(); }, killed: () => killed };
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

  test("a stream that ends while the process lives is a failure, so the loop can fall back to polling", async () => {
    const p = fakeProcess();
    const l = listenerOver(p.events, p.ended, p.kill);
    const woke = l.wake(5_000);
    p.endStream();
    expect(await woke).toBe("failed");
    expect(await l.wake(10)).toBe("failed");
  });

  test("a stream that breaks while the process lives is a failure too", async () => {
    const p = fakeProcess();
    const l = listenerOver(p.events, p.ended, p.kill);
    const woke = l.wake(5_000);
    p.breakStream(new Error("EPIPE"));
    expect(await woke).toBe("failed");
  });

  test("the wait says once on stderr that the listener stopped when its stream ends, and stdout stays one JSON object", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const p = fakeProcess();
    p.endStream();
    const r = await run(w, { ...ARGS, timeoutS: 100 }, { openListener: () => listenerOver(p.events, p.ended, p.kill) });
    expect(r.err.filter((l) => l.includes("gh event listen stopped"))).toHaveLength(1);
    expect(p.killed()).toBe(true);
    expect(r.out).toHaveLength(1);
    expect([r.code, r.json.why]).toEqual([21, "timeout"]);
    const gaps = w.readsAt.slice(1).map((t, i) => t - w.readsAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30_000);
  });

  test("closing kills the process", () => {
    const p = fakeProcess();
    listenerOver(p.events, p.ended, p.kill).close();
    expect(p.killed()).toBe(true);
  });

  test("the opener returns null when gh has no event command, and starts nothing", () => {
    let started = 0;
    const probe: GhProbe = { supported: () => false, start: () => (started++, { stdout: new ReadableStream(), exited: new Promise(() => {}), kill: () => {} }) };
    expect(openGhEventListener(REPO, probe)).toBeNull();
    expect(started).toBe(0);
  });

  test("the opener returns null when the probe throws (no gh at all)", () => {
    const probe: GhProbe = { supported: () => { throw new Error("spawn gh ENOENT"); }, start: () => { throw new Error("unreachable"); } };
    expect(openGhEventListener(REPO, probe)).toBeNull();
  });

  test("when gh has the command, the opener starts it for the repository and closing the listener kills it", () => {
    const p = fakeProcess();
    const started: string[] = [];
    const probe: GhProbe = { supported: () => true, start: (repo) => (started.push(repo), { stdout: p.events, exited: p.ended, kill: p.kill }) };
    const l = openGhEventListener(REPO, probe);
    expect(l).not.toBeNull();
    expect(started).toEqual([REPO]);
    expect(p.killed()).toBe(false);
    l!.close();
    expect(p.killed()).toBe(true);
  });
});

describe("the gh event listen probe is inside the deadline", () => {
  const hang = [process.execPath, "-e", "setTimeout(()=>{},30000)", "--"];

  test("a probe that hangs is killed with the time left, and the opener answers null", () => {
    const started = Date.now();
    expect(openGhEventListener(REPO, makeGhProbe(hang), 300)).toBeNull();
    expect(Date.now() - started).toBeLessThan(4_000);
    // No time left: the probe is not even started.
    expect(openGhEventListener(REPO, makeGhProbe(hang), 0)).toBeNull();
  });

  test("the production wiring forwards the time left as the probe limit, not as the gh probe", () => {
    // Passing the number straight to `openGhEventListener` put it in the `gh` parameter; the resulting
    // TypeError was swallowed as "unsupported", so the real `gh event listen` was never used.
    const seen: number[] = [];
    const original = realGhProbe.supported;
    realGhProbe.supported = (limitMs) => (seen.push(limitMs), false);
    try {
      expect(realWaitDeps.openListener(REPO, 1234)).toBeNull();
    } finally {
      realGhProbe.supported = original;
    }
    expect(seen).toEqual([1234]);
  });

  test("a probe that hangs still ends the wait by --timeout", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const started = Date.now();
    const r = await run(w, { ...ARGS, timeoutS: 1 }, { openListener: (repo, ms) => openGhEventListener(repo, makeGhProbe(hang), ms) });
    expect(Date.now() - started).toBeLessThan(4_000);
    expect([r.code, r.json.why]).toEqual([21, "timeout"]);
  });

  test("the loop gives the opener the time left before the deadline", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const given: number[] = [];
    await run(w, { ...ARGS, timeoutS: 100 }, { openListener: (_repo, ms) => (given.push(ms), null) });
    expect(given).toEqual([100_000]);
  });
});

describe("the deadline bounds a read in progress, not only the sleeps", () => {
  const neverResolves = () => new Promise<PrState>(() => {});

  test("a later read that never resolves ends at the deadline with the last known state, why timeout, exit 21", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const real = (await run(w, { ...ARGS, timeoutS: 40 })).json as PrState;
    const w2 = world({ reviewAtMs: 10 ** 9 });
    let n = 0;
    const read = (ms: number) => (++n === 1 ? Promise.resolve(real) : (void ms, neverResolves()));
    const r = await run(w2, { ...ARGS, timeoutS: 100 }, { read });
    expect([r.code, r.json.next, r.json.why]).toEqual([21, "wait", "timeout"]);
    expect(r.json.head).toBe(HEAD);
    expect(n).toBe(2);
    expect(w2.clock()).toBe(100_000);
    expect(r.out).toHaveLength(1);
  });

  test("a first read that never resolves ends at the deadline with a wait document, why timeout, exit 21", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const asked: number[] = [];
    const r = await run(w, { ...ARGS, timeoutS: 100 }, { read: (ms) => (asked.push(ms), neverResolves()) });
    expect([r.code, r.json.format, r.json.next, r.json.why]).toEqual([21, "wachiman.pr-state/1", "wait", "timeout"]);
    expect(asked).toEqual([100_000]);
    expect(w.clock()).toBe(100_000);
  });

  test("each read is given only the time left before the deadline", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const asked: number[] = [];
    const real = (await run(world({ reviewAtMs: 10 ** 9 }), { ...ARGS, timeoutS: 40 })).json as PrState;
    await run(w, { ...ARGS, timeoutS: 100 }, { read: (ms) => (asked.push(ms), Promise.resolve(real)) });
    expect(asked[0]).toBe(100_000);
    expect(asked.length).toBeGreaterThan(2);
    expect(asked.slice(1).every((ms, i) => ms < asked[i])).toBe(true);
    expect(asked.every((ms) => ms > 0)).toBe(true);
  });

  test("ghWithin kills the gh subprocess when the time runs out", () => {
    // A process that really hangs, so the test never depends on the machine's gh or its credentials.
    const hang = [process.execPath, "-e", "setTimeout(()=>{},30000)", "--"];
    const started = Date.now();
    expect(() => ghWithin(() => 300, hang)(["api", "x"])).toThrow(GhTimeoutError);
    expect(Date.now() - started).toBeLessThan(5_000);
    // The clock is fractional (performance.now): spawnSync only takes whole milliseconds.
    expect(() => ghWithin(() => 300.7, hang)(["api", "x"])).toThrow(GhTimeoutError);
    expect(() => ghWithin(() => 0, hang)(["api", "x"])).toThrow(GhTimeoutError);
  });

  test("a gh call that times out on the real wait path is a timeout document, never exit 1", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const r = await run(w, { ...ARGS, timeoutS: 100 }, { limitGh: () => () => { throw new GhTimeoutError(["api", "x"]); } });
    expect([r.code, r.json.next, r.json.why]).toEqual([21, "wait", "timeout"]);
  });
});

describe("the gh event listen child never outlives the wait", () => {
  test("the real signal handler closes the listener, then re-raises the signal so the process dies by it (SIGINT, SIGTERM and SIGHUP)", () => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      // In a child: a signal sent to the test process itself would kill the test run.
      const script = `import { processSignals } from ${JSON.stringify(join(import.meta.dir, "pr-state-wait"))};
        processSignals.install((sig) => process.stdout.write("closed:" + sig + "\\n"));
        process.kill(process.pid, ${JSON.stringify(signal)});
        setTimeout(() => process.stdout.write("survived\\n"), 3000);`;
      const child = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
      expect(child.stdout.toString()).toBe(`closed:${signal}\n`);
      expect(child.signalCode).toBe(signal);
    }
  });

  test("when the first read already answers, the handlers installed are removed too", async () => {
    const w = world({ reviewAtMs: 0 });
    let installed = 0;
    let removed = 0;
    const signals = { install: () => (installed++, () => { removed++; }) };
    const r = await run(w, { ...ARGS, timeoutS: 100 }, { signals });
    expect(r.code).toBe(0);
    expect([installed, removed]).toEqual([1, 1]);
  });

  test("a SIGTERM or SIGINT while waiting closes the listener, and the handlers are installed and removed once", async () => {
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      const w = world({ reviewAtMs: 10 ** 9 });
      const { listener } = fakeListener(w, {});
      let handler: ((s: WaitSignal) => void) | null = null;
      let installed = 0;
      let removed = 0;
      const signals = { install: (h: (s: WaitSignal) => void) => (installed++, (handler = h), () => { removed++; handler = null; }) };
      const wrapped: Listener = {
        wake: async (ms) => { handler?.(sig); return listener.wake(ms); },
        close: () => listener.close(),
      };
      await run(w, { ...ARGS, timeoutS: 100 }, { openListener: () => wrapped, signals });
      expect(installed).toBe(1);
      expect(removed).toBe(1);
    }
  });

  test("the signal handler itself kills the child, before the wait ends", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const { listener, closed } = fakeListener(w, {});
    let handler: ((s: WaitSignal) => void) | null = null;
    const signals = { install: (h: (s: WaitSignal) => void) => ((handler = h), () => {}) };
    let closedAtSignal: boolean | null = null;
    const wrapped: Listener = {
      wake: async (ms) => { handler?.("SIGTERM"); closedAtSignal = closed(); return listener.wake(ms); },
      close: () => listener.close(),
    };
    await run(w, { ...ARGS, timeoutS: 100 }, { openListener: () => wrapped, signals });
    expect(closedAtSignal).toBe(true);
  });

  test("the listener is closed when a read throws, and the handlers are removed", async () => {
    const w = world({ reviewAtMs: 10 ** 9 });
    const { listener, closed } = fakeListener(w, { everyMs: 1_000 });
    let removed = 0;
    const signals = { install: () => () => { removed++; } };
    let n = 0;
    const flaky: GhFn = (a) => { if (a[1] === "graphql" && ++n === 2) throw new Error("HTTP 502"); return w.gh(a); };
    const code = await runPrStateWait(ARGS, flaky, { stdout: () => {}, stderr: () => {} }, { ...w.base, openListener: () => listener, signals });
    expect(code).toBe(1);
    expect(closed()).toBe(true);
    expect(removed).toBe(1);
  });
});
