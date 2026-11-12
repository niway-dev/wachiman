# One record of spend, a daily and weekly limit, and one dashboard

- **Status:** draft 2026-11-12. Nothing here is implemented. The decisions are proposals until the
  owner answers the open questions; no ADR file is written yet.
- **Date:** 2026-11-12
- **Refs:** #122 (daily spend limit), #129 (its implementation, open, conflicting), #124 (its
  design, draft), #189 (local index and `wachiman dashboard`, merged), #199 (subscription token,
  merged)
- **Creates:** one new ADR and an amendment of ADR 0021 (see "ADRs" below). Numbers are assigned
  when the two files numbered 0037 on `main` are resolved.

## Summary (one minute)

Wachiman already prints what every run costs: one `wachiman-cost` JSON line per model call, with
tokens, turns, duration, dollars and, since #199, which credential paid. Nothing keeps those lines.
GitHub Actions logs expire, the laptop's history holds laptop runs only, and no limit spans more
than one pull request. The 2026-11-12 spend audit had to be rebuilt by hand from logs.

This design keeps the lines. The ledger service of #129 (a small Cloudflare Worker the owner
deploys) stops being only a counter for a daily limit: it becomes the record of every Actions run
of one account, and it enforces a maximum per day, per week, or both. The laptop downloads that
record and `wachiman dashboard`, which exists, shows laptop runs and Actions runs on one page.
Everything is optional: a consumer that configures no ledger gets no request, no record and no
limit, exactly as today.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | The ledger stores one entry per Actions run with the fields of its `wachiman-cost` lines: repository, pull request, trigger, model, turns, tokens, duration, dollars, `auth` | The run already tells the ledger what it spent (`settle`). One place then answers "how much, where, on what" and "may this run start". Logs expire and review comments miss runs that post nothing | amends 0021 |
| 2 | A limit per day, per week, or both, per account. Day and week are calendar periods in UTC, the week starting Monday. An empty value means no limit for that period | The owner asked for a daily or weekly maximum; ADR 0021 has one daily limit | amends 0021 |
| 3 | No ledger configured means no ledger call, no record and no limit. No new required input, permission or secret for a consumer that leaves it empty | "Users may leave everything empty." The first user is the owner | new |
| 4 | The laptop only reads. `wachiman dashboard` downloads the account's entries into day files under `~/.wachiman/ledger/` and the SQLite index is rebuilt from them. Laptop runs are never sent anywhere | Keeps ADR 0019 decision 5 (no telemetry in local mode) and ADR 0035 decision 2 (the index holds nothing that cannot be rebuilt from files) | new |
| 5 | One dashboard: the existing local page gains the source of each run (Actions or laptop), the credential, a per-week view, tables per pull request and per model, and the limit drawn on the spend chart | The page and its per-day and per-repository charts exist (#189); the missing part is the Actions data | new |
| 6 | The unit is dollars. On a subscription they are API-price estimates, shown as such and counted by the limit like any other dollar | Dollars are the only figure a run reports. Plan usage is not visible to the engine | reuses the subscription ADR (0037) |
| 7 | Each owner runs their own ledger. The Wachiman project hosts nothing for other users | Keeps "no hosted service" true for everyone who does not opt in | reuses 0021 |
| 8 | Laptop runs are shown on the dashboard and are not counted against the limit | A laptop has no GitHub identity token, so it cannot reserve in the ledger as #129 designs it | new |
| 9 | #129 is not rebased as one piece. Its ledger and engine code are re-landed on current `main` in three slices: the ledger with the record, the engine's reserve and settle with the limit, the laptop download with the dashboard | 4,076 lines, conflicts in 13 files, written before #194, #199 and #201 changed the same engine paths | none |

## Open questions

Each has the default this draft uses if it is not answered.

1. **Is "the app" the local page or a web page?** Default: the local page written by
   `wachiman dashboard`; the Worker serves JSON only. A page served by the Worker would be a
   hosted dashboard, which ADR 0035 rejected.
2. **Which week?** Default: the calendar week in UTC, Monday to Sunday. The alternative is a
   rolling seven days, which never "resets" on a known day.
3. **The numbers.** Default: $10 per day (the owner's figure of 2026-11-12), no weekly limit until
   one is named.
4. **What the "old measurement" to retire is.** Default: only the ad-hoc script that sums
   `wachiman-cost` lines from Actions logs. The $6 ceiling per pull request, read from review
   footers, stays: it bounds one pull request and needs no ledger.
5. **Ledger unreachable.** Default: the review runs, the job summary says the run was not counted,
   and nothing fails. The alternative, refusing to review, turns a ledger outage into a review
   outage.
6. **How the laptop proves it may read.** Default: a read-only token per account, set as a Worker
   secret and stored in the laptop's Wachiman profile. It can read spend figures and nothing else.
7. **Should laptop runs count against the limit?** Default: no (decision 8). Counting them needs
   either a write path from the laptop, which contradicts ADR 0019 decision 5, or a local check
   that two terminals can race.
8. **One entry per run or per model call?** Default: one entry per run, carrying the list of its
   calls. A run has one to a few dozen calls.
9. **How long the ledger keeps entries.** Default: 90 days, as in #129. The laptop's copy is not
   pruned, so the dashboard keeps history as long as the laptop downloads at least once in 90 days.

## Out of scope

- A hosted dashboard, and any ledger run by the Wachiman project for other users.
- Measuring the usage limit of a Claude subscription. Only estimated dollars are known.
- A monthly limit (ADR 0021 non-goal) and per-organisation wallets (ADR 0022, designed, not built).
- Cost per correct finding (the 2026-10-31 usage spec, decision 4). It needs verdicts joined to
  spend and is a separate design.
- Sending laptop history to the ledger.
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

Observed: spend was not bounded across pull requests. The audit of 2026-11-12 found $170.41 for
2026-11-01 to 2026-11-12 from the Actions logs of the consumer repositories; that analysis lives
in the owner's working notes and is not published in this repository.

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
