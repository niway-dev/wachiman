# A calibrated finding priority instead of the Important/Nit word

- **Status:** proposed (2026-11-18). Tracker: [NIW2-873](https://linear.app/niway/issue/NIW2-873/wachiman-a-calibrated-finding-priority-must-should-could-fyi-instead); measurement: [NIW2-874](https://linear.app/niway/issue/NIW2-874/wachiman-measure-what-happens-to-each-finding-per-severity-confidence).
- **ADRs:** [the priority word is derived from a calibration table](../adr/0059-the-finding-priority-is-derived-from-a-calibration-table.md) (new; supersedes [ADR 0030](../adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md) decision 7 and amends the word in the inline severity cell of [ADR 0055](../adr/0055-the-review-comment-is-rendered-in-fixed-slots-from-a-view-model.md) decision 8).

## Summary (one minute)

Every finding opens with a word derived from severity alone: Important for Blocker and Fix, Nit
for Consider and Info. It was copied from Claude Code's review format, whose only stated reason is
keeping pre-existing bugs from looking like the author's fault. In our own reviews the word is
wrong where it matters: a high-confidence Consider is fixed 95% of the time (56 answers), a Fix 73% (11, a thin base), and
still reads as "Nit". This spec replaces the word with a **priority** (Must, Should, Could, FYI)
that the engine derives from severity, confidence and topic through a versioned calibration table,
shows each comment's measured rate beside it, and adds a command that recalibrates the table from
recorded outcomes. The model never picks the priority. The loop's stop rule and the review cost do
not change in this version.

The priority lives in the inline finding table, as its own row under the title, next to the rows
the table already has (Severity, Area, Confidence), plus a Track record row with the measured rate.
How it looks, before and after: [the labels mockup](https://claude.ai/artifact/5KzGQKtSXYGP5m9VBkr1oK).

The priority changes what a finding means to its reader, not whether it is read. Every finding is
still read and answered, whatever its word; the author decides on the merits whether it warrants a
change. A reader who sees only "Nit" concludes the review found nothing worth its cost, even when
most of those findings were fixed. The word must say how much a finding matters and how sure the
model is, as two separate things.

<!-- visual: priority-grid -->

```mermaid
flowchart LR
  M[Model output<br/>severity · topic · confidence] --> P[priorityOf<br/>calibration table vN]
  P --> W[Word: Must / Should / Could / FYI<br/>+ rank 0-100 + cell rate]
  W --> C[Comment and footer]
  C --> O[Outcome: fixed / declined / wrong / no answer]
  O --> K[wachiman calibrate]
  K -->|proposes| T[calibration table vN+1<br/>reviewed in a PR]
  T --> P
```

## What changes

| Thing | Today | After |
| --- | --- | --- |
| Headline word | `Nit` or `Important`, from severity only, inside the Severity cell (`🟡 Consider · Nit`) | Its own **Priority** row, first under the title: `Must`, `Should`, `Could` or `FYI`, from severity × confidence × topic group; the Severity cell keeps only the severity |
| Where the word comes from | `tierWord` in code | `priorityOf(finding, table)`; the table is versioned data shipped with the engine |
| Confidence in the comment | A meter, not used for ranking | Still the meter row; it now moves the priority |
| Track record | None | A **Track record** row: what happened to earlier findings of the same cell, with its counts and whether the priority is a seed or calibrated |
| Review summary | Counts by severity | One line of what was reviewed: counts per priority and how many at high confidence |
| Pre-existing | Folded into the word | Its own origin badge, beside any priority |
| Result `/2` | `tier: Important \| Nit \| Pre-existing` | Adds `priority`, `rank` and, during the trial, `arm`; `tier` stays, deprecated, until `/3` |
| Calibration | None | `wachiman calibrate` prints outcome rates per cell and proposes the next table |
| Stop rule | Severity | Severity, unchanged |

## Decisions

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | The headline word is a priority derived by the engine, never chosen by the model | The same reasoning as ADR 0031 for the risk-map level (a model-picked level is unreliable), applied here to findings; confidence already separates outcomes | 0059 (new) |
| 2 | Four words: Must, Should, Could, FYI | Two words cannot hold "almost always fixed but not blocking"; "Nit" already means "ignore" | 0059 |
| 3 | The priority comes from a versioned table keyed by severity × confidence, with topic group (defect: bug, security, perf; policy: rules, adr; quality: tests, docs, cleanup; question) as a third key only once a split cell is measured; the rank (0–100) is the lower end of the cell's judged interval, is stored but never displayed, takes the seed rank of a seeded cell (Must 90, Should 70, Could 40, FYI 10), orders nothing during the trial, and never gates anything | A table scales by data, not by code; ADR 0031 rejected a number because thresholds turn it into a gate, so the rank stays a stored key | 0059 |
| 4 | Table v1 is seeded from the severity × confidence rows of the sample below: Blocker high/medium → Must, Fix high/medium → Should, Consider high → Should, Consider medium and low → Could, any low-confidence Blocker or Fix → Could, Info → FYI. A finding with no confidence uses its severity's medium cell. Seeds are set, not computed: Consider · medium is fixed 71%, but a fix rate measures compliance, and the owner chose Could while nothing is judged, and chose Should for Consider · high on the same terms: 56 answers and a fix rate, not a judgement. A cell not measured under decision 12 keeps its seed and says so | Only what the sample shows; the topic split (defect Considers fixed 61%, below tests and docs) is not enough to seed by topic; "Could" is the default where nothing is known | 0059 |
| 5 | Each inline finding has a **Track record** row that says what its cell's number measures and on how much: in the form `fixed <p>% of <n> answered · <k> PRs · seed`, or `calibrated vN`. Layer 1 shows only `no record yet · seed` (decision 19). The observed rate is shown whenever its counts and provenance are known; whether the priority is a seed or calibrated is said separately | Highlights confidence and makes every review a data point, without calling a fix rate "should act"; once layer 2 counts outcomes, the repository's own rate can show evidence before any cell is calibrated | 0059 |
| 6 | The table is fitted to **warranted action**: a sample of findings judged by a person who does not see the displayed word. Fix, decline and no-answer rates are reported beside it, never fitted | A fix (above all an agent's) measures compliance; the label would otherwise learn its own effect | 0059 |
| 7 | A new table ships only in a reviewed PR and stays frozen for the release | Prevents the label from confirming itself (higher word → more fixes → higher word) | 0059 |
| 8 | `tier` stays in `/2` as deprecated, computed as today; `priority`, `rank` and, during the trial, `arm` are added | `/2` consumers keep working (ADR 0030 reopen condition: deliberate wire change) | 0059 |
| 9 | The loop's stop rule keeps reading severity | Measure first how many Should findings a loop leaves open before letting the word add rounds | — |
| 10 | Precedence: a low-confidence Blocker or Fix is a question (ADR 0027) and at most Could; Info is FYI; every other Blocker is Must; every other Fix on a defect topic (bug, security, perf) is at least Should. A rate can raise a priority above its floor, never lower it | A rare severe defect must never rank under a frequent cleanup | 0059 |
| 11 | Each cell records the model family and prompt version it was measured on; a review on another configuration shows `not measured for this configuration` and uses the seed | A cell's contents change when the model or prompt changes | 0059 |
| 12 | Eligibility and movement are separate. A cell is eligible for calibration with n ≥ 20 judgements from at least 5 PRs on a matching configuration. A cell moves up to the band of its 90% Wilson interval's lower end when that band is higher than its current word, and moves down only when the band of the upper end is lower than the current word | Twenty correlated outcomes near an edge would flip words between releases | 0059 |
| 13 | The trial is an A/B in the owner's repositories: each PR is assigned the old word or the priority at random, once, kept on every push, recorded as `arm` in the result, for at least two weeks; only the word differs between arms (the Priority row versus `· Nit`/`· Important` in the Severity cell); the Track record row and the order of findings are the same in both, and the summary line counts by each arm's word, and `priority` and `rank` are computed in both | The only way to tell the word's effect from the findings'; anything else that differs would be a second treatment | 0059 |
| 14 | Pre-existing is an origin badge beside the priority, never a priority | Keeps Claude Code's one stated reason (a bug the PR did not introduce is not the author's fault) without hiding its severity | 0059 |
| 15 | Priority and Track record are rows of the inline finding table (the fixed layout of ADR 0055, built in the inline-finding-table work); the Severity cell drops the tier word. The thread text given back to the model is rebuilt to today's one-line label by `legacyFindingComment`, so the new rows never reach the model; `parseInlineTable` accepts a Severity cell with or without the tier word | The table is where a reader already looks for severity, area and confidence. Findings with no inline thread (Info, Pre-existing, inconclusive, outside the diff) cannot use the table, so they show the priority and Track record as one line in the body list | 0059 |
| 16 | Every review opens its findings with one line of what was reviewed: `9 findings: 1 Must, 4 Should, 3 Could, 1 FYI · 6 at high confidence` (in the trial's word arm: `5 Important, 4 Nit · 6 at high confidence`) | A reader who saw only "Nit" concluded the review found little; the line shows its weight at a glance | 0059 |
| 17 | Info keeps no thread (it asks for no code decision) and is listed in the body and counted in the summary line | Every finding is read; a thread per Info would add noise without a decision to record | — |
| 18 | Layer 1 is stacked on the inline finding table branch, which opens as its own PR at the bottom of the stack | The Priority and Track record rows need the table; assumed in the GSD run, your call | — |
| 19 | In layer 1 the Track record row reads `no record yet · seed` for every finding; numbers appear only from the repository's own outcomes, once layer 2 counts them. The 63-PR sample stays in this spec as the reason for the seeds, never in a comment | One private repository's compliance rates must not show up in another project's review as if they were its own; assumed, your call | 0059 |
| 20 | The trial is on with `WACHIMAN_PRIORITY_TRIAL=1`; the arm is a hash of repository and PR number, so a push never changes it and nothing is stored; with the trial off every review uses the priority arm and the result has no `arm` | Stable per PR without a store; assumed, your call | 0059 |

## Layers

| # | What it builds | Criteria | Risk | Depends on |
| --- | --- | --- | --- | --- |
| 1 | `priority` and `rank` on findings, `priorityOf` with floors, table v1 as data with provenance, Priority and Track record rows in the inline table, the summary line, origin badge, `tier` deprecated, A/B assignment | AC1–AC5, AC10, AC11, AC13, AC15–AC17 | 🟡 Medium | The inline finding table ([#266](https://github.com/niway-dev/wachiman/pull/266)); built in [#267](https://github.com/niway-dev/wachiman/pull/267) |
| 2 | `wachiman calibrate`: outcome rates per cell from local history, verdicts and PR threads; a blind judging sample; proposes table vN+1 as a diff | AC6–AC8, AC12, AC14 | 🟡 Medium | 1 |
| 3 | Prompt: the test that separates Fix from Consider, measured on the benchmark before and after | AC9 | 🟢 Low | 2 |

## Open questions

1. **Size and pace of the blind judging sample.** Default: 40 findings per release, stratified over
   the seven cells whose word can move: Consider at high, medium and low, Fix at high, medium and low, and Blocker at low (about five each). Blocker at high and medium are always Must and Info is always FYI, so they are not sampled; unanswered findings are included in the draw,
   judged by the owner with the word hidden ("would you act on this?"). Judgements accumulate across
   releases, so, at five judgements per cell per release, a cell reaches decision 12 after about four releases; cells whose fix rates disagree
   most with their seed are judged first. Revisit after the first run of NIW2-874.
2. **Bands from rank to word.** The rank is 100 × the lower end of the cell's 90% Wilson interval
   on the judged "would act" proportion. Default: Should 60 and above, Could 25–59, FYI below 25. Must is
   not a band: it is every Blocker at high or medium confidence, whatever its rate. A Blocker at low
   confidence is already posted as a question (ADR 0027) and is Could.
## Out of scope

- Any rule that lets an author or agent skip a finding by its priority. Every finding is answered.

- Changing the stop rule or the loop budget.
- A per-repository table before its cells reach the minimum sample.
- Dropping or capping low-priority findings before posting.
- Any change to what the model is asked to find.

## Failures this must protect against

- A Blocker at high or medium confidence shown as anything but Must.
- A low-confidence Fix or Blocker (already posted as a question, ADR 0027) shown above Could.
- A cell with n below the minimum shown with a rate as if it were measured.
- `tier` changing value for an existing `/2` consumer.
- A pre-existing Blocker losing its origin badge or its Must.
- The table changing mid-release because `calibrate` ran.
- Agent fixes inflating a cell until it climbs a band.
- A fix rate shown or used as "the author should act".
- Unanswered findings dropped from the denominator, hiding the ones nobody wanted.
- A table measured on one model or prompt applied to another as if measured.
- A cell flipping words between releases on noise near a band edge.
- A frequent, cheap cleanup cell ranked above a defect Fix.

## Acceptance criteria

- [ ] **AC1** `priorityOf` returns Must for every Blocker at high or medium confidence, Could at low, and the v1 table maps Consider · high to Should, Consider · medium and low to Could, and every Info to FYI (unit tests over every cell).
- [ ] **AC2** In the priority arm, the inline finding table shows a Priority row first under the title and a Severity cell without the tier word; the plain-text and Markdown sinks (`src/sinks/common.ts`) show the same word; the hidden thread marker is unchanged (ADR 0010); rendered fixtures updated.
- [ ] **AC15** `parseInlineTable` and `parseLabel` read severity, topic and confidence from tables with and without the tier word and from the old one-line label; `legacyFindingComment` drops the Priority and Track record rows from the model's input (round-trip tests).
- [ ] **AC16** Every review with findings opens them with the summary line of decision 16, counted by the arm's word.
- [ ] **AC17** Priority is computed after verification, so a finding the verifier lowers to low confidence gets its final priority (test through `verify.ts`).
- [ ] **AC3** The Track record row shows `no record yet · seed` while the repository has no counted outcomes (all of layer 1), and `fixed <p>% of <n> answered · <k> PRs` with `seed` or `calibrated vN` once layer 2 counts them.
- [ ] **AC4** `/2` output keeps `tier` with today's values and adds `priority`, `rank` and, during the trial, `arm`; the JSON schema validates both old and new files; `toResultV1` drops `priority`, `rank` and `arm`, and the `/1` downgrade is covered, with the schema change additive and optional, as `riskMap` and `fidelity` were.
- [ ] **AC5** Pre-existing findings show the origin badge and keep their priority.
- [ ] **AC6** `wachiman calibrate` prints, per cell, n, fixed %, declined %, wrong %, unanswered %, split by owner and agent.
- [ ] **AC7** `wachiman calibrate --propose` writes the next table as a file diff and changes nothing the engine reads until it is committed.
- [ ] **AC8** Given a fixture of thread outcomes with the counts of the sample below, `calibrate` prints exactly the sample's table.
- [ ] **AC9** The prompt change is merged only if, on the benchmark, the share of Fix among findings later fixed rises and the share of Fix later declined does not exceed one third (ADR 0003 reopen condition).
- [ ] **AC10** No finding gets a priority below its floor: every Blocker at high or medium confidence is Must, every Fix on a defect topic at high or medium confidence is at least Should (property test over all cells and rates).
- [ ] **AC11** A review whose model family or prompt version differs from the cell's provenance shows `not measured for this configuration` and the seed word.
- [ ] **AC12** `calibrate` marks a cell measured only under decision 12, and a word moves only when the interval crosses the band edge (unit tests at the edges).
- [ ] **AC13** With the trial on, each PR's result records `arm: word | priority`, assigned at random, and the comment renders accordingly.
- [ ] **AC14** `calibrate --judge` draws the blind sample (unanswered included), hides the word, and stores each judgement; the proposed table is fitted to those judgements, with fix and decline rates reported beside them.

---

## Evidence: the sample behind table v1

Five days of remote reviews (2026-11-14 to 2026-11-18) on one private product repository, 63
pull requests, counts only. "Fixed" and "declined" come from the author's reply on each thread;
findings with no reply are excluded from the rate.

| Severity · confidence | Answered | Fixed | Declined |
| --- | --- | --- | --- |
| Consider · high | 56 | 95% | 5% |
| Consider · medium | 96 | 71% | 29% |
| Consider · low | 25 | 56% | 44% |
| Fix, any confidence | 11 | 73% | 27% |

By topic group, Consider findings about defects (bug, security, perf) were fixed 61% of the time,
tests 82%, docs and cleanup 80%. The model labelled 11 of 231 remote findings Fix, and 52 Consider
findings were topic `bug`.

**Limits.** One repository, one model configuration, mostly agent authors. "Fixed" is a reply that
says so, not a checked commit, and it measures compliance, not whether acting was warranted.
Unanswered findings are excluded. That is why v1 is only a seed, decision 6 fits the table to blind
judgements, and layer 2 exists. The design was attacked before review; its weak points and answers
are in "Weak points and answers" below.

## Weak points and answers

Attacked by a second model on another provider with only the claim and the facts.

| Weak point | Answer |
| --- | --- |
| A fix rate measures compliance, not whether to act | Decision 6: fit to blind judgements; show `fixed` for what it is |
| A table from one repository is not portable | Decision 11: provenance per cell; other configurations fall back to the seed |
| 20 outcomes is not precision; edges flip | Decision 12: 5 PRs minimum, Wilson interval, a word moves up on the lower end and down on the upper end |
| The word changes the behaviour it learns from | Decisions 6 and 13: blind judgements and an A/B arm |
| A cell average hides stakes | Decision 10: severity and topic floors; a rate only raises |
| "No added rounds or cost" was a code property | Narrowed to "no extra model call"; rounds measured in the A/B |

## Why not keep Claude Code's three words

Claude Code tags each finding Important, Nit or Pre-existing; its write-up gives one reason, "so a
bug the PR didn't introduce doesn't look like the author's fault"
([Solving code review at Anthropic](https://claude.dev/blog/solving-code-review-at-anthropic/)).
Their pipeline drops style, diagnostics and cleanup findings and caps nits before posting, so its
Nit is a small residue. Wachiman posts every Consider, so the same word covers most of what we
post, including findings authors fix almost always. The pre-existing reason stays valid: it moves
to its own badge (decision 14). The same write-up sorts every comment by how the author responded
(fixed, wrong, intentional, didn't matter); `calibrate` uses the same outcomes.

## State of the art

| Tool | How it ranks | Derived or chosen |
| --- | --- | --- |
| [CodeQL](https://codeql.github.com/docs/writing-codeql-queries/metadata-for-codeql-queries/) | `problem.severity` and `precision` kept apart; both decide display; `security-severity` from CVSS | Derived from query metadata |
| [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html) | `level` category plus `rank` 0–100 for priority within it | Emitted by the tool |
| [Semgrep](https://docs.semgrep.dev/contributing/contributing-to-semgrep-rules-repository) | Severity beside `confidence`, `likelihood`, `impact` | Chosen by the rule author |
| [SonarQube](https://docs.sonarsource.com/sonarqube-server/latest/user-guide/rules/overview/) | Software quality × impact severity, from impact and likelihood | Assigned per rule |
| [CodeRabbit](https://docs.coderabbit.ai/change-stack/findings.md) | Type (Nitpick is a type), severity, category, effort; "read the labels together" | Chosen by the model |
| [Conventional Comments](https://conventionalcomments.org/) | Label plus decoration: blocking, non-blocking, if-minor | Chosen by the reviewer |
| [Google Tricorder](https://www.cs.umd.edu/class/spring2019/cmsc414/papers/tricorder-building-a-program-analysis-ecosystem.pdf) | Analyzers demoted when developers take no positive action on too many findings | Calibrated from outcomes, per analyzer |

Mature tools keep confidence apart from priority, and only a few derive the headline. None prints a
per-finding priority calibrated from outcomes; layer 2 is new ground and is measured as such.

## Expected impact (for the release notes)

The change is cheap to build: the word only renders titles, needs no extra model call, and the stop
rule reads severity. The expected gain is triage: findings authors act on almost always stop reading as Nit, a Could is
visibly optional, and every comment carries the rate it is ranked by, so each review adds data. Authors may
spend more on a finding that now reads Should, so rounds and commits after a PR opens are measured
in the A/B against the NIW2-874 baseline and reported, not assumed.
