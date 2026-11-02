# Benchmark results so far

Every measurement of Wachiman against Pullfrog and CodeRabbit, in one place, with the pull request
and the runs behind each number. Newest first. Each line links to the full report; this page makes
no claim the reports do not.

- **Last updated:** 2026-11-02 (field run added).
- **The five PRs:** kaipu-record #463–#467, replayed at their exact commits
  ([method](../specs/2026-10-31-review-benchmark-design.md)). Every finding in a replay was
  checked against the code by reading, not by running the app.
- **The fair measure:** the 14 real bugs of severity Medium or higher found on these PRs by any
  reviewer, with the author's later fix where one exists
  ([list](2026-11-01/README.md#the-real-bugs-severity-medium-or-high)).

## Headline

| | Wachiman 1.3.0 · Opus | Wachiman 1.4.0 · Opus | Wachiman 1.4.0 · Sonnet | Pullfrog | CodeRabbit |
| --- | --- | --- | --- | --- | --- |
| Runs | 3 | 3 | 3 | 2 | 2 |
| Real Medium+ bugs per run (of 14) | 0, 3, 1 → **1.3** | 7, 7, 8 → **7.3** | 6, 5, 5 → **5.3** | 3, 4 → **3.5** | 2, 3 → **2.5** |
| Distinct real Medium+ bugs, all runs | 3 | **11** | 9 | 5 | 4 |
| Expected issues per run (of 26) | 10, 10, 11 | 12, 11, 12 | 13, 13, 9 | 4, 1 | 2, 3 |
| Invalid findings | 0 | 0 | 0 | 0 | 0 |
| Cost per run, five PRs | $3.85 | $6.96 | $4.58 | $7.15 | $0 (public repo); seat-priced on private repos |
| Cost per real Medium+ bug found | $2.89 | $0.95 | **$0.86** | $2.04 | — |
| Report | [#55](https://github.com/niway-dev/wachiman/pull/55) | [#82](https://github.com/niway-dev/wachiman/pull/82) | [#83](https://github.com/niway-dev/wachiman/pull/83) | [#55](https://github.com/niway-dev/wachiman/pull/55) | [#55](https://github.com/niway-dev/wachiman/pull/55) |

**Bias to keep in mind.** The 14 bugs were known when v1.4.0 was designed, so the 1.4.0 columns
show that the targeted gap closed, not that Wachiman is better in general. Held-out pull requests
decide that. See [What is not proven yet](#what-is-not-proven-yet).

## The 14 real bugs, by reviewer

Each cell is "found in k of n runs"; "~" means seen but not posted, or posted with the wrong
mechanism.

| PR | Bug | W 1.3 Opus | W 1.4 Opus | W 1.4 Sonnet | Pullfrog | CodeRabbit |
| --- | --- | --- | --- | --- | --- | --- |
| #463 | The face is recorded in no file | 1/3 | 1/3 | 1/3 | 0/2 | 0/2 |
| #463 | A queued camera-on reopens the camera after a newer off | 0/3 | 2/3 | 1/3 | ~ | 1/2 |
| #463 | The take's first relay feed is ignored | 0/3 | 0/3 | 0/3 | 0/2 | 1/2 |
| #463 | Random gap ids break Share's reuse | 0/3 | 0/3 | 0/3 | 1/2 | 0/2 |
| #463 | A superseded camera-on closes the gap too early | 0/3 | 1/3 | 1/3 | 2/2 | 0/2 |
| #464 | Ready card skips `markCopySeen` | 0/3 | 3/3 | 3/3 | 0/2 | 2/2 |
| #465 | Drag handle skips `markCopySeen` | 0/3 | 2/3 | 0/3 | 0/2 | 0/2 |
| #465 | A failed probe leaves the cards at "…" | 1/3 | 3/3 | 1/3 | 1/2 | 0/2 |
| #466 | `show()` / a failed load loses the card | 0/3 | 2/3 | 1/3 | 0/2 | 1/2 |
| #466 | Back re-floats the card (difficulty 5) | 0/3 | 3/3 | 3/3 | 0/2 | 0/2 |
| #467 | Export never re-lists the Library | 0/3 | ~ | ~ | 0/2 | 0/2 |
| #467 | Email copy listed as "Slack · Discord" | 2/3 | 1/3 | 2/3 | ~ | 0/2 |
| #467 | A Library drop navigates the window to `file://` | 0/3 | 3/3 | 3/3 | 2/2 | 0/2 |
| #467 | Editor exports labelled as destination copies | 0/3 | 1/3 | 0/3 | 1/2 | 0/2 |

Real bugs found outside the 14, by v1.4.0 (#466):

- A press on the floating card during the next take shows the main window mid-recording: Opus
  1/3, Sonnet 3/3.
- On Windows before build 19041 the card can land in the video as a black box: Opus 2/3, Sonnet
  0/3.

## Field run: the kaipu-record workspaces chain (2026-11-02, live, not replayed)

Seven live PRs (kaipu-record #439, #449, #478, #479, #482, #483, #484), about 24,000 added lines,
mostly reviewed by Wachiman v1.3.0. Only one of the eight v1.4.0 runs was a full review. On the
three PRs all three bots reviewed (#478, #479, #482), with 11 distinct real Medium+ bugs:

| | Wachiman (v1.3.0, re-review on every push) | Pullfrog | CodeRabbit |
| --- | --- | --- | --- |
| Findings posted | 44 | 9 | 17 |
| Invalid findings | 0 | 0 | 0 |
| Real Medium+ bugs found (of 11) | 2 | 4 | **6** |
| The one High bug (#479) | missed | found | found |
| Cost on the 7 commits both reviewed | **$4.31** | $8.83 | $0 (public repo) |
| Total on these three PRs | $9.03 (10 runs after Pullfrog was turned off) | $8.83 (stopped early) | $0 |

- **Wachiman's misses cluster on data paths:** destructive recovery steps that don't re-verify
  their target, read errors treated as empty and written back, overlapping calls, unbounded
  waits, and cached state written over another machine's change.
- **Re-reviews on every push cost $7.23 (49 % of Wachiman's bill)** and found one real Medium+ bug.
  An engine bug inflates them: a merge from `main` is re-reviewed as if the author wrote it.
- These PRs are a held-out set for v1.4.0. Replaying them is the next measurement.
- Report: [2026-11-02-field](2026-11-02-field/README.md).

## What each experiment showed

### v1.3.0 baseline (2026-11-01, [#55](https://github.com/niway-dev/wachiman/pull/55))

- Wachiman led on breadth (test quality, docs, leftovers) and was behind on the bugs a user feels:
  1.3 per run, against Pullfrog's 3.5.
- Its summaries had looked at the code where the bugs were and approved it. On #465 it said "no
  problems with the Drag handle"; on #466 it praised the `location.key` ref behind the Back bug.
- Pullfrog started no subagents in any of the 14 saved runs.
- Runs: kaipu-bench-wachi #1–#15; kaipu-bench-pullfrog #1–#5 and kaipu-bench-pullfrog-v2 #2–#6;
  kaipu-bench-coderabbit #1–#5 and kaipu-bench-coderabbit-v2 #2–#6.

### v1.4.0 on Opus (2026-11-02, [#82](https://github.com/niway-dev/wachiman/pull/82); hypothesis [#75](https://github.com/niway-dev/wachiman/pull/75))

- **Changes measured:**
  - call-site evidence ([#69](https://github.com/niway-dev/wachiman/pull/69));
  - flow and failure questions, `contracts[]` and `confidence` ([#70](https://github.com/niway-dev/wachiman/pull/70));
  - the confidence rule ([#73](https://github.com/niway-dev/wachiman/pull/73)).
- **Hypothesis met on every quality metric, missed on cost.** 7.3 real bugs per run, 11 of 14
  distinct, 0 invalid, at $6.96 against the predicted $4.50–$6.00. Seven of nine per-bug
  predictions were met.
- **Open problems:**
  - 13 real Medium+ bugs were posted as `Consider`;
  - the same defect was posted on its source and on its test (`dedupeFindings` matches file and
    line);
  - 3 defects appeared in the contracts block but were not posted.
- Runs: kaipu-bench-wachi #16–#30.

### E1: v1.4.0 on Sonnet (2026-11-02, [#83](https://github.com/niway-dev/wachiman/pull/83))

- **Sonnet keeps about 73 % of Opus's real bugs at 66 % of the cost.** It still finds more per run
  than Pullfrog or CodeRabbit, and is the cheapest per real bug ($0.86). The $3.50 cost target was
  not met: $4.58 per run.
- **The per-class prediction was backwards.** Sonnet held the reasoning cases (Back 3/3, `file://`
  3/3) and lost a sibling call-site case (#465 `markCopySeen`, 0/3).
- **Why it loses: wrong conclusions from the right evidence.** In all three runs Sonnet cited the
  sibling drag at `export-status-cards.tsx:231-236`, the line with `markCopySeen`. It compared only
  the failure paths and concluded the new handle "matches its siblings".
- It almost never labels `Fix`: all 15 findings on #465 were `Consider`.
- Runs: kaipu-bench-wachi #31–#45.

## Would "Sonnet reports, Opus judges" have found what Sonnet lost?

**Not shown yet. Plausible only if the judge re-checks code, not reports.** This is the question
the [reader and judge design](../specs/2026-11-02-reader-judge-and-local-index-design.md)
([#80](https://github.com/niway-dev/wachiman/pull/80), draft) depends on.

- **A judge that reads Sonnet's text** receives "the new handle matches its siblings, see
  `export-status-cards.tsx:231-236`". That is a conclusion with a citation attached, and it is
  likely to be ratified: the failure [ADR 0009](../adr/0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md)
  rejected, and the one GPT-6.1 Sol warned about.
- **A judge that receives the cited code and the claim to check** sees both sequences: the new
  `startFileDrag` and the sibling's `markCopySeen` then `startFileDrag`. The same Opus found that
  pairing in 2 of 3 runs with the same evidence.

Sonnet's losses against Opus, placed by cause:

| Loss | Cause | Recoverable by a judge that re-checks cited code? (estimate) |
| --- | --- | --- |
| #465 `markCopySeen` | evidence present, wrong conclusion | likely: the line is cited |
| #463 queued camera-on | wrong conclusion ("guarded by the request counter") | likely: the counter is cited |
| #467 editor exports | evidence present, no contract asked | possibly |
| #466 a failed load loses the card | a contract said "no fallback", nothing was posted | almost certainly: the defect is already written |
| #466 Windows black box | the evidence never reached the code | no |

The budget is tight. To meet Sol's 20 % saving against Opus's $6.96, the whole pipeline must stay
under $5.57. With Sonnet at $4.58, that leaves about $1 for five judges, roughly $0.20 per pull
request.

**The cheap test.** Run it offline on the reports already collected, without building the
pipeline. Give Opus only the Sonnet contracts and the cited code, without the diff and without
naming the bug, and count how many of the five losses it reopens and at what cost. Three or more
at about $0.20 per pull request would be the design's first real evidence. Fewer would confirm that
the reader caps recall. This is gate 2 of #80.

## What is not proven yet

1. **Held-out pull requests.** The 14 bugs were known when v1.4.0 was designed. The controlled set
   ([catalogue](kaipu-record-bug-catalogue.md)) has 15 hard bugs, each traced to the PR that
   introduced it and the commit that fixed it later. None of them was used to design v1.4.0.
   Replaying those PRs on all three reviewers, with the prediction registered first and the
   author's fix as ground truth, is what turns "the targeted gap closed" into a general claim.
2. **Blind judging.** The verifiers knew which reviewer wrote each finding. Next time they get the
   findings mixed and unlabelled.
3. **Which change did it.** Pinning `review.yml@4842d98` (#69's evidence without #70's questions)
   separates the two.
4. **Equal runs.** Pullfrog and CodeRabbit have two runs each against Wachiman's three.

## Cheap fixes the results point at

- **Name the property to compare** in the sibling-call question: what the sibling does right before
  and after that the new call does not. "Do they fail the same way" is what lost #465 on both
  models.
- **Labels:** a real Medium+ bug posted as `Consider` 13 times on Opus, more on Sonnet.
- **Deduplicate across a source and its test.**
- **Seen, not published:** a contract that states a defect should become a finding or a question.
