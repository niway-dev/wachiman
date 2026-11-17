# ADR 0038: Remove the agent-review name

- **Status:** accepted 2026-11-12 by the owner. Implemented by the pull request that adds this file
  (`refactor/remove-agent-review`). Supersedes decisions 1, 2 and 4 of
  [ADR 0023](0023-one-name-for-every-surface-people-type.md) where they keep `agent-review` alive
  as an alias, and the non-goal of ADR 0023 that left the `AGENT_REVIEW_*` variables and the
  `agent-review sha=` signature unchanged.
- **Date:** 2026-11-12

## Context

The tool was first called `agent-review`. ADR 0023 moved every surface a person types to
`Wachiman`, but it kept the old name working next to the new one: a second bin, a second mention,
a second focus file, the `AGENT_REVIEW_*` variables and the hidden `<!-- agent-review sha=… -->`
signature. Those were kept so a caller written before the rename would not break.

The owner is the only user, and every caller is one of the owner's own repositories. Nothing
outside them depends on the old name, so the compatibility paths protect no one. They cost
something: two names to read in every doc, an alias list the engine and three workflow `if:`
expressions have to keep in step, and an environment prefix that says a name the product no longer
has.

## Decision

1. **The environment variables are `WACHIMAN_*`.** Every `AGENT_REVIEW_<NAME>` becomes
   `WACHIMAN_<NAME>` (for example `AGENT_REVIEW_BUDGET_USD` becomes `WACHIMAN_BUDGET_USD`). The
   engine does not read the old names. No new name collides with an existing `WACHIMAN_*`
   variable (`WACHIMAN_HOME`, `WACHIMAN_PROFILE`, `WACHIMAN_DIR`, `WACHIMAN_CLAUDE_BIN`): none of
   them had an `AGENT_REVIEW_` counterpart.
2. **`wachiman` is the only bin.** `package.json` no longer declares `agent-review`, and the
   version check reads only a package named `wachiman`.
3. **`/wachiman`, `/wachi` and `@claude` are the accepted mentions.** `@agent-review` is removed
   from `MENTION_ALIASES` and from the `if:` expressions of `review.yml`, `review-platform.yml` and
   the copy template.
4. **The focus file is `.github/wachiman.md`.** The `.github/agent-review.md` fallback is removed.
   The `.github/claude-review.md` fallback stays, with its notice.
5. **The review marker is `<!-- wachiman sha=… -->`.** The engine writes it and reads it (still
   next to the older `claude-review` marker). It no longer reads `<!-- agent-review sha=… -->`.
6. **Every other name goes with them**: the `Agent review` workflow name and the repository's own
   caller file (now `.github/workflows/wachiman-review.yml`), the concurrency groups
   (`wachiman-review-<pr>`, `wachiman-review-threads-<pr>`, `wachiman-review-on-demand-<pr>`), the
   scratch directory prefixes, and the copy install folder in the template and the migration page
   (`scripts/wachiman/`). The partial-review sentence no longer says "the agent reviewed".

## Alternatives rejected

- **Keep the aliases and add a deprecation notice.** It is what ADR 0005 did for `CLAUDE_REVIEW_*`.
  With one user and no outside caller, the notice would be read by nobody, and the old name would
  stay in the code for a reason that no longer exists.
- **Read the old variables as a fallback for one release.** Same reasoning, and it would keep the
  prefix in `src/config.ts` and in the tables of `docs/configuration.md`.
- **Keep reading the old signature only.** Every review the owner has open would stay linked, but
  the parser would keep the old name in its regular expression, and open threads are short-lived.

## Consequences

These are breaking changes, marked as breaking (`refactor!`):

- **Environment variables.** Any caller, `.env` file or shell profile that sets `AGENT_REVIEW_*`
  must set the `WACHIMAN_*` name instead. An unchanged old name is ignored without a message, and
  the default applies (for a budget, the default budget).
- **The `@agent-review` mention** no longer starts a run. The comment is ignored.
- **The `.github/agent-review.md` fallback** is gone. A repository that still has that file gets
  reviews without its focus until the file is renamed with `git mv` to `.github/wachiman.md`.
- **Threads from older releases lose their link.** A review whose last line is
  `<!-- agent-review sha=… -->` is no longer recognised as a complete review, so the next push
  or `/wachiman review` reviews the whole pull request again instead of only the new commits.
  The same footer check counts automatic spend and recognises the engine's own review, so on
  such a pull request the `WACHIMAN_AUTO_BUDGET_USD` ceiling starts again from $0, without a
  message, and replies treat that review as not the engine's.
- **The `agent-review` bin** is not installed. A script that calls it must call `wachiman`.
- **Concurrency groups and check names** change. A repository that cancels runs by group name or
  requires the old check by name must follow.
- A copied installation keeps working from the folder it already has; only the template and the
  migration page name the new default folder.
- `CHANGELOG.md`, the ADRs and the specs keep the old name: they are historical records.

## Non-goals

- Renaming the hidden `wachi:` signatures or the `claude-review` marker and focus file. They are
  a different name's fallbacks and stay as ADR 0005 and ADR 0023 left them.
- Migrating existing consumer repositories. The owner updates them when each one moves to this
  release.
- Rewriting history, the changelog or earlier ADRs.

## Reopen when

- A second person or repository outside the owner's is found to depend on the old name: add the
  specific name back as a documented alias, not as a silent fallback.
- A consumer pinned to an older release reports a lost thread that matters: add a one-time reader
  for the old signature.
