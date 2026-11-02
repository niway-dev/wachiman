# ADR 0017: Anthropic models only, and a spend tier instead of model inputs

- **Status:** proposed 2026-11-02. Not implemented. **Supersedes
  [ADR 0004](0004-codex-provider.md)** (the Codex provider).
- **Spec:** [review depth, model tiers and memory](../specs/2026-11-02-review-depth-model-tiers-and-memory-design.md)
- **Issue:** #79
- **Evidence:** [results so far](../benchmark/results.md),
  [E1](../benchmark/2026-11-02-e1-sonnet/README.md)

## Context

The reusable workflow exposes `model`, `effort` and `provider` as inputs, beside five budget
inputs and two safety stops. The engine defaults to Sonnet 5.5; kaipu-record overrides it to Opus
5.5 at effort `high`; every other consumer gets whatever the default is on the day they install.
Three combinations have ever been measured (v1.3.0 and v1.4.0 on Opus `high`, v1.4.0 on Sonnet
`high`). The inputs allow dozens, and a consumer who picks one gets numbers nobody has seen.

ADR 0004 added a second provider, Codex, on the argument that a reviewer from another model family
avoids the author's blind spots. Since then three benchmarks have located Wachiman's blind spots
precisely: on data-moving pull requests it draws the wrong conclusion from evidence it cites, on
both Anthropic models. Nothing measured says a different family would draw the right one, and the
owner is the only operator. Keeping Codex costs a second price table, a second sandbox posture
with a higher residual risk (ADR 0004's own consequence), and a second cache that cannot be shared.

The owner's position, 2026-11-02: be opinionated. Use Anthropic, decide the models in the engine,
and let the consumer choose at most how much to spend.

## Decision

1. **Anthropic models only.** The engine's supported provider is Claude Code. The `provider`
   input leaves the workflow, and `docs/providers/codex.md` leaves the docs in the same release.
   The Codex adapter may stay in the tree until removing it is convenient, but no release documents
   it as supported.
2. **The consumer chooses a tier, not a model.** One input, `tier`, with values `economy`,
   `standard` and `deep`. The `model` and `effort` inputs leave the workflow. A tier fixes the
   reader's model and effort, whether a judge runs, and the judge's model and effort.
3. **The tier never sets dollars.** `budget_usd`, `auto_budget_usd` and the per-call caps stay
   workflow inputs, as ADR 0001 decision 6 requires. The tier shapes the spend; the budget bounds
   it.
4. **Model and effort are explicit per role and printed in the footer,** like cost. Effort is
   always passed to the provider, never inherited from the binary's default, because the default
   has changed between Claude Code releases and Opus 5.5's own default (`medium`) is below what
   the judge needs.
5. **The judge never runs below effort `high`.** The role that decides is not cheapened. Reader
   effort is whatever the tier's measurement supports.
6. **Tier contents change only with a measured replay** on the benchmark sets, registered before
   the run, and every change is a release note. The initial contents are placeholders named in
   the spec until E0 and E1b have run.

## Alternatives rejected

- **Keep `model` and `effort` as inputs and add `tier` as a preset.** Two ways to say one thing;
  the preset would be ignored by anyone who had already set a model, and the measured numbers
  would stop describing what consumers run.
- **A dollar amount as the only knob, with the engine picking models to fit it.** A budget says
  how much, not what kind of review; two consumers with the same budget and different PR sizes
  would get different models without knowing. The budget stays a cap.
- **Keep Codex for an adversarial second pass.** No measurement shows a second family finds what
  the first misses, and the engine would carry two providers for one consumer who uses one.
  Reopen condition below.
- **Let the consumer name the model but validate it against a list.** Still a model list in the
  consumer's YAML, which goes stale with every model release.

## Consequences

- A consumer who set `model: claude-opus-5-5` and `effort: high` moves to `tier: deep` and gets the
  same reader. The upgrade note says so.
- The engine's price table and model names live in one place (`src/providers/index.ts`) and
  change by pull request, so every benchmark can name the exact models it ran.
- ADR 0004's security probes for Codex become dead documentation and are removed with it.
- Codex users of the CLI lose a supported path. The owner is the only known one.

## Non-goals

- Supporting another provider behind the same tier names.
- A per-repository tier in the policy folder (ADR 0006 keeps budgets and models out of it).
- Choosing the tier automatically from the diff.

## Reopen when

- A registered replay on the benchmark sets shows a non-Anthropic model finding real Medium+ bugs
  that the `deep` tier misses, at a comparable cost.
- Anthropic's pricing or effort semantics change so that a tier's measured numbers no longer hold,
  and the re-measurement does not fit the three names.
- A second operator with a different provider contract appears.
