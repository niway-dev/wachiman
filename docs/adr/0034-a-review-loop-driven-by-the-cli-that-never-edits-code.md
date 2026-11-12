# ADR 0034: A review loop driven by the CLI, which never edits code

- **Status:** proposed 2026-11-11. Not implemented. Amends
  [ADR 0020](0020-an-opt-in-on-laptop-review-history-with-deterministic-finding-tracking.md): its
  first reopen condition is met, and decision 4 here is the design it asked for. Reuses
  [ADR 0003](0003-two-axis-finding-labels.md) (severity),
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  (local mode) and
  [ADR 0030](0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  (result `/2`).
- **Date:** 2026-11-11
- **Spec:** [PR Confidence, a review loop and a local store](../specs/2026-11-11-pr-confidence-review-loop-and-local-store-design.md)
- **Issue:** #181
- **Numbering:** see ADR 0033.

## Context

A coding agent can already run `wachiman local`, fix what it reports and run it again. Three
things make that loop unreliable today:

- A finding has no id in the JSON result; the stable id is only printed in the stderr history
  block (`src/sinks/common.ts:215-229`).
- `local` exits `0` whenever a review ran (`src/local.ts:234-237`), so a caller cannot tell
  "clean" from "findings remain".
- A local run reviews the whole range every time
  ([local history spec](../specs/2026-11-05-local-review-history-design.md), open question 1), so
  round 2 costs as much as round 1.

ADR 0020 rejected skipping unchanged files because it changes the batch lists and the prompt, and
named the owner wanting it as a reopen condition. The owner now wants it for the loop.

## Decision

1. `wachiman loop` runs **one round per call**: a local review, a comparison with the previous
   round, and an outcome. The agent fixes between calls. The CLI never edits code.
2. Result `/2` carries each finding's history id when history is on. The loop turns history on.
3. `loop` exit codes: `0` converged, `10` findings still open, `11` stopped without converging,
   `2` usage. `local` keeps its codes.
4. Round 1 reviews the whole range. Later rounds review the commits since the previous round's
   head, **as an ordinary range review**. No file is skipped by reading the history. The loop
   keeps its own ledger of findings and decides release itself (see the amendment below).
5. The loop stays open while a 🔴 Blocker or 🟠 Fix is `new`, `open` or `not-repeated`, not
   refuted by the verifier and not judged `wrong` with a reason. A finding is released without a
   judgement only when its lines changed and the round that read that change did not report it
   again. A later round reads only the fix commits, so a finding that was not reported again at
   lines nobody changed is not evidence of a fix. The loop makes this check itself and does not
   use the history statuses to decide. 🟡 Consider and ⚪ Info are listed and never keep it open.
   **Amendment, 2026-11-12.** The loop decides release from the round's own result and the code.
   In a round that read a finding's file: reported again means `open`; not reported with the cited
   text gone means `probably-fixed`; not reported with the text still there means `not-repeated`
   (still counts). A file the round did not read keeps the previous state. History statuses are not
   used to decide: the history is shared by the whole repository, so a review on another branch
   could settle the loop's findings. The history still supplies the finding ids.
6. Three rounds by default, changed with `--max-rounds`. A review call that fails is retried once.
   Every stop prints its reason. A stop is never an approval.
7. A `wachiman-loop` skill ships beside `skills/wachiman-review`.

## Alternatives rejected

- **A Python script inside the skill.** Quicker to write. It needs a runtime the npm package does
  not install (ADR 0028 installs Bun only), and it reads the result format by hand, so a format
  change breaks it with no compiler error. ADR 0002 already answers "why not Python" for the
  product.
- **The agent keeps the books.** Counting rounds and matching findings in prose is the part
  agents get wrong, and it costs tokens every round.
- **The CLI applies the fixes.** A reviewer that writes code is a different product, and the
  README says Wachiman does not change code.
- **Skip files by blob hash from the history** (the local history spec's option b). It changes
  what the model is asked and breaks prompt parity with GitHub mode. A plain range does not.
- **No cap, loop until clean.** Other tools cap at three to five rounds; one reports a pull
  request with more than fifty review rounds before its author stopped it (spec, section 5).
- **Count every severity.** A loop that chases notes does not end.

## Consequences

- A converged loop has reviewed the whole range once and the fix commits after it. Interactions
  between a fix and code outside the fix range are not re-read. The outcome line says so; a final
  full pass is a spec open question.
- An agent can end the loop by judging findings `wrong`. The reason is required and every such
  finding is listed in the outcome for the owner.
- `/2` gains an optional field. `/1` is unchanged.
- Loop state is one more thing stored beside the history, per branch.

## Non-goals

- A loop in GitHub mode. ADR 0011 already reviews every push there.
- Running tests or builds between rounds.
- Deciding that a change is ready to merge.

## Reopen if

- Loops that converge are later found to hide a defect a full pass would have caught: make the
  final full pass the default.
- Repair rounds rarely pass one: lower the cap.
- Findings judged `wrong` by agents are mostly real when the owner checks them: stop counting an
  agent's judgement.
