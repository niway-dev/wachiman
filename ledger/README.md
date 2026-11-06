# Wachiman ledger

A Cloudflare Worker that keeps the daily spend ceiling for every repository Wachiman runs in. The engine reserves budget before a run and settles the real cost after it (ADR 0020, ADR 0021).

It is a separate package: the root `bun test` ignores it (`bunfig.toml`), and it has its own `bun.lock`.

## What it stores

One SQLite-backed Durable Object per account holds that account's entries for the last 90 days: repository, run id, attempt, trigger, reserved and settled USD, timestamps. No prompts, code, diffs or tokens are stored. GitHub OIDC tokens are verified and discarded.

## Secrets

Set with `wrangler secret put <NAME>` and never committed:

- `ACCOUNTS_JSON`: the account table (accounts, limits, linked repositories).
- `RECEIPT_PRIVATE_KEY_JWK`: Ed25519 private key (JWK) that signs receipts.
- `RECEIPT_PUBLIC_KEY_PEM`: the matching public key, served at `/v1/public-key`.

## Develop

```sh
bun install
bun run test      # vitest in workerd via @cloudflare/vitest-pool-workers
bun run deploy    # wrangler deploy (CI does this from release-ledger.yml)
```
