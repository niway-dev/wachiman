# Ideas from Anthropic's code review post for agent-review (2026-10-26)

> **Status on 2026-11-02.** Moved unchanged from niway-dev/wachiman-private PR 16 (branch
> `research/anthropic-code-review-ideas`). It was written against agent-review 1.0.0 (`main` at
> `3324e48`), before the rename to Wachiman and before ADRs 0003–0013, so **the ADR numbers in the
> body are the numbering of that day** and do not match `docs/adr/` now. What happened to each
> idea since:
>
> | # | Idea | Status | Where |
> | --- | --- | --- | --- |
> | 1 | Verify every "should fix" before posting | adopted, with "degrade, never delete" | ADR 0018, spec [B3](../specs/2026-11-02-review-depth-model-tiers-and-memory-design.md) |
> | 2 | Incidents and misses become an eval set | done in substance: `docs/benchmark/`, the bug catalogue, the held-out set | spec B8 makes it a rule |
> | 3 | Tag pre-existing findings; never repeat a posted one | adopted | spec B6 |
> | 4 | Measure noise by what the author did | partly: `src/precision.ts` reads verdicts; "Fixed in <sha>" is proposed as a verdict | spec C2 |
> | 5 | A template for the focus file, partly enforced | partly: the policy folder (ADR 0006), the evidence rule and `confidence` (#70) | — |
> | 6 | Depth levels, one knob | adopted as the spend tier | ADR 0017 |
> | 7 | Cap review rounds | partly: two replies per thread (ADR 0008), a per-PR ceiling (ADR 0012) | — |
> | 8 | Root cause and bug class for fix PRs | open, a prompt change | — |
> | 9 | Recurring findings move to the source | not started; needs idea 4 | — |
> | 10 | Scheduled review of existing code | not planned | — |
>
> The source caveat below still holds: the post was read through an automated summary. Re-read
> it before quoting a number.

**What this is.** A reading of Anthropic's post
[How Anthropic's Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/)
against how `niway-dev/agent-review` works today (`main` at `3324e48`, release 1.0.0), turned into
candidate ideas. Nothing here is decided. Each idea that survives review goes through `cs-design`
and gets an ADR only if a later reader would ask "why this and not that".

**Labels.** **[F]** stated in the post. **[OBS]** observed in our repositories or records.
**[H]** inferred, not verified.

**Source caveat.** The post was read through an automated page summary, not line by line. The post
itself does not give the number of verifier agents, the vote threshold, model choices or dollar
costs. Re-read the post before quoting a number from this page elsewhere.

## One-minute summary

| # | Idea | Why it matters for us | Fits | Priority |
| --- | --- | --- | --- | --- |
| 1 | Verify every "should fix" before posting | Nothing checks a finding today; a wrong "should fix" costs a round | new stage after `mergeOutputs` | First |
| 2 | Incidents and misses become an eval set | No measure of whether the reviewer finds bugs; prompt and model changes are judged by feel | new `eval` command, records in `docs/findings/` | First |
| 3 | Tag pre-existing findings and never repeat a posted one | Old code dominated their reviewer's output; repeats cost agent rounds | `buildReview`, `openThreads` | First |
| 4 | Measure noise by what the author did with each comment | First real quality number we would have | script over resolved threads and later commits | Second |
| 5 | A template for the focus file, partly enforced by code | Their best `REVIEW.md` files share four patterns | `.github/agent-review.md`, `SCHEMA` | Second |
| 6 | Depth levels: quick, standard, deep | One knob instead of several budget variables | ADR 0005 config | Second |
| 7 | Cap review rounds | An agent author and reviewer can loop | marker history | When agents fix findings |
| 8 | Root cause and bug class for fix PRs | A fix that patches one instance leaves the class | prompt | Cheap, any time |
| 9 | Recurring findings move to the source | A repeated comment is a missing rule | summary line | Later |
| 10 | Scheduled review of existing code | Finds old bugs outside any PR | separate workflow | Later |

**Recommended start:** ideas 1 and 2 together, because the eval set is how we would know whether
verification helps or only costs.

**Not adopted for now:** a merge-blocking security pass and a classifier that sets how many humans
approve. Both contradict ADR 0003 (reviews are advisory inline comments), and with one owner per
repository they buy little. Reopen if a repository gets a second regular reviewer.

**Open questions**

1. Does a verifier call pay for itself at our budget ($1 per pull request)? Needs idea 2 first.
2. What goes in the eval set beyond yui #230 and gymtrack #63? Every finding doc with a verified
   miss is a candidate.
3. Where do noise outcomes live: a file in the repository, a gist, or only in the review body?

## What the post describes

- **[F] Goal and guardrails.** Minimise human review time without raising reverts or incidents.
  Reverts fell by more than 40% while merged pull requests more than doubled.
- **[F] Layered checks.** Pre-PR verification by the authoring agent, an AI review on every PR
  against the whole repository and the PR's stated intent, a separate security pass, required CI,
  risk-tiered human approval (low: none, medium: one, high: two; some paths always need a person),
  a merge queue, flags and staged release.
- **[F] Finding generation.** Several agents hunt in parallel. A separate group votes on each
  finding, and only findings with enough agreement are posted. Style, diagnostic and cleanup-only
  findings are dropped; those filters were A/B tested on their own PRs. Survivors are posted inline,
  sorted by severity and tagged Important, Nit or Pre-existing.
- **[F] Context.** `CLAUDE.md` for the project, `REVIEW.md` written by code owners for what matters
  in their area.
- **[F] Depth.** Quick, Standard or Deep per repository.
- **[F] Feedback loops.** Past PRs that caused incidents or reverts form a test set the reviewer runs
  against daily; a change to prompt, tools or model is kept only if the score improves. Each comment
  is classified by the author's response. The reviewer is also run on known-clean PRs to count
  harmful false alarms.
- **[F] Convergence.** One PR went through more than fifty rounds overnight between an agent author
  and the reviewer. About 59% of what the reviewer kept flagging was code present since its first
  pass. Fixes: a cap of three rounds, diff-only re-review after the first passes, flag the class of
  bug, never repeat a posted finding, nightly review of existing code.
- **[F] Results.** PRs passing after one review-and-fix round went from 65% to 78%; PRs needing five
  or more rounds from 8.9% to 1.5%; mean reviews to pass from 2.08 to 1.32.

## What agent-review already does

- **[OBS] Risk ordering.** `riskScore` and `planBatches` read the riskiest modules first, so a budget
  cut-off lands on the least important files (ADR 0004). This is the closest thing we have to their
  risk tiers, applied to reading order instead of approval.
- **[OBS] Diff-only re-review.** The `<!-- agent-review sha=... -->` marker narrows the next run to
  what changed since the last complete review.
- **[OBS] Severity filter.** `RULES` allow "should fix" only for a correctness bug or a security
  problem; everything else is a note.
- **[OBS] Code decides what code can decide.** Coverage check, retry of gaps, budget arithmetic and
  posting are the script's, not the model's.

## The ideas in detail

### 1. Verify every "should fix" before posting

**Today [OBS].** `mergeOutputs` deduplicates and `buildReview` posts whatever the batches returned.
No second opinion exists.

**Proposal.** After merging, run one verifier call per "should fix" (or one call for all of them)
with a fresh context: the finding, the file at the head, and the instruction to confirm or refute
with a file and line as evidence. Unconfirmed findings are downgraded to a note, not dropped, so a
real bug that the verifier missed is still visible.

**Why not their voting.** **[H]** Several voters per finding multiplies cost; at $1 per pull request
one verifier per serious finding is the affordable version. Notes are not verified because they do
not ask the author to act.

**Against it.** It adds cost and latency on exactly the pull requests with findings. If the batch
reviewer is already precise, the verifier only spends. Idea 2 is what would tell us.

### 2. Incidents and misses become an eval set

**Today [OBS].** `test/fixtures/hostile/` tests isolation, not review quality. The findings docs
record verified misses: two functional bugs in yui #230 that the kit never read
(`docs/findings/2026-10-21-two-reviews-in-yui-partial-and-gated.md`), and the partial review of
gymtrack #63 (`docs/findings/2026-10-25-gymtrack-63-partial-review.md`).

**Proposal.** A small set of cases, each a pull request at a fixed commit plus the bugs a person
confirmed in it, and a few known-clean pull requests. An `eval` command runs the engine against the
set and scores bugs found and false "should fix" on clean cases. A change to the prompt, model,
batching or verifier is kept only if the score does not drop.

**Against it.** Every run costs real money, and a set of five cases is noisy. Run it on demand for
engine changes, not daily.

### 3. Tag pre-existing findings and never repeat a posted one

**Proposal.** The script marks a finding as pre-existing when its line is not an added line in the
patch (`commentableLines` already knows which lines are added). The model can override with a
reason when the PR made an old line wrong. Before posting, drop any finding whose path, line and
category match an open or resolved thread of ours.

**Why.** **[F]** 59% of their reviewer's repeated output was old code. **[H]** With agents fixing
findings, a repeated or misattributed finding becomes another commit and another round.

### 4. Measure noise by what the author did

**Proposal.** For each posted comment, classify the outcome: fixed (a later commit changed the line
and the thread was resolved), wrong or intentional (resolved with a reply, no change), or ignored.
Report the counts per repository. The script can infer the first and last; the middle needs the
author's reply.

**Against it.** Inference is rough: a line can change for unrelated reasons.

### 5. A template for the focus file, partly enforced by code

**Proposal.** Ship a template for `.github/agent-review.md` with the four patterns the post names:
what failure looks like in this repository ("it lies" for docs, "it misroutes" for config), a cap on
notes, paths to skip, and a required file and line as evidence. Enforce two of them in code: an
`evidence` field required in `SCHEMA` for "should fix", and a notes cap applied by the script. The
review body already starts with coverage; also start the summary with a findings count and say
plainly when there is nothing to fix.

### 6. Depth levels

**Proposal.** One setting, `depth: quick | standard | deep`, that sets total budget, per-batch
budget, model and whether idea 1 runs. It fits the two-layer configuration of ADR 0005.

### 7. Cap review rounds

**Proposal.** Count our markers on the pull request. After three complete reviews with new "should
fix" findings each time, the next review body asks the author to reconsider the approach instead of
posting more findings. Matters once agents act on our findings; today a person reads them.

### 8. Root cause and bug class for fix PRs

**Proposal.** When the title or body says it fixes something, the prompt asks whether the change
addresses the root cause, and to flag other instances of the same class in the diff. Prompt only.

### 9. Recurring findings move to the source

**Proposal.** When the same category appears across several reviews in a repository, the summary
suggests a rule for `CLAUDE.md`, the focus file or a lint rule. Needs idea 4's history.

### 10. Scheduled review of existing code

**Proposal.** A scheduled workflow that reviews a rotating slice of the repository and opens issues,
not comments. Separate from the pull request path. Lowest priority.

## Next step

Review this page on the draft pull request, keep or drop each idea, then design ideas 1 and 2 with
`cs-design` and add the chosen ones to `docs/plans/review-kit-v2.md`.
