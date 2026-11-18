# ADR 0057: A memory exception is applied after discovery and every muted finding is shown

- **Status:** proposed 2026-11-18. Not implemented.
- **Date:** 2026-11-18
- **Issue:** [NIW2-867](https://linear.app/niway/issue/NIW2-867/wachiman-repository-memory-kept-in-git-proposed-from-review-feedback)
- **Spec:** [repository memory kept in git](../specs/2026-11-18-repository-memory-design.md)
- **Relates to:** [ADR 0056](0056-repository-memory-lives-in-wachiman-memory-and-changes-only-through-one-draft-pull-request.md),
  which defines the entries, and
  [ADR 0027](0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md),
  whose rule this follows: a finding is dropped only for a stated, checked reason.

## Context

Repository memory holds two kinds of entry. A convention says how code is written here and makes
the reviewer report more. An exception says a finding is not wanted and makes it report less.

Today every instruction file is pasted into the prompt before findings are generated. An exception
placed there acts on discovery itself. The risk, not yet observed because nothing is built: an
exception such as "these handlers receive validated input" is approved, a later change adds a
caller that skips validation, and the reviewer, trusting the entry, never generates the finding.
No finding exists for the engine to protect, and nothing in the output shows that one is missing.

The owner's rule is that memory never hides a bug and that nothing happens without them knowing.

## Decision

1. Conventions are part of the review prompt. Exceptions are not.
2. Findings are discovered without exceptions. Then each exception in scope is matched against the
   candidates. A candidate that matches is not posted; it is listed in the review summary under
   "Muted by memory" with its title, its location and the id of the entry that muted it.
3. The engine, not the model, refuses to mute a finding at a blocking severity or with the
   security topic. Such a finding is posted, with a note naming the exception that tried to mute
   it.
4. A match needs a reason tied to the current code. When an exception has a `holds while` line and
   the diff touches one of those paths, the exception does not mute in that review and the summary
   says the entry may be out of date.
5. Every run records the muted findings, so a report can count them and a person can audit them.

## Alternatives rejected

- **All memory in the discovery prompt.** Simplest and cheapest. It makes a suppression invisible
  and makes decision 3 unenforceable.
- **No exceptions, only conventions.** It removes the risk and also the main use the owner asked
  for: a nit they do not want reported again.
- **Exceptions as path-and-rule filters with no model call.** Deterministic, but findings are
  prose; a filter on text either misses rewordings or mutes too much.
- **Dismissals kept per pull request and never generalized.** It stops repetition inside one
  review and repeats the same nit on the next pull request.

## Consequences

- A review that has both candidates and exceptions in scope costs one more model step, or reuses
  the verifier call when verification is on. The plan measures the cost before choosing.
- The summary grows by one section when something is muted. It stays empty otherwise.
- Muting is observable, which is what makes the noise experiment possible: muted findings can be
  judged by a person as rightly or wrongly muted.
- This contains one way of losing a bug. A convention in the prompt can still bias discovery, and
  the discovery pass can still miss a bug on its own.

## Non-goals

- Guaranteeing that memory never costs a real finding. The claim is that a muted finding is
  always visible.
- Muting by severity or by topic as a general setting. That is review policy, not memory.

## Reopen when

- The extra step costs more than the noise it removes.
- Muted findings judged by the owner turn out wrong often enough that exceptions are not worth
  keeping.
- A structured finding identity makes a deterministic match reliable.
