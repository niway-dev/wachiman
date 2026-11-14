# ADR 0050: Wachiman owns the PR description template, built from a section catalog

- **Status:** proposed 2026-11-14. Not implemented.
- **Date:** 2026-11-14
- **Issue:** [NIW2-776](https://linear.app/niway/issue/NIW2-776/wachiman-build-install-check-and-format-the-pr-description-template)
- **Spec:** [`wachiman pr-template`](../specs/2026-11-14-pr-template-command-design.md)

## Context

The owner's PR description format, and a Python script that checks it, live in a private skills
repository. Repositories got the template by hand: this one in
[#227](https://github.com/niway-dev/wachiman/pull/227), kaipu-record in
[#617](https://github.com/niway-dev/kaipu-record/pull/617), and two others. The rest never did, and
nothing reports it. Wachiman's own copy tells readers the checker lives in a repository they cannot
open.

Wachiman is not a bystander here. The review writes its summary between
`<!-- wachiman:confidence:start -->` and `<!-- wachiman:confidence:end -->` in the description
(`src/fidelity/digest.ts:9`), and the
[fidelity grade](0033-a-fidelity-grade-the-engine-computes-from-checked-claims.md) checks the
claims the description makes. The template shapes what Wachiman reads and where it writes.

The owner wants a default that works without configuration, and room to customise: a repository
picks which optional sections it uses and may add its own, within limits Wachiman sets.

## Decision

1. **Wachiman owns the template and its checker.** Both ship in the npm package. The owner's
   private skills call `wachiman pr-template` instead of keeping a copy.
2. **The template is generated from a JSON section catalog**, `templates/pr/sections.json`. Every
   section is an entry: kind (status row, section, collapsed block, marked block, footer), its
   heading or label, its guide comment, whether it is in the default, whether it is required, and
   the rule it activates. The Markdown and the checker's rules come from the same entries.
3. **A repository customises with `.github/pr-template.json`**: add catalog sections, drop optional
   ones, add custom sections, and a `preamble` of its own lines. Without the file it gets the
   default.
4. **Some sections are locked**: the Risk status row, `## Needs you`, the Wachiman block and the
   footer. A repository JSON that drops one is a configuration error (exit 2) in every command.
5. **The checker is a TypeScript port of the Python one.** Its fixed lists become catalog entries,
   its rule codes stay, and its test cases become fixtures the port must pass. Its risk rules are
   ported literally, including `.github/pr-risk.toml`; the engine's `RISK_RULES` stay as they are.

## Alternatives rejected

- **Wachiman reads the template from the private skills repository.** A consumer cannot read it.
- **Call the Python script from Wachiman.** Same access problem, and Python is not part of the
  product ([ADR 0002](0002-typescript-on-bun-zero-dependencies.md)).
- **A separate public repository for templates and agent tooling.** It splits the contract between
  the template and the code that reads it, for a consumer who today always has Wachiman. See
  "Reopen if".
- **Rules derived from the Markdown alone** (headings from `##` lines, rows from the table). The
  Markdown cannot say which section is optional or which rule a row activates, so the rules would
  hang on wording in guide comments.
- **A port with fixed lists in code.** A custom template would install but never be checked.
- **GitHub's organisation-level default template.** Applies only where a repository has no file,
  and reports nothing.

## Consequences

- Wachiman's scope grows from reviewing a PR to shaping its description. The README and
  `docs/pr-template.md` say so.
- Two risk tables live in Wachiman until item 5 of
  [NIW2-742](https://linear.app/niway/issue/NIW2-742/wachiman-check-the-description-format-in-ci-grade-every-review-round)
  unifies them. Authentication is High in the template floor and Medium in the engine; CI workflows
  the reverse.
- The owner's private skills depend on a Wachiman version that has the command, and must say which
  version when it is missing.
- A change to the catalog is a Wachiman release. A guide comment can never contain the literal
  breaking-change footer text, because a squash merge copies the description into the commit body.
- A future configurator edits `.github/pr-template.json`; it needs no new format.

## Non-goals

- Checking the description in CI, grading review rounds, team rules.
- Judging whether the description is true. The checker checks structure; the fidelity grade judges
  claims.
- A template language. The catalog is data, not templates with logic.

## Reopen if

- Someone wants the template without Wachiman, or the owner's agent tooling becomes public: then a
  separate repository for templates and agent tooling beats this.
- The catalog cannot express a section a repository needs, twice.
- The engine's risk map becomes the only risk level: then the ported rules go.
