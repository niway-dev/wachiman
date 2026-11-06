import { beforeAll, describe, expect, it } from "vitest";
import { TokenInvalid, verifyGithubToken } from "../src/oidc";
import { b64url, generateTestKey, mintToken, type TestKey } from "./support/mint";

const AUD = "https://ledger.example.com";
let key: TestKey;
let other: TestKey;
const jwks = async () => ({ keys: [key.jwk] });

beforeAll(async () => {
  key = await generateTestKey("k1");
  other = await generateTestKey("k2");
});

describe("verifyGithubToken", () => {
  it("returns the claims of a good token", async () => {
    const claims = await verifyGithubToken(await mintToken(key), AUD, jwks);
    expect(claims.repository_id).toBe("1001");
    expect(claims.repository).toBe("acme/app");
    expect(claims.run_id).toBe("42");
    expect(claims.run_attempt).toBe("1");
  });

  it("accepts an audience array that contains the audience", async () => {
    const token = await mintToken(key, { aud: ["other", AUD] });
    await expect(verifyGithubToken(token, AUD, jwks)).resolves.toBeTruthy();
  });

  it("rejects a wrong aud", async () => {
    const token = await mintToken(key, { aud: "https://evil.example.com" });
    await expect(verifyGithubToken(token, AUD, jwks)).rejects.toThrow(/aud/);
  });

  it("rejects a wrong iss", async () => {
    const token = await mintToken(key, { iss: "https://evil.example.com" });
    await expect(verifyGithubToken(token, AUD, jwks)).rejects.toThrow(/iss/);
  });

  it("rejects an expired token", async () => {
    const token = await mintToken(key, {}, {}, Date.now() - 3600_000);
    await expect(verifyGithubToken(token, AUD, jwks)).rejects.toThrow(/exp/);
  });

  it("rejects a token that is not valid yet", async () => {
    const token = await mintToken(key, { nbf: Math.floor(Date.now() / 1000) + 600 });
    await expect(verifyGithubToken(token, AUD, jwks)).rejects.toThrow(/nbf/);
  });

  it("rejects an unknown kid", async () => {
    const token = await mintToken(key, {}, { kid: "nope" });
    await expect(verifyGithubToken(token, AUD, jwks)).rejects.toThrow(/kid/);
  });

  it("refetches once on an unknown kid, then not again within 60 s", async () => {
    const rotated = await generateTestKey("k3");
    const base = Date.now() + 2 * 3600_000;
    let calls = 0;
    let refreshes = 0;
    const rotating = async (opts?: { refresh: boolean }) => {
      calls += 1;
      if (opts?.refresh) {
        refreshes += 1;
        return { keys: [key.jwk, rotated.jwk] };
      }
      return { keys: [key.jwk] };
    };

    const claims = await verifyGithubToken(await mintToken(rotated, {}, {}, base), AUD, rotating, base);
    expect(claims.repository_id).toBe("1001");
    expect(refreshes).toBe(1);

    const unknown = await mintToken(key, {}, { kid: "nope" }, base + 10_000);
    await expect(verifyGithubToken(unknown, AUD, rotating, base + 10_000)).rejects.toThrow(/kid/);
    expect(refreshes).toBe(1);
    expect(calls).toBe(3);
  });

  it("rejects a signature from another key under the same kid", async () => {
    const token = await mintToken(other, {}, { kid: "k1" });
    await expect(verifyGithubToken(token, AUD, jwks)).rejects.toThrow(/signature/);
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = (await mintToken(key)).split(".");
    const forged = b64url(JSON.stringify({ iss: "https://token.actions.githubusercontent.com", aud: AUD, exp: 9e9, repository_id: "9999" }));
    await expect(verifyGithubToken(`${h}.${forged}.${s}`, AUD, jwks)).rejects.toThrow(/signature/);
  });

  it("rejects non-RS256 algorithms", async () => {
    const token = await mintToken(key, {}, { alg: "none" });
    await expect(verifyGithubToken(token, AUD, jwks)).rejects.toThrow(/alg/);
  });

  it("rejects a malformed token with TokenInvalid", async () => {
    await expect(verifyGithubToken("not-a-jwt", AUD, jwks)).rejects.toBeInstanceOf(TokenInvalid);
  });
});
