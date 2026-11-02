# Held-out benchmark: five pull requests nobody tuned for

- **Status:** hypothesis registered before any run (first commit of this PR); results below,
  added after the runs on 2026-11-02. Wachiman: kaipu-bench-wachi #46–#60 (r1 = #46–#50,
  r2 = #51–#55, r3 = #56–#60). CodeRabbit: kaipu-bench-coderabbit #6–#10. Raw: [`raw/`](raw/).
  Blind judgement: [`judge/`](judge/), with the [key](judge/key.md) that was applied afterwards.
- **Why this exists.** Every number so far ([results.md](../results.md)) comes from five pull
  requests whose bugs were known when v1.4.0 was designed. This set is different: five
  kaipu-record pull requests that introduced a bug catalogued **before** v1.4.0 existed
  ([catalogue](../kaipu-record-bug-catalogue.md), mined 2026-10-30), none of which was used to
  design or tune anything. The ground truth is not our opinion: it is the bug the author fixed
  later, in a commit we can read.
- **Reviewers:** Wachiman v1.4.0 (Opus 5.5, effort `high`, three runs) and CodeRabbit (one run,
  started with `@coderabbitai review`). Pullfrog is not in this round: its key is out of credit.
- **Repositories:** [kaipu-bench-wachi](https://github.com/niway-dev/kaipu-bench-wachi) and
  [kaipu-bench-coderabbit](https://github.com/niway-dev/kaipu-bench-coderabbit), branches
  `replay/pr-<n>/{base,head}` at the exact commits. Manifest:
  [`replay/manifest-heldout-2026-11-02.tsv`](../replay/manifest-heldout-2026-11-02.tsv).
- **Caveat on CodeRabbit's memory:** its repository already holds the five exhibition replays, so
  this is not a memory-free run for it. The bugs are unrelated, so the effect should be small.

## The five pull requests and the bug each one introduced

| kaipu PR | Size | Catalogued bug | Class | Difficulty | Visible from the diff | Fixed later in |
| --- | --- | --- | --- | --- | --- | --- |
| [#402](https://github.com/niway-dev/kaipu-record/pull/402) | 26 files, +1,820/−504 | A spare capture overlay learns its mode only from main's first `screenshot:overlay-state` message; a spare still loading when its pick opened sends it before React's effect attaches the listener, and the message is lost. A screen-sized transparent window then swallows every click. | race | 5 | partial: the one-shot push and the late effect are in different files | #418, `afd007df` |
| [#255](https://github.com/niway-dev/kaipu-record/pull/255) | 5 files, +319/−13 | The activation-policy setter skips calls that match its cache. Floating windows make Electron hide the Dock without going through the cache, so the cache says `regular` while the Dock is gone, and the restore becomes a no-op. Kaipu drops out of Dock and Cmd+Tab after the first recording. | state machine | 5 | partial: the reviewer must see that the cache can diverge from the OS | #366, `72ab3e26` |
| [#276](https://github.com/niway-dev/kaipu-record/pull/276) | 19 files, +641/−357 | `cancelUpload` and the expired-reservation sweep read the ticket, check it in app code, then release it in a second statement. A resumed client can extend the ticket in between, so the release deletes the object while a fresh ticket points at an unreserved key. | race (check-then-act) | 4 | yes: the two statements are in `cancel-upload.ts` of the diff | #342, `8ded5c29` |
| [#269](https://github.com/niway-dev/kaipu-record/pull/269) | 12 files, +1,198/−26 | `createDragCopy` hard-links into `os.tmp`, so a vault on another volume (EXDEV) or on exFAT falls back to copying the whole export before the drag starts: seconds of stall or ENOSPC. | platform | 4 | yes: `drag-copies.ts` is in the diff | #412, `3f729bd` |
| [#184](https://github.com/niway-dev/kaipu-record/pull/184) | 7 files, +238/−24 | Labels become per-line `<tspan>`s that re-render on selection. The untouched move handler captures the pointer on `e.target`, so the two clicks of a double-click no longer share a target, and double-click to edit stops working. | DOM semantics | 5 | partial: the diff shows the `<tspan>` change; the faulty capture line is unmodified code | #187, `347c09ae` |

Wachiman's earlier version reviewed #402 live and posted 0 findings in 3 batches. The other four
merged before any AI reviewer existed.

## Predictions

These bugs are harder than the exhibition set: three of five are difficulty 5, and three are only
partly visible from the diff. The exhibition bugs that v1.4.0 now finds reliably were difficulty 4
to 5 too, but each had a sibling call site or a flow question pointing at it. Here only #276 and
#269 have that shape.

| kaipu PR | Bug | Mechanism that could catch it | Wachiman v1.4.0, of 3 runs | CodeRabbit, 1 run |
| --- | --- | --- | --- | --- |
| #276 | check-then-act on the ticket | failure-path question on the second statement; the race is in the diff | **≥ 2** | 50 % |
| #269 | hard link across volumes | failure-path question on `link()`; needs platform knowledge | **≥ 1** | 25 % |
| #402 | state message before the listener | flow question "what happens when the background work finishes"; cross-file ordering | **≥ 1** | 25 % |
| #255 | cache diverges from the OS | needs a leave-and-return question about the Dock; the PR looks correct alone | **≤ 1** | 10 % |
| #184 | pointer capture on a re-rendered target | DOM event semantics in unmodified code | **0** | 10 % |

### Overall

| Metric | Hypothesis | Failure if |
| --- | --- | --- |
| Catalogued bugs found, distinct over three runs (of 5) | **≥ 2** | 0 |
| Catalogued bugs found per run | **≥ 1.3** | < 0.7 |
| Invalid findings per run | **≤ 1** | ≥ 3 |
| Other real Medium+ bugs found (verified by reading, with a later fix as evidence when one exists) | some; counted separately | — |
| Cost per run, five PRs | **$4.00–$7.00** | > $8.00 |

The bar is deliberately lower than on the exhibition set. If v1.4.0 finds 2 of these 5, the
exhibition gain generalises at least partly. If it finds 0, the gain was tuned to the five PRs we
knew, and [results.md](../results.md) must say so.

### Scoring

1. **Blind.** The verifier gets every finding from both reviewers mixed and without the reviewer's
   name, and decides valid / partly / invalid and whether it matches the catalogued bug.
2. **Ground truth** for the catalogued bug is the later fix commit. A finding matches when it names
   the same defect, not merely the same file.
3. **Other findings** are checked against the code at the head and `origin/main`, as before.
4. **Cost** from the review footers.

## Results

**Wachiman met its hypothesis, and CodeRabbit did better on these bugs.** Of the four pull requests
that really carry a catalogued bug, Wachiman v1.4.0 found the bug on two (#255 in every run, #276
in one of three), and CodeRabbit found three of the four in its single run (#402, #255, #276). The
fifth PR, #269, turned out not to carry its catalogued bug; see the correction below.

### A correction to the catalogue, first

The catalogue attributes the drag-copies bug (hard link across volumes) to PR #269. The commit
that introduced it, `749df1bc`, is **not** in #269's diff: it reached `main` through PR #286
(`feat/NIW2-218-background-export`), merged later. The blind judge noticed that #269 never touches
`drag-copies.ts`. So #269 is a control PR here: it has no catalogued bug, and no reviewer claimed
one. The catalogue row is wrong and should be corrected to #286. Four PRs remain in the test.

### The catalogued bugs

| kaipu PR | Catalogued bug | Predicted (Wachiman, of 3) | Wachiman v1.4.0, Opus | CodeRabbit, 1 run |
| --- | --- | --- | --- | --- |
| #402 | The spare overlay's first state message is lost before the listener attaches | ≥ 1 | **0/3** | **match** (High; names the `ready-to-show` send before the `useEffect` listener and the null render) |
| #255 | The policy cache turns the Dock restore into a no-op | ≤ 1 | **3/3**, `Fix` every run; r2 names the exact cause (`setVisibleOnAllWorkspaces` without `skipTransformProcessType`) | match (quality 2: right cause, thin message) |
| #276 | Check-then-act between the ticket check and `release()` | ≥ 2 | **1/3** (r1, `Fix · security`, covers both sites and proposes the fix that shipped) | match (both sites) |
| #269 | not in this PR (catalogue error) | — | — | — |
| #184 | Pointer capture on a re-rendered `<tspan>` breaks double-click | 0 | 0/3 | partial (the double-click hit box, a different defect, fixed later in `4a337db4`) |

### Against the hypothesis

| Metric | Hypothesis | Result | |
| --- | --- | --- | --- |
| Catalogued bugs found, distinct, three runs (of 4 real) | ≥ 2 | **2** (#255, #276) | met |
| Catalogued bugs found per run | ≥ 1.3 | **2, 1, 1 (mean 1.33)** | met, at the line |
| Invalid findings per run | ≤ 1 | **1, 0, 0** | met |
| Cost per run, five PRs | $4.00–$7.00 | **$4.32, $4.31, $3.78** | met |

Per-bug predictions: #276 missed (1 of 3 against ≥ 2), #402 missed (0 against ≥ 1), #255 beaten in
the other direction (3 of 3 against ≤ 1), #184 met (0). The predictions were wrong about **which**
bugs are hard for Wachiman: the one that looked correct in isolation (#255) was easy, and the one
visible in the diff (#276) was not reliable.

### Everything posted, blind-judged

| Run | Posted | Valid | Partly | Unconfirmed | Invalid | Catalogued bugs matched | Message quality (0–5) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Wachiman r1 | 19 | 15 | 1 | 2 | **1** | 2 | 4.04 |
| Wachiman r2 | 14 | 12 | 2 | 0 | 0 | 1 | 4.47 |
| Wachiman r3 | 16 | 13 | 0 | 3 | 0 | 1 | 3.99 |
| CodeRabbit | 12 | 7 | 3 | 2 | 0 | **3** | 3.22 |

The one invalid finding: Wachiman r1 on #402 said the main window lacks `setBackgroundThrottling(false)`;
`main/index.ts:260` already calls it. It is Wachiman's first invalid finding in 50 reviews.

**Other real bugs, outside the catalogue** (valid by reading; Medium):

- #402: the reused shade window never recovers from a renderer crash or failed load, so one failure
  lasts the session. Found by every Wachiman run and by CodeRabbit (4 of 4). The same failure-path
  class as the exhibition's `loadURL` finding.
- #402: system-audio write-back now happens during the countdown and survives a cancel (Wachiman r2).
- #276: the retry sweep skips in-window rows but still spends its `limit`, so a batch can process
  nothing. Found by all three Wachiman runs and CodeRabbit; fixed in the same `8ded5c29`. The judge
  rated it Low–Medium.
- #184: the double-click hit box is one line high on a multi-line label (CodeRabbit; fixed in `4a337db4`).

### Reading

1. **The v1.4.0 gain generalises, partly.** On pull requests nobody tuned for, Wachiman found 2 of 4
   catalogued bugs, including one of difficulty 5 (#255) in every run. The exhibition gain was not
   only memorisation. But 1.33 per run is far from the exhibition's 7.3, and the catalogued bugs are
   the hard end of the catalogue.
2. **CodeRabbit won this round on the catalogued bugs: 3 of 4 in one run,** including the
   cross-file ordering race on #402 that every Wachiman run missed. Its messages were shorter and
   scored lower (3.22), and it posted more partly-valid items, but it found the bug. On the exhibition
   set it had found 2.5 per run against Wachiman's 7.3; here the order reversed. Two readings fit, and
   the data cannot separate them yet: CodeRabbit's hosted code graph helps most on cross-file
   ordering (#402 is exactly that), or three runs against one plus four PRs is too small to rank.
3. **Where Wachiman missed and why, from the contracts:** on #402 all three runs went to the shade
   window (a real bug) and never asked what the spare overlay does when main's message arrives
   before the listener exists. The flow question "what happens when background work finishes" did
   not reach "what happens when it finishes *too early*". That is a specific gap to write down.
4. **Wachiman stays the broadest and the most precise:** 40 valid findings in 49 posted, one invalid,
   and the test-quality and docs findings the others do not post. Cost $4.14 per run for five PRs.
5. **Pullfrog is missing from this round** (key out of credit), so it says nothing about Pullfrog.
