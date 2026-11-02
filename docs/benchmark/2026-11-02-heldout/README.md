# Held-out benchmark: five pull requests nobody tuned for

- **Status:** hypothesis registered before any run. Results are added by a later commit.
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
