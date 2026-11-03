# ADR 0011: Review every push, incrementally, and charge nothing for a rebase

- **Status:** proposed 2026-11-01. The implementation is the pull request that adds this file
  (`rebaseDelta` in `src/engine.ts`, the `synchronize` trigger in both caller templates and the
  `review_on_push` input of `.github/workflows/review.yml`). It has not run in a real workflow yet.
- **Date:** 2026-11-01
- **Issue:** [#43](https://github.com/niway-dev/wachiman/issues/43), the "stop re-reviewing pull
  requests that were only rebased" requirement. The rest of #43 (memory files, thread follow-up)
  is not decided here.

## Context

The caller workflows listened to `pull_request` of type `opened` and `ready_for_review` only, so a
pull request got one automatic review and every later push was unreviewed unless the owner
remembered to comment `/wachi review`.

The benchmark shows what that costs. On kaipu-record #463 the author pushed fixes after the first
review. Pullfrog's re-review of those commits found a High bug (a queued camera-on reopens the
camera after a newer off) that is still open on `main`. Wachiman never ran again on that pull
request ([benchmark](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-10-31/README.md)). Pullfrog and CodeRabbit both re-review on
push, so a reader comparing the tools sees the gap.

The engine already reviews incrementally. `review()` reads the last reviewed commit from the signed
footer marker, asks GitHub's compare API for the files changed since, and when the status is
`ahead` reviews only those. For every other status (`diverged`, `behind`) it fell back to a full
review. That fallback is what a rebase or a stacked pull request's rebase hits: the old commit is
no longer an ancestor of the head, although the pull request's own change is the same. Reviewing
every push would have made each rebase pay for the whole pull request again.

## Decision

1. **Every push is reviewed, and only the new commits.** Both caller templates add `synchronize` to
   the `pull_request` types. The reusable workflow keeps its `review` job: the conditions on draft,
   fork, Dependabot and `skip_branch_prefixes` hold for every `pull_request` action, and the job's
   concurrency group per pull request with `cancel-in-progress: true` already makes a burst of
   pushes run once. The trigger lives in the caller, so an existing caller must add `synchronize`
   itself; bumping the pinned release does not.
