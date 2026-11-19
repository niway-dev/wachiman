# ADR 0010: The name Wachiman and a brand line on every comment

- **Status:** accepted. Supersedes decision 1 of [ADR 0005](0005-name-wachi-reviewer.md).
  **Decision 2 amended** (2026-11-18) by the [review comment layout spec](../specs/2026-11-14-review-comment-layout-design.md),
  recorded in [ADR 0055](0055-the-review-comment-is-rendered-in-fixed-slots-from-a-view-model.md)
  (proposed, not accepted yet): on an inline finding the brand is the first cell of the table's first row.
- **Date:** 2026-10-31
- **Numbering:** accepted as "ADR 0009" on 2026-10-31. A second record
  ([ADR 0009](0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md)) took the
  same number the same day, so this one was renumbered 0010. The comment above `MENTION_ALIASES` in
  `src/engine.ts` still says "ADR 0009" for the full-name alias; it means this record.

## Context

ADR 0005 named the tool "Wachi Reviewer". "Wachi" means nothing to a reader outside Peru, so the
name does not say what the tool is. The Peruvian *wachimán* (street watchman) comes from the
English "watchman", and it is pronounced almost the same, so "Wachiman" reads as "a watchman for
your repository" in both languages and matches the mascot.

Reviews post as `github-actions[bot]` (ADR 0005 decision 5). Its name and avatar do not say which
tool wrote a comment, so a reader cannot tell a Wachi review from another workflow's comment.

The only consumers are the owner's own repositories, so a repository rename costs two `uses:`
edits and nothing else.

## Decision

1. **The tool is Wachiman; the repository is `niway-dev/wachiman`.** The README says it is
   pronounced *watchman*. `niway-dev/wachiman` was free on 2026-10-31; a personal account named
   `wachiman` exists, but nothing here mentions it.
2. **Every comment the engine posts starts with `👮 **Wachiman**`** on its first line: review
   body, inline finding, thread reply, answer and notice. It is one constant, `BRAND`. On an inline
   finding it is the first cell of the first row of the finding's table (`| 👮 **Wachiman** | <title> |`),
   and `parseLabel` reads the table rows. It is still the start of the one-line label that the
   local sinks print and the model is given.
3. **`/wachi` stays the default command; `/wachiman` is an alias.** The short command is what
   people already type. The workflow's `contains(…, '/wachi')` condition already matches
   `/wachiman`.
4. **Internal names keep theirs,** as in ADR 0005 decision 3, and the `<!-- wachi:… -->`
   signatures too: renaming them would orphan every open thread.

## Alternatives rejected

- **Keep "Wachi Reviewer".** Short, but the name explains nothing without the README.
- **`wachiman-reviewer` as the repository.** Free too, but longer, and `niway-dev/wachiman` is not
  taken, so the suffix buys nothing.
- **`/wachiman` as the default command.** Longer to type, and every existing comment and doc uses
  `/wachi`.
- **A GitHub App or bot account so the avatar shows the mascot.** Same reasons as ADR 0005: it
  needs a service holding a private key, which ADR 0001 rules out.

## Consequences

- Callers must change `niway-dev/wachi-reviewer` to `niway-dev/wachiman` in their `uses:` line;
  GitHub does not redirect `uses:` to a renamed repository. Web and git URLs are redirected.
- Comments posted before this release carry no brand line.
- The name appears as "Wachiman" for people, `wachi` in the command and signatures, and
  `agent-review` in variables and files.

## Non-goals

- Renaming the `AGENT_REVIEW_*` variables, the package, the workflow or the signatures.
- Removing `/wachi` or the older aliases.

## Reopen when

- Someone other than the owner installs the tool: revisit a GitHub App together with ADR 0001.
- The brand line is shown to be noise in a review (for example, readers ask to drop it on inline
  findings).
