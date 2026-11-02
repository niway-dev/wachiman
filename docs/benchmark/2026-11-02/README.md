# Benchmark 2026-11-02: does v1.4.0 find the bugs v1.3.0 missed?

- **Status:** hypothesis registered before any run (commit `0c2274b`, merged in #75); results
  below, added after three runs on 2026-11-02. Every finding was checked against the code at the
  head and `origin/main` by five Claude Sonnet 5.5 subagents, one per PR, by reading only:
  [`prs/`](prs/). Raw reviews and comments: [`raw/`](raw/). Runs: PRs #16–#30 in
  kaipu-bench-wachi (W4 = #16–#20, W5 = #21–#25, W6 = #26–#30).
- **Baseline:** [2026-11-01 replay](../2026-11-01/README.md), Wachiman v1.3.0, three runs on
  kaipu-record #463–#467. Per-issue analysis in [`../2026-11-01/prs/`](../2026-11-01/prs/).
- **Same setup as the baseline:** same five PRs at the same commits, in
  [kaipu-bench-wachi](https://github.com/niway-dev/kaipu-bench-wachi), three runs on new
  `head-r<k>` branches, Claude Opus 5.5, effort `high`, started with `/wachi review`. Only the
  pinned engine version changes, from `v1.3.0` to `v1.4.0`. Every posted finding is checked against
  the code with the same method as the baseline.

## What changed from v1.3.0 to v1.4.0

| PR | Change | Touches what the model reviews? |
| --- | --- | --- |
| #56 | Reasoning effort is an explicit input (`high`, as before by default) | No: same level as the baseline |
| #67 | Turn cap (`--max-turns 40`) and a 900 s wall-clock kill per call | Only if a batch hits a limit |
| #68 | Review every push incrementally; a rebase with no content change costs nothing | No: the replays have no pushes |
| #69 | **Call-site evidence:** each batch gets the other call sites of the symbols its new lines call | **Yes** |
| #70 | **Flow and failure questions**, `contracts[]` with checked citations, `confidence`, severity calibration in `RULES` | **Yes** |
| #73 | The engine posts a low-confidence `fix` or `blocker` as a `question` | Labels only |

## Baseline (v1.3.0, three runs)

| Metric | Value |
| --- | --- |
| Real Medium+ bugs found per run (of 14) | 0, 3, 1 (mean 1.3) |
| Distinct real Medium+ bugs over the three runs | 3 |
| Expected issues found per run (of 26) | 10, 10, 11 |
| Invalid findings per run | 0 |
| Cost per run, five PRs | $3.80, $3.59, $4.17 (mean $3.85) |
| Message quality, mean (0–5) | 4.87; points lost on Signal: comment-only issues labelled `Fix` |

For comparison: Pullfrog 3.5 real Medium+ bugs per run at $7.15; CodeRabbit 2.5.

## Predictions

### Per bug, from the change that targets it

| PR | Bug (from the [baseline table](../2026-11-01/README.md#the-real-bugs-severity-medium-or-high)) | Targeted by | v1.3.0 | Predicted v1.4.0 |
| --- | --- | --- | --- | --- |
| #464 | Show in Finder and drag skip `markCopySeen` | #69: the toast's call site pairs `markCopySeen` with `startFileDrag` | 0/3 | **≥ 2/3** |
| #465 | The new Drag handle skips `markCopySeen` | #69, same sibling call site | 0/3 | **≥ 2/3** |
| #467 | Export never re-lists the Library when an export finishes | #69 (library-detail's refresh) and #70 (background work finishes) | 0/3 | **≥ 1/3** |
| #466 | Back re-floats the always-on-top card | #70 (Back, remount with the same history entry) | 0/3 | **≥ 1/3** |
| #467 | A file dropped on the Library navigates the window to `file://` | #70 (what the removed path did before) | 0/3 | **≥ 1/3** |
| #466 | `show()` returns true before the card renders; a failed load loses the card | #70 (failure paths) | 0/3 | **≥ 2/3** |
| #463 | The take's first relay feed is ignored | #70 (failure paths: never delivers) | 0/3 | **≥ 1/3** |
| #463 | A queued camera-on reopens the camera after a newer off | #70 (failure paths: superseded request) | 0/3 | **≥ 1/3** |
| #467 | Orphaned CSS comment | #70 severity test: comment-only is never `Fix` | `Fix` 3/3 | **`Fix` 0/3** |

### Overall

| Metric | v1.3.0 | Hypothesis | Failure if |
| --- | --- | --- | --- |
| Real Medium+ bugs per run (of 14) | 1.3 | **≥ 3.0** | < 2.0 |
| Distinct real Medium+ bugs over three runs | 3 | **≥ 7** | ≤ 4 |
| Expected issues per run (of 26) | 10–11 | **≥ 9** | < 8 |
| Invalid findings per run | 0 | **≤ 1** | ≥ 3 |
| Cost per run | $3.85 | **$4.50–$6.00** | > $7.15 (Pullfrog's) |

Reaching 3.0 at 60–80 % of Pullfrog's cost, without losing the test findings, would mean
competing on the bugs a user feels while keeping the coverage the baseline already had.

### How to tell why, if it fails

The new `contracts[]` output records what the model answered, so a miss can be placed:

1. **The evidence did not hold the sibling call.** `evidence.json` in the batch log lacks the
   pairing call site: the extractor or its caps are wrong.
2. **The evidence held it and no contract used it.** The model did not read the evidence: the
   prompt placement or wording is wrong.
3. **A contract states the gap and no finding was posted.** The model saw it and decided not to
   publish: the publication rules (`RULES`, confidence) are wrong.
4. **Expected issues drop below 9.** More questions took attention from the test findings.

### Not measured here

Review on push (#68) and the turn cap (#67) do not show on a replay without pushes. They are
tested live on kaipu-record with a push to an already reviewed pull request.

## Results

**The hypothesis holds on every quality metric and misses on cost.** v1.4.0 found 7.3 real
Medium+ bugs per run, against 1.3 on v1.3.0, and 11 of the 14 over three runs, with no invalid
finding. It cost $6.96 per run, above the predicted $4.50–$6.00 and below the $7.15 failure line.

### Overall

| Metric | v1.3.0 | Hypothesis | v1.4.0 (W4, W5, W6) | |
| --- | --- | --- | --- | --- |
| Real Medium+ bugs per run (of 14) | 0, 3, 1 (mean 1.3) | ≥ 3.0 | **7, 7, 8 (mean 7.3)** | met |
| Distinct real Medium+ bugs over three runs | 3 | ≥ 7 | **11** | met |
| Expected issues per run (of 26) | 10, 10, 11 | ≥ 9 | **12, 11, 12** | met |
| Invalid findings per run | 0 | ≤ 1 | **0, 0, 0** | met |
| Cost per run, five PRs | $3.80, $3.59, $4.17 | $4.50–$6.00 | **$6.95, $7.05, $6.87** (mean $6.96) | **not met** (below the failure line) |
| Message quality, mean (0–5) | 4.87 (45 scored) | — | 4.75 (63 scored) | slightly lower: under-called labels cost the Signal point |

For comparison, on the same 14 bugs: Pullfrog 3.5 per run at $7.15, CodeRabbit 2.5.

Posted per run: 27, 26, 27. Partly valid: 1, 2, 3. Unconfirmed: 3, 1, 1. Invalid: none.

### Per prediction

| PR | Bug | Predicted | v1.4.0 | | Cause of a miss |
| --- | --- | --- | --- | --- | --- |
| #464 | Show in Finder and drag skip `markCopySeen` | ≥ 2/3 | **3/3** | met | — |
| #465 | The new Drag handle skips `markCopySeen` | ≥ 2/3 | **2/3**, plus 1 seen only in the contracts block | met | W5: seen, not published (cause 3) |
| #467 | Export never re-lists the Library | ≥ 1/3 | 0/3, one partial (W6, wrong mechanism) | **not met** | the finalize handler sends no `library:changed`; W6 guessed it does |
| #466 | Back re-floats the always-on-top card | ≥ 1/3 | **3/3** | met | — |
| #467 | A Library drop navigates the window to `file://` | ≥ 1/3 | **3/3**, always `Fix` | met | — |
| #466 | `show()` true before render; a failed load loses the card | ≥ 2/3 | **2/3**, plus 1 seen only in the contracts block | met | W5: seen, not published (cause 3) |
| #463 | The take's first relay feed is ignored | ≥ 1/3 | 0/3 | **not met** | not reached in any run |
| #463 | A queued camera-on reopens the camera after a newer off | ≥ 1/3 | **2/3**, `Fix` | met | — |
| #467 | Orphaned CSS comment labelled `Fix` | 0/3 | **0/3** (`Consider · cleanup` 3/3) | met | — |

**Seven of nine per-bug predictions met.** The biggest gains are on bugs no Wachiman run had ever found: Back re-float (difficulty 5) 0/3 → 3/3, both `markCopySeen` cases 0/3 → 5/6, the `file://` drop 0/3 → 3/3.

### The 14 real bugs, by run

| PR | Bug | v1.3.0 | W4 | W5 | W6 |
| --- | --- | --- | --- | --- | --- |
| #463 | Camera cannot reopen: the face is in no file | 1/3 | ✓ | | |
| #463 | A queued camera-on reopens the camera after a newer off | 0/3 | | ✓ | ✓ |
| #463 | The take's first relay feed is ignored | 0/3 | | | |
| #463 | Random gap ids break Share's reuse | 0/3 | | | |
| #463 | A superseded camera-on closes the gap too early | 0/3 | | | ✓ |
| #464 | Ready card skips `markCopySeen` | 0/3 | ✓ | ✓ | ✓ |
| #465 | Drag handle skips `markCopySeen` | 0/3 | ✓ | ~ | ✓ |
| #465 | A failed probe leaves the cards at "…" | 1/3 | ✓ | ✓ | ✓ |
| #466 | `show()` / failed load loses the card | 0/3 | ✓ | ~ | ✓ |
| #466 | Back re-floats the card | 0/3 | ✓ | ✓ | ✓ |
| #467 | Export never re-lists the Library | 0/3 | | | ~ |
| #467 | Email copy listed as "Slack · Discord" | 2/3 | | ✓ | |
| #467 | A Library drop navigates to `file://` | 0/3 | ✓ | ✓ | ✓ |
| #467 | Editor exports labelled as destination copies | 0/3 | | ✓ | |
| | **Found** | 0, 3, 1 | **7** | **7** | **8** |

"~" means seen in the contracts block or summary but not posted, or posted with the wrong mechanism.

Still missed by every v1.4.0 run: the ignored first relay feed and the random gap ids (#463), and
Export's re-list (#467). Two of these three were Pullfrog's or CodeRabbit's catches.

**New real bugs, outside the 14** (verified by reading, not run):

- #466: a press on the floating card during the next take shows the main window mid-recording.
  Medium; W4; still open on `origin/main`.
- #466: on Windows before build 19041 the card is never closed at take start and can land in the
  video as a black box. Medium; W5 and W6.

### What is still wrong

- **Under-called labels: 13.** Real Medium+ bugs were posted as `Consider`: 6 on #466, 4 on #465.
  The calibration rule against over-calling worked (no comment-only `Fix`). The rule for the other
  direction ("a silent wrong result is `Fix` or higher") did not move these cases. Message quality
  fell from 4.87 to 4.75 on the Signal point.
- **Duplicates.** The same defect was posted on two or three lines in one run:
  - the `file://` drop: 7 postings across 3 runs;
  - Back re-float: twice in W5 and twice in W6;
  - the superseded camera-on: twice in W6.

  `dedupeFindings` matches on file and line, so a defect cited on its source and its test is posted
  twice.
- **Seen, not published: 3.** W5 on #465 (`markCopySeen`) and #466 (failed load), and W4 on #467
  (the Email label). Each described the defect in the contracts block or the summary and posted
  nothing. This is cause 3 of the diagnosis, and it is now measurable.
- **Cost +81 %.** $6.96 against $3.85. The longer prompt (call-site evidence, flow questions,
  contracts) and longer outputs (contracts) explain it. Per real Medium+ bug found, cost fell from
  $2.89 to **$0.95**.

### Reading

1. **The two changes did what they were designed for.** The bugs whose evidence lived in a sibling
   call site (`markCopySeen` ×2) or in a question nobody asked (Back, `file://`, failed load) went
   from never found to found in most runs. The breadth findings held (12, 11, 12 expected issues),
   and precision held (0 invalid).
2. **Against the competition on these five PRs:** 7.3 real bugs per run at $6.96, against
   Pullfrog's 3.5 at $7.15. This is five PRs, three runs, and verdicts by reading. It also has a
   bias: the 14 bugs were known when the changes were designed. Read it as "the targeted gap
   closed", not as a general ranking; it needs held-out PRs.
3. **What to fix next is concrete, and cheap to try:**
   - under-called labels (a prompt and engine change);
   - duplicates across a source and its test (an engine change);
   - "seen, not published" (a contract that states a defect should become a finding or a
     question).

   Cost is the open question for E1, the same run with Sonnet on every batch.
