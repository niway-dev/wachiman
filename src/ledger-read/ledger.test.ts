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
import { readLedgerFromFiles } from "./rows";
import { parseEntriesResponse } from "./types";
import { runStatus, parseStatusArgs } from "../status/command";
import { utimesSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
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
  test("the index is rebuilt after a pull that changes the entries, and not when nothing changed", async () => {
    const { wachiman: home, index } = fixtureHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    expect(refreshIndex(home, () => {}).rebuilt).toBe(true);
    expect(refreshIndex(home, () => {}).rebuilt).toBe(false);
    await pullLedger(home, {}, undefined, deps(fakeFetch({ ...RESPONSE, entries: ENTRIES.filter((e) => e.id !== "e2") })));
    expect(refreshIndex(home, () => {}).rebuilt).toBe(true);
    expect(readSpendRows(index).rows.filter((r) => r.source === "actions")).toHaveLength(4);
  });
  test("the rows in the index equal the rows read from the day files", async () => {
    const { wachiman: home, index } = fixtureHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    refreshIndex(home, () => {});
    const byRun = (a: { runId: string }, b: { runId: string }) => a.runId.localeCompare(b.runId);
    const fromIndex = readSpendRows(index).rows.filter((r) => r.source === "actions").sort(byRun);
    const fromFiles = readLedgerFromFiles(home, () => {}).rows.sort(byRun);
    expect(fromFiles).toEqual(fromIndex);
    expect(readLedgerFromFiles(home, () => {}).ranges).toEqual(readSpendRows(index).actions);
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

describe("review fixes", () => {
  const status = (home: string, argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    runStatus(parseStatusArgs(argv) as never, home, { WACHIMAN_HOME: home }, { stdout: (t) => out.push(t), stderr: (l) => err.push(l), version: "0", now: () => NOW });
    return { out: out.join(""), err };
  };

  test("run_attempt may be a number or a numeric string", () => {
    const parse = (v: unknown) => parseEntriesResponse({ account: "a", limits: { dailyUsd: null, weeklyUsd: null }, entries: [entry("x", "2026-11-01", "2026-10-26", "reserved", { run_attempt: v })] }).entries[0].run_attempt;
    expect(parse(2)).toBe(2);
    expect(parse("2")).toBe(2);
    expect(parse("two")).toBeNull();
  });

  test("a redirect is refused and named; the request asks fetch not to follow redirects", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    let init: RequestInit | undefined;
    const redirecting: PullDeps = { now: () => NOW, fetch: (async (_u: unknown, i?: RequestInit) => { init = i; throw new TypeError("fetch failed: redirect mode is set to error"); }) as unknown as typeof fetch };
    const error = (await pullLedger(home, {}, undefined, redirecting).catch((e) => e)) as Error;
    expect(init?.redirect).toBe("error");
    expect(error.message).toMatch(/redirected/);
    expect(error.message).not.toContain(TOKEN);
    const f3xx: PullDeps = { now: () => NOW, fetch: (async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.test" } })) as unknown as typeof fetch };
    expect(((await pullLedger(home, {}, undefined, f3xx).catch((e) => e)) as Error).message).toMatch(/redirected/);
  });

  test("a wider pull and then a plain pull keep the older days, and coverage is the union", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    const old = entry("old", "2026-09-01", "2026-08-31", "settled", { settledUsd: 0.5, calls: [call("claude-opus-5-5", "api-key", 0.5)] });
    await pullLedger(home, {}, 90, deps(fakeFetch({ ...RESPONSE, entries: [old, ...ENTRIES] })));
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    const dir = join(home, "ledger", "acct-1");
    expect(existsSync(join(dir, "2026-09-01.json"))).toBe(true);
    const l = readLedgerFromFiles(home, () => {});
    expect(l.ranges).toEqual([{ from: "2026-08-15", to: "2026-11-12" }]);
    expect(l.rows.map((r) => r.runId)).toContain("old");
  });

  test("pulls that do not touch stay two ranges; overlapping or adjacent ones merge", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, 5, { fetch: fakeFetch({ ...RESPONSE, entries: [] }).fn, now: () => new Date("2026-08-05T12:00:00Z") });
    await pullLedger(home, {}, 5, { fetch: fakeFetch({ ...RESPONSE, entries: [] }).fn, now: () => NOW });
    expect(readLedgerFromFiles(home, () => {}).ranges).toEqual([{ from: "2026-08-01", to: "2026-08-05" }, { from: "2026-11-08", to: "2026-11-12" }]);
    await pullLedger(home, {}, 5, { fetch: fakeFetch({ ...RESPONSE, entries: [] }).fn, now: () => new Date("2026-08-10T12:00:00Z") });
    expect(readLedgerFromFiles(home, () => {}).ranges[0]).toEqual({ from: "2026-08-01", to: "2026-08-10" });
  });

  test("the command says how many day files were deleted", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    const out: string[] = [];
    const io = { stdout: (t: string) => out.push(t), stderr: () => {}, pull: deps(fakeFetch({ ...RESPONSE, entries: ENTRIES.filter((e) => e.id !== "e1") })) };
    expect(await runLedger({ action: "pull" }, { WACHIMAN_HOME: home }, io)).toBe(0);
    expect(out.join("")).toMatch(/1 day file deleted/);
  });

  test("a plain dashboard ignores a malformed credentials file and a bad URL in the environment", async () => {
    const { wachiman: home } = fixtureHome();
    mkdirSync(join(home, "ledger"), { recursive: true });
    writeFileSync(credentialsPath(home), "{ not json");
    const out = join(home, "p.html");
    const run = () => runDashboard({ json: false, out }, { WACHIMAN_HOME: home, WACHIMAN_LEDGER_URL: "ftp://bad", WACHIMAN_LEDGER_TOKEN: "x" }, { stdout: () => {}, stderr: () => {}, now: () => NOW });
    expect(run).not.toThrow();
    expect(readFileSync(out, "utf8")).toContain("has not been pulled yet");
  });

  test("status reads the day files and never touches the index, even on a read-only home", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    const before = files(home).sort();
    chmodSync(home, 0o500);
    try {
      const { out } = status(home, ["--all-repos"]);
      expect(out).toContain("$");
      expect(out).toContain("counted against the ledger limit");
    } finally {
      chmodSync(home, 0o700);
    }
    expect(files(home).sort()).toEqual(before);
  });

  test("the limit figures ignore --repo, --model, --since and --profile", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    const used = (argv: string[]) => JSON.parse(status(home, [...argv, "--json"]).out).limitUse;
    const base = used(["--all-repos"]);
    expect(base.day.usedUsd).toBeGreaterThan(0);
    for (const argv of [["--all-repos", "--model", "nothing-matches"], ["--repo", "other"], ["--all-repos", "--since", "1d"], ["--all-repos", "--profile", "p"]]) {
      expect(used(argv)).toEqual(base);
    }
    expect(status(home, ["--all-repos", "--model", "nothing-matches"]).out).toContain(`of $5.00`);
  });

  test("--source actions with no pulled ledger says what to do", () => {
    const home = tempHome();
    expect(() => status(home, ["--all-repos", "--source", "actions"])).toThrow(/ledger connect/);
  });

  test("a pull removes stale temporary files and keeps fresh ones", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    const dir = join(home, "ledger", "acct-1");
    const stale = join(dir, "2026-11-02.json.tmp-99999");
    const fresh = join(dir, "2026-11-10.json.tmp-99998");
    writeFileSync(stale, "x");
    writeFileSync(fresh, "x");
    const long = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(stale, long, long);
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("repository and model names are escaped in the page, in HTML and in SVG text", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    const evil = `o/<script>alert("x")</script>&'`;
    const hostile = entry("h1", "2026-11-10", "2026-11-09", "settled", { repository: evil, settledUsd: 0.5, calls: [call(`m<script>"&`, "api-key", 0.5)] });
    await pullLedger(home, {}, undefined, deps(fakeFetch({ ...RESPONSE, entries: [hostile] })));
    const out = join(home, "p.html");
    runDashboard({ json: false, out }, { WACHIMAN_HOME: home }, { stdout: () => {}, stderr: () => {}, now: () => NOW });
    const html = readFileSync(out, "utf8");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain(evil);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).not.toMatch(/<img|onerror=/i);
  });

  test("the limit line is drawn only on the chart of what the ledger counts", async () => {
    const home = tempHome();
    writeCredentials(home, { url: URL_, token: TOKEN });
    await pullLedger(home, {}, undefined, deps(fakeFetch()));
    const out = join(home, "p.html");
    runDashboard({ json: false, out }, { WACHIMAN_HOME: home }, { stdout: () => {}, stderr: () => {}, now: () => NOW });
    const html = readFileSync(out, "utf8");
    for (const title of ["Counted against the limit, per day (GitHub Actions runs)", "Spend per day, by source", "Counted against the limit, per week (GitHub Actions runs)", "Spend per week, by source"]) expect(html).toContain(title);
    const svgs = html.split("<svg").slice(1).map((x) => x.split("</svg>")[0]);
    const counted = svgs.filter((x) => /counted against the ledger limit/.test(x));
    const bySource = svgs.filter((x) => /by source/.test(x));
    expect(counted).toHaveLength(2);
    expect(bySource).toHaveLength(2);
    for (const x of counted) expect(x).toContain('class="limit"');
    for (const x of bySource) expect(x).not.toContain('class="limit"');
  });
});
