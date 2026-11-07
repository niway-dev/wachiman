# ADR 0005: The name Wachi Reviewer and the `/wachi` command

- **Status:** accepted; decision 1 (the name and the repository) is superseded by
  [ADR 0010](0010-name-wachiman.md). The `/wachi` command and everything else here still hold.
  Decision 5 (no GitHub App, no backend) is superseded by
  [ADR 0024](0024-three-modes-one-engine-and-an-identity-only-github-app.md) (proposed
  2026-11-07, not implemented), reopened by the owner before its reopen condition was met.
- **Date:** 2026-10-27

## Context

"agent-review" describes the tool but gives it no identity. The tool is a personal one, used in
the owner's own repositories, so the rename is about a recognisable name and command, not a
product launch. Two facts constrained it:

- `wachi`, `agent-review` and `claude` are all existing GitHub accounts owned by other people.
  An `@` command notifies the account it names in every public repository where it is written.
- GitHub does not redirect `uses:` references to a renamed repository; a caller that still names
  the old repository fails with "repository not found" ([GitHub Docs: Renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)).
  Web URLs and git operations are redirected.

## Decision

1. **The tool is Wachi Reviewer; the repository becomes `niway-dev/wachi-reviewer`.** The
   mascot (a watchman with a cap and a whistle) is in `docs/assets/` and is used in the README and
   as the repository's social preview.
2. **The default command is `/wachi`.** A slash command names no account, so writing it notifies
   nobody. `@agent-review` and `@claude` keep working as aliases. The keyword must start a word,
   so `docs/wachi` or `me@claude` is not a command.
3. **Everything internal keeps its name:** the `AGENT_REVIEW_*` variables, the
   `<!-- agent-review sha=… -->` marker, `.github/agent-review.md`, `scripts/agent-review/`, the
   package and `bin` name, the workflow and job names, and the release-please component. Renaming
   them would add a second layer of aliases for no change a user sees.
4. **The release is a minor one.** Every existing caller and comment keeps working, so this is a
   backward-compatible feature under ADR 0001 decision 3. The only edit a caller needs is the
   repository part of its `uses:` line after the rename; its tag stays as it is.
5. **Reviews keep posting as `github-actions[bot]`.** No GitHub App and no backend.

## Alternatives rejected

- **`@wachi` as the command.** Notifies the owner of the `wachi` account, and a GitHub App cannot
  take a name that an account already has.
- **A GitHub App so comments show the mascot.** One App shared by every consumer needs a service
  holding its private key, which ADR 0001 rules out; an App per consumer is installation work for
  a cosmetic gain.
- **Create a new repository and archive the old one.** Keeps old callers working, but splits
  issues, releases and history across two repositories. With two consumers, both the owner's,
  editing two `uses:` lines is cheaper.
- **Rename every internal name to `WACHI_*`.** Same behaviour, more aliases to carry.
- **A major release for the rename.** Nothing breaks except the repository address, and that
  happens at rename time whatever the version number says.

## Consequences

- Callers pinned to a release before this one accept only `@agent-review` and `@claude`; `/wachi`
  works once they move to this release or later.
- The name appears in two forms: "Wachi Reviewer" for people, `agent-review` in variables and
  files. `docs/cli.md` and `docs/architecture.md` keep the internal names.
- Workflow `if:` conditions match `/wachi` anywhere in a comment, including inside a path; the
  engine then finds no command and exits without calling the agent. Such a run uses a runner
  minute and no model spend.
- If a new repository is ever created as `niway-dev/agent-review`, GitHub's web and git
  redirects to the renamed repository stop.

## Non-goals

- A product launch, a Marketplace listing, a GitHub App or a bot account.
- Removing the `@agent-review` and `@claude` aliases. That would break callers and is a decision
  for a major release.

## Reopen when

- Someone other than the owner installs the tool and needs comments to show who wrote them:
  revisit a GitHub App together with ADR 0001's trust model.
- A major release is planned: decide then whether the aliases and the internal names go.
