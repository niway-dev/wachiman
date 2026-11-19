# ADR 0059: The finding priority is derived from a calibration table

- **Status:** proposed 2026-11-18. Supersedes decision 7 of
  [ADR 0030](0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  (the Important/Nit/Pre-existing display word) once implemented; until then ADR 0030 decision 7
  describes the code. Amends [ADR 0055](0055-the-review-comment-is-rendered-in-fixed-slots-from-a-view-model.md)
  decision 8 on the same terms: the word in the inline finding's severity cell becomes the priority.
  Builds on [ADR 0003](0003-two-axis-finding-labels.md), and applies to findings the reasoning
  [ADR 0031](0031-a-risk-map-whose-level-the-engine-computes-from-checked-facts.md) used for the
  risk-map level: the model does not pick the level, and a number does not become a gate. Design: [calibrated finding priority spec](../specs/2026-11-18-calibrated-finding-priority-design.md).
- **Date:** 2026-11-18

## Context

ADR 0030 decision 7 derives one display word per finding: Pre-existing for that origin, Important
for Blocker and Fix, otherwise Nit. The words follow Claude Code's review format. Confidence and
topic play no part.

A five-day sample of remote reviews on one private repository (63 pull requests, counts only, in
the spec) shows the word misleads where it matters: Consider findings at high confidence were fixed
95% of the time (56 answered), Fix findings 73% (11), Consider at low confidence 56% (25). The model
rarely uses Fix, so most findings an author acts on arrive as "Nit". Confidence separates outcomes;
the word ignores it.

## Decision

1. Each finding carries a **priority** (`must`, `should`, `could`, `fyi`) and a **rank** (0–100),
   computed by the engine with `priorityOf(finding, table)`. The model never supplies either.
2. The **calibration table** is versioned data shipped with the engine, keyed by severity ×
   confidence × topic group (defect: bug, security, perf, rules, adr; quality: tests, docs,
   cleanup; question). Each cell holds a rank, its sample size and the table version that set it.
3. Must is every Blocker at high or medium confidence. A Blocker or Fix at low confidence is posted
   as a question (ADR 0027) and is at most Could. Info is always FYI. Other words come from rank
   bands, where the rank is 100 × the lower end of the cell's 90% Wilson interval on the judged
   "would act" proportion. The rank sorts findings, is not displayed, and gates nothing.
4. Table v1 is keyed by severity × confidence and seeded from the sample; topic group becomes a key
   only for a split cell that is measured. A cell not measured under decision 9 keeps its seed and
   is shown as not yet measured. The seed for unknown cells is Could.
5. Each posted finding shows, in its body and never on the title line, what its cell's number
   measures and on how much (`fixed 95% · n 56 · 12 PRs`), never as "should act".
6. The table is fitted to warranted action, judged on a random sample (unanswered findings
   included) by a person who does not see the displayed word. Fix, decline and no-answer rates are
   reported beside it and never fitted. A new table is proposed by `wachiman calibrate`, merged in a
   reviewed pull request, and frozen for the release.
7. A rate only raises a priority above a floor: Blocker at high or medium confidence is Must, Fix
   on a defect or security topic at high or medium confidence is at least Should.
8. Each cell records the model family and prompt version it was measured on; another
   configuration falls back to the seed and says so.
9. The single minimum-sample rule: a cell is measured only with n ≥ 20 judgements, accumulated
   across releases, from at least 5 pull requests and a 90% Wilson interval
   whose lower end clears the band; a word moves only when the interval crosses the band edge.
10. Result `/2` adds `priority` and `rank`. `tier` stays, computed exactly as before and marked
   deprecated, until `/3` removes it. Pre-existing is shown as an origin badge beside the priority.
11. The review loop's stop rule keeps reading severity (ADR 0034).

## Alternatives rejected

- **Keep Important/Nit.** Two words cannot say "almost always fixed, not blocking", and "Nit"
  tells the reader to skip findings the data says get fixed.
- **A fixed four-word table in code.** Simple, but goes stale silently when the model, the prompt
  or the repository changes, and has no way to learn.
- **A model-assigned score or level.** For the risk-map level, ADR 0031 rejected both a
  model-picked level and a number that thresholds turn into a gate. The same holds here; a
  displayed number would also look precise without being so.
- **Recalibrating only the prompt (Fix versus Consider).** Kept as a separate, measured layer; on
  its own it still trusts the model's severity.
- **Ranking by fix rate alone.** An agent author fixes almost everything, so fix rate measures
  compliance. Verdicts and owner decisions lead.

## Consequences

- Titles and footers change words; golden files and any reader of the title text must follow.
  `precision.ts` reads confidence anchored to the end of the title line, so the cell rate goes in
  the body (decision 5) and golden files prove the parser still reads every label.
- Every review exposes per-cell rates, so the table can be checked by anyone reading a comment.
- `calibrate` becomes part of the release routine; a release with no new table says so.
- Consumers of `/2` see two new fields; `tier` keeps its meaning until `/3`.
- Each release costs the owner a blind judging pass (default 30 findings); without it the table
  does not move.
- The only guarantee about cost is no extra model call. Rounds and author effort are measured in
  the trial's A/B, not assumed.

## Non-goals

- Changing the stop rule, the loop budget or what the model is asked to find.
- Dropping or capping findings by priority before posting.
- Per-repository tables before their cells reach the minimum sample.

## Reopen when

- After two calibrations, displayed words separate outcomes no better than severity alone
  (fixed % of Should not at least 15 points above Could); or
- agent and owner outcomes disagree so much per cell that one table cannot serve both; or
- a consumer needs `tier` removed before `/3`; or
- on held-out repositories or a later model, the words predict blind judgements no better than
  confidence alone; then show confidence and severity without a derived word.
