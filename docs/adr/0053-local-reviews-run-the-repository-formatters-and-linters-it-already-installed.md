# ADR 0053: Local reviews run the formatters and linters the repository already installed

- **Status:** proposed 2026-11-14. Not implemented.
- **Date:** 2026-11-14
- **Issue:** [NIW2-796](https://linear.app/niway/issue/NIW2-796/wachiman-should-warn-when-a-change-fails-the-repositorys-own-formatter)
- **Spec:** [warn when a change fails the repository's own formatter or linter](../specs/2026-11-14-repository-tooling-check-design.md)

## Context

Until now Wachiman ran nothing from the repository it reviews: the model reads files, and the
engine reads paths and diffs. A change that broke the repository's own formatter passed review
with no finding, because the model is told to skip formatting and cannot run the tool
([kaipu-record#617](https://github.com/niway-dev/kaipu-record/pull/617)). Reading a Markdown table
and deciding whether Prettier would rewrite it is not something a model does reliably.

## Decision

1. `wachiman local` runs the repository's formatters and linters in check mode on the changed
   files, from `node_modules/.bin` (dprint: from `PATH`). It never installs or fetches a tool.
2. A tool whose config executes code runs only when the reviewed range does not touch that config.
   Declarative configs always run.
3. `--fix-format` applies formatter write mode to the files that failed, in the working tree, only
   when the working-tree file equals the reviewed snapshot. It never commits. Linters are never
   auto-fixed.
4. Actions runs no repository tool in this decision.

## Alternatives rejected

- **Prompt only.** Cheap, but the model judging formatting by eye misses exactly the case that
  happened, and false alarms on style are what the prompt rule exists to avoid.
- **Fetch the tool at review time (`bunx <tool>@<version>`).** Works without an install, but adds
  network calls, time and a supply-chain surface to every review, and still needs the version the
  repository pins.
- **Reimplement formatter rules in the engine.** Disagrees with the real tool; only the narrow
  table check of the spec is kept.
- **Run every tool regardless of config type.** Reviewing someone else's branch would execute code
  that branch added.

## Consequences

- Local findings now depend on what the developer has installed; a missing tool shows as "not
  checked", never as a pass.
- A local review takes longer by the tools' run time, bounded at 60 seconds per tool.
- Local and Actions reviews of the same commit can differ by these findings. The run record names
  which tools ran.

## Non-goals

- Running type checkers or tests.
- Grading the consumer's CI jobs.

## Reopen when

- A consumer asks for the same check in Actions and agrees to install dependencies in the review
  job, or
- the tools' run time pushes local reviews past what developers accept before a push.
