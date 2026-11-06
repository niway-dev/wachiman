/**
 * Signed receipts (ADR 0021, ADR 0022): Ed25519 over canonical JSON. The engine verifies the same
 * bytes with a PEM SPKI public key, so the key order below is part of the contract.
 */

export interface Receipt {
  account: string;
  repository: string;
  run_id: string;
  usd: number;
  day: string;
}

/** The signed bytes: JSON with keys in exactly this order, whatever order the caller built the object in. */
export function canonicalReceipt(r: Receipt): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ account: r.account, repository: r.repository, run_id: r.run_id, usd: r.usd, day: r.day }),
  );
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/**
 * Drops the JWK `alg` before import: workerd names Ed25519 keys "Ed25519" and Node names them
 * "EdDSA", and WebCrypto rejects the one it does not expect. The algorithm is passed explicitly.
 */
function withoutAlg(jwk: JsonWebKey): JsonWebKey {
  const { alg: _alg, ...rest } = jwk;
  return rest;
}

/** Base64url Ed25519 signature of the canonical receipt. */
export async function signReceipt(r: Receipt, privateKeyJwk: JsonWebKey): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", withoutAlg(privateKeyJwk), "Ed25519", false, ["sign"]);
  return toBase64Url(await crypto.subtle.sign("Ed25519", key, canonicalReceipt(r)));
}

export async function verifyReceipt(r: Receipt, signature: string, publicKeyJwk: JsonWebKey): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", withoutAlg(publicKeyJwk), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromBase64Url(signature), canonicalReceipt(r));
  } catch {
    return false;
  }
}

/** The SPKI PEM of a public JWK: the form the engine imports with `node:crypto`. */
export async function receiptPublicKeyPem(publicKeyJwk: JsonWebKey): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", withoutAlg(publicKeyJwk), "Ed25519", true, ["verify"]);
  const der = new Uint8Array((await crypto.subtle.exportKey("spki", key)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const lines = btoa(bin).match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}
