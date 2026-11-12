# ADR 0037: A pull request above the size gate is not reviewed, and one comment says how to lift it

- **Status:** accepted 2026-11-12 by the owner. Implemented by the pull request that adds this
  file (`feat/review-cost-gate`). Builds on [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md)
  (the per-pull-request ceiling) and [ADR 0036](0036-a-partial-review-records-the-files-it-did-not-reach-so-the-next-push-resumes.md)
  (a partial review resumes on the next push). It changes what a pull request far larger than one
  run budget gets: no review instead of a partial review of its riskiest batches.
- **Date:** 2026-11-12

## Context

Some pull requests are too large to be worth sending to a model. The example that prompted this is
[pingdotgg/t3code#28845](https://github.com/pingdotgg/t3code/pull/28845): +46,074/−12,632 lines in
606 files. Macroscope refused it before reviewing ("would cost an estimated $35.38, which exceeds
your per-review limit of $15.00").

Wachiman started reviewing it. It spent up to `budget_usd` ($3) on the riskiest batches, listed the
rest as not reviewed, and with ADR 0036 the next pushes would have resumed until `auto_budget_usd`
($6) stopped them. On a pull request this size that is about a tenth of the change, chosen by a
path heuristic, paid in full, and presented as a review. The owner judged that worse than saying up
front that the pull request is too large and what it would cost.

The budgets bound what a run **spends**. Nothing bounded what a run **would need** to spend to be
complete. Those are two different questions and need two different settings.

## Decision

1. **An estimate before any model call.** For the files a run would send to a model (after
   exclusions, scope, the binary split, and for a push the delta and the carried files of
   ADR 0036), the engine plans the batches exactly as the review would (`planBatches`) and
   multiplies their number by a per-batch figure. The figure is the measured mean cost of one batch
   call at high effort, by model family: Sonnet $0.32 (42 batch calls), Opus $0.50 (66 rows),
   Haiku $0.28 (21 calls); any other model uses `batch_budget_usd`, the worst case the engine
   allows a call. The figure is never above `batch_budget_usd`. No model is called; the estimate
   is a pure function of the diff (`src/estimate.ts`). Sources are in [costs.md](../costs.md#the-size-gate).
2. **The expected error is about ±40% on the total.** Single Sonnet batches ranged from $0.20 to
   $0.58 and did not track the batch's line count, so a flat figure per batch is as good as a
   per-line one on this data. The data comes from a handful of repositories; a codebase unlike
   them, a lower effort, retries and the opt-in verifier move the real figure. The estimate is a
   gate, not a quote.
3. **The gate.** `size_gate_usd` (`AGENT_REVIEW_SIZE_GATE_USD`), default **$6**, a finite number
   greater than 0. The effective gate is never below what the run may spend:
   `max(size_gate_usd, budget_usd)` for `/wachiman review`, and
   `max(size_gate_usd, min(budget_usd, auto_budget_usd))` for an automatic run. A run that may pay
   for the whole estimate gets the whole review, so a gate below the run budget would only skip
   pull requests the run could afford.
4. **Above the gate, GitHub Actions spends nothing.** The run posts no review and writes no marker,
   and posts one issue comment with the estimate, the gate and the yml to set. The comment carries
   a hidden marker (`<!-- wachi:size-gate -->`); a later skip finds the bot's own comment with that
   marker and edits it instead of posting another, so a pull request that keeps growing has one
   comment, kept current.
5. **One input lifts it.** Because of point 3, the comment asks for one change: set `budget_usd`
   to the suggested figure (1.5 times the estimate, rounded up, to cover the error), then comment
   `/wachiman review`. For automatic push reviews too, `auto_budget_usd` must be raised as well,
   because that is the ceiling automatic runs share; the comment says so. `size_gate_usd` itself
   is for an owner who wants a different gate without raising a run budget.
6. **No unlimited value.** Every setting involved is a number. A typo cannot turn into an
   unbounded spend; the largest a run can spend is still `budget_usd`.
7. **Between the run budget and the gate, nothing changes.** A pull request whose estimate is above
   `budget_usd` but at or below the gate gets today's partial review, and ADR 0036 resumes it.
8. **Re-reviews, resume and the ceiling.** The gate applies to what the run would send, so an
   incremental push on a reviewed pull request is estimated on its own delta and a resumed run on
   its delta plus the carried files. A skipped pull request has no marker, so its next push
   estimates the whole pull request again and updates the same comment. The skip comment has no
   cost line, so `auto_budget_usd` does not count it. The gate is checked before the ceiling, so a
   skip never posts the "Automatic reviews paused" notice.
9. **Scoped reviews are gated on their own files.** `/wachiman review <paths>` estimates only the
   named paths, so reviewing part of a large pull request stays one comment away.
10. **Local runs never refuse and never prompt.** `wachiman local` prints one warning line with the
    estimate when it is above `max(size_gate_usd, budget_usd)`, before the first model call, and
    continues. Its money cap is unchanged: `budget_usd` per run and `batch_budget_usd` per call;
    there is no per-pull-request ceiling locally.

## Alternatives rejected

- **Keep the partial review.** It reviews the riskiest batches, which has some value, and ADR 0036
  finishes it over pushes. On a pull request many times the budget it reads a small fraction chosen
  by file names, spends the whole ceiling, and reads as "reviewed" at a glance. The owner prefers
  no review with a clear price to a review that covers a tenth.
- **Cap by changed lines or files instead of dollars.** Simpler to explain and exact to compute.
  But the cost of a line differs by model (Opus costs about 1.6 times Sonnet per batch) and by
  batching (lockfiles, generated files and binaries are dropped before batching), and owners
  already think in the `*_usd` inputs. A dollar gate set next to `budget_usd` compares like with
  like.
- **An "unlimited" flag** (`size_gate_usd: none`, `0` or `-1`). One step to lift the gate, but a
  wrong value in a shared workflow then has no bound at all. An explicit number costs one extra
  digit and keeps a worst case.
- **Ask in the pull request before reviewing** (a reaction or a reply that approves the spend).
  Nicer for the author, but anyone who can comment could approve spending the owner's key, and it
  needs new authority rules. The yml is the owner's.

## Consequences

- A pull request above the gate costs one runner job of a few seconds and one comment, and no model
  call. Its author learns why there is no review and what it would cost.
- Lowering the error needs more measured runs; the per-batch figures are constants in the code and
  must be updated when the default model or effort changes.
- An owner who raised `budget_usd` above $6 before this change has a gate at that budget already;
  nothing they reviewed before is skipped now unless it is estimated above their run budget.
- A pull request just above the gate whose real cost would have been below it (the estimate is
  high by up to 40%) is skipped. The comment gives the step to review it.

## Non-goals

- A monthly or per-repository limit, or a change to any budget default.
- Editing the skip comment after a later review passes the gate; it stays as the record of the
  skip.
- Estimating the verifier, the PR Confidence claims call or thread-reply runs: they are small and
  bounded by their own budgets.
- Refusing or prompting in local mode.

## Reopen when

Field runs show the estimate off by more than 40% on several pull requests near the gate, the
default model or effort changes, or owners report skipped pull requests they expected to be
reviewed at the default settings.
