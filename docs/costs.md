# Cost, budgets and coverage

Wachiman runs in your GitHub Actions and calls a model provider with your own credential: an API
key, so the provider bills your account per token, or a Claude subscription token, so the calls
count against a Claude plan's usage limits
([below](#when-the-review-runs-on-a-claude-subscription)). This project runs no service and takes
no payment. This page explains
what bounds the spend of one run, where those bounds are weaker than they sound, and how to read
the cost a review reports.

**Most budgets limit one run. One limit covers a pull request's automatic runs together: `auto_budget_usd` (default $6).** Nothing limits a month. For the supported
Claude workflow the per-call cap is soft: a call can spend more than its cap. For Codex there is no
per-call dollar cap at all. Treat the settings as guard rails, and set a spend limit at the provider
if you need a hard ceiling. New in the next release: a pull request whose estimated cost is above
the size gate (`size_gate_usd`, default $6) is not reviewed at all, and Wachiman says why in one
comment. See [The size gate](#the-size-gate).

Everything below describes the code at release `v1.3.0` (`src/engine.ts`, `src/providers/`,
`.github/workflows/review.yml`). It is advisory software: a review never approves, requests changes
or blocks a merge, and neither does running out of budget.

## What you pay for

| Charge | Billed by | What this repository can tell you |
| --- | --- | --- |
| Model calls | The provider that owns the key: Anthropic for the reusable workflow | The engine's own estimate, in the review footer (see below) |
| Runner minutes | GitHub, under your plan | Each job has a 30 minute timeout (`timeout-minutes: 30` in `review.yml`) |

A dry run (`WACHIMAN_DRY_RUN=1`) is not free: it only skips posting to GitHub. It still calls
the agent. See [Dry runs](#dry-runs).

## The ceiling per pull request

Reviewing every push and answering thread replies means a pull request pays for many runs. All
**automatic** runs on one pull request (the first review, push reviews and thread-reply runs) share
`auto_budget_usd`, default **$6**, which leaves room for one full review (`budget_usd`, $3) and several push reviews. There is no server: before each automatic run the engine adds up
the cost lines of its own signed review footers that carry the automatic flag
(`<!-- wachi:auto -->`), and the run gets at most what is left. The `this run · PR so far` line under
an inline reply carries no flag, so it is neither summed nor counted: the review body of the same run
already records that cost ([What each run shows](#what-each-run-shows)). When less than $0.05 is left, it
posts one "Automatic reviews paused" notice and does nothing else, and later pushes post nothing
until you raise the limit or ask yourself.

- `/wachiman review` and `/wachiman <question>` are not limited and not counted.
- The first review counts. A large first review ($1.36 on a big pull request) can use most of $2;
  the notice then tells you how to continue.
- A run cancelled by a newer push posts nothing, so what it spent is in no footer and is not
  counted; a thread-reply run that posted no reply is not counted either. The ceiling can
  under-count them. Footers show cents. [ADR 0012](adr/0012-automatic-thread-replies-and-a-per-pr-ceiling.md)
  says when this is reopened.
- It bounds the engine's own accounting. For Claude the per-call cap is soft, so a pull request can
  still go past $2 by a call's overshoot.

## The size gate

**New in the next release** ([ADR 0037](adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md)). The budgets above bound what a run spends. They do not bound
what a run would need to spend to be complete. On a very large pull request a run spent its whole
budget on the riskiest batches and posted that as a review of a small part of the change. The size
gate asks the other question first: what would the whole review cost? If the answer is above the
gate, Wachiman reviews nothing and says so.

### The estimate

Before any model call, the engine takes the files the run would send (after exclusions, scope and
the binary split) and plans the batches exactly as the review would. It multiplies the number of
batches by a per-batch figure for the model:

| Model | Per batch | Sample | Range |
| --- | --- | --- | --- |
| Sonnet 5.5, high effort | $0.32 | 42 batch calls | $0.20 to $0.58 |
| Opus 5.5, high effort | $0.50 | 66 batch rows | medians $0.495 and $0.505 |
| Haiku 5.5, high effort | $0.28 | 21 calls | median $0.29 |
| Any other model | `batch_budget_usd` | none | the worst case a call may cost |

The figure is never above `batch_budget_usd`. No model is called: the estimate is a function of the
diff alone.

Where the figures come from (all in the `wachiman-benchmarks` repository):

- Sonnet: the coverage tables of `2026-11-02-e1-sonnet/raw/round7..9-*-reviews.md`. Batches held
  297 to 998 lines, and the cost did not follow the line count, so one flat figure per batch fits
  as well as a per-line one.
- Opus: the coverage tables under `2026-11-02/raw` and `2026-11-02-heldout/raw`. Part of this data
  was run on a subscription, so those figures are API-equivalent estimates, not bills.
- Haiku: the logs of `2026-11-06-local-haiku-vs-opus`. All run on a subscription: API-equivalent
  estimates, not bills.

The sample is small and comes from a handful of repositories. A codebase unlike them, a lower effort,
retries and the opt-in verifier all move the real cost. **Expect the estimate to be off by about 40%
either way.** It is a gate, not a quote. The verifier, the PR Confidence claims call and thread
replies are not in the estimate; they are small and have their own budgets.

### The gate

`size_gate_usd` (`WACHIMAN_SIZE_GATE_USD`) is a finite number greater than 0, default **$6**.
There is no value for "unlimited": a typo cannot remove the bound, and the most a run can spend is
still `budget_usd`. The gate that applies to a run is never below what the run may spend:

- `/wachiman review`: the larger of `size_gate_usd` and `budget_usd`.
- An automatic run: the larger of `size_gate_usd` and the smaller of `budget_usd` and `auto_budget_usd`.

A run that may pay for the whole estimate gets the whole review.

### What happens

| The estimate is | What the run does |
| --- | --- |
| At or below `budget_usd` | A normal review. |
| Above `budget_usd`, at or below the gate | A partial review of the riskiest batches, as described in [When the budget runs out](#when-the-budget-runs-out). The next push resumes it ([ADR 0036](adr/0036-a-partial-review-records-the-files-it-did-not-reach-so-the-next-push-resumes.md)). Unchanged. |
| Above the gate | GitHub Actions posts no review, writes no marker and spends nothing. It posts one issue comment instead. |

The comment carries a hidden marker (`<!-- wachi:size-gate -->`). A later skip on the same pull
request finds it and edits the comment instead of posting another, so a pull request that keeps
growing has one comment, kept current. For example (the estimate this code computes from the diff of [pingdotgg/t3code#28845](https://github.com/pingdotgg/t3code/pull/28845)):

```text
**Not reviewed: this pull request is above the size gate.** Reviewing all of it would cost about **$20.80**, and the gate is **$6.00**, so nothing was sent to a model and nothing was spent.

The estimate: 65 batches × $0.32 a batch for `claude-sonnet-5-5` (606 files, 59,273 changed lines), from the diff alone, before any model call. It can be off by about 40% either way.

To review the whole pull request, set the run budget in the workflow that calls Wachiman, then comment `/wachiman review`:

    with:
      budget_usd: 32

A `budget_usd` at or above the estimate lifts the gate for that run. To have pushes reviewed automatically as well, also set `auto_budget_usd: 32`. To review part of it now, comment `/wachiman review <path> [path…]`.
```

### How to lift it

Set `budget_usd` in the caller workflow to the figure the comment gives (1.5 times the estimate,
rounded up, to cover the error), then comment `/wachiman review`. Because the gate is never below
the run budget, that one change is enough. To have pushes reviewed automatically as well, raise
`auto_budget_usd` to the same figure, since automatic runs share that ceiling. Set `size_gate_usd`
only to move the gate without raising a run budget.

### Re-reviews, resume and the ceiling

- An incremental push on a reviewed pull request is estimated on its own delta. A resumed run
  ([ADR 0036](adr/0036-a-partial-review-records-the-files-it-did-not-reach-so-the-next-push-resumes.md))
  is estimated on its delta plus the files it carries.
- A skipped pull request has no marker, so its next push estimates the whole pull request again and
  updates the same comment.
- `/wachiman review <paths>` is estimated on those paths only, so reviewing part of a large pull
  request stays one comment away.
- The skip comment has no cost line, so `auto_budget_usd` does not count it. The gate is checked
  before the ceiling, so a skip never posts "Automatic reviews paused".

### Local runs

`wachiman local` never refuses and never prompts. When the estimate is above the larger of
`size_gate_usd` and `budget_usd`, it prints one warning on stderr before the first model call and
carries on. For example (the estimate this code computes from the diff of [pingdotgg/t3code#28845](https://github.com/pingdotgg/t3code/pull/28845)):

```text
warning: reviewing all of this would cost about $20.80 at API prices (65 batches × $0.32 for claude-sonnet-5-5), above the $6.00 size gate. Local runs are never refused; this one continues and stops at its budget, $3.00 (WACHIMAN_BUDGET_USD).
```

The money caps of a local run are `budget_usd` for the run (`WACHIMAN_BUDGET_USD`, default $3) and
`batch_budget_usd` for each call, passed to Claude Code as `--max-budget-usd` (a soft cap, like in
GitHub mode). There is no `auto_budget_usd` ceiling locally. On a subscription the cost shown is
Claude Code's API-equivalent figure, not a bill.

## How the budgets work

There are three settings, all in USD. Their defaults and names are in
[configuration.md](configuration.md) and [cli.md](cli.md).

| Setting | Default | What it bounds |
| --- | --- | --- |
| `budget_usd` / `WACHIMAN_BUDGET_USD` | `3` | The total the engine allows itself across every batch and retry of one `review` run |
| `batch_budget_usd` / `WACHIMAN_BATCH_BUDGET_USD` | `0.75` | The cap passed to **each provider call** |
| `answer_budget_usd` / `WACHIMAN_ANSWER_BUDGET_USD` | `1` | The cap for the one call that answers a question |

`size_gate_usd` / `WACHIMAN_SIZE_GATE_USD` (default `6`, new in the next release) is not a budget. It
spends nothing and bounds nothing a run pays. It decides whether a run starts at all, by comparing
the cost estimate of the whole review with a number. See [The size gate](#the-size-gate).

A review splits the changed files into batches and sends each batch to the agent as one call, riskiest
files first (the risk score is a heuristic on file paths; see [architecture.md](architecture.md)).
The engine keeps a running total, `spent`, of what each call reports. Before each call it works out
the cap for that call:

```
cap = min(batch_budget_usd, budget_usd - spent)
```

Four rules follow from that code:

1. **The per-batch figure caps a call, not a batch.** If the model leaves files unaccounted for, the
   engine makes one retry with only those files. The retry is a second call with its own cap, again
   `min(batch_budget_usd, what is left)`. A batch can therefore cost up to twice the per-batch
   figure. A call that failed without a result (the process crashed, say) is retried the same way.
2. **A call that fails is counted at its cap.** The engine cannot know what it spent, so it assumes
   the worst case it allowed. The real figure may be lower, or higher if the provider's cap was
   exceeded.
3. **The engine does not start a call with less than $0.05 left.** The same limit applies to the
   retry. A total below $0.05 is accepted as a setting but starts no batch: the run ends with the
   error "The agent did not return a review for any batch."
4. **The total can be overshot.** The engine checks `spent` after each call, using what the call
   reported. The last call can push the total past `budget_usd`, because the cap on a call is not
   exact (see the next section).

Only the budget of the run is tracked. Nothing carries over between runs: each `/wachiman review`
comment, each time a pull request opens or leaves draft, and each answer starts again from zero. The
engine has no lifetime or monthly limit per pull request or repository.

The `answer` path (a question to `/wachiman`, not a review) is one call with `answer_budget_usd`. It has
no batches and no retry.

## How each provider enforces its cap

| | Claude Code (the reusable workflow's provider) | Codex (CLI only) |
| --- | --- | --- |
| Per-call dollar cap | `--max-budget-usd`, checked by Claude Code itself. **Soft**: a call can overshoot it | **None.** The adapter receives the cap and does not use it |
| Turn cap | `--max-turns` (`max_turns`, default 40), checked by Claude Code itself; reaching it ends the call as `turns` | **None.** `codex exec` has no such flag |
| Wall-clock limit on a call | `call_timeout_s` (default 900), then `SIGKILL`; ends the call as `timeout` | Same limit and signal |
| Where the reported cost comes from | The cost Claude Code reports for the call (`total_cost_usd`) | Computed by the adapter from token counts times a price table in the code |
| Available from the reusable workflow | Yes | **No.** The workflow installs only Claude Code and passes only `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` |

Details: [providers/claude-code.md](providers/claude-code.md) and
[providers/codex.md](providers/codex.md).

What this means in practice:

- With Claude, the caps keep ordinary runs small, but nothing here proves a call cannot overshoot.
  The engine charges what Claude Code reports afterwards and then refuses to start more calls once
  `budget_usd` is reached.
- With Codex, only the engine's running total and the call timeout (15 minutes by default) limit spend. A single call can
  cost more than `batch_budget_usd`. Tokens are priced from a table in `src/providers/codex.ts`
  (`gpt-6.1-sol` and `gpt-6-sol`, both $2 input, $0.10 cached input, $10 output and $5 cache write per million tokens),
  and any other model needs `WACHIMAN_PRICE_PER_MTOK`. Cache writes are billed at their own rate instead of the input rate. OpenAI lists a 30-minute write at $2.50 and a 12-hour write at $5 for GPT-6.1 Sol. Codex's request structures set no cache lifetime, so it most likely gets the API default of 30 minutes and $2.50; the table still holds the higher $5 on purpose, because the figure is a budget ceiling and counting too much is safer. A custom price with only three fields uses 2.5 times its input rate for writes (the same ratio) instead of marking the cost unknown, for the same reason; add a fourth field to set it. Those figures are what the code holds, not
  a current price quote: check them against OpenAI's pricing page. Only completed turns are counted,
  so a call killed by the timeout can have spent more than it reports.
- Codex is CLI-only today. You can run it from a checkout with the `bun` command in
  [cli.md](cli.md); you cannot select it from the reusable workflow's `provider` input.

## When the budget runs out

This applies when the estimate is at or below [the size gate](#the-size-gate). Above the gate, the
run does not start and posts the skip comment instead.

The engine does not stop the review early with an error. It posts what it has:

- A batch is **not started** when less than $0.05 is left. Its files are listed in the review as not
  reviewed, with the reason "not reached: the pull request's budget was spent", and the coverage table
  shows `not run: budget spent` for that batch.
- A batch whose call ended on its cap without a usable result has no review for its files. The
  engine retries it if at least $0.05 is left; otherwise the table shows
  `N file(s) left: budget spent`.
- A batch whose call stopped at the **turn cap** (`max_turns`) has no review either, because Claude Code
  prints no answer when it stops there. It is handled like a spent budget: one retry for its files if
  at least $0.05 is left, the table shows `hit the turn limit`, and files still missing are listed as
  not reviewed.
- A batch whose call was **killed at the wall-clock limit** (`call_timeout_s`) is not retried, because
  the same files would probably run into the same limit and a second full timeout could exhaust the
  30 minute job. The table shows `N file(s) left: the call timed out`. The killed call reports a cost
  of 0, since the CLI prints nothing before it ends, so the total can understate what it spent.
- If at least one batch produced a review, it is posted with a first line that begins
  "Partial review": how many files were reviewed, which were not, and the command to ask for the rest.
- If no batch produced a review and at least one call ran out of budget (or hit the turn cap or the
  time limit), the review is a short body saying so, with `/wachiman review <path>` as the way to review part of the pull request. If nothing
  came back and no call ran out of budget, the run fails with "The agent did not return a review for
  any batch."

A partial review therefore happens only for a pull request that costs more than `budget_usd` and
no more than the gate (about $6 by default). Larger ones are not reviewed.

Because batches run riskiest first, the files left out are the ones the path heuristic ranks lowest.
That is a heuristic on file names. It does not mean they are safe.

To cover the rest, ask for those paths with `/wachiman review <path> [path...]`. A scoped review is a new
run with a new budget, and it does not move the "reviewed up to here" marker, so it is not a way to
finish an incremental review. See [reviews.md](reviews.md). A partial review, by contrast, records the
files it did not reach, so the next push or unscoped `/wachiman review` reviews those files (with their
whole diff) plus what changed since, and not the files the partial review already read. Each such run
is a new run with its own `budget_usd`, and counts against `auto_budget_usd`: a pull request too big
for one budget is finished over several pushes, not paid for again from batch 1.

## Things that add to the total

- **Retries.** Described above: a second call, with its own cap, for files the first call missed.
- **The verifier, opt-in** (`verify`; set `true` to enable it, [ADR 0027](adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md)).
  One more call per review that has findings above `info`, on `verifier_model` (Opus 5.5 by
  default). Its reserve, `verify_budget_usd` ($1, at most half of `budget_usd`), comes out of the
  review's own budget before the batches run, so a large pull request may get one batch less. Its
  input is the findings and the code they cite, not the diff, so its cost grows with the number of
  findings. On the nightly kaipu-record field run an Opus verifier cost $0.21 to $0.80 per pull
  request (an API-equivalent estimate on a subscription, 13 pull requests with findings); a review
  with no findings above `info` makes no verifier call.
- **Pushes.** With `synchronize` in the caller (the templates have it), every push to an open pull
  request starts a review with its own `budget_usd`, until the pull request's automatic runs reach
  `auto_budget_usd` ([above](#the-ceiling-per-pull-request)). It reads only what is new since the last
  complete review, so a small fix costs a small review, but a pull request that gets ten pushes pays
  for ten reviews, and a push that changes many files can spend the whole budget again. A rebase
  with no change in the pull request's lines costs no model call (one runner job of a few seconds and
  one line on the pull request). A burst of pushes runs once, because the older run is cancelled; what
  a cancelled run had already spent is not verified here. To opt out, remove `synchronize` from the
  caller or set `review_on_push: false`. Whether the cost per pull request is worth the findings on
  later commits is not measured yet ([ADR 0011](adr/0011-review-every-push-incrementally.md)).
- **Repeated runs.** A new `/wachiman review` after a change, a pull request that leaves draft,
  and a scoped review on an unchanged head each start a full budget. A plain `/wachiman review` on a head
  that already has a complete review stops with "Already reviewed" before any provider call.
- **Thread replies.** Each reply of the operator's in a thread can start a run (`threads`) that makes one
  call capped at `threads_budget_usd` (default $0.25), once the head is reviewed. It counts against
  `auto_budget_usd`. A reply by anyone else, or on an unreviewed head, starts no model call.
- **Overlapping jobs.** The automatic job, the thread-reply job and the on-demand job use separate
  concurrency groups (`wachiman-review-<pr>`, `wachiman-review-threads-<pr>` and
  `wachiman-review-on-demand-<pr>`), so one cannot cancel the other. If both are
  running, both spend. Within one job a newer run cancels the older one (`cancel-in-progress`). Cancellation
  before posting leaves no review; cancellation after posting may leave the review and some replies.
  Check the pull request before rerunning. Whether the provider bills the calls that were in flight
  at cancellation is not verified here.
- **Large single files.** A file bigger than a batch's line or character limit becomes a batch of its
  own and is not split. The limits are not a ceiling on how much the model reads, because it can read
  more of the head through its read tools.
- **Dry runs.** See below.

## Dry runs

`WACHIMAN_DRY_RUN=1` reads GitHub and prints the review instead of posting it. It still calls the
agent, and the budgets above apply. It does not require the provider key: the Claude adapter uses
whatever login the machine has, and the Codex adapter uses the machine's own Codex login. Whether that
login bills an API account or a subscription depends on that login, not on Wachiman. The reusable
workflow has no dry-run input; the setting exists for the command line and the copy install.

## Reading the cost in a review

Every review ends with a line like this one (illustrative):

```
Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · re-review · 4 batches · 21k in / 38k out / 2.1M cache read / 96k cache write · $1.87
```

- **The model label** is the model, the CLI that ran it and that CLI's version.
- **`effort high`** is the reasoning effort the run used. Releases up to v1.3.0 do not print it, so
  their footers read `... via Claude Code 2.1.304 · 4 batches · $1.87`.
- **The operation** is `review` (the whole pull request) or `re-review` (the changes since an earlier
  reviewed commit). Footers written before this was added do not show it, or the token counts.
- **`N batches`** appears only when the review used more than one batch.
- **The tokens** are what the review's calls used, with cached tokens split out so the four counts do
  not overlap: `in` (not cached), `out`, `cache read` and `cache write`. They are left out when the
  provider reported none. For Codex, `cache read` is its cached input and `cache write` is its `cache_write_input_tokens`. Codex's SDK does not say whether `input_tokens` includes those, so they are treated like cached input (taken out of `in`) and the split never goes below 0.
- **The dollar figure** is the engine's `spent`: the sum of what each call reported, plus the cap for
  any call that failed without a result. It includes retries. It is formatted to two decimals, so
  a small cost can show as `$0.00`.
- An answer to a question ends with the same line for its one call, tagged `on-demand`, with no batch
  count. The first reply of a thread run ends with it too, tagged `reply`.
- **`PR so far $0.77 over 3 automatic runs`** is what the pull request's automatic runs have cost
  together, this one included. It is in the footer of every automatic run and is missing from an
  operator's `/wachiman review`, which is not counted.
- The dollar figure is always last. It is the run's own cost and the last dollar figure in the line
  (an earlier one can sit in `PR so far`): the per-pull-request ceiling reads the last one
  ([above](#the-ceiling-per-pull-request)).

### What each run shows

Every automatic run says what it cost and what the pull request has cost so far. "PR so far" is the
sum of the flagged footers before this run plus this run, and the run count is the number of those
footers plus one.

| Where | What it says | Counted by the ceiling |
| --- | --- | --- |
| The review body's footer | `… · re-review · 2 commits · PR so far $0.77 over 3 automatic runs · 4 in / … · $0.11` | Yes (flagged) |
| An inline reply of a push review | `<sub>this run $0.11 · PR so far $0.77 over 3 automatic runs</sub>` under the reply | No: unflagged, so the run is not counted twice |
| The first reply of a thread run | The footer line with `reply · answers 2 thread(s) · PR so far …`, flagged | Yes |
| The other replies of a thread run | The unflagged `this run · PR so far` line | No |
| A notice for a run that failed (no credit, turn limit, budget) | The footer line with `PR so far …`, flagged | Yes |

An operator's `/wachiman review` shows no running total and is not counted.

### Every model call, in the job summary and the log

The engine makes a model call in one place, so every call is accounted for the same way, whatever
it was for:

| Operation | The call |
| --- | --- |
| `review` | A batch of a first or full review, and the retry of its unaccounted-for files |
| `re-review` | A batch of an incremental review (a push, or `/wachiman review` after a reviewed commit), and its retry |
| `reply` | The one call that answers the pending review threads (an automatic thread run) |
| `on-demand` | The one call that answers `/wachiman <question>` |

The engine never asks a model to write a pull request description: the review's summary is part of
the review's own answer, so it is inside `review` or `re-review`.

Each run writes:

- **A job summary** (`$GITHUB_STEP_SUMMARY`, shown on the run's page) with one row per call: operation,
  model, turns, input, output, cache read, cache write and cost in USD, and a total row. It is written
  also when the run failed after spending, and not at all when no model was called.
- **One log line per call**, `wachiman-cost {json}`, with the operation, a label (`batch 2/3 retry`,
  `threads`, `question`), repository, pull request, trigger, model, turns, duration, the four token
  counts, `costKnown`, `cost_usd` and the terminal reason. `grep '^wachiman-cost ' run.log` over several runs'
  logs gives the data to sum costs by operation.

A call that died without any result, or was killed on the time limit, or never completed a turn (Codex), still gets a row and a line, marked as an unknown cost: the
cost column reads `unknown (counted at cap $0.75)`, and the line has `"costKnown":false`,
`"cost_usd":null` and `"countedUsd":0.75`. The review counts it at that cap (see above), but the
summary's total and any sum over `cost_usd` leave it out, so the figures never mix a measurement with
a guess. A thread run that posts no reply has a row and a line but no
footer, so the ceiling does not count it; the summary and the log do.

Open **Coverage by batch** in the review for one row per batch:

| Column | Meaning |
| --- | --- |
| Files, Lines | How many files and changed lines the batch held |
| Highest risk | The highest path-heuristic score in the batch |
| Status | `reviewed`, `reviewed after a retry`, `N file(s) left after a retry`, `N file(s) left: budget spent`, `ran out of its budget`, `the call failed`, `returned no review`, or `not run: budget spent` |
| Turns | The model's turns across the batch's calls |
| Cost | The batch's first call plus its retry |

### A worked example

This example is illustrative. The numbers are invented to show the arithmetic, not measured from any
repository or provider. Take the defaults ($3 total, $0.75 per call) and a pull request that splits
into six batches.

| Step | Cap given to the call | Reported cost | Total spent after | Outcome |
| --- | --- | --- | --- | --- |
| Batch 1, first call | min(0.75, 3.00) = 0.75 | 0.62 | 0.62 | Every file reviewed |
| Batch 2, first call | min(0.75, 2.38) = 0.75 | 0.75 | 1.37 | Hit its cap, no usable review |
| Batch 2, retry | min(0.75, 1.63) = 0.75 | 0.50 | 1.87 | Files reviewed after a retry |
| Batch 3, first call | min(0.75, 1.13) = 0.75 | 0.70 | 2.57 | Every file reviewed |
| Batch 4, first call | min(0.75, 0.43) = 0.43 | 0.43 | 3.00 | Hit its cap, no usable review |
| Batch 4, retry | not started | none | 3.00 | Less than $0.05 left |
| Batches 5 and 6 | not started | none | 3.00 | Less than $0.05 left |

What the review shows: a "Partial review" line naming the files of batches 4, 5 and 6; the footer
`... · 6 batches · $3.00`; and a coverage table with batch 2 at `reviewed after a retry` and `$1.25`,
batch 4 at `N file(s) left: budget spent`, and batches 5 and 6 at `not run: budget spent`.

Batch 2 cost $1.25 although the per-call figure is $0.75, because the retry is a second call. With
Claude, a call can also finish above its cap, in which case the total can end above $3.00. With a
failed call the engine would have added the call's cap rather than a measured figure.

## What the footer does not tell you

The footer is the engine's own accounting. It is not an invoice, and this repository does not check it
against one.

- For Claude, it is the figure Claude Code reports. Nothing here reconciles it with Anthropic's billing.
- For Codex, it is an estimate from token counts and the price table in the code.
- A failed call is counted at its cap, which may differ from what the provider charged.
- A cancelled run, or a run that failed before posting, shows no footer at all, but may have spent.
  Cancellation before posting leaves no review; cancellation after posting may leave the review and
  some replies. Check the pull request before rerunning.
- It does not include GitHub runner minutes.

To see what you were actually charged, use the provider's console (the Anthropic Console for the
reusable workflow; on a subscription there is no per-call charge, see the next section). If you need a hard ceiling, set a spend limit there; the provider's current
options are described in its own documentation, which this repository does not verify. Using a key
dedicated to Wachiman makes its spend easy to read and the key easy to revoke.

## The spend limit

A repository may enroll in a spend ledger: a service that keeps one daily and one weekly limit for an
account across all its repositories ([install.md](install.md#optional-enroll-in-a-spend-ledger)). It
is off unless `ledger_url` is set; then nothing below applies and nothing changes. What the engine
sends the ledger, and what the ledger stores per run and per model call, is written in
[ledger-api.md](ledger-api.md).

With a ledger, each run asks before its first model call and tells the ledger what it spent after
its last:

1. **Reserve.** The run says how much it wants (its budget), the trigger and the pull request number.
   The ledger grants that or less, and the run's budget is capped by the grant. Your own
   `daily_budget_usd` and `weekly_budget_usd` are sent too; they can only make the limit stricter.
2. **Settle.** The run sends the amount it spent and its calls, the same fields as the
   `wachiman-cost` log lines. The ledger answers with a signed receipt, which goes into the hidden
   footer of the comment. No code, finding text, pull request title or credential is sent.

**What the limit bounds.** It bounds what the ledger lets runs *start*: a run is refused when the
reservations and settled spend of the period have reached the limit. It is best-effort, not a hard
maximum. A call can exceed its cap (see [How each provider enforces its cap](#how-each-provider-enforces-its-cap)),
two runs can reserve at the same moment, a run the ledger could not be asked about is not counted
until it is recorded, and a failed settle leaves the reservation counted at the reserved amount. A run
cancelled by a newer push is killed before it settles, so the reservation it held stays counted at the
reserved amount too (up to `budget_usd`, $3 by default). How long the ledger keeps it is the service's rule,
not this repository's; the run posts no footer, so the amount is in no receipt.

**Estimates.** On a Claude subscription token the amounts are API-price estimates, not a bill (see
below), so a limit in dollars bounds estimated usage, and the notice says so.

**When a limit is reached** the run posts one comment per pull request and period that says which
limit, how much was spent against it and when it resets, and no model call is made. `limit_mode`
decides whether the job is red (`fail`, exit code 3) or green (`notice`). The operator can still
start a review with `/wachiman review --force`; the ledger decides whether a forced run is allowed.

**A repository's own limit.** When the refusal is this repository's own daily or weekly limit
(`daily_budget_usd`, `weekly_budget_usd` or a cap the account sets for the repository), the notice
says so and when it resets. It shows no spent-against-limit figures, because the ledger reports the
account's totals with that refusal, not the repository's.

**A grant that is too small.** A thread-reply run or an answer whose grant is below $0.05, the least
a call needs, makes no model call: it settles with $0, releasing the reservation, and the job summary
says so. (A review with so little room reports partial coverage, as for any exhausted budget.) A
grant that is negative or not a number is a malformed answer, which stops the run (below).

**When the ledger cannot be reached** (a network error, a timeout, a 5xx or a 429), `ledger_unavailable` decides: `run` (default) reviews under
the normal budgets, the footer says the run was not counted against the spend limit, and the engine
tries to record the run once at the end; the job summary says whether that worked. `stop` ends the
run with exit code 3 before any model call. Nothing fails because the ledger is down in `run` mode.
Any other answer that is not the ledger's (a redirect, a 400, 404 or 405, a 200 whose body is not
the documented JSON) is not an outage: it means `ledger_url` is wrong or the service is broken, so
the run stops before any model call with exit code 3, whatever `ledger_unavailable` says.
If the ledger fails only at settle, the review stands and the job summary says the settlement was
not delivered. See [troubleshooting.md](troubleshooting.md#the-spend-ledger).

## When the review runs on a Claude subscription

With `CLAUDE_CODE_OAUTH_TOKEN` instead of `ANTHROPIC_API_KEY` ([install.md](install.md#review-on-a-claude-subscription)),
the calls are not billed per token. They draw on the usage limits of the plan of the person who made
the token, shared with that person's own use of Claude.

- **The dollar figures are estimates.** `total_cost_usd`, which Claude Code prints for each call, is
  what the call would cost at API prices, not a charge. The review footer says so ("Claude
  subscription: API-equivalent estimate, not a bill"), the "Automatic reviews paused" notice says so,
  the job summary says so, and each `wachiman-cost` log line carries `"auth":"oauth-token"` so a
  script summing `cost_usd` can keep estimates apart from charges.
- **The budgets still apply.** They bound the work (turns, calls, size of a run), and the ceiling sums
  the estimates in the footers exactly as it sums real amounts. A plan's own limit, not a dollar
  figure, is what finally stops a run.
- **A refused call is reported, never retried with a key.** When the plan's usage limit or a rejected
  token stops a call, the run posts the same kind of "Not reviewed" notice as for a refused API call,
  worded for a subscription, and `on_provider_unavailable` decides whether the check passes or fails.
  Nothing falls back to `ANTHROPIC_API_KEY`.
- **Not measured yet.** That Claude Code reports `total_cost_usd` with this token, and the exact error
  text a usage limit produces, have not been observed in a real run; see the pull request that added
  this route.

## Coverage is not the same as "every line was read"

"all N files reviewed" means the model listed those files as reviewed. It is the model's own report,
checked only to make sure no file with a diff was left unaccounted for. Nothing measures what it read
line by line.

N counts only the files the engine selected. Lockfiles, build output, generated files and anything
in `WACHIMAN_EXCLUDE` are filtered out first and are not part of that count. So are binary files
(a PNG, say): the engine, not the model, sets aside a file GitHub sent no diff for whose first 8000
bytes at the head hold a NUL byte. The headline names them (`all 3 files reviewed, not reviewable:
\`mock.png\` (binary)`), and they never make a review partial or keep it from moving the
incremental marker. See
[architecture.md](architecture.md) and [configuration.md](configuration.md).

## See also

- [Troubleshooting](troubleshooting.md), for a partial review or an unexpected cost
- [Security and trust](../SECURITY.md), for what holds the key
- [FAQ](faq.md)
