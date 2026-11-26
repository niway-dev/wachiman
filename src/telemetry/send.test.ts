import { afterEach, describe, expect, test } from "bun:test";
import { buildSummary, type TelemetryRun } from "./summary";
import { ENDPOINT, sendSummary, TIMEOUT_MS } from "./send";

const run: TelemetryRun = {
  mode: "local",
  model: "opus",
  files: [{ filename: "a.ts", additions: 1, deletions: 0 }],
  chunks: { planned: 1, completed: 1 },
  usage: undefined,
  durationMs: 1000,
  outcome: "complete",
  retries: 0,
  error: null,
  severities: [],
  distributed: false,
};
const summary = buildSummary(run, {
  installation: "7b0f3a52-7f0e-4b0e-9d6a-1f2f3a4b5c6d",
  version: "1.21.0",
  now: new Date("2026-11-26T00:00:00Z"),
});

const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

describe("sendSummary", () => {
  test("posts the JSON to /v1/usage on the public endpoint by default", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    await sendSummary(summary, {
      env: {},
      fetch: (async (url: string, init?: RequestInit) => ((seen = { url, init }), new Response(null, { status: 204 }))) as never,
    });
    expect(ENDPOINT).toBe("https://usage.wachiman-api.dev/v1/usage");
    expect(seen?.url).toBe(ENDPOINT);
    expect(seen?.init?.method).toBe("POST");
    expect(JSON.parse(String(seen?.init?.body))).toEqual(JSON.parse(JSON.stringify(summary)));
    expect(new Headers(seen?.init?.headers).get("content-type")).toBe("application/json");
    expect(seen?.init?.redirect).toBe("error");
  });

  test("WACHIMAN_TELEMETRY_URL replaces the endpoint, and a URL that is not https (or loopback http) sends nothing", async () => {
    const urls: string[] = [];
    const fetch = (async (url: string) => (urls.push(url), new Response(null, { status: 204 }))) as never;
    await sendSummary(summary, { env: { WACHIMAN_TELEMETRY_URL: "http://127.0.0.1:9/v1/usage" }, fetch });
    await sendSummary(summary, { env: { WACHIMAN_TELEMETRY_URL: "http://example.org/v1/usage" }, fetch });
    await sendSummary(summary, { env: { WACHIMAN_TELEMETRY_URL: "nonsense" }, fetch });
    expect(urls).toEqual(["http://127.0.0.1:9/v1/usage"]);
  });

  test("swallows a throwing fetch, 400, 413 and 500 answers, and makes one attempt", async () => {
    let calls = 0;
    await sendSummary(summary, { env: {}, fetch: (async () => (calls++, Promise.reject(new Error("boom")))) as never });
    for (const status of [400, 413, 500])
      await sendSummary(summary, { env: {}, fetch: (async () => (calls++, new Response(null, { status }))) as never });
    expect(calls).toBe(4);
  });

  test("a body over 4096 bytes is not sent", async () => {
    let calls = 0;
    await sendSummary({ ...summary, version: "x".repeat(5000) }, { env: {}, fetch: (async () => (calls++, new Response(null))) as never });
    expect(calls).toBe(0);
  });

  test("an endpoint that never answers returns at about the timeout, and writes nothing", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => {}) });
    servers.push(server);
    const writes: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => (writes.push(String(c)), true)) as never;
    process.stderr.write = ((c: string) => (writes.push(String(c)), true)) as never;
    const started = Date.now();
    try {
      await sendSummary(summary, { env: { WACHIMAN_TELEMETRY_URL: `http://127.0.0.1:${server.port}/v1/usage` } });
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }
    const took = Date.now() - started;
    expect(TIMEOUT_MS).toBe(2000);
    expect(took).toBeGreaterThanOrEqual(1800);
    expect(took).toBeLessThan(TIMEOUT_MS + 1000);
    expect(writes).toEqual([]);
  }, 10_000);
});
