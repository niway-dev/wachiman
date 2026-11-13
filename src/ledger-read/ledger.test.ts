import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "../config";
import { fixtureHome, removeFixtureHomes } from "../../test/support/dashboard-fixture";
import { refreshIndex } from "../store/index";
import { readSpendRows } from "../store/rows";
import { runDashboard, type DashboardArgs } from "../store/command";
import { parseLedgerArgs, runLedger } from "./command";
import { credentialsPath, deleteCredentials, resolveCredentials, writeCredentials } from "./credentials";
import { listLedgerAccounts } from "./files";
import { pullLedger, type PullDeps } from "./pull";

const temps: string[] = [];
afterAll(() => {
  removeFixtureHomes();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const tempHome = () => {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-ledger-"));
  temps.push(dir);
  return join(dir, ".wachiman");
};

const TOKEN = "tok-SECRET-0123456789abcdef";
const URL_ = "https://ledger.example.test";
const NOW = new Date("2026-11-12T12:00:00Z");

const call = (model: string, auth: string, cost: number) => ({
  operation: "review", label: "batch 1/1", model, turns: 3, duration_ms: 1000, input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0,
  cost_usd: cost, costKnown: true, terminal_reason: "completed", auth,
});
/** Illustrative entries, one per state; invented figures. */
const entry = (id: string, day: string, week: string, state: string, over: Record<string, unknown> = {}) => ({
  id, day, week, repository: "o/alpha", repository_id: 1, pr: 7, run_id: id, run_attempt: 1, trigger: "pull_request", forced: false, state,
  reservedUsd: 1, settledUsd: null, created_at: `${day}T10:00:00Z`, settled_at: null, calls: [], ...over,
});
const ENTRIES = [
  entry("e1", "2026-11-02", "2026-11-02", "settled", { settledUsd: 0.4, calls: [call("claude-opus-5-5", "api-key", 0.3), call("claude-haiku-5-5", "api-key", 0.1)] }),
  entry("e2", "2026-11-10", "2026-11-09", "settled", { pr: 8, settledUsd: 0.6, calls: [call("claude-sonnet-5-5", "oauth-token", 0.6)] }),
  entry("e3", "2026-11-12", "2026-11-09", "reserved", { reservedUsd: 1 }),
  entry("e4", "2026-11-10", "2026-11-09", "unsettled", { reservedUsd: 2 }),
  entry("e5", "2026-11-11", "2026-11-09", "unreserved", { reservedUsd: 0, settledUsd: 0.25, calls: [call("claude-opus-5-5", "api-key", 0.25)] }),
];
const RESPONSE = { account: "acct-1", limits: { dailyUsd: 5, weeklyUsd: 20 }, entries: ENTRIES };

/** A fake HTTP layer that records every request. */
function fakeFetch(body: unknown = RESPONSE, status = 200) {
  const requests: { url: string; authorization: string | null }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, requests };
}
const deps = (f: ReturnType<typeof fakeFetch>): PullDeps => ({ fetch: f.fn, now: () => NOW });

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

describe("credentials", () => {
  test("connect keeps {url, token} at mode 0600; disconnect deletes it; the environment overrides the file", async () => {
    const home = tempHome();
    const out: string[] = [];
    const err: string[] = [];
    await runLedger({ action: "connect", url: `${URL_}/` }, { WACHIMAN_HOME: home }, { stdout: (t) => out.push(t), stderr: (t) => err.push(t), readToken: async () => `${TOKEN}\n` });
    expect(JSON.parse(readFileSync(credentialsPath(home), "utf8"))).toEqual({ url: URL_, token: TOKEN });
    expect(statSync(credentialsPath(home)).mode & 0o777).toBe(0o600);
    expect(out.join("") + err.join("")).not.toContain(TOKEN);
    expect(resolveCredentials(home, { WACHIMAN_LEDGER_TOKEN: "other-token" })).toEqual({ url: URL_, token: "other-token" });
    expect(resolveCredentials(home, { WACHIMAN_LEDGER_URL: "https://b.example.test" })?.url).toBe("https://b.example.test");
    expect(deleteCredentials(home)).toBe(true);
    expect(resolveCredentials(home, {})).toBeUndefined();
    expect(deleteCredentials(home)).toBe(false);
  });
  test("an http URL is refused except on localhost, and so is a URL with a password", () => {
    const home = tempHome();
    expect(() => writeCredentials(home, { url: "http://ledger.example.test", token: "t" })).toThrow(UsageError);
    expect(() => writeCredentials(home, { url: "https://u:p@ledger.example.test", token: "t" })).toThrow(UsageError);
    expect(() => writeCredentials(home, { url: "http://127.0.0.1:8787", token: "t" })).not.toThrow();
  });
  test("argument parsing", () => {
    expect(parseLedgerArgs(["pull", "--since", "7d"])).toEqual({ action: "pull", sinceDays: 7 });
    expect(parseLedgerArgs(["pull"])).toEqual({ action: "pull" });
    expect(() => parseLedgerArgs(["pull", "--since", "93d"])).toThrow(UsageError);
    expect(() => parseLedgerArgs(["connect"])).toThrow(UsageError);
    expect(() => parseLedgerArgs(["wat"])).toThrow(UsageError);
  });
});

describe("pull", () => {
  test("writes one file per day, and a second pull stores nothing twice", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    const f = fakeFetch();
    const first = await pullLedger(home, {}, undefined, deps(f));
    expect(first).toMatchObject({ account: "acct-1", entries: 5, daysWritten: 4, from: "2026-10-09", to: "2026-11-12" });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].url).toBe(`${URL_}/v1/entries?from=2026-10-09&to=2026-11-12`);
    expect(f.requests[0].authorization).toBe(`Bearer ${TOKEN}`);
    const dir = join(home, "ledger", "acct-1");
    expect(readdirSync(dir).sort()).toEqual(["2026-11-02.json", "2026-11-10.json", "2026-11-11.json", "2026-11-12.json", "pull.json"]);
    const day10 = JSON.parse(readFileSync(join(dir, "2026-11-10.json"), "utf8"));
    expect(day10.entries.map((e: { id: string }) => e.id).sort()).toEqual(["e2", "e4"]);
    const before = files(dir).map((p) => [p, readFileSync(p, "utf8")]);
    await pullLedger(home, {}, undefined, deps(f));
    const countEntries = () => files(dir).filter((p) => /\d{4}-\d{2}-\d{2}\.json$/.test(p)).reduce((n, p) => n + JSON.parse(readFileSync(p, "utf8")).entries.length, 0);
    expect(countEntries()).toBe(5);
    const strip = (rows: string[][]) => rows.filter(([p]) => !p.endsWith("pull.json"));
    expect(strip(files(dir).map((p) => [p, readFileSync(p, "utf8")]))).toEqual(strip(before));
    expect(JSON.parse(readFileSync(join(dir, "pull.json"), "utf8")).limits).toEqual({ dailyUsd: 5, weeklyUsd: 20 });
  });
  test("a day that no longer has entries loses its file; a pull replaces a day as a whole", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    await pullLedger(home, {}, undefined, deps(fakeFetch({ ...RESPONSE, entries: ENTRIES.filter((e) => e.id !== "e1" && e.id !== "e4") })));
    const dir = join(home, "ledger", "acct-1");
    expect(existsSync(join(dir, "2026-11-02.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "2026-11-10.json"), "utf8")).entries.map((e: { id: string }) => e.id)).toEqual(["e2"]);
  });
  test("the token is in the credentials file and nowhere else, and errors do not carry it", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    for (const p of files(home)) {
      const has = readFileSync(p, "utf8").includes(TOKEN);
      expect(has).toBe(p === credentialsPath(home));
    }
    for (const status of [401, 500]) {
      const error = await pullLedger(home, {}, undefined, deps(fakeFetch({ echo: TOKEN }, status))).catch((e) => e as Error);
      expect((error as Error).message).not.toContain(TOKEN);
    }
    const unreachable: PullDeps = { now: () => NOW, fetch: (async () => { throw new Error(`boom ${TOKEN}`); }) as unknown as typeof fetch };
    expect(((await pullLedger(home, {}, undefined, unreachable).catch((e) => e)) as Error).message).not.toContain(TOKEN);
  });
  test("without credentials nothing is requested", async () => {
    const f = fakeFetch();
    await expect(pullLedger(tempHome(), {}, undefined, deps(f))).rejects.toBeInstanceOf(UsageError);
    expect(f.requests).toHaveLength(0);
  });
  test("a malformed answer is an error and writes nothing", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await expect(pullLedger(home, {}, undefined, deps(fakeFetch({ account: "a", entries: [{ id: "x", day: "2026-11-01", week: "2026-10-26", state: "weird" }] })))).rejects.toThrow(/unexpected ledger answer/);
    expect(listLedgerAccounts(home)).toEqual([]);
  });
});

