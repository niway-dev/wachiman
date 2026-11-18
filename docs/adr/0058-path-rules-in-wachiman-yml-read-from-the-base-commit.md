# ADR 0058: Path rules in `.wachiman.yml`, read from the base commit

- **Status:** proposed 2026-11-18. Implemented by the pull request that adds this file
  (`feat/path-rules`). Builds on [ADR 0048](0048-a-repository-settings-file-at-the-root-wachiman-yml.md)
  and [ADR 0049](0049-model-and-effort-in-wachiman-yml-read-from-the-base-commit.md).
  Design: [path rules spec](../specs/2026-11-18-path-rules-design.md).
- **Date:** 2026-11-18

## Context

Files are ordered by a built-in path heuristic, and the risk map and the PR confidence grade use
it to decide whether a change touches a high-risk path. The heuristic was taken from the first
consumer; another repository has other dangerous places and no way to name them. A list of
dangerous paths is also review policy: if the change under review could edit it, a pull request
could remove its own path from the list and be reviewed as low risk.

## Decision

1. `.wachiman.yml` accepts `paths`: a list of `{ match, severity, reason }`, with `severity` one
   of `critical`, `high`, `medium`. This set is separate from finding severities.
2. A matched file is ordered before every heuristic match, and its rule (severity, glob and reason)
   replaces the heuristic in the prompt, the risk map, the risk level and therefore the grade.
   Without `paths`, nothing changes.
3. The review is advisory. For `critical` and `high` it says a person should approve the change;
   Wachiman never approves, requests changes or blocks.
4. A `critical` match does not bypass the size gate. When the gate skips a run, its notice names
   the matched critical paths.
5. The rules are read from the base commit in Actions and from the merge-base locally, never from
   the head, whatever the model and effort inputs say. A pull request whose head `paths` differ
   from the base's (or cannot be parsed) gets a "Review policy changed" notice, and `.wachiman.yml`
   counts as a high-risk path in that review. Its rules apply after merge.
6. A broken file is ignored with a warning, as ADR 0049 decision 5 says.

## Alternatives rejected

- **Reuse finding severities** (Blocker, Fix, Consider): a path is not a defect, and a
  "Blocker path" would read as a merge block.
- **Read the rules from the head**: a pull request could weaken its own review.
- **Let `critical` lift the size gate**: a path list would become a way to spend past the gate on
  the owner's key.
- **Import CODEOWNERS as `high`**: ownership is not danger, and it would guess a severity.

## Consequences

- A repository can tune what "high-risk path" means for its grade without a release of Wachiman.
- Every Actions run reads `.wachiman.yml` at the base commit, even when model and effort are set
  by the workflow: one more contents call per run.
- A pull request that adds `paths` sees no effect until it merges, which can surprise its author;
  the notice says so.

## Non-goals

- Blocking or approving a merge.
- Un-excluding a file the exclude lists drop.
- Per-path model or effort.

## Reopen when

A consumer needs a rule to keep a file the exclude lists drop, or a severity that changes something
other than order, wording and level (for example a per-path budget).
