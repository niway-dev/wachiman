import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/** A throwaway receipt key pair per test run; nothing secret is committed. */
const receiptKeys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
const privateJwk = await crypto.subtle.exportKey("jwk", receiptKeys.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", receiptKeys.publicKey);

/**
 * The test account table. Each scenario has its own account, because Durable Object storage
 * persists across tests in a file: reserve (2001), refusal (2002), settle (2003), forced (2004),
 * today with tags (3001 web+core, 3002 core). Repository 9999 is deliberately unlinked.
 */
const accounts = [
  { account_id: "acct-reserve", name: "Reserve", limit_usd: 6, repositories: [{ repository_id: "2001", repository: "acme/reserve" }] },
  { account_id: "acct-refuse", name: "Refuse", limit_usd: 1, repositories: [{ repository_id: "2002", repository: "acme/refuse" }] },
  { account_id: "acct-settle", name: "Settle", limit_usd: 6, repositories: [{ repository_id: "2003", repository: "acme/settle" }] },
  { account_id: "acct-forced", name: "Forced", limit_usd: 1, repositories: [{ repository_id: "2004", repository: "acme/forced" }] },
  {
    account_id: "acct-today",
    name: "Today",
    limit_usd: 6,
    repositories: [
      { repository_id: "3001", repository: "acme/web", tags: ["web", "core"] },
      { repository_id: "3002", repository: "acme/api", tags: ["core"] },
    ],
  },
];

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          LEDGER_AUDIENCE: "https://ledger.example.com",
          JWKS_URL: "https://jwks.test/keys",
          ACCOUNTS_JSON: JSON.stringify(accounts),
          RECEIPT_PRIVATE_KEY_JWK: JSON.stringify(privateJwk),
          RECEIPT_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
        },
      },
    }),
  ],
  // `*.vitest.ts`, not `*.test.ts`: the root `bun test` discovers `*.test.ts` everywhere, and these
  // need the Workers runtime.
  test: { include: ["test/**/*.vitest.ts"] },
});
