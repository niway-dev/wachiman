# ADR 0036: A partial review records the files it did not reach, so the next push resumes

- **Status:** proposed 2026-11-12. Implemented by the pull request that adds this line
  (`fix/resume-after-partial-review`, NIW2-726). Builds on
  [ADR 0011](0011-review-every-push-incrementally.md) (review every push incrementally) and
  [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md) (the per-pull-request ceiling).
  It changes what ADR 0011 says about a partial review: it no longer leaves the marker where it was.
- **Date:** 2026-11-12

## Context

ADR 0011 records the last reviewed commit in a marker, and only a complete, unscoped review writes
it. A partial review (the budget ran out, or a model left files out) wrote no marker. The next push
found none, ran the whole review again from batch 1, stopped at the same place, and the files at
the end of the queue were never reviewed.

It happened on a private consumer repository, pull request 591: 6,977 changed lines, v1.11.0,
`budget_usd` 3, `auto_budget_usd` 6.

| Run | Trigger | Batches | Result | Cost |
| --- | --- | --- | --- | --- |
| 1 | opened | 1 to 6 finished, 7 of 8 stopped at its budget | Partial, 77 of 102 files | $3.10 |
| 2 | synchronize, 23 minutes later | 1 to 5 finished, 6 of 8 stopped at its budget | Partial, 75 of 104 files | $2.99 |

The pull request then reached its $6 ceiling. About 25 files were never read, and the second run
paid again for files the first one had already reviewed.

## Decision

1. **A partial, unscoped review writes a second kind of marker** in the place of the plain one:
   `<!-- wachi:partial sha=<head> state=<base64url> -->`. It holds the reviewed head, the files not
   reviewed (`rest`) and the subset of those already sent to a model once (`tried`). The state is
   base64url JSON, so any GitHub file name round-trips and nothing in it can close the comment. Like
   the plain marker it is read only from the engine's signed footer. A scoped review writes neither
   marker. A complete review's body is unchanged.
2. **The next unscoped run resumes.** It reviews what changed since the recorded head, as before,
   and the files in `rest` that are still in the pull request. Each file is reviewed once: an unread
   file gets its whole diff against the base, even when it also changed, and the prompt says which
   files are carried and why. The early exits ("Already reviewed", "Rebased, no new changes",
   "Brought up to date") do not fire while carried files remain. A carried file that left the pull
   request or is excluded now is dropped silently. Exclusions, the binary split, the ceiling and the
   budgets apply as before.
3. **What the run writes.** If everything was reviewed, the plain marker, and a headline that names
   the commits since and "the N files the previous review did not reach". If not, a new partial
   marker at the new head whose `rest` is this run's not-reviewed files.
4. **A bounded retry.** A file the run never reached (reason `not reached: …`, written for a batch
   skipped for budget, a call that stopped on its budget, or a provider rejection) stays in `rest`
   with no limit other than the ceiling: no model has seen it. A file that was sent to a model and
   came back not reviewed goes to `rest` and `tried`. If a `tried` file comes back not reviewed a
   second time it leaves `rest` for good, and the review names it "Not reviewed after two tries" with
   the `review <paths>` hint.
5. **The marker survives the fitting of the body** to `MAX_BODY_CHARS`, because the footer is never
   cut.
6. **A size limit.** The partial marker is at most 10,000 characters (about 110 files of 65
   characters, a sixth of the body limit). Beyond that the review writes no marker, logs a warning,
   and the next push reviews the whole pull request again, which is today's behaviour.
7. **Readers.** `lastReviewState` returns `{sha, rest, tried}` (a plain marker gives empty lists).
   `lastReviewedSha` still returns the sha, so a caller that only needs the commit (the thread-only
   run, which acts only on a reviewed head) works with either marker. The ceiling reads the cost
   line of a partial review as it does for any signed review.

`ReviewInput.since` gains an optional `carried` list. That is additive inside format version 1 and 2
and documented in the schemas.

## Alternatives rejected

- **Write the plain marker on a partial review.** It is cheap, and the next push would review only
  what changed. But the files the first review did not reach are then never reviewed unless they
  happen to change, which silently turns "partial" into "done". This is the worst outcome for a
  reviewer.
- **Keep today's behaviour.** Every push after a partial review pays again for the files already
  read and stops at the same budget, as on pull request 591, until the ceiling ends it.
- **Store the list outside the review** (a PR comment, a label, a check run). It needs another
  permission, another reader, and another thing to keep in sync with the review that explains it.

## Consequences

- A pull request too big for one `budget_usd` is finished over several pushes, each paying only for
  what is left, within `auto_budget_usd`.
- A push after a partial review always costs at least the carried files, even when it changes no
  file. That is intended: those files were never reviewed.
- A file renamed after it was left unread appears under its new name and is reviewed as a changed
  file with the diff since, not with its whole diff.
- PR Confidence is not graded for a resumed run (not changed by this ADR).
- A pull request with more than about 110 unread files falls back to a full review on the next push.

## Non-goals

- Local mode, the verifier, the CLI surface, new workflow inputs, or any change to a budget default.
- Reviewing a file that failed twice. The operator asks for it by path.
- Moving the marker on a scoped review.

## Reopen when

The 10,000 character limit is hit on a real pull request (the warning is in the log), or more than
a few percent of resumed runs end with a file "Not reviewed after two tries", which would mean the
retry rule is wrong.
