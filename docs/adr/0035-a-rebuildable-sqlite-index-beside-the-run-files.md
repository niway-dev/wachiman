# ADR 0035: A rebuildable SQLite index beside the history run files

- **Status:** proposed 2026-11-11. Implemented on branch `feat/local-store` (slice 3, `src/store/`), not merged. Builds on
  [ADR 0020](0020-an-opt-in-on-laptop-review-history-with-deterministic-finding-tracking.md)
  without changing it: the run files stay the record. Reuses
  [ADR 0001](0001-distribution-and-trust.md) (no hosted service) and
  [ADR 0002](0002-typescript-on-bun-zero-dependencies.md) (no runtime dependencies).
- **Date:** 2026-11-11
- **Spec:** [PR Confidence, a review loop and a local store](../specs/2026-11-11-pr-confidence-review-loop-and-local-store-design.md)
- **Issue:** #181
- **Numbering:** see ADR 0033.

## Context

The owner wants to see, on the laptop, what the reviews cost, how many findings they captured,
how the loop behaves and how the PR Confidence trial is going. The local history (ADR 0020) holds
one immutable file per run and rebuilds state by replaying them. That is right for one
repository's listing and slow and awkward for questions across repositories and time.

ADR 0020 rejected "an index file updated on every run" because it is one corruptible file that
every command depends on.

## Decision

1. A SQLite index is built by replaying the history run files, using Bun's built-in SQLite.
2. The run files and `verdicts.jsonl` stay the only record. The index holds nothing that cannot
   be rebuilt from them.
3. No command that exists today depends on the index. `wachiman history` keeps replaying files.
4. A missing, outdated or unreadable index is rebuilt, never repaired.
5. `wachiman dashboard` reads the index and writes a static local page, with `--json` for the
   same figures. No server.

## Alternatives rejected

- **SQLite as the record, replacing the run files.** It is the corruptible single file ADR 0020
  rejected, and it gives up files a developer can read and delete by hand.
- **No index; replay on every dashboard call.** Fine for one repository, and it turns every
  cross-repository question into reading every run file.
- **A Python script with its own database.** Outside the product it would be the natural choice.
  Inside it, it adds a runtime the package does not install and a second reader of the run format.
- **A hosted dashboard.** ADR 0001 excludes a hosted service.

## Consequences

- Two readers of the run format exist in the same codebase: the replay and the indexer. They
  share the types.
- The index is one file for all repositories, so the dashboard can compare them. Deleting it
  loses nothing.
- GitHub-side reviews are not in the local history (ADR 0020 decision 1). Their spend is the
  subject of the usage dashboard spec, which is not implemented; one view of both is left open.

## Non-goals

- A query language or a public schema for the index.
- Sending any figure anywhere.
- Enforcing a spend limit. That is issue #122 and pull request #129.

## Reopen if

- Rebuilding the index takes long enough on real histories that it must be updated in place.
- The owner wants one dashboard for laptop and GitHub reviews: that needs the usage line of the
  usage dashboard spec.
- Bun's built-in SQLite changes in a way the version pin cannot absorb.
