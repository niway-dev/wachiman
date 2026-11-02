# ADR 0009: Investigation is requested by the model and admitted by the engine

- **Status:** proposed 2026-10-31
- **Spec:** [Flow questions and evidence](../specs/2026-10-31-flow-questions-and-evidence-design.md)
- **Evidence:** [field benchmark 2026-10-31](../benchmark/2026-10-31/README.md),
  [Sol's critique](../research/2026-10-31-sol-critique-risk-map-and-depth.md)

## Context

Wachi's review is broad by construction: the engine splits the diff into batches and every file
is read. On five real pull requests that breadth produced 17 valid findings for $3.28, while a
depth-first competitor produced 7 for $7.68 and still caught the most serious user-facing bug on
four of the five. Those bugs were not in files Wachi skipped; they were in questions Wachi never
asked ("what does the existing path do before it drags this copy?"), whose answers lived in
unchanged files outside the diff.

Two ways to add depth were on the table. Let the agent decide what to investigate and how far, as
the competitor does: it finds what it looks for and nothing else, and its spend is bounded only
by a timeout. Or let the engine decide from indicators (fan-in, key paths, churn) which changes
deserve depth: a score cannot understand a contract, uncalibrated thresholds would have called a
14-file PR trivial, and the owner rejected fixed thresholds until indicators are measured.

## Decision

Judgement and execution are split.

1. **The engine gathers evidence** before the batch runs: a risk map of candidates with
   provenance (`module_scan`, `text_match`, `history`) and status (`complete`, `truncated`,
   `unsupported`), never a verdict.
2. **The model judges** inside its batch: for every new action or new call into existing code it
   answers the flow questions, cites code, and may return `needs_investigation` with one concrete
   question, its premises and candidate files. It never decides dollars, tools, turn counts or
   further calls.
3. **The engine admits work** under a finite, visible policy: a separate reserve for
   investigation that cannot touch the coverage budget, a maximum number of admitted questions per
   review, and no recursion. What is not admitted stays in the review as an open contract with its
   reason.

"The model only judges; code decides" keeps its meaning: code governs execution. It never meant
that a score understands semantics.

## Alternatives rejected

- **Agent-driven depth** (the competitor's model): unbounded spend and blind spots wherever the
  agent did not look; it also needs interactive tools the model must not have.
- **Threshold-driven depth from indicators:** rejected until indicators are measured; a score that
  gates the flow question would have switched it off exactly on the small PR that needed it.
- **A pass over batch summaries:** re-reasoning over conclusions that already say "correct"
  ratifies the gap instead of finding it.

## Consequences

- Breadth is untouched: the flow questions are part of every batch, not of a deep mode.
- The cost ceiling is explicit: coverage budget plus investigation reserve, both in the workflow.
- Admission starts in observation mode: requests are logged and measured before any extra call
  is made. The first number to watch is how many admitted investigations end in a finding the
  owner confirms.
- Each batch's output grows a `contracts` list the engine can verify for shape and reference
  existence, not for truth.

## Implementation

Status stays "proposed": whether to accept the ADR is the owner's call, and most of its decision is
not built. What exists (branch `feat/flow-questions-and-contracts`; spec decisions 1, 2, 3 and 9):

- The flow questions and the failure-path question are in every batch prompt (`FLOW_QUESTIONS`),
  and the pull request body is named as the author's claim to verify.
- `contracts[]` is in the batch output schema. The engine checks shape and that every cited line
  exists in the checked-out head (`src/contracts.ts`), warns and marks `evidence_checked: false`
  when it does not, merges contracts across batches, and renders them in a collapsed "What the
  change connects to" block.
- `confidence` is a field of each finding, shown in its label.

Not built: the risk map (decisions 4 and 5), `needs_investigation`, the reserve and the admission
policy, including observation mode (decisions 6 to 8). Open contracts are listed in the review
and nothing acts on them yet.

## Non-goals

- Automatic resolution of anything the model investigated.
- A persistent code index or a hosted service (ADR 0001).
- Tuning thresholds from the five benchmark PRs alone.

## Reopen when

- Observation mode shows admitted investigations rarely end in confirmed findings, or the
  reserve is never used: the split costs more than it returns.
- Or a measured indicator predicts confirmed findings well enough that gating on it beats asking
  everywhere, on PRs the indicator was not tuned on.
