# Review depth: engine-extracted obligations, a spend tier instead of model inputs, and memory from contracts

- **Status:** draft for discussion, 2026-11-02. Nothing here is built. It complements the
  [reader and judge design](https://github.com/niway-dev/wachiman/pull/80) (#80, draft; its spec is `docs/specs/2026-11-02-reader-judge-and-local-index-design.md` on that branch):
  that spec decides *who* reads and *who* judges; this one decides *what the judge is obliged to
  check*, *how the consumer chooses depth*, and *what the engine remembers between reviews*.
  Where the two disagree, the table below says which decision of #80 changes.
- **Issue:** #79.
- **Creates:** ADR 0017 (Anthropic only; a spend tier is the consumer's knob, models and effort are
  the engine's; supersedes ADR 0004) and ADR 0018 (the judge answers obligations the engine
  extracts, and degrades what it cannot confirm; amends ADR 0014 of #80 and builds on ADR 0016 of
  #88). Both proposed. ADR numbers 0014 and 0015 are reserved by #80, 0016 by #88.
- **Reuses:** ADR 0001 (budgets are workflow inputs), ADR 0003 (labels), ADR 0006 (policy layers),
  ADR 0007 (memory by draft PR; an amendment is proposed in part C), ADR 0008 (two replies per
  thread), ADR 0009 (evidence by the engine, judgement by the model), ADR 0011, ADR 0012, ADR 0016
  (#88, draft: five data-path questions the engine selects per batch from the added lines; its
  `destructive-step` and `stale-write-back` questions are the ones this spec turns into
  obligations).
- **Evidence:** [results so far](https://github.com/niway-dev/wachiman-benchmarks/blob/main/results.md); [v1.4.0 on Opus](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02/README.md);
  [E1, v1.4.0 on Sonnet](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02-e1-sonnet/README.md); the held-out set (#86); the
  live workspaces chain on kaipu-record (#87); the census of `Verdict:` replies (part C);
  [ideas from Anthropic's code review post](../research/2026-10-26-ideas-from-anthropic-code-review.md).
- **Written on:** Claude Fable 5.1, from a design conversation with the owner on 2026-11-02.

## Summary (one minute)

Three benchmarks agree on where Wachiman stands. It posts no invalid findings (0 in every run so
far), it is the broadest reviewer, and on the five exhibition PRs v1.4.0 finds more real bugs per
run than Pullfrog or CodeRabbit. On the pull requests that **move or store user data** it loses:
2 of 11 real Medium+ bugs on kaipu-record #478, #479 and #482, against 6 for CodeRabbit, and the
one High bug (healing deletes a source it never re-checked) was missed while Wachiman commented
two lines above it. E1 showed the losses are not knowledge but reasoning: Sonnet cited the right
line in every run and drew the wrong conclusion from it.

So the next step is not more context. It is a reviewer that behaves more like a careful person:
when the code deletes, overwrites or renames something it only *believes* it still owns, the
reviewer must ask what proves that belief, and must say so before posting a confirmation.

This spec decides three things:

- **A. The consumer chooses a spend tier, not a model.** `tier: economy | standard | deep`
  replaces the `model`, `effort` and `provider` inputs. The engine owns the model and effort of
  each role and prints them in the footer. Only Anthropic models are supported (ADR 0017).
- **B. The engine extracts obligations and the judge must answer them.** #88 already makes the
  engine ask a data-path question wherever the added lines show its pattern. This spec makes each
  firing an obligation: it must end as a contract, and the judge re-reads the cited code for every
  obligation and for every reader `fix`/`blocker`. What the judge cannot confirm is degraded,
  never deleted (ADR 0018).
- **C. Memory starts from contracts, not verdicts.** No `Verdict:` reply exists in any of the
  owner's repositories, so ADR 0007 would learn nothing today. Engine-checked contracts that
  recur become `learned/facts.md` through ADR 0007's draft PR, and "Fixed in <sha>" replies count
  as implicit verdicts for precision.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| A1 | Wachiman supports Anthropic models only. The `provider` input and the Codex path leave the workflow and the docs; the adapter may stay in the tree until removal is convenient | One operator, one key, one price table, one sandbox posture, one cache. The "second family avoids the author's blind spots" argument of ADR 0004 has no measurement behind it, and three benchmarks found the gap elsewhere (reasoning, not family) | 0017 (new), supersedes 0004 |
| A2 | One input, `tier`, with values `economy`, `standard`, `deep`. It sets the reader model and effort, whether the judge runs, and its model and effort. It never sets dollars: `budget_usd` and `auto_budget_usd` stay the consumer's cap (ADR 0001 decision 6) | Three knobs (`model`, `effort`, `max_turns`) let a consumer pick a combination nobody measured. The tier names the combinations that were | 0017 |
| A3 | The engine records model and effort per role in the signed footer, as it does for cost; the judge never runs below `high` | The hub convention: the role that decides is never cheapened. Opus 5.5's own default is `medium`, so the value must be explicit | 0017 |
| A4 | Tier contents are fixed by measurement, not by this spec. Until E0 and E1b run, the placeholders are: `economy` = Sonnet `medium`, no judge; `standard` = Sonnet `high` reader + Opus `high` judge; `deep` = Opus `high` reader + Opus `high` judge | E1 measured Sonnet `high` (5.3 bugs, $4.58) and Opus `high` (7.3, $6.96). Nothing has measured Opus `medium` or Sonnet `medium`; the model reference says to try the most capable model at lower effort before a cascade | 0017 |
| B1 | #88's data-path questions become an **obligation ledger**: every firing of `selectQuestions` is recorded per file and line in the run dir, like `evidence.json`, not only rendered into the batch prompt. The question is #88's ("what proves the target is still what this code means to delete?"). The ledger extends #80 decision 11's action ledger with a question per action and feeds the judge | A2 and B1/B2 on #478/#479, D1 on #482, and #276 of the held-out set are all one shape: act on a stored belief without re-checking it. #88 asks the reader; nothing yet makes the answer mandatory or checks it. A person asks that question at every `unlink`; a batch did not | 0018 (new), amends 0014, builds on 0016 |
| B2 | Every obligation must end as a contract: `closed` with a citation that answers the question, or `open`. An obligation with no contract is an open contract by construction and goes to the judge | "Seen, not published" is measurable only if silence is impossible | 0018 |
| B3 | The judge re-reads the cited code for every reader finding labelled `fix` or `blocker` and for every obligation. A `consider` passes without verification. Verdicts: **confirm** (label kept), **degrade** (to `consider` or a `question`, with a note that says it was not confirmed), **upgrade** (a `consider` that is a silent wrong result becomes `fix`). It never deletes a reader finding | PR 16 idea 1 and Anthropic's own pipeline: a separate group verifies before posting. Degrade, not drop, so a real bug the judge misses stays visible. Upgrade because 13 real Medium+ bugs were posted as `Consider` on Opus and more on Sonnet | 0018 |
| B4 | The judge's packet is: reader findings and contracts (open and closed, disagreements kept), the obligation ledger, the cited code slices, and the action ledger. Never the whole diff, never a prose summary of a batch | Unchanged from #80 decisions 2, 4 and 12. Restated so the obligations are a named part of the packet | reuses 0014 |
| B5 | The sibling-call flow question names the property to compare: what the sibling does right before and right after the call that the new code does not. "Do they fail the same way" is removed | #465 `markCopySeen` was lost by both models by comparing failure paths only, with the pairing line on screen | none (prompt) |
| B6 | Review runs collect threads with the thread-only run's rule (`pendingThreads`, `src/engine.ts:1526`), not `openThreads` (`src/engine.ts:1822`). A thread whose latest comment is Wachiman's is never answered again. A finding whose path, line and topic match a posted thread is not posted again | On #478 at `649c902` Wachiman re-answered two threads it had already confirmed. PR 16 idea 3. Half of the live bill on the workspaces chain was re-reviews (#87) | reuses 0008, 0012 |
| B7 | `dedupeFindings` matches on the defect, not on file and line: a finding cited on a source and on its test is one finding with two anchors | The `file://` drop was posted 7 times across 3 runs | none (engine) |
| B8 | Every prompt or engine change that targets review quality registers a prediction on a replay set before it runs, and ships only if the measured set does not regress. The sets are the exhibition five (#463–#467), the held-out five (#402, #255, #276, #269, #184) and the data-moving three (kaipu-record #478 at `7620879`, #479 at `aac7202`, #482 at its first reviewed head) | PR 16 idea 2 ("misses become an eval set") is already the practice; this makes it a rule. The data-moving set is where the obligations are tested | none (practice) |
| C1 | **Facts from contracts.** A `closed`, engine-checked contract that appears in two reviews of one repository with the same citation becomes a line in `learned/facts.md` (`paths`, the citation, the source PRs), proposed through ADR 0007's draft PR. On every review the engine re-checks each fact's citation against the base; a fact whose citation is gone is proposed for deletion in the next learn PR | It is the only memory source that exists today, it costs no model call, and it expires itself, which is the owner's objection to any index. Layer 4 of ADR 0006: context, never authority | amends 0007 (decision 2) |
| C2 | A reply of the form "Fixed in <sha>" by the operator on a Wachiman thread counts as `Verdict: right` for `src/precision.ts`. It is not a lesson source | 94 such replies exist; 0 `Verdict:` replies exist. It is the signal the owner actually produces | reuses 0007 |
| C3 | Verdict-based lessons stay as ADR 0007 and are not built until verdicts exist | No input, no output | reuses 0007 |

## Open questions

1. **The default tier for a new install.** Today's default is Sonnet `high` with no judge, which
   E1 measured at 5.3 real bugs per run for $4.58. Default: `standard` once the judge exists,
   `economy` until then, so that the default never changes behaviour silently.
2. **Does the tier set `max_turns` and `call_timeout_s` too?** Default: no. They are safety
   stops, not quality choices, and they stay inputs.
3. **How much of `budget_usd` is the judge's reserve** in `standard`? #80 says 40 % as a
   placeholder. The data from E1 says five judges must fit in about $1 to beat Opus-only by 20 %.
   E2 decides.
4. **The triggers' known misses.** #88's triggers are regexes over added lines and document their
   misses: `stale-write-back` does not fire on `upgradeDefaultColor` at `07a47af` (#478's first
   bug), and no trigger sees a pattern that spans unchanged code. Default: accept them, count them
   in E3, and widen a trigger only behind a measured miss. Tree-sitter waits for ADR 0015's
   experiment.
5. **When Codex leaves the tree.** Default: the adapter and `docs/providers/codex.md` are removed
   in the release that ships the tier, so that no release documents an unsupported path.
6. **Whether the judge also runs on incremental reviews.** They are half the live bill (#87) and
   found one real bug. Default: the judge runs only when the delta has at least one obligation or
   one reader `fix`.
7. **Did Wachiman stop finding issues it used to find?** Answered 2026-11-03: no. The question
   came from reading the benchmark tables side by side, not from a review that missed something.
   On the same five exhibition PRs, real Medium+ bugs per run rose from 1.3 (v1.3.0) to 7.3
   (v1.4.0 on Opus) and expected issues stayed at 10–13 of 26. The lower numbers elsewhere count
   different sets: the held-out set has 4 catalogued bugs (1.33 per run), and the field run's 2 of
   11 was v1.3.0. No experiment is planned for it.

## Out of scope

- The local repository index and its ranking (#80, ADR 0015).
- Codex as a second reviewer, a council or an adversarial pass (ADR 0004's non-goal, now
  superseded).
- Making the review blocking (ADR 0001 non-goal).
- Verdict-based lessons beyond what ADR 0007 already says.
- Any state outside the consumer's repository (ADR 0001).

## Failures this must protect against

- The judge ratifies a reader's "matches its siblings" because it reads the sentence instead of
  the code (ADR 0009's rejected pass over summaries; E1's actual failure).
- The judge deletes a real finding it failed to confirm. Degrading keeps it visible.
- An obligation ledger with no matches on a data-moving PR, because the destructive call is
  behind a helper the table does not name. E3 counts this.
- The tier changes a consumer's cost without a release note.
- A fact in `learned/facts.md` stays after the cited code changed.
- A "Fixed in" reply by someone other than the operator counts as a verdict.

## Acceptance criteria

- [ ] E3 (no model): the obligation ledger built at `aac7202` of kaipu-record #479 lists the
  `unlink(sourceMedia)` and `removeCompanions` of `healEntry` under `destructive-step`; at
  `649c902` of #478 it lists the `pendingIdentity` write under `stale-write-back`; and on the
  E1 runs, every firing has a contract that cites a check made after the decision to act, or is
  `open`.
- [ ] E2 (offline): given only the Sonnet contracts, the obligation ledger and the cited code of
  the E1 runs, an Opus judge reopens at least 3 of the 5 losses listed in
  [results.md](https://github.com/niway-dev/wachiman-benchmarks/blob/main/results.md#would-sonnet-reports-opus-judges-have-found-what-sonnet-lost),
  at about $0.20 per pull request.
- [ ] A test shows a reader `fix` the judge cannot confirm is posted as `consider` with the
  unconfirmed note, never dropped.
- [ ] A test shows a review run never answers a thread whose latest comment is Wachiman's.
- [ ] The workflow has a `tier` input and no `model`, `effort` or `provider` input; the footer
  prints model and effort per role.
- [ ] On the data-moving set, `standard` finds the High bug of #479 in at least 2 of 3 runs, with
  0 invalid findings and expected issues within one of v1.4.0 on Opus.
- [ ] `learned/facts.md` lines are proposed only for contracts seen in two reviews, and a fact
  whose citation no longer exists is proposed for deletion.

## Experiments, in order

Each one registers its prediction before it runs, like every benchmark so far.

| Run | What | Model and effort | Answers | Cost |
| --- | --- | --- | --- | --- |
| E3 | Obligation ledger on known commits | none | #88's firing table is the first half (where the questions fire). The second half: does each firing on the known commits point at the known act, and does the reader's contract answer it? | $0 |
| E2 | Packet-only judge, offline, on the E1 reports | Opus 5.5 `high` | Does a judge that sees cited code reopen what Sonnet closed wrongly? | about $1 |
| E0 | v1.4.0, five exhibition PRs, three runs | Opus 5.5 `medium` | Does lower effort on the capable model keep 7.3 bugs at less than $6.96? | about $15–20 |
| E1b | v1.4.0, five exhibition PRs, three runs | Sonnet 5.5 `medium` | Is `economy` still above Pullfrog's 3.5 bugs? | about $10–14 |
| E4 | `standard` tier (reader + judge with obligations), data-moving set and held-out set | per tier | Does the judge find the High bug of #479 and #482's five, at ≤ 80 % of Opus-only cost? | to be set after E2 |

**Why E0 exists.** Sonnet's saving in E1 was 34 %, not the 50 % the price list suggests. Cache
reads cost the same on both models ($0.20 per million tokens), and an agentic run is mostly cache
reads (92–95 % of Pullfrog's tokens on #478 and #479). The cheaper reader saves on the smaller
buckets. Lower effort on Opus saves on output, which is the bucket priced highest. Nobody has
measured which saving is larger.

**Kill conditions.** If E2 reopens fewer than 3 of 5, the judge does not recover what the reader
closes, and the `standard` tier becomes Opus reader without a judge. If E3 misses the known
destructive acts, the ledger waits for the tree-sitter experiment of ADR 0015.

## Detail

### A. Why a tier and not a model

The workflow today exposes `model`, `effort`, `provider`, `max_turns` and five budget inputs.
kaipu-record sets Opus and `high`; every other consumer gets Sonnet and `high`. Three measured
combinations exist (v1.3.0 Opus `high`, v1.4.0 Opus `high`, v1.4.0 Sonnet `high`); the inputs
allow dozens.

The tier is the combination the owner decided, with its measured numbers next to it. A consumer
reads one table, not a price list. What stays in dollars is the cap, because dollars are what the
consumer is accountable for (ADR 0001 decision 6). The tier shapes the spend; the budget bounds it.

| Tier | Reader | Judge | Measured | Placeholder until |
| --- | --- | --- | --- | --- |
| `economy` | Sonnet 5.5 `medium` | none | no (Sonnet `high`: 5.3 bugs, $4.58) | E1b |
| `standard` | Sonnet 5.5 `high` | Opus 5.5 `high` | reader yes, judge no | E2, E4 |
| `deep` | Opus 5.5 `high` | Opus 5.5 `high` | reader yes (7.3 bugs, $6.96), judge no | E0 may move the reader to `medium`; E4 |

**Prior art: Greptile's review levels** (checked 2026-11-03,
[pricing](https://www.greptile.com/pricing)). Greptile sells three levels per review: Base costs
1 credit, Plus 3 and Apex 10, with a credit at US$1 on its Pro plan. The pricing page does not
say what changes between levels (model, number of agents, depth), and its public demo repositories
for the Plus and Apex evaluation (`greptileai/demo-itk` and others) do not label which level wrote
each review. What it confirms is the shape of this decision: the buyer chooses depth, never a
model. What does not transfer is the credit: Greptile meters a shared pool across an organisation,
while Wachiman has one operator who already caps spend in dollars (`budget_usd`), so a credit would
be a second unit for the same cap.

The model names are the engine's. When Anthropic ships a new model, the engine's table changes and
the tier keeps its meaning, as the hub's `ai-model-usage` page says: reassign the role, do not add
a knob.

### B. What the judge is obliged to check

#80's judge sees contracts, cited code and an action ledger, and may reopen any closed contract.
E1 showed what it must not do: trust the reader's closure. This part names the closures that must
be reopened by rule, because they are the ones a careful person never takes on trust.

**The obligation classes are #88's questions.** #88 ships five, each a module in `src/questions/`
with a regex `applies` over the added lines, selected per batch by the engine and rendered as a
prompt section "Risks this part's added lines show". The ones that map onto the misses above:

| #88 question | What it fires on | Known case it was written from |
| --- | --- | --- |
| `destructive-step` | `unlink`, `rm`, `rmdir`, `trash`, SQL `DELETE`, helper names such as `removeCompanions`, a clear inside a loop | #479 `healEntry`: `sourceMatches` computed, never read; `done()` after a failed `unlink`; `rm(.kaipu/drag)` on every item |
| `stale-write-back` | A write that uses values read earlier | #478 `pendingIdentity`: the cached name overwrote a rename made on another Mac |
| `overlapping-calls` | Two calls in flight at once on one cache, map or file | #482 interleaving; the held-out #276 (a ticket read, checked, then released) is the same shape |
| `read-error-as-empty` | An unreadable file treated as empty, then written back | #482 |
| `bounded-wait` | A wait whose calls are bounded and whose total is not | #483 |

Removed handlers (#467's Library drop) are not a question: they are #80 decision 11's action
ledger, which lists removals with their before and after hunks.

The table stays small on purpose. A question enters when a measured miss has that shape (ADR
0016's own rule). A question with no miss behind it is noise.

**How an obligation flows.**

1. The engine runs `selectQuestions` as #88 does, and in addition writes each firing to the run
   dir beside `evidence.json`: file, line, question id, and the enclosing function's text. This is
   the ledger.
2. Every batch receives #88's prompt section as today. The batch must return a contract per ledger
   entry in its files: `closed` with the citation that answers the question, or `open`.
3. The engine marks an entry with no contract as `open`.
4. The judge receives all entries with their contracts and the cited code. For each one it
   confirms the closure by reading the citation, reopens it with a finding or a question, or marks
   it "not a defect because <citation>".
5. The review's "What the change connects to" block lists each obligation with its outcome, so
   the owner can see which ones the judge read.

**Why this is not the pass over summaries ADR 0009 rejected.** The judge does not receive "the
healing path is safe, see lines 640–677". It receives the `unlink` at line 675, the question, the
reader's closure, and the text of `healEntry`. The engine put the question there, so a closure that
does not answer it is visible as such. The judge's job is to read, not to agree.

**Verification before posting (PR 16 idea 1).** Anthropic's pipeline has hunters and a separate
voting group; style and diagnostic findings are dropped; survivors are posted by severity. Wachiman
cannot afford voters. It can afford one reader of cited code per serious finding, and it already
has the precision to skip verification of `consider`. The rule "degrade, never delete" is what keeps
the verifier from becoming a filter that hides a true positive.

### C. Memory

**What the census found.** On 2026-11-02 a read-only subagent counted the operator's replies on
Wachiman threads across the owner's repositories. In kaipu-record: 265 review comments by the
operator, 94 of the form "Fixed in <sha>", **0 of the form `Verdict:`**. No other repository has a
`Verdict:` reply either. ADR 0007 is designed around a signal nobody emits.

**What exists instead.** Two sources that need no change of habit:

- **Contracts.** Since v1.4.0 every batch returns `contracts[]`, each citation checked by the
  engine against the head. A closed contract is a fact about the repository, with its evidence.
  Pullfrog's "Learnings" panel holds the same kind of fact (what a path does, which call pairs
  with which), written by the model in prose and stored on Pullfrog's servers. Wachiman's version
  lives in the consumer's repository, as ADR 0007 requires, and carries the citation that lets the
  engine expire it.
- **"Fixed in <sha>".** The operator's agent writes it when it acts on a finding. That is a
  judgement: the finding was right enough to fix. `src/precision.ts` can count it today.

**The amendment to ADR 0007.** Decision 2 reads "the model groups verdicts by area and proposes
lessons". The amendment adds a second source: closed, engine-checked contracts seen in two reviews
with the same citation become facts. Facts are not lessons. They carry no reason and no example;
they are a path, a citation and a sentence. They sit in layer 4 of ADR 0006 and the prompt labels
them "what earlier reviews established, re-checked at this base".

**The gate.** kaipu-record has pinned v1.4.0 since 04:01 UTC on 2026-11-02, and eight runs have
produced contracts. Before any of this is built, someone reads those contracts and counts how many
state a fact a later review would reuse. If the count is low, C1 is not built and this section
records why.

### What the live run on #478 and #479 adds to the benchmarks

The findings of both PRs, with each reviewer's label, a verdict by reading and the fixing commit,
are audited in #87 ([`2026-11-02-field/prs/pr-478.md`](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02-field/prs/pr-478.md) and [`pr-479.md`](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02-field/prs/pr-479.md)). Three
observations from the same run feed this spec and are not in #87:

- **Per-call floor.** On #478 a 23-line CSS delta cost $0.17 (7 turns) and a 30-line delta $0.14,
  against $0.23–0.27 for full batches of 550–970 lines. The fixed part of a call is more than half
  the cost of a full batch. Open question 6 follows from this.
- **Re-answering confirmed threads.** At `649c902` Wachiman answered the two `registry.ts`
  threads a second time with "Looks addressed", having confirmed both at `886d67f` with no reply
  since. Decision B6.
- **Where Pullfrog's tokens go.** 2.19M of 2.38M tokens on #478's first review and 3.50M of 3.70M
  on #479 were cache reads. Decision A4's caveat on Sonnet's saving follows from this.

### Ideas from Anthropic's code review post, mapped

[The research page](../research/2026-10-26-ideas-from-anthropic-code-review.md) was written
against agent-review 1.0.0 and moved here from the private repository. Its status is at the top of
the page. The ideas this spec adopts: 1 (verify before posting) as B3; 3 (never repeat a posted
finding) as B6; 6 (depth levels as one knob) as A2. Idea 2 (an eval set) is already the practice,
B8 makes it a rule. Idea 8 (root cause and bug class for fix PRs) stays open as a prompt change.
