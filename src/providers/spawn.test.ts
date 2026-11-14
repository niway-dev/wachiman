import { describe, expect, test } from "bun:test";
import { spawnCapture } from "./spawn";

const opts = { cwd: process.cwd(), env: process.env, timeoutMs: 5_000, maxBuffer: 1_000_000 };

describe("spawnCapture", () => {
  test("returns the output and the exit status, and feeds stdin", async () => {
    const r = await spawnCapture("sh", ["-c", "cat; echo err >&2; exit 3"], { ...opts, input: "hello" });
    expect(r.stdout).toBe("hello");
    expect(r.stderr).toBe("err\n");
    expect(r.status).toBe(3);
    expect(r.error).toBeUndefined();
  });

  test("kills a call at the time limit and reports ETIMEDOUT", async () => {
    const started = Date.now();
    const r = await spawnCapture("sh", ["-c", "sleep 5"], { ...opts, timeoutMs: 100 });
    expect(r.error?.code).toBe("ETIMEDOUT");
    expect(r.signal).toBe("SIGKILL");
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  test("stops a call whose output passes the cap and reports ENOBUFS", async () => {
    const r = await spawnCapture("sh", ["-c", "yes | head -c 100000; sleep 5"], { ...opts, maxBuffer: 1_000 });
    expect(r.error?.code).toBe("ENOBUFS");
    expect(r.stdout.length).toBeLessThanOrEqual(1_000);
  });

  test("the cap is per stream: a chatty stderr alone does not reach a stdout cap it is under", async () => {
    const r = await spawnCapture("sh", ["-c", "echo ok; yes e | head -c 600 >&2"], { ...opts, maxBuffer: 1_000 });
    expect(r.error).toBeUndefined();
    expect(r.stdout).toBe("ok\n");
    expect(r.stderr.length).toBe(600);
  });

  test("after a normal exit, a grandchild that keeps the pipes open is let go after a grace period", async () => {
    const started = Date.now();
    const r = await spawnCapture("sh", ["-c", "sleep 30 & echo done"], opts);
    expect(r.stdout).toBe("done\n");
    expect(r.status).toBe(0);
    expect(r.error).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);

  test("reports a missing binary as ENOENT", async () => {
    const r = await spawnCapture("wachiman-no-such-binary", [], opts);
    expect(r.error?.code).toBe("ENOENT");
    expect(r.status).toBeNull();
  });

  test("calls started together overlap", async () => {
    const started = Date.now();
    await Promise.all([1, 2, 3, 4].map(() => spawnCapture("sh", ["-c", "sleep 0.5"], opts)));
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("a child that exited by itself is not reported as timed out while its pipes drain", async () => {
    // The limit (300 ms) falls inside the 2 s the pipes get to close after the exit.
    const r = await spawnCapture("sh", ["-c", "sleep 30 & echo done"], { ...opts, timeoutMs: 300 });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("done\n");
  }, 10_000);
});
