# ADR 0064: New review behavior is opt-in per repository and off by default

- **Status:** proposed 2026-11-22. Builds on
  [ADR 0048](0048-a-repository-settings-file-at-the-root-wachiman-yml.md) (the settings file) and
  [ADR 0049](0049-model-and-effort-in-wachiman-yml-read-from-the-base-commit.md) (the base-commit
  rule for keys that change what a review costs or does). No code changes with this ADR; it governs
  the behavior added after it.
- **Date:** 2026-11-22

## Context

Wachiman runs inside other people's repositories, in their CI, on their pull requests. Each new
review rule is a chance to change what an existing consumer sees: a finding that was not there, a
comment that now blocks, a check that goes red. The consumer did not ask for it and may find out
only when a build fails.

The project already leans this way without having said it. The verifier (`verify`) and PR Confidence
(`pr_confidence`) are off by default ([configuration reference](../configuration.md)), and
`.wachiman.yml` ([ADR 0048](0048-a-repository-settings-file-at-the-root-wachiman-yml.md)) exists so
a repository can carry its own choices. What is missing is the rule: nothing says that a new
behavior must start off, so the next one could ship on by default.

The first case is the comment rule from
[NIW2-902](https://linear.app/niway/issue/NIW2-902), part B: source comments are allowed only as
pointers to documentation. Repositories that comment freely would see a new class of findings
overnight. The rule suits some codebases and would be noise in others.

## Decision

1. **A new review rule or behavior that could change what an existing consumer sees, or fail their
   build, ships behind a `.wachiman.yml` setting that is off by default.** "Could change what they
   see" includes a new finding class, a new check, a stricter existing check, a different comment
   layout that tooling may parse, and a new failing exit code.
2. **The consumer turns it on.** Upgrading Wachiman alone never changes a repository's reviews
   beyond bug fixes and the settings it already chose.
3. **The setting is read like the other keys of the file**: from the base commit in Actions and from
   the merge-base locally ([ADR 0049](0049-model-and-effort-in-wachiman-yml-read-from-the-base-commit.md)),
   so a pull request cannot switch a rule off for itself.
4. **Wachiman's own repository turns a flag on first**, for itself, and uses it before any consumer
   is asked to. A flag is not offered to others as ready until it has run here.
5. **Each flag ships with a test of the off state** that proves a repository without the setting
   gets the same review as before, and the changelog entry says how to turn the behavior on.
6. **What is exempt:** bug fixes, security fixes, and changes with no visible effect on a review
   (internal refactors, documentation, speed). A fix to a behavior a consumer relies on still needs
   a changelog note.
7. **First application:** the NIW2-902 comment rule (part B) is an opt-in setting, off by default.
   Its key name and exact wording are decided in that change, not here.

## Alternatives rejected

- **On by default, with an opt-out.** Fewer settings to discover and every consumer gets
  improvements at once. Rejected because the cost of a surprise lands on the consumer (a failed
  build, noisy threads) while the benefit is the maintainer's; an opt-out is only used after the
  damage is seen.
- **A global "strict" switch.** One setting that enables every new behavior is easy to explain.
  Rejected because it bundles unrelated rules: a consumer who wants one cannot take it without all
  the others, and every release would silently change what "strict" means.

## Consequences

- Every new flag costs a settings key, a documentation entry and an off-state test. Adoption of a
  good rule is slower, because it spreads one repository at a time.
- The configuration reference grows with each flag; it must say the default and what turning it on
  changes.
- A flag that is never turned on by anyone is dead weight. Wachiman's own repository using it first
  (decision 4) is the cheap signal that a flag is worth keeping.
- Settings that already ship on by default are not changed by this ADR.

## Non-goals

- Deciding the key names, wording or severity of any particular rule.
- A remote or per-organization settings service. The file stays in the repository.
- Gating bug and security fixes behind flags.
- Removing a flag once a behavior is widely used. Making a flag's behavior the default is a
  separate decision, with a changelog note and a release type that change warrants.

## Reopen when

- Consumers routinely ask for new behavior to be on without configuring it, so that the number of
  flags a repository must set becomes the main friction; or
- a flag turns out to hide a security or correctness behavior consumers should always have, in which
  case that behavior moves out of the flag by its own ADR.
