# Plan: finish layer 2 of the calibrated finding priority

Working document. The layer 2 pull request links it, and the pull request that ships layer 2
deletes it. Design: [calibrated finding priority spec](../specs/2026-11-18-calibrated-finding-priority-design.md)
and [ADR 0059](../adr/0059-the-finding-priority-is-derived-from-a-calibration-table.md).

## Where it stands (2026-11-25)

Layer 1 (priority, rank, table v1, Priority and Track record rows, A/B arm) is merged. This branch
adds `wachiman calibrate`:

| Piece | File | Criterion | State |
| --- | --- | --- | --- |
| Wilson interval, rank bands, word movement, cell counts | `src/calibration.ts` | AC8, AC12 | done, tested |
| Outcome table per cell, owner and agent split | `src/calibrate/outcomes.ts`, `report.ts` | AC6 | done, run on real repositories |
| Blind sample with the word hidden, unanswered included | `src/calibrate/sample.ts`, `command.ts` | AC14 (draw and store) | done |
| Proposed table v2 as a file, nothing the engine reads changes | `src/calibrate/command.ts` | AC7, AC14 (fit) | done |
| CLI, help, docs | `src/cli.ts`, `src/help.ts`, `docs/calibration.md` | — | done |

Checks on this branch: `bun test src/calibrate src/calibration.test.ts src/cli.test.ts src/help.test.ts`
(129 pass), `bun scripts/ratchet.ts check` and `lint` at baseline, `bun fmt --check` clean. The full
suite ran once before the rebase onto 1.21.0 (9 failures, all 5-second timeouts under load, which
pass when their files run alone); it has not run after the rebase.

## What the first runs showed

Run on 2026-11-19/20 over the last 200 pull requests of this repository (348 findings, 76 PRs) and
of one private product repository (its counts stay on the owner's machine; only the direction is given here):

- Confidence separates outcomes in both: a Consider is declined more as confidence drops (this
  repository: 9%, 17%, 25% of answered at high, medium, low). The v1 seeds hold; nothing to change.
- The model rarely uses Fix (8 to 11% of findings) and used no Blocker in 400 PRs: Blocker cells
  cannot be measured, and layer 3 has a baseline.
- Owners fixed more than agents, not less: agent compliance does not inflate the rates.
- 20 to 51% of findings have no reply, and no thread carries a `Verdict:` line, so the wrong rate
  is not measured.
- `--propose` proposes no change: no judgements exist yet (the two drawn files are 0 of 40 judged).

## Remaining work, in order

1. **Run the full suite** after the rebase; fix what is ours.
2. **AC11.** A review whose model family or prompt version differs from a cell's provenance shows
   `not measured for this configuration` and the seed word. Needs the provenance recorded in the
   table cells and the review's configuration at render time.
   A judging line records no model or prompt version yet, so decision 9 (judgements count per
   matching configuration) cannot hold until it does: record the configuration on each drawn line.
3. **AC3, second half.** The Track record row shows `fixed <p>% of <n> answered · <k> PRs` with
   `seed` or `calibrated vN` once the repository's own outcomes are counted. Decide where a review
   reads those counts (the remote review has no local home): a committed file written by
   `calibrate`, or skip the rate where none is available. Showing a cell's fix rate on every
   comment also shows it to the owner while judging the blind sample, which would unblind
   decision 6: the design must say how the judging pass stays blind. This is a design choice;
   write it in the spec before building.
4. **Local review** with Wachiman (`cs-review-loop`), then mark the pull request ready.
5. **Owner:** judge the drawn files (`wouldAct` true or false on each line), then
   `wachiman calibrate <repo> --propose`.
6. **Layer 3** (AC9, prompt: the test that separates Fix from Consider) starts after this merges.

Optional follow-up, not in this layer: a pull request should not count as ready while it has
unanswered Wachiman threads.
