# ADR 0060: The review state is one versioned block in the signed footer, and `pr-state` derives the next step from it

- **Status:** proposed 2026-11-19. Not implemented. Extends the signed-footer-only
  reading rule of [ADR 0036](0036-a-partial-review-records-the-files-it-did-not-reach-so-the-next-push-resumes.md)
  decision 1 (a marker is read only from the engine's signed footer; the code is `SIGNED_FOOTER`
  and `neutralise` in `src/engine.ts`) to one more marker; reuses the
  advisory posture of [ADR 0034](0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md) and
  the thread authority of [ADR 0008](0008-thread-follow-up-authority.md). Design:
  [pr-state spec](../specs/2026-11-19-pr-state-design.md).
- **Date:** 2026-11-19

## Context

Coding agents now drive pull requests reviewed by Wachiman: they are woken on pull-request events,
fix findings, push and wait for the next review. To decide what to do they must learn whether
Wachiman reviewed the current head, whether that review was complete, partial or refused, and
which findings still wait for the author.

Today that state is spread over HTML comments in review bodies. `wachiman sha=` appears only on
reviews that covered a head; notices (a $0 refusal, the per-pull-request ceiling, a spend limit)
carry their own marker and no sha; `wachi:partial` holds an opaque continuation state; the engine
version is not written at all. The headline "N finding(s)" includes findings that have no thread by
design (info, pre-existing, outside the diff), so it differs from the inline comments on about half
of recent reviews and only prose explains why. Every harness that wants a reliable answer has to
re-implement that reading.

Agents and harnesses do not share an output format, so the reading has to be deterministic and
owned by the party that writes the markers.

## Decision

1. Every review the engine POSTs carries one `<!-- wachi:state <base64url JSON> -->` block, schema
   `wachiman.review-state/1`, inside the signed footer, after the review signature and before the
   attempt footer. Notices carry it too. It is never put on inline comments, replies or issue
   comments.
2. The block holds the engine version, the reviewed head, the attempt id, a `status` (`complete`,
   `partial`, `scoped`, `not-reviewed`), a `reason` when not reviewed, the earlier head a
   base-update line carries over, and finding counts by severity and by placement, built from what
   was actually posted. It never holds finding text. A scoped review never decides the head's state.
3. The block is trusted only under the existing rule of ADR 0036 decision 1: at the end of a body authored by the engine's
   own author and signed as a review. Any `wachi:state` text elsewhere is neutralised like every
   other marker.
4. The block lives beside today's markers for one minor release. The engine's own readers
   (re-review starting point, ceiling sum, limit and refusal notices) move to it only after a test
   shows both encodings give the same results.
5. `wachiman pr-state` is read-only and stores nothing. On every call it reads the pull request's
   head, the own reviews and their blocks, the own finding threads and the "Wachiman review" check
   run, and prints one `wachiman.pr-state/1` object.
6. Its `next` is one of `wait`, `act`, `blocked`, `done`, `closed`, chosen by an ordered rule table
   in code. `done` means only that Wachiman has nothing pending on this head: a complete review
   of it, no unresolved Wachiman finding thread (whoever replied last), and no Blocker or Fix
   finding that the block counts outside a thread. Exit codes: 0 done or
   closed, 20 act, 21 wait, 22 blocked, 1 GitHub error, 2 usage.
7. `pr-state` covers Wachiman's own review only. Other reviewers, CI and merge conflicts are not
   read.
8. `--wait` makes one state read per interval until `next` is not `wait` or a timeout under ten
   minutes passes. It may use `gh event listen` when available, and always re-reads the state
   after an event.

## Alternatives rejected

- **A babysit or listener service in Wachiman.** Harnesses already wake agents, and GitHub ships an
  event stream. A hosted receiver stays out: ADR 0001 names a hosted service as a non-goal, and
  [ADR 0021](0021-a-daily-spend-limit-kept-by-a-ledger-service.md) supersedes that only for the
  optional spend ledger, which never sees the key or the review; a webhook receiver is a different
  thing and nothing accepted allows it. The missing piece is Wachiman's state,
  not the wake.
- **A local database of pull-request rounds.** It duplicates GitHub, goes stale on a push from
  another machine, and cannot be the authority on a thread. ADR 0035 already keeps the local index
  rebuildable and non-authoritative.
- **Reading today's markers without a new block.** Notices have no sha or machine-readable reason,
  partial state is opaque and the engine version is missing, so `blocked`, `wait` and `done` cannot
  be told apart.
- **Putting each finding's text or identity in the block.** It would grow with the review and
  duplicate the threads. Threads are already identified by `wachi:finding` and the own author.
- **`gh event listen` as the only wait.** It is a preview behind a waitlist, drops events during a
  disconnect and does not report what happened before it started.

## Consequences

- The signed-footer pattern grows by one optional line; the forgery tests cover the new marker.
- Each review body grows by a few hundred characters. A cap keeps the counts and never fails a post.
- Consumers get one documented contract (`docs/pr-state.md`) instead of reverse-engineering markers;
  changing the block's fields needs a new schema version.
- Reviews from engines without the block are read from the old markers and labelled
  `legacy-markers`; their notices read as `none`, never as `complete`.
- Agent skills shipped with the product can tell agents to call `pr-state` after a wake instead of
  reading the review.

## Non-goals

- Merging, approving, resolving, replying or editing code.
- Reporting on other reviewers, CI results or mergeability.
- Any hosted component or webhook receiver.
- A local store or cache of pull-request state.
- GitHub Enterprise Server support for `--wait` acceleration.

## Reopen when

- A harness or GitHub itself exposes a stable, structured review-state API that consumers can read
  without Wachiman's help.
- Consumers need CI and conflicts in the same answer often enough that a narrow `done` causes
  mistakes (measured by issues or reports, not assumed).
- The block's size or the extra footer line breaks a review post on a real pull request.
