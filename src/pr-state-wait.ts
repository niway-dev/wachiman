/**
 * `wachiman pr-state --wait` (ADR 0060 decision 8): a bounded loop over `readPrState`.
 *
 * The loop reads the state at most once per interval and stops at the first answer that is not
 * `wait`, or at the timeout. `gh event listen` is optional acceleration: an event only wakes the
 * loop sooner than its slow safety poll, never sooner than one interval after the last read, and its
 * content is never read (the state is read again). Nothing here stores anything or posts anything.
 *
 * The timeout bounds the whole call, reads included: each `gh` call of a read is killed when the
 * time left runs out, and the wait then ends with the last known state and `why: timeout`.
 */
import { UsageError } from "./config";
import { GhTimeoutError, ghWithin, type GhFn } from "./engine";
import { DEFAULT_INTERVAL_S, DEFAULT_TIMEOUT_S, EXIT_FOR, MIN_INTERVAL_S, PR_STATE_FORMAT, readPrState, resolveTarget, type PrState, type PrStateArgs } from "./pr-state";

export { DEFAULT_INTERVAL_S, DEFAULT_TIMEOUT_S, MIN_INTERVAL_S };

/** With a listener, a read still happens this many intervals after the last one, because `gh event listen` has no replay. */
const SAFETY_POLL_INTERVALS = 3;

/** A wake signal source. `wake(ms)` resolves when an event arrives, `ms` elapse, or the source fails. */
export interface Listener {
  wake(ms: number): Promise<"event" | "elapsed" | "failed">;
  close(): void;
}

export interface WaitDeps {
  /** Milliseconds on a monotonic clock. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /**
   * Starts a listener for the repository, or returns null when `gh event listen` is missing or
   * unsupported. `remainingMs` is the time left before the deadline: the probe must not outlast it.
   */
  openListener: (repo: string, remainingMs: number) => Listener | null;
  /**
   * A `gh` whose every call is killed when `remainingMs()` is up. Absent (tests with a fake `gh`): the
   * `gh` passed to `runPrStateWait` is used as it is.
   */
  limitGh?: (remainingMs: () => number) => GhFn;
  /**
   * Replaces the state read, with the time left. For a read that cannot be bounded by killing a
   * subprocess; the loop gives up on it at the deadline. Absent: `readPrState` over the limited `gh`.
   */
  read?: (remainingMs: number) => Promise<PrState>;
  /** A timer for the deadline of one read: `promise` resolves to null when `ms` pass, until `cancel` is called. */
  timeout: (ms: number) => { promise: Promise<null>; cancel: () => void };
  /** Installs a handler for SIGINT, SIGTERM and SIGHUP and returns what removes it. Installed for the whole call and removed when it ends. */
  signals: { install: (handler: (signal: WaitSignal) => void) => () => void };
}

export type WaitSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export interface PrStateWaitArgs extends PrStateArgs {
  wait: true;
  timeoutS: number;
  intervalS: number;
}

type Io = { stdout: (text: string) => void; stderr: (line: string) => void };

/** What a wait that timed out before any read finished prints: no head is known, nothing is claimed. */
function timedOutBeforeAnyRead(repo: string, pr: number): PrState {
  return {
    format: PR_STATE_FORMAT,
    repo,
    pr,
    head: "",
    review: { state: "none", reason: null, reviewed_head: null, attempt: null, engine: null, source: null },
    findings: { open: [], unthreaded: null },
    next: "wait",
    why: "timeout",
  };
}

