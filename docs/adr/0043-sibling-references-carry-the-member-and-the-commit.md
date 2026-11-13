# ADR 0043: References into a sibling carry the member and the commit, and every reader sees the same snapshots

- **Status:** proposed 2026-11-13. **Not implemented.** Phase 1 of the
  [distributed-repo review design](../specs/2026-11-13-distributed-repo-review-design.md) builds it,
  after phase 0. When implemented, it **supersedes, for runs with `--distributed-repo` only,**
  decision 3 of [ADR 0031](0031-a-risk-map-whose-level-the-engine-computes-from-checked-facts.md)
  and of [ADR 0032](0032-one-ask-core-for-pull-request-and-laptop-grounded-in-the-review.md), and
  ADR 0032's non-goal "answering questions about code outside the change's repository"; it
  **amends** decisions 1 and 3 of
  [ADR 0027](0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md).
  Without the flag those decisions hold unchanged.
- **Date:** 2026-11-13
- **Spec:** [Distributed-repo review](../specs/2026-11-13-distributed-repo-review-design.md),
  decisions 8 and 9.
- **Tracker:** NIW2-761

## Context

A cross-repository finding has its premise in another repository: "the client sends `amount` in
cents, but `billing-service` reads it in units at `src/routes/invoices.ts:42`". Today that
premise cannot be checked:

- ADRs 0031 and 0032, decision 3: a reference is kept only if its path and line exist at the head
  of the reviewed repository. A reference into a sibling is dropped; or the model cites only the
  client line and the sibling premise becomes unchecked prose.
- ADR 0027: the verifier receives the head and the base only (`verifyFindings`,
  `src/engine.ts:3373-3445`), so it cannot read the sibling premise and either refutes the finding
  without seeing it or confirms it blind.
- `ask` checks references against the reviewed head (ADR 0032), so an answer about the sibling has
  nothing to cite.
- Giving the model a sibling's live checkout as `--add-dir` grants the whole tree: untracked
  configuration, `.git`, symlinks out of it. The local connector already avoids that for the
  reviewed repository with a `git archive` snapshot (`src/connectors/local-git.ts:387-417`).

The owner decided on 2026-11-13 that the ADR 0032 non-goal changes for distributed repositories.
Its own reopen conditions (wrong answers, removed references, the ask ceiling) are not met; this
is a new decision, not a reopen.

## Decision

1. **A sibling is read only as a snapshot.** For each `(member, sha)` the run needs, the engine
   runs `git archive <sha> -- <paths>` in the member's repository and extracts it into a temporary
   directory: tracked files under the contract's paths only, no `.git`, no untracked files.
   Symlinks are dropped and listed in the report. A manifest path that is absolute or contains
   `..` is refused before anything is read. **The engine expands the globs itself:** it lists the
   tree at `<sha>` (`git ls-tree -r --name-only`), matches it with the same matcher that decides
   whether a contract applies (ADR 0044 decision 4), and passes the resulting literal file list to
   `git archive` with `--literal-pathspecs`. Git's own pathspec rules never decide what is read. The live checkout is never passed to the model.
2. **A reference is `{member, sha, path, line}`.** Rendered as `member@sha:path:line` (short SHA
   in text, full SHA in JSON). An absent `member` means the reviewed head, exactly as today. The
   fields are optional additions to every structured reference of result `/2`: finding evidence,
   contract facts, risk facts, verifier disproofs and `ask` references.
3. **The check follows the reference.** A sibling reference survives only if `member` is one the
   run read, `sha` is the snapshot's commit, and the line exists in that snapshot. The run states
   how many references it removed, as it does today. A finding's own location stays in the
   reviewed diff; a sibling reference is evidence for it, and impact on a sibling is reported as
   such references.
4. **Every reader sees the same snapshots.** The batches that triggered a contract, the verifier
   (all of the run's snapshots) and `ask` get the same members at the same SHAs. The verifier may
   refute with a disproof in a sibling snapshot, checked by decision 3; without one the ADR 0027
   rule holds.
5. **`ask` re-materialises by SHA.** History stores each sibling's member, repository, SHA and
   paths. `ask` on a stored review snapshots the same commits again. When a commit is gone or the
   member is not cloned, the answer says which sibling it could not read, and references into it
   are removed and counted.

## Alternatives rejected

- **Pass the sibling checkout as `--add-dir`.** One line of code. Rejected: it exposes everything
  in the directory, and the files can change during the run, so a reference would not point to a
  fixed commit.
- **Cite siblings in prose only.** No format change. Rejected: an unchecked premise is the kind of
  wrong finding the verifier exists to remove (ADR 0027), and prose references cannot be checked
  reliably (ADR 0032's rejected alternative).
- **Paths relative to the coordinator (`billing-service/src/...`).** No new field. Rejected: the
  path alone says nothing about which commit was read, and a member cloned outside the coordinator
  breaks it.
- **Let the verifier read only the reviewed repository.** Cheaper. Rejected: it would refute
  cross-repository findings for lack of the evidence it was not given.

## Consequences

- The reference check, the verifier's inputs and `ask`'s inputs each gain a snapshot map keyed by
  member. Without the flag the map is empty and every prompt is byte-identical to today's.
- Result `/2` gains optional `member` and `sha` on references and a `siblings[]` list; consumers
  that ignore unknown fields are unaffected (ADR 0019 decision 9's additive rule).
- Snapshots cost disk and time per `(member, sha)`; a member read at two commits in one run is two
  snapshots.
- A stored review whose sibling commit was garbage-collected can no longer ground `ask` in that
  sibling; the answer says so.

## Non-goals

- Anchoring a finding in a sibling's lines. Findings stay in the reviewed change.
- Reading a sibling's uncommitted changes.
- A reference into a repository that is not a member of the workspace.

## Reopen if

- More than a few sibling references per run are removed by the check on real runs: the format
  or the prompt section is not working.
- The verifier with sibling snapshots drops correct cross-repository findings more often than it
  drops wrong ones, over the phase 1 trial.
- Snapshot time becomes a noticeable share of a run (proposed: above 10 % of wall time): cache
  snapshots by `(member, sha)` between runs.
