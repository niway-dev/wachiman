/** Test-only RS256 token minter: builds a key pair and signs GitHub-shaped OIDC tokens. */

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey;
}

export function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generateTestKey(kid = "test-key"): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey & { kid?: string };
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { kid, privateKey: pair.privateKey, jwk };
}

/** Mints a token; `claims` override the defaults, `header` overrides the JOSE header. */
export async function mintToken(
  key: TestKey,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  now = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000);
  const head = { alg: "RS256", typ: "JWT", kid: key.kid, ...header };
  const payload = {
    iss: "https://token.actions.githubusercontent.com",
    aud: "https://ledger.example.com",
    iat,
    nbf: iat - 5,
    exp: iat + 300,
    repository_id: "1001",
    repository: "acme/app",
    repository_owner: "acme",
    run_id: "42",
    run_attempt: "1",
    event_name: "pull_request",
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(head))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}
