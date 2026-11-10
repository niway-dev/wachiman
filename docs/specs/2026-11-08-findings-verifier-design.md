# A verifier call that refutes findings before they are posted

> **Default configuration update 2026-11-10:** Opus 5.5 at effort `high` is the default reviewer again. Verification is opt-in (`verify: true`, `AGENT_REVIEW_VERIFY=1`, or `local --verify`). This supersedes the default changes of 2026-11-09; the experiment and its evidence are preserved. On the 50-PR Martian run, Haiku plus the Opus verifier cost $28.62 versus $25.01 for Opus alone, with 302 versus 174 false positives. The experiment did not justify its default configuration.

- **Status:** accepted 2026-11-09 by the owner ("ya leí el plan y me gusta"); open questions
  answered with their defaults. **Implemented, opt-in,** by the pull request that adds this line
  (`feat/findings-verifier`): `src/verify.ts` and `verifyFindings` in `src/engine.ts`, the `verify`,
  `verify_budget_usd` and `verifier_model` inputs, `local --verify`. Two deviations from the text
  below, made while building it: the reserve is **at most half** of `budget_usd` (decision 6),
  so a small budget still runs a batch, since a review without findings has nothing to verify;
  and the verifier call gets **no retry at all**, not even the rate-limit backoff (open question
  4): a rate-limited verifier fails open. The last acceptance criterion (arm 2 on the Martian
  bench) has not run. Written on Claude Fable 5.1 from the owner's
  decision of 2026-11-08: "we keep a verifier, even if it raises the price a little; not seeing
  false positives makes the review manageable", and "I want it inside the process, because it will
  run in a GitHub Action".
  **Amendment 2026-11-09:** The owner turned the verifier on by default and made Haiku 5.5 high the default reviewer before the Martian arm 2 gate ran; the gate is now a check on this default, not a condition for it. Off with `verify: false`, `AGENT_REVIEW_VERIFY=0` or `local --no-verify`.
