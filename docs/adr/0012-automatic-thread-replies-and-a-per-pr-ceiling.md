# ADR 0012: Automatic answers to thread replies, and one spending ceiling per pull request

- **Status:** proposed 2026-11-01. Not implemented. Amends ADR 0001 decision 5. Builds on ADR 0011
  (review every push, #68), which is proposed and not merged.
- **Spec:** [Re-review on push, thread replies and fix checks](../specs/2026-11-01-re-review-on-push-design.md)
- **Evidence:** [kaipu-record#475](../benchmark/2026-10-31/pr-475.md)

## Context

ADR 0001 decision 5 says review triggers stay `pull_request` plus the operator's comment. ADR 0011
adds `synchronize`, which is still `pull_request`, so every push gets an incremental review. Two
gaps remain after it.

**Replies go unanswered.** On kaipu-record#475 the author replied "Fixed in 1bcab524" to both
Wachiman threads. An inline reply is a `pull_request_review_comment` event, which starts nothing,
so neither got an answer; the engine reads replies only inside the next review run. The two
competitors on the same PR answered within minutes. The review body even says "Reply in a
comment's thread to answer it".

**Nothing bounds a pull request's total.** ADR 0011 bounds each run by `budget_usd` ($3), and a
pull request now pays one run per push. Its own reopen condition is a doubling of the measured cost
per pull request. The owner wants a limit in dollars per pull request, $2 by default.

## Decision

1. **Thread replies start a thread-only run.** Callers listen to
   `pull_request_review_comment: created`. The job runs only for a reply (`in_reply_to_id` set)
   written by the `operator`, on a same-repository head, never for a bot. It answers every pending
   Wachiman thread, not only the one that triggered it, under ADR 0008 (report, never resolve; at
   most two Wachiman replies per thread).
2. **It acts only on a reviewed head.** If the last reviewed commit is not the head, it exits
   without a model call: the push's review will read the same replies. Thread runs have their own
   concurrency group with `cancel-in-progress: false` and never cancel a review.
3. **One ceiling for automatic runs.** Every automatic run on a pull request (the first review,
   push reviews, thread runs) counts against `auto_budget_usd`, default $2, summed from the cost
   line of the engine's own signed footers marked automatic. A run that starts gets at most what is
   left. At the ceiling the engine posts one notice and stops. The operator's `/wachi review` is not
   limited by it.

## Alternatives rejected

- **Read replies only on the next push** (ADR 0011 alone). A reply without a push stays
  unanswered, which is the failure on #475.
- **Any commenter can start a thread run.** On a public repository a stranger's reply would spend
  the consumer's key. Collaborators' replies are still read inside runs the operator starts.
- **One concurrency group for reviews and thread runs.** The author's agent replies seconds after
  it pushes; with `cancel-in-progress` the reply would cancel the push's review.
- **Pause after N reviewed commits** (CodeRabbit pauses after 5). A count does not bound cost: a
  large push or a full-review fallback costs many small ones.
- **A per-run cap only** (today's `budget_usd`). It bounds one run, not a pull request with twenty
  pushes.

## Consequences

- The default ceiling can be spent by the first review of a large pull request ($1.36 on #467);
  the notice tells the operator how to continue.
- A cancelled run posts nothing, so its spend is in no footer and the ceiling under-counts it.
- The workflow gains a job and an event. Permissions stay `contents: read` and
  `pull-requests: write`.
- ADR 0001's Status line records the amendment of decision 5.

## Non-goals

- Resolving threads automatically (ADR 0008).
- Fork or untrusted pull requests, `pull_request_target` (ADR 0001).
- A hosted queue or a server-side spend counter.

## Reopen when

- Logs show cancelled runs spend more than 20 % of the ceiling on typical pull requests: count
  spend somewhere a cancelled run can still write.
- Consumers raise the ceiling on most pull requests, or most ceiling notices are followed by
  `/wachi review` within minutes: the default is wrong.
- The operator marks thread-run replies wrong more often than review findings: stop answering
  without a push.
