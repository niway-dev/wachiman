# ADR 0019: A re-review sends only the threads its push can change

- **Status:** proposed 2026-11-02 (draft). Implemented by the pull request that adds this file
  (`reReviewThreads` in `src/engine.ts`).
- **Date:** 2026-11-02
- **Evidence:** [Re-review cost study 2026-11-02](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02-re-review-cost/README.md):
  six kaipu-record re-reviews rebuilt and run through the v1.5.0 engine with a full tool trace, twice
  as they are and once per lever, Opus 5.5 at effort high.

## Context

A re-review (ADR 0011) reviews only what changed since the last reviewed commit, but it hands the
model every open Wachiman thread of the pull request. `assignThreads` gives a thread to the batch
holding its file and every other thread to the first batch, so a one-batch re-review gets them all.
The prompt then asks for a reply to each one.

On kaipu-record#478 at `392778f` a 7-file push received 14 threads; 7 were on files the push did
not touch and had already been answered "Looks addressed" in an earlier round. Both baseline runs
replied to all 14. In each run, six of the seven replies on the untouched files said only "Not in
this round's files. Accepting the fix in 886d67f0 as described" or "Already fixed in an earlier
round"; the seventh repeated the same verdict. One thread on that pull request got "Looks
addressed" four times on a file no push changed. Over the six rebuilt re-reviews, the threads file was the
largest single read (87,600 characters), and about 10 % of the cost.

ADR 0008 already says the model replies "for a thread without a verdict whose code changed".
ADR 0012 says a thread-only run that finds the head unreviewed leaves the owner's reply to the
push's review, so that review must still see threads with a new reply.

## Decision

On a re-review (a review with a `since` commit, including after a rebase), the engine hands the
model an open Wachiman thread only when at least one of these holds:

1. its file is one the re-review covers;
2. Wachiman has not replied in it yet;
3. a person with `OWNER`, `MEMBER` or `COLLABORATOR` access replied after Wachiman's last reply;
4. Wachiman's last reply did not judge it addressed ("Still open", "Still applies"), since a fix
   can land in another file.

A thread left out is one Wachiman last judged addressed, on a file the push did not change, with
nothing new from a person. The run logs how many were left out. A first review, a scoped
`/wachi review <paths>` and a fallback to the whole pull request still hand over every open thread.

## Alternatives rejected

- **Keep sending every open thread** (v1.5.0). Measured: the replies it adds on untouched,
  already-answered threads repeat the earlier verdict without reading anything new.
- **Send only the threads on the push's files.** Drops an owner's reply on another file, which
  ADR 0012 relies on the push's review to answer, and a "Still open" thread fixed in another file.
- **Apply ADR 0008's lifetime cap of two replies in reviews too.** A separate change to reply
  behaviour, not measured here; a thread whose file changes on every push still gets a reply each
  time.
- **Make the re-review prompt lighter (no flow questions or contracts, no full-file read).**
  Measured in the same study: 17 % and 29 % cheaper, but each lost an audited finding the baseline
  kept (the ordering bug on #483 at `0253fd7` in both runs that dropped the flow questions). Not
  adopted.

## Consequences

- Fewer thread replies per push on pull requests whose threads stay open, and none that only
  repeat an earlier "addressed". On the six rebuilt re-reviews the threads file went from 87,600
  to 31,800 characters.
- The cost effect is small: the threads file was about 10 % of a re-review's cost, and the one
  run per case of this rule came out 4 % cheaper than the baseline, inside the run-to-run noise
  (the same prompt cost $0.21 and $0.28 on two runs).
- A regression in a file the push did not touch, which breaks a thread already judged addressed,
  is no longer re-checked from that thread. The batch's own review still covers the push's files.

## Non-goals

- Making re-reviews substantially cheaper: the study found no prompt lever that saves more than
  noise without losing a finding. A re-review's cost is mostly the fixed prompt (about 29 %) and
  the model's output (about 26 %).
- Resolving threads, or changing what the thread-only run answers (ADR 0008, ADR 0012).

## Reopen if

- An owner reports a thread left out that should have been answered, or a regression that broke an
  "addressed" thread and was only visible from that thread.
- Re-reviews start covering files by something other than the push's own change (ADR 0011 and its
  amendment), which changes what "a file the push did not change" means.
