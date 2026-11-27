# ADR 0065: Usage metrics are sent only after opt-in, and never carry an account identifier

- **Status:** accepted 2026-11-26, implemented in the release that adds `wachiman telemetry` (the CLI side:
  `src/telemetry/`, the `init` question and `wachiman telemetry`; the HTTP contract is
  [telemetry-api.md](../telemetry-api.md)). It amends decision 5 of
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md) and the
  statements of it that [ADR 0039](0039-the-laptop-reads-the-ledger-and-one-report-covers-laptop-and-actions-runs.md)
  and [ADR 0042](0042-what-a-run-may-read-depends-on-where-its-output-goes.md) rely on, and it
  supersedes in part the "no hosted service" non-goal of
  [ADR 0001](0001-distribution-and-trust.md), for the usage receiver only. The
  [optional usage telemetry spec](../specs/2026-11-24-optional-usage-telemetry-design.md) is the design it follows.
- **Date:** 2026-11-25

## Context

The [usage dashboard spec](../specs/2026-10-31-usage-dashboard-design.md) rejected an upload keyed
by a generated ID, because a stable ID is a pseudonym and the receiver would be a hosted service,
and left product telemetry to its own ADR. This is that ADR. What changed: the upload is opt-in
rather than the dashboard's data path, it carries counts instead of review data, and the owner
accepts hosting one small receiver. The pseudonym remains, and decision 3 says so.

ADR 0019 decision 5 fixed the promise of local mode as "Wachiman sends no telemetry and makes no
GitHub requests". The same sentence is in the README, the local-review guide, the FAQ and
on-your-machine.md, which also promised that any future usage data would be listed before the
release that adds it, could be turned off, and would not be needed for local review.

Wachiman has no view of how it is used outside the owner's machines: diff sizes, chunk counts,
tokens, failures. Those numbers would steer work on coverage, cost and reliability. Angular CLI
asks once during setup and sends counts only after a yes; other CLIs, such as Next.js, collect by
default with an opt-out. The public argument around them is about what identity is attached, not
about counting.

## Decision

1. **Opt-in only, by two routes.** Interactive `wachiman init` asks once, default No. Without a stored yes, no
   telemetry call is made. The only other route is `wachiman telemetry on`, which asks the same
   question and needs a terminal outside CI. No terminal, CI, or an agent never counts as a yes.
   `DO_NOT_TRACK` set ([donottrack.sh](https://donottrack.sh/)) overrides a stored yes, and `init`
   does not ask while it is set.
2. **No account identifier, ever.** Telemetry never reads for identification, hashes, derives or
   sends an identifier from GitHub, Claude, OpenAI or any other account, nor from email,
   credentials, hostname, machine IDs, repository names, remotes or paths. Credentials used for a
   review do not authorize using that identity for telemetry.
3. **A random installation UUID.** Created on yes, stored in the user's settings, resettable. It
   names an installation, not a person. The data is pseudonymous, and the docs say so; they do not
   promise anonymity.
4. **An allowlisted summary.** One document per review, built field by field from a published
   schema of numbers and bounded categories. Never the SQLite index, history files, code,
   prompts, model output or error text.
5. **The new promise of local mode:** "Wachiman makes no GitHub requests in local mode and sends no
   telemetry unless you opted in (in `wachiman init` or with `wachiman telemetry on`); your code is sent to your configured Claude account
   for the review." It replaces ADR 0019 decision 5's sentence in the same release that first
   sends, and not before.

## Alternatives rejected

- **On by default with an opt-out.** More data, but it breaks the promise already published and
  the trust it bought; the promise said "possible to turn off", and opt-in is the honest reading.
- **Hashed account IDs to count people.** A hash of a known login is recoverable by hashing the
  login; it is an identifier with extra steps.
- **Uploading the local SQLite history.** Simplest to build, but it carries finding text, paths and
  repository keys; nothing guarantees what it holds next release.
- **Manual export only (`wachiman telemetry export`, the user sends a file).** Safe, but almost
  nobody sends it, so it measures nothing.
- **A route on the spend ledger.** Less infrastructure, but the ledger knows accounts; separating
  them is what makes decision 2 checkable.

## Consequences

- The public pages that say "sends no telemetry" change in the release that starts sending.
- A new outbound call site joins the network inventory in on-your-machine.md and its test.
- A hosted receiver must exist, with a published contract, no IP retention and a retention limit.
- Data comes only from people who said yes, a biased sample; it shows usage, not quality.

## Non-goals

- Telemetry from Actions runs (a later decision with its own switch).
- Publishing usage statistics.
- Measuring review quality from finding counts.

## Reopen when

- A question needs a field outside the schema: add it to the schema, the docs and the prompt
  first, and bump the schema version.
- Anyone shows that a summary can be linked back to an account or a repository.
- Telemetry from Actions is wanted.
