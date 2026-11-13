# A daily spend limit across every repository, kept by a ledger service

- **Status:** proposed 2026-11-06. Written on Claude Fable 5.1 from the owner's decisions of
  2026-11-05 and 2026-11-06. **Amended 2026-11-12:** the ledger described here was built, and it differs from this text
  (camelCase bodies, a weekly limit, `POST /v1/record`, `GET /v1/entries`, per-call rows). Its source
  is not in this repository. The current contract is
  [`docs/ledger-api.md`](../ledger-api.md) and the
  [ADR 0021 Amendments](../adr/0021-a-daily-spend-limit-kept-by-a-ledger-service.md); where they
  disagree with this spec, they win. In particular, a repository enrolled in a ledger calls
  `review-platform.yml` (which carries `id-token: write`), not `review.yml`; the `id-token`
  instructions below are historical. The engine client is on `main` (`src/ledger.ts`). Text below that
  says the ledger's code is public in this repository or lives under `ledger/` is superseded by ADR 0021,
  Amendment (h).
- **Creates:** [ADR 0021](../adr/0021-a-daily-spend-limit-kept-by-a-ledger-service.md) (a hosted
  ledger with GitHub OIDC, superseding the "no hosted service" non-goals of ADR 0001 and ADR
  0012 for this one purpose) and [ADR 0022](../adr/0022-accounts-are-the-only-wallet-tags-only-report.md)
  (accounts are the only wallet; tags only report). Amends ADR 0012 (manual runs now count
  against a limit). Reuses ADR 0001 (trust model, no forks), ADR 0002 (zero dependencies in the
  engine), ADR 0011 and ADR 0012 (the per-pull-request ceiling stays).
