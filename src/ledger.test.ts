import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { everythingIn, readCurlConfig } from "./fixtures/curl-config";
import {
  LedgerNotPermitted,
  LedgerRefused,
  LedgerBadAnswer,
  LedgerUnavailable,
  canonicalReceipt,
  curlConfig,
  defaultCurl,
  readReceipt,
  receiptFooter,
  record,
  requestIdToken,
  reserve,
  settle,
  verifyReceipt,
  type CurlFn,
  type Receipt,
} from "./ledger";

/** A scripted curl: records every call and answers with a body and an HTTP status. */
function fakeCurl(status: number, body: string, exit = 0) {
  const calls: string[][] = [];
  const stdins: (string | undefined)[] = [];
  const curl: CurlFn = (args, stdin) => {
    calls.push(args);
    stdins.push(stdin);
    return { status: exit, stdout: exit === 0 ? `${body}\n${status}` : "", stderr: exit === 0 ? "" : "curl: (7) Failed to connect" };
  };
  return { curl, calls, stdins };
}

const header = (stdin: string | undefined, name: string) => readCurlConfig(stdin).headers.find((h) => h.startsWith(`${name}:`));
const urlOf = (args: string[]) => args[args.length - 1]!;
const bodyOf = (stdin: string | undefined) => readCurlConfig(stdin).data!;

const receipt: Receipt = { account: "acct", repository: "o/r", run_id: "42", usd: 1.25, day: "2026-11-06" };

describe("requestIdToken", () => {
  test("sends the bearer and the audience, returns the token value", () => {
    const { curl, calls, stdins } = fakeCurl(200, JSON.stringify({ value: "jwt.token.here" }));
    const env = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/token?api=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-secret" };
    expect(requestIdToken(env, "https://ledger.example/", curl)).toBe("jwt.token.here");
    expect(urlOf(calls[0]!)).toBe("https://actions.example/token?api=1&audience=https%3A%2F%2Fledger.example%2F");
    expect(header(stdins[0], "Authorization")).toBe("Authorization: Bearer req-secret");
  });

  test("without id-token: write it throws LedgerNotPermitted (not an outage) naming the permission", () => {
    const { curl, calls } = fakeCurl(200, "{}");
    expect(() => requestIdToken({}, "https://ledger.example", curl)).toThrow(LedgerNotPermitted);
    expect(() => requestIdToken({}, "https://ledger.example", curl)).not.toThrow(LedgerUnavailable);
    expect(() => requestIdToken({}, "https://ledger.example", curl)).toThrow(/id-token: write/);
    expect(() => requestIdToken({ ACTIONS_ID_TOKEN_REQUEST_URL: "https://a.example/t" }, "x", curl)).toThrow(/id-token: write/);
    expect(calls).toEqual([]);
  });

  const TOKEN_ENV = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://a/t?x=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" };

  test("a 5xx or a 429 from GitHub is LedgerUnavailable; any other refusal or a body without a value is a bad answer that names id-token", () => {
    for (const status of [500, 503, 429]) expect(() => requestIdToken(TOKEN_ENV, "a", fakeCurl(status, "boom").curl)).toThrow(LedgerUnavailable);
    for (const [status, body] of [[403, "{}"], [404, "{}"], [200, "{}"], [200, "<html>"]] as const) {
      const thrown = (() => {
        try {
          requestIdToken(TOKEN_ENV, "a", fakeCurl(status, body).curl);
        } catch (error) {
          return error;
        }
      })();
      expect(thrown).toBeInstanceOf(LedgerBadAnswer);
      expect((thrown as Error).message).toContain(`HTTP ${status}`);
      expect((thrown as Error).message).toContain("id-token: write");
    }
  });
});

