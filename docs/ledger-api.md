# The spend ledger API

This is the contract between Wachiman's engine and a spend ledger: the service that keeps a daily
and an optional weekly spend limit for an account and a record of every run. It is written so that
someone can implement a ledger of their own and point `ledger_url` at it.

**Where the service lives.** The hosted ledger's source is not in this repository. This repository
holds what a consumer executes (the engine's client in `src/ledger.ts` and `src/cost.ts`, and the
local dashboard) and this contract. [ADR 0021](adr/0021-a-daily-spend-limit-kept-by-a-ledger-service.md)
explains the decision and [ADR 0022](adr/0022-accounts-are-the-only-wallet-tags-only-report.md) the
account model. How to turn the feature on in a workflow is in
[install.md](install.md#optional-enroll-in-a-spend-ledger); what the limit means for a run is in
[costs.md](costs.md#the-spend-limit).

The contract was checked against the client on `main` and against the hosted Worker's code at the
time of writing (2026-11-12). Where a statement describes only what the client reads, it says so.

## Overview

A run does three things with a ledger, in this order:

1. **Reserve** before its first model call: "I want up to this much." The ledger answers with a
   grant (the same amount or less) or refuses, and the run's budget is capped by the grant.
2. **Settle** after its last call: "I spent this much, on these calls." The ledger replaces the
   reservation with the real amount, stores the calls and answers with a signed receipt.
3. **Record**, only when the reserve could not be made because the ledger was unreachable: the
   run tells the ledger afterwards what it spent, so the spend still counts.

The engine calls only `POST /v1/reserve`, `POST /v1/settle` and `POST /v1/record`. The other three
routes (`GET /v1/today`, `GET /v1/entries`, `GET /v1/public-key`) serve dashboards and receipt
verification.

All bodies and responses are JSON (`Content-Type: application/json`). Amounts are USD as JSON
numbers. A ledger may store them as it likes (the hosted one uses integer micro-dollars) but must
read and write them as USD on the wire. A day is a UTC calendar day (`YYYY-MM-DD`). A week runs
Monday to Sunday UTC and is named by its Monday (`YYYY-MM-DD`). A run belongs to the day and the
week in which it reserved, whenever it settles.

## What leaves the runner, and what the ledger stores

The engine sends only what the client in `src/ledger.ts` builds:

- On reserve: the amount it wants, optional caller limits, the trigger, whether the run is forced
  and the pull request number.
- On settle and record: the amount spent and, per model call, the same fields as the engine's
  `wachiman-cost` log line (listed below). Record also sends the trigger and the pull request
  number.
- The GitHub OIDC token of the job, as a bearer token. The agent that reads your code never sees it.

No prompt, source code, diff, pull request title, finding text, API key or provider credential is
sent, and the ledger has no field to store one.

**Per run** (one row per reserved or recorded run attempt) the hosted ledger stores: the
repository (its numeric id and `owner/name`), the pull request number, the run id and attempt, the
trigger, whether it was forced, whether it was recorded without a reservation, the reserved and the
settled amount, and the time it reserved and settled.

**Per model call** (one row per element of `calls`): `operation`, `label`, `model`, `turns`,
`duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`,
`cost_usd`, `costKnown`, `terminal_reason` and `auth`. `label` and `operation` are short names the
engine chooses for the step (for example `review` with `claims`, or `verify` with `verifier`), not
content from the repository.

**Retention.** Rows are kept for 400 days (about 13 months). The hosted ledger deletes older rows
at most once per UTC day for each account that is active. The GitHub OIDC token is verified and
discarded. A read token (see [Reading entries](#get-v1entries)) is kept only as a SHA-256 hash.

An implementation of its own may store less. It must not be asked to store more: nothing in the
requests below carries code or findings.

## Authentication

Reserve, settle, record and today take `Authorization: Bearer <token>`, where the token is a
GitHub Actions OIDC token (RS256) that the job requested with `audience` set to the ledger's URL.

The ledger must verify, against GitHub's published signing keys (the `jwks_uri` of the issuer's OpenID discovery document, `https://token.actions.githubusercontent.com/.well-known/openid-configuration`):

- the RS256 signature, with a key found by `kid` (refetching the key set when the `kid` is unknown);
- `iss` equals `https://token.actions.githubusercontent.com`;
- `aud` (a string or an array) contains the ledger's own audience;
- `nbf` and `exp` bracket the current time.

**The audience rule.** The engine requests the audience `ledger_url` as the workflow author wrote
it, minus trailing slashes. The ledger compares its configured audience to that value exactly,
character for character (scheme, host and path). With no audience configured, a ledger must refuse
every request that needs a token. Write the URL the same way in both places, without a trailing
slash.

**The account comes from the token, never from the body.** The ledger derives the repository from
the verified claims (`repository_id`, `repository`, `run_id`, `run_attempt`, `event_name`) and maps
`repository_id` to an account in its own configuration. Nothing in a body can name another account
or repository. A pull request from a fork has no OIDC token, so it never reaches the ledger.

| Answer | When |
| --- | --- |
| 401 `{"reason":"unauthorized","detail":"..."}` | no bearer token, or the token fails any check above |
| 403 `{"reason":"not_linked","repository":"owner/name"}` | the token is valid but the repository is not linked to any account |

## Routes

### `POST /v1/reserve`

Request:

```json
{
  "wantedUsd": 3,
  "callerLimitUsd": 5,
  "callerWeeklyLimitUsd": 20,
  "trigger": "pull_request",
  "forced": false,
  "pr": 123
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `wantedUsd` | number, required | What the run asks for: its budget. |
| `callerLimitUsd` | number, optional | A stricter daily number the repository set (`daily_budget_usd`). It can only lower the grant. |
| `callerWeeklyLimitUsd` | number, optional | The same, per week (`weekly_budget_usd`). |
| `trigger` | string, required | Why the run started, such as `pull_request` or `cli`. The engine sends a value matching `^[a-z_]+$`. |
| `forced` | boolean | The operator asked for this run past the limits (`/wachiman review --force`). |
| `pr` | positive integer, optional | The pull request number. |

**Granted.** 200:

```json
{
  "reservationId": "…",
  "grantedUsd": 3,
  "accountLeftUsd": 17.5,
  "repositoryLeftUsd": null,
  "day": "2026-11-12",
  "week": "2026-11-09",
  "weekLeftUsd": 42.5
}
```

`grantedUsd` is the least of `wantedUsd` and what is left in every limit that applies: the
account's day and week, the repository's own daily limit if it has one, and the caller's day and
week limits. `repositoryLeftUsd` is `null` when the repository has no limit of its own.
`weekLeftUsd` is `null` when the account has no weekly limit. The client requires
`reservationId` (a string) and `grantedUsd` (a finite number, zero or more). A grant that is
negative or not a number is treated as a malformed answer, never as a budget.

**Forced.** A forced reserve is granted the full `wantedUsd` past every limit, but a ledger must
honour `forced` only when the token's `event_name` is `issue_comment`, because the operator's
command is a comment. For any other event the field is ignored.

**Refused.** 402:

```json
{
  "reason": "limit",
  "period": "day",
  "accountSpentUsd": 20,
  "accountLimitUsd": 20,
  "day": "2026-11-12",
  "week": "2026-11-09",
  "resetsAt": "2026-11-13T00:00:00.000Z"
}
```

| `reason` | `period` | Means |
| --- | --- | --- |
| `limit` | `day` | The account's daily limit has less than $0.05 left. |
| `weekly_limit` | `week` | The account's weekly limit has less than $0.05 left. |
| `repository_limit` | `day` or `week` | The repository's own daily limit, the caller's daily limit, or the caller's weekly limit has less than $0.05 left. |

When both the week and the day are full, the refusal names the week: waiting for tomorrow would not
help. Checks run in this order: account week, account day, caller week, repository or caller day.
A balance under $0.05 (the smallest amount worth a model call) counts as nothing left.

`accountSpentUsd` and `accountLimitUsd` carry the figures of the limit that refused. For
`weekly_limit` and `limit` they are the account's. For `repository_limit` with `period: week` they
are the repository's spend this week and the caller's weekly limit. For `repository_limit` with
`period: day` they carry the account's daily figures, not the repository's. `resetsAt` is an ISO
timestamp: the next UTC midnight for `period: day`, the next UTC Monday midnight for `period: week`.

**Repeated reserve.** A reserve for a run id that already has an *unsettled* entry on the same day
from the same or a lower attempt replaces that entry, so a repeated request counts once. The old
reservation id then answers 404 on settle. A settled entry is never replaced: a retry gets a new
entry beside it.

### `POST /v1/settle`

Request: `{"reservationId": "…", "spentUsd": 1.42, "calls": [ … ]}`. `reservationId` (string) and
`spentUsd` (number) are required; `calls` is optional (see [Calls](#calls)).

200:

```json
{
  "receipt": { "account": "acct-1", "repository": "acme/app", "run_id": "42", "usd": 1.42, "day": "2026-11-12" },
  "signature": "<base64url Ed25519 signature>"
}
```

Settling replaces the reservation's amount with `spentUsd` and stores the calls. It is idempotent:
settling the same reservation again replaces the earlier amount and calls and returns a receipt for
the new amount. A reservation that does not exist, or that belongs to another repository or
account, answers 404 `{"reason":"not_found"}`. A ledger may count only what settled and what is
still reserved, so a failed settle leaves the reservation counted at the reserved amount.

### `POST /v1/record`

Request:

```json
{ "spentUsd": 0.9, "calls": [ … ], "trigger": "pull_request", "pr": 123, "reason": "unreserved" }
```

`spentUsd`, `trigger` and `reason` (exactly `"unreserved"`) are required. The engine uses it for a
run that believes it reserved nothing, because the ledger was unreachable. 200:

```json
{ "id": "…", "day": "2026-11-12", "week": "2026-11-09", "state": "unreserved" }
```

`state` says what happened:

- `settled`: the run in fact held a reservation (its reserve reached the server and the answer was
  lost). That reservation is settled with `spentUsd` and `calls`, `id` is the reservation's id,
  and no second entry is made, so the run counts once.
- `unreserved`: the run held none, so a new entry is stored. It counts in the day and week totals
  and is never refused.

Record is idempotent per repository, run id and run attempt: calling it again replaces that entry.
The client reads only the status; any 200 is a success.

### `GET /v1/today`

Token: OIDC. Today's and this week's totals for the token's account:

```json
{
  "day": "2026-11-12",
  "limit_usd": 20,
  "spent_usd": 6.3,
  "by_repository": [{ "repository": "acme/app", "usd": 4.1 }],
  "account": "acct-1",
  "by_tag": [{ "tag": "web", "usd": 4.1 }],
  "week": "2026-11-09",
  "weekSpentUsd": 21.4,
  "weekLimitUsd": null,
  "unreservedUsd": 0.9,
  "weekUnreservedUsd": 0.9
}
```

The field names are mixed on purpose: the day fields keep the snake_case names of the first
version, the week fields are camelCase. `weekLimitUsd` is `null` without a weekly limit.
`unreservedUsd` is the part of `spent_usd` that came from unreserved runs, `weekUnreservedUsd` the
same for the week. `by_tag` counts a repository's spend under each of its tags, so the tag totals
can add up to more than `spent_usd`. Tags only report; they never limit (ADR 0022). The engine does
not call this route.

### `GET /v1/entries`

Token: a **read token**, not an OIDC token. A read token can call only this route. The account is
the one the token was issued for. A missing, unknown or OIDC token gets 401 `unauthorized`.

Query: `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both inclusive and both required, by the day on which the
run reserved. `to` before `from`, a missing or malformed date, or more than 92 days answers 400
`{"reason":"bad_request","detail":"…"}`.

200: `{"account": "acct-1", "limits": {"dailyUsd": 20, "weeklyUsd": null}, "entries": [ … ]}`. Each
entry:

```json
{
  "id": "…", "day": "2026-11-12", "week": "2026-11-09",
  "repository": "acme/app", "repository_id": "1001", "pr": 123,
  "run_id": "42", "run_attempt": "1", "trigger": "pull_request", "forced": false,
  "state": "settled", "reservedUsd": 3, "settledUsd": 1.42,
  "created_at": "2026-11-12T10:00:00.000Z", "settled_at": "2026-11-12T10:04:00.000Z",
  "calls": [ … ]
}
```

Entries are ordered by `created_at`, then by insertion order. `settledUsd` and `settled_at` are
`null` until settled. `state` is one of:

| `state` | Meaning |
| --- | --- |
| `reserved` | Not settled, and younger than 6 hours. |
| `settled` | Settled; `settledUsd` is the real spend. |
| `unsettled` | Not settled and older than 6 hours: the run was killed. Its reservation stays counted against the limit, but it is not real spend. |
| `unreserved` | Recorded at the end of a run that could not reserve. |

### `GET /v1/public-key`

No authentication. 200 `{"alg": "Ed25519", "jwk": { … }, "pem": "-----BEGIN PUBLIC KEY-----…"}`:
the key that verifies receipts, as a JWK and as an SPKI PEM.

## Calls

`calls` is an array of at most 200 objects. A ledger reads these fields and ignores any other:

| Field | Type | Notes |
| --- | --- | --- |
| `operation` | string | The kind of step. |
| `label` | string | A short name for the step. |
| `model` | string | The model that answered. |
| `turns` | integer | Agent turns in the call. |
| `duration_ms` | integer | Wall time. |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` | integer | Token counts. |
| `cost_usd` | number or `null` | The call's cost in USD; `null` exactly when `costKnown` is `false`. |
| `costKnown` | boolean | `false` when the provider reported no cost for the call. |
| `terminal_reason` | string or `null` | How the call ended. The client sends a string; a ledger should accept `null` or absent too. |
| `auth` | string | How the call was paid for: `api-key`, `oauth-token` or `subscription`. On the last two `cost_usd` is an API-price estimate, not a charge. |

The field names are those of the `wachiman-cost` log line (`ledgerCall` in `src/cost.ts`).

## Limits a ledger must enforce

- **Money ceiling.** Every amount field (`wantedUsd`, `callerLimitUsd`, `callerWeeklyLimitUsd`,
  `spentUsd`, and each call's `cost_usd` when it is a number) must be a number from 0 to 1000 USD.
  Above that, or negative, or not a number: 400 and nothing is stored.
- **Text.** `trigger` and every text field of a call are at most 200 characters; longer is 400.
- **Calls.** At most 200 per settle or record; more is 400.
- **`pr`.** A positive integer; anything else is 400.
- **Entries range.** At most 92 days per `GET /v1/entries`.

A 400 body is `{"reason":"bad_request","detail":"…"}`.

## Receipts

A receipt is the ledger's signed statement that a run was counted. The signature is Ed25519 over the
UTF-8 bytes of this JSON, with exactly these keys in this order and no whitespace:

```json
{"account":"acct-1","repository":"acme/app","run_id":"42","usd":1.42,"day":"2026-11-12"}
```

The engine puts `<!-- wachi:receipt <base64url of the receipt JSON>.<signature> -->` in the hidden
footer of its pull request comment. Anyone can verify it with the key from `GET /v1/public-key`
(`verifyReceipt` in `src/ledger.ts` does).

## How the client treats an answer

This part is what makes a ledger "look like" a ledger to the engine. The client runs `curl` with a
20 second limit.

| What happened | The client's reading | What the run does |
| --- | --- | --- |
| Network error, timeout, 5xx, 429 | The ledger is unreachable | `ledger_unavailable: run` reviews under the normal budgets and tries to record at the end; `stop` exits with code 3 before any model call |
| 402, or 401/403 with or without the documented body | A refusal; the body's `reason` is used when it is one of `limit`, `weekly_limit`, `repository_limit`, `not_linked`, `unauthorized`, else 402 reads as `limit`, 401 as `unauthorized`, 403 as `not_linked` | The run stops before any model call (exit code 3 with `limit_mode: fail`) |
| Any other unexpected answer: a redirect, 400, 404, 405, a 200 whose body is not the documented JSON, a grant that is not a finite non-negative number | Not a ledger: `ledger_url` is wrong or the service is broken | The run stops before any model call with exit code 3, whatever `ledger_unavailable` says |
| No OIDC request variables in the job | The job cannot ask for a token | Exit code 3 unless `limit_bypass` is set |
| `ledger_url` that does not start with `https://` (`http://localhost` and `http://127.0.0.1` are allowed for tests) | Usage error | Exit code 2 |

Consequences for an implementer: answer a refusal with 402, 401 or 403 and the documented body,
never with 400 or 404. A request the ledger rejects for a size or range reason (400) is read by the
client as "this is not a ledger", so keep the `wantedUsd` ceiling above any `budget_usd` a user is
likely to set.

## Running your own ledger

Implement the routes above, deploy them where the runners can reach `https://…`, configure the
audience to the exact `ledger_url`, and link your repositories to accounts in your own
configuration. Then set `ledger_url` in the caller workflow as described in
[install.md](install.md#optional-enroll-in-a-spend-ledger). The hosted ledger's source is not
published here, so there is no reference deployment to copy: this document is the specification.

A minimal ledger can omit `GET /v1/today`, `GET /v1/entries` and per-call storage, since the engine
never calls the first two and ignores what the ledger does with `calls`. It cannot omit the
atomicity of reserve: two runs that reserve at the same moment must not both be granted what is
left, so the check and the write must happen as one step per account (the hosted ledger uses one
Durable Object per account for this).
