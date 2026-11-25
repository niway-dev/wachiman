# ADR 0062: A review the run cannot pay for in full is skipped, and the operator approves a budget for one head

- **Status:** proposed 2026-11-21. Amends decisions 3, 4, 5, 6, 7, 8 and 10 and the rejected
  alternative "Ask in the pull request before reviewing" of
  [ADR 0037](0037-a-pull-request-above-the-size-gate-is-not-reviewed.md). Builds on
  [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md) (the per-pull-request ceiling)
  and [ADR 0036](0036-a-partial-review-records-the-files-it-did-not-reach-so-the-next-push-resumes.md)
  (a partial review resumes on the next push).
  Design: [budget gate spec](../specs/2026-11-21-budget-gate-design.md).
- **Date:** 2026-11-21

## Context

ADR 0037 made the size gate never lower than what a run may spend, and kept a partial review for
every estimate between the run budget and the gate (its decision 7). With the defaults
(`budget_usd` $3, `size_gate_usd` $6) a pull request estimated anywhere from $3 to $6 starts a
review it cannot finish.

[Pull request 287](https://github.com/niway-dev/wachiman/pull/287) shows the cost of that rule:
312 files, 16,384 changed lines, 95% from one formatter commit. It was estimated at $5.76, below
the $6 gate, so it started with $3. The
[run](https://github.com/niway-dev/wachiman/actions/runs/44953987894/job/136997919290) spent
$3.15, reviewed 138 of the 312 files, and four of its twelve calls produced nothing. The estimate
was nearly twice the room, so the partial review was close to certain before the first call, and
nobody decided to pay for it.

ADR 0037 rejected asking in the pull request because anyone who can comment could approve
spending the owner's key. That objection is about who approves, not about asking: only the
configured `operator` may start a review from a comment today (`comment` in `src/engine.ts`), and
`/wachiman review --force` already lets that one login spend past a ledger limit.

## Decision

1. **The gate is the room.** Before any model call, the engine compares the estimate with what the
   run may actually spend: `min(budget_usd, room left in auto_budget_usd)` for an automatic run,
   `budget_usd` (or the approved budget, point 3) for the operator's run, and in both cases no more
   than the ledger grants. The room is what the batches get: the verifier and memory-matching
   reserves that `reviewChange` takes out of the total first are subtracted. An estimate above the
   room makes no model call. ADR 0037 decision 8 put the gate before the ceiling; the ceiling now
   comes first. `ceilingRoom` keeps its threshold: with less than $0.05 of the ceiling left, the run
   posts today's "Automatic reviews paused" notice (which already gives the operator's command);
   with more than that but less than the estimate, it posts the priced comment.
2. **One priced comment.** The skip posts or edits the one comment ADR 0037 decision 4 defines.
   It states the estimate, the room, the head it was estimated on, and what lifts it, by which
   term of the room was the smallest:
   - the ceiling, while the batch budget left from `budget_usd` covers the estimate: plain
     `/wachiman review`, because the operator's run is not bounded by the ceiling.
   - the run budget, whether or not the ceiling is also short: the command `/wachiman review --budget <N> --head <short sha>`, with `N` = 1.5
     times the estimate (ADR 0037 decision 5), raised until what the batches get from `N` after the
     reserves is at least that figure, and rounded up to a whole dollar. The command is offered
     only when `N` is at or below `approve_max_usd`; otherwise the comment says to raise
     `approve_max_usd`, or to review part of the pull request with `/wachiman review <paths>`.
   - the ledger grant (known only after the reservation): the run settles $0.00, makes no call,
     and the comment names the grant and `--force`; `--budget` cannot lift a ledger limit, so it is
     not offered. This check is new in `review`; today only thread replies and answers refuse a
     grant that is too small.
3. **The operator approves one head.** `--budget N` is honoured only on the operator's comment,
   only when `--head` names the pull request's current head, and only when `N` is a finite number
   above 0 and at or below `approve_max_usd` (new input, default $20). The run's budget becomes
   `N`, and the gate compares the estimate with `N`. A push after the comment makes the head
   differ, so the run refuses and the next automatic run estimates the new head. A comment from
   anyone else is ignored as every non-operator review request is today. A rerun of the same job on
   a head whose review is complete spends nothing; after a partial review, a rerun resumes the
   unread files (ADR 0036) and may spend up to `N` again, because a rerun is the operator's own
   action. When the unread list is over ADR 0036's 10,000-character marker cap (about 110 files),
   no marker is written and a rerun reviews the whole pull request again; the comment of that
   partial review says so, and the operator decides whether to rerun. The ledger still applies; `--force` stays the only way past it. This amends ADR 0037
   decision 6 ("the largest a run can spend is still `budget_usd`"): the largest is now `budget_usd`,
   or the approved `N`, which is itself a number at or below `approve_max_usd`. No value is
   unlimited.
4. **The budget is soft and the comment says so.** A provider call can finish above its cap (ADR
   0036 records $3.10 against $3; pull request 287 spent $3.15). The comment says the run may pass
   the approved figure by about one call.
5. **`size_gate_usd` no longer gates.** With the room as the gate, a separate dollar gate either
   equals the room or skips reviews the run could pay for (the case ADR 0037 decision 3 was written
   against). The input is still accepted so existing callers do not fail, is ignored, and the run
   logs one line saying so. It is removed in the next major version.
6. **Local runs still never refuse.** `wachiman local` warns and continues, as ADR 0037 decision 10
   says, but its warning threshold becomes `budget_usd` instead of `max(size_gate_usd, budget_usd)`,
   because `size_gate_usd` no longer means anything (point 5).

## Alternatives rejected

- **Keep the partial review between the budget and the gate** (ADR 0037 decision 7). It reads the
  riskiest batches. Above the room the review is likely partial, and at about 1.4 times the room
  (the estimate's error) nearly certain; pull request 287 shows the result: less than half of the
  files, paid in full. The owner accepts losing the borderline reviews that would have finished,
  because the operator can approve each of them with one command.
- **Approve by reaction, or by any OWNER, MEMBER or COLLABORATOR.** Wider than today's authority:
  a member who is not the operator cannot start a review now, and membership is not a delegation of
  the owner's key.
- **Approve by editing `budget_usd` in the workflow only.** It works today and stays possible, but
  it is a commit to the shared workflow for a one-off review.
- **Drop or group formatting-only changes before estimating.** Proposed with a syntax-tree
  comparison that matched 299 of the 312 files of pull request 287. The owner rejected it: a
  change that looks like formatting can still break something, and the model reads everything it
  is asked to review. The gate, not a filter, bounds the cost. Commits the repository itself lists
  as formatting are read by a cheaper model instead ([ADR 0063](0063-files-changed-only-by-commits-in-git-blame-ignore-revs-are-reviewed-by-a-cheaper-model.md)).

## Consequences

- With the defaults, every pull request estimated above $3 gets a comment and no review until the
  operator approves or pushes a smaller change. Estimates between $3 and $6 were partial reviews
  before; they are skipped now.
- The estimate keeps its error of about ±40% (ADR 0037 decision 2). A run that passes the gate can
  still end partial when the real cost is above the estimate; it is reported and resumed as today.
- `approve_max_usd` is a new reusable-workflow input. `size_gate_usd` is deprecated.
- More pull requests read `blocked` with `review_missing` in `wachiman pr-state` (its rule for a
  gate-skipped pull request), because every estimate above $3 is now skipped by default.

## Non-goals

- Filtering files by content (formatting, whitespace or syntax-tree equality).
- Letting anyone other than the operator approve spend.
- A monthly or per-repository limit, or a change to any budget default.

## Reopen when

Owners report that skipping estimates between the run budget and the old $6 gate loses reviews
they wanted, or the estimate is shown off by more than 40% on several pull requests near the room.
