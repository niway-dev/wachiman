# One record of spend, a daily and weekly limit, and one dashboard

- **Status:** draft, revised twice on 2026-11-12 after the owner's answers. The backend and the
  hosting model are decided (decisions 11 and 12), and three pull requests are being built from
  them (see Delivery). Nothing is merged, and the ADR files of this design are not written yet.
  Still open here: where the code lives, temporary memory, retention and filters. #206 (the
  GitHub App) and #207 (accounts and login at `wachiman init`) decide the rest.
- **Date:** 2026-11-12
- **Refs:** #122 (daily spend limit), #129 (its implementation, open, conflicting), #124 (its
  design, draft), #134 and #135 (three ways to run: the App, the panel and sign-in, designed
  2026-11-07, open), #189 (local index and `wachiman dashboard`, merged), #199 (subscription
  token, merged), #205, #206, #207
- **Creates:** ADR 0040 (one hosted platform that anyone can also deploy) and ADR 0041 (where the
  code lives), written when this design is approved. ADR 0039 belongs to the laptop unit of the
  build, and 0038 is left for whichever of the two files numbered 0037 on `main` is renumbered.

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

There is one platform for every user, on Cloudflare, operated by the project. It holds figures
only: repository and run identity, tokens and dollars, never anything about the code under
review. Anyone can also deploy the same ledger for themselves.

The limit is best-effort, not a hard maximum: the owner chose that a review runs when the platform
cannot be reached, so an outage can end a day above the limit. The design says so wherever the
limit is shown.

