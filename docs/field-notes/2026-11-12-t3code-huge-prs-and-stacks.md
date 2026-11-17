# t3code: huge PRs, stacks and a cost refusal

- **Date:** 2026-11-12.
- **Repository observed:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Read-only; we
  never commented there.
- **Source data:** pull request figures read from GitHub on 2026-11-12, and the bug history in
  [wachiman-benchmarks `t3code/catalogue.md`](https://github.com/niway-dev/wachiman-benchmarks/blob/main/t3code/catalogue.md).
- **Status:** observations, and the decisions they led to. Each decision is marked below.

## In one minute

t3code merges pull requests of every size, from one line to hundreds of thousands. One merged PR
added 380,729 lines. A stack of six open PRs adds about 100,000 more. Its reviewer, Macroscope,
refused one of them because the review would cost more than the repository's limit. Our own local
run could not even snapshot the repository. Each case below is a place where a reviewer, ours
included, has to decide what to do with a diff that is too big to read in one pass.

## 1. One PR of 380k added lines

[pingdotgg/t3code#2829](https://github.com/pingdotgg/t3code/pull/2829), "feat(orchestrator):
introduce new orchestrator", merged on 2026-10-02 into `main`.

- GitHub reports +380,729 / −203,651 lines in 1,912 files.
- Macroscope left 816 inline comments across 182 reviews, and its approvability comment says
  **Not approved**, with "452 blocking correctness issues found at or above your repo's Minimum
  Blocking Severity".
- CodeRabbit left one summary comment, no inline comments and no review.
- It merged anyway.
- Our catalogue traces two later bugs to it: `effect-worker-title-generation-starvation` and
  `codex-compaction-reinject-loop`. Both are marked not replayable, because the introducing change
  is a 1,912-file rewrite.

## 2. A stack of six PRs, about 100k added lines

Six open PRs of one redesign, each based on the branch of the one before it. Together they add
99,924 lines.

| PR | Added / removed | Files | Based on |
| --- | --- | --- | --- |
| [#28839](https://github.com/pingdotgg/t3code/pull/28839) | +16,005 / −8,180 | 607 | `main` |
| [#28840](https://github.com/pingdotgg/t3code/pull/28840) | +15,048 / −4,729 | 182 | the branch of #28839 |
| [#28841](https://github.com/pingdotgg/t3code/pull/28841) | +9,714 / −5,265 | 131 | the branch of #28840 |
| [#28842](https://github.com/pingdotgg/t3code/pull/28842) | +12,651 / −7,433 | 213 | the branch of #28841 |
| [#28844](https://github.com/pingdotgg/t3code/pull/28844) | +432 / −169 | 15 | the branch of #28842 |
| [#28845](https://github.com/pingdotgg/t3code/pull/28845) | +46,074 / −12,632 | 606 | the branch of #28844 |

On #28839 Macroscope said its review "covered a limited subset of the changed files because a full
diff was unavailable". It posted two inline findings and said this "is not a complete review of
all in-scope changes".

## 3. A reviewer that refuses on cost

On [#28845](https://github.com/pingdotgg/t3code/pull/28845) Macroscope skipped the review: "This
review would cost an estimated $35.38, which exceeds your per-review limit of $15.00."

Our catalogue traces one escaped bug to that PR: `pane-slide-subpixel-move-crash`, fixed in
[pingdotgg/t3code#33534](https://github.com/pingdotgg/t3code/pull/33534).

The same refusal text appears on #2829, with an estimate of $34.58, although that PR also carries
the manual reviews counted in section 1.

## 4. A repository too large for our own snapshot

Local Wachiman runs on t3code (31.9k files, 660 MB) failed before any model call with a raw
`ETIMEDOUT`. See [niway-dev/wachiman#193](https://github.com/niway-dev/wachiman/issues/193). It was
fixed by [niway-dev/wachiman#195](https://github.com/niway-dev/wachiman/pull/195).

## 5. Volume

[niway-dev/wachiman-benchmarks#23](https://github.com/niway-dev/wachiman-benchmarks/pull/23)
reviewed 791 merged PRs in t3code from 2026-11-06 to 2026-11-11. That is about 132 a day on
average. The busiest day was 203 and the quietest 56. The per-day counts are in the catalogue
linked above.

## What this means for Wachiman

- **Cost gate. Decided 2026-11-12, implementation in progress (PR pending).** Estimate the cost
  before reviewing. Above the gate, Actions skips the review with one comment, and the workflow
  yml can raise the gate. Local runs only warn.
  - Our own estimate for #28845 is about 59 batches of 1,000 lines at $0.60–0.75 each, so
    $35–45. This is an estimate, not measured.
- **Stacks. Open.** Each layer is reviewed against its parent branch
  ([`docs/review-policy.md`](../review-policy.md)), so nothing reviews the seams between layers.
  Two ideas: carry contracts and findings from lower layers upward, and review the files touched
  by more than one layer.
- **Storage. Open.** Per-PR storage does not scale to this volume if it lives in the repository.
  Idea: feature-scoped memory.
