# ADR 0016: Data-path questions are chosen by the engine from the added lines

- **Status:** accepted 2026-11-03. Implemented by the pull request that adds this file
  (`src/questions/`, `buildBatchPrompt`).
- **Date:** 2026-11-02
- **Evidence:**
  - [Field run 2026-11-02](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02-field/README.md),
    section "What to improve in Wachiman", items 1 to 5: the bugs these questions target.
  - [Batch-level A/B 2026-11-03](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-03-data-path-questions-ab/README.md):
    on the five batches that held the 10 missed bugs, two runs per arm, Opus 5.5, the questions
    took the bugs found at least once from 2 to 7 of 10. Invalid findings stayed at 0, and the cost
    per batch fell from $0.59 to $0.52, with fewer turns. **The questions were written from the same
    10 bugs**, so this shows they reach their targets, not that they generalise. Held-out bugs
    decide that (see the reopen condition).
- **Numbering:** 0014 and 0015 are taken by the open design pull request #80, so this record is
  0016.

## Context

On seven kaipu-record pull requests that shipped one feature (about 24,000 added lines), Wachiman
found 2 of the 11 real Medium-or-higher bugs on the three pull requests all three bots reviewed;
CodeRabbit found 6 and Pullfrog 4. Auditors traced each miss to the batch that covered the code.
Five patterns recur:

1. A destructive step (`unlink`, `rm`, "clear every other") that does not re-verify its target, or
   whose failure still drops the record that would allow a retry.
2. A read error treated as "empty" and then written back.
3. Two calls in flight at once on the same cache, map or file.
4. A probe, poll or loop whose individual calls are bounded and whose total is not.
5. Cached or deferred state written back over another writer's change.

In each case the batch's summary described the code and approved it. The model had not been asked
the question: the flow questions (`FLOW_QUESTIONS`, [ADR 0009](0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md))
ask what a new action does, not what a delete is aimed at or what bounds a wait.

## Decision

1. **Five questions, one module each** in `src/questions/`, with the contract `DataPathQuestion`
   (`id`, `title`, `text` of at most 120 words, `applies(addedLines, filename)`).
2. **The engine selects them per batch, deterministically.** `selectQuestions(files)` runs every
   `applies` over the added lines of each file of the batch (rows of the patch that start with `+`,
   without it) and returns the questions that apply to at least one file, once each, in registry
   order. No model, no network, no repository read.
3. **A batch where none applies is unchanged.** Its prompt is byte-identical to the one before
   this record. Otherwise the prompt gets a section "Risks this part's added lines show" right
   after `FLOW_QUESTIONS`, with the title and text of each selected question. The answers belong
   in `contracts`, like the flow questions', and a defect found is reported as a finding as well.
4. **The selection is logged per batch** (`Data-path questions for part 1 of 3: bounded-wait`), so
   cost and findings can later be attributed to a question.

## Alternatives rejected

- **Ask all five in every batch.** Every batch would pay the words and, more important, the
  reading and `contracts` entries the questions provoke, including batches of CSS, docs and CI.
  v1.4.0's flow questions already raised re-review cost from $0.27 to $0.57 on average
  (field run), and those apply everywhere. A batch with no delete, no persisted write and no wait
  gains nothing from these questions.
- **Let the model decide which to ask.** The failure being fixed is that the model did not think of
  the question. Asking it to choose among questions repeats that dependence, and ADR 0009 already
  decided that the engine gathers and admits work while the model judges. Here the engine only
  decides what to ask, from text; the model still answers and judges.
- **Score the pull request and gate on the score.** ADR 0009 rejected thresholds from indicators
  until they are measured; a pattern match on added lines is a smaller claim than a score.

## Consequences

- A batch that shows a pattern pays for the section (up to 120 words per question; on the
  kaipu-record data pull requests, 12 of 35 batches fired, with 430 words on average, 192 to 687,
  which is 1.4 % of all the prompt characters those pull requests send) and for whatever extra
  reading the model does to answer. The second cost is not measured.
- A trigger is a regex over added lines, so it has known misses and known false alarms. Each module
  documents its own. The misses that matter:
  - `read-error-as-empty` needs the write in the same added lines. A `catch` added to a store whose
    write is unchanged context is missed; a write-less config loader that falls back to defaults is
    deliberately not asked. It also skips test files.
  - `stale-write-back` misses the upgrade that produced #478's first bug (`upgradeDefaultColor`,
    commit `07a47af`): the write and the remembered value are not within its window of added lines.
  - `bounded-wait` ignores `.tsx` and `.jsx` and UI timing words, so a wait in a component is not
    asked about; `setTimeout` alone is not a signal.
  - `overlapping-calls` does not check the order of the await and the write, and `destructive-step`
    sees only calls it has a name for and a clear call within three added lines of a loop header.
  - `applies` receives one file's added lines, never the unchanged ones, so a pattern that spans
    unchanged code is invisible to every trigger.
- A new question is a new module and a new entry in `QUESTIONS`; nothing else changes.
- Each question is a hypothesis about what the model misses. Without a replay, a question that
  never finds a bug still costs on every batch that fires it.

## Non-goals

- Verifying an answer. The engine checks that cited lines exist (`src/contracts.ts`), as for the
  flow questions, not that the answer is true.
- Questions for patterns the field run did not show (CSS cascade, risk ordering), and the engine
  bug about merges from the base branch (items 6 to 8 of the same section).
- Reading unchanged code in the triggers, or calling the model to classify a file.
- Changing batching, budgets or the number of calls.

## Reopen if

- A replay of the field-run pull requests (#478, #479, #482, #483) with these questions on finds no
  more of their real Medium+ bugs than the same engine without them. Then remove the questions that
  found none.
- Or the batches that fire cost more than the field run's per-batch average by a margin the owner
  sets before the replay (proposed: 25 %) without a confirmed finding to show for it.
- Or the firing rate on a repository's pull requests of the kind the contrast set represents
  (UI, docs, CI) climbs well above the 2 % of files measured here (proposed: above 20 %). Then
  tighten the trigger that fires.
