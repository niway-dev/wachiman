/**
 * Runs an agent CLI to completion without blocking the process, so several calls can be in flight
 * at once (the batches of one review). It keeps what `spawnSync` gave the adapters: the whole
 * output as text, a hard kill at the time limit, a cap on each stream's output, and the same `error` codes
 * (`ETIMEDOUT` for the kill, `ENOBUFS` for an output past the cap, `ENOENT` for a missing binary).
 */
import { spawn } from "node:child_process";

/** How long the pipes may stay open after the process exited before what was read is taken as the output. */
const PIPE_GRACE_MS = 2_000;

export interface SpawnOutcome {
  stdout: string;
  stderr: string;
  /** The exit code; null when a signal ended the process or it never started. */
  status: number | null;
  signal: NodeJS.Signals | null;
  /** `ETIMEDOUT` after the time limit killed it; `ENOBUFS` past `maxBuffer`; otherwise whatever `spawn` reported. */
  error?: NodeJS.ErrnoException;
}

export function spawnCapture(
  binary: string,
  args: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs: number;
    maxBuffer: number;
    killSignal?: NodeJS.Signals;
  },
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    // Counted per stream, as `spawnSync`'s `maxBuffer` was.
    const bytes = { stdout: 0, stderr: 0 };
    let error: NodeJS.ErrnoException | undefined;
    let settled = false;
    const child = spawn(binary, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    const kill = () => {
      try {
        child.kill(opts.killSignal ?? "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const fail = (code: string) => {
      error ??= Object.assign(new Error(`spawn ${binary} ${code}`), { code }) as NodeJS.ErrnoException;
      kill();
    };
    const timer = setTimeout(() => fail("ETIMEDOUT"), opts.timeoutMs);
    const finish = (status: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A grandchild that inherited the pipes may still hold them open: stop reading.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ stdout, stderr, status, signal, ...(error ? { error } : {}) });
    };
    const collect = (sink: "stdout" | "stderr") => (chunk: string) => {
      bytes[sink] += Buffer.byteLength(chunk);
      if (bytes[sink] > opts.maxBuffer) {
        fail("ENOBUFS");
        return;
      }
      if (sink === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    // A child that exits before reading its prompt closes the pipe: the exit status says what happened.
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      error ??= e as NodeJS.ErrnoException;
      finish(null, null);
    });
    child.on("close", (status, signal) => finish(status, signal));
    // `close` waits for every holder of the pipes. After our own kill (time limit, output cap)
    // the child's exit is the answer; otherwise a lingering holder gets a moment to let go.
    child.on("exit", (status, signal) => {
      if (error) finish(status, signal);
      else {
        // It exited by itself: the time limit no longer applies to what is only a pipe being drained.
        clearTimeout(timer);
        setTimeout(() => finish(status, signal), PIPE_GRACE_MS).unref();
      }
    });
    child.stdin.end(opts.input);
  });
}