describe("index", () => {
  test("rebuilding from the day files reproduces the same rows", async () => {
    const { wachiman: home, index } = fixtureHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    refreshIndex(home, () => {});
    const first = readSpendRows(index);
    expect(first.rows.filter((r) => r.source === "actions")).toHaveLength(5);
    expect(first.rows.filter((r) => r.source === "laptop")).toHaveLength(4);
    expect(first.limits).toEqual({ dailyUsd: 5, weeklyUsd: 20 });
    rmSync(index);
    refreshIndex(home, () => {});
    expect(readSpendRows(index)).toEqual(first);
    refreshIndex(home, () => {}, { force: true });
    expect(readSpendRows(index)).toEqual(first);
  });
  test("a second pull changes the index signature only when the files change", async () => {
    const { wachiman: home } = fixtureHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    expect(refreshIndex(home, () => {}).rebuilt).toBe(true);
    expect(refreshIndex(home, () => {}).rebuilt).toBe(false);
  });
});

describe("requests happen only on an explicit command", () => {
  const originalFetch = globalThis.fetch;
  const dash = (home: string, args: Partial<DashboardArgs> = {}) => runDashboard({ json: false, ...args }, { WACHIMAN_HOME: home }, { stdout: () => {}, stderr: () => {}, now: () => NOW });

  test("status and dashboard make no request without --refresh", async () => {
    const f = fakeFetch();
    globalThis.fetch = f.fn;
    try {
      const { wachiman: home } = fixtureHome();
      writeCredentials(home, { url: URL_, token: TOKEN });
      const { runStatus, parseStatusArgs } = await import("../status/command");
      const out: string[] = [];
      runStatus(parseStatusArgs(["--all-repos"]) as never, home, { WACHIMAN_HOME: home }, { stdout: (t) => out.push(t), stderr: () => {}, version: "0", now: () => NOW });
      dash(home);
      dash(home, { json: true });
      expect(f.requests).toHaveLength(0);
      const main = (await import("../cli")).main;
      expect(await main(["ledger", "pull"], { WACHIMAN_HOME: home })).toBe(0);
      expect(f.requests).toHaveLength(1);
      expect(await main(["dashboard", "--refresh", "--out", join(home, "d.html")], { WACHIMAN_HOME: home })).toBe(0);
      expect(f.requests).toHaveLength(2);
      expect(await main(["status", "--refresh", "--all-repos"], { WACHIMAN_HOME: home })).toBe(0);
      expect(f.requests).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("the page", () => {
  async function page(withLedger: boolean) {
    const { wachiman: home } = fixtureHome();
    if (withLedger) {
      writeCredentials(home, { url: URL_, token: TOKEN });
      await pullLedger(home, {}, undefined, deps(fakeFetch()));
    }
    const out = join(home, "page.html");
    runDashboard({ json: false, out }, { WACHIMAN_HOME: home }, { stdout: () => {}, stderr: () => {}, now: () => NOW });
    return { html: readFileSync(out, "utf8"), home, out };
  }

  test("has no external reference, no script and no token", async () => {
    const { html } = await page(true);
    expect(html).not.toMatch(/(src|href)\s*=\s*["']?\s*(https?:)?\/\//i);
    expect(html).not.toMatch(/(src|href)\s*=/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|@import|url\(/i);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain(URL_);
  });
  test("shows the split, the limit, the last pull, and the lines that are not spend", async () => {
    const { html } = await page(true);
    expect(html).toContain("last pulled 2026-11-12T12:00:00.000Z");
    expect(html).toContain("best-effort");
    expect(html).toContain("daily limit $5.00");
    expect(html).toContain("weekly limit $20.00");
    expect(html).toContain("Billed");
    expect(html).toContain("Estimated");
    expect(html).toContain("Runs that were not reserved");
    expect(html).toContain("$0.25 recorded");
    expect(html).toContain("Reservations that never settled");
    expect(html).toContain("$2.00 held");
    expect(html).toContain("o/alpha #7");
    expect(html).toContain("claude-opus-5-5");
    expect(html).toContain('class="limit"');
  });
  test("a period before the first laptop run shows no data, not zero", async () => {
    const { html } = await page(true);
    // The laptop fixture starts on 2026-11-01; the pull covers from 2026-10-09: the first weeks have Actions data only.
    expect(html).toMatch(/Week of 2026-10-05[^<]*<\/td><td class="num">0<\/td><td class="num">0<\/td><td class="num">\$0\.00<\/td><td class="num">\$0\.00<\/td><td class="num">no data<\/td>/);
  });
  test("before the first pull, Actions figures say no data", async () => {
    const { wachiman: home } = fixtureHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    const out = join(home, "page.html");
    runDashboard({ json: false, out }, { WACHIMAN_HOME: home }, { stdout: () => {}, stderr: () => {}, now: () => NOW });
    const html = readFileSync(out, "utf8");
    expect(html).toContain("has not been pulled yet");
    expect(html).toMatch(/<b>no data<\/b>GitHub Actions/);
  });
  test("with no ledger the page is as before and mentions a ledger on one line only", async () => {
    const { html } = await page(false);
    expect(html.split("\n").filter((l) => /ledger/i.test(l))).toHaveLength(1);
    expect(html).toContain("Spend per day");
    expect(html).toContain("wachiman ledger connect");
    expect(html).not.toContain("Dollars per week");
  });
});

describe("end to end through the real command line", () => {
  test("connect from a pipe, pull from a local server, then read: the token appears only in the credentials file", async () => {
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(`${new URL(req.url).pathname} ${req.headers.get("authorization")}`);
        const day = new Date().toISOString().slice(0, 10);
        const wk = (() => { const d = new Date(`${day}T00:00:00Z`); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10); })();
        return Response.json({ account: "acct-1", limits: { dailyUsd: 5, weeklyUsd: null }, entries: [entry("live", day, wk, "settled", { settledUsd: 0.5, calls: [call("claude-opus-5-5", "api-key", 0.5)] })] });
      },
    });
    try {
      const home = tempHome();
      const cli = join(import.meta.dir, "..", "cli.ts");
      const run = async (args: string[], stdin?: string) => {
        const proc = Bun.spawn([process.execPath, cli, ...args], {
          env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), WACHIMAN_HOME: home },
          stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { code: proc.exitCode, stdout, stderr };
      };
      const outputs = [];
      outputs.push(await run(["ledger", "connect", `http://127.0.0.1:${server.port}`], `${TOKEN}\n`));
      outputs.push(await run(["ledger", "pull"]));
      outputs.push(await run(["status", "--all-repos", "--json"]));
      outputs.push(await run(["dashboard"]));
      expect(outputs.map((o) => o.code)).toEqual([0, 0, 0, 0]);
      for (const o of outputs) expect(o.stdout + o.stderr).not.toContain(TOKEN);
      expect(seen).toEqual([`/v1/entries Bearer ${TOKEN}`]);
      expect(statSync(credentialsPath(home)).mode & 0o777).toBe(0o600);
      for (const p of files(home)) expect(readFileSync(p).includes(TOKEN)).toBe(p === credentialsPath(home));
      expect(JSON.parse(outputs[2].stdout).report.totals.total.usd).toBe(0.5);
      expect((await run(["ledger", "disconnect"])).code).toBe(0);
      expect(existsSync(credentialsPath(home))).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
