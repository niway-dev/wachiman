# E1: v1.4.0 with Sonnet 5.5 on every batch

- **Status:** hypothesis registered before any run (first commit of this PR); results below,
  added after three runs on 2026-11-02 (kaipu-bench-wachi PRs #31–#45: S7 = #31–#35, S8 = #36–#40,
  S9 = #41–#45). Every finding was checked against the code by five Claude Sonnet 5.5 subagents,
  one per PR, by reading only: [`prs/`](prs/). Raw reviews and comments: [`raw/`](raw/).
- **Question:** how much of v1.4.0's gain survives on the cheaper model, which is also the default
  every consumer gets without configuring anything? Where does Sonnet fail, and why?
- **Opus reference:** [v1.4.0 results](../2026-11-02/README.md#results), from PR #82: 7.3 real
  Medium+ bugs per run, 11 of 14 distinct, 11–12 expected issues, 0 invalid, $6.96 per run.
- **Setup:** identical to the Opus runs except the model. Same five PRs, same commits, three runs
  (rounds 7, 8 and 9 in kaipu-bench-wachi), `review.yml@v1.4.0`, effort `high`,
  `model: claude-sonnet-5-5`. Every finding is checked against the code with the same method.

## Predictions

| Metric | v1.4.0 on Opus | Hypothesis on Sonnet | Failure if |
| --- | --- | --- | --- |
| Real Medium+ bugs per run (of 14) | 7.3 | **≥ 4.4** (60 % of Opus) | < 3.5 (Pullfrog's level) |
| Distinct real Medium+ bugs over three runs | 11 | **≥ 7** | ≤ 4 |
| Expected issues per run (of 26) | 11–12 | **≥ 9** | < 8 |
| Invalid findings per run | 0 | **≤ 1** | ≥ 3 |
| Cost per run | $6.96 | **≤ $3.50** (half of Opus or less) | > $5.00 |

"Worth it" means both: a Sonnet run keeps at least 60 % of Opus's real bugs, and it costs half or
less. If only one holds, the [reader and judge design](../../specs/2026-11-02-reader-judge-and-local-index-design.md)
(#80) has its target: the bugs Sonnet loses are the judge's job.

## Where Sonnet should hold and where it should fail

These predictions follow from what each change gives the model:

- **Should hold: the sibling call-site cases** (`markCopySeen` on #464 and on #465). The evidence
  file puts the pairing call in front of the model, so it is reading, not reasoning. Prediction:
  **≥ 4 of 6**.
- **Should hold: breadth** (test quality, stale docs, leftovers). Prediction: expected issues ≥ 9.
- **Should fail first: the reasoning cases.** Back re-float (#466, difficulty 5), the `file://`
  drop (#467, a removed handler with nothing new to grep), the queued camera-on (#463).
  Prediction: **together ≤ 5 of 9** (Opus: 8 of 9).

## How a miss will be diagnosed

Each lost bug, per batch, is placed in one of four causes:

1. **The evidence was not there.** `evidence.json` lacked the call site. Same input as Opus, so
   this should not happen; if it does, the batching differed.
2. **The evidence was there and no contract used it.** The model did not read or connect it.
3. **A contract stated the defect and no finding was posted.** Seen, not published.
4. **No contract and no finding.** The question was never answered.

This split is what tells the reader/judge design whether a Sonnet reader would hand the judge
enough. It is gate 2 of #80.

## Results

**Sonnet keeps about 73 % of Opus's real bugs at 66 % of the cost.** It still finds more real bugs
per run than Pullfrog or CodeRabbit, and it posted no invalid finding. It misses the cost target:
$4.58 per run, against the $3.50 hoped for. And it fails in a different place than predicted.

### Overall

| Metric | v1.4.0 on Opus | Hypothesis | **v1.4.0 on Sonnet** (S7, S8, S9) | |
| --- | --- | --- | --- | --- |
| Real Medium+ bugs per run (of 14) | 7, 7, 8 (mean 7.3) | ≥ 4.4 | **6, 5, 5 (mean 5.3)** | met |
| Distinct real Medium+ bugs over three runs | 11 | ≥ 7 | **9** | met |
| Expected issues per run (of 26) | 12, 11, 12 | ≥ 9 | **13, 13, 9** | met |
| Invalid findings per run | 0 | ≤ 1 | **0, 0, 0** | met |
| Cost per run, five PRs | $6.95, $7.05, $6.87 (mean $6.96) | ≤ $3.50 | **$5.07, $4.50, $4.18** (mean $4.58) | **not met**; S7 is past the $5.00 failure line |
| Cost per real Medium+ bug | $0.95 | — | **$0.86** | |
| Message quality (0–5) | 4.75 | — | about 4.8 | similar; points lost on labels, not explanations |

For comparison on the same 14 bugs: v1.3.0 on Opus 1.3 per run, Pullfrog 3.5 at $7.15,
CodeRabbit 2.5.

**How two partials were counted.** S8's `markCopySeen` on #464, posted as a low-confidence
question that points at the defect, counts as found. S9's "…" cards on #465, posted as a test
gap, does not. Counting both as found gives 6, 5, 6. Counting neither gives 6, 4, 5. The mean
lies between 5.0 and 5.7 either way.

### The 14 real bugs, Opus against Sonnet

| PR | Bug | Opus (W4–W6) | Sonnet (S7–S9) |
| --- | --- | --- | --- |
| #463 | The face is in no file | 1/3 | 1/3 |
| #463 | A queued camera-on reopens after a newer off | 2/3 | 1/3 |
| #463 | The first relay feed is ignored | 0/3 | 0/3 |
| #463 | Random gap ids break Share's reuse | 0/3 | 0/3 |
| #463 | A superseded camera-on closes the gap too early | 1/3 | 1/3 |
| #464 | Ready card skips `markCopySeen` | 3/3 | 3/3 |
| #465 | Drag handle skips `markCopySeen` | 2/3 | **0/3** |
| #465 | A failed probe leaves the cards at "…" | 3/3 | 1/3, plus 1 posted as a test gap |
| #466 | `show()` / a failed load loses the card | 2/3 | 1/3 |
| #466 | Back re-floats the card (difficulty 5) | 3/3 | **3/3** |
| #467 | Export never re-lists the Library | 0/3 (1 partial) | 0/3 (1 partial) |
| #467 | Email copy listed as "Slack · Discord" | 1/3 | **2/3** |
| #467 | A Library drop navigates to `file://` | 3/3 | **3/3** |
| #467 | Editor exports labelled as destination copies | 1/3 | 0/3 |
| | **Found per run** | 7, 7, 8 | 6, 5, 5 |

Outside the 14, on #466: Sonnet found "a press on the floating card during the next take shows
the main window mid-recording" in **3 of 3** runs (Opus 1/3), and never found the Windows
black-box case (Opus 2/3).

### Per-class predictions

| Prediction | Result | |
| --- | --- | --- |
| Sibling call-site cases hold: `markCopySeen` ≥ 4 of 6 | **3 of 6**: #464 3/3, #465 0/3 | **not met** |
| Reasoning cases fail first: Back, `file://`, queued camera-on ≤ 5 of 9 | **7 of 9**: 3/3, 3/3, 1/3 | **wrong**: Sonnet held them |
| Breadth holds: expected issues ≥ 9 | 13, 13, 9 | met |

**The prediction was backwards.** Sonnet held the reasoning cases and lost a sibling call-site
case, even though the evidence was in front of it.

### Why Sonnet lost what Opus found

Almost every loss is **cause 2: the evidence was there and the model drew the wrong conclusion
from it.** It is not missing evidence (cause 1), and it is rarely "seen, not published" (cause 3).

- **#465 `markCopySeen`, lost 3 of 3.** Every run cited the sibling drag at
  `export-status-cards.tsx:231-236`, the call that pairs `markCopySeen` with `startFileDrag`. Every
  run compared only the failure paths and concluded the new handle "matches its siblings" (S8), or
  "behave[s] like the existing paths [it] replace[s]" (S9). The pairing was on the screen; the
  model checked the wrong property.
- **#463 the queued camera-on.** The contracts covered the same toggle code and concluded the
  opposite, "guarded by the engine's request counter" (S7).
- **#466 the failed load.** A contract stated "no fallback" in S7 and S8, and no finding was
  posted (cause 3). The PR's own "Not done" note admits it, which may be why it went unposted.
- **#467 editor exports.** The filter was in the evidence; no contract asked what an editor export
  shows (cause 2).
- **#466 the Windows black box.** The cited evidence never reached `fullDisplayBorderAllowed`
  (cause 1, the only one).

### Labels

Sonnet almost never uses `Fix`. All 15 findings on #465 were `Consider`, as was E3 on #464 in
every run. Under-calls happen on both models, and more on Sonnet. Over-calls: none on either.

### Reading

1. **Worth it for the default, with a caveat on cost.** A consumer who never sets a model gets
   Sonnet. Sonnet now finds 5.3 real bugs per run on these PRs: more than Pullfrog (3.5) and
   CodeRabbit (2.5), at $4.58 against Pullfrog's $7.15, and $0.86 per real bug against Opus's
   $0.95. It costs two thirds of Opus, not half.
2. **For the [reader and judge design](../../specs/2026-11-02-reader-judge-and-local-index-design.md)
   (#80) this is gate 2's first evidence, and it backs Sol's warning.** A Sonnet reader does
   retrieve the right code. Its failure is closing the contract the wrong way: "matches its
   siblings". A judge that only read the reader's conclusions would inherit that. The judge must
   see the cited code and the closed contracts, and be able to reopen them (decisions 4, 11 and 12
   of #80). The idea survives; the version where the judge trusts the reader does not.
3. **Next, cheap:** the contract question for a sibling call should name the property to compare:
   "what does the sibling call do right before and after that the new one does not". Not "do they
   fail the same way". That is the #465 miss on both models' bad runs.
