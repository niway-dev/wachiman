# GPT-6.1 Sol's adversarial review of the reader, judge and local index

- **Date:** 2026-11-02. Reviewer: GPT-6.1 Sol (Codex, reasoning effort high), read-only.
- **Reviewed:** `origin/main` at `531d4a0`, plus the idea note on `docs/idea-model-tiering`.
- **Scope of verification:** Sol checked the repository's code and reports. It did not check the
  kaipu application or any external pricing.
- **Subject:** [the spec](../specs/2026-11-02-reader-judge-and-local-index-design.md), ADR 0014,
  ADR 0015.
- Line links point at `531d4a0`.

## Verdict

**Good with conditions. Worth an experiment, premature as the default architecture.** The reader
becomes a discovery bottleneck, and a repository map does not remove that bottleneck.

## 1. The recall ceiling is real

If the reader leaves out an action, a precedent or a failure path, the judge cannot reliably
rebuild it from selected slices. Putting seven incomplete batches together shows their omissions
only when some evidence of them survives.

**No measurement says Sonnet would find these bugs.** The replay ran on Opus. Sonnet only checked
findings it was handed, and recognising a bug you are told about is a different task from
discovering it.

Each missed bug carries a different risk:

- **`markCopySeen` (twice):** the best case for cheap retrieval. `git grep` already finds the
  toast's call pairing it with `startFileDrag`, so no AST is needed. Wachiman still missed both
  cases, and every reviewer missed #465 in the replay. This argues for testing better evidence,
  not for assuming Sonnet can do it.
- **Back re-float:** especially dangerous. All three Wachiman summaries praised the broken
  per-instance guard as correct. A reader can close the wrong contract with confidence.
- **Export re-list:** it needs the page, the finalize handler and the existing refresh precedent.
  Finding the files is only part of completing the causal chain.
- **The `file://` drop:** a handler that is absent plus a platform default give no newly called
  symbol to grep for.
- **The `loadURL` failure:** the async evidence is fairly explicit, and Wachiman still missed it
  three times. One CodeRabbit run described the mechanism and published no finding. That is an
  argument for treating discovery and publication as separate steps.

**Measure first whether the reader's evidence is sufficient.** Hide the bug and give a judge only
the reader's packet: can it establish the defect from that alone? Classify each failure as
omitted evidence, a wrong closure, failed reasoning or failed publication.

**Kill condition:** drop the reader as the only gate if, over repeated paired runs, readers
systematically omit the evidence for bugs that a full-context Opus finds, and a packet-only Opus
cannot recover them. Do not rescue the design by putting the known benchmark bugs into the
reader's prompt.

## 2. Citations alone do not escape ADR 0009

A citation proves that some text exists, not that the selected text is enough. "Correct, see
these three lines" is still a summary, with references attached, and that is the ratification
ADR 0009 rejects.

**The packet must contain:**

- An inventory of changed actions **extracted by the engine**, removals included, independent of
  what the reader chose.
- The before and after hunks for those actions, the enclosing code, and excerpts of sibling paths.
- What was observed about call order, state ownership and lifetime, and which code produces and
  consumes each event.
- The search scope, missing evidence, truncation, unsupported languages and unanswered questions.
- Every contract, including the ones marked closed, with its provenance.

**It must not** replace evidence with words like "safe" or "equivalent", with confidence scores,
or with a shortlist of suspicious actions chosen by the reader. **The judge must be able to
reopen closed contracts.**

**`mergeContracts` today drops disagreement.** It prefers a checked closed entry over an open
duplicate, which throws away the disagreement exactly where investigation may matter. Both
entries must be kept ([contracts.ts:215–229](https://github.com/niway-dev/wachiman/blob/531d4a0/src/contracts.ts#L215)).

The judge plus the investigations the engine admits is also more than "one expensive call", and
ADR 0009's reserve, admission and observation mode are not built yet.

## 3. Cost: savings are plausible, not shown

The split of 50 % cache reads, 36 % cache writes and 14 % output is estimated from **one Pullfrog
review**, not measured on Wachiman.

Call the baseline Opus cost **C**, the reader cost **R**, and the cost of the judges plus their
investigations **J**. The design saves money only if **R + J < C**.

For illustration only (the price ratio is not verified): if Sonnet costs 60 % as much for the
same token trajectory, then R = 0.6C, and the judges get less than 40 % of the baseline. Against
$3.85 for the five-PR suite, that leaves $1.54 for five judges and their investigations.

It gets more expensive when readers take more turns, when contracts grow, when judges re-read
source files, or when many questions need their own call. Reader output becomes fresh input for
the judge, and cache reuse across different models is not verified.

## 4. Local index: targeted AST enrichment first

- **Tree-sitter alone does not fix the alias miss.** `libraryChanged` found neither renderer
  consumer with `git grep`, and tree-sitter's by-name scan missed them too. Project-specific bridge
  logic recovered `onLibraryChanged`. PageRank cannot follow an edge nobody extracted.
- **Parse time is not measured where it matters.** 1,267 files parsed in 640–889 ms on a laptop,
  not on a cold GitHub runner and not on a large monorepo.
- **The language trials were small.** They hit parse errors, grammar compatibility problems and
  missing reference queries.
- **What to do instead:** start with TS/TSX classification and a measured recovery of aliases. Cap
  the files, bytes, time and prompt tokens, and keep the `git grep` fallback.
- **Test retrieval before PageRank.** Measure how much relevant evidence comes back at a fixed
  token budget before adopting PageRank. Popular utility symbols can crowd out the rare event
  edge that explains the bug.

## 5. Cheaper or safer alternatives

- **Group related changed files** by imports and shared calls, with small overlapping "bridge"
  excerpts. Batching today uses modules, risk order and size, not semantic relationships.
- **Keep Opus as the reader.** Add deterministic evidence and investigate only the unresolved
  contracts.
- **Try Sonnet alone first.** If it keeps useful recall, the judge is unnecessary machinery.
- **Escalate only explicit disagreement,** and audit a sample of agreements, because correlated
  mistakes make "no disagreement" unsafe.
- **Give a small, independent Opus pass a ledger of actions and removals built by the engine.**
  That gives discovery a route that does not depend on Sonnet's questions.

## 6. Build order and gates

1. **Opus and Sonnet baselines on v1.4.0,** run repeatedly, then on held-out PRs. Record retrieval,
   contract correctness, publication, Medium+ findings, precision, cost and latency.
2. **The smallest retrieval or grouping change** that the observed misses justify. Go on only if
   evidence recall at a fixed budget, or the confirmed findings, improve.
3. **A reader → judge prototype in shadow mode,** keeping the raw disagreements and an independent
   record of which actions were covered. Ship only if quality on held-out PRs is no worse and the
   total cost falls meaningfully (Sol suggests **at least 20 %**).

Reserve the judge's capacity before the readers spend the run budget. Keep the incremental review
semantics and account for repeated pushes. ADR 0012's per-PR ceiling is proposed, not yet a
protection.

## 7. Errors in the existing docs

- **Aliases:** the flow-questions spec (decision 14) says tree-sitter "resolves" aliases. The
  experiment shows custom bridge logic is needed.
- **Invalid citations:** the same spec says an invalid citation turns a contract open. The code
  keeps the status and sets `evidence_checked: false`.
- **"Code never leaves the consumer's infrastructure"** (multi-language mapping note) is
  misleading. A local index avoids a hosted index, but the selected code still goes into the model
  requests.
