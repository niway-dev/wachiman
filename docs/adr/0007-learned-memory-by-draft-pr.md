# ADR 0007: Learned memory is proposed as one draft pull request

- **Status:** proposed 2026-10-30. Not implemented. It depends on ADR 0006 and on #42 (strict
  verdicts). Its capture mechanism (a batch `learn` over `Verdict:` replies) is superseded by
  [ADR 0056](0056-repository-memory-lives-in-wachiman-memory-and-changes-only-through-one-draft-pull-request.md),
  proposed 2026-11-18; the draft pull request and the human merge stand.
- **Date:** 2026-10-30
- **Spec:** [2026-10-30-review-memory-and-threads-design.md](../specs/2026-10-30-review-memory-and-threads-design.md)

## Context

The owner already records a judgment on findings with `Verdict:` replies, and
`src/precision.ts` reads them to measure precision. Those verdicts are the raw material for
a repository memory. Turning them into memory has two hazards:

- A verdict about one finding is not a rule. "Wrong, this caller already validates" must not
  become "do not report missing validation".
- Anyone whose reply counts can try to steer future reviews.

CodeRabbit keeps its learnings on its servers. It also has a command that turns recent
feedback into a pull request against its config file. The owner wants only the second part:
memory that lives with the consumer, readable as text, arriving the way release-please
proposes a release.

## Decision

1. **The command.** `/wachi learn`, run by the operator, reads the operator's strict verdicts
   (#42) on merged pull requests since the last merged learn PR.
2. **What becomes a lesson.** The model groups verdicts by area and proposes lessons. A lesson
   needs at least two agreeing verdicts. It is scoped to `paths` and written as an example
   with its reason. It is never a prohibition and never a severity change (ADR 0006).
3. **Who writes.** The engine validates paths, sizes and frontmatter. It writes only under the
   policy folder's `learned/`, pushes `wachi/learn` and opens or updates one draft PR titled
   `chore(wachi): learn from N verdicts`.
4. **The description.** It lists every lesson with its source threads, the verdicts and a short
   quote. The diff is readable Markdown.
5. **Privileges.** The learn job has `contents: write` and `pull-requests: write`. The model
   call inside it has the review's read-only tools and no credentials. Only engine code holds
   the token.
6. **A closed PR.** A closed, unmerged learn PR consumes nothing. Its verdicts are proposed
   again next time, unless the operator answered the PR with a verdict of its own.

## Alternatives rejected

- **Learn on every review, automatically.** Policy would change without a pull request, which
  ADR 0001 rejects.
- **Only a digest comment, no PR.** It is safer, but the owner has to rewrite every lesson by
  hand. The draft PR is the digest plus a ready diff, and it still needs a merge.
- **One verdict per lesson.** It generalises from a single case, which is the main poisoning
  and overfitting path.
- **Count verdicts from `OWNER`, `MEMBER` or `COLLABORATOR`.** Too broad to authorise policy.
  Only the operator counts.

## Consequences

- Memory grows only as fast as the operator writes verdicts. Day one relies on `CLAUDE.md` and
  `AGENTS.md` (ADR 0006).
- A merged poisoned lesson is still only an example with no authority, and `git revert`
  removes it.
- Each learn run is one paid model call over verdict text, not over code.

## Non-goals

- Scheduled learning, until a few manual runs show the PR is worth reading.
- Lessons that disable checks, lower severity or widen excludes.
- Using benchmark repositories' verdicts as memory.

## Reopen if

- Owners merge learn PRs without reading them, as shown by revert rate or reported bad
  lessons. Then stop proposing diffs and fall back to a digest.
- Two verdicts per lesson proves too slow to be useful after a month of real use.