describe("reserve", () => {
  const req = { wantedUsd: 3, callerLimitUsd: 2, callerWeeklyLimitUsd: 9, trigger: "synchronize", forced: false, pr: 7 };
  const ok = { reservationId: "r1", grantedUsd: 2, accountLeftUsd: 4, repositoryLeftUsd: null, day: "2026-11-06", week: "2026-11-02", weekLeftUsd: null };

  test("posts the JSON body to one-slash /v1/reserve with the bearer; a 200 maps to Reservation", () => {
    const { curl, calls, stdins } = fakeCurl(200, JSON.stringify(ok));
    expect(reserve("https://ledger.example", "tok", req, curl)).toEqual(ok);
    expect(urlOf(calls[0]!)).toBe("https://ledger.example/v1/reserve");
    expect(header(stdins[0], "Authorization")).toBe("Authorization: Bearer tok");
    expect(JSON.parse(bodyOf(stdins[0]))).toEqual({
      wantedUsd: 3,
      callerLimitUsd: 2,
      callerWeeklyLimitUsd: 9,
      trigger: "synchronize",
      forced: false,
      pr: 7,
    });
  });

  test("a trailing slash or a double slash on the configured url never reaches the request url", () => {
    for (const url of ["https://ledger.example/", "https://ledger.example//"]) {
      const { curl, calls } = fakeCurl(200, JSON.stringify(ok));
      reserve(url, "tok", req, curl);
      expect(urlOf(calls[0]!)).toBe("https://ledger.example/v1/reserve");
    }
  });

  test("omits the caller limits and the pull request when unset", () => {
    const { curl, stdins } = fakeCurl(200, JSON.stringify(ok));
    reserve("https://ledger.example", "tok", { wantedUsd: 3, trigger: "cli", forced: true }, curl);
    expect(JSON.parse(bodyOf(stdins[0]))).toEqual({ wantedUsd: 3, trigger: "cli", forced: true });
  });

  test("a refusal throws LedgerRefused with the documented fields", () => {
    const body = { reason: "weekly_limit", period: "week", accountSpentUsd: 31, accountLimitUsd: 30, week: "2026-11-02", resetsAt: "2026-11-09T00:00:00Z" };
    const { curl } = fakeCurl(402, JSON.stringify(body));
    let thrown: unknown;
    try {
      reserve("https://ledger.example", "tok", req, curl);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LedgerRefused);
    expect((thrown as LedgerRefused).refusal).toEqual({
      reason: "weekly_limit",
      period: "week",
      accountSpentUsd: 31,
      accountLimitUsd: 30,
      week: "2026-11-02",
      resetsAt: "2026-11-09T00:00:00Z",
    });
  });

  test("a 402 whose body is not JSON (a proxy page, an empty body) is still LedgerRefused with reason limit", () => {
    for (const body of ["<html>Payment required</html>", ""]) {
      let thrown: unknown;
      try {
        reserve("https://ledger.example", "tok", req, fakeCurl(402, body).curl);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(LedgerRefused);
      expect((thrown as LedgerRefused).refusal).toEqual({ reason: "limit" });
    }
  });

  test("the reason in the body wins over the status; 401 and 403 default to unauthorized and not_linked", () => {
    const refusalOf = (status: number, body: string) => {
      try {
        reserve("https://ledger.example", "tok", req, fakeCurl(status, body).curl);
      } catch (e) {
        return (e as LedgerRefused).refusal;
      }
      return undefined;
    };
    expect(refusalOf(401, JSON.stringify({ reason: "unauthorized", detail: "expired" }))?.reason).toBe("unauthorized");
    expect(refusalOf(403, JSON.stringify({ reason: "not_linked", repository: "o/r" }))?.reason).toBe("not_linked");
    expect(refusalOf(403, "<html>")?.reason).toBe("not_linked");
    expect(refusalOf(402, JSON.stringify({ reason: "repository_limit", period: "day" }))).toEqual({ reason: "repository_limit", period: "day" });
  });

  test("a failed connection (curl status 7), a timeout, any 5xx and a 429 are LedgerUnavailable: the only outages", () => {
    expect(() => reserve("https://ledger.example", "tok", req, fakeCurl(0, "", 7).curl)).toThrow(LedgerUnavailable);
    expect(() => reserve("https://ledger.example", "tok", req, fakeCurl(0, "", 28).curl)).toThrow(LedgerUnavailable);
    for (const status of [500, 502, 503, 504, 429]) expect(() => reserve("https://ledger.example", "tok", req, fakeCurl(status, "down").curl)).toThrow(LedgerUnavailable);
  });

  test("anything else unexpected is a bad answer, not an outage: a redirect, a 400 without a reason, 404, 405, a 200 with malformed JSON or without the fields", () => {
    for (const [status, body] of [[301, ""], [302, "<html>"], [400, "{}"], [404, "Not Found"], [405, ""], [200, "<html>"], [200, "{}"], [200, '{"reservationId":"r"}']] as const) {
      const thrown = (() => {
        try {
          reserve("https://ledger.example", "tok", req, fakeCurl(status, body).curl);
        } catch (error) {
          return error;
        }
      })();
      expect(thrown).toBeInstanceOf(LedgerBadAnswer);
      expect(thrown).not.toBeInstanceOf(LedgerUnavailable);
      expect((thrown as Error).message).toContain("`ledger_url` does not look like the spend ledger");
      expect((thrown as Error).message).toContain(`HTTP ${status}`);
    }
  });

  test("a grant that is negative or not finite is a malformed answer, never a budget", () => {
    const granted = (grantedUsd: string) => `{"reservationId":"r","grantedUsd":${grantedUsd},"accountLeftUsd":1,"repositoryLeftUsd":null,"day":"d","week":"w","weekLeftUsd":null}`;
    for (const value of ["-1", "-0.01", "1e999", "-1e999"]) {
      expect(() => reserve("https://ledger.example", "tok", req, fakeCurl(200, granted(value)).curl)).toThrow(LedgerBadAnswer);
    }
    expect(reserve("https://ledger.example", "tok", req, fakeCurl(200, granted("0")).curl).grantedUsd).toBe(0);
  });
});

const CALL = {
  operation: "review",
  label: "batch 1/1",
  model: "m",
  turns: 2,
  duration_ms: 10,
  input_tokens: 1,
  output_tokens: 2,
  cache_read_tokens: 3,
  cache_write_tokens: 4,
  cost_usd: 0.1,
  costKnown: true,
  terminal_reason: "completed",
  auth: "api-key",
};

describe("settle", () => {
  test("returns the receipt and the signature; the body is the reservation, the amount and the calls", () => {
    const { curl, calls, stdins } = fakeCurl(200, JSON.stringify({ receipt, signature: "c2ln" }));
    expect(settle("https://ledger.example/", "tok", "r1", 1.25, [CALL], curl)).toEqual({ receipt, signature: "c2ln" });
    expect(urlOf(calls[0]!)).toBe("https://ledger.example/v1/settle");
    expect(JSON.parse(bodyOf(stdins[0]))).toEqual({ reservationId: "r1", spentUsd: 1.25, calls: [CALL] });
  });

  test("a 404 is a bad answer, a 503 an outage", () => {
    expect(() => settle("https://ledger.example", "tok", "r1", 1, [], fakeCurl(404, "{}").curl)).toThrow(LedgerBadAnswer);
    expect(() => settle("https://ledger.example", "tok", "r1", 1, [], fakeCurl(503, "{}").curl)).toThrow(LedgerUnavailable);
  });
});

describe("record", () => {
  test("posts the unreserved run to /v1/record", () => {
    const { curl, calls, stdins } = fakeCurl(200, JSON.stringify({ id: "x", day: "2026-11-06", week: "2026-11-02" }));
    record("https://ledger.example", "tok", { spentUsd: 0.5, calls: [CALL], trigger: "opened", pr: 7 }, curl);
    expect(urlOf(calls[0]!)).toBe("https://ledger.example/v1/record");
    expect(JSON.parse(bodyOf(stdins[0]))).toEqual({ spentUsd: 0.5, calls: [CALL], trigger: "opened", pr: 7, reason: "unreserved" });
  });

  test("anything but a 200 throws: a 5xx or a failed connection LedgerUnavailable, a 404 a bad answer", () => {
    expect(() => record("https://ledger.example", "tok", { spentUsd: 0, calls: [], trigger: "cli" }, fakeCurl(404, "").curl)).toThrow(LedgerBadAnswer);
    expect(() => record("https://ledger.example", "tok", { spentUsd: 0, calls: [], trigger: "cli" }, fakeCurl(503, "").curl)).toThrow(LedgerUnavailable);
    expect(() => record("https://ledger.example", "tok", { spentUsd: 0, calls: [], trigger: "cli" }, fakeCurl(0, "", 7).curl)).toThrow(LedgerUnavailable);
  });
});

describe("receipt footer", () => {
  test("round-trips through readReceipt, taking the last receipt line", () => {
    const body = `review\n${receiptFooter({ ...receipt, usd: 9 }, "b2xk")}\n\n${receiptFooter(receipt, "c2ln")}\n_cost line_`;
    expect(readReceipt(body)).toEqual({ receipt, signature: "c2ln" });
    expect(receiptFooter(receipt, "c2ln")).toMatch(/^<!-- wachi:receipt [A-Za-z0-9_-]+\.c2ln -->$/);
  });

  test("a body with no receipt line, or a damaged one, reads as null", () => {
    expect(readReceipt("just a review")).toBeNull();
    expect(readReceipt("<!-- wachi:receipt bm90anNvbg.c2ln -->")).toBeNull();
  });
});

describe("verifyReceipt", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signature = sign(null, canonicalReceipt(receipt), privateKey).toString("base64url");

  test("accepts a receipt signed over the canonical bytes", () => {
    expect(verifyReceipt(receipt, signature, pem)).toBe(true);
  });

  test("the canonical bytes order the keys account, repository, run_id, usd, day", () => {
    const shuffled: Receipt = { day: receipt.day, usd: receipt.usd, run_id: receipt.run_id, repository: receipt.repository, account: receipt.account };
    expect(new TextDecoder().decode(canonicalReceipt(shuffled))).toBe('{"account":"acct","repository":"o/r","run_id":"42","usd":1.25,"day":"2026-11-06"}');
    expect(verifyReceipt(shuffled, signature, pem)).toBe(true);
  });

  test("rejects a changed amount, a garbage signature and a wrong key", () => {
    expect(verifyReceipt({ ...receipt, usd: 0.01 }, signature, pem)).toBe(false);
    expect(verifyReceipt(receipt, "!!not-a-signature", pem)).toBe(false);
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyReceipt(receipt, signature, other)).toBe(false);
  });
});

