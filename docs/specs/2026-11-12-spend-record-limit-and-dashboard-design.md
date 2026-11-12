# One record of spend, a daily and weekly limit, and one dashboard

- **Status:** draft, revised 2026-11-12 after the owner's answers. Nothing here is implemented and
  no ADR file is written yet. The owner widened the direction from "a ledger and a local page" to
  a platform. Three conversations decide what the first draft assumed: #205 (the platform and its
  backend), #206 (the GitHub App), #207 (accounts and login at `wachiman init`).
- **Date:** 2026-11-12
- **Refs:** #122 (daily spend limit), #129 (its implementation, open, conflicting), #124 (its
  design, draft), #134 and #135 (three ways to run: the App, the panel and sign-in, designed
  2026-11-07, open), #189 (local index and `wachiman dashboard`, merged), #199 (subscription
  token, merged), #205, #206, #207
- **Creates:** ADRs are listed when the three conversations close. Numbers are assigned when the
  two files numbered 0037 on `main` are resolved.

## Summary (one minute)

Wachiman already prints what every run costs: one `wachiman-cost` JSON line per model call, with
tokens, turns, duration, dollars and, since #199, which credential paid. Nothing keeps those lines.
GitHub Actions logs expire, the laptop's history holds laptop runs only, and no limit spans more
than one pull request. The 2026-11-12 spend audit had to be rebuilt by hand from logs.

This design keeps the lines in a platform: a transactional service that every enrolled Actions run
asks before it starts and tells what it spent when it ends. The platform is the record and the
limit: a maximum per day and per week for one account. A dashboard with charts reads it, as a web
page and as a local page. Everything is optional: a consumer that configures nothing gets no
request, no record and no limit, exactly as today.

The limit is best-effort, not a hard maximum: the owner chose that a review runs when the platform
cannot be reached, so an outage can end a day above the limit. The design says so wherever the
limit is shown.