- **Refs:** [#122](https://github.com/niway-dev/wachiman/issues/122). Supersedes, in part, the
  spec [Usage and spend by model, without a server](2026-10-31-usage-dashboard-design.md): its
  "no data sent to a Wachi server" rule stays for review content and is relaxed for one number,
  the dollars a run spent, under the conditions in ADR 0021.
- **Numbering:** 0019 and 0020 are on `main`; 0014 to 0019 are also claimed by open design pull
  requests (#80, #90, #99), so these records are 0021 and 0022.

## Summary (one minute)

Wachiman bounds one run (`budget_usd`) and one pull request (`auto_budget_usd`, ADR 0012).
Nothing bounds a day, and no run can see what another repository spent, because each run only
reads its own repository with its own `GITHUB_TOKEN`. The owner wants one number, **$6 per UTC
day across every repository**, and wants a run that hits it to fail visibly instead of passing
quietly, which is what happened with a previous limiter.

A global limit needs one place every run can read and write. The design adds a small **ledger
service**: a Cloudflare Worker with one Durable Object per *account* (the wallet). Before it
spends, a run proves which repository it is with a GitHub OIDC token (no shared secret), asks the
ledger to **reserve** what it may spend today, runs, then **settles** the real cost. The Durable
Object handles one request at a time, so two simultaneous runs cannot both read "$2 left". The
ledger's code was first planned to be public in this repository (superseded: ADR 0021, Amendment (h)); the table that links repositories to accounts, the
spend data and the future dashboard are private. The consumer's API key never leaves the
consumer's repository; the ledger sees repository names and dollars, nothing else.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | One daily limit, calendar day in UTC, kept by a hosted ledger service the engine calls before and after each run | Only a shared service can see across repositories; a GitHub-based ledger cannot reserve atomically | 0021 (new) |
| 2 | Identity by GitHub OIDC: the ledger verifies the token's signature, `iss`, `aud`, expiry and reads `repository_id`, `repository`, `run_id`, `run_attempt`, `job_workflow_ref` | No secret to distribute or leak; GitHub, not the caller's yml, names the repository; forks never get a token | 0021 |
| 3 | The ledger is a Cloudflare Worker with one SQLite-backed Durable Object per account; the Worker routes by the account the repository is linked to | A Durable Object is a single, globally unique instance per id, which is what makes a reservation atomic; the free plan covers this volume by orders of magnitude | 0021 |
| 4 | Three concepts: **organization** (optional, cross-cutting admin), **account** (the wallet, the only hard-limit holder with its repositories), **repository** (linked once by hand, proven by OIDC on every call). **Tags** cross accounts and only group reports and alerts | Flexibility without coordination: hard limits live where atomicity lives; grouping for people is free-form | 0022 (new) |
| 5 | Hard limits: per account (the daily number), per repository (optional, stricter), per organization (designed, not built: a second reservation in the organization's object). No limit per tag | A tag limit would need every reservation to coordinate several objects | 0022 |
| 6 | `reserve` grants `min(run budget, repository left, account left)`; a balance of $0.05 or more starts a run with what is left; a balance below $0.05, the smallest batch, counts as no credits and starts nothing | The owner's grace rule: $0.30 left still runs; below one batch ($0.05) a run could only end in an engine error | 0021 |
| 7 | **Every** run counts and is limited, including `/wachi review` and `/wachi <question>`; `/wachi review --force` (operator only) runs past the limit and is still recorded | A money ceiling that a comment can skip is not a ceiling; the owner keeps one explicit override | amends 0012 |
| 8 | Per repository, `daily_limit_mode: fail` (default) ends the run with exit code **3** and a red job; `notice` posts the comment and exits 0. Both post one "No credits today" comment per pull request per UTC day | The owner wants a visible pipeline error; a repository with a required check can choose the quiet mode | none |
| 9 | The ledger's URL is a caller input (`ledger_url`); the global number lives in the ledger and is edited there; the caller's `daily_budget_usd` is optional and can only be stricter than the account's limit | One source of truth for the shared number; a repository can protect itself further | 0021 |
| 10 | Fail closed: with `ledger_url` set, a missing `id-token` permission, an unreachable ledger, a 401/403 or an unlinked repository ends the run with exit 3 and no model call. `daily_limit_bypass: true` skips the ledger entirely, at the repository's own risk, and the run says so in its footer | The owner prefers a missed review to an unbounded bill; the bypass is the escape hatch | 0021 |
| 11 | The ledger answers `settle` with a signed receipt (`account`, `repository`, `run_id`, `usd`, `day`); the engine writes it into the review's hidden footer | A reader can verify what the ledger recorded with the ledger's public key; it replaces trust in the private data with a check | 0021 |
| 12 | *(Superseded by ADR 0021, Amendment (h): the ledger's source is not in this repository; its contract is `docs/ledger-api.md`.)* The ledger's Worker code is public in this repository under `ledger/`; the account table, the data and the dashboard are private. Secrets: the Cloudflare deploy token in a protected `production` environment of this repository; the receipt signing key as a Worker secret | Trust: the consumer can read what decides whether its review runs; the FSL already forbids a competing service | 0021 |
| 13 | The engine's ledger client has no dependencies (ADR 0002): `fetch`, the OIDC request with `ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN`, JSON | Same rule as every other engine module | reuses 0002 |
| 14 | The caller adds `permissions: id-token: write`; this ships as a **major** release with an upgrading note; a caller without it and with `ledger_url` set fails with exit 3 and a clear message | A reusable workflow cannot raise permissions the caller did not grant (ADR 0001 decision 2) | reuses 0001 |

## Open questions

1. **Which jobs get `id-token: write`.** Default: the `review`, `threads` and `comment` jobs as
   they are; the engine requests the token in-process before any model call and the agent's
   child process never sees `ACTIONS_ID_TOKEN_REQUEST_*` (they are not in `CHILD_ENV_ALLOWLIST`,
   `src/providers/claude-code.ts`). The alternative, two small jobs around the model job that
   hold the permission, is cleaner and costs passing the cost between jobs; it is taken only if
   a review finds the in-process token reachable from the agent.
2. **`repository_id` as the key.** GitHub documents it ("The ID of the repository from where the
   workflow is running"), so a rename does not unlink a repository. Default: key by
   `repository_id`, display `repository`. If the console links by name, the first call records
   the id.
3. **Token lifetime and the settle call.** The settle call happens up to 30 minutes after the
   reserve (the job timeout). GitHub's documentation does not state the token's lifetime.
   Default: request a fresh token for each call; if the second request fails, settle with the
   reservation id and the original token's `run_id`, and the ledger accepts a settle for a
   reservation it holds from the same `run_id` and `run_attempt`.
4. **Cancelled runs.** A cancelled job never settles, so its reservation stays as reserved
   spend for the day. Default: count the reservation (over-count, protects the money); a
   `settle` from a later attempt of the same run replaces it. ADR 0012's under-count of
   cancelled runs is therefore not repeated here.
5. **Account administration in the first version.** Default: a JSON table in the Worker's
   configuration (`accounts.json`, private, mounted as a Worker secret or KV entry, never in
   git) edited by the owner; an admin endpoint and the web console are the next phase.
6. **Two reservations for the organization limit.** Default: designed in ADR 0022, not built.
7. **Clock skew and the day boundary.** The ledger decides the day from its own clock, never
   from the run. Default: a reservation made at 23:59:30 UTC belongs to that day even if it
   settles after midnight.

## Out of scope

- The web console and sign-in for people (a separate, private product). The first version links repositories by hand.
- The organization-level limit, tag alerts, SSO, roles and bulk linking for very large
  organizations.
- A monthly limit, invoicing, or anything that reads the provider's billing.
- Review content, prompts, diffs, findings or keys reaching the ledger. It receives repository
  identity, run identity and dollars.
- Replacing the per-pull-request ceiling of ADR 0012. Both apply; a run gets the smaller room.
- The Codex provider's cost accounting (ADR 0004); the ledger records what the engine reports.

## Failures this must protect against

- Two runs in two repositories start in the same second with $2 left and both spend $2.
- A run hits the limit and the job stays green with no comment: the previous limiter's failure.
- A pull request from a fork, or a workflow in an unlinked repository, reserves from someone
  else's account by writing their name in a yml.
- A stolen Cloudflare deploy token or a leaked ledger URL lets a stranger spend an account's
  balance (they cannot: without a GitHub OIDC token from a linked repository the ledger refuses).
- A cancelled run spends money the ledger never hears about.
- The ledger is down and every repository silently keeps spending.
- A repository's own stricter budget is ignored because the account still has room.
- A second "No credits today" comment on every push for the rest of the day.
- The model writes a fake receipt or a fake cost line in the review body (the engine's signed
  footer rule from ADR 0012 and the receipt signature cover it).
- The engine's child process (the agent) obtains an OIDC token and calls the ledger itself.
- The UTC day rolls over between reserve and settle and the spend lands on the wrong day.

## Acceptance criteria

Engine (`niway-dev/wachiman`, `src/ledger.ts`, `src/engine.ts`, `src/cli.ts`, `review.yml`):

- [ ] `bun test` passes with a fake ledger: a run with `ledger_url` set calls `reserve` before
      its first model call and `settle` after its last, with the run's real cost.
- [ ] With $0.30 left for the day, the run starts with a budget of $0.30; with $0.00 or less,
      no model call happens.
- [ ] `daily_limit_mode: fail` ends the run with exit code 3 and the job is red;
      `daily_limit_mode: notice` exits 0; both post exactly one "No credits today" comment per
      pull request per UTC day (a second run on the same day posts nothing).
- [ ] `/wachi review --force` by the operator runs past the limit; its cost is settled and its
      footer says `forced`. The same command by anyone else is ignored like any non-operator
      command.
- [ ] With `ledger_url` set and no `id-token: write`, or an unreachable ledger, or a 401/403,
      the run exits 3 before any model call with a message that names the cause.
- [ ] `daily_limit_bypass: true` makes no ledger call and writes `ledger bypassed` in the
      footer.
- [ ] The caller's `daily_budget_usd` is applied as `min(caller, account left)`; a caller value
      above the account's limit changes nothing.
- [ ] `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are absent from the
      agent's environment (`buildChildEnv` test).
- [ ] The review footer carries the ledger's receipt; `readReceipt(body)` returns it and
      `verifyReceipt(receipt, publicKey)` accepts the ledger's signature and rejects a modified
      one.
- [ ] `docs/configuration.md`, `docs/costs.md`, `docs/troubleshooting.md` (exit code 3,
      "No credits today"), `docs/upgrading.md` (the major release and `id-token: write`) and the
      caller templates are updated; the docs test that checks workflow text passes.

Ledger (historical: the hosted ledger's source is not in this repository; its contract is `docs/ledger-api.md`):

- [ ] `POST /v1/reserve` with a valid GitHub OIDC token from a linked repository returns
      `{reservation_id, granted_usd, account_left_usd, repository_left_usd, day}`; the same
      request with an expired, wrong-audience, wrong-issuer or unsigned token returns 401; from
      an unlinked repository, 403 with `repository not linked`.
- [ ] Two concurrent `reserve` calls on an account with $2 left grant at most $2 in total (test
      with the Workers test runner against one Durable Object).
- [ ] `POST /v1/settle` replaces the reservation's amount with the real cost and returns a
      receipt whose Ed25519 signature verifies with `GET /v1/public-key`.
- [ ] `GET /v1/today` for the token's account returns the day's totals by repository and by tag.
- [ ] Day boundaries: a reservation at 23:59:59 UTC counts for that day; the first call after
      00:00 UTC sees a zero balance.
- [ ] A settle for a reservation the ledger does not hold returns 404; a second settle for the
      same reservation is idempotent.
- [ ] The Worker deploys through a protected `production` environment and holds no secret in
      its configuration. (Not verifiable in this repository.)

## The run, step by step

1. The caller workflow has `ledger_url` set and `id-token: write` granted.
2. The engine (`src/ledger.ts`) requests a GitHub OIDC token with the audience set to
   `ledger_url` (`curl`-equivalent `fetch` on `ACTIONS_ID_TOKEN_REQUEST_URL`, bearer
   `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, documented by GitHub for custom actions).
3. `POST {ledger_url}/v1/reserve` with `{wanted_usd: <the run's budget>, caller_limit_usd?:
   <daily_budget_usd>, trigger, forced}`. The Worker verifies the token against GitHub's JWKS
   (discovery at `https://token.actions.githubusercontent.com/.well-known/openid-configuration`),
   checks `iss`, `aud`, `exp`, finds the account for `repository_id`, and forwards to that
   account's Durable Object.
4. The Durable Object computes the day (its own clock, UTC), sums today's reservations and
   settlements, and grants `min(wanted, caller_limit left, repository limit left, account limit
   left)`. If the account's balance is below $0.05 (the smallest batch, so it counts as no credits) and `forced` is false, it answers 402 with the
   totals. It records the reservation.
5. The engine runs with the granted amount as its `budget_usd` (and still inside ADR 0012's
   per-pull-request ceiling, whichever is smaller).
6. `POST /v1/settle` with `{reservation_id, spent_usd}`. The object replaces the reserved amount
   with the real spend and returns a receipt signed with the Worker's Ed25519 key.
7. The engine writes `<!-- wachi:receipt <base64url json>.<base64url signature> -->` into the
   review's hidden footer, immediately before the cost line, where the model cannot write
   (ADR 0012; the cost line, the automatic flag and the signature stay contiguous so
   `readAutoCost` is unchanged).
8. On 402 the engine posts the "No credits today" comment (once per pull request per day,
   deduplicated by a `<!-- wachi:nocredits day=YYYY-MM-DD -->` footer) and exits 3 (`fail`) or
   0 (`notice`).

## Interfaces

Caller inputs (reusable workflow `with:`, all optional):

| Input | Default | Meaning |
| --- | --- | --- |
| `ledger_url` | unset | The ledger's base URL. Unset: no daily limit, no ledger call, behaviour as today |
| `daily_budget_usd` | unset | A stricter daily number for this repository; never raises the account's |
| `daily_limit_mode` | `fail` | `fail`: exit 3 and a red job at the limit; `notice`: comment and exit 0 |
| `daily_limit_bypass` | `false` | Skip the ledger entirely; the footer says so |

Engine environment: `AGENT_REVIEW_LEDGER_URL`, `AGENT_REVIEW_DAILY_BUDGET_USD`,
`AGENT_REVIEW_DAILY_LIMIT_MODE`, `AGENT_REVIEW_DAILY_LIMIT_BYPASS`, plus the GitHub-provided
`ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`.

Exit codes: 0 and 1 and 2 as in `docs/cli.md`; **3**: the daily limit refused the run, or the
ledger was required and unavailable (`fail` mode).

Ledger API (JSON, bearer = GitHub OIDC token; the current contract is `docs/ledger-api.md`):

| Route | Body | Answer |
| --- | --- | --- |
| `POST /v1/reserve` | `{wanted_usd, caller_limit_usd?, trigger, forced}` | 200 `{reservation_id, granted_usd, account_left_usd, repository_left_usd, day}`; 402 `{reason: "limit", account_spent_usd, account_limit_usd, day}`; 401; 403 `{reason: "not_linked"}` |
| `POST /v1/settle` | `{reservation_id, spent_usd}` | 200 `{receipt, signature}`; 404; idempotent on repeat |
| `GET /v1/today` | — | `{day, account, limit_usd, spent_usd, by_repository: [...], by_tag: [...]}` |
| `GET /v1/public-key` | — | the Ed25519 public key, for receipt verification |

Data (one SQLite table per account object, append-only):

`entries(id, day, repository_id, repository, run_id, run_attempt, trigger, forced, reserved_usd,
settled_usd NULL, created_at, settled_at NULL)`. Totals are `SUM(COALESCE(settled_usd,
reserved_usd))` for the day. Raw rows are kept 400 days (ADR 0021, amendment (g); this spec first said 90). The reports read the
entries (`GET /v1/today`, `GET /v1/entries`); no separate daily-totals table exists.

Account table (private, not in git): `{account_id, name, organization_id?, limit_usd,
repositories: [{repository_id, repository, limit_usd?, tags: [...]}]}`.

## The "No credits today" comment

Posted as a review comment (same path as ADR 0012's notice), branded, one per pull request per
UTC day:

> 👮 **Wachiman** · **No credits today.** Automatic reviews spent **$6.12 of $6.00** across your
> repositories; the limit resets at **00:00 UTC** (in 5 h 12 min). To review this pull request
> now, comment `/wachi review --force`. To change the limit, edit the account in the ledger; to
> let this repository ignore it, set `daily_limit_bypass: true` (at your own risk).

The amounts and the time to reset come from the 402 answer. The hidden footer
`<!-- wachi:nocredits day=2026-11-06 -->` stops a second comment the same day.

## What the state of the art does

- [Pullfrog](https://github.com/pullfrog/pullfrog) runs the agent in the consumer's Actions with
  the consumer's secrets and keeps a hosted console for toggles and spend; its action code is
  MIT. Whether the console's code is public was not verified. The split first planned
  here (public ledger code, private data) was reversed: the ledger's source stays outside this
  repository and its contract is public.
- Anthropic's [Usage and Cost API](https://platform.claude.com/en/docs/build-with-claude/usage-cost-api)
  reports real spend per day but needs an organization Admin key and is daily only; rejected
  for a per-run decision.
- GitHub's [OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) defines
  `repository_id`, `job_workflow_ref`, `run_id`, `run_attempt`, the `id-token: write` requirement
  and the `ACTIONS_ID_TOKEN_REQUEST_*` variables; the discovery document is at
  `https://token.actions.githubusercontent.com/.well-known/openid-configuration`. The page does
  not state the token lifetime (open question 3).
- Cloudflare's [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits)
  and [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): the Free
  plan allows SQLite-backed objects only, 100,000 requests, 5 million rows read and 100,000 rows
  written per day, 5 GB storage, limits reset at 00:00 UTC, no charge on the free plan. Their
  [known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/) page
  states global uniqueness: one instance per id at a time, checked on each event and storage
  access. Single-threaded request handling inside one object is general knowledge about the
  platform and is to be confirmed by the concurrency test in the acceptance criteria.

## Sources and unverified claims

- The owner's decisions are in [#122](https://github.com/niway-dev/wachiman/issues/122).
- Unverified: GitHub OIDC token lifetime; that a Durable Object serializes requests (the
  acceptance test is the proof); Free-plan row limits are quoted from the pricing page and not
  measured; the JWKS URL comes from the discovery document, not from a page that names it.
