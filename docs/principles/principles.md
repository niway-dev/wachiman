# Principles for reliable integration

These are engineering criteria, not measured outcomes. External inspiration is attributed in
the [source register](sources.md); the applications and acceptance questions below are Wachiman's.

## 1. Optimize for useful decisions

More findings are not automatically better. Ask whether a finding changes what the author should
do, and what unnecessary work a wrong finding would cause. Track useful defects, false alarms,
missed defects, review rounds, elapsed time and cost together. Claims of fewer regressions need
observed outcomes after integration, not only review scores.

## 2. Make conclusions inspectable

A finding should identify the relevant code, the conditions that expose the problem and its
consequence. Keep model assertions distinct from checks the engine actually performed. A valid
line reference proves the line exists, not that the model's conclusion is correct.

Current references: [review result formats](../formats/README.md), [precision](../precision.md)
and [the verifier decision](../adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md).

## 3. Bound work and expose uncertainty

Define when another review is worth running and when the loop must stop. A budget, timeout or
round limit is a stop condition, not a success condition. Report unread scope and unresolved
findings. An incremental review must not imply that unchanged interactions were rechecked.

Current references: [`loop`](../cli.md#loop), [its implementation](../../src/loop/command.ts)
and [cost and coverage limits](../costs.md). Provider spending caps may be soft.

## 4. Adapt to a repository without accumulating unquestioned prose

Review knowledge should be scoped, versioned and linked to code. Keep a generated observation
separate from a deliberate maintainer rule. When code changes, check whether its supporting
knowledge is still true. See [repository review memory](repository-review-memory.md) for the
proposed direction; it is not a new feature enabled by this documentation.

## 5. Prefer executable checks where they answer the question

Use tests, schemas, linters and type checks for properties they can enforce. Use model review for
questions needing context and reasoning. A suggestion to add a test is different from executing
one. The review engine is not a substitute for the project's CI.

See [evidence and testing](evidence-and-testing.md) and [what Wachiman will not do](../../README.md#what-it-will-not-do).

## 6. Treat cost as part of quality

An evaluation should record the model, effort, scope, latency and usage alongside correctness.
Savings count only with the quality trade-off visible. Neither free software nor a subscription
means unlimited free inference. Provider-reported dollars are not an invoice.

## 7. Keep the product independent of a provider's identity

Claude Code is the current first-class integration. Wachiman's purpose is broader than that
integration. Additional providers must demonstrate their behavior and limitations with the same
evaluation tasks; they do not inherit another adapter's tool restrictions or cost controls.

The [provider boundary](../../src/providers/types.ts) and [Codex limitations](../../SECURITY.md#codex-is-not-the-workflows-provider)
describe the baseline. GPT, DeepSeek and Gemini expansion is a direction to evaluate, not a
claim of supported parity or a claim about which model is best.

## 8. Preserve human authority and recovery

Wachiman offers evidence and advice. It does not grant approval or decide to merge. Tests,
deployment checks and rollback remain responsibilities of the surrounding engineering process.
Changing those responsibilities requires a separate decision; inspiration from another team's
automation does not authorize it here.

## 9. Add behavior without breaking what is already installed

A new review rule that could change what an existing repository sees, or fail its build, is off by
default and turned on in `.wachiman.yml` by the repository when ready. This is a proposed decision,
not yet in force; see [ADR 0064](../adr/0064-new-review-behavior-is-opt-in-per-repository-and-off-by-default.md).