2. **A rebase with no change in content posts nothing of substance and spends nothing.** When the
   compare status is not `ahead`, the engine compares the pull request's change at the last
   reviewed commit (`base...last`) with its change at the head, per file, by the rows that add or
   remove a line (a patch-id over a diff without context, computed from the patches GitHub sends)
   or by an identical blob. If every file is the same, it logs the reason, calls no model and posts
   a one-line signed review, "Rebased onto `…`, no new changes since `…`", because the marker is the
   only incremental state and has to move to the new head. If some files differ, only those (and
   new files, and files with no patch and no matching blob) are reviewed. If the old change cannot
   be read (GitHub no longer has the commit, or it lists 300 or more files, GitHub's cap), the whole
   pull request is reviewed.
3. **A re-review says so.** The first line reads `👮 **Wachiman** · review of the changes since
   <last>, at <head>`, with "(after a rebase)" when the files were chosen by the content
   comparison. The prompt tells the model the same.
4. **The opt-out is an input.** `review_on_push` (default `true`) lets a consumer on the reusable
   workflow keep the trigger and skip push runs. Removing `synchronize` from the caller does the
   same. The template and `docs/costs.md` state that each push can spend up to `budget_usd`.

The comparison runs on GitHub's API through the injected `gh`, not on a git checkout. The job
checks the head out with `fetch-depth: 1` and no credentials, so `git patch-id` would need the
base and the old head fetched with a token, and would not be testable without a repository.

## Alternatives rejected

- **Only `/wachi review` by hand.** The owner forgets, and #463 is the case: the bug was in the
  fix commits and nobody asked.
- **Review every push in full.** It pays again for code already reviewed, and a rebase would cost
  as much as the first review.
- **Debounce the push in Actions.** Actions has no debounce. A concurrency group with
  `cancel-in-progress` is the available tool, and it already existed.
- **Compare the diffs byte for byte.** A rebase moves the context rows and line numbers, so the
  same change would look different. Hashing only the added and removed rows ignores that.
- **Skip the marker review after a rebase.** The marker would stay on the old commit and the next
  push would fall into the same comparison again, against a commit that may be gone by then.

## Consequences

- The cost of a pull request grows with its pushes: each one is a review with its own
  `budget_usd`, even when small. A rebase with no change costs one runner job and one line on the
  pull request.
- A rebase onto a base that changes what the unchanged lines mean (a renamed function the pull
  request calls) is not reviewed again. The old review cannot see it either.
- A merge of the base branch into the pull request is a push on top whose compare lists the base's
  files. Only files in the pull request's own change (its diff against the merge base) are
  candidates, and of those only the ones whose change differs from the reviewed one are reviewed;
  a merge that brings nothing of the pull request's own posts a one-line marker, like a rebase.
  Amended 2026-11-02, see below: of a candidate file, only the rows the author wrote are sent.
- A cancelled run (a newer push) posts nothing; what it had spent is not verified.
- Callers on an old pin do not get push reviews until they edit their trigger; a copied install
  must edit its copy by hand ([upgrading.md](../upgrading.md)).

## Amendment 2026-11-02: a merge sends only the author's rows

The field run on kaipu-record ([report](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02-field/README.md#the-review-loop))
showed the file-level filter above is not enough. On #479 (`413ee15`), #482 (`ad0fa5c`) and #483
(`0253fd7`), each a merge of a parent branch or of `main`, the files the engine chose were right
(8, 2 and 1 of 28, 33 and 33): the author had changed them while resolving the merge. But the
patch it sent for each was compare's `last...head`, which also carries every line the merged
branch added to that file. The model reviewed part 1b's relocate code as if the author had written
it and posted findings on it, and GitHub refused those inline comments because the lines are not in
the pull request's diff. Replayed on the same commits, the sent patches shrink from 52, 27 and 6 KB
to 24, 7 and 0.8 KB, and what is left is the author's merge resolution.

Decision: in the `ahead` case, `ownChangeSince` keeps from compare's patch only the rows the author
wrote. An added row is the author's when the pull request's patch adds the same head line; a
removed row when the pull request at `last` had added that line, or the pull request now removes the
same text. Other added rows become context, other removed rows are dropped, context is cut to three
rows around the author's. A merge whose candidate files keep no row of the author's posts the
marker and calls no model, like the merge that touches none of them. A push without a merge is sent
unchanged: see the amendment of 2026-11-03 below for how that is decided and for restored lines.

Rejected: sending the file's whole diff against the base, as the rebased path does. It holds no
base code, but it would make every ordinary push pay for the file's entire change again (a two-line
fix in a new 500-line file would send 500 lines). Still open, for the owner: sending only the delta
on the rebased path too (see the pull request that adds this amendment).

Status: unit and fake-`gh` tests, and a replay of `ownChangeSince` on the field run's commits. It has
not run in a real workflow yet. The rest of this ADR has run since 2026-11-01 (v1.4.0 on
kaipu-record).

## Amendment 2026-11-03: narrowing fails open

An independent review of the amendment above found two ways it could send nothing, or too little,
for rows the author did write. Both are fixed, and the rule behind them is now explicit: when the
engine is unsure who owns a row, it sends the row. It never turns doubt into an empty set that
skips the model.

- **Restored lines.** The reviewed change deleted `guard()` and added `extra()`; the next push put
  `guard()` back. It equals the base again, so the pull request's patch shows it as context and
  `ownChangeSince` called it the merged branch's, dropped the file and posted "Brought up to date"
  without calling the model. An added row is now also the author's when the change at the last
  review deleted a line with that text: putting it back is the author's change.
- **Renames.** The change at the last review is indexed by file name. A push that renamed the file
  found nothing under the new name, so ownership was unknown-as-"not changed" and the author's
  removal of their own earlier line was discarded. `previous_filename` from compare now resolves the
  reviewed patch; when a rename cannot be matched to exactly one reviewed file, ownership is
  unknown and every removed row is sent.
- **"A push without a merge is sent unchanged"** was a claim about the helper's typical output, not
  something it checked. The engine now reads the commits that compare lists: when all of them are
  listed and none has two parents, nothing came from a merged branch and the candidate files are
  sent in full, without narrowing. When the list is missing or cut short (compare lists at most 250
  commits), a merge may be among them, and the file is narrowed with the rules above.

- **Unknown history.** Whenever the change at the last review is not known (the comparison failed,
  its file list reached the 300-file cap, or a file's patch is missing), no row can be told from
  the merged branch's, and a restored line looks like the base's. The candidate file's current
  patch is sent as it is, with no narrowing.

Narrowing still posts the "Brought up to date" marker when every candidate keeps no row of the
author's, but only for a push that has a merge commit or whose commits cannot be read.

## Non-goals

- Thread follow-up and learned memory, still in #43 (see [ADR 0008](0008-thread-follow-up-authority.md)
  and [ADR 0007](0007-learned-memory-by-draft-pr.md)).
- The strict verdict parser, #42.
- Any dollar saving other than skipping an unchanged rebase and reviewing only what is new.

## Reopen if

- The measured cost per pull request on kaipu-record doubles after this lands, without new valid
  findings on the later commits. Then reconsider the default of `review_on_push`, or review a push
  only when it changes more than a threshold of lines.
- The content comparison skips a file that should have been reviewed (a rebase that changed
  behaviour), in a case the benchmark or real use shows.