/** Waits for `next` to stop being `wait`: the document on stdout, then exit 0, 20, 21 or 22; exit 1 when GitHub fails. */
export async function runPrStateWait(args: PrStateWaitArgs, gh: GhFn, io: Io, deps: WaitDeps): Promise<number> {
  let listener: Listener | null = null;
  let removeSignals: (() => void) | null = null;
  try {
    const deadline = deps.now() + args.timeoutS * 1000;
    const remaining = () => deadline - deps.now();
    const limited = deps.limitGh ? deps.limitGh(remaining) : gh;
    // Until the process ends, a signal must not leave `gh event listen` behind.
    removeSignals = deps.signals.install(() => listener?.close());
    const interval = args.intervalS * 1000;
    let target: { repo: string; pr: number };
    // One read, bounded by the time left: null when the deadline passed before or during it.
    const read = async (): Promise<PrState | null> => {
      const left = remaining();
      if (left <= 0) return null;
      try {
        if (!deps.read) return readPrState(limited, target.repo, target.pr);
        const timer = deps.timeout(left);
        try {
          return await Promise.race([deps.read(left), timer.promise]);
        } finally {
          timer.cancel();
        }
      } catch (error) {
        if (error instanceof GhTimeoutError) return null;
        throw error;
      }
    };
    // A timeout while only finding the repository is an error (exit 1): nothing is known to report.
    target = resolveTarget(args, limited);
    const { repo, pr } = target;
    let state = await read();
    let lastRead = deps.now();
    let listenerTried = false;
    let said = false;
    const sayOnce = (line: string) => {
      if (!said) io.stderr(line);
      said = true;
    };

    while (state === null || state.next === "wait") {
      if (state === null || deps.now() >= deadline) break;
      if (!listenerTried) {
        listenerTried = true;
        listener = deps.openListener(repo, Math.max(0, remaining()));
        if (!listener) sayOnce(`wachiman: pr-state: gh event listen is not available; polling every ${args.intervalS} s.`);
      }
      const earliest = lastRead + interval;
      if (listener) {
        const safety = lastRead + SAFETY_POLL_INTERVALS * interval;
        const outcome = await listener.wake(Math.max(0, Math.min(safety, deadline) - deps.now()));
        if (outcome === "failed") {
          listener.close();
          listener = null;
          sayOnce(`wachiman: pr-state: gh event listen stopped; polling every ${args.intervalS} s.`);
        }
      }
      // Whatever woke the loop, the next read is never sooner than one interval after the last one.
      const until = Math.min(Math.max(deps.now(), earliest), deadline);
      if (until > deps.now()) await deps.sleep(until - deps.now());
      if (deps.now() >= deadline) break;
      const next = await read();
      lastRead = deps.now();
      if (next === null) break;
      state = next;
    }
    const last = state ?? timedOutBeforeAnyRead(repo, pr);
    const final: PrState = last.next === "wait" ? { ...last, why: "timeout" } : last;
    io.stdout(`${JSON.stringify(final, null, 2)}\n`);
    return EXIT_FOR[final.next];
  } catch (error) {
    if (error instanceof UsageError) throw error;
    io.stderr(`wachiman: pr-state: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return 1;
  } finally {
    listener?.close();
    removeSignals?.();
  }
}

// ----- `gh event listen` ------------------------------------------------------------------------

/**
 * Starts `gh event listen` for the repository, or returns null when this `gh` has no such command.
 *
 * UNVERIFIED against a real `gh event listen` (v2.105.0+, preview, github.com only): the development
 * `gh` here is 2.100.0 and has no `event` command. The command line below is a best reading of the
 * announced interface. It subscribes to the whole repository on purpose: an event for another pull
 * request only wakes the loop, which re-reads this one's state and is clamped by the interval. Every
 * failure (missing command, rejected flag, sign-in, 24 h expiry, exit 8) ends in the polling fallback.
 */
export function openGhEventListener(repo: string, gh: GhProbe = realGhProbe, remainingMs: number = PROBE_LIMIT_MS): Listener | null {
  try {
    if (!gh.supported(remainingMs)) return null;
    const proc = gh.start(repo);
    return listenerOver(proc.stdout, proc.exited.then(() => undefined), proc.kill);
  } catch {
    return null;
  }
}

/** How the opener reaches `gh`: whether this `gh` has `event listen`, and a way to start it. Swapped in tests. */
export interface GhProbe {
  /** Whether `event listen` exists, answered within `limitMs` (a probe that is still running then is killed: not supported). */
  supported: (limitMs: number) => boolean;
  start: (repo: string) => { stdout: ReadableStream<Uint8Array>; exited: Promise<unknown>; kill: () => void };
}

/** The probe never runs longer than this, and never longer than the time left before the deadline. */
const PROBE_LIMIT_MS = 5_000;

/** `bin` replaces `gh` (and its leading arguments); it exists so a test can run a process that really hangs. */
export function makeGhProbe(bin: readonly string[] = ["gh"]): GhProbe {
  return {
    supported: (limitMs) => {
      // spawnSync takes whole milliseconds only, and the clock is fractional.
      const timeout = Math.floor(Math.min(PROBE_LIMIT_MS, limitMs));
      if (timeout < 1) return false;
      return Bun.spawnSync([...bin, "event", "listen", "--help"], { stdout: "ignore", stderr: "ignore", timeout }).exitCode === 0;
    },
    start: (repo) => {
      const proc = Bun.spawn([...bin, "event", "listen", "--repo", repo], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
      return { stdout: proc.stdout, exited: proc.exited, kill: () => proc.kill() };
    },
  };
}

const realGhProbe = makeGhProbe();

/**
 * A listener over a stream of event lines and a promise that settles when the process ends. Any bytes
 * on the stream are a wake signal; an event that arrives between two waits is kept for the next one.
 */
export function listenerOver(events: ReadableStream<Uint8Array>, ended: Promise<void>, kill: () => void): Listener {
  let pending = false;
  let dead = false;
  let notify: (() => void) | null = null;
  const poke = () => {
    const n = notify;
    notify = null;
    n?.();
  };
  void (async () => {
    try {
      const reader = events.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) (pending = true, poke());
      }
    } catch {
      // A broken stream is the same as an ended process.
    }
    // The stream ended or broke: no more events will come, even if the process lives on.
    dead = true;
    poke();
  })();
  void ended.then(() => (dead = true, poke()), () => (dead = true, poke()));
  return {
    async wake(ms) {
      if (pending) return (pending = false, "event");
      if (dead) return "failed";
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        notify = () => (clearTimeout(timer), resolve());
      });
      notify = null;
      if (pending) return (pending = false, "event");
      return dead ? "failed" : "elapsed";
    },
    close: () => {
      dead = true;
      try {
        kill();
      } catch {
        // Already gone.
      }
    },
  };
}

/**
 * SIGINT, SIGTERM and SIGHUP (what the launcher forwards, and what a closed terminal sends) end the process, but `finally` does not run on a signal, so the handler closes
 * the listener (killing `gh event listen`) first, removes itself, and passes the signal on so the
 * exit status is the usual one.
 */
export const processSignals: WaitDeps["signals"] = {
  install: (handler) => {
    const handlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((signal) => {
      const fn = () => {
        handler(signal);
        remove();
        process.kill(process.pid, signal);
      };
      process.on(signal, fn);
      return [signal, fn] as const;
    });
    const remove = () => {
      for (const [signal, fn] of handlers) process.off(signal, fn);
    };
    return remove;
  },
};

export const realWaitDeps: WaitDeps = {
  now: () => performance.now(),
  sleep: (ms) => Bun.sleep(ms),
  openListener: (repo, remainingMs) => openGhEventListener(repo, realGhProbe, remainingMs),
  timeout: (ms) => {
    let id: ReturnType<typeof setTimeout>;
    const promise = new Promise<null>((resolve) => (id = setTimeout(() => resolve(null), ms)));
    return { promise, cancel: () => clearTimeout(id) };
  },
  limitGh: ghWithin,
  signals: processSignals,
};
