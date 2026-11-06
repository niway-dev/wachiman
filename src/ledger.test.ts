import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  LedgerRefused,
  LedgerUnavailable,
  canonicalReceipt,
  readReceipt,
  receiptFooter,
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
  const curl: CurlFn = (args) => {
    calls.push(args);
    return { status: exit, stdout: exit === 0 ? `${body}\n${status}` : "", stderr: exit === 0 ? "" : "curl: (7) Failed to connect" };
  };
  return { curl, calls };
}

const header = (args: string[], name: string) => args.find((a, i) => args[i - 1] === "-H" && a.startsWith(`${name}:`));
const urlOf = (args: string[]) => args[args.length - 1]!;
const bodyOf = (args: string[]) => args[args.indexOf("--data") + 1]!;

const receipt: Receipt = { account: "acct", repository: "o/r", run_id: "42", usd: 1.25, day: "2026-11-06" };

describe("requestIdToken", () => {
  test("sends the bearer and the audience, returns the token value", () => {
    const { curl, calls } = fakeCurl(200, JSON.stringify({ value: "jwt.token.here" }));
    const env = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/token?api=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-secret" };
    expect(requestIdToken(env, "https://ledger.example/", curl)).toBe("jwt.token.here");
    expect(urlOf(calls[0]!)).toBe("https://actions.example/token?api=1&audience=https%3A%2F%2Fledger.example%2F");
    expect(header(calls[0]!, "Authorization")).toBe("Authorization: Bearer req-secret");
  });

  test("without id-token: write it throws LedgerUnavailable naming the permission", () => {
    const { curl, calls } = fakeCurl(200, "{}");
    expect(() => requestIdToken({}, "https://ledger.example", curl)).toThrow(LedgerUnavailable);
    expect(() => requestIdToken({}, "https://ledger.example", curl)).toThrow(/id-token: write/);
    expect(() => requestIdToken({ ACTIONS_ID_TOKEN_REQUEST_URL: "https://a.example/t" }, "x", curl)).toThrow(/id-token: write/);
    expect(calls).toEqual([]);
  });

  test("a non-200 or a body without a value is LedgerUnavailable", () => {
    expect(() => requestIdToken({ ACTIONS_ID_TOKEN_REQUEST_URL: "https://a/t?x=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" }, "a", fakeCurl(500, "boom").curl)).toThrow(LedgerUnavailable);
    expect(() => requestIdToken({ ACTIONS_ID_TOKEN_REQUEST_URL: "https://a/t?x=1", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" }, "a", fakeCurl(200, "{}").curl)).toThrow(LedgerUnavailable);
  });
});

describe("reserve", () => {
  const req = { wantedUsd: 3, callerLimitUsd: 2, trigger: "synchronize", forced: false };
  const ok = { reservation_id: "r1", granted_usd: 2, account_left_usd: 4, repository_left_usd: null, day: "2026-11-06" };

  test("posts the JSON body to one-slash /v1/reserve with the bearer; a 200 maps to Reservation", () => {
    const { curl, calls } = fakeCurl(200, JSON.stringify(ok));
    expect(reserve("https://ledger.example", "tok", req, curl)).toEqual({
      reservationId: "r1",
      grantedUsd: 2,
      accountLeftUsd: 4,
      repositoryLeftUsd: null,
      day: "2026-11-06",
    });
    expect(urlOf(calls[0]!)).toBe("https://ledger.example/v1/reserve");
    expect(header(calls[0]!, "Authorization")).toBe("Authorization: Bearer tok");
    expect(JSON.parse(bodyOf(calls[0]!))).toEqual({ wanted_usd: 3, caller_limit_usd: 2, trigger: "synchronize", forced: false });
  });

  test("a trailing slash or a double slash on the configured url never reaches the request url", () => {
    for (const url of ["https://ledger.example/", "https://ledger.example//"]) {
      const { curl, calls } = fakeCurl(200, JSON.stringify(ok));
      reserve(url, "tok", req, curl);
      expect(urlOf(calls[0]!)).toBe("https://ledger.example/v1/reserve");
    }
  });

  test("omits caller_limit_usd when unset", () => {
    const { curl, calls } = fakeCurl(200, JSON.stringify(ok));
    reserve("https://ledger.example", "tok", { wantedUsd: 3, trigger: "cli", forced: true }, curl);
    expect(JSON.parse(bodyOf(calls[0]!))).toEqual({ wanted_usd: 3, trigger: "cli", forced: true });
  });

  test("a 402 throws LedgerRefused with the documented fields camel-cased", () => {
    const body = { reason: "limit", account_spent_usd: 6.12, account_limit_usd: 6, day: "2026-11-06", resets_at: "2026-11-07T00:00:00Z" };
    const { curl } = fakeCurl(402, JSON.stringify(body));
    let thrown: unknown;
    try {
      reserve("https://ledger.example", "tok", req, curl);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LedgerRefused);
    expect((thrown as LedgerRefused).refusal).toEqual({
      reason: "limit",
      accountSpentUsd: 6.12,
      accountLimitUsd: 6,
      day: "2026-11-06",
      resetsAt: "2026-11-07T00:00:00Z",
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
      expect((thrown as LedgerRefused).message).toContain("limit");
    }
  });

  test("401 and 403 are refusals: unauthorized and not_linked", () => {
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
  });

  test("a failed connection (curl status 7), a 503 and an unparsable 200 are LedgerUnavailable", () => {
    expect(() => reserve("https://ledger.example", "tok", req, fakeCurl(0, "", 7).curl)).toThrow(LedgerUnavailable);
    expect(() => reserve("https://ledger.example", "tok", req, fakeCurl(503, "down").curl)).toThrow(LedgerUnavailable);
    expect(() => reserve("https://ledger.example", "tok", req, fakeCurl(200, "<html>").curl)).toThrow(LedgerUnavailable);
  });
});

describe("settle", () => {
  test("returns the receipt and the signature", () => {
    const { curl, calls } = fakeCurl(200, JSON.stringify({ receipt, signature: "c2ln" }));
    expect(settle("https://ledger.example/", "tok", "r1", 1.25, curl)).toEqual({ receipt, signature: "c2ln" });
    expect(urlOf(calls[0]!)).toBe("https://ledger.example/v1/settle");
    expect(JSON.parse(bodyOf(calls[0]!))).toEqual({ reservation_id: "r1", spent_usd: 1.25 });
  });

  test("a 404 is LedgerUnavailable", () => {
    expect(() => settle("https://ledger.example", "tok", "r1", 1, fakeCurl(404, "{}").curl)).toThrow(LedgerUnavailable);
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

// Produced by ledger/src/receipt.ts (signReceipt, receiptPublicKeyPem) with a throwaway key: the
// engine must verify what the ledger signs, byte for byte (ADR 0021 decision 6).
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
