# ADR 0039: The laptop reads the ledger, and one report covers laptop and Actions runs

- **Status:** accepted 2026-11-12. Implemented in `src/ledger-read/`, `src/spend/report.ts` and
  `src/store/` (issue #205). Extends
  [ADR 0035](0035-a-rebuildable-sqlite-index-beside-the-run-files.md) and keeps
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  decision 5 true: local mode sends no telemetry and makes no GitHub request.
- **Date:** 2026-11-12
- **Issue:** #205
- **Depends on:** the spend ledger of #129 (`GET /v1/entries`, ledger API contract v1). Until
  that is merged and deployed, `wachiman ledger pull` has nothing to talk to; everything else works
  without it.

## Context

ADR 0035's reopen condition says: "The owner wants one dashboard for laptop and GitHub reviews."
That condition is met. The laptop's `status` and `dashboard` show only what `local --history` kept;
GitHub Actions runs spend money too, and the ledger records them per run with their model calls and
credential (`auth`: API key billed, or a subscription token whose dollar figure is an estimate).

ADR 0019 decision 5 stands: the laptop sends nothing and contacts no GitHub. Reading from a service
the user connected is not sending, but it must stay explicit and opt-in.

## Decision

1. **Connection.** `wachiman ledger connect <url>` reads a read token from standard input without
   echo and writes `<home>/ledger/credentials.json` (`{url, token}`) at mode 0600.
   `wachiman ledger disconnect` deletes it. `WACHIMAN_LEDGER_URL` and `WACHIMAN_LEDGER_TOKEN`
   override the file. The token is never printed, logged, or written anywhere else, including the
   dashboard page and the index. The URL must be https (http only for loopback).
2. **Download.** `wachiman ledger pull [--since <n>d]` (default 35 days, at most 92) calls
   `GET /v1/entries` and writes one file per UTC day under `<home>/ledger/<account>/<day>.json`,
   replacing a day's file as a whole, so a second pull never stores an entry twice. `pull.json`
   beside them keeps when the pull happened, the ranges of days pulled so far (merged when they
   touch or overlap) and the limits the ledger reported. Day files outside a later, narrower pull
   are kept. A day inside the pulled range for which the ledger returns nothing has its file
   deleted, because a pull replaces the range as a whole; the command prints how many. Stale
   `*.tmp-<pid>` files are removed at the start of a pull. This is the only request the laptop makes to the ledger, made only by that command
   and by `--refresh` on `status` and `dashboard`. Without them no request is made.
3. **Index.** The SQLite index of ADR 0035 gains the ledger's entries and calls, rebuilt from the
   day files like the rest. The index still holds nothing that cannot be rebuilt from files.
   `status` does not read the index: it reads the pulled day files directly, so it still answers
   when the index cannot be written; with no pulled file it behaves exactly as it did.
4. **One report.** A pure module, `src/spend/report.ts` (rows in, report out; no file, network or
   Bun-only API), turns laptop runs and ledger entries into one row shape with
   `source: "laptop" | "actions"` and builds every figure. `wachiman status` and
   `wachiman dashboard` both render from it, so a web page can reuse it later.
5. **Honest figures.** Each figure carries its split by source and by credential; billed and
   estimated dollars are never merged without the split. Spend is the dollars of finished runs.
   Reservations that never settled and runs that were not reserved are reported as their own
   lines, not as spend. A period outside what was downloaded (or before the first laptop run) is
   "no data", never zero. Weeks start on Monday, UTC.

## Alternatives rejected

- **The laptop sending its runs to the ledger.** It contradicts ADR 0019 decision 5. It may come
  back as an explicit opt-in, designed separately; this ADR does not prepare it.
- **The dashboard calling the ledger live.** It breaks the offline page (no request, no script) and
  makes the page depend on a network and a token at open time.
- **A second store for ledger data.** The day files are the record and the index is rebuilt from
  them, exactly as for run files; a second store would be a second thing to corrupt.

## Consequences

- ADR 0035 decision 3 ("no command that exists today depends on the index") still holds: `status`
  reads the day files and only `dashboard` reads the index. The index schema version is 3: an older
  index is rebuilt.
- The read token sits in a 0600 file under the home, like other local state. Anyone who can read
  the home can read the ledger's entries; the token can call only `GET /v1/entries`.
- The limit lines of `status` and the limit line of the dashboard are the whole account's figure,
  computed from every pulled ledger row whatever the filters say; they count Actions runs only.
- Only the account pulled last is read; directories of earlier accounts stay on disk and are ignored,
  so a figure never adds two accounts or compares them with one account's limit.
- The same repository can appear under different identities in the two sources (a ledger
  `owner/name` against a local clone's key); unifying them is left to the owner and is not decided here.
- A laptop that never connects a ledger sees no change, apart from one line on the page saying how
  to connect.
- The laptop's figure and Actions' figure are different kinds of data: a local run's dollars are an
  API-equivalent estimate; Actions runs on an API key are billed. The split stays visible.

## Non-goals

- Counting laptop runs against the ledger limit. The limit is best-effort and Actions-only.
- A hosted page. ADR 0001 still excludes a hosted service.
- Sending any figure from the laptop anywhere.

## Reopen if

- A login to the platform replaces the read token.
- The ledger API contract changes `GET /v1/entries` incompatibly.
