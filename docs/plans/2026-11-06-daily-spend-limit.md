# Daily Spend Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One daily ceiling in USD across every repository Wachiman runs in, kept by a small ledger service the engine reserves from before each run and settles after it, with a visible failure when the day is spent.

**Architecture:** The engine (`src/`) gains a synchronous ledger client that requests a GitHub OIDC token and calls the ledger with `curl` through `spawnSync`, the same way it already calls `gh` (the engine is synchronous end to end; nothing becomes `async`). The ledger (`ledger/`) is a Cloudflare Worker that verifies the token with WebCrypto, finds the account a repository is linked to, and forwards to that account's SQLite-backed Durable Object, which reserves and settles atomically and signs receipts with Ed25519. Both halves are tested in isolation: the engine against a fake `curl`, the Worker in `@cloudflare/vitest-pool-workers`.

**Tech Stack:** Bun + TypeScript, zero runtime dependencies in `src/` (ADR 0002; `curl` and `gh` are binaries the runner has). `ledger/` is its own package with `wrangler` and `@cloudflare/vitest-pool-workers` as dev dependencies and no runtime dependency (WebCrypto only).

**Spec:** `docs/specs/2026-11-06-daily-spend-limit-design.md` (ADR 0021, ADR 0022; issue #122).

**Workers (global `CLAUDE.md` roster):** implementer and reviewer on Sonnet medium; Task 9 (the Durable Object and its concurrency test) and the final whole-branch review on Opus 5. Name the model in the dispatch message.

## Global Constraints

- Everything durable in English: code, comments, test names, docs, commits.
- `src/` keeps zero dependencies; `ledger/` adds dev dependencies only.
- The engine stays synchronous: no `async` in `review`, `threadReplies`, `answer`, `main`.
- The agent's child process never sees `ACTIONS_ID_TOKEN_REQUEST_URL` or `ACTIONS_ID_TOKEN_REQUEST_TOKEN` (`CHILD_ENV_ALLOWLIST` already excludes them; Task 5 pins it).
- Exit code **3** = the daily limit refused the run, or the ledger was required and unavailable. Codes 0, 1, 2 keep their meaning (`docs/cli.md`).
- Default input values, verbatim from the spec: `daily_limit_mode: fail`, `daily_limit_bypass: false`, `ledger_url` and `daily_budget_usd` unset.
- The day is UTC and decided by the ledger's clock, never by the run.
- Footer line: `<!-- wachi:receipt <base64url json>.<base64url signature> -->`, immediately before the cost line. Notice dedupe footer: `<!-- wachi:nocredits day=YYYY-MM-DD -->`.
- OIDC: issuer `https://token.actions.githubusercontent.com`, audience = `ledger_url` exactly as configured, discovery at `https://token.actions.githubusercontent.com/.well-known/openid-configuration`.
- Caller permission `id-token: write` ships as a **major** release (`feat!:` commit on the workflow change) with an `upgrading.md` note.

## Review Focus

1. A `settle` that never arrives (job cancelled or killed by `timeout-minutes`): the reservation must stay counted for the day; a `settle` from `run_attempt` 2 of the same `run_id` replaces it. Test in Task 9.
2. `ledger_url` set with a trailing slash or without a scheme: the audience must equal the configured string and the request URL must not get a double slash. Test in Task 2.
3. A `402` whose body is not the documented JSON (a proxy page, an empty body): the engine must still exit 3 with a message, not throw a JSON parse error. Test in Task 2.
4. The day boundary between `reserve` and `settle`: the settle lands on the reservation's day, not on the new day. Test in Task 9.
5. `/wachi review --force` by a non-operator, and `--force` in an automatic trigger: never forced. Test in Task 3.

---

### Task 1: Configuration for the daily limit

**Files:**
- Modify: `src/config.ts` (the `EngineConfig` interface and `loadConfig`)
- Test: `src/config.test.ts`

**Interfaces:**
- Produces, on `EngineConfig`:
  - `ledgerUrl?: string` (`AGENT_REVIEW_LEDGER_URL`, trimmed, trailing `/` removed; unset or empty → `undefined`)
  - `dailyBudgetUsd?: number` (`AGENT_REVIEW_DAILY_BUDGET_USD`, positive number, same validation as the other budgets)
  - `dailyLimitMode: "fail" | "notice"` (`AGENT_REVIEW_DAILY_LIMIT_MODE`, default `"fail"`, anything else is a `UsageError`)
  - `dailyLimitBypass: boolean` (`AGENT_REVIEW_DAILY_LIMIT_BYPASS`, `"1"` or `"true"` → true, default false)
  - `export type DailyLimitMode = "fail" | "notice"`

- [ ] **Step 1: Write the failing tests** in `src/config.test.ts`

```ts
test("the daily limit settings: unset means no ledger, mode defaults to fail, bypass to false", () => {
  const c = loadConfig({ ...base });
  expect(c.ledgerUrl).toBeUndefined();
  expect(c.dailyBudgetUsd).toBeUndefined();
  expect(c.dailyLimitMode).toBe("fail");
  expect(c.dailyLimitBypass).toBe(false);
});
test("ledger url loses a trailing slash; mode and bypass are read; a bad mode is a usage error", () => {
  const c = loadConfig({ ...base, AGENT_REVIEW_LEDGER_URL: "https://ledger.example/", AGENT_REVIEW_DAILY_LIMIT_MODE: "notice", AGENT_REVIEW_DAILY_LIMIT_BYPASS: "true", AGENT_REVIEW_DAILY_BUDGET_USD: "2.5" });
  expect(c.ledgerUrl).toBe("https://ledger.example");
  expect(c.dailyLimitMode).toBe("notice");
  expect(c.dailyLimitBypass).toBe(true);
  expect(c.dailyBudgetUsd).toBe(2.5);
  expect(() => loadConfig({ ...base, AGENT_REVIEW_DAILY_LIMIT_MODE: "warn" })).toThrow(/DAILY_LIMIT_MODE must be fail or notice/);
});
```

- [ ] **Step 2: Run** `bun test src/config.test.ts` — expected: FAIL (properties undefined / no throw).
- [ ] **Step 3: Implement** the four fields in `loadConfig`, next to `autoBudgetUsd`, with doc comments in the style of the neighbours (ADR 0021 reference).
- [ ] **Step 4: Run** `bun test src/config.test.ts` — expected: PASS.
- [ ] **Step 5: Commit** `feat(config): daily limit settings (ADR 0021)`.

### Task 2: The ledger client (`src/ledger.ts`)

**Files:**
- Create: `src/ledger.ts`
- Test: `src/ledger.test.ts`

**Interfaces:**
- Consumes: `EngineConfig` from Task 1.
- Produces:

```ts
export type CurlFn = (args: string[]) => { status: number; stdout: string; stderr: string };
export const defaultCurl: CurlFn;                 // spawnSync("curl", args) with --silent --show-error --max-time 20
export interface LedgerEnv { ACTIONS_ID_TOKEN_REQUEST_URL?: string; ACTIONS_ID_TOKEN_REQUEST_TOKEN?: string }
export class LedgerUnavailable extends Error {}   // no id-token permission, network error, 5xx, unparsable body
export interface Refusal { reason: "limit" | "repository_limit" | "not_linked" | "unauthorized"; accountSpentUsd?: number; accountLimitUsd?: number; day?: string; resetsAt?: string }
export class LedgerRefused extends Error { constructor(readonly refusal: Refusal) }
export interface Reservation { reservationId: string; grantedUsd: number; accountLeftUsd: number; repositoryLeftUsd: number | null; day: string }
export interface Receipt { account: string; repository: string; run_id: string; usd: number; day: string }
export interface ReserveRequest { wantedUsd: number; callerLimitUsd?: number; trigger: string; forced: boolean }
export function requestIdToken(env: LedgerEnv, audience: string, curl: CurlFn): string;   // GET `${URL}&audience=${encodeURIComponent(audience)}` with bearer TOKEN; `.value` of the JSON; LedgerUnavailable("id-token: write is not granted") when either variable is unset
export function reserve(ledgerUrl: string, token: string, req: ReserveRequest, curl: CurlFn): Reservation;  // POST `${ledgerUrl}/v1/reserve`; 200 → Reservation; 402/401/403 → throws LedgerRefused; else LedgerUnavailable
export function settle(ledgerUrl: string, token: string, reservationId: string, spentUsd: number, curl: CurlFn): { receipt: Receipt; signature: string };  // POST /v1/settle; non-200 → LedgerUnavailable
export const receiptFooter = (receipt: Receipt, signature: string) => `<!-- wachi:receipt ${b64url(JSON.stringify(receipt))}.${signature} -->`;
export function readReceipt(body: string): { receipt: Receipt; signature: string } | null;   // the last receipt line in the body
export function verifyReceipt(receipt: Receipt, signature: string, publicKeyPem: string): boolean;  // node:crypto `verify(null, canonicalBytes, key, sig)`, Ed25519, synchronous
export function canonicalReceipt(receipt: Receipt): Uint8Array;  // JSON with keys in the order account, repository, run_id, usd, day; shared contract with Task 10
```

- [ ] **Step 1: Write the failing tests** in `src/ledger.test.ts` with a scripted `CurlFn` that records args and returns canned bodies:
  - `requestIdToken` sends the bearer and the audience, returns `.value`; throws `LedgerUnavailable` naming `id-token: write` when the variables are unset.
  - `reserve` posts the JSON body to `https://ledger.example/v1/reserve` (one slash) with `Authorization: Bearer <token>`; a 200 body maps to `Reservation`; a 402 `{reason:"limit",account_spent_usd:6.12,account_limit_usd:6,day:"2026-11-06",resets_at:"2026-11-07T00:00:00Z"}` throws `LedgerRefused` with those fields camel-cased; a 402 with body `<html>` throws `LedgerRefused` with `reason: "limit"` and no amounts; a curl status `7` (connection failed) and a 503 throw `LedgerUnavailable`.
  - `settle` returns `{receipt, signature}`; a 404 throws `LedgerUnavailable`.
  - `receiptFooter` → `readReceipt` round-trips; `readReceipt` on a body with no line returns null.
  - `verifyReceipt`: generate an Ed25519 pair with `node:crypto generateKeyPairSync("ed25519")`, sign `canonicalReceipt`, expect true; flip `usd` and expect false.
- [ ] **Step 2: Run** `bun test src/ledger.test.ts` — expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/ledger.ts`. `curl` args: `["-sS", "--max-time", "20", "-o", "-", "-w", "\n%{http_code}", "-X", "POST", "-H", "Authorization: Bearer …", "-H", "Content-Type: application/json", "--data", json, url]`; split the last line off `stdout` as the status. The module imports only `node:child_process` and `node:crypto`.
- [ ] **Step 4: Run** `bun test src/ledger.test.ts` — expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): a synchronous client for the ledger service (ADR 0021)`.

### Task 3: Reserve before, settle after, in `review`, `threadReplies` and `answer`

**Files:**
- Modify: `src/engine.ts` (`Deps`, `review` around the `ceilingRoom` call at ~2461, `threadReplies` ~2693, `answer` ~3162, `comment` ~3210, `parseCommand` ~221, `buildReview` footer at ~900)
- Test: `src/daily.fake.test.ts` (new; copy the `FakeProvider` and `Deps` scaffolding of `src/ceiling.fake.test.ts`)

**Interfaces:**
- Consumes: Task 2's functions and types; `isAutomatic`, `ceilingRoom`, `postReview`, `costLine`, `branded`, `SIGNATURE`.
- Produces:

```ts
// Deps gains:
curl?: CurlFn;                       // default defaultCurl; a fake in tests
ledgerEnv?: LedgerEnv;               // default process.env
// engine.ts:
export class DailyLimitReached extends Error { constructor(readonly refusal: Refusal, readonly mode: DailyLimitMode) }
export interface DailyGrant { reservationId: string | null; roomUsd: number }   // reservationId null = no ledger (unset or bypassed)
export function dailyReserve(deps: Deps, repo: string, pr: number, headSha: string, wantedUsd: number, forced: boolean): DailyGrant;
export function dailySettle(deps: Deps, grant: DailyGrant, spentUsd: number): string | null;   // the receipt footer line, or null
export const noCreditsFooter = (day: string) => `<!-- wachi:nocredits day=${day} -->`;
export function readNoCreditsDay(body: string): string | null;
// parseCommand: { kind: "review", paths: string[], force: boolean }; `--force` anywhere after `review` sets force and is removed from paths
```

Behaviour of `dailyReserve`: unset `ledgerUrl` or `dailyLimitBypass` → `{reservationId: null, roomUsd: Infinity}` and, when bypassed, `deps.log("ledger bypassed")`. Otherwise token → `reserve({wantedUsd, callerLimitUsd: config.dailyBudgetUsd, trigger: config.trigger ?? "cli", forced})`. On `LedgerRefused` with reason `limit` or `repository_limit`: post the "No credits today" review (copy from the spec's "The 'No credits today' comment" section, amounts and reset time from the refusal; `resetsAt` rendered as `HH:MM UTC (in Xh Ymin)`) unless a review by `github-actions[bot]` already carries `noCreditsFooter(day)` (read the bodies with the same `gh api --paginate repos/{repo}/pulls/{pr}/reviews` call `automaticSpend` uses), then throw `DailyLimitReached(refusal, config.dailyLimitMode)`. Any other `LedgerRefused` or `LedgerUnavailable` propagates unchanged.

Placement: in `review`, right after `ceilingRoom` returns a number: `const grant = dailyReserve(deps, repo, pr, headSha, Math.min(config.budgetUsd, room), forced)` and `totalBudget = Math.min(config.budgetUsd, room, grant.roomUsd)`; after `reviewChange`, `const receiptLine = dailySettle(deps, grant, spent)` and pass `receiptLine` into `buildReview` (new optional field `receiptLine?: string`, written immediately before the cost line) and into the `spentNotice` bodies. Same shape in `threadReplies` (`threadsBudgetUsd`, settle with `call.costUsd`) and `answer` (`answerBudgetUsd`, settle with `result.costUsd`, the line before the cost line of the answer body). `forced` is true only when `comment` parsed `--force` (so only the operator can reach it) and `config.trigger` is `comment` or unset.

- [ ] **Step 1: Write the failing tests** in `src/daily.fake.test.ts` (names are the assertions):
  - `"with no ledger_url nothing is reserved and the fake curl is never called"`
  - `"a run reserves before its first model call with min(budget, ceiling room) and settles with the real cost; the footer carries the receipt before the cost line"` (assert order of `curl` calls vs provider calls; `readReceipt(body)` not null; the receipt line index < cost line index; `readAutoCost(body)` unchanged).
  - `"$0.30 left runs with a $0.30 budget"` (the provider request's `budgetUsd`/cap is 0.30).
  - `"a 402 posts one No credits today review with the amounts and throws DailyLimitReached; a second run the same day posts nothing"` (two runs; the second sees the first's body in the fake `gh` and makes no `postReview`).
  - `"/wachi review --force by the operator reserves with forced: true; the same words from an automatic trigger reserve with forced: false; a non-operator's --force does nothing"`.
  - `"bypass makes no ledger call and logs ledger bypassed"`.
  - `"an unreachable ledger throws LedgerUnavailable before any model call"` (provider requests length 0).
  - `"a failed run (no batch output) still settles and its notice carries the receipt"`.
  - `"threadReplies and answer reserve and settle too"` (one test each, minimal).
- [ ] **Step 2: Run** `bun test src/daily.fake.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** in `src/engine.ts` as specified. Keep `ceilingRoom` untouched.
- [ ] **Step 4: Run** `bun test` — expected: all PASS, including `ceiling.fake.test.ts` and the golden prompts (record new goldens for `daily.fake` the way `ceiling.fake` does).
- [ ] **Step 5: Commit** `feat(engine): reserve from and settle with the daily ledger; No credits today notice; --force (ADR 0021)`.

### Task 4: Exit code 3 in the CLI

**Files:**
- Modify: `src/cli.ts` (`main`, the `catch` at ~133; `USAGE` text)
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: `DailyLimitReached` (Task 3), `LedgerUnavailable`, `LedgerRefused` (Task 2).
- Produces: exit code `3`.

Mapping in `main`'s `catch`: `DailyLimitReached` with `mode === "notice"` → log the message and return `0`; with `mode === "fail"` → `console.error("agent-review: daily limit reached: …")` and return `3`; `LedgerUnavailable` and `LedgerRefused` (`not_linked`, `unauthorized`) → `console.error("agent-review: ledger: …")`, return `3`.

- [ ] **Step 1: Write the failing tests** in `src/cli.test.ts`, following the pattern of `"a missing agent binary is an engine error, before anything is posted"` (spawn the CLI with a fake `gh` and a fake `curl` on `PATH` from `test/support`): `"the daily limit exits 3 in fail mode and 0 in notice mode"`, `"an unreachable ledger exits 3 before any model call"`, `"an unlinked repository exits 3 with 'repository not linked'"`.
- [ ] **Step 2: Run** `bun test src/cli.test.ts` — expected: FAIL.
- [ ] **Step 3: Implement** the mapping; add `3` to the usage text's exit-code line.
- [ ] **Step 4: Run** `bun test src/cli.test.ts` — expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): exit code 3 for the daily limit and a required ledger (ADR 0021)`.

### Task 5: The agent never gets the OIDC variables

**Files:**
- Test: `src/providers/claude-code.test.ts` (or the file that already tests `buildChildEnv`)

- [ ] **Step 1: Write the test** `"the OIDC request variables are not forwarded to the agent"`: `buildChildEnv({ PATH: "/bin", ACTIONS_ID_TOKEN_REQUEST_URL: "x", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "y" })` has neither key.
- [ ] **Step 2: Run** it — expected: PASS already (the allowlist excludes them). If it fails, fix `CHILD_ENV_ALLOWLIST`; never add them.
- [ ] **Step 3: Commit** `test(providers): pin that the agent never sees the OIDC request variables`.

### Task 6: Workflow inputs, caller templates, docs, major release

**Files:**
- Modify: `.github/workflows/review.yml` (inputs after `auto_budget_usd`; `env:` of the three engine steps at ~246, ~352, ~467; `permissions:` of the three jobs at ~152, ~288, ~381 gain `id-token: write`)
- Modify: `templates/agent-review-caller.yml`, `templates/caller-workflow.yml` (`permissions:` line gains `id-token: write`; a commented `ledger_url:` example)
- Modify: `docs/configuration.md` (inputs table, engine settings, permissions), `docs/costs.md` (new section "The daily limit across repositories" after "The ceiling per pull request"), `docs/cli.md` and `docs/troubleshooting.md` (exit code 3, "No credits today"), `docs/upgrading.md` (the major release: add `id-token: write`), `docs/install.md` step 1 permissions line, `docs/architecture.md` ("Configuration" and "Invariants": the ledger sees repository identity and dollars only)
- Test: `test/daily-limit.test.ts` (textual checks like `test/review-on-push.test.ts`)

Inputs (verbatim):

```yaml
      ledger_url:
        description: >-
          Base URL of the ledger that keeps the daily spend limit across repositories (ADR 0021).
          Unset: no daily limit. Set: the caller must grant `id-token: write`, and a run that
          cannot reach the ledger does not start.
        type: string
        default: ""
      daily_budget_usd:
        description: A stricter daily number for this repository, in USD; it never raises the account's limit
        type: number
        default: 0
      daily_limit_mode:
        description: At the daily limit, `fail` ends the run with exit code 3 (red job); `notice` posts the comment and passes
        type: string
        default: fail
      daily_limit_bypass:
        description: Skip the ledger for this repository, at its own risk; the footer says so
        type: boolean
        default: false
```

`env:` lines: `AGENT_REVIEW_LEDGER_URL: ${{ inputs.ledger_url }}`, `AGENT_REVIEW_DAILY_BUDGET_USD: ${{ inputs.daily_budget_usd != 0 && inputs.daily_budget_usd || '' }}`, `AGENT_REVIEW_DAILY_LIMIT_MODE: ${{ inputs.daily_limit_mode }}`, `AGENT_REVIEW_DAILY_LIMIT_BYPASS: ${{ inputs.daily_limit_bypass }}`.

- [ ] **Step 1: Write the failing tests** in `test/daily-limit.test.ts`: the four inputs exist with those defaults; the three jobs' `permissions:` blocks contain `id-token: write`; both templates' `permissions` contain `id-token: write`; the three engine steps export the four `AGENT_REVIEW_*` variables.
- [ ] **Step 2: Run** `bun test test/daily-limit.test.ts` — expected: FAIL.
- [ ] **Step 3: Edit** the workflow, templates and docs. In `docs/costs.md` state plainly: the limit is soft by one call's overshoot; cancelled runs are over-counted; the ledger sees repository identity, run identity and dollars only.
- [ ] **Step 4: Run** `bun test` and `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color` — expected: PASS, no lint error.
- [ ] **Step 5: Commit** with a breaking marker so release-please cuts a major: `feat(workflow)!: daily limit inputs; callers must grant id-token: write (ADR 0021)` with a `BREAKING CHANGE:` footer line naming the permission.

### Task 7: The `ledger/` package and OIDC verification

**Files:**
- Create: `ledger/package.json` (`name: "@wachiman/ledger"`, `private: true`, scripts `test: vitest run`, `deploy: wrangler deploy`; devDependencies `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `typescript`), `ledger/wrangler.jsonc` (name `wachiman-ledger`, `compatibility_date` = today, `durable_objects.bindings: [{name: "ACCOUNTS", class_name: "LedgerAccount"}]`, `migrations: [{tag: "v1", new_sqlite_classes: ["LedgerAccount"]}]`, `observability.enabled: false`, no secrets), `ledger/tsconfig.json`, `ledger/vitest.config.ts`, `ledger/README.md` (what it stores, the three secrets: `ACCOUNTS_JSON`, `RECEIPT_PRIVATE_KEY_JWK`, `RECEIPT_PUBLIC_KEY_JWK`)
- Create: `ledger/src/oidc.ts`
- Test: `ledger/test/oidc.test.ts`

**Interfaces:**

```ts
export interface GithubClaims { repository_id: string; repository: string; repository_owner: string; run_id: string; run_attempt: string; job_workflow_ref?: string; event_name?: string }
export type JwksFetch = () => Promise<{ keys: JsonWebKey[] }>;   // production: GET jwks_uri from the discovery document, cached in module scope for 1 h
export class TokenInvalid extends Error {}
export async function verifyGithubToken(token: string, audience: string, jwks: JwksFetch, now = Date.now()): Promise<GithubClaims>;
// RS256 only; header.kid selects the JWK; iss must equal "https://token.actions.githubusercontent.com"; aud must equal audience (string or array containing it); nbf <= now < exp; otherwise TokenInvalid with the failed check in the message
```

- [ ] **Step 1: Write the failing tests**: generate an RSA pair in the test, mint tokens with a tiny signer in `ledger/test/support/mint.ts` (header+payload base64url, `crypto.subtle.sign("RSASSA-PKCS1-v1_5")`), and assert: a good token returns the claims; wrong `aud`, wrong `iss`, expired, unknown `kid`, tampered payload each throw `TokenInvalid` naming the check.
- [ ] **Step 2: Run** `cd ledger && bun install && bun run test` — expected: FAIL.
- [ ] **Step 3: Implement** `oidc.ts` with `crypto.subtle.importKey("jwk", …, {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["verify"])`.
- [ ] **Step 4: Run** the tests — expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): package scaffold and GitHub OIDC verification (ADR 0021)`.

### Task 8: The account table

**Files:**
- Create: `ledger/src/accounts.ts`
- Test: `ledger/test/accounts.test.ts`

**Interfaces:**

```ts
export interface LinkedRepository { repository_id: string; repository: string; limit_usd?: number; tags?: string[] }
export interface Account { account_id: string; name: string; organization_id?: string; limit_usd: number; repositories: LinkedRepository[] }
export function parseAccounts(json: string): Account[];        // throws on a duplicate repository_id across accounts or a non-positive limit
export function findAccount(accounts: Account[], repositoryId: string): { account: Account; repository: LinkedRepository } | null;
```

- [ ] **Step 1: Write the failing tests**: a two-account table resolves each repository; an unknown id returns null; a duplicate id throws naming it; `limit_usd: 0` throws.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ledger): the account table (ADR 0022)`.

### Task 9: The account Durable Object: reserve, settle, today

**Files:**
- Create: `ledger/src/account-object.ts`
- Test: `ledger/test/account-object.test.ts` (runs inside `vitest-pool-workers` with `env.ACCOUNTS.get(id)`)

**Interfaces:**

```ts
export interface ReserveInput { repository_id: string; repository: string; run_id: string; run_attempt: string; trigger: string; forced: boolean; wanted_usd: number; caller_limit_usd?: number; account_limit_usd: number; repository_limit_usd?: number; now?: number }
export type ReserveOutput =
  | { ok: true; reservation_id: string; granted_usd: number; account_left_usd: number; repository_left_usd: number | null; day: string }
  | { ok: false; reason: "limit" | "repository_limit"; account_spent_usd: number; account_limit_usd: number; day: string; resets_at: string };
export interface SettleInput { reservation_id: string; spent_usd: number; now?: number }
export type SettleOutput = { ok: true; entry: Entry } | { ok: false; status: 404 };
export interface Entry { id: string; day: string; repository_id: string; repository: string; run_id: string; run_attempt: string; trigger: string; forced: boolean; reserved_usd: number; settled_usd: number | null; created_at: string; settled_at: string | null }
export interface TodayOutput { day: string; limit_usd: number; spent_usd: number; by_repository: { repository: string; usd: number }[] }
export class LedgerAccount extends DurableObject { reserve(i: ReserveInput): ReserveOutput; settle(i: SettleInput): SettleOutput; today(limitUsd: number, now?: number): TodayOutput }
```

Rules (from the spec): `day = new Date(now).toISOString().slice(0, 10)`; `spent = SUM(COALESCE(settled_usd, reserved_usd)) WHERE day = ?`; `repoSpent` the same for the repository; `accountLeft = account_limit_usd - spent`; `repoLeft = repository_limit_usd ? repository_limit_usd - repoSpent : null`; `callerLeft = caller_limit_usd ? caller_limit_usd - repoSpent : null`. Not forced and `accountLeft <= 0` → `limit`; not forced and `repoLeft !== null && repoLeft <= 0` → `repository_limit`. `granted = forced ? wanted : min(wanted, accountLeft, repoLeft ?? ∞, callerLeft ?? ∞)`. A new reservation for the same `run_id` with a higher `run_attempt` replaces the earlier entry's `reserved_usd` (the retry re-reserves) rather than adding. Settle sets `settled_usd`, `settled_at`; it is idempotent; the row's `day` never changes. On each reserve, delete entries older than 90 days. Schema created in the constructor with `this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS entries (…)")`.

- [ ] **Step 1: Write the failing tests** (one object id per test):
  - `"grants min(wanted, account left)"`: limit 6, two reservations of 4 → second granted 2.
  - `"$0.30 left grants $0.30; $0 left refuses with limit and resets_at = next 00:00 UTC"`.
  - `"a repository limit refuses with repository_limit while the account still has room"`.
  - `"caller_limit_usd only lowers the grant"` (caller 2 on an account with 6 left → 2; caller 10 → wanted).
  - `"forced is granted past the limit and still recorded"`.
  - `"settle replaces reserved with spent; a second settle is a no-op; an unknown id is 404"`.
  - `"an unsettled reservation stays counted; attempt 2 of the same run replaces attempt 1"` (Review Focus 1).
  - `"a reservation at 23:59:59 settles on the same day; a reserve at 00:00:00 sees zero"` (Review Focus 4; pass `now`).
  - `"two concurrent reserves on $2 left grant at most $2 in total"`: `Promise.all([stub.reserve(4), stub.reserve(4)])` → sum of granted ≤ 2.
  - `"today sums by repository"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `account-object.ts` with RPC methods (the Worker calls `stub.reserve(...)`). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ledger): the account Durable Object: reserve, settle, today (ADR 0021, 0022)`.

### Task 10: Signed receipts

**Files:**
- Create: `ledger/src/receipt.ts`
- Test: `ledger/test/receipt.test.ts`

**Interfaces:**

```ts
export interface Receipt { account: string; repository: string; run_id: string; usd: number; day: string }
export function canonicalReceipt(r: Receipt): Uint8Array;   // byte-identical to src/ledger.ts canonicalReceipt: JSON.stringify with keys in the order account, repository, run_id, usd, day
export async function signReceipt(r: Receipt, privateKeyJwk: JsonWebKey): Promise<string>;   // Ed25519 via crypto.subtle, base64url signature
export async function verifyReceipt(r: Receipt, signature: string, publicKeyJwk: JsonWebKey): Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests**: sign/verify round-trip with a pair from `crypto.subtle.generateKey("Ed25519", true, ["sign","verify"])`; a changed `usd` fails; `canonicalReceipt` of `{day, usd, run_id, repository, account}` (shuffled keys) equals the ordered form.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Cross-check with the engine**: add to `src/ledger.test.ts` a fixture receipt, a public key PEM and a signature produced by this module (paste the three strings), asserting `verifyReceipt` is true. Commit `feat(ledger): Ed25519 receipts; engine verifies a ledger-signed fixture`.

### Task 11: The Worker routes and the deploy workflow

**Files:**
- Create: `ledger/src/index.ts`
- Create: `.github/workflows/release-ledger.yml`
- Test: `ledger/test/routes.test.ts` (uses `SELF.fetch` from `cloudflare:test`, with `ACCOUNTS_JSON`, the key JWKs and a test `JWKS_URL` set in `vitest.config.ts` bindings; the JWKS is served by a `fetchMock` of the discovery and jwks URLs)

**Interfaces:** the HTTP contract of the spec, exactly:

| Route | Auth | Body → Answer |
| --- | --- | --- |
| `POST /v1/reserve` | Bearer OIDC | `{wanted_usd, caller_limit_usd?, trigger, forced}` → 200 `ReserveOutput(ok)`; 402 `ReserveOutput(!ok)`; 401 `{reason:"unauthorized", detail}`; 403 `{reason:"not_linked", repository}` |
| `POST /v1/settle` | Bearer OIDC | `{reservation_id, spent_usd}` → 200 `{receipt, signature}`; 404 |
| `GET /v1/today` | Bearer OIDC | 200 `TodayOutput` plus `account` and `by_tag: {tag, usd}[]` (the Worker folds `by_repository` through the account table's tags; the object knows no tags) |
| `GET /v1/public-key` | none | 200 `{alg:"Ed25519", jwk, pem}` |

`forced` is honoured only when the token's `event_name` is `issue_comment` (the on-demand job) — an automatic trigger cannot force even if it says so. The Worker builds `ReserveInput` from the claims plus the account's limits and calls `env.ACCOUNTS.get(env.ACCOUNTS.idFromName(account.account_id))`.

Deploy workflow: `on: workflow_dispatch` only; `environment: production`; `permissions: contents: read`; checks out the ref the dispatch ran on; `bun install --frozen-lockfile` in `ledger/`; `wrangler deploy` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment's secrets; a comment at the top saying secrets are set with `wrangler secret put ACCOUNTS_JSON | RECEIPT_PRIVATE_KEY_JWK | RECEIPT_PUBLIC_KEY_JWK` and never committed.

- [ ] **Step 1: Write the failing tests**: each row of the table with a minted token (Task 7's minter); forced from a `pull_request` token is recorded as `forced: false`; `/v1/public-key` needs no token; an unknown route is 404.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `index.ts` (plain `switch` on method and pathname; no router library). Write the deploy workflow. **Step 4: Run** `bun run test` in `ledger/` and actionlint — PASS.
- [ ] **Step 5: Commit** `feat(ledger): HTTP routes and a dispatch-only deploy workflow (ADR 0021)`.

### Task 12: CI runs the ledger tests; handoff

**Files:**
- Modify: `.github/workflows/ci.yml` (a `ledger` job: setup Bun, `bun install --frozen-lockfile` and `bun run test` in `ledger/`)
- Modify: `docs/architecture.md` (a short "The ledger" subsection under "The execution harness" linking ADR 0021 and `ledger/README.md`)

- [ ] **Step 1: Add the job**; run actionlint — PASS.
- [ ] **Step 2: Run** `bun test` at the root and `bun run test` in `ledger/` — both PASS.
- [ ] **Step 3: Commit** `ci: run the ledger tests`.
- [ ] **Step 4: Handoff**: the shipping PR links #122, lists the acceptance criteria of the spec as `## Proof` rows with the command or screenshot that proves each, deletes this plan, and asks the owner to (a) create the Cloudflare secrets and the `production` environment, (b) run `release-ledger.yml` once, (c) set `ledger_url` in one caller and watch one real run reserve and settle before any other repository is switched on.
