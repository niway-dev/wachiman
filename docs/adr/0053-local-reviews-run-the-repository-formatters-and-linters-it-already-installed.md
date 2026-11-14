# ADR 0053: Local reviews run the formatters and linters the repository already installed

- **Status:** proposed 2026-11-14. Not implemented.
- **Date:** 2026-11-14
- **Issue:** [NIW2-796](https://linear.app/niway/issue/NIW2-796/wachiman-should-warn-when-a-change-fails-the-repositorys-own-formatter)
- **Spec:** [warn when a change fails the repository's own formatter or linter](../specs/2026-11-14-repository-tooling-check-design.md)
- **Numbering:** 0053 because `main` holds up to 0049 and open pull request #238 holds 0050 to
  0052.
- **Relates to:** [ADR 0034](0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md),
  which this narrows with one exception (decision 3) and does not supersede.

## Context

Until now Wachiman ran nothing from the repository it reviews: the model reads files, and the
engine reads paths and diffs. A change that broke the repository's own formatter passed review
with no finding, because the model is told to skip formatting and cannot run the tool
([kaipu-record#617](https://github.com/niway-dev/kaipu-record/pull/617)). Reading a Markdown table
and deciding whether Prettier would rewrite it is not something a model does reliably.

## Decision

1. `wachiman local` runs the repository's formatters and linters in check mode on the changed
   files, from the checkout's root with its own `node_modules/.bin`, configs and plugins. It never
   installs or fetches a tool.
2. It does so by default only on the developer's own work: a working-tree review, or a range whose
   commits are all authored by the configured `user.email`. Any other range needs
   `--run-tooling`. `--no-tooling` turns the step off.
3. `--fix-format` applies formatter write mode to the files that failed, in the working tree, only
   when the working-tree file equals the reviewed commit. It never commits. Linters are never
   auto-fixed, and `loop` never passes the flag. This is the one exception to ADR 0034's "the CLI
   never edits code": the output is the repository's own tool's, not a review fix.
4. Actions runs no repository tool in this decision.

## Alternatives rejected

- **Prompt only.** Cheap, but the model judging formatting by eye misses exactly the case that
  happened, and false alarms on style are what the prompt rule exists to avoid.
- **Fetch the tool at review time (`bunx <tool>@<version>`).** Works without an install, but adds
  network calls, time and a supply-chain surface to every review, and still needs the version the
  repository pins.
- **Reimplement formatter rules in the engine.** Disagrees with the real tool; only the narrow
  table check of the spec is kept.
- **Gate on "the tool's config did not change".** A JSON config can name plugins and a JavaScript
  config can import local rule files; a changed plugin or rule file passes that gate and runs.
  Gating on whose commits they are is simpler to state and covers those files.
- **Run in the review snapshot.** The snapshot is an extracted archive with no `node_modules`, so
  every tool would read "not installed" or resolve plugins from somewhere unchecked.

## Consequences

- Local findings now depend on what the developer has installed; a missing tool shows as "not
  checked", never as a pass.
- A local review takes longer by the tools' run time, bounded at 60 seconds per tool.
- Local and Actions reviews of the same commit can differ by these findings. The summary and the
  result's `tooling` array name every detected tool and its outcome.
- The consent rule trusts commit author emails, which can be forged. It prevents running a
  colleague's code by accident, not a deliberate forgery.

## Non-goals

- Running type checkers or tests.
- Grading the consumer's CI jobs.

## Reopen when

- A consumer asks for the same check in Actions and agrees to install dependencies in the review
  job, or
- the tools' run time pushes local reviews past what developers accept before a push, or
- a consumer reports that the consent rule blocks a normal workflow (pair commits, rebased
  branches with co-authors).
