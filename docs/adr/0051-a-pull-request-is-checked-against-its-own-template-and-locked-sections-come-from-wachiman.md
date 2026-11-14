# ADR 0051: A pull request is checked against its own template; locked sections come from Wachiman

- **Status:** proposed 2026-11-14. Not implemented.
- **Date:** 2026-11-14
- **Issue:** [NIW2-776](https://linear.app/niway/issue/NIW2-776/wachiman-build-install-check-and-format-the-pr-description-template)
- **Departs from:** the base-commit rule of [ADR 0006](0006-repository-review-policy.md), for
  description format only.

## Context

`wachiman pr-template check` builds its rules from the catalog and the repository's
`.github/pr-template.json` ([ADR 0050](0050-wachiman-owns-the-pr-description-template-built-from-a-section-catalog.md)).
A PR can change that JSON. Which version applies to that PR's own description?

Reading from the base commit, as [ADR 0006](0006-repository-review-policy.md) does for review
policy, means a PR cannot weaken the rules it is judged by. But it also means a PR that changes
the template cannot show the new template working: its description, written in the new shape,
fails the old rules. The owner's position: whoever changes the template in a PR wants to see the
change before merging it.

GitHub pastes the template from the default branch into new PRs, so the new template only appears
in PRs opened after the merge
([GitHub docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)).

## Decision

1. **The check uses the PR's own `.github/pr-template.json`.** With a file and no PR, it uses the
   working tree.
2. **Locked sections and the risk rules come from Wachiman**, never from the repository: the Risk
   row, `## Needs you`, the Wachiman block and the footer are required whatever the JSON says, and
   the risk floor is computed by Wachiman's rules plus `.github/pr-risk.toml` from the base commit,
   where patterns can only raise the level.
3. **An invalid head JSON fails the check** with exit 2: one that does not parse, names an unknown
   section, or drops a locked one. The check never falls back to the base or the default.
4. **When the PR changes `.github/pr-template.json`, the output says so** in its first line:
   `checked against the template in this pull request`, followed by what the base version would
   have reported differently.

## Alternatives rejected

- **Base commit only.** Safe, but a template change can never pass its own PR in the new shape; the
  owner rejected it.
- **Pass if either version passes.** Hides which rules applied.
- **Head only, with nothing locked.** A PR could drop the Risk row and the footer in the same PR
  whose description lacks them.

## Consequences

- A PR can relax an optional section for itself. That is visible in the diff and in the check's
  first line, and the review sees the JSON change like any other file.
- `.github/pr-risk.toml` is read from the base, so a PR cannot lower its own risk floor by editing
  it.

## Non-goals

- Model, effort or spend settings. Those keep the base-commit rule (ADR 0006, and ADR 0049 in open
  PR [#234](https://github.com/niway-dev/wachiman/pull/234)).

## Reopen if

- The check runs in CI for a team where the author and the approver differ: then the base version
  may need to gate and the head version only preview.
- A PR is observed passing because it relaxed its own template in a way the reviewer missed.
