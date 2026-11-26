import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordChoice } from "./consent";
import { askErrorOf, errorOf, outcomeOf, reportRun, runOfAsk, runOfReview } from "./report";
import type { TelemetryRun } from "./summary";

const run: TelemetryRun = runOfAsk({
  model: "opus",
  kept: [{ filename: "a.ts", additions: 1, deletions: 0 }],
  usage: undefined,
  durationMs: 10,
  error: null,
  failed: false,
});

let server: ReturnType<typeof Bun.serve>;
let bodies: string[] = [];
let home: string;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => (bodies.push(await req.text()), new Response(null, { status: 204 })),
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
  bodies = [];
  if (home) rmSync(home, { recursive: true, force: true });
  home = mkdtempSync(join(tmpdir(), "wachiman-report-"));
});
const send = (env: Record<string, string>) =>
  reportRun(run, {
    env: { WACHIMAN_TELEMETRY_URL: `http://127.0.0.1:${server.port}/v1/usage`, ...env },
    home: () => home,
    version: "1.21.0",
  });

describe("reportRun makes a request only with a stored yes in a clean environment", () => {
  test("never asked, or a no: no request", async () => {
    await send({});
    recordChoice(home, "no");
    await send({});
    expect(bodies).toEqual([]);
  });

  test.each([{ DO_NOT_TRACK: "1" }, { WACHIMAN_TELEMETRY: "0" }, { CI: "true" }, { GITHUB_ACTIONS: "true" }] as Record<string, string>[])(
    "a stored yes with %j: no request",
    async (env) => {
      recordChoice(home, "yes");
      await send(env);
      expect(bodies).toEqual([]);
    },
  );

  test("a stored yes: one request with the summary", async () => {
    const { installation } = recordChoice(home, "yes");
    await send({});
    expect(bodies.length).toBe(1);
    const body = JSON.parse(bodies[0]);
    expect(body.format).toBe("wachiman.telemetry/1");
    expect(body.installation).toBe(installation);
  });

  test("a run builder that throws is swallowed, and is not called without a stored yes", async () => {
    let built = 0;
    const throwing = () => {
      built++;
      throw new Error("unexpected result shape");
    };
    const p = { env: { WACHIMAN_TELEMETRY_URL: `http://127.0.0.1:${server.port}/v1/usage` }, home: () => home, version: "1.21.0" };
    await reportRun(throwing, p);
    expect(built).toBe(0);
    recordChoice(home, "yes");
    await reportRun(throwing, p);
    expect(built).toBe(1);
    expect(bodies).toEqual([]);
  });

  test("a home that cannot be resolved is swallowed", async () => {
    await reportRun(run, {
      env: {},
      home: () => {
        throw new Error("WACHIMAN_HOME must be absolute");
      },
      version: "1",
    });
  });
});

describe("what a result becomes", () => {
  const result = (
    execution: object,
    coverage = { partial: false },
    batches: { status: string }[] = [],
    findings: { severity: string }[] = [],
  ) =>
    ({
      provider: { model: "claude-sonnet-5" },
      execution: { usage: undefined, durationMs: 5, callsWithOutput: 1, stop: "complete", ...execution },
      coverage,
      batches,
      findings,
    }) as never;

  test("error categories come from the stop reason and the rejection class, never a message", () => {
    expect(errorOf({ stop: "complete" })).toBeNull();
    expect(errorOf({ stop: "quota", rejection: { kind: "billing", text: "secret@example.com" } })).toBe("quota");
    expect(errorOf({ stop: "error", rejection: { kind: "auth", text: "x" } })).toBe("auth");
    expect(errorOf({ stop: "timeout" })).toBe("timeout");
    expect(errorOf({ stop: "error", rejection: { kind: "other", text: "x" } })).toBe("provider");
    expect(errorOf({ stop: "error" })).toBe("other");
    expect(errorOf({ stop: "budget" })).toBe("quota");
    expect(errorOf({ stop: "turns" })).toBe("other");
  });

  test("outcome: complete, partial or failed", () => {
    expect(outcomeOf(result({}))).toBe("complete");
    expect(outcomeOf(result({}, { partial: true }))).toBe("partial");
    expect(outcomeOf(result({ stop: "budget", callsWithOutput: 2 }))).toBe("partial");
    expect(outcomeOf(result({ stop: "error", callsWithOutput: 0 }))).toBe("failed");
  });

  test("chunks, retries and severities are counted from the batches and findings", () => {
    const r = runOfReview(
      result(
        {},
        { partial: false },
        [{ status: "reviewed" }, { status: "reviewed after a retry" }, { status: "2 file(s) left after a retry" }, { status: "timed out" }],
        [{ severity: "fix" }, { severity: "info" }],
      ),
      [],
    );
    expect(r.chunks).toEqual({ planned: 4, completed: 2 });
    expect(r.retries).toBe(2);
    expect(r.severities).toEqual(["fix", "info"]);
    expect(r.model).toBe("claude-sonnet-5");
  });
});

describe("ask", () => {
  test("a failed answer is one failed chunk with a fixed error category", () => {
    expect(askErrorOf(undefined)).toBe("other");
    expect(askErrorOf({ terminalReason: "error", providerError: "auth" })).toBe("auth");
    expect(askErrorOf({ terminalReason: "error", providerError: "billing" })).toBe("quota");
    expect(askErrorOf({ terminalReason: "timeout" })).toBe("timeout");
    expect(askErrorOf({ terminalReason: "error" })).toBe("provider");
    expect(askErrorOf({ terminalReason: "success", isError: false })).toBe("other");
    expect(askErrorOf({ terminalReason: "error_max_budget_usd", isError: true })).toBe("quota");
    expect(askErrorOf({ terminalReason: "error_max_turns", isError: true })).toBe("other");
    const failed = runOfAsk({ model: "opus", kept: [], usage: undefined, durationMs: 1, error: "auth", failed: true });
    expect([failed.mode, failed.outcome, failed.chunks, failed.severities]).toEqual(["ask", "failed", { planned: 1, completed: 0 }, []]);
    expect(run.outcome).toBe("complete");
  });
});
