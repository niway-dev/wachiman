import { describe, expect, it } from "vitest";
import { canonicalReceipt, receiptPublicKeyPem, signReceipt, verifyReceipt, type Receipt } from "../src/receipt";

const receipt: Receipt = { account: "acme", repository: "acme/app", run_id: "42", usd: 1.25, day: "2026-11-06" };

async function pair() {
  const p = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privateJwk: (await crypto.subtle.exportKey("jwk", p.privateKey)) as JsonWebKey,
    publicJwk: (await crypto.subtle.exportKey("jwk", p.publicKey)) as JsonWebKey,
  };
}

describe("receipts", () => {
  it("signs and verifies a round trip", async () => {
    const k = await pair();
    const sig = await signReceipt(receipt, k.privateJwk);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await verifyReceipt(receipt, sig, k.publicJwk)).toBe(true);
  });

  it("a changed usd fails", async () => {
    const k = await pair();
    const sig = await signReceipt(receipt, k.privateJwk);
    expect(await verifyReceipt({ ...receipt, usd: 0.01 }, sig, k.publicJwk)).toBe(false);
  });

  it("canonicalReceipt fixes the key order", () => {
    const shuffled = { day: "2026-11-06", usd: 1.25, run_id: "42", repository: "acme/app", account: "acme" };
    expect(new TextDecoder().decode(canonicalReceipt(shuffled))).toBe(
      '{"account":"acme","repository":"acme/app","run_id":"42","usd":1.25,"day":"2026-11-06"}',
    );
  });

  it("the exported PEM is an SPKI key that verifies a signature from the private JWK", async () => {
    const k = await pair();
    const pem = await receiptPublicKeyPem(k.publicJwk);
    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n$/);
    const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, "")), (c) => c.charCodeAt(0));
    const imported = await crypto.subtle.importKey("spki", der, "Ed25519", false, ["verify"]);
    const sig = await signReceipt(receipt, k.privateJwk);
    const raw = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify("Ed25519", imported, raw, canonicalReceipt(receipt))).toBe(true);
  });
});
