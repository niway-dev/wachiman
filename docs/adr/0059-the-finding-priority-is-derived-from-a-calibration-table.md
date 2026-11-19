# ADR 0059: The finding priority is derived from a calibration table

- **Status:** proposed 2026-11-18. Supersedes decision 7 of
  [ADR 0030](0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  (the Important/Nit/Pre-existing display word) once implemented; until then ADR 0030 decision 7
  describes the code. Amends [ADR 0055](0055-the-review-comment-is-rendered-in-fixed-slots-from-a-view-model.md)
  decision 8 on the same terms: the tier word leaves the inline finding's Severity cell, and the
  table gains a Priority row first under the title and a Track record row (decision 5); the thread
  text given back to the model is rebuilt to today's one-line label, so neither row reaches it.
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
95% of the time (56 answered), Fix findings 73% (11, a thin base), Consider at low confidence 56% (25). The model
rarely uses Fix, so most findings an author acts on arrive as "Nit". Confidence separates outcomes;
the word ignores it. A reader who sees only "Nit" also concludes the review was not worth its cost.

## Decision

1. Each finding carries a **priority** (`must`, `should`, `could`, `fyi`) and a **rank** (0–100),
   computed by the engine with `priorityOf(finding, table)`. The model never supplies either.
2. The **calibration table** is versioned data shipped with the engine, keyed by severity ×
   confidence, with topic group as a later key (defect: bug, security, perf; policy: rules, adr;
   quality: tests, docs, cleanup; question). Each cell holds a rank, its sample size, its
   provenance and the table version that set it. A finding with no confidence uses its severity's
   medium cell, for floors too, and is shown as not measured.
3. Must is every Blocker at high or medium confidence. A Blocker or Fix at low confidence is posted
   as a question (ADR 0027) and is at most Could. Info is always FYI. Other words come from rank
   bands, where the rank is 100 × the lower end of the cell's 90% Wilson interval on the judged
   "would act" proportion. The rank is not displayed and gates nothing. In layer 1 every cell is a seed, so its rank is the seed rank of its word (Must 90, Should 70, Could 40, FYI 10). It is stored and orders nothing during the trial (decision 10).
4. Table v1 is keyed by severity × confidence and seeded from the sample; topic group becomes a key
   only for a split cell that is measured. A cell not measured under decision 9 keeps its seed and
   is shown as not yet measured. The seed for unknown cells is Could. Consider at high confidence → Should is an owner-chosen seed, not a fitted one: the 95% fix rate that motivates it measures compliance (decision 9).
5. Each inline finding's table shows a Track record row: what its cell's number measures and on
   how much (in the form `fixed <p>% of <n> answered · <k> PRs · seed`), never as "should act". The observed rate
   is shown whenever its counts and provenance are known; seed or calibrated is said separately.
   In layer 1 the row reads only `no record yet · seed`, and no repository's rates appear in another project's review: the 63-PR sample is the reason for the seeds, never a comment. Every review opens its findings with one line of what was reviewed (counts per priority and at
   high confidence).
6. The table is fitted to warranted action, judged on a random sample (unanswered findings
   included) by a person who does not see the displayed word. Fix, decline and no-answer rates are
   reported beside it and never fitted. A new table is proposed by `wachiman calibrate`, merged in a
   reviewed pull request, and frozen for the release.
7. Precedence: a low-confidence Blocker or Fix is at most Could; Info is FYI; every other Blocker
   is Must; every other Fix on a defect topic (bug, security, perf) is at least Should. A rate only
   raises a priority above its floor.
8. Each cell records the model family and prompt version it was measured on; another
   configuration falls back to the seed and says so.
9. Eligibility and movement are separate. A cell is eligible with n ≥ 20 judgements, accumulated
   across releases, from at least 5 pull requests on a matching configuration. An eligible cell's
   word keeps its current band until the 90% Wilson interval leaves it: it moves up only when the band of the lower end is higher than the word, and down only when the band of the upper end is lower than the word.
   Seeds are set by decision 4, not computed from fix rates, because a fix rate measures compliance.
10. Result `/2` adds `priority`, `rank` and, while the trial runs, `arm` (`word` or `priority`,
   assigned at random once per pull request in the owner's repositories and kept on every push; only
   the word differs between arms, and the order of findings is unchanged in both). Under `arm: word` the comment
   shows today's word, and `priority` and `rank` are still computed and stored for the comparison. `tier` stays, computed exactly as before and marked
   deprecated, until `/3` removes it. Pre-existing is shown as an origin badge beside the priority. `/1` drops `priority`, `rank` and `arm`; the change to the `/2` schema is additive and optional, as `riskMap` and `fidelity` were.
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
  `parseInlineTable` today requires the tier word in the Severity cell; it must accept the cell
  without it, and round-trip tests prove every reader still gets severity, topic and confidence.
  Layer 1 builds on the inline finding table, which is not merged yet.
- Once layer 2 counts outcomes, every review exposes each cell's observed fix, decline and no-answer rates beside the table, which are never fitted to it (decision 6), so a reader can see what happened to findings like the one they read. Until then a comment shows no rate.
- `calibrate` becomes part of the release routine; a release with no new table says so.
- Consumers of `/2` see new fields (`priority`, `rank`, and `arm` during the trial); `tier` keeps its meaning until `/3`.
- Each release costs the owner a blind judging pass (default 40 findings); without it the table
  does not move.
- The only guarantee about cost is no extra model call. Rounds and author effort are measured in
  the trial's A/B, not assumed.

## Non-goals

- Letting an author or agent skip a finding by its priority. Every finding is read and answered;
  the priority tells the reader how much it matters, and the author decides on the merits whether
  it warrants a change.

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