// Signed by the ledger service's receipt code with a throwaway key (the service lives outside this
// repository): the engine must verify what the ledger signs, byte for byte. If the service changes
// how it signs, regenerate this fixture from it.
const LEDGER_SIGNED = {
  receipt: {"account": "niway", "repository": "niway-dev/wachiman", "run_id": "123456", "usd": 0.42, "day": "2026-11-06"},
  signature: "MaRDeNMPljh9YBCVxW5aZ08MnIhlgEVQHV7mA1pt1xXHHxfHqP-50xDns-qUwpQzMQwet10z3L9mG3qqQnEoCw",
  pem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAwo528GLfLJwT+fEss8hoivbrzLiaHDOoGuLj5EO0OMU=\n-----END PUBLIC KEY-----\n",
};

describe("a receipt signed by the ledger", () => {
  test("verifies with the ledger's PEM, and fails once a field changes", () => {
    const { receipt, signature, pem } = LEDGER_SIGNED;
    expect(verifyReceipt(receipt, signature, pem)).toBe(true);
    expect(verifyReceipt({ ...receipt, usd: 0.43 }, signature, pem)).toBe(false);
  });
});

describe("secrets and payloads stay out of the argument list", () => {
  const TOKEN_ENV = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/token?api=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "REQUEST-SECRET" };
  const ID_TOKEN = "ID-TOKEN-SECRET";
  const reserveBody = { wantedUsd: 3, trigger: "opened", forced: false, pr: 7 };

  test("the request token, the id token and every body reach curl on stdin only, on all four calls", () => {
    const token = fakeCurl(200, JSON.stringify({ value: ID_TOKEN }));
    requestIdToken(TOKEN_ENV, "https://ledger.example", token.curl);
    const reserved = fakeCurl(200, JSON.stringify({ reservationId: "r1", grantedUsd: 2, accountLeftUsd: 4, day: "d", week: "w" }));
    reserve("https://ledger.example", ID_TOKEN, reserveBody, reserved.curl);
    const settled = fakeCurl(200, JSON.stringify({ receipt, signature: "c2ln" }));
    settle("https://ledger.example", ID_TOKEN, "r1", 1.25, [CALL], settled.curl);
    const recorded = fakeCurl(200, "{}");
    record("https://ledger.example", ID_TOKEN, { spentUsd: 0.5, calls: [CALL], trigger: "opened", pr: 7 }, recorded.curl);

    for (const { calls, stdins } of [token, reserved, settled, recorded]) {
      expect(calls).toHaveLength(1);
      const argv = calls[0]!.join("\n");
      for (const secret of ["REQUEST-SECRET", ID_TOKEN, "Bearer", "wantedUsd", "reservationId", "spentUsd", CALL.label]) expect(argv).not.toContain(secret);
      expect(argv).toContain("--config\n-");
      expect(stdins[0]).toBeDefined();
      expect(everythingIn(calls[0]!, stdins[0])).toContain("Authorization: Bearer");
    }
    // The same bytes still reach the request.
    expect(header(token.stdins[0], "Authorization")).toBe("Authorization: Bearer REQUEST-SECRET");
    expect(header(reserved.stdins[0], "Authorization")).toBe(`Authorization: Bearer ${ID_TOKEN}`);
    expect(readCurlConfig(reserved.stdins[0]).headers).toContain("Content-Type: application/json");
    expect(bodyOf(reserved.stdins[0])).toBe(JSON.stringify(reserveBody));
    expect(bodyOf(settled.stdins[0])).toBe(JSON.stringify({ reservationId: "r1", spentUsd: 1.25, calls: [CALL] }));
    expect(bodyOf(recorded.stdins[0])).toBe(JSON.stringify({ spentUsd: 0.5, calls: [CALL], trigger: "opened", pr: 7, reason: "unreserved" }));
  });

  test("the configuration escapes what curl would read as syntax, and reads back byte for byte", () => {
    const nasty = JSON.stringify({ text: 'a "quoted" \\ back\nslash\tand\r\v end', unicode: "ñ 😀 é", at: "@file", hash: "# not a comment" });
    expect(readCurlConfig(curlConfig([["data", nasty]])).data).toBe(nasty);
    expect(curlConfig([["header", "A: b"]])).toBe('header = "A: b"\n');
    expect(curlConfig([["data", 'a"b']]).split("\n")).toHaveLength(2);
  });

  // The real curl against a real server in another process (this process blocks while curl runs).
  test("real curl: the server receives the bearer, the content type and a body larger than one argument may be, unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-curl-"));
    const server = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const fs = require("node:fs");
         const s = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
           const url = new URL(req.url);
           fs.writeFileSync(${JSON.stringify(dir)} + "/seen.json", JSON.stringify({ path: url.pathname, auth: req.headers.get("authorization"), type: req.headers.get("content-type"), body: await req.text() }));
           return Response.json({ receipt: ${JSON.stringify(receipt)}, signature: "c2ln" });
         } });
         console.log(s.port);`,
      ],
      { stdout: "pipe", stderr: "ignore" },
    );
    try {
      const reader = server.stdout.getReader();
      const port = Number(new TextDecoder().decode((await reader.read()).value).trim());
      expect(port).toBeGreaterThan(0);
      const many = Array.from({ length: 700 }, (_, i) => ({ ...CALL, label: `call-${i}-${"x".repeat(200)}` }));
      const sent = JSON.stringify({ reservationId: "r1", spentUsd: 1.25, calls: many });
      expect(sent.length).toBeGreaterThan(128 * 1024);
      const out = settle(`http://127.0.0.1:${port}/`, ID_TOKEN, "r1", 1.25, many, defaultCurl);
      expect(out.receipt).toEqual(receipt);
      const seen = JSON.parse(readFileSync(join(dir, "seen.json"), "utf8"));
      expect(seen).toEqual({ path: "/v1/settle", auth: `Bearer ${ID_TOKEN}`, type: "application/json", body: sent });
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
