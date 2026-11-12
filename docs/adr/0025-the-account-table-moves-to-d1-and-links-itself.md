# ADR 0025: The account table moves to D1, links itself, and is reached by the panel through a Service Binding

- **Status:** proposed 2026-11-07, not implemented. **Amends** ADR 0021 (#129, decision 7's
  "account table ... private" and the spec's open question 5: the table is no longer a
  hand-edited secret) and ADR 0022 (#129, decision 1 "linked by hand in the console" and the
  non-goal "automatic linking from GitHub App installation events"). Those records live on the
  branch of #129; their Status lines are to be amended there with one sentence pointing here
  once this record is accepted. Everything else in them stands: the Durable Object per account
  still holds the money, tags still only report, `repository_id` is still the key.
- **Date:** 2026-11-07
- **Spec:** [Three ways to run Wachiman](../specs/2026-11-07-three-modes-design.md)
- **Issue:** [#134](https://github.com/niway-dev/wachiman/issues/134)

## Context

#129's ledger reads its account table from the `ACCOUNTS_JSON` Worker secret
(`ledger/src/accounts.ts` on
[`feat/daily-spend-limit`](https://github.com/niway-dev/wachiman/blob/feat/daily-spend-limit/ledger/src/accounts.ts)),
edited by the owner by hand. ADR 0022 chose that for a first version and named a console as the
next phase. ADR 0024 adds two writers that arrive at runtime: the App's installation webhooks and
a signed-in user in the panel. A secret cannot be written by a request.

The panel is a separate Worker, `wachiman-dev` (wachiman.dev, static Astro today, no login code),
in `wachiman-private/apps/web`. The ledger is `wachiman-ledger`. Both are assumed to be in the
same Cloudflare account (to confirm). A Durable Object has no public address; it is reached only
through a binding in a Worker, and a binding in another Worker can name the class with
`script_name` ([wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
A Service Binding lets one Worker call another without a public route, and the target must be on
the same account ([service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)).

## Decision

1. **The account table is a D1 database bound to the ledger Worker.** Tables: organizations,
   accounts, repositories (keyed by `repository_id`), tags and repository tags (ADR 0022 as it
   is), plus installations, users, memberships (admin or member of an account) and link codes.
   `reserve`, `settle` and `today` replace `parseAccounts(env.ACCOUNTS_JSON)` with one query by
   `repository_id`. The Durable Object per account is unchanged and keeps every reservation and
   settlement. A one-time import loads the current `ACCOUNTS_JSON`; the secret is then removed.
2. **The ledger owns the data.** No other Worker binds the D1 database or the Durable Object.
   The panel calls the ledger through a Service Binding (`services: [{ binding: "LEDGER",
   service: "wachiman-ledger" }]`); the ledger's internal routes for the panel are not reachable
   from the public URL (they are served only on the binding's `fetch`, checked by a header the
   binding sets, or exposed as RPC methods).
3. **App-mode repositories link themselves.** `installation.created` and
   `installation_repositories.added` insert the installation and its repositories with
   `link_source: app`; `removed` and `installation.deleted` clear the link. If the installing
   user is a member of exactly one account, the repositories go there; otherwise they are
   *pending* until an admin assigns them in the panel, and `reserve` refuses them as
   `not_linked` meanwhile. Every delivery is verified with the webhook secret first.
4. **Direct-mode repositories link with a one-time code.** An account admin mints a code in the
   panel (24 hours, single use, bound to that account). The repository presents it on its first
   run; the ledger links the OIDC-verified `repository_id`, burns the code, and the run proceeds.
   The App's user access token cannot prove admin rights on a repository where the App is not
   installed (the token's repository access is the intersection of the App's and the user's), so
   the repository's own proven run is the proof instead.
5. **Sign-in is the App's user authorization.** The panel runs the web application flow and
   keeps the user token server-side; it sends the GitHub user id to the ledger, which answers with
   the accounts of that user's memberships. A user with no membership gets an account of their
   own on first sign-in. Roles: admin (link, unlink, limits, mint codes, add members) and member
   (read).
6. **Unlinking never deletes history.** As ADR 0022 decision 4: a removed repository's rows in
   the Durable Object stay; the D1 row loses its account.

## Alternatives rejected

- **Keep the secret and redeploy on every change.** A webhook cannot write a secret; the owner
  would relink by hand after every installation, which is the manual work the App exists to
  remove.
- **A registry Durable Object for the table.** Writable at runtime and no new service, but it
  is the "one global object for everyone" ADR 0022 rejected: one serialized queue and one
  storage limit for every customer's links, and relational questions (which accounts does this
  user administer; which repositories carry this tag across accounts) become hand-written
  indexes in one object. D1 answers them with SQL and has migrations.
- **The panel binds D1 or the Durable Object directly** (`script_name`). Two Workers would own
  the same rows; every rule about linking would have to exist twice.
- **Admin check through the user access token for direct-mode repositories** (the brief's first
  proposal). Preferred when it works; rejected as the only path because the token does not reach
  repositories without the installation. Open question 4 of the spec keeps the door open.
- **A link token in the caller's yml permanently.** ADR 0022 rejected a UUID in the yml because a
  leak lets anyone join; the code here is single-use, expires, and is burned by the first
  OIDC-proven run.
- **Owner-based auto-assignment** (installation on `niway-dev` goes to a `niway-dev` account).
  ADR 0022 rejected owner-only grouping; the owner's own case spans two GitHub owners.

## Consequences

- #129's branch needs a follow-up: `ledger/wrangler.jsonc` gains a `d1_databases` binding, the
  `accounts.ts` reader becomes a query module, a migration folder and an import script appear,
  and the Status lines of ADR 0021 and ADR 0022 gain one sentence pointing here. The existing
  route tests must pass unchanged against D1.
- The ledger gains routes: `POST /v1/app/webhook` (public, signature-verified),
  `POST /v1/app/token` (ADR 0024), and the panel-only routes over the binding.
- `reserve` accepts an optional `link_code`; the engine gains the caller input
  `ledger_link_code`.
- The panel gains login code for the first time (sessions, `state`, token storage); its
  privacy page must say what it stores (user id, login, session).
- D1 is one more Cloudflare product in the deploy; its free tier covers this volume by orders of
  magnitude (unverified figure; see the D1 docs in the spec's sources).

## Non-goals

- Roles beyond admin and member, SSO, audit logs, bulk linking.
- Limits per tag (ADR 0022 stands).
- Any data about review content in D1.

## Reopen if

- A probe shows the App's user access token can report `permissions.admin` on a repository
  without the installation: make the admin check the first path for direct mode and keep the
  code for automation.
- The panel needs a second data owner (for example, a notifications service): design a proper
  internal API with a version then.
- D1 latency on the `reserve` path exceeds 100 ms at p95 over a week: cache the repository →
  account map in the Worker with a short TTL, invalidated by the webhook.
- A second ledger operator appears (ADR 0021's reopen): the schema needs a version and a
  migration contract.
