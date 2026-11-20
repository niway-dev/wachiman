/**
 * `wachiman pr-state --wait` (ADR 0060 decision 8): a bounded loop over `readPrState`.
 *
 * The loop reads the state at most once per interval and stops at the first answer that is not
 * `wait`, or at the timeout. `gh event listen` is optional acceleration: an event only wakes the
 * loop sooner than its slow safety poll, never sooner than one interval after the last read, and its
 * content is never read (the state is read again). Nothing here stores anything or posts anything.
 */
import { UsageError } from "./config";
import type { GhFn } from "./engine";
import { DEFAULT_INTERVAL_S, DEFAULT_TIMEOUT_S, EXIT_FOR, MIN_INTERVAL_S, readPrState, resolveTarget, type PrState, type PrStateArgs } from "./pr-state";

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
  /** Starts a listener for the repository, or returns null when `gh event listen` is missing or unsupported. */
  openListener: (repo: string) => Listener | null;
}

export interface PrStateWaitArgs extends PrStateArgs {
  wait: true;
  timeoutS: number;
  intervalS: number;
}

type Io = { stdout: (text: string) => void; stderr: (line: string) => void };

/** Waits for `next` to stop being `wait`: the document on stdout, then exit 0, 20, 21 or 22; exit 1 when GitHub fails. */
export async function runPrStateWait(args: PrStateWaitArgs, gh: GhFn, io: Io, deps: WaitDeps): Promise<number> {
  let listener: Listener | null = null;
  try {
    const { repo, pr } = resolveTarget(args, gh);
    const interval = args.intervalS * 1000;
    const deadline = deps.now() + args.timeoutS * 1000;
    let state: PrState = readPrState(gh, repo, pr);
    let lastRead = deps.now();
    let listenerTried = false;
    let said = false;
    const sayOnce = (line: string) => {
      if (!said) io.stderr(line);
      said = true;
    };

    while (state.next === "wait") {
      if (deps.now() >= deadline) {
        state = { ...state, why: "timeout" };
        break;
      }
      if (!listenerTried) {
        listenerTried = true;
        listener = deps.openListener(repo);
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
      if (deps.now() >= deadline) {
        state = { ...state, why: "timeout" };
        break;
      }
      state = readPrState(gh, repo, pr);
      lastRead = deps.now();
    }
    io.stdout(`${JSON.stringify(state, null, 2)}\n`);
    return EXIT_FOR[state.next];
  } catch (error) {
    if (error instanceof UsageError) throw error;
    io.stderr(`wachiman: pr-state: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return 1;
  } finally {
    listener?.close();
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
export function openGhEventListener(repo: string): Listener | null {
  try {
    const help = Bun.spawnSync(["gh", "event", "listen", "--help"], { stdout: "ignore", stderr: "ignore" });
    if (help.exitCode !== 0) return null;
    const proc = Bun.spawn(["gh", "event", "listen", "--repo", repo], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    return listenerOver(proc.stdout, proc.exited.then(() => undefined), () => proc.kill());
  } catch {
    return null;
  }
}

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

export const realWaitDeps: WaitDeps = {
  now: () => performance.now(),
  sleep: (ms) => Bun.sleep(ms),
  openListener: openGhEventListener,
};
