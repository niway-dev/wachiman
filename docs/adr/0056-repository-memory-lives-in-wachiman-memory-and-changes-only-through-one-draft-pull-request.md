# ADR 0056: Repository memory lives in `.wachiman/memory/` and changes only through one draft pull request

- **Status:** proposed 2026-11-18. Not implemented.
- **Date:** 2026-11-18
- **Issue:** [NIW2-867](https://linear.app/niway/issue/NIW2-867/wachiman-repository-memory-kept-in-git-proposed-from-review-feedback)
- **Spec:** [repository memory kept in git](../specs/2026-11-18-repository-memory-design.md)
- **Numbering:** 0056 because `main` holds up to 0053 and open branches hold 0054 and 0055.
- **Supersedes:** the capture mechanism of
  [ADR 0007](0007-learned-memory-by-draft-pr.md) (a batch `learn` over `Verdict:` replies) and
  the `learned/` location in [ADR 0006](0006-repository-review-policy.md). Both were proposed and
  never built. It also narrows their rule that a lesson is only an example with no authority:
  an `exception` entry may mute a Consider or Info finding, under
  [ADR 0057](0057-a-memory-exception-is-applied-after-discovery-and-every-muted-finding-is-shown.md).
  An entry still never changes a severity, disables a check or widens an exclude. What stands
  unchanged: memory in the consumer's repository, read from the base commit, proposed as a draft
  pull request, no hosted store.

## Context

ADR 0007 learns from strict `Verdict:` replies on merged pull requests, in batch. A census of the
pilot repository on 2026-11-02 found no such reply and 94 "Fixed in" replies among 265 operator
comments (recorded in the spec of
[pull request 90](https://github.com/niway-dev/wachiman/pull/90); not re-run). A design that waits
for a signal nobody emits learns nothing.

ADR 0006 placed the policy folder at `.github/wachi/`. Since then the product was renamed, the
reviewer runs on the laptop as well as in Actions, and the repository's settings live in a root
`.wachiman.yml`.

The owner's requirements: memory is a versioned file in the codebase; nothing is written without
the owner knowing; capture is helped by the tool, at the moment of review, on the laptop and in
Actions; the memory must not fill with garbage.

## Decision

1. Memory is Markdown under `.wachiman/memory/` at the repository root: `index.md`, always
   loaded, which also maps path globs to area files; area files, loaded when the diff touches
   their glob; `archive.md`, never loaded. The path is fixed.
2. Memory is read only from the base commit. A run records the memory revision and the files it
   loaded. An incremental run applies the current base memory to the new diff and does not
   re-review earlier commits.
3. An entry carries a kind (`convention` or `exception`), a path scope, the rule, the reason, an
   evidence list and the date. An exception whose reason is a fact about the code also names, in
   `holds while`, the paths that fact lives in. The entry's id is a digest of its text.
4. A candidate comes from an explicit operator instruction with a reason, from a finding judged
   wrong or intentional with a reason, or from a finding that was fixed. The first is enough
   alone. The others need `memory.min_evidence` pieces of evidence (default 2) from different
   pull requests, and a fix supports only a convention. Reactions and silence are never evidence.
5. The model drafts the entry from the code and the owner's intent. The owner approves that exact
   text, and the commit carries the same digest.
6. The only write path is one commit per entry on the branch `wachiman/memory`, in one draft pull
   request that a person merges. Wachiman never force-pushes that branch, writes only under
   `.wachiman/memory/`, and reports an entry as recorded only after the push succeeds. A rejected
   push is retried by applying the same entry on the branch's new head; an entry whose digest is
   already on the branch is not written twice.
7. On the laptop, `wachiman memory propose <id>` writes with the developer's git credentials. In
   Actions, the configured operator's `/wachiman remember` starts a separate job with
   `contents: write` and `pull-requests: write`; the engine writes the file and the model call has
   no credentials. The review job stays `contents: read`.
8. Loaded memory has a budget set in `.wachiman.yml` (`memory.max_index_lines`, default 150;
   `memory.max_loaded_lines`, default 400). Over it, the review loads the most specific globs
   first, names the files it left out and says the memory is over budget. `index.md` counts
   toward the loaded total. An `index.md` over its own budget is still loaded, up to the loaded
   total, and the review and `wachiman memory check` both report it.
9. Wachiman suggests and never applies: merging likely duplicates, resolving likely
   contradictions, re-checking an entry whose `holds while` paths a diff touches, and archiving an
   entry not used in `memory.archive_after_days` (default 90).
10. `.wachiman.yml` accepts one more optional key, `memory`, a map of the four settings above,
    read from the base commit like `model` and `effort`
    ([ADR 0049](0049-model-and-effort-in-wachiman-yml-read-from-the-base-commit.md)). A value
    that is not a positive whole number is ignored with a notice and the default applies. The
    only one that changes spend is `max_loaded_lines`, which bounds prompt size.

## Alternatives rejected

- **Keep ADR 0007's batch `learn` over `Verdict:` replies.** The pilot emits none, and the owner
  wants capture at the moment of review.
- **A hosted store of learnings**, as CodeRabbit keeps. Rejected again, for the reason in ADR
  0006: it is a hosted service and the owner wants git to be the record.
- **Learning from reactions or from comments left unanswered**, as Greptile documents. A reaction
  carries no reason and silence is not a judgment.
- **Writing the entry into the working tree for the developer to commit with their change.** It
  mixes memory into feature pull requests, where it is approved by being overlooked.
- **`.github/wachiman-memory/`.** The owner's first choice. `.github/` is specific to one host and
  the tool is no longer Actions-only. Kept as open question 1 of the spec.
- **One file with no area files.** A monorepo's memory would be loaded whole into every review.
- **A path set in `.wachiman.yml`.** A fixed path cannot be repointed, and one location is easier
  to find.

## Consequences

- The laptop path needs no new permission, so a repository can use memory before changing its
  workflow.
- The Actions path asks the consumer for `contents: write` in one job and, it is assumed, for the
  repository setting that lets Actions open pull requests. That assumption is checked before the
  job is built.
- The memory pull request is long-lived and can fall behind the default branch. Entries are
  appended, so a rebase is mechanical.
- A repository with one maintainer and required reviews must approve its own memory pull request
  by whatever means it approves anything else.
- Evidence counted across pull requests is not independent when the same agent wrote both
  replies. The owner's approval of the exact text is the control; the evidence list says who
  wrote each reply.
- "Not used in 90 days" finds entries nobody needs, not entries that are wrong. `holds while` is
  the control for those, and it only works when the entry names the right paths.
- `docs/faq.md` says there is "no memory of your repositories", and the website says the same.
  Both become false when layer 2 ships: the FAQ changes in that pull request and the website in
  the same release.

## Non-goals

- A hosted store, or memory shared across repositories.
- Resolving threads ([ADR 0008](0008-thread-follow-up-authority.md) stands).
- Enforcing a lesson as a lint rule or a test.
- Parsing or rewriting hand-written instruction files. They win over memory and stay as they are.

## Reopen when

- The pilot shows the owner approving entries without reading them, or the memory pull request
  staying unmerged for weeks.
- The replay shows no drop in noise, or a real bug lost to memory.
- A consumer on a host other than GitHub, or with many repositories sharing one set of rules,
  needs memory.
- Candidates from engine-checked contracts
  ([pull request 90](https://github.com/niway-dev/wachiman/pull/90)) are accepted as a source.
