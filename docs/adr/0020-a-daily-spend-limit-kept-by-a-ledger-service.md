# ADR 0020: A daily spend limit across repositories, kept by a ledger service with GitHub OIDC

- **Status:** proposed 2026-11-06, approved in conversation by the owner. Not implemented.
  **Supersedes, for this one purpose,** the non-goal "A hosted service, a queue" of
  [ADR 0001](0001-distribution-and-trust.md) and the non-goal "A hosted queue or a server-side
  spend counter" of [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md).
  **Amends ADR 0012 decision 3:** the operator's `/wachi review` is still outside the
  per-pull-request ceiling but is inside the daily limit. Everything else in those records stands.
- **Spec:** [A daily spend limit across every repository](../specs/2026-11-06-daily-spend-limit-design.md)
- **Issue:** [#122](https://github.com/niway-dev/wachiman/issues/122)
- **Numbering:** 0014 to 0019 are taken by open design pull requests (#80, #90, #99).

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
   repository limit left, account limit left)`; a balance at or below zero grants nothing
   unless the call is `forced`.
4. **Every run counts.** Automatic runs, `/wachi review`, `/wachi <question>` and thread runs.
   `/wachi review --force`, operator only, is granted past the limit and settled like any run.
5. **Fail closed, per-repository mode, per-repository bypass.** With `ledger_url` set, an
   unreachable ledger, a missing permission or a refusal ends the run with exit code 3 before
   any model call. `daily_limit_mode` chooses a red job (`fail`, default) or a green job with the
   comment (`notice`). `daily_limit_bypass: true` skips the ledger and says so in the footer.
6. **A signed receipt in the footer.** `settle` returns `{account, repository, run_id, usd,
   day}` signed with the Worker's Ed25519 key; the engine writes it into the hidden footer
   where the model cannot write (ADR 0012's signed-footer rule). Anyone can verify it with
   `GET /v1/public-key`.
7. **Public code, private data.** The Worker lives in this repository under `ledger/` and is
   deployed from a tag through a protected environment. The account table, the spend rows and
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
- **Fail open when the ledger is down.** Rejected by the owner: a missed review is cheaper than
  an unbounded day. The bypass exists for a repository that disagrees.
- **Keep the ledger's code private.** It decides whether a consumer's review runs and sees its
  repository names; the owner wants that auditable. The FSL (ADR 0013) already forbids a
  competing service built from it.
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
- The engine gains one module (`src/ledger.ts`), one exit code (3), four inputs, one comment
  and one footer line. The Worker gains a `ledger/` package with its own tests and deploy.
- The usage-dashboard spec of 2026-10-31 ("nothing leaves the repository") is relaxed for one
  number per run; review content still never leaves.

## Non-goals

- Reading or storing anything about the review's content.
- A monthly limit, invoices, or reading the provider's bill.
- The web console and sign-in for people; bulk linking; SSO. Designed later, in
  `wachiman-private`.
- Making the ledger a required dependency for every consumer.

## Reopen when

- A second operator of the ledger appears (someone other than the owner deploys it): the
  account table format and the admin API need a contract and a version.
- Over a month, more than 10 % of runs with `ledger_url` set fail with exit 3 for ledger
  availability rather than the limit: revisit fail-closed or add a short grace cache.
- A consumer asks for a daily limit without any hosted service: the private-repository ledger
  becomes an opt-in, documented as racy.
- GitHub changes the OIDC claims this relies on (`repository_id`, `job_workflow_ref`).
