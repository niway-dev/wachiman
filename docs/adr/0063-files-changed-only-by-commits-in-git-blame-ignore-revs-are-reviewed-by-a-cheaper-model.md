# ADR 0063: Files changed only by commits in `.git-blame-ignore-revs` are reviewed by a cheaper model

- **Status:** accepted and implemented 2026-11-21. Builds on
  [ADR 0062](0062-a-review-the-run-cannot-pay-for-in-full-is-skipped-and-the-operator-approves-a-budget-for-one-head.md)
  (the room is the gate) and [ADR 0037](0037-a-pull-request-above-the-size-gate-is-not-reviewed.md)
  decision 1 (the estimate). Design: [budget gate spec](../specs/2026-11-21-budget-gate-design.md).
- **Date:** 2026-11-21

## Context

A formatter run produces a change too large to review at the normal price, and no review tool
tells formatting apart from behaviour on its own: CodeRabbit filters by configured paths, Graphite
by `linguist-generated`, GitHub hides whitespace only on screen. The owner decided that formatting
changes are still read, because a formatting change can break something.

Repositories already name their formatting commits in one standard place: `.git-blame-ignore-revs`,
read by `git blame --ignore-revs-file` and by GitHub's blame view. Pull request 287 adds its own
(commit `6d7822f` lists the formatter commit `a639481`). With that list, 286 of its 322 changed
files were touched by the formatter commit and by no other commit of the pull request.

## Decision

1. **The marker is `.git-blame-ignore-revs`.** The engine reads it from the pull request's head,
   because the formatting commit and its listing usually arrive in the same pull request. Lines
   are full or abbreviated commit hashes; `#` starts a comment. No commit-title convention is read.
2. **A file goes to the cheaper model only when every commit of the range that touches it is
   listed.** A file also changed by an unlisted commit is reviewed as today, with its whole diff.
   A file that a `paths` rule of `.wachiman.yml` matches stays with the main model and in the first
   batches: the maintainer named that path, and the head's listing cannot lower its review. So do the files that steer the review or the CI:
   anything under `.github/`, `CLAUDE.md`, `AGENTS.md`, `.wachiman.yml`, `.gitattributes` and
   `.git-blame-ignore-revs` itself (the file names match in any directory), even when only listed commits touch them.
   Nothing is dropped: every file is read by a model.
3. **The cheaper model is an input.** `format_model` (default Haiku, effort low) reviews those files
   in their own batches, planned apart from the rest. The review lists them under their own line
   ("reviewed by `<model>`: changed only by commits in `.git-blame-ignore-revs`").
4. **The estimate prices each group with its own model.** ADR 0037's figure per batch applies per
   group; the gate of ADR 0062 compares the sum with the room.
5. **Local runs do the same,** from the working tree's `.git-blame-ignore-revs` and the range under
   review.

## Alternatives rejected

- **Detect formatting by comparing syntax trees.** Rejected by the owner with ADR 0062: equivalence
  checks miss real changes (parentheses, moved directive comments, data formats).
- **A commit-title prefix (`style:`).** Not a standard any tool reads; `.git-blame-ignore-revs` is.
- **Skip the listed files.** The owner wants them read; only the price changes.

## Consequences

- The author of a pull request decides which of its files get the cheaper model, by listing a
  commit. It lowers the review depth of those files, never removes them from the review.
- The saving is measured: Haiku at effort low read the 282 formatter-only files of pull request 287
  in 15 batches for $0.2253 over 17 calls (two batches were retried), $0.015 a batch, about 20 times
  below the $0.32 of Sonnet at high effort. That figure is recorded in `src/estimate.ts` and
  `docs/costs.md`, and the estimate prices the format group with it.
- `format_model` is a reusable-workflow input (default `claude-haiku-5-5`); an empty value is the default.

## Non-goals

- Detecting formatting commits that are not listed.
- Reading `blame.ignoreRevsFile` from git config, or any file other than `.git-blame-ignore-revs`.

## Reopen when

The measured cost of a low-effort Haiku batch is not clearly below a Sonnet batch, or listed commits
are found to carry behaviour changes that the cheaper model missed.