| # | Decision | Why | State | ADR |
| --- | --- | --- | --- | --- |
| 1 | The platform is both the record of every enrolled Actions run and the limit | One place answers "how much, where, on what" and "may this run start". The owner chose it on 2026-11-12 and asked for a transactional system that feeds the dashboard | decided by the owner | amends 0021 |
| 2 | One row per model call with the fields of its `wachiman-cost` line, plus one reservation per run with its state: reserved, settled, or never settled | A run can call two models (a reviewer and a verifier), so one row per run cannot draw a chart per model. A killed run has a reservation and no real cost, and must not be drawn as spend | proposed | amends 0021 |
| 3 | A limit per day and per week, per account. Calendar periods in UTC, the week starting Monday. A run belongs to the day and week in which it reserved. Day and week are checked in one transaction. Default $10 per day, customizable; an empty value means no limit for that period | The owner asked for calendar periods and a default of $10 that can be changed. The boundary rule comes from the weak-points attack | decided by the owner; boundary rule proposed | amends 0021 |
| 4 | Ledger unreachable (a timeout or a server error): the review runs, the job summary says the run was not reserved, and the run sends its cost afterwards with `POST /v1/record` if the ledger answers by then. The dashboard counts those runs apart. An input lets a repository choose to stop instead | The owner's answer of 2026-11-12, confirmed the same day. It reverses ADR 0021 decision 5 ("fail closed"), written when every dollar was billed; on a subscription an overshoot costs plan usage, not cash. With one platform for every user, an outage of the platform must not stop other people's reviews | decided by the owner; the input and the timeout are proposed | amends 0021 |
| 5 | Nothing configured means no call, no record and no limit, and no new required input, permission or secret | "Users may leave everything empty" | decided by the owner | 0040 (new) |
| 6 | The dashboard exists as a web page and as a local page, behind one reporting interface with two implementations. The local page works from the laptop's files with the network off and without a login | The owner asked for both. ADR 0035 decision 2 keeps the laptop's index rebuildable from files | decided by the owner; where the web page lives is decision 18 | 0039 (new, laptop unit) |
| 7 | The unit is dollars. On a subscription they are API-price estimates, shown as such and counted by the limit like any other dollar | Dollars are the only figure a run reports. Plan usage is not visible to the engine | decided by the owner | reuses the subscription ADR (0037) |
| 8 | Laptop runs are shown on the local page. They are not counted against the limit by default; counting them is opt-in | The owner's answer of 2026-11-12. Opting in sends run records from local mode, which ADR 0019 decision 5 forbids today | decided by the owner; the mechanism is open in #207 | amends 0019 |
| 9 | `wachiman init` can log in to the platform. Without an account nothing changes | The owner's answer of 2026-11-12 | open in #207 | new |
| 10 | Only the ad-hoc script that sums `wachiman-cost` lines from Actions logs is retired. The $6 ceiling per pull request, read from review footers, stays | It bounds one pull request and needs no platform | decided by the owner | none |
| 11 | Backend: Cloudflare. The ledger Worker of #129, with one SQLite-backed Durable Object per account, is re-landed and extended. Convex is not used | The owner's answer of 2026-11-12: "we will use the ledger we already built". ADR 0021's rejection of "Convex or a database behind a Worker" stands. The reservation code and its tests exist; nobody ran Convex against a real Actions token | decided by the owner | reuses 0021 |
| 12 | Hosting: one hosted platform for every user, operated by the project. Anyone can also deploy the same ledger for themselves | The owner's answer of 2026-11-12: one platform "so it is easy to review", self-hosting for whoever wants it. ADR 0021 and ADR 0025 already assumed one operator; "each owner deploys their own" existed only in the first draft of this spec | decided by the owner | 0040 (new); supersedes the hosted-service non-goals of 0001, 0005, 0013 and 0019 |
| 13 | The GitHub App: sign-in, repository linking, comment identity, and in which order | Designed in #135 as identity and linking. The platform gives it the backend it needs | open in #206 | ADR 0024 of #135 |
| 14 | #129 is re-landed on current `main` as three pull requests built in parallel (see Delivery), not rebased as one piece | 4,076 lines, conflicts in 13 files, written before #194, #199 and #201 changed the same engine paths | decided; in progress | none |
| 15 | An enrolled repository calls the ledger from a second generated workflow, `review-platform.yml`, which carries `id-token: write`. `review.yml` keeps its permissions | #129 added the permission to the one reusable workflow, which its own description calls a breaking change for every caller. Decision 5 forbids that | decided; engine unit | none |
| 16 | The ledger gains `POST /v1/record` (the cost of a run that could not reserve) and `GET /v1/entries` (an account's rows, behind a read token that can do nothing else) | The record must hold the runs the limit never saw. The laptop and the web page must read rows without a credential that can spend | decided; ledger unit | amends 0021 |
| 17 | Durable memory stays in the consumer's repository. The platform is not where lasting knowledge about a codebase lives | The owner's rule of 2026-11-12: as local as possible | decided by the owner | reuses 0006 and 0007 |
| 18 | Where the code lives: which parts of the platform are public in this repository and which are private | See "Where the code lives": two options, side by side | open | 0041 (new) |
| 19 | Temporary review memory across the pull requests of a stack is not built in this platform and gets its own design. The ledger never receives review content. If memory is ever hosted, it is a separate Durable Object class with its own opt-in | "Figures only" is what makes one platform for every user acceptable to a company, and nothing in memory needs a push from the database. See "Temporary memory" | proposed; the owner asked whether to host it | its own spec |
| 20 | Retention: rows stay 13 months on the platform and are then deleted. `GET /v1/entries` is the export. A self-deployed copy sets its own number | A calendar that compares a month with the same month a year earlier needs 13 months; the limit needs one week. See "Retention" | proposed | amends 0021 |
| 21 | Filters: one implementation of charts and filters for both pages, fed with rows for a date range. Every filter is a field of the row; a "special filter" is a saved combination of them | A filter cannot then exist on one page and not on the other. See "Dashboard filters" | proposed | 0039 |

## Answered by the owner (2026-11-12)

1. Local page or web page: both.
2. Which week: the calendar week, with filters on the dashboard.
3. The numbers: $10 per day by default, customizable.
4. What is retired: only the ad-hoc log-summing script.
5. Platform unreachable: the review runs.
6. Laptop runs against the limit: no, but configurable.
7. Login: `wachiman init` should be able to log in to the platform.

Later the same day:

8. Backend: Cloudflare Durable Objects and the ledger already written in #129. Convex is out.
9. Hosting: one platform for every user, which anyone can also deploy for themselves.
10. A hosted service is wanted although several ADRs exclude one. The rule stays "as local as
    possible": durable memory lives in the repository.
11. Ledger unreachable: the review runs (unchanged).

## Open questions

1. **Where does the code live?** (decision 18) Default if unanswered: the money ledger stays
   public in `ledger/`; sign-in, accounts, the GitHub App key and the web panel are private.
2. **Does temporary review memory go on the platform?** (decision 19, see "Temporary memory")
3. **What is an account?** (#207) One per person holding repositories of any GitHub owner, or one
   per GitHub owner with a limit across accounts. Does the limit follow the account or the
   credential?
4. **Is login a step of `init` or its own command that `init` offers?** (#207)
5. **Which functions of the GitHub App ship, and when?** (#206)
6. **How long rows are kept.** (decision 20) Default: 13 months.
7. **What "special filters" means.** (decision 21) Default: saved views that answer the questions
   the 2026-11-12 audit answered by hand.
8. **What a configuration rejection does.** The ledger answers but refuses the run: the permission
   is missing, or the repository is not linked to an account. That is not an outage. Default: the
   review runs, the notice goes in the review comment and not only in the job summary, and the
   ledger keeps the refused attempt so the account's owner can see it.
9. **Which of the two ADR files numbered 0037 on `main` becomes 0038.** Default: the subscription
   token one; fewer files link to it.

## Already designed before this draft

The first draft did not put these side by side. They are open pull requests, not on `main`:

- #135 (2026-11-07): the GitHub App is "direct mode plus identity and linking", never a hosted
  reviewer (ADR 0024). The account panel lives in the private site repository, already deployed
  on Cloudflare as static pages; D1 holds the account table; sign-in uses the App's user
  authorization; "a user with no membership gets an account of their own on first sign-in"; a
  direct-mode repository links with a single-use code (ADR 0025).
- #129 (2026-11-06): ADR 0021 rejected "Convex or a database behind a Worker" as "more moving
  parts than one Durable Object for a counter and a few thousand rows a month", and rejected
  failing open "by the owner: a missed review is cheaper than an unbounded day". Decision 4
  above reverses the second; decision 11 keeps the first.

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
| Replacing the prototype on another backend is a second implementation | real | decision 11: the prototype is kept |
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
- Temporary review memory across pull requests (decision 19). It gets its own design.

## Failures this must protect against

These are risks, not observed events, except where a source is linked.

- Two runs that start together both pass under the limit. The check and the reservation must be
  one atomic step in the ledger.
- A cancelled or crashed run leaves a reservation that is never settled, and the day's total is
  wrong in either direction.
- A re-run of the same job is counted twice, or a laptop download stores the same entry twice.
- A consumer that configures no ledger breaks at workflow start because the reusable workflow now
  asks for `id-token: write`. #129's description calls that permission a breaking change for
  every caller; decision 5 forbids it, and decision 15 is how.
- The ledger is down and no pull request is reviewed.
- Code, finding text, a pull request title or a credential reaches the ledger. Only the fields of
  decision 2 may be sent.
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

## Acceptance criteria

- [ ] With no ledger configured, a review run makes no request to any ledger, and a caller of
      `review.yml` needs no new permission, input or secret (a test of the engine and an
      `actionlint` run of the unchanged caller template).
- [ ] Only `review-platform.yml` asks for `id-token: write`; the permissions of `review.yml` are
      unchanged.
- [ ] With a ledger and a daily limit, a run that would pass the limit does not call a model and
      posts one notice that names the limit, the amount spent and when the period resets.
- [ ] The same holds for a weekly limit, and with both set the stricter one decides.
- [ ] Two reservations sent at the same time against a limit with room for one: exactly one is
      granted (a test against the ledger).
- [ ] After a run, the ledger holds one row per model call whose dollars equal the `cost_usd` of
      that call's `wachiman-cost` line, and whose fields are only those of decision 2.
- [ ] A re-run of the same job attempt does not create a second set of rows.
- [ ] With the ledger unreachable at the start, the review still posts, the job summary says the
      run was not reserved, and when the ledger answers at the end the run's rows arrive through
      `POST /v1/record`, marked as not reserved.
- [ ] A reservation that is never settled is listed as "reserved, never settled" and is not added
      to spend on any chart.
- [ ] A read token can call `GET /v1/entries` for its own account and nothing else: `reserve`,
      `settle` and `record` refuse it, and so do another account's entries.
- [ ] The ledger deploys to an empty Cloudflare account from this repository alone, and a
      repository pointed at that copy reserves and settles against it (holds only if decision 18
      keeps the ledger public).
- [ ] `wachiman dashboard` after `wachiman ledger pull` shows Actions runs and laptop runs on one
      page, with source and credential, per day and per week, and the limit on the chart.
- [ ] Deleting `~/.wachiman/index.sqlite` and running `wachiman dashboard` again gives the same
      page from the files alone, with the network off.
- [ ] A period with no downloaded data is shown as "no data", not as $0.
- [ ] No request to the ledger carries code, a diff, a prompt, finding text or a pull request
      title (a test over every request body the engine can send).

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

The ledger's `entries` table has no model, pull request, tokens or credential. Decision 2 adds
them.

## Options considered

1. **The ledger is the record and the limit (chosen).** One service the owner already designed
   holds both. Against: it is a service to deploy and keep running, it is the first part of
   Wachiman that is not the consumer's GitHub or the developer's laptop, and its absence must cost
   a consumer nothing (decision 5).
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

## Where the code lives (decision 18, open)

The owner's words on 2026-11-12: Wachiman is public, and the private repository holds the backend
"so that it is not public and vulnerable". Two readings follow. Neither is confirmed.

Facts that hold in both:

- No secret and no row is in any repository. The Worker's signing key, the GitHub App's private
  key and the session secret are Cloudflare secrets; accounts and spend rows are in Durable Object
  and D1 storage.
- `ledger/` has been public since 2026-11-06, on the branch of #129 in this repository. Its
  configuration names one variable (`LEDGER_AUDIENCE`) and one Durable Object binding, and no
  secret. Moving it now hides later changes, not what is already published.

| | Option 1: the whole backend is private | Option 2: public ledger, private accounts and panel |
| --- | --- | --- |
| Money ledger: `reserve`, `settle`, `record`, `entries`, the OIDC check, read tokens | private repository | this repository, `ledger/` |
| Accounts table, link codes, sign-in, sessions, the App's key and token exchange, the installation webhook, the web panel | private repository | private repository |
| Deploying your own (decision 12) | not possible without access to the private repository | the ledger, `wachiman ledger connect` and `pull`, and the local page. No web panel and no sign-in; the account table is edited by hand (ADR 0022) |
| Tests of the contract between the engine and the ledger | across two repositories | in one repository |
| What it keeps out of view | later changes to the ledger | the sign-in and session code, where a mistake would show one account's rows to another |
| ADRs | reverses ADR 0021 decision 7 ("Public code, private data") and contradicts decision 12 | keeps ADR 0021 decision 7; amends ADR 0024's "No new server", because the token exchange and the webhook move out of the ledger Worker (for #206 to confirm) |
| Strongest argument against | the owner asked for self-hosting on the same day, and the ledger is already published | two repositories must agree on how the ledger finds a repository's account and on the entries API; a change across both is two pull requests; the hosted platform is the public ledger plus a private part, so it is not exactly what a self-deployed copy runs |

Recommended: option 2, with one rule. The private repository depends on the public one and never
the other way round: the public ledger runs alone with a hand-edited account table, and the
private repository deploys that ledger from a tag and supplies the account table from D1.

A third option, everything public including the panel, is not proposed: the owner asked for the
opposite, and a self-deployed panel would need its own GitHub App to sign anyone in.

## Temporary memory (decision 19, proposed)

The owner's model has two memories. The durable one is a small file in the repository, changed
through a pull request a human merges (ADR 0006 and ADR 0007, neither built). The temporary one
is shared by the pull requests of one feature, ends at merge, and must not grow for ever. On
2026-11-12 the owner asked whether the temporary one could live on the platform, with one worry:
a Durable Object has no reactive queries.

What the repository says today:

- The only state between runs is the signed marker in the engine's own review (ADR 0011 decision
  2, ADR 0036). Nothing detects a stack, and nothing reads another pull request.
- ADR 0006 rejected "a hosted memory store, even a per-tenant Durable Object with client-side
  encryption", because it was a hosted service. Decision 12 removes that reason. It does not
  remove the next one.
- ADR 0021 decision 7: the ledger "never receives review content, diffs, prompts, findings or
  keys". ADR 0025 has the same non-goal for D1. Notes about a pull request are review content.

**Reactivity.** Nothing here needs a push from the database. A run reads at its start and writes
at its end. Two runs that overlap miss each other's notes whatever the store, because each built
its prompt before the other wrote. If a page ever shows memory live, a Durable Object can
broadcast over WebSockets.

**The storage claim was attacked** on 2026-11-12 by a model of another provider that saw only the
claim and the facts. The claim: notes kept in each pull request's signed review marker, read along
the base-branch chain, are enough. Each weak point was then judged against the repository.

| Weak point | Verdict | What follows |
| --- | --- | --- |
| A base-branch chain misses siblings and branches that rejoin | real | A stack is every open pull request connected through base branches other than the default branch. Pull requests of one feature that each target the default branch are linked by nothing GitHub knows: they need a name the author gives, or they are out |
| When a parent merges and the child is retargeted, the child loses the parent | real | Each run writes the pull request numbers of its stack beside its notes, and later runs read from that list. A child that never ran before the retarget is not covered; GitHub's `base_ref_changed` timeline event might recover it (not checked) |
| Overlapping runs, and a stale run that finishes last | handled inside one pull request (`review.yml` cancels the older run of the same pull request); real across pull requests | Notes carry their pull request and commit. A note written during an overlapping run is seen one run later. Stated, not fixed |
| Nothing bounds the notes or the old copies | real | A cap on the encoded notes of one pull request, and each run replaces its notes. Older reviews keep older copies: on GitHub "ends at merge" means nobody reads them again, not that they are erased. The attacker's "10,000-character incident" is wrong: ADR 0036 names that limit as a reopen condition and records no such event |
| A fork's run cannot write | not specific to memory | A run that cannot post a review cannot post notes; it only reads |
| A signed note can carry a poisoned conclusion into another pull request | real | A note is evidence with its source, never policy: it cannot drop a finding, lower a severity or widen an exclude. ADR 0007 sets the same rule for durable memory |

The attack shows the store is not the hard part. Whatever holds the notes, the design has to say
what a feature is, what a note may do, how large it may get and when it ends. A hosted store adds
atomic writes, a membership record that survives retargeting, and real deletion. It does not say
what a feature is.

Where the notes could live:

1. **On GitHub only,** in the review marker, with the rules of the table above. Against: four
   gaps are narrowed and not closed (features not linked by branches, overlapping runs, old
   copies that stay, a child that never ran before its parent merged).
2. **On the platform:** one Durable Object per active feature, with a size cap, read at the start
   of a run, written at the end, and deleted by an alarm some days after its last open pull
   request closes. Against: review content reaches the hosted platform, which reverses the
   promise that makes one platform for every user acceptable to a company. The ledger cannot be
   reused for it, so a separate Durable Object class and a separate opt-in are the minimum.
   Memory then exists for enrolled repositories only, unless option 1 is built as well. The
   platform learns of a merge only from a run on the close event, the App's webhook or a timeout.
3. **Membership on the platform, notes on GitHub.** The spend row gains the number of the stack's
   root pull request, which is a figure and not content. The dashboard gets a filter by stack, and
   membership survives retargeting. Against: one feature is kept in two places.

Proposed: temporary memory is not part of this spec's build. It gets its own issue and spec,
because it needs stack detection and a note format the engine does not have. Storage starts as
option 1 behind a port, so the store can change later. The field of option 3 is added to the spend
row when the engine detects stacks. Option 2 is reopened by an observation, not by preference:
notes that do not fit the cap on a real stack, memory lost after a retarget on a real stack, or a
memory page the owner wants in the panel.

The attack report is a local working document and is not committed.

## Retention (decision 20, proposed)

Rows are small and few: ADR 0021 expects a few thousand per account per month. Storage is not the
constraint. The reasons to delete are that the platform holds other people's figures, and that a
row nobody reads again is only a liability. The limit needs the current week. The dashboard needs
more.

1. **90 days, as in #129.** Against: the web page cannot show a year, and a user who never ran
   `wachiman ledger pull` loses the history.
2. **13 months, one table, one alarm that deletes older rows (proposed).** It is the shortest
   window in which a month can be compared with the same month a year earlier. A self-deployed
   copy sets its own number. Against: the platform holds other people's figures four times longer
   than #129 planned.
3. **90 days of rows, then daily totals for ever.** Against: two tables and a job that rolls rows
   up, and filters by pull request or trigger stop working on totals.

`GET /v1/entries` is the export in every option. What the laptop pulled stays on the laptop under
the rules of the laptop unit (ADR 0039). Deleting an account deletes its Durable Object and every
row in it.

## Dashboard filters (decision 21, proposed)

One implementation of charts and filters, two sources of rows. The reporting interface of
decision 6 is "the rows of one account for a date range": the local page takes them from the
SQLite index, the web page from `GET /v1/entries`. Grouping and filtering run in the page. A month
of rows is a few thousand; a year view asks month by month.

- **Calendar:** day, week and month. The week starts on Monday in UTC, as the limit does. The
  limit is drawn as a line. A click on a day lists its runs.
- **Filters,** each a field of the row: repository, pull request, operation and trigger (the
  values of the `wachiman-cost` line), model, credential (billed or estimated), source (Actions or
  laptop), and state (settled; reserved, never settled; not reserved).
- **Special filters,** read here as saved views, each a named combination of the filters above
  that answers a question the 2026-11-12 audit answered by hand: re-reviews after a push, runs
  that were not reserved, reservations never settled, pull requests by cost, estimated against
  billed. The owner's words were "calendar and special filters"; this reading is an assumption
  (open question 7).

Not in the first version: a filter by stack (the engine does not detect stacks), by author, or by
what happened to the findings (cost per correct finding is out of scope).

## ADRs

Five ADRs exclude a hosted service or part of one. Only one is reopened by its own condition. The
other four are superseded by the owner's decision of 2026-11-12, and ADR 0040 has to say that in
those words instead of claiming a condition was met.

| ADR | What it excludes | The reopen condition that could apply | Met? |
| --- | --- | --- | --- |
| 0001 | Non-goal: "A hosted service, a queue, a Marketplace listing." | None of its five conditions is about a hosted service | No. Superseded in part by ADR 0040 |
| 0005 | Decision 5: "No GitHub App and no backend." | "Someone other than the owner installs the tool and needs comments to show who wrote them" | No. The backend half is superseded by ADR 0040; the App half stays, and #206 decides it |
| 0012 | Non-goal: "A hosted queue or a server-side spend counter." | "Logs show cancelled runs spend more than 20 % of the ceiling on typical pull requests" | Not measured, so no. ADR 0021 already supersedes it for the limit |
| 0019 | Non-goal: "A hosted service, a queue or an account of Wachiman's own (ADR 0001)." | None | No. Superseded in part by ADR 0040. Decision 5 (no telemetry, no GitHub request in local mode) holds: `wachiman ledger pull` is its own explicit command |
| 0035 | Non-goal: "Sending any figure anywhere." Rejected: "A hosted dashboard." | "The owner wants one dashboard for laptop and GitHub reviews" | Yes. ADR 0039 answers it. The laptop still sends nothing |

Also touched:

- ADR 0013 lists "A hosted service run by this project (see ADR 0001)" as a non-goal. ADR 0040
  supersedes that line; the license itself does not change.
- ADR 0006 rejected "a hosted memory store, even a per-tenant Durable Object". Decision 17 keeps
  that for durable memory. Decision 19 is where it could be reopened.
- ADR 0020 decision 1, "GitHub mode has no path to the store at all", holds: Actions writes to the
  ledger, never to a laptop's store.

What is written, and where:

- **ADR 0021, amended in the ledger unit's pull request** (it is proposed and exists only in
  #129): a limit per day, per week or both; one row per model call; decision 5 reversed (decision
  4 here); `POST /v1/record` and `GET /v1/entries`.
- **ADR 0039, in the laptop unit's pull request:** one dashboard for laptop and Actions runs.
- **ADR 0040, from this design once approved:** one hosted platform that anyone can also deploy;
  it holds figures and never review content; nothing configured means no call.
- **ADR 0041, from this design once decision 18 is answered:** where the code lives.

## Delivery

Three units, built in parallel on 2026-11-12, one pull request each against `main`:

| Unit | Branch | What it lands |
| --- | --- | --- |
| Ledger | `feat/ledger-record-and-weekly-limit` | The Worker of #129 re-landed, with one row per model call, a weekly limit, `POST /v1/record` for runs that could not reserve, `GET /v1/entries` behind read tokens, and ADR 0021 amended |
| Engine | `feat/engine-ledger-reserve-settle` | Reserve and settle in the engine, and the generated twin workflow `review-platform.yml` that carries `id-token: write` |
| Laptop | `feat/local-dashboard-ledger-record` | `wachiman ledger connect` and `pull`, the local dashboard reading the ledger's record, and ADR 0039 |

Not in these three: the web page, sign-in and accounts (#206, #207, decision 18), retention
beyond what #129 does (decision 20), and the saved views (decision 21).

#129 stays open as the source of the code until the engine unit lands, then closes with #124.

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

Added 2026-11-12 with the second revision (read the same day):

- A copy each user deploys on their own Cloudflare account, and nothing hosted:
  https://github.com/benvinegar/counterscale
- A hosted service and the same code self-hosted: https://langfuse.com/self-hosting
- The "Deploy to Cloudflare" button provisions Durable Objects and D1 for whoever clicks it, from a
  public repository: https://developers.cloudflare.com/workers/platform/deploy-buttons/
- A limiter that lets requests through when it fails: https://stripe.com/blog/rate-limiters
- A budget proxy that blocks by default when its database is down, with an opt-in to let requests
  through: https://docs.litellm.ai/docs/proxy/prod
- The pull request review API (order and page size of reviews):
  https://docs.github.com/en/rest/pulls/reviews

Not checked: the default of Envoy's `failure_mode_deny`; that GitHub's `base_ref_changed` timeline
event names the previous base of a retargeted pull request; whether any public project verifies
GitHub Actions tokens inside Convex (none was found).