| # | Decision | Why | State | ADR |
| --- | --- | --- | --- | --- |
| 1 | The platform is both the record of every enrolled Actions run and the limit | One place answers "how much, where, on what" and "may this run start". The owner chose it on 2026-11-12 and asked for a transactional system that feeds the dashboard | decided by the owner | amends 0021 |
| 2 | One row per model call with the fields of its `wachiman-cost` line, plus one reservation per run with its state: reserved, settled, or never settled | A run can call two models (a reviewer and a verifier), so one row per run cannot draw a chart per model. A killed run has a reservation and no real cost, and must not be drawn as spend | proposed | amends 0021 |
| 3 | A limit per day and per week, per account. Calendar periods in UTC, the week starting Monday. A run belongs to the day and week in which it reserved. Day and week are checked in one transaction. Default $10 per day, customizable; an empty value means no limit for that period | The owner asked for calendar periods and a default of $10 that can be changed. The boundary rule comes from the weak-points attack | decided by the owner; boundary rule proposed | amends 0021 |
| 4 | Platform unreachable: the review runs, the job summary says the run was not reserved, and the dashboard counts those runs apart. An input lets a repository choose to stop instead | The owner's answer of 2026-11-12. It reverses ADR 0021 decision 5 ("fail closed"), written when every dollar was billed; on a subscription an overshoot costs plan usage, not cash | decided by the owner; the input is proposed | amends 0021 |
| 5 | Nothing configured means no call, no record and no limit, and no new required input, permission or secret | "Users may leave everything empty" | decided by the owner | new |
| 6 | The dashboard exists as a web page and as a local page, behind one reporting interface with two implementations. The local page works from the laptop's files with the network off and without a login | The owner asked for both. ADR 0035 decision 2 keeps the laptop's index rebuildable from files | decided by the owner; where the web page lives is open in #205 | new |
| 7 | The unit is dollars. On a subscription they are API-price estimates, shown as such and counted by the limit like any other dollar | Dollars are the only figure a run reports. Plan usage is not visible to the engine | decided by the owner | reuses the subscription ADR (0037) |
| 8 | Laptop runs are shown on the local page. They are not counted against the limit by default; counting them is opt-in | The owner's answer of 2026-11-12. Opting in sends run records from local mode, which ADR 0019 decision 5 forbids today | decided by the owner; the mechanism is open in #207 | amends 0019 |
| 9 | `wachiman init` can log in to the platform. Without an account nothing changes | The owner's answer of 2026-11-12 | open in #207 | new |
| 10 | Only the ad-hoc script that sums `wachiman-cost` lines from Actions logs is retired. The $6 ceiling per pull request, read from review footers, stays | It bounds one pull request and needs no platform | decided by the owner | none |
| 11 | Backend: the Cloudflare pieces already designed (#129, #135) or Convex | The owner proposed Convex for its reactivity; ADR 0021 rejected it for a counter. This draft recommends Cloudflare (see #205) | open in #205 | new |
| 12 | Hosting: each owner deploys their own platform, or one hosted platform serves every user | The first draft said each owner. A web page with sign-in pulls toward one hosted platform | open in #205 | supersedes parts of 0001 either way |
| 13 | The GitHub App: sign-in, repository linking, comment identity, and in which order | Designed in #135 as identity and linking. The platform gives it the backend it needs | open in #206 | ADR 0024 of #135 |
| 14 | #129 is re-landed on current `main` in slices instead of rebased as one piece | 4,076 lines, conflicts in 13 files, written before #194, #199 and #201 changed the same engine paths | proposed; depends on 11 | none |

## Answered by the owner (2026-11-12)

1. Local page or web page: both.
2. Which week: the calendar week, with filters on the dashboard.
3. The numbers: $10 per day by default, customizable.
4. What is retired: only the ad-hoc log-summing script.
5. Platform unreachable: the review runs.
6. Laptop runs against the limit: no, but configurable.
7. Login: `wachiman init` should be able to log in to the platform.

## Open questions

1. **One hosted platform or one per owner?** (#205) It decides which ADRs are superseded and where
   the web page lives.
2. **Cloudflare or Convex?** (#205) Default of this draft: Cloudflare, unless a one-day spike on
   Convex passes real Actions OIDC verification, the two-runs race and the lost-response retry,
   and is less work to finish than re-landing #129.
3. **What is an account?** (#207) One per person holding repositories of any GitHub owner, or one
   per GitHub owner with a limit across accounts. Does the limit follow the account or the
   credential?
4. **Is login a step of `init` or its own command that `init` offers?** (#207)
5. **Which functions of the GitHub App ship, and when?** (#206)
6. **How long entries are kept.** Default: 90 days, as in #129. A calendar view wants longer or an
   export.
7. **Which filters.** Default: repository, pull request, model, trigger, credential, source
   (Actions or laptop) and date range.
8. **Which of the two ADR files numbered 0037 on `main` is renumbered.**

## Already designed before this draft

The first draft did not put these side by side. They are open pull requests, not on `main`:

- #135 (2026-11-07): the GitHub App is "direct mode plus identity and linking", never a hosted
  reviewer (ADR 0024). The account panel lives in the private site repository, already deployed
  on Cloudflare as static pages; D1 holds the account table; sign-in uses the App's user
  authorization; "a user with no membership gets an account of their own on first sign-in"; a
  direct-mode repository links with a single-use code (ADR 0025).
- #129 (2026-11-06): ADR 0021 rejected "Convex or a database behind a Worker" as "more moving
  parts than one Durable Object for a counter and a few thousand rows a month", and rejected
  failing open "by the owner: a missed review is cheaper than an unbounded day". Decisions 4 and
  11 above reopen both.

## Weak points found (2026-11-12)

Two claims were attacked by a model of another provider that saw only the claim and the facts:
"a reserve-and-settle service is enough for a complete record and a maximum", and "Convex is a
suitable backend for this platform". Each weak point was then judged against the repository.

| Weak point | Verdict | Where it went |
| --- | --- | --- |
| A maximum cannot hold if reviews run while the service is down | real | decision 4, the summary, failures below |
| An account is a budget, not a GitHub owner, an actor or a subscription | real | open question 3, #207 |
| One row per run cannot draw a chart per model | real | decision 2 |
| A killed run has a reservation and no real cost | real | decision 2, failures below |
| A run that crosses a week boundary needs a rule | real | decision 3 |
| Replacing the prototype on another backend is a second implementation | real | decision 11, #205 |
| The local page must not depend on the hosted backend | real | decision 6 |
| A login does not say who may attach a company repository | real | #207 |
| The reservation must bound what the run can spend | handled | #129 grants `min(wanted, limits left)` and the engine runs inside the grant; a single call can still overshoot its cap (`docs/costs.md`) |
| A retry or a lost response is counted twice | handled | #129: a retry of the same run replaces its settlement; re-tested when re-landed |
| A valid token is not permission to spend an account | handled | #129: the account is derived from the verified `repository_id`, never from the request |
| Estimated dollars are not plan headroom | handled | decision 7 |
| A consumer that configures nothing is not covered | handled | decision 5: the promise is for enrolled runs only |
| The runner reports its own cost and could under-report | accepted | the limit protects the consumer's own budget |

## Out of scope

- A hosted reviewer. The engine keeps running in the consumer's own Actions with the consumer's
  own credential, whatever #205 and #206 decide.
- Measuring the usage limit of a Claude subscription. Only estimated dollars are known.
- A monthly limit (ADR 0021 non-goal) and per-organisation wallets (ADR 0022, designed, not built).
- Cost per correct finding (the 2026-10-31 usage spec, decision 4). It needs verdicts joined to
  spend and is a separate design.
- Sending laptop history to the platform without an explicit opt-in (decision 8).
- Changing the per-run and per-pull-request budgets.

## Failures this must protect against

These are risks, not observed events, except where a source is linked.

- Two runs that start together both pass under the limit. The check and the reservation must be
  one atomic step in the ledger.
- A cancelled or crashed run leaves a reservation that is never settled, and the day's total is
  wrong in either direction.
- A re-run of the same job is counted twice, or a laptop download stores the same entry twice.
- A consumer that configures no ledger breaks at workflow start because the reusable workflow now
  asks for `id-token: write`. #129's description calls that permission a breaking change for
  every caller; decision 3 forbids it.
- The ledger is down and no pull request is reviewed.
- Code, finding text, a pull request title or a credential reaches the ledger. Only the fields of
  decision 1 may be sent.
- A day or week boundary is computed in different time zones by the engine, the ledger and the
  dashboard.
- The dashboard shows zero for a period it has no data for (ledger entries already deleted, or
  never downloaded) instead of saying so.
- Estimated dollars (subscription) and billed dollars (API key) are added into one figure without
  the split being visible.
- The read token leaks. The damage must be limited to reading spend figures.

Added by the weak-points attacks of 2026-11-12:

- The platform is down, reviews run, and the day ends above the limit without anyone seeing it.
  Runs that were not reserved are counted apart and shown, and no screen calls the limit a hard
  maximum.
- Personal and company repositories are counted in two budgets while one subscription pays for
  both, so each stays under its limit and the total does not.
- A run that calls two models is stored as one row, and the chart per model is wrong.
- A killed run is drawn as spend for the full amount it reserved.
- A run that starts on Sunday at 23:59 UTC and ends on Monday is counted in neither week, or in
  both.
- A workflow in an unrelated repository names another account and spends its balance.
- The local page makes a network request, or asks for a login, to show the laptop's own runs.
- Someone who can log in attaches a company repository to their personal account, or reads a
  company's spend, without authority over it.

Observed: spend was not bounded across pull requests. The audit of 2026-11-12 found $170.41 for
2026-11-01 to 2026-11-12 from the Actions logs of the consumer repositories; that analysis lives
in the owner's working notes and is not published in this repository.

> The sections from here down were written for the first draft (each owner's own ledger, a local
> page only). They are revised when #205, #206 and #207 close. Where they disagree with the
> decisions table above, the table wins.

## Acceptance criteria

- [ ] With no ledger configured, a review run makes no request to any ledger and the caller
      workflow needs no new permission, input or secret (a test of the engine and an `actionlint`
      run of the unchanged caller template).
- [ ] With a ledger and a daily limit, a run that would pass the limit does not call a model and
      posts one notice that names the limit, the amount spent and when the period resets.
- [ ] The same holds for a weekly limit, and with both set the stricter one decides.
- [ ] Two reservations sent at the same time against a limit with room for one: exactly one is
      granted (a test against the ledger).
- [ ] After a run, the ledger holds one entry whose dollars equal the sum of `cost_usd` of that
      run's `wachiman-cost` lines, and whose fields are only those of decision 1.
- [ ] A re-run of the same job attempt does not create a second entry.
- [ ] `wachiman dashboard` after a download shows Actions runs and laptop runs on one page, with
      source and credential, per day and per week, and the limit on the chart.
- [ ] Deleting `~/.wachiman/index.sqlite` and running `wachiman dashboard` again gives the same
      page from the files alone.
- [ ] With the ledger unreachable, the review still posts and the job summary says the run was not
      counted (if open question 5 keeps its default).
- [ ] A period with no downloaded data is shown as "no data", not as $0.

## What exists today

Read on 2026-11-12. The #129 items were read on its branch (`feat/daily-spend-limit`), which has
not been rebased or re-tested for this draft.

| Piece | State | Where |
| --- | --- | --- |
| `wachiman-cost` line: operation, repo, pull request, trigger, model, turns, duration, four token counts, `cost_usd`, `auth` | on `main` | `src/cost.ts` |
| Laptop history: one JSON file per run, opt-in (`--history`), 30 days | on `main` | ADR 0020, `src/history/` |
| SQLite index rebuilt from those files; `wachiman status`; `wachiman dashboard` with inline SVG bars for spend per day and per repository | on `main` (#189) | ADR 0035, `src/store/`, `src/status/` |
| What an Actions run leaves behind | review comments only; the $6 ceiling per pull request is read back from their footers | `src/engine.ts` |
| Ledger Worker: `POST /v1/reserve`, `POST /v1/settle`, `GET /v1/today`, `GET /v1/public-key`; one SQLite-backed Durable Object per account; an `entries` table with day, repository, run, trigger, reserved and settled micro-dollars; GitHub OIDC for every write | open in #129, not on `main` | `ledger/`, `src/ledger.ts` |
| Limit in #129 | one daily limit per account, UTC, with an optional stricter figure per repository | ADR 0021 (proposed, on the branch) |
| Usage line in every review, read back with `gh` | designed 2026-10-31, never built | `docs/specs/2026-10-31-usage-dashboard-design.md` |

The ledger's `entries` table has no model, pull request, tokens or credential. Decision 1 adds
them.

## Options considered

1. **The ledger is the record and the limit (chosen).** One service the owner already designed
   holds both. Against: it is a service to deploy and keep running, it is the first part of
   Wachiman that is not the consumer's GitHub or the developer's laptop, and its absence must cost
   a consumer nothing (decision 3).
2. **GitHub is the record, the ledger only limits.** Every review carries a hidden usage line (the
   2026-10-31 spec) and the laptop reads the lines with `gh`. Against: a run that posts nothing
   (cancelled, refused, a question that fails) leaves no line, reading them means paging through
   the comments of every pull request of every repository, and the limit still needs the ledger,
   so there are two mechanisms where one does both jobs.
3. **No service at all.** Runs append to a file on a dedicated branch or a private repository, the
   pattern of `benchmark-action/github-action-benchmark`, and the limit is a sum of that file.
   Against: nothing on GitHub gives an atomic "check, then add", so concurrent runs overshoot,
   cancelled runs are not counted, and pushes need `contents: write`. ADR 0021 rejected this for
   those reasons and names when to reopen it: "A consumer asks for a daily limit without any
   hosted service: the private-repository ledger becomes an opt-in, documented as racy."

The strongest case against option 1 today: on a subscription a run past the limit costs plan
usage, not money, so the exactness that justified a service matters less than when ADR 0021 was
written. It is still chosen because the record, not the limit, is now the main gain, and option 3
loses the runs that matter most for a record of spend (the cancelled ones).

## ADRs

No ADR file is in this draft. After the owner's answers:

- **New ADR: one dashboard for laptop and Actions runs, fed by files.** Decisions 3, 4, 5 and 8.
  It answers ADR 0035, whose reopen condition is met: "The owner wants one dashboard for laptop
  and GitHub reviews". ADR 0035's non-goals "Sending any figure anywhere" and "Enforcing a spend
  limit" stay true for the laptop: it sends nothing and enforces nothing.
- **ADR 0021 amended before it merges** (it is proposed and exists only in #129): decision 1 of
  that ADR becomes "a limit per day, per week, or both", and the entry gains the fields of
  decision 1 here.

ADRs this touches and how:

- ADR 0001 and ADR 0012 list a hosted service and a server-side spend counter as non-goals. ADR
  0021 already supersedes them for the limit and says ADR 0012's reopen condition is not met; this
  design adds nothing to that argument except that the service is opt-in per consumer.
- ADR 0020 decision 1, "GitHub mode has no path to the store at all", holds: Actions writes to the
  ledger, never to a laptop's store.
- ADR 0019 decision 5, no telemetry and no GitHub requests in local mode, holds for reviews. The
  dashboard's download is a separate, explicit command.
- Two files are numbered 0037 on `main` (the size gate and the subscription token). One has to be
  renumbered before a new ADR takes 0038 or 0039.

## Delivery

Three slices, each a pull request on current `main`, each usable alone:

1. **Ledger with the record.** The Worker from #129 with the wider entry and a read route for an
   account's entries. No engine change.
2. **Engine: reserve, settle, limit.** The engine part of #129 re-landed on the current engine,
   with the weekly period and without a new permission for consumers that set no ledger.
3. **Laptop: download and dashboard.** Day files, the index, the page.

#129 stays open as the source of the code until slice 2 lands, then closes with #124.

## Sources

- Committing metrics to a branch from CI:
  https://github.com/benchmark-action/github-action-benchmark (read 2026-11-12; its page says
  nothing about concurrent runs).
- Artifacts are immutable and kept 90 days by default: https://github.com/actions/upload-artifact
- The Actions cache evicts entries unused for 7 days and cannot change an existing entry:
  https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
- `ccusage`, a local reader of assistant logs that prints tables: https://github.com/ryoppippi/ccusage
- Claude Code's opt-in metrics (`claude_code.cost.usage`), which ship no dashboard:
  https://code.claude.com/docs/en/monitoring-usage
- Budgets with a period and reserve-before-request, which need a database and "fail open" without
  one: https://docs.litellm.ai/docs/proxy/users
- Per-key limits that reset daily, weekly or monthly in UTC: https://openrouter.ai/docs/api-reference/limits
- Console spend limits are monthly and cannot be set on the default workspace:
  https://platform.claude.com/docs/en/api/rate-limits
- Durable Objects storage is transactional and strongly consistent; KV is eventually consistent
  and not suited to read-then-write:
  https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
  and https://developers.cloudflare.com/kv/concepts/how-kv-works/

Not checked: release activity of `github-action-benchmark` and `ccusage`; the usage dashboards of
other review products; whether Claude's account usage page separates a CI token from interactive
use.

Added 2026-11-12 with the revision (read the same day):

- Convex transactions and optimistic concurrency: https://docs.convex.dev/database/advanced/occ
- Convex HTTP actions: https://docs.convex.dev/functions/http-actions
- Convex custom JWT providers: https://docs.convex.dev/auth/advanced/custom-jwt
- Convex pricing and limits: https://www.convex.dev/pricing and
  https://docs.convex.dev/production/state/limits
- Convex self-hosting: https://docs.convex.dev/self-hosting
- Durable Objects pricing and WebSockets:
  https://developers.cloudflare.com/durable-objects/platform/pricing/ and
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- GitHub Actions OIDC claims and `id-token: write`:
  https://docs.github.com/en/actions/reference/security/oidc
- Workflow cancellation kills the process tree:
  https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation
- An OIDC token exchanged for a GitHub App installation token, in production:
  https://raw.githubusercontent.com/anthropics/claude-code-action/main/src/github/token.ts
- GitHub device flow and App user tokens:
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps and
  https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens

Not checked: that Convex's custom JWT configuration accepts a GitHub Actions token end to end;
Marketplace listing requirements; the dashboards of other review products.
