# ADR 0018: The judge answers obligations the engine extracts, and degrades what it cannot confirm

- **Status:** proposed 2026-11-02. Not implemented. **Amends ADR 0014** (#80, a cheap reader per
  batch and one judge per pull request): it fixes what the judge is obliged to read, and what it
  may do with a reader's finding. **Builds on ADR 0016** (#88, data-path questions chosen by the
  engine from the added lines) and on
  [ADR 0009](0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md).
- **Spec:** [review depth, model tiers and memory](../specs/2026-11-02-review-depth-model-tiers-and-memory-design.md),
  part B.
- **Evidence:** [E1](../benchmark/2026-11-02-e1-sonnet/README.md#why-sonnet-lost-what-opus-found);
  the live workspaces chain (#87); the held-out set (#86);
  [ideas from Anthropic's post](../research/2026-10-26-ideas-from-anthropic-code-review.md), idea 1.

## Context

ADR 0014 gives the judge every batch's contracts, closed ones included, the cited code and an
action ledger, and lets it reopen any closure. It does not say which closures it must reopen. E1
showed why that matters: in all three Sonnet runs on kaipu-record #465 the reader cited the exact
sibling line that pairs `markCopySeen` with `startFileDrag`, compared only the failure paths, and
closed the contract with "matches its siblings". A judge free to trust that closure would.

The live run on the workspaces chain showed the same shape on the bugs that cost the most. On #479
`healEntry` computes whether the source still matches the journal and then deletes the source
without reading the answer; Wachiman commented two lines above and flagged something else. On #478
a cached name was written over a rename made on another machine, twice, through two paths. On #482
Wachiman found 0 of 5 real bugs. On the held-out #276 a ticket is read, checked and released in a
second statement. Every one of these is an action taken on a stored belief about a file or a
value, without re-checking it at the moment of the action. A careful person asks that question at
every `unlink`. A batch, on either model, did not.

#88 (ADR 0016) answers the first half of this. The engine now asks a data-path question of a batch
whose added lines show the pattern: a destructive step, a stale write-back, overlapping calls, an
unbounded wait, a read error treated as empty. The question is in the prompt, and the answer
"belongs in `contracts`". Nothing makes the answer mandatory, nothing checks that a closed
contract actually names a check made after the decision to act, and nothing reads the answer with
the code in front of it. E1 says that last step is where the loss is.

Anthropic's own review pipeline separates finding from verifying: hunters propose, a separate
group votes, only survivors are posted. Wachiman cannot afford voters at its budget, but it has
two things that make one verifier affordable: a precision of 0 invalid findings in every run, so
`consider` needs no verification, and a contracts block that already records what the reader
concluded and from which line.

## Decision

1. **Every firing of a data-path question is an obligation.** The engine keeps ADR 0016's
   selection and, in addition, records each firing (file, line, question id, enclosing function)
   in a ledger in the run dir, like `evidence.json`. The questions and their triggers stay ADR
   0016's; a new class enters only behind a measured miss.
2. **Every obligation ends as a contract.** A batch must return `closed` with a citation that
   answers the question, or `open`. An obligation with no contract is `open` by construction. The
   engine never judges the answer; it only refuses silence.
3. **The judge must read, not agree.** For every obligation and for every reader finding
   labelled `fix` or `blocker`, the judge receives the cited code, not the reader's sentence
   alone, and returns one of: confirmed, reopened (a finding or a question), or "not a defect
   because <citation>". A `consider` passes without verification.
4. **Degrade, never delete.** A reader finding the judge cannot confirm is posted as `consider`
   or as a `question`, with a note that it was not confirmed. A `consider` that the judge finds to
   be a silent wrong result is upgraded to `fix`. No reader finding is dropped by the judge.
5. **The outcome is visible.** The review's contracts block lists each obligation, its closure
   and the judge's outcome, so the operator sees which ones were read.
6. **A class enters the table only behind a measured miss.** A class nobody missed is noise.

## Alternatives rejected

- **Leave the questions as a prompt section** (ADR 0016 as written). The reader may answer in
  prose, close with a citation that does not answer the question, or not answer. The field run
  shows readers approving the exact code that held the bug; a question they can skip changes
  little.
- **Let the judge decide what to reopen** (ADR 0014 as written). It would trust the closures a
  careful person never trusts, because the reader's text says they are safe. E1's failure.
- **Several voters per finding, as Anthropic does.** It multiplies the cost of exactly the pull
  requests with findings. One reader of cited code per serious finding is the affordable form.
- **Drop what the verifier does not confirm.** A verifier that filters hides the true positives
  it misses. Degrading keeps them visible at a lower label, which is what ADR 0003's labels are
  for.
- **Verify every finding, `consider` included.** Precision is already 0 invalid in every run;
  verification would spend where nothing is wrong.
- **A score from the obligation count that gates the judge.** ADR 0009 rejected gating on
  indicators until they are measured. The obligations are questions, not a score.

## Consequences

- The judge's packet grows by the ledger and the enclosing function of each entry; the budget
  for it comes from the judge's reserve (ADR 0014 decision 5).
- "Seen, not published" becomes impossible for obligations: an unanswered one is an open contract
  in the review.
- A pull request with no obligation and no reader `fix` can skip the judge (spec open question 6).
- Over-extraction costs one contract per false match. Under-extraction is the number E3 measures
  before anything is built.
- Labels move in both directions after the judge, so the Signal score of the message-quality
  rubric changes meaning: it now measures the judge, not the reader.

## Non-goals

- Semantic analysis by the engine. The table names calls and shapes; the judge decides.
- Tree-sitter or type resolution for the extraction (ADR 0015's experiment decides that).
- Investigation beyond ADR 0009's reserve and admission policy.

## Reopen when

- E3 shows the table misses the known destructive acts on the benchmark sets, and no cheap
  extension recovers them: then the ledger waits for the index.
- E2 shows a judge with cited code reopens fewer than 3 of the 5 closures Sonnet got wrong: then
  the reader caps recall and the `standard` tier runs the reader on Opus with no judge.
- Degraded findings turn out to be right more often than confirmed ones over a month of real use:
  the verifier costs more than it is worth.
