# Cost, budgets and coverage

Wachiman runs in your GitHub Actions and calls a model provider with your own API key, so the
provider bills your account. This project runs no service and takes no payment. This page explains
what bounds the spend of one run, where those bounds are weaker than they sound, and how to read
the cost a review reports.

**The budgets limit one run, not a month and not a pull request's lifetime.** For the supported
Claude workflow the per-call cap is soft: a call can spend more than its cap. For Codex there is no
per-call dollar cap at all. Treat the settings as guard rails, and set a spend limit at the provider
if you need a hard ceiling.

Everything below describes the code at release `v1.3.0` (`src/engine.ts`, `src/providers/`,
`.github/workflows/review.yml`). It is advisory software: a review never approves, requests changes
or blocks a merge, and neither does running out of budget.

## What you pay for

| Charge | Billed by | What this repository can tell you |
| --- | --- | --- |
| Model calls | The provider that owns the key: Anthropic for the reusable workflow | The engine's own estimate, in the review footer (see below) |
| Runner minutes | GitHub, under your plan | Each job has a 30 minute timeout (`timeout-minutes: 30` in `review.yml`) |

A dry run (`AGENT_REVIEW_DRY_RUN=1`) is not free: it only skips posting to GitHub. It still calls
the agent. See [Dry runs](#dry-runs).

## How the budgets work

There are three settings, all in USD. Their defaults and names are in
[configuration.md](configuration.md) and [cli.md](cli.md).

| Setting | Default | What it bounds |
| --- | --- | --- |
| `budget_usd` / `AGENT_REVIEW_BUDGET_USD` | `3` | The total the engine allows itself across every batch and retry of one `review` run |
| `batch_budget_usd` / `AGENT_REVIEW_BATCH_BUDGET_USD` | `0.75` | The cap passed to **each provider call** |
| `answer_budget_usd` / `AGENT_REVIEW_ANSWER_BUDGET_USD` | `1` | The cap for the one call that answers a question |

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

Only the budget of the run is tracked. Nothing carries over between runs: each `/wachi review`
comment, each time a pull request opens or leaves draft, and each answer starts again from zero. The
engine has no lifetime or monthly limit per pull request or repository.

The `answer` path (a question to `/wachi`, not a review) is one call with `answer_budget_usd`. It has
no batches and no retry.

## How each provider enforces its cap

| | Claude Code (the reusable workflow's provider) | Codex (CLI only) |
| --- | --- | --- |
| Per-call dollar cap | `--max-budget-usd`, checked by Claude Code itself. **Soft**: a call can overshoot it | **None.** The adapter receives the cap and does not use it |
| Other bound on a call | None in the adapter; the 30 minute job timeout ends it | 15 minute timeout, then `SIGKILL`; the engine treats this like a budget stop |
| Where the reported cost comes from | The cost Claude Code reports for the call (`total_cost_usd`) | Computed by the adapter from token counts times a price table in the code |
| Available from the reusable workflow | Yes | **No.** The workflow installs only Claude Code and passes only `ANTHROPIC_API_KEY` |

Details: [providers/claude-code.md](providers/claude-code.md) and
[providers/codex.md](providers/codex.md).

What this means in practice:

- With Claude, the caps keep ordinary runs small, but nothing here proves a call cannot overshoot.
  The engine charges what Claude Code reports afterwards and then refuses to start more calls once
  `budget_usd` is reached.
- With Codex, only the engine's running total and the 15 minute timeout limit spend. A single call can
  cost more than `batch_budget_usd`. Tokens are priced from a table in `src/providers/codex.ts`
  (`gpt-6.1-sol` and `gpt-6-sol`, both $2 input, $0.10 cached input and $10 output per million tokens),
  and any other model needs `AGENT_REVIEW_PRICE_PER_MTOK`. Those figures are what the code holds, not
  a current price quote: check them against OpenAI's pricing page. Only completed turns are counted,
  so a call killed by the timeout can have spent more than it reports.
- Codex is CLI-only today. You can run it from a checkout with the `bun` command in
  [cli.md](cli.md); you cannot select it from the reusable workflow's `provider` input.

## When the budget runs out

The engine does not stop the review early with an error. It posts what it has:

- A batch is **not started** when less than $0.05 is left. Its files are listed in the review as not
  reviewed, with the reason "not reached: the pull request's budget was spent", and the coverage table
  shows `not run: budget spent` for that batch.
- A batch whose call ended on its cap without a usable result has no review for its files. The
  engine retries it if at least $0.05 is left; otherwise the table shows
  `N file(s) left: budget spent`.
- If at least one batch produced a review, it is posted with a first line that begins
  "Partial review": how many files were reviewed, which were not, and the command to ask for the rest.
- If no batch produced a review and at least one call ran out of budget, the review is a short body
  saying so, with `/wachi review <path>` as the way to review part of the pull request. If nothing
  came back and no call ran out of budget, the run fails with "The agent did not return a review for
  any batch."

Because batches run riskiest first, the files left out are the ones the path heuristic ranks lowest.
That is a heuristic on file names. It does not mean they are safe.

To cover the rest, ask for those paths with `/wachi review <path> [path...]`. A scoped review is a new
run with a new budget, and it does not move the "reviewed up to here" marker, so it is not a way to
finish an incremental review. See [reviews.md](reviews.md). A partial review does not move the marker
either: the next unscoped `/wachi review` covers the changes since the last complete review again,
and spends again.

## Things that add to the total

- **Retries.** Described above: a second call, with its own cap, for files the first call missed.
- **Repeated runs.** A new `/wachi review` after a change, a pull request that leaves draft,
  and a scoped review on an unchanged head each start a full budget. A plain `/wachi review` on a head
  that already has a complete review stops with "Already reviewed" before any provider call.
- **Overlapping jobs.** The automatic job and the on-demand job use separate concurrency groups
  (`agent-review-<pr>` and `agent-review-on-demand-<pr>`), so one cannot cancel the other. If both are
  running, both spend. Within one job a newer run cancels the older one (`cancel-in-progress`). Cancellation
  before posting leaves no review; cancellation after posting may leave the review and some replies.
  Check the pull request before rerunning. Whether the provider bills the calls that were in flight
  at cancellation is not verified here.
- **Large single files.** A file bigger than a batch's line or character limit becomes a batch of its
  own and is not split. The limits are not a ceiling on how much the model reads, because it can read
  more of the head through its read tools.
- **Dry runs.** See below.

## Dry runs

`AGENT_REVIEW_DRY_RUN=1` reads GitHub and prints the review instead of posting it. It still calls the
agent, and the budgets above apply. It does not require the provider key: the Claude adapter uses
whatever login the machine has, and the Codex adapter uses the machine's own Codex login. Whether that
login bills an API account or a subscription depends on that login, not on Wachiman. The reusable
workflow has no dry-run input; the setting exists for the command line and the copy install.

## Reading the cost in a review

Every review ends with a line like this one (illustrative):

```
Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 4 batches · $1.87
```

- **The model label** is the model, the CLI that ran it and that CLI's version.
- **`effort high`** is the reasoning effort the run used. Releases up to v1.3.0 do not print it, so
  their footers read `... via Claude Code 2.1.304 · 4 batches · $1.87`.
- **`N batches`** appears only when the review used more than one batch.
- **The dollar figure** is the engine's `spent`: the sum of what each call reported, plus the cap for
  any call that failed without a result. It includes retries. It is formatted to two decimals, so
  a small cost can show as `$0.00`.
- An answer to a question ends with the model, the effort and the cost of its one call, with no batch count.

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
reusable workflow). If you need a hard ceiling, set a spend limit there; the provider's current
options are described in its own documentation, which this repository does not verify. Using a key
dedicated to Wachiman makes its spend easy to read and the key easy to revoke.

## Coverage is not the same as "every line was read"

"all N files reviewed" means the model listed those files as reviewed. It is the model's own report,
checked only to make sure no file with a diff was left unaccounted for. Nothing measures what it read
line by line.

N counts only the files the engine selected. Lockfiles, build output, generated files and anything
in `AGENT_REVIEW_EXCLUDE` are filtered out first and are not part of that count. See
[architecture.md](architecture.md) and [configuration.md](configuration.md).

## See also

- [Troubleshooting](troubleshooting.md), for a partial review or an unexpected cost
- [Security and trust](../SECURITY.md), for what holds the key
- [FAQ](faq.md)
