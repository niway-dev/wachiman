# ADR 0021: A daily spend limit across repositories, kept by a ledger service with GitHub OIDC

- **Status:** accepted 2026-11-12, amended the same day (see Amendments). Proposed 2026-11-06 and approved
  in conversation by the owner. The engine client that calls the ledger is on `main` (`src/ledger.ts`).
  The ledger's source is **not** in this repository (Amendment (h)); its API contract is
  [`docs/ledger-api.md`](../ledger-api.md).
  **Supersedes, for this one purpose,** the non-goal "A hosted service, a queue" of
  [ADR 0001](0001-distribution-and-trust.md) and the non-goal "A hosted queue or a server-side
  spend counter" of [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md).
  **Amends ADR 0012 decision 3:** the operator's `/wachiman review` is still outside the
  per-pull-request ceiling but is inside the daily limit. Everything else in those records stands.
- **Spec:** [A daily spend limit across every repository](../specs/2026-11-06-daily-spend-limit-design.md)
- **Issue:** [#122](https://github.com/niway-dev/wachiman/issues/122)
- **Numbering:** 0021 and 0022 were held by earlier design pull requests (#124, #129) while
  ADR 0023 and later landed on `main`; this record and ADR 0022 now take the numbers they held.

## Context

Every limit so far is local to what one run can read: `budget_usd` bounds a run, `auto_budget_usd`
(ADR 0012) bounds a pull request by summing the engine's own signed footers. Both work without
a server because the pull request is the shared state. A limit per **day across every
repository** has no such state: each run holds a `GITHUB_TOKEN` for its own repository only.

The owner's requirement (2026-11-05): $6 per day across all repositories, calendar day in UTC,
and a run that hits it must be a visible pipeline error, because a previous limiter "just passed".
The owner also rejected reading the provider's bill (Anthropic's Cost API is organization-scoped,
daily, and would need an Admin key in every repository) and rejected a per-repository limit.

ADR 0001 and ADR 0012 both list a hosted service as a non-goal. ADR 0012's reopen condition
(cancelled runs spending more than 20 % of a ceiling) is not met and is not the reason here: the
reason is a new requirement that no server-less design can satisfy atomically.

## Decision

1. **A ledger service.** A Cloudflare Worker with one SQLite-backed Durable Object per
   *account*. The engine calls `reserve` before its first model call and `settle` after its
   last. The object handles requests one at a time, so a reservation is atomic across every
   repository in the account.
2. **Identity by GitHub OIDC, no shared secret.** The caller grants `id-token: write`; the
   engine requests a token with the ledger's URL as audience; the Worker verifies the
   signature against GitHub's published keys, `iss`, `aud` and `exp`, and keys the repository by
   `repository_id`. Fork pull requests do not get a token and are refused; an unlinked
   repository is refused with 403. Nothing in a caller's yml can name another repository.
3. **The day is UTC and belongs to the ledger's clock.** Balance = account limit minus the
   day's reservations and settlements. A run is granted `min(wanted, caller limit left,
   repository limit left, account limit left)`; a balance below $0.05 (the smallest batch) grants nothing
   unless the call is `forced`.
4. **Every run counts.** Automatic runs, `/wachiman review`, `/wachiman <question>` and thread runs.
   `/wachiman review --force`, operator only, is granted past the limit and settled like any run.
5. **Fail closed, per-repository mode, per-repository bypass.** *(Fail-closed part superseded by
   Amendment (c): an unreachable ledger no longer stops the run by default.)* With `ledger_url` set, an
   unreachable ledger, a missing permission or a refusal ends the run with exit code 3 before
   any model call. `limit_mode` chooses a red job (`fail`, default) or a green job with the
   comment (`notice`). `limit_bypass: true` skips the ledger and says so in the footer.
6. **A signed receipt in the footer.** `settle` returns `{account, repository, run_id, usd,
   day}` signed with the Worker's Ed25519 key; the engine writes it into the hidden footer
   where the model cannot write (ADR 0012's signed-footer rule). Anyone can verify it with
   `GET /v1/public-key`.
7. **Public code, private data.** *(The first sentence, that the Worker lives in this repository, is
   superseded by Amendment (h).)* The account table, the spend rows and
   the future console are private. The ledger never receives review content, diffs, prompts,
   findings or keys: only repository identity, run identity and dollars.
8. **The global number lives in the ledger.** A caller's `daily_budget_usd` can only be
   stricter. The per-pull-request ceiling of ADR 0012 still applies on top.

## Alternatives rejected

- **Sum signed footers across repositories with a read token** (the ADR 0012 pattern, widened).
  Needs a token that reaches every repository, a maintained list of repositories, one paginated
  read per active pull request, and still cannot reserve: two simultaneous runs both see the
  same balance. Also under-counts cancelled runs by construction.
- **A ledger in a private GitHub repository** (an issue per day, a comment per run). No
  infrastructure, but the same read-then-write race, a fine-grained token to distribute to every
  repository, and no atomic reservation.
- **Anthropic's Usage and Cost API.** Real spend, but organization-scoped, daily granularity,
  needs an Admin key in each repository, and the owner's account is personal.
- **A shared static secret instead of OIDC.** One leak lets anyone spend an account's balance;
  OIDC costs one `permissions` line and nothing to distribute.
- **Fail open when the ledger is down.** Rejected by the owner on 2026-11-06: a missed review is cheaper than
  an unbounded day. *Reversed by Amendment (c) on 2026-11-12:* the review now runs and is recorded afterwards.
  Stopping instead is a per-repository choice.
- **Keep the ledger's code private.** It decides whether a consumer's review runs and sees its
  repository names; the owner wanted that auditable. The FSL (ADR 0013) already forbids a
  competing service built from it. *Reversed by Amendment (h) on 2026-11-12: the source is kept
  outside this repository, and the public contract is what a consumer can audit.*
- **Convex or a database behind a Worker.** More moving parts than one Durable Object for a
  counter and a few thousand rows a month.

## Consequences

- Wachiman now depends on a service to run when `ledger_url` is set. Without it set, nothing
  changes: the engine stays server-less for consumers who do not want a daily limit.
- The caller template grows `permissions: id-token: write`; this is a breaking change for
  installed callers and ships as a major release with an upgrading note.
- A cancelled run's reservation stays counted for the day (over-count); `settle` from a retry
  of the same run replaces it. This is the opposite bias to ADR 0012 and is intentional.
- The limit is still soft by the amount a single Claude Code call can overshoot its cap
  (`docs/costs.md`); the ledger bounds what the engine allows itself, not what the provider bills.
- The engine gains one module (`src/ledger.ts`), one exit code (3), inputs (four at first, six now: Amendment (i)), one comment
  and one footer line. *(The Worker's own package, tests and deploy were first planned here; Amendment (h) puts them outside this repository.)*
- The usage-dashboard spec of 2026-10-31 ("nothing leaves the repository") is relaxed for one
  number per run; review content still never leaves.

## Amendments (2026-11-12)

The decisions above stand except where a point below says otherwise.

- **(a) The ledger is also the record of every enrolled run.** `settle` stores the run's model calls
  (one row per call: operation, model, turns, tokens, cost, authentication) beside the amount, and a
  new `record` route stores a run that could not reserve (if that run in fact holds a reservation whose
  answer was lost, `record` settles it instead, so the run counts once). Read tokens, one per account, let a
  dashboard read the entries through `GET /v1/entries`. Still no prompts, code, diffs or findings:
  only identity, dollars and the numbers of the `wachiman-cost` line.
- **(b) A weekly limit beside the daily one.** An account may set `weekly_limit_usd`. The week is the
  UTC calendar week, Monday to Sunday. A run belongs to the day and week in which it reserved,
  whenever it settles. The day and the week are checked in the same Durable Object call, and the
  grant is the least of what is wanted and what is left in every limit that applies. A refusal for
  the week has reason `weekly_limit`. Without `weekly_limit_usd` an account behaves as before.
- **(c) Decision 5 changes.** When the ledger cannot be reached, the review runs and is recorded
  afterwards as `unreserved` if the ledger answers by the end. The reason: on a Claude subscription an
  overshoot costs plan usage, not cash, so a missed review is now costlier than a slightly late limit.
  A repository can still choose to stop instead. The limit is therefore **best-effort, not a hard
  maximum**: unreserved runs are counted in the totals but never refused, and a run reserved
  while the ledger was reachable can still cost more than its grant (see Consequences).
- **(d) One hosted ledger serves every account.** The routes are versioned under `/v1`, and the
  hosted ledger keeps its account table and its read-token table (with `weekly_limit_usd`) as
  configuration. *(The first version of this point also said that anyone can deploy their own copy
  from `ledger/`; Amendment (h) supersedes that.)*
- **(e) "Convex or a database behind a Worker" was reconfirmed as rejected by the owner on
  2026-11-12**, now that the Worker also holds per-call rows: one Durable Object per account with
  SQLite still carries it.
- **(f) Enrolled callers use a second reusable workflow.** `review.yml` stays without the OIDC
  permission. A repository enrolled in a ledger calls `review-platform.yml`, which carries
  `id-token: write`, grants it in the calling job and sets `ledger_url`. This replaces the
  wording of decision 2 and of the consequence "the caller template grows `permissions: id-token:
  write`": no existing caller of `review.yml` changes. `review-platform.yml` exists from the first
  release that contains it (see `docs/configuration.md` for its inputs).
- **(g) Retention is 400 days, not 90.** Raw entries and their calls are kept about 13 months, the
  owner's decision of 2026-11-12, so a year-over-year comparison stays possible. Reads filter by the
  same cutoff as the prune. `GET /v1/entries` still answers at most 92 days per request.
- **(h) 2026-11-12, the hosted ledger's source is not in this repository.** Decision 7's statement
  that the ledger is a public, self-hostable directory of this repository (`ledger/`, with a
  README and a deploy workflow) is **superseded**. This repository keeps what a consumer
  executes: the engine's client (`src/ledger.ts`, `src/cost.ts`) and the local dashboard. The
  hosted ledger's source is not in this repository. The contract between them is public and is
  [`docs/ledger-api.md`](../ledger-api.md): routes, authentication, bodies, refusal reasons, what is
  stored per run and per model call, retention, and the limits a ledger enforces. Running one's own
  ledger means implementing that contract and pointing `ledger_url` at it; there is no reference
  deployment to copy. The engine does not change: it reads the same `ledger_url`. Decision 7's
  second half (private data, no review content, diffs, prompts, findings or keys) stands.
  Amendment (d)'s "anyone can deploy their own copy from `ledger/`" and the alternative "keep the
  ledger's code private" are affected as marked above.
  The owner made this decision on 2026-11-12: the hosted service that gates consumers' reviews stays
  closed, and the public contract is what a consumer can audit.
- **(i) 2026-11-12, the names the shipped engine uses.** Decisions 4 and 5 and the status line first
  said `daily_limit_mode`, `daily_limit_bypass` and `/wachi review`. Those names were renamed before
  release, and this record now uses the shipped ones: the inputs `limit_mode` (`fail` or `notice`)
  and `limit_bypass`, and the operator's command `/wachiman review` (ADR 0023 made `/wachiman` the
  default mention). The engine's ledger inputs are six, not four: `ledger_url`, `daily_budget_usd`,
  `weekly_budget_usd`, `limit_mode`, `limit_bypass` and `ledger_unavailable`. The reference for them is
  [`docs/configuration.md`](../configuration.md).

## Non-goals

- Reading or storing anything about the review's content.
- A monthly limit, invoices, or reading the provider's bill.
- The web console and sign-in for people; bulk linking; SSO. Designed later, in
  a separate, private product.
- Making the ledger a required dependency for every consumer.

## Reopen when

- The owner decides to publish the ledger's source: then Amendment (h) is reopened, the source
  and a deploy path return, and `docs/ledger-api.md` stays the contract it must meet.
- A second operator of the ledger appears (someone other than the owner runs one from
  `docs/ledger-api.md`): the account table format and the admin API need a contract and a version.
- Over a month, more than 10 % of runs with `ledger_url` set fail with exit 3 for ledger
  availability rather than the limit: revisit the default of Amendment (c) (the review runs and is
  recorded afterwards) or add a short grace cache. Under that default the exit code 3 of decision 5 is
  only what a repository that chose to stop sees.
- A consumer asks for a daily limit without any hosted service: the private-repository ledger
  becomes an opt-in, documented as racy.
- GitHub changes the OIDC claims this relies on (`repository_id`, `job_workflow_ref`).