- **Issue:** [#137](https://github.com/niway-dev/wachiman/issues/137).
- **Creates:** [ADR 0027](../adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md)
  (one verifier call per pull request; a finding is dropped only with a disproof the engine can
  check). Numbered 0027 because 0024 to 0026 are held by #135, 0014 and 0015 by #80, 0017 and 0018
  by #90.
- **Takes from #90:** decision B3 of its draft spec and ADR 0018 ("the judge re-reads every
  `fix`/`blocker`; degrade, never delete"). This spec is the buildable slice of that idea without
  the spend tier, the obligation ledger or the reader/judge split. It changes one rule, see
  decision 4. When #90 is rebased, its B3 should point here.
- **Reuses:** ADR 0001 (budgets are the consumer's cap, no hosted service), ADR 0003 (severity
  and topic; a question carries the severity of its worst plausible answer), ADR 0009 (the model
  judges, code decides; and its argument against a pass over summaries, restated below), ADR 0019
  (the local mode and the public result format; additive changes only), ADR 0012 (the automatic
  ceiling counts every call).
- **Evidence:** [Martian bench, 2026-11-07](https://github.com/niway-dev/wachiman-benchmarks/blob/feat/martian-cal-pilot/martian/history.md);
  the nightly [field run on kaipu-record](https://github.com/niway-dev/wachiman-benchmarks/tree/field/2026-11-kaipu/2026-11-field-kaipu)
  (`harness/verify.py`, the prototype this design is built from); the
  [research list](#sources-and-unverified-claims) at the end.

## Summary (one minute)

Wachiman already finds more of the benchmark's bugs than the tools it is compared with, and posts
1.5 to 3 wrong findings for every right one. Code cannot tell a true premise from a false one;
that takes reading. So one more model call runs after the batches: it receives every finding the
batches produced, with the code each one cites, and tries to **refute** it. A finding it refutes
with a disproof the engine can check (a path and line that exist at the head commit) is not
posted. A finding it cannot refute is posted. A finding it cannot confirm either is posted at
`low` confidence, which the existing confidence rule turns into a question when the severity is
`fix` or above. The call is one per pull request, not one per batch, runs inside the engine so the
GitHub Action and `wachiman local` get it alike, is off by default until the Martian arm 2 run
says it pays, and never blocks a review: if it fails, the unverified review is posted and says so.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | **One verifier call per pull request**, after `mergeOutputs`, the confidence rule and `dedupeFindings`, before `buildReview`. Not one per batch | A per-batch verifier cannot see a duplicate across batches and pays one call per batch. One call sees every finding and the cost is one more call per review, capped by what the batches left. The field prototype runs this way and its cost stayed between $0.21 and $0.80 on PRs from 41 to 10,787 changed lines | 0027 (new) |
| 2 | **What it receives:** every `blocker`, `fix` and `consider` finding with the 15 lines of head code around its cited line, and the diff hunks of the files those findings cite, capped. Never the whole diff, never a batch summary. Read-only tools (Read, Glob, Grep) under the same `claude -p` restrictions as a batch | A finding is a claim about specific lines; the verifier needs those lines and the change that touched them. The whole diff would make the call cost what a batch costs. This is not the "pass over summaries" ADR 0009 rejected: the verifier reads findings and code, never a conclusion that something is correct | 0027 |
| 3 | **Three verdicts, each with a reason:** `refuted` (with `disproof: {path, line}`), `confirmed` (with an optional severity one step up or down), `unconfirmed`. The verifier never adds a finding | A bare keep/drop hides why. The Martian plan's rule: the falsifier must show the claim, the paths it checked with lines, and the counterexample | 0027 |
| 4 | **Dropped only with a checked disproof.** `refuted` drops the finding only if the disproof's path and line exist at the head commit; otherwise it is treated as `unconfirmed`. `unconfirmed` keeps the finding and sets `confidence: low`, so `enforceConfidenceRule` posts a `fix`/`blocker` as a question. `confirmed` keeps it, with the verifier's severity if it moved one step | #90's "degrade, never delete" protects real bugs the verifier misses, but the owner's goal is not to see false positives. The compromise: deletion needs evidence code can check; doubt degrades. Reuses the confidence rule instead of a new label | 0027 |
| 5 | **Refuted findings are recorded, not posted:** in the result JSON under a new additive `verification` block (every verdict, reason and disproof), in the footer as counts and cost ("verified by Opus 5.5: 3 dropped, 1 unconfirmed, $0.24"), and in the log | Precision is measured from what was dropped as much as from what was posted; the Martian judge needs the dropped ones to count lost goldens. The author sees a count, not the noise | 0027 |
| 6 | **Budget:** a reserve `verify_budget_usd` (default $1.00, at most half of `budget_usd`) is taken from `budget_usd` before the batches start, so the verifier always has money when the batches end. The reserve is a floor, not the call's cap: the call may spend everything the batches left, which is the reserve plus what they did not use. No findings to verify, no call, no cost. It counts against `auto_budget_usd` like every automatic call (ADR 0012) | The field prototype's cap was $1.50 and no call reached it (max $0.80). Taking it up front avoids the case where the batches spend everything and the verifier, the part the owner asked for, never runs | reuses 0001, 0012 |
| 7 | **Model and effort:** `verifier_model`, default Opus 5.5; effort always `high`. Independent of the reviewer's model so arm 3 (Haiku proposer) can run | The role that decides is never cheapened (#90, A3). Cross-model research found a lightweight reviewer of another model scores no higher than the same model reviewing itself; the field run shows Sonnet keeping half of what Opus keeps, and nobody has judged which is right. Opus is the safe default; Sonnet is measured, not assumed | 0027 |
| 8 | **Fail open.** A failed, timed-out or budget-stopped verifier call posts the unverified review with a footer line saying so. It never blocks or delays the review beyond its own cap | The review is advisory; a verifier that can fail closed would turn a cost cap into a missing review | 0027 |
| 9 | **Off by default** behind `verify` (Action input) / `--verify` / `AGENT_REVIEW_VERIFY=1` until arm 2 passes the gate in [Measurement](#measurement). *Superseded 2026-11-09 by the amendment in the status: on by default, off with `verify: false` / `--no-verify` / `AGENT_REVIEW_VERIFY=0`* | The measurement must run the product, not a script (the owner rejected a benchmark-only prototype). A flag lets the bench run arms 2 and 3 on the real code path before any consumer pays for it | — |
| 10 | **Runs on every review that produced candidates:** first reviews, push re-reviews, `/wachiman review`, `local`. Not on thread-reply runs | Re-reviews are half the live bill and post findings too. Thread replies post no findings | — |

## Open questions

1. **Does `blocker` go through the verifier?** The Martian plan says `fix` and `consider`. crysk
   runs its refuter only on blocker/critical and lost zero real bugs to it; nothing says a
   `blocker` is less often wrong than a `fix`. Default: **yes, every severity above `info`**, and
   the result JSON records the verdict per severity so arm 2 can tell whether `blocker`
   verification paid.
2. **Pilot size.** 50 PRs is one full arm (about $25 on Opus plus about $7 for the verifier at the
   field run's ratio). Default: **the 20 Cal.com and Sentry PRs first** (the tuning half the plan
   already holds out), then the full 50 if the gate looks reachable.
3. **Should `unconfirmed` degrade `consider` too?** `consider` already means "may decline" and
   the confidence rule leaves it alone. Default: **no change below `fix`**.
4. **The verifier's own retry.** Default: **none** beyond the rate-limit backoff every call has.
   As built: no retry at all, not even that backoff (see the status line); and after the provider
   refused a batch (billing, auth, rate limit) the verifier is not called.

## Out of scope

- The spend tier, the obligation ledger and the reader/judge split of #80 and #90.
- Several voters per finding, or a verifier that adds findings.
- Verifying thread replies or contracts.
- Any change to the batch prompt, the questions or the evidence. One variable per arm.
- A hosted service or a Wachiman-held key (ADR 0001).

## Failures this must protect against

- The verifier drops a real bug on a bare "refuted" with no disproof, or with a disproof pointing
  at a line that does not exist. Decision 4: such a verdict is `unconfirmed`, the finding stays.
- The batches spend the whole budget and the verifier never runs. Decision 6: the reserve is taken
  first.
- The verifier call fails and the review is lost or delayed. Decision 8: fail open, with a footer
  line.
- The verifier ratifies a finding because the reader's sentence sounds right. Decision 2: it gets
  the code, not a summary, and must cite what it checked.
- A dropped finding disappears from every record and precision cannot be measured. Decision 5.
- A verifier on a cheap model drops what Opus would have kept. Decision 7: Opus by default, Sonnet
  only after it is measured.
- Two verdicts for one finding, or a verdict for a finding that does not exist: the engine matches
  verdicts by finding id, ignores unknown ids, and treats a finding with no verdict as
  `unconfirmed`.

## Acceptance criteria

- [x] `bun test` has a fake-provider test where three findings go in and the verifier returns
  `refuted` with a valid disproof, `refuted` with a disproof whose line does not exist, and
  `confirmed` with a severity one step down: the review posts two findings, the original second
  at `confidence: low` as a question (it was `fix`), and the original third at the verifier's
  severity.
- [x] A test where the verifier call fails: the review posts every finding and its footer says the
  verification did not run.
- [x] A test where the batches leave less than `MIN_BATCH_USD` after the reserve: the batches are
  cut, the verifier still runs.
- [x] A test where no finding is above `info`: no verifier call is made and the cost is unchanged.
- [x] `wachiman local --format json --verify` on a repository with findings writes a
  `verification` block that lists every verdict, reason and disproof, and the JSON validates
  against `review-result.v1.schema.json` (additive field).
- [x] The review footer shows the verifier's model and cost, and the dropped count.
- [ ] Arm 2 on the Martian bench (`history.md` row): false positives down by at least 30% against
  the 2026-11-07 Opus row, High+Critical found within 3 of it, cost per PR reported. Then the
  flag defaults on.

## Detail

### Where it sits

Today's run ([architecture, "The flow"](../architecture.md#the-flow)): batches run riskiest first,
each is one `claude -p` with a JSON schema; outputs are merged, the confidence rule runs, the ADR
notices are added and findings are deduplicated; then `buildReview` renders and the sink posts.

The verifier is one more step between dedupe and `buildReview`:

```
mergeOutputs → enforceConfidenceRule → dedupeFindings
  → selectCandidates (severity > info, not an engine notice)
  → buildVerifyPrompt (candidates + head code around each line + hunks of cited files)
  → runProvider (one call, VERIFY_SCHEMA, capped at the budget left, same restrictions)
  → applyVerdicts (check disproofs exist; drop / degrade / keep)
  → enforceConfidenceRule again (for the ones now at low)
  → buildReview
```

Everything before `selectCandidates` is unchanged. `applyVerdicts` is pure and tested on its own.

### What the verifier gets

Per candidate: an id (`c1`, `c2`, …), severity, topic, confidence, `path:line`, title, body, and
the head file's lines `line − 15 … line + 15` with numbers (the prototype's `snippet`). Then, once
per cited file, the diff hunks of that file against the base, capped at 60,000 characters; when it
truncates, the prompt tells the verifier to read those files instead (nothing is logged). Then the instruction: for each candidate, try to show it is wrong for the code
at this commit, or not caused or made reachable by this change; cite the lines you checked; if you
cannot refute it and cannot confirm it from the code, say `unconfirmed`. Never invent a finding.

Output schema (JSON, enforced by `--json-schema`):

```json
{ "verdicts": [ { "id": "c1", "verdict": "refuted" | "confirmed" | "unconfirmed",
                  "reason": "…", "checked": [ { "path": "…", "line": 0 } ],
                  "disproof": { "path": "…", "line": 0 },
                  "severity": "blocker" | "fix" | "consider" | "info" } ] }
```

`disproof` is required when `verdict` is `refuted`; `severity` is read only on `confirmed` and
only when it is one step from the finding's own.

### What happens to each finding

| Verdict | Disproof exists at head | Result |
| --- | --- | --- |
| `refuted` | yes | not posted; recorded in `verification` and counted in the footer |
| `refuted` | no, or missing | as `unconfirmed` |
| `unconfirmed` or no verdict | — | posted; `confidence` becomes `low`; `fix`/`blocker` become a question through the existing rule |
| `confirmed` | — | posted; severity moves one step if the verifier said so, else unchanged |

"Exists at head" is the same check `checkOutput` already makes on a finding's own citation: the
file is in the head tree and the line is within its length. It proves the verifier looked at
something real, not that the disproof is right. That is the honest limit of what code can check.

### Cost, from the field run

The nightly run on kaipu-record (20 PRs since 2026-11-06, 13 with candidates) is the only
measurement of this shape so far. The proposer there is Haiku, so the ratio to an Opus proposer
will differ; the absolute verifier cost should not, since the verifier's input is the findings.

| | Total | Per PR with candidates | Share of the proposer's cost |
| --- | --- | --- | --- |
| Haiku proposer | $9.82 | $0.76 | 100% |
| Opus 5.5 verifier, one call | $4.78 | $0.37 (min $0.21, max $0.80) | 49% |
| Sonnet 5.5 verifier, one call | $2.36 | $0.18 | 24% |

Against the Martian Opus row ($0.48 median per PR), an Opus verifier at the field run's cost would
add roughly 45 to 80% on a typical PR and much less on a large one, because its cost grows with the
findings, not the diff. That is less than "at least double" and more than the 20 to 40% guessed
before this data was read. Arm 2 is what measures it.

What the verifier kept, before anyone judged it: Opus 55 of 157 candidates (35%), Sonnet 25
(16%). On #553 both kept 0 of 5. Whether the dropped ones were wrong is the month-end judgement;
nothing here assumes it.

### Why one call per pull request and not one per batch

A per-batch verifier would run inside the loop with each batch's findings. It would see one batch
at a time, so a finding repeated by two batches on the same line would be verified twice and
deduplicated later. It would also pay one call per batch, which on a 10-batch PR is ten verifier
caps. ADR 0014 (#80) chose one judge per pull request for the same reason; this spec keeps that
part and drops the rest.

The cost of one call is that it cannot start until the last batch ends. On the GitHub runner that
is one more call's wall clock, inside the job's existing limit.

### Why the verifier is a second model call and not more code

Everything deterministic the pipeline could do about a wrong finding, it does: the cited line must
exist, paths are relativised, duplicates collapse, low confidence becomes a question, engine
notices are worded by code. What remains wrong is wrong in its premise ("this value can be null
here", when it cannot). Deciding that takes reading the code and reasoning about it, which is the
one thing the architecture reserves for the model. Deterministic evidence can still improve
(decision 14 of the flow-questions spec, tree-sitter, is unbuilt), but it improves what the model
sees, not what it concludes.

### Measurement

Arm 2 of the Martian plan runs the product with `--verify` on Opus 5.5 high, the verifier on Opus
5.5 high. The row in `history.md` reports, next to the baseline: recall, precision, F1, F2, false
positives, High+Critical found, `$/PR median` with the verifier's share, and the number of goldens
that were in a refuted finding (from the `verification` block). Gate for default-on: false
positives down at least 30%, High+Critical within 3 of the baseline, one run; a second run before
the default changes. Arm 3 then swaps the proposer for Haiku with the same verifier.

Tuning, if any, happens on Cal.com and Sentry and is judged on Grafana, Keycloak and Discourse,
as the plan fixes.

### Configuration surface

| Where | Name | Default |
| --- | --- | --- |
| Action input / env | `verify` / `AGENT_REVIEW_VERIFY` | `true` (`0` or `false` turns it off; off for codex without a verifier model) |
| Action input / env | `verify_budget_usd` / `AGENT_REVIEW_VERIFY_BUDGET_USD` | `1.00` |
| Action input / env | `verifier_model` / `AGENT_REVIEW_VERIFIER_MODEL` | `claude-opus-5-5` |
| CLI | `--verify` / `--no-verify` | on |

The footer names the verifier's model (its label) with its counts and cost next to the reviewer's;
the effort is in the result's `verification` block, not in the footer.

## Sources and unverified claims

- Martian bench rows and reference tools, same judge: [history.md](https://github.com/niway-dev/wachiman-benchmarks/blob/feat/martian-cal-pilot/martian/history.md);
  arms and decision rules: [PLAN.md](https://github.com/niway-dev/wachiman-benchmarks/blob/feat/martian-cal-pilot/martian/PLAN.md).
  One run each; run-to-run variance on this bench is 1 to 3 High/Critical goldens.
- Field run numbers: [README](https://github.com/niway-dev/wachiman-benchmarks/blob/field/2026-11-kaipu/2026-11-field-kaipu/README.md)
  as of 2026-11-08, 20 PRs, kept counts not yet judged. Dollar figures are Claude Code's
  API-equivalent estimate on a subscription.
- crysk's refuter: per BLOCKER/CRITICAL finding, zero real bugs lost to it, and a refuter on all
  severities lowered F1 ([repository](https://github.com/cryskai/crysk), its
  `docs/research/local-logic-misses.md`; own run, unreplicated).
- Same-model vs cross-model review: [When Does a Second Model Help? (arXiv 2610.01471)](https://arxiv.org/abs/2610.01471),
  900 review sessions, 150 planted errors; a top-tier cross-model reviewer was not significantly
  different in F1 from same-model review, a lightweight one scored no higher; two reviewers find
  partly different errors (Jaccard 41.2%). Not code-specific in the abstract.
- Developer rejection of agentic review comments, false positives the top reason: 56.3% of 31,073
  CodeRabbit comments ([arXiv 2607.07980](https://arxiv.org/pdf/2607.07980)). Unverified beyond the
  abstract.
- Anthropic's own review separates finding from verifying (hunters, then a group that votes):
  [research note](../research/2026-10-26-ideas-from-anthropic-code-review.md) on #90's branch, read
  through a summary; numbers not quoted here.
- CodeAnt's "three models, two must agree, 60% fewer false positives" is a vendor claim
  ([page](https://codeant.ai/blogs/ai-code-review-false-positives)); not used for any decision.
