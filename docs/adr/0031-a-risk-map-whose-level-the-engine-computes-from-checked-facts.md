# ADR 0031: Every review carries a risk map whose level the engine computes from checked facts

- **Status:** proposed 2026-11-11. **Implemented** by the stack starting at branch
  `feat/risk-map-core`; the thresholds are uncalibrated, and the Martian run of spec open question 6
  has not been done. **Decision 3 is to be superseded, for runs with `--distributed-repo` only,**
  by [ADR 0043](0043-sibling-references-carry-the-member-and-the-commit.md) (proposed 2026-11-13,
  not implemented): a fact may then point into a sibling snapshot as `member@sha:path:line`. Until
  that is implemented, and always without the flag, decision 3 holds. Reuses
  [ADR 0009](0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md) and
  [ADR 0016](0016-data-path-questions-chosen-by-the-engine.md) (the model proposes, the engine
  decides) and [ADR 0030](0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  (result `/2`).
- **Date:** 2026-11-11
- **Spec:** [A risk map on every review, and questions about the change](../specs/2026-11-11-risk-map-and-ask-design.md)
- **Issue:** #170
- **Numbering:** 0031 because `main` holds up to 0030 and open pull requests hold 0014, 0015,
  0017, 0018, 0021, 0022 and 0024 to 0026.

## Context

The owner's direction of 2026-11-11 (#170): few developers write down how dangerous a finished
feature is, and Wachiman has just read the whole change, so it should leave in the pull request
how risky the change is, where a person's judgement is needed and what to keep in mind.

The engine already scores files by path (`RISK_RULES`, `riskScore`, `src/engine.ts:362-385`) to
order batches, and shows the result only as a "Highest risk" number in a collapsed table.

Other reviewers show a score: CodeRabbit an effort 1–5 and a "Merge Risk" level with no published
method ([docs](https://docs.coderabbit.ai/pr-reviews/walkthroughs)), Greptile a 0–5 confidence
([docs](https://www.greptile.com/docs/code-review/first-pr-review)). Greptile reports that
severity scores assigned by the model were nearly random
([blog](https://greptile.com/blog/make-llms-shut-up)). Anthropic sets a tier per change with a
classifier and ties it to approvals
([post](https://claude.dev/blog/solving-code-review-at-anthropic/)).

## Decision

1. Every review renders a **risk map**: a level, the facts behind it, up to three places that
   need a person, and the files to read first.
2. The **level** is `low`, `medium` or `high`, computed by a pure engine function from path rules
   and risk facts. The model never states a level.
3. **Risk facts** are reported by the batch calls the review already makes, as an optional array
   in the batch schema: a kind from a closed list, a path, a line and one sentence. The engine
   drops a fact whose path is not in the review or whose line is past the end of the file at the
   head: the check `contracts` lines get. It is not the diff-line check findings get, so a fact may
   point at a line outside the diff.
4. Findings do not change the level. Files not reviewed turn it into a floor ("at least").
5. The map is not a verdict: it approves nothing, blocks nothing and sets no check status.
6. "Read first" is rendered in every review (owner, 2026-11-11: telling the person where to look
   is the fixed part). A change with no facts and no rule match gets two lines: the level and
   "Read first".
7. The map is an optional `riskMap` field of result `/2` and is absent from `/1`.

## Alternatives rejected

- **The model picks the level or a score.** Cheapest to build. Rejected: not reproducible, cannot
  be tested, and the one published attempt at model-assigned severity found it near random.
- **Path rules only.** Fully deterministic. Rejected: a migration or a permission change in an
  unlisted path would read as low; the rules were written for one consumer.
- **A separate call that writes the map.** Sees the whole change at once. Rejected for now: it
  adds cost to every review. It is the fallback if facts in the batch schema hurt findings
  (spec, open question 6).
- **A number (1–5).** Familiar from other tools. Rejected: a number hides its reasons and invites
  thresholds that turn it into a gate.

## Consequences

- The batch schema grows; one Martian run must show finding quality did not drop.
- Thresholds and the kind-to-level table become constants that need calibration on real merged
  pull requests before release.
- `RISK_RULES` becomes visible to users, so its consumer-specific defaults need review.
- Reviews of trivial changes grow by two lines.

## Non-goals

- Gating merges, requiring reviewers, or any tie to branch protection.
- Repository-configured risk rules (belongs with ADR 0006).
- A whole-PR map recomputed on every incremental push (spec, open question 1).

## Reopen if

- Over 50 reviewed pull requests on consumer repositories, more than 60% get the same level: the
  rule does not discriminate.
- The operator marks risk facts wrong more often than findings.
- The Martian run with facts in the batch schema falls outside the baseline spread.
