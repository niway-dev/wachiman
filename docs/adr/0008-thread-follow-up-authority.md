# ADR 0008: Thread follow-up: the operator resolves, the model only reports

- **Status:** proposed 2026-10-30. Not implemented. It depended on #40 (review identity), which is
  closed, and still depends on #42 (strict verdicts), which is open.
- **Update 2026-11-06:** the push re-review now honours the pending filter (`pendingThreads`: the
  owner wrote last) and the two-reply cap, as the thread-only run already did, so a thread Wachiman
  answered last is neither read nor answered again. The decision to report and never resolve is
  unchanged.
- **Proposed amendment 2026-11-11:** [ADR 0032](0032-one-ask-core-for-pull-request-and-laptop-grounded-in-the-review.md)
  (proposed, not implemented) narrows the non-goal "Resolving or replying to human threads": a
  human thread whose comment invokes the mention is answered in that thread. Resolving stays a
  non-goal.
- **Date:** 2026-10-30
- **Spec:** [2026-10-30-review-memory-and-threads-design.md](../specs/2026-10-30-review-memory-and-threads-design.md)

## Context

Wachi's review threads stay open forever. The owner answers them, often through an
automated agent that replies as the owner. Then nothing reads the answer except the next
review, and that review never resolves anything (`src/engine.ts:20`).

Pullfrog resolves its own threads during incremental reviews when the model judges them
addressed. It leaves them open when unsure, because "false-positive resolutions erode trust
faster than false negatives".

The owner's reply comes from an agent acting under the owner's identity. A model that judges
"fixed" and a model that wrote the fix can agree on the same mistaken premise, so their
agreement is not verification.

## Decision

1. **Resolution.** The engine resolves a Wachi thread only when the operator's latest strict
   verdict (#42) in that thread is `Verdict: wrong` or `Verdict: correct` and the code at the
   thread's lines changed. It uses a GraphQL mutation, with no model call. A verdict from
   anyone else, quoted or inside a code block, does nothing.
2. **The model reports, it does not resolve.** For a thread without a verdict whose code
   changed, the model may reply once with "appears addressed in `<file:line>`" or "still
   applies because …". Automatic resolution of model-judged fixes waits until the benchmark
   measures the false-resolution rate.
3. **A cap.** At most two Wachi replies per thread over its lifetime, counted from the thread
   itself. The last allowed reply is a "waiting for the owner" note. After it, Wachi stays
   silent in that thread.
4. **Its own path.** Thread follow-up runs before the file pipeline and independently of it,
   even when no file changed.
5. **One run at a time.** The automatic and on-demand jobs share one concurrency group per pull
   request once this lands. Before every mutation, the engine rechecks the head and the
   thread's state.
6. **Scope.** The engine acts only on threads that carry the Wachi signature (#40) and on ids
   it handed to the model.

## Alternatives rejected

- **Resolve when the model judges the fix**, as Pullfrog does. One wrong resolution hides the
  finding the reviewer exists to keep visible, and the owner's reply agent can share the
  model's mistake.
- **Never resolve.** This is today's behaviour, and the thread list becomes noise.
- **A per-round cap with no lifetime cap.** Two agents can still alternate forever across
  pushes.
- **Store the reply counter in the marker.** It drifts when a run is cancelled between a reply
  and the marker. The thread itself is the source of truth.

## Consequences

- The owner, or the owner's reply agent, still has to resolve the threads the model reports as
  addressed. Writing `Verdict: correct` makes the next run resolve the thread.
- The workflow already has `pull-requests: write`, which covers replies and the GraphQL
  resolve. No new permission is needed.
- Each run pays a small model batch for changed threads, even without new files to review.

## Non-goals

- Resolving or replying to human threads.
- Arguing past the cap.
- Auto-resolve on model judgment. That needs its own ADR, backed by a measured
  false-resolution rate. A later opt-in setting could offer it to teams that want it; it is not
  part of the 2026-11-06 change.

## Reopen if

- The benchmark or real use shows a model-judged "appears addressed" is wrong in under about
  5% of a sample of 50 or more. Then consider automatic resolution for that case.
- The two-reply cap leaves real recurrences unanswered. Then consider resetting it when the
  thread's lines change again after a resolve.
