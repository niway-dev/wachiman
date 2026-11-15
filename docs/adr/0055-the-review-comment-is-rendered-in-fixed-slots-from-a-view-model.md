# ADR 0055: The review comment is rendered in fixed slots from a view model

- **Status:** proposed 2026-11-14. Not implemented. Amends
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  (the GitHub sink's output was to stay unchanged) and
  [ADR 0030](0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  decision 7 (the Nit/Important word on the label). Keeps
  [ADR 0003](0003-two-axis-finding-labels.md), [ADR 0010](0010-name-wachiman.md),
  [ADR 0012](0012-automatic-thread-replies-and-a-per-pr-ceiling.md),
  [ADR 0031](0031-a-risk-map-whose-level-the-engine-computes-from-checked-facts.md),
  [ADR 0036](0036-a-partial-review-records-the-files-it-did-not-reach-so-the-next-push-resumes.md)
  and the size-gate ADR 0037 intact.
- **Date:** 2026-11-14
- **Spec:** [One fixed layout for every comment Wachiman posts](../specs/2026-11-14-review-comment-layout-design.md)
- **Numbering:** 0055 because open pull requests hold up to 0054.

## Context

The review body grew one section at a time: risk map, outside the diff, for your information,
batch summaries, connects-to, coverage, a footer of eleven values. A survey of 618 posted bodies
(spec, "What is wrong today") found no answer at the top, counts that do not add up, findings to
fix listed only inline, a risk level shown alone, five label axes in each inline title, and
not-reviewed notices without a next step, posted 68 times in three days.

The body is also a contract. The per-PR spend ceiling reads the last `$` of the `<sub>` line
(ADR 0012); `parseLabel` reads the first line of a finding (ADR 0010); size fitting and the 422
fallback look for `<sub>` and `### Summary`; the benchmark parser reads headings, labels and the
footer. About 280 test lines assert on rendered fragments, so every wording change moves them.

## Decision

1. `buildReview` builds a typed view (status, glance rows, finding rows per slot, notices, run
   details, cost line) from the engine's data; one renderer turns it into Markdown. Nothing in the
   view comes from a new model output: the prompt, the schema and the number of model calls do not
   change.
2. The body has fixed slots in a fixed order (spec, "The review body"). An empty slot is omitted,
   never moved. Size fitting drops slots from a named list; the status line, the glance table, the
   Blocker and Fix rows, the needs-a-person slot, the cost line and the hidden markers are never
   dropped.
3. The first line after the brand is a computed status with a fixed precedence: Not reviewed,
   Partial, Blocker, Fix, Needs investigation, none. "before merge" is said only for blockers. No
   status uses a check mark.
4. Counts add up: every severity, Info included, appears in the Findings row with its total.
5. The re-review row shows only what the engine knows: new findings, unresolved bot threads and the
   replies that look addressed. It never says "fixed".
6. Locations link to the file and line at the head SHA, not to review threads.
7. The footer is one `<sub>` line that starts with "<model> via" and ends with the run's cost, and
   adds the Wachiman version; the remaining values go to a "Run details" table above it. Readers of
   the old line keep working on old comments.
8. The inline label is the brand, the severity (emoji and word), the topic (emoji and word, ADR
   0003) and the title. The Nit/Important word is dropped; Pre-existing stays. Confidence and how
   to answer move to a `<sub>` line.
9. A not-reviewed notice states who acts, where, and what this run spent. Only a $0 refusal
   (billing, auth) that is the latest bot notice on the pull request is edited in place; every
   notice that spent money, and every rebase notice, is a new review.
10. The format is checked by golden Markdown files per scenario and by round-trip tests that run
    every reader of a posted comment against new and old bodies. A string assertion that only
    restates the layout is removed when its scenario gets a golden file.

## Alternatives rejected

- **Let the model write the whole comment in a template.** Cheapest to build, but the risk level
  and the grade must not come from the model (ADR 0031, ADR 0033), counts would drift, and output
  tokens would grow on every review.
- **Move the cost to a hidden marker and the whole footer into `<details>`.** Cleaner, but an older
  engine after a rollback, the model reader and the benchmark parser read the `<sub>` line; and the
  owner wants the cost visible without a click.
- **Link findings to their threads.** The review and its comments are created in one request, so no
  thread URL exists when the body is rendered; the 422 fallback has no threads at all. It would
  need a second request per review.
- **Edit every repeated notice in place.** Erases spend the ceiling sums (two paid timeouts would
  count as one) and the head marker a rebase notice must advance.
- **"2 fixed, 1 still open" on re-reviews.** Needs a persistent finding identity the engine does
  not have; the model only judges threads where the author wrote last.

## Consequences

- Readers see the status, what to fix and what to decide before any prose; optional detail is one
  click away.
- A wording change becomes one reviewed diff of golden files instead of edits across ~28 test
  files.
- The benchmarks repository's parser changes in the same release; until it does, comparisons with
  other reviewers would break.
- Comments get slightly longer (about 200 characters per finding listed in the body); the largest
  body seen is about 26k characters of the 60k limit.

## Non-goals

- Changing the prompt, the output schema or the number of model calls. A split finding body with
  suggestion blocks and a one-paragraph summary of the whole pull request are open questions 3 and
  4 of the spec.
- Commenting on failures that leave no way to comment (GitHub unreachable, rate-limited or failing).
- Changing the local loop summary.

## What would reopen this

- A reader of posted comments outside this repository and the benchmarks repository appears and
  cannot follow the new format.
- The engine gains a persistent finding identity, which would allow "fixed" counts and thread links.
- GitHub email or mobile rendering turns out to break the glance table for most readers.
