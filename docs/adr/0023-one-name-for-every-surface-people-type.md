# ADR 0023: One name, Wachiman, for every surface people type

- **Status:** accepted 2026-11-06. Supersedes decision 3 of [ADR 0010](0010-name-wachiman.md)
  (`/wachi` stays the default command) and amends its non-goals for the surfaces listed below.
  The non-goal "renaming the package name" is amended by
  [ADR 0026](0026-the-local-cli-ships-as-an-npm-package.md) (proposed 2026-11-07, not
  implemented): the package becomes `wachiman` when it ships on npm.
- **Date:** 2026-11-06
- **Numbering:** 0023 because open pull requests already hold 0021 and 0022.

## Context

ADR 0010 chose the name Wachiman but kept the older names where renaming looked expensive. The
result is one tool with five names on the surfaces a person actually reads or types: the pull
request command is `/wachi`, the command line is `agent-review`, the caller file is
`agent-review.yml` (a run called "Agent review" in the Actions list), and the repository's focus
file is `.github/agent-review.md`. A developer who sees `/wachi review` in one repository and
`wachiman local` in another has to know that both are the same tool. The workflow name also did
not say whose run it was, which makes it hard to tell which workflow answered a pull request when
a repository runs several (invisible-assistant runs Pullfrog next to Wachiman).

The only consumers are still the owner's repositories, so the cost of renaming is a handful of
files and one pull request each.

## Decision

1. **`/wachiman` is the pull request command.** It is the default `mention`. `/wachi`,
   `@agent-review` and `@claude` keep starting a run and keep being read whatever `mention` is, so
   an old caller, an old habit or an old comment does not break. Only `/wachiman` is documented.
2. **`wachiman` is the command line.** `package.json` declares both bins, `wachiman` and
   `agent-review`. Usage text, error prefixes and docs say `wachiman`.
3. **The caller file is `.github/workflows/wachiman-review.yml`**, from
   `templates/wachiman-review-caller.yml`. Its `name:`, and the three job names of the reusable
   workflow, say "Wachiman" (`Wachiman review`, `Wachiman thread replies`, `Wachiman on demand`).
4. **The focus file is `.github/wachiman.md`.** `.github/agent-review.md` and
   `.github/claude-review.md` are still read, in that order, only when the new file is missing,
   with a notice in the job log.

## Alternatives rejected

- **Keep `/wachi` as the default.** Shorter, but it is the reason a reader needs a glossary. The
  one-line cost of typing four more letters is not worth a second name.
- **Remove the old command words.** A caller pinned to an older release, and any person who types
  `/wachi` by habit, would get a green job that does nothing. Accepting them costs one list entry.
- **A folder (`.github/wachiman/`) for the focus file.** There is one file; ADR 0006 says a policy
  folder is not implemented. A folder is for when there is more than one file to put in it.
- **Rename the reusable workflow path (`review.yml`).** Callers pin it in `uses:`, and GitHub does
  not redirect it. The path is not something a person reads in a run.

## Consequences

- A caller written before this release keeps working unchanged. Renaming its file is cosmetic, but
  must be a `git mv`: a second workflow beside the old one answers every pull request, and the
  repository pays twice.
- The check names change (`Agent review` becomes `Wachiman review`). A required-status-check rule
  on the old name would stop matching; the review is advisory and none is known.
- Docs, tests and the golden prompts say `.github/wachiman.md` and `/wachiman`.

## Non-goals

- Renaming the `AGENT_REVIEW_*` variables, the package name, the hidden `wachi:` and
  `agent-review sha=` signatures or the `~/.wachiman` state. They are not typed by people in a
  comment, and renaming the signatures would orphan every open thread (ADR 0005 decision 3). A
  later release can add `WACHIMAN_*` names that fall back to the old ones, as ADR 0005 did for
  `CLAUDE_REVIEW_*`.
- Renaming the repository's published website and its docs; they live in another repository.

## Reopen when

- A second person installs the tool and asks for the short command: add it as an alias, not as a
  default.
- The old command words are shown to collide with another tool in a consumer's repository.
