# Wachiman ledger

A Cloudflare Worker that keeps the daily spend ceiling for every repository Wachiman runs in. The engine reserves budget before a run and settles the real cost after it (ADR 0021, ADR 0022).

It is a separate package: the root `bun test` ignores it (`bunfig.toml`), and it has its own `bun.lock`.

## What it stores

One SQLite-backed Durable Object per account holds that account's entries for the last 90 days: repository, run id, attempt, trigger, reserved and settled USD, timestamps. No prompts, code, diffs or tokens are stored. GitHub OIDC tokens are verified and discarded.

## Secrets

Set with `wrangler secret put <NAME>` and never committed:

- `ACCOUNTS_JSON`: the account table (accounts, limits, linked repositories).
- `RECEIPT_PRIVATE_KEY_JWK`: Ed25519 private key (JWK) that signs receipts.
- `RECEIPT_PUBLIC_KEY_JWK`: the matching public key as a JWK JSON string. It is a JWK, not a PEM: the Worker derives the SPKI PEM at runtime and serves both at `/v1/public-key`.

Plain variable (in `wrangler.jsonc`, not secret): `LEDGER_AUDIENCE`, the OIDC audience callers must request (their `ledger_url`). It is compared exactly; while it is empty every request answers 401.

## Routes

`POST /v1/reserve`, `POST /v1/settle`, `GET /v1/today` take a GitHub OIDC bearer token. `GET /v1/public-key` takes none and returns `{alg: "Ed25519", jwk, pem}`. `forced` on a reserve counts only when the token's `event_name` is `issue_comment`.

## Develop

```sh
bun install
bun run test      # vitest in workerd via @cloudflare/vitest-pool-workers
bun run deploy    # wrangler deploy (CI does this from release-ledger.yml)
```
