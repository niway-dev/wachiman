# ADR 0027: One verifier call per pull request, and a finding is dropped only with a disproof the engine can check

- **Status:** accepted 2026-11-09. **Implemented, opt-in,** by the pull request that adds this
  line (`feat/findings-verifier`); off by default until the gate in the spec is met (arm 2 on the
  Martian bench, not run yet). Takes decision B3 out of the draft ADR 0018 (#90, "degrade, never delete") and changes its
  rule for deletion; #90's ADR 0018 should drop B3 when rebased. Keeps "one judge per pull
  request" from the draft ADR 0014 (#80) and nothing else of it. Consistent with
  [ADR 0009](0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md): the
  verifier reads findings and code, not summaries.
  **Amendment 2026-11-09:** The owner turned the verifier on by default and made Haiku 5.5 high the default reviewer before the Martian arm 2 gate ran; the gate is now a check on this default, not a condition for it. Off with `verify: false`, `AGENT_REVIEW_VERIFY=0` or `local --no-verify`.
- **Spec:** [A verifier call that refutes findings before they are posted](../specs/2026-11-08-findings-verifier-design.md)
- **Issue:** #137
- **Numbering:** 0027 because open pull requests hold 0014, 0015, 0017, 0018 and 0024 to 0026.

## Context

On Martian's 50-PR bench (2026-11-07, one run, same judge for every row) Wachiman on Opus 5.5
found 63.6% of the golden comments, more than qodo (56.1%) and augment (59.0%), at 38.7%
precision against their 57 to 63%: 174 false positives, 1.5 wrong findings per right one. On Haiku
the same recall came with 314. The owner's experience matches: the cost of a wrong finding is the
author's time, and it is what makes a review feel unmanageable.

Every deterministic check the pipeline can make on a finding is already made: the cited line
exists, paths are relative, duplicates collapse, low confidence becomes a question. What is left
wrong is wrong in its premise, and only reading the code decides that. The architecture reserves
that kind of judgement for the model.

A nightly prototype has run since 2026-11-06 on kaipu-record: Haiku proposes, then one Opus and one
Sonnet call per pull request judge every candidate. Over 20 PRs the Opus call cost 49% of the
proposer's and kept 35% of the candidates; nothing has been judged yet. Draft ADR 0018 (#90)
already decided a judge over `fix`/`blocker` that degrades what it cannot confirm, inside a larger
design (spend tier, obligation ledger, reader/judge split) that has not moved.

## Decision

1. **One verifier call per pull request**, after the batches are merged and deduplicated and
   before the review is built. It receives every finding above `info` with the head code around its
   cited line and the diff hunks of the cited files, never the whole diff and never a summary.
   Same `claude -p` restrictions as a batch; read-only tools.
2. **It refutes or it does not.** Three verdicts with a reason and the lines checked: `refuted`
   with a disproof (`path`, `line`); `confirmed`, optionally with the severity one step up or
   down; `unconfirmed`. It never adds a finding.
3. **A finding is dropped only with a checked disproof.** `refuted` removes a finding only when the
   disproof's path and line exist at the head commit; otherwise the verdict counts as
   `unconfirmed`. `unconfirmed` keeps the finding at `low` confidence, so the existing confidence
   rule posts a `fix` or `blocker` as a question. `confirmed` keeps it.
4. **Dropped findings are recorded**: in the result JSON (`verification`, additive), as a count in
   the footer, and in the log. The author sees the count, the benchmark sees the findings.
5. **The verifier's money is reserved first** (`verify_budget_usd`, default $1.00, out of
   `budget_usd`, at most half of it), so the batches cannot spend it. No candidates, no call.
6. **It fails open.** A failed or stopped call posts the unverified review with a footer line.
7. **Opus 5.5 at `high` by default**, independent of the reviewer's model.

## Alternatives rejected

- **One verifier per batch, inside the loop.** Sees one batch at a time, so cross-batch duplicates
  are verified twice, and pays one cap per batch. One call per pull request is bounded and sees
  everything.
- **Degrade, never delete** (draft ADR 0018). Protects real bugs the verifier misses, but the goal
  is not to see wrong findings. The compromise is a deletion that needs evidence code can check;
  doubt still degrades.
- **Keep or drop with no evidence** (the field prototype, crysk's bare verdicts). A drop nobody can
  audit cannot be measured and the owner found it too thin.
- **Several voters per finding** (Anthropic's pipeline). Multiplies the cost of exactly the pull
  requests with findings. One careful reader per finding is the affordable form.
- **More deterministic filters instead of a model.** Everything code can check about a finding's
  shape is checked; the remaining errors are in premises, which need reading.
- **A verifier only in the benchmark harness.** The owner rejected it: the measurement must run
  the product, so the Action and the local CLI get the same step.
- **Sonnet as the default verifier.** Cheaper (24% of the proposer against 49%) and much stricter
  in the field run (kept 16% against 35%), and nobody has judged which is right. It is measured
  before it is a default.

## Consequences

- One more call per review; the cost grows with the number of findings, not the diff. The field run
  puts it at $0.21 to $0.80 per pull request with an Opus verifier.
- A review can lose a real bug to a wrong disproof that happens to cite a real line. The
  `verification` block makes that loss countable in arm 2.
- Findings at `low` confidence now also come from the verifier, so precision per confidence level
  measures two sources; the footer and JSON say which.
- The reserve lowers what the batches can spend by its amount when the flag is on. Consumers who
  set `budget_usd` to the floor will see one less batch on large pull requests.
- #90's draft moves: B3 is decided here; its tier, ledger and reader/judge parts are unaffected.

## Non-goals

- A verifier that finds bugs. Recall is the batches' job.
- Verifying contracts, thread replies or `info` notices.
- A choice of verifier model per repository beyond one input.

## Reopen when

- Arm 2 on the Martian bench cuts false positives by less than 30%, or loses more than 3
  High+Critical goldens against the baseline, in two runs: the verifier does not pay and the flag
  stays off or is removed.
- Over a month of real use, findings the verifier dropped are judged correct more often than the
  ones it kept: the disproof check is too weak and deletion goes back to degradation.
- A per-batch verifier is shown to cost less than one call per pull request on the same bench,
  which this ADR does not expect.
