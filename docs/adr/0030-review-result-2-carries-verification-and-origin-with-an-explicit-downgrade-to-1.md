# ADR 0030: Verified findings use result /2 with explicit origin and a committed-only /1 downgrade

> **Default configuration update 2026-11-10:** The default is now Opus 5.5 at effort `high`, with verification off. Enable verification explicitly with `verify: true`, `AGENT_REVIEW_VERIFY=1`, or `local --verify`. This supersedes statements below about the 2026-11-09 defaults; historical decisions remain for context.

> **Default configuration update 2026-11-12:** The default reviewer is now Sonnet 5.5 at effort `high` (verification still off, verifier model still Opus 5.5). Reason and data: https://github.com/niway-dev/wachiman-benchmarks/blob/main/martian/models.md.

- **Status:** accepted 2026-11-09; implemented by slice 2 of the CLI plan (branch
  `feat/verified-result-v2`), with working-tree results implemented by slice 6 (`feat/cli-working-tree`); except base evidence in GitHub
  mode, whose shallow credential-free checkout (ADR 0011) has no base commit. Amends the verifier
  contract proposed in [PR #138](https://github.com/niway-dev/wachiman/pull/138); whichever design
  lands second must cross-reference the other Status line. Reuses
  [ADR 0003](0003-two-axis-finding-labels.md) and
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md).
- **Date:** 2026-11-09
- **Spec:** [canonical design](../specs/2026-11-09-cli-and-verified-reviews-design.md),
  [types §5](../specs/2026-11-09-review-and-config-types.md),
  [command contract](../specs/2026-11-09-cli-command-contract.md).

## Context

The existing /1 root and provider schema are closed. The verifier implementation on
feat/findings-verifier adds a root verification block and uses confirmed/unconfirmed/refuted.
A new result shape cannot be emitted as /1. The owner wants familiar report labels, explicit
verification and the same procedure in local and Actions. A real pre-existing bug must not be
hidden as a refutation; unknown causal origin must not be invented.

## Decision

1. Introduce wachiman.review-result/2 with the exact contracts in types §5. Severity remains
   blocker/fix/consider/info; origin is introduced/pre-existing/unknown. Each finding has
   verification status supported/refuted/inconclusive/unverified, a short reason and citations
   qualified as base or head. provider.account contains only a local label/kind/resolution rung,
   not filesystem paths or account identity. No new keys/retyped values enter /1.
2. Committed JSON reports retain /1 as their default. --result-version 2 opts into /2;
   --result-version 1 explicitly downgrades committed results. A future default switch needs
   a separately announced major release. Working-tree reports require /2; refuse a requested /1
   before provider calls. Never disguise a tree id as a branch commit.
3. A single bounded verifier call follows coverage merge/dedupe in the shared review core.
   Reuse the existing reserve min(verifyBudgetUsd,totalBudgetUsd/2), default configured reserve
   $1, existing DEFAULT_VERIFIER_MODEL and effort high. No retry/fan-out/recursive investigation;
   verification is on by default, as the owner decided on 2026-11-09 (the amendment to
   [ADR 0027](0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md));
   the benchmark gate checks that default, it no longer conditions it. Off with `verify: false`,
   `AGENT_REVIEW_VERIFY=0` or `local --no-verify`. All cost/usage/calls/turns
   count in execution totals on the same account as coverage.
4. The falsifier investigates original code, not a reviewer summary. Provide immutable head and
   a lazily materialised base snapshot once per review when candidates exist. Validate citation
   paths/positive lines and containment against the declared snapshot. Existing code at a cited
   line proves reference existence, not correctness of the model's semantic argument. A refutation's
   disproof must be a line of the head snapshot; a base-only disproof degrades it to inconclusive.
5. supported requires rationale plus checked evidence. refuted additionally requires an existing
   disproof; invalid evidence/duplicates/missing verdicts become inconclusive and never remove
   a finding. Unknown candidate ids are ignored. Only complete schema-valid response envelopes
   are used; never salvage arbitrary truncated JSON. A true bug predating the change remains
   supported with origin pre-existing. Unknown attribution remains unknown, including when
   base evidence is unavailable or only an unchanged line was observed.
6. Preserve usable verdicts on budget/quota/turn/timeout stops; unanswered selected candidates
   remain inconclusive with the stop reason. Batch status is verified when every candidate has
   a usable verdict (not proof that all bugs are true), partial when only some do, failed when
   none do, skipped when enabled but no allowance permits a call, and nothing for no candidates.
   Disabled verification leaves findings unverified. Keep inconclusive findings visibly separate;
   preserve the existing low-confidence question rule without claiming they were verified Nits.
7. One derived display function emits Pre-existing for that origin, Important for blocker/fix,
   otherwise Nit; retain severity/topic/confidence independently. Pre-existing findings appear
   in the GitHub review body. Provide the evidence-linked reason, not private chain-of-thought.
8. toResultV1 removes /2-only fields, keeps surviving findings and writes one textual summary
   into existing execution.notices. Validate against the published /1 schema. History readers
   accept both embedded versions and preserve unknown future versions without corruption renames.
   Working-tree history retains explicit base-commit/tree metadata and never queries commit
   ancestry for a tree id. Coordinate benchmark consumers before using /2 there.

## Alternatives rejected

- Adding top-level verification to /1: existing validators reject it.
- Switching JSON defaults in a minor feature release: breaks existing consumers unnecessarily.
- Treating unchanged lines as pre-existing proof: changed callers can make old code fail.
- Reporting supported because refutation failed without evidence: absence of disproof is not proof.
- Dropping all findings on verifier failure, or presenting them as verified: both lose information.
- Treating pre-existing as a severity: a pre-existing bug can still be a blocker.
- A second local-only review orchestrator: doubles contracts and makes evaluations nonportable.

## Consequences

Extend the existing verifier, not a parallel implementation. Update schemas, result serializers,
sinks/history and parity checks together. Base materialisation adds local I/O only when needed;
it does not entail a whole-repository model pass. Reference validation does not guarantee model
truth. No quality/cost advantage is claimed without measured comparison.

## Non-goals

Automatic fixes/issue publication, unbounded agents, changing the coverage prompt, enabling
verification by default before the existing benchmark gate, or proving competitive superiority.

## Reopen when

Measured refutation accuracy/recall loss does not justify the additional work; base evidence
cannot be supplied under the current provider boundary; or a consumer needs a deliberate major
wire-format/default change. New required/retyped wire semantics require explicit version review.
