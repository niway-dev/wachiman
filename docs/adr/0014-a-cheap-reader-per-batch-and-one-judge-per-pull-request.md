# ADR 0014: A cheap reader per batch and one judge per pull request

- **Status:** proposed 2026-11-02. Not implemented. Gated on the v1.4.0 benchmark and on E1
  (v1.4.0 with Sonnet on every batch). Amends [ADR 0009](0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md):
  the judge is not a pass over summaries, see decision 2.
- **Spec:** [reader, judge and local index](../specs/2026-11-02-reader-judge-and-local-index-design.md)
- **Issue:** #79

## Context

Each batch is one independent call on one model. The model reads every file of its batch, and no
call sees the whole pull request. Two consequences were measured on 2026-11-01.

The first is cost. Most of it is reading (cache reads ~50 %, writes ~36 %, output ~14 %), and on
Opus that reading happens at the expensive model's price.

The second is recall. Bugs whose evidence lived in a file outside the batch were missed. On #465
the drag handle's batch never held the file whose call site pairs `markCopySeen`.

## Decision

1. **Reading and judging are separate calls on separate models.** The engine chooses the models.
   A model never picks a model or starts another call.
2. **A reader returns evidence, not conclusions.** That means findings, contracts and open
   questions, each with `file:line` citations the engine checks. It returns no verdict on another
   batch, no uncited "this is correct" and no summary of its batch. This is what separates the
   judge from the pass over summaries that ADR 0009 rejected: the judge reads citations and the
   cited code, never another model's conclusion. Citations alone are not enough. A citation proves
   the text exists, not that it is sufficient, so "correct, see these lines" is still a summary
   (GPT-6.1 Sol). Decisions 4 and 6 are what make the judge more than a ratifier.
3. **Reader findings are posted directly** after the citation check. The judge adds and deepens.
   It does not gate them.
4. **One judge per pull request** sees every batch's contracts, **closed ones included**, and open
   questions, the cited code, an index slice and an **action ledger the engine builds** without
   any reader (every changed action, removals included, with before and after hunks). It may
   reopen any closed contract. It does not see the whole diff.
6. **Disagreement is kept:** an open and a closed copy of one contract both reach the judge.
   Today's `mergeContracts` drops the open one, and that changes first.
5. **The judge has its own reserve,** which readers cannot spend. Investigation follows ADR 0009.

## Alternatives rejected

- **One expensive pass per batch (today):** the reading is paid at the expensive price, and no
  call sees two batches.
- **A reader then a judge per batch:** each judge still sees one batch.
- **An orchestrator agent with subagents:** the model controls spend and tools.
- **Everything on the cheap model:** to be measured by E1. It is rejected only if E1 shows a loss
  on the real Medium+ bugs.

## Consequences

- Recall is capped by what readers point at. This is the main risk, and E1 measures it.
- One more call per review, and a new failure mode: if the judge fails, reader findings still post.
- The review shows which findings came from the judge, so precision can be measured per stage.

## Non-goals

- Type resolution.
- A verification pass on every finding.
- Codex in either role, before ADR 0004's workflow integration.

## Kill condition

Over repeated paired runs, readers systematically omit the evidence for bugs that a full-context
Opus finds, and a packet-only Opus cannot recover them. The reader then stops being the only gate.

## What would reopen this

E1 shows a Sonnet-only review matches Opus on real Medium+ bugs: then one cheap pass is enough.
Or the reader/judge pipeline costs more per run than v1.4.0 on Opus without finding more.
