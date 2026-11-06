/** GitHub Actions OIDC verification with WebCrypto only: RS256, no library. */

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const DISCOVERY_URL = `${GITHUB_ISSUER}/.well-known/openid-configuration`;
const JWKS_TTL_MS = 3_600_000;
/** An unknown kid refetches the keys at most this often, so a stream of bad kids cannot hammer GitHub. */
const JWKS_REFRESH_MIN_MS = 60_000;

export interface GithubClaims {
  repository_id: string;
  repository: string;
  repository_owner: string;
  run_id: string;
  run_attempt: string;
  job_workflow_ref?: string;
  event_name?: string;
}

/** `refresh: true` asks the source to bypass any cache. */
export type JwksFetch = (opts?: { refresh: boolean }) => Promise<{ keys: JsonWebKey[] }>;

/** Thrown when a token fails a check; the message names the check. */
export class TokenInvalid extends Error {}

let cached: { at: number; jwks: { keys: JsonWebKey[] } } | null = null;
/** When verification last refetched the keys for an unknown kid. */
let lastRefreshAt = Number.NEGATIVE_INFINITY;

/** Production JWKS source: the discovery document's `jwks_uri`, cached in module scope for one hour unless `refresh`. */
export const fetchGithubJwks: JwksFetch = async (opts) => {
  if (!opts?.refresh && cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.jwks;
  const discovery = await fetch(DISCOVERY_URL);
  if (!discovery.ok) throw new Error(`OIDC discovery failed: ${discovery.status}`);
  const { jwks_uri } = (await discovery.json()) as { jwks_uri: string };
  const res = await fetch(jwks_uri);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const jwks = (await res.json()) as { keys: JsonWebKey[] };
  cached = { at: Date.now(), jwks };
  return jwks;
};

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function parsePart(part: string, what: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
    if (value === null || typeof value !== "object") throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new TokenInvalid(`malformed ${what}`);
  }
}

/**
 * Verifies a GitHub OIDC token and returns its claims. Checks, in order: shape, alg (RS256 only),
 * kid, signature, iss, aud, nbf and exp. `now` is in milliseconds.
 */
export async function verifyGithubToken(
  token: string,
  audience: string,
  jwks: JwksFetch,
  now = Date.now(),
): Promise<GithubClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenInvalid("malformed token: expected three parts");
  const [h, p, s] = parts as [string, string, string];
  const header = parsePart(h, "header");
  if (header.alg !== "RS256") throw new TokenInvalid(`alg must be RS256, got ${String(header.alg)}`);
  const findKey = (set: { keys: JsonWebKey[] }) => set.keys.find((k) => (k as { kid?: string }).kid === header.kid);
  let jwk = findKey(await jwks());
  if (!jwk && now - lastRefreshAt >= JWKS_REFRESH_MIN_MS) {
    // GitHub may have rotated its keys since the cached set was fetched: look once more, at most once a minute.
    lastRefreshAt = now;
    jwk = findKey(await jwks({ refresh: true }));
  }
  if (!jwk) throw new TokenInvalid(`unknown kid ${String(header.kid)}`);

  let valid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64Url(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    valid = false;
  }
  if (!valid) throw new TokenInvalid("bad signature");

  const claims = parsePart(p, "payload");
  if (claims.iss !== GITHUB_ISSUER) throw new TokenInvalid("iss mismatch");
  const aud = claims.aud;
  if (!(aud === audience || (Array.isArray(aud) && aud.includes(audience)))) throw new TokenInvalid("aud mismatch");
  const seconds = now / 1000;
  if (typeof claims.nbf !== "number" || claims.nbf > seconds) throw new TokenInvalid("nbf: token not valid yet");
  if (typeof claims.exp !== "number" || claims.exp <= seconds) throw new TokenInvalid("exp: token expired");
  return claims as unknown as GithubClaims;
}
