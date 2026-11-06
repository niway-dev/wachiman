import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { verifyReceipt } from "../src/receipt";
import { generateTestKey, mintToken, type TestKey } from "./support/mint";

let key: TestKey;
let runs = 0;
const SELF = (exports as unknown as { default: Fetcher }).default;
const NAMES: Record<string, string> = {
  "2001": "acme/reserve",
  "2002": "acme/refuse",
  "2003": "acme/settle",
  "2004": "acme/forced",
  "3001": "acme/web",
  "3002": "acme/api",
};
const realFetch = globalThis.fetch;

beforeAll(async () => {
  key = await generateTestKey("route-key");
  // Serve the test JWKS; every other request goes through untouched.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new Request(input as RequestInfo).url;
    if (url === "https://jwks.test/keys") return Response.json({ keys: [key.jwk] });
    return realFetch(input, init);
  });
});

async function call(method: string, path: string, repo: string | null, body?: unknown, claims: Record<string, unknown> = {}) {
  runs += 1;
  const headers: Record<string, string> = {};
  if (repo !== null) {
    headers.authorization = `Bearer ${await mintToken(key, { repository_id: repo, repository: NAMES[repo] ?? `acme/r${repo}`, run_id: `run-${runs}`, ...claims })}`;
  }
  return SELF.fetch(`https://ledger.example.com${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const reserveBody = { wanted_usd: 1, trigger: "pull_request", forced: false };

describe("POST /v1/reserve", () => {
  it("200 with the grant, without the ok flag", async () => {
    const res = await call("POST", "/v1/reserve", "2001", { ...reserveBody, wanted_usd: 4 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ granted_usd: 4, account_left_usd: 2, repository_left_usd: null });
    expect(typeof body.reservation_id).toBe("string");
    expect(body).not.toHaveProperty("ok");
  });

  it("402 with the documented body when the account has nothing left", async () => {
    await call("POST", "/v1/reserve", "2002", reserveBody);
    const res = await call("POST", "/v1/reserve", "2002", reserveBody);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "limit", account_spent_usd: 1, account_limit_usd: 1 });
  });

  it("401 without a token, with a bad token, and with a wrong audience", async () => {
    const none = await call("POST", "/v1/reserve", null, reserveBody);
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ reason: "unauthorized" });
    const bad = await SELF.fetch("https://ledger.example.com/v1/reserve", {
      method: "POST",
      headers: { authorization: "Bearer a.b.c" },
      body: JSON.stringify(reserveBody),
    });
    expect(bad.status).toBe(401);
    const aud = await call("POST", "/v1/reserve", "2001", reserveBody, { aud: "https://evil.example.com" });
    expect(aud.status).toBe(401);
  });

  it("401 naming LEDGER_AUDIENCE when it is not set", async () => {
    const token = await mintToken(key, { repository_id: "2001" });
    const res = await worker.fetch(
      new Request("https://ledger.example.com/v1/reserve", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(reserveBody),
      }),
      { ...(env as unknown as Parameters<typeof worker.fetch>[1]), LEDGER_AUDIENCE: "" },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ reason: "unauthorized", detail: "LEDGER_AUDIENCE is not set" });
  });

  it("403 not_linked for an unknown repository", async () => {
    const res = await call("POST", "/v1/reserve", "9999", reserveBody);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ reason: "not_linked", repository: "acme/r9999" });
  });

  it("400 for a body without wanted_usd", async () => {
    const res = await call("POST", "/v1/reserve", "2001", { trigger: "pull_request" });
    expect(res.status).toBe(400);
  });

  it("forced is honoured only from an issue_comment token", async () => {
    await call("POST", "/v1/reserve", "2004", reserveBody); // uses the whole $1
    const auto = await call("POST", "/v1/reserve", "2004", { ...reserveBody, forced: true }, { event_name: "pull_request" });
    expect(auto.status).toBe(402);
    const manual = await call("POST", "/v1/reserve", "2004", { ...reserveBody, forced: true }, { event_name: "issue_comment" });
    expect(manual.status).toBe(200);
    const today = (await (await call("GET", "/v1/today", "2004")).json()) as { spent_usd: number };
    expect(today.spent_usd).toBe(2);
  });
});

describe("POST /v1/settle", () => {
  it("200 with a receipt whose signature verifies against the served public key", async () => {
    const reserved = (await (await call("POST", "/v1/reserve", "2003", { ...reserveBody, wanted_usd: 2 }, { run_id: "settle-run" })).json()) as {
      reservation_id: string;
    };
    const res = await call("POST", "/v1/settle", "2003", { reservation_id: reserved.reservation_id, spent_usd: 1.5 });
    expect(res.status).toBe(200);
    const { receipt, signature } = (await res.json()) as { receipt: Record<string, unknown>; signature: string };
    expect(receipt).toMatchObject({ account: "acct-settle", repository: "acme/settle", run_id: "settle-run", usd: 1.5 });
    expect(receipt.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const pub = (await (await SELF.fetch("https://ledger.example.com/v1/public-key")).json()) as { jwk: JsonWebKey };
    const ok = await verifyReceipt(receipt as never, signature, pub.jwk);
    expect(ok).toBe(true);
  });

  it("404 for an unknown reservation", async () => {
    const res = await call("POST", "/v1/settle", "2003", { reservation_id: "nope", spent_usd: 1 });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/today", () => {
  it("returns the account, totals by repository and by tag (a multi-tag repository counts in each)", async () => {
    await call("POST", "/v1/reserve", "3001", { ...reserveBody, wanted_usd: 2 });
    await call("POST", "/v1/reserve", "3002", { ...reserveBody, wanted_usd: 1 });
    const res = await call("GET", "/v1/today", "3001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      by_tag: [
        { tag: "core", usd: 3 },
        { tag: "web", usd: 2 },
      ],
      account: "acct-today",
      limit_usd: 6,
      spent_usd: 3,
      by_repository: [
        { repository: "acme/web", usd: 2 },
        { repository: "acme/api", usd: 1 },
      ],
    });
  });
});

describe("GET /v1/public-key", () => {
  it("needs no token and returns the JWK and the SPKI PEM", async () => {
    const res = await SELF.fetch("https://ledger.example.com/v1/public-key");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alg: string; jwk: JsonWebKey; pem: string };
    expect(body.alg).toBe("Ed25519");
    expect(body.jwk.crv).toBe("Ed25519");
    expect(body.pem.startsWith("-----BEGIN PUBLIC KEY-----")).toBe(true);
  });
});

describe("unknown routes", () => {
  it("answer 404", async () => {
    expect((await call("GET", "/v1/nope", "2001")).status).toBe(404);
    expect((await call("GET", "/v1/reserve", "2001")).status).toBe(404);
  });
});
