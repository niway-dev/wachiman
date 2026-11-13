# Configuration reference

Every setting Wachiman reads, where it comes from, what it defaults to and what it changes. For a
first install read [install.md](install.md) instead; this page is for looking things up.

This page describes the code on the `main` branch, which release v1.5.0 carries. Some settings
here are newer than v1.3.0, and each is marked with the release that added it. **New in v1.4.0:**
[reasoning effort](#reasoning-effort), the turn cap and call timeout, and `review_on_push`.
**New in v1.5.0:** the per-pull-request ceiling (`auto_budget_usd`), the thread-reply run
(`threads_budget_usd`) and the `AGENT_REVIEW_TRIGGER` variable. Everything else on this page is
the same in v1.3.0. If your caller pins a tag, check
`src/config.ts` and `.github/workflows/review.yml` at that tag. Wachiman is advisory: no setting
here makes a review approve, request changes or block a merge.

- [Where settings come from](#where-settings-come-from)
- [Reusable workflow](#reusable-workflow): [inputs](#inputs), [secret](#secret),
  [permissions](#permissions), [when each job runs](#when-each-job-runs)
- [Engine settings](#engine-settings) (`AGENT_REVIEW_*`), including [reasoning effort](#reasoning-effort) and the [turn cap and call timeout](#turn-cap-and-call-timeout)
- [Other environment variables](#other-environment-variables)
- [Mentions and commands](#mentions-and-commands)
- [Budgets](#budgets)
- [Batches and excluded files](#batches-and-excluded-files)
- [Providers and models](#providers-and-models)
- [Claude Code installer](#claude-code-installer)
- [Repository files](#repository-files)
- [Not configurable](#not-configurable)
- [Validation and errors](#validation-and-errors)

## Where settings come from

| Surface | Who sets it | What it controls |
| --- | --- | --- |
| Caller workflow: `with:` and `secrets:` | The repository that installs Wachiman | Everything the [reusable workflow](#reusable-workflow) accepts. The workflow turns the inputs into `AGENT_REVIEW_*` environment variables for the engine. |
| Environment variables | Whoever runs the CLI directly, or a copied install | The [engine settings](#engine-settings) and [other variables](#other-environment-variables). Three of them (`DRY_RUN`, `EXCLUDE`, `PRICE_PER_MTOK`) have no reusable-workflow input. |
| Files in the repository | The repository | What the reviewer is told to look for. They are not settings. See [Repository files](#repository-files). |

Rules that hold everywhere:

- Settings are read once, when the process starts. There is no configuration file (no YAML, no
  per-directory file) and no per-pull-request override.
- A pull request's title, body or comments cannot change a setting. The caller file can, and on
  `pull_request` events GitHub reads it from the pull request's own merge commit, so anyone who can
  push a branch to the repository can edit it. [SECURITY.md](../SECURITY.md) says what that implies.
- For each `AGENT_REVIEW_X` setting, the old name `CLAUDE_REVIEW_X` is used when the new name is
  unset or empty. See [Deprecated names](#deprecated-names).

## Reusable workflow

`.github/workflows/review.yml`, called from your caller file (the template is
[`templates/wachiman-review-caller.yml`](../templates/wachiman-review-caller.yml)). It has three jobs: an
automatic review (`review`), a thread-reply run started by the operator's reply in a review thread
(`threads`) and an on-demand run started by a comment (`on-demand`).

### Inputs

Only `operator` is required. Values you do not set take the default shown. Each input reaches the
engine through the environment variable in the third column; those variables are described under
[Engine settings](#engine-settings).

| Input | Type | Sent to | Default | What it changes |
| --- | --- | --- | --- | --- |
| `operator` | string, required | `AGENT_REVIEW_OPERATOR` | none | The one GitHub login whose comments can start an on-demand run. Both jobs fail early while it is empty or a template placeholder (`EDIT…`, `your-github-login`, compared case-insensitively, whitespace removed). This is true of the automatic job too, even though it never compares the operator to anyone. |
| `mention` | string | `AGENT_REVIEW_MENTION` | `/wachiman` | The command word the on-demand job listens for, next to `/wachiman`, `/wachi`, `@agent-review` and `@claude`, which always work. See [Mentions and commands](#mentions-and-commands). |
| `budget_usd` | number | `AGENT_REVIEW_BUDGET_USD` | `3` | Total for one review invocation, across all its batches and retries. Not a monthly or per-pull-request limit: that is `auto_budget_usd`. A pull request too big for one budget is finished over several runs: a partial review records the files it did not reach and the next push reviews them. See [Budgets](#budgets) and [Incremental reviews](cli.md#incremental-reviews). |
| `auto_budget_usd` | number | `AGENT_REVIEW_AUTO_BUDGET_USD` | `6` | The most **all automatic runs on one pull request** may spend together: the first review, push reviews and thread-reply runs ([ADR 0012](adr/0012-automatic-thread-replies-and-a-per-pr-ceiling.md)). **New in v1.5.0.** The engine sums it from the cost line of its own signed review footers marked automatic, so it needs no server. A run starts with at most what is left; at the ceiling it posts one notice and stops. The operator's `/wachiman review` is not limited by it. A number greater than 0. See [Budgets](#budgets). |
| `size_gate_usd` | number | `AGENT_REVIEW_SIZE_GATE_USD` | `6` | **New in the next release** ([ADR 0037](adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md)). A gate, not a budget. Above the estimated cost of the whole review the run posts no review and spends nothing, and one comment says what the review would cost and which `budget_usd` to set. Never below what the run may spend: the larger of this and `budget_usd` for `/wachiman review`, the larger of this and the smaller of `budget_usd` and `auto_budget_usd` for an automatic run. A finite number greater than 0; there is no unlimited value. See [the size gate](costs.md#the-size-gate). |
| `threads_budget_usd` | number | `AGENT_REVIEW_THREADS_BUDGET_USD` | `0.25` | The cap given to the one provider call of a thread-reply run. **New in v1.5.0.** The run also counts against `auto_budget_usd`. See [Thread replies](reviews.md#reply-to-a-finding). |
| `batch_budget_usd` | number | `AGENT_REVIEW_BATCH_BUDGET_USD` | `0.75` | The cap given to each provider call (a batch's first call and its retry each get one). |
| `answer_budget_usd` | number | `AGENT_REVIEW_ANSWER_BUDGET_USD` | `1` | The cap given to the one call that answers a question. Separate from `budget_usd`. |
| `ledger_url` | string | `AGENT_REVIEW_LEDGER_URL` | empty | Base URL of a spend ledger that keeps a daily and a weekly limit across repositories ([costs.md](costs.md#the-spend-limit)). Empty: no ledger call of any kind, no token request, nothing changes. Must start with `https://` (a usage error otherwise; `http://localhost` and `http://127.0.0.1` are allowed for tests), because the job's OIDC token is sent to it. Trailing slashes are dropped, and the token's audience is the result: it must equal the service's `LEDGER_AUDIENCE` exactly. Set it only when calling `review-platform.yml` with `id-token: write` ([install.md](install.md#optional-enroll-in-a-spend-ledger)); from `review.yml` the run stops and says so. |
| `daily_budget_usd` | number | `AGENT_REVIEW_DAILY_BUDGET_USD` | `0` | A stricter daily number for this repository, in USD, sent to the ledger with each run. It never raises the account's own limit. `0` means unset. Used only with `ledger_url`. |
| `weekly_budget_usd` | number | `AGENT_REVIEW_WEEKLY_BUDGET_USD` | `0` | The same, per week (weeks start on Monday, UTC). `0` means unset. Used only with `ledger_url`. |
| `limit_mode` | string | `AGENT_REVIEW_LIMIT_MODE` | `fail` | What a limit refusal does to the job, after the comment says which limit was reached: `fail` ends the job red with exit code 3, `notice` keeps it green. Not-linked, rejected-identity and missing-permission stops always exit 3. Used only with `ledger_url`. |
| `limit_bypass` | boolean | `AGENT_REVIEW_LIMIT_BYPASS` | `false` | Skip the ledger for this repository, at its own risk: no reservation, no record. The review footer says the limit was bypassed. |
| `ledger_unavailable` | string | `AGENT_REVIEW_LEDGER_UNAVAILABLE` | `run` | When the ledger cannot be reached (a network error, a timeout, a 5xx or a 429; any other unexpected answer is a wrong `ledger_url` and always stops the run): `run` reviews under the normal budgets, says the run was not counted and tries to record it afterwards; `stop` ends the run with exit code 3 before any model call. Not used for configuration errors, which always stop. |
| `askers` | string | `AGENT_REVIEW_ASKERS` | `operator` | Who may ask a question by comment: `operator` (only the operator) or `write` (also a collaborator with admin, maintain or write permission, which GitHub checks on each question). With `write` the thread and on-demand jobs also start for a collaborator's comment that starts with the command word. A collaborator's `review` is refused. See [Questions from collaborators](cli.md#questions-from-collaborators). |
| `ask_ceiling_usd` | number | `AGENT_REVIEW_ASK_CEILING_USD` | `3` | The most all questions from people other than the operator may spend on one pull request. The operator's questions are not limited. Used only with `askers: write`. |
| `batch_lines` | number | `AGENT_REVIEW_BATCH_LINES` | `1000` | Changed lines (additions plus deletions) per batch. A whole number. |
| `batch_chars` | number | `AGENT_REVIEW_BATCH_CHARS` | `140000` | Characters of diff per batch. A whole number. |
| `model` | string | `AGENT_REVIEW_MODEL` | `claude-sonnet-5-5` | The model name passed to the provider. The workflow always sends a value, so the engine's per-provider default never applies here. |
| `effort` | string | `AGENT_REVIEW_EFFORT` | `high` | Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max`. **New in v1.4.0; v1.3.0's workflow has no such input.** Sent to the engine by both jobs and used by both providers. See [Reasoning effort](#reasoning-effort). |
| `verify` | boolean | `AGENT_REVIEW_VERIFY` | `false` | After the batches, one more call tries to refute every finding above `info`; a finding is dropped only when the verifier names a disproof whose path and line exist at head, and one it cannot confirm is posted at `low` confidence. **New in v1.10.0, off by default since the 2026-11-10 configuration update; set `true` to enable verification.** ([ADR 0027](adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md)) Runs on automatic reviews and `/wachiman review`, not on thread replies. |
| `verify_budget_usd` | number | `AGENT_REVIEW_VERIFY_BUDGET_USD` | `1` | The verifier's reserve, taken out of `budget_usd` before the batches run, at most half of it. The verifier gets this plus whatever the batches did not spend. Counts against `auto_budget_usd` like any call. |
| `pr_confidence` | boolean | `AGENT_REVIEW_CONFIDENCE` | `false` | PR Confidence ([ADR 0033](adr/0033-a-fidelity-grade-the-engine-computes-from-checked-claims.md), [page](pr-confidence.md)): a full review of a pull request lists the claims in its title and body with one more small call, grades the change against them and writes the grade between two markers at the top of the description. On each push that starts a review run (`synchronize`, with `review_on_push` on and the pull request not a draft), a step that makes no model call first sets that block to `cannot say` for the commit under review. Needs the `pull-requests: write` permission the review job already has. Not used by `wachiman local`. Off by default. |
| `verifier_model` | string | `AGENT_REVIEW_VERIFIER_MODEL` | `claude-opus-5-5` | The verifier's model. It always runs at effort `high`, whatever `effort` says. |
| `max_turns` | number | `AGENT_REVIEW_MAX_TURNS` | `40` | Most agent turns one provider call may take. A whole number. **New in v1.4.0.** Sent as `--max-turns` to Claude Code, the only provider the workflow runs. A call that reaches the cap is reported and its files get one retry. See [Turn cap and call timeout](#turn-cap-and-call-timeout). |
| `call_timeout_s` | number | `AGENT_REVIEW_CALL_TIMEOUT_S` | `900` | Wall-clock seconds one provider call may run before the process is killed. A whole number. **New in v1.4.0.** Keep it well under the job's 30-minute limit. See [Turn cap and call timeout](#turn-cap-and-call-timeout). |
| `on_provider_unavailable` | string | `AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE` | `warn` | What a run does when the Anthropic account rejects every call (no credit or spend limit, a rejected key, a rate limit that persists after one retry). `warn` posts a "Not reviewed" notice with the provider's message and passes the check; `fail` posts it and fails the check, which blocks a merge only when branch rules require that check. Any other value is a usage error. Errors the engine cannot classify always fail. See [troubleshooting](troubleshooting.md). |
| `provider` | string | `AGENT_REVIEW_PROVIDER` | `claude-code` | Selects the adapter. The workflow installs only Claude Code and passes only `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, so `claude-code` is the only value that can work in it. Setting `codex` fails before any call (the default `model` has no Codex price, and the Codex binary and key are not provided). Codex is available from the CLI only: [providers/codex.md](providers/codex.md). |
| `claude_code_version` | string | installer `CLAUDE_CODE_VERSION` | `2.1.304` | The exact Claude Code version downloaded. See [Claude Code installer](#claude-code-installer). |
| `claude_code_sha256` | string | installer `CLAUDE_CODE_SHA256` | empty | SHA-256 of the Claude Code binary for the runner's platform (`linux-x64` on `ubuntu-latest`). Empty means the installer reads the expected hash from the publisher's manifest. |
| `bun_version` | string | `oven-sh/setup-bun` | `1.3.4` | The Bun version the engine runs on. Not an engine setting. CI in this repository pins Bun separately. |
| `skip_branch_prefixes` | string | the automatic job's first gate step | `release-please--` | Comma-separated head-branch prefixes whose pull requests the automatic job does not review. Spaces are removed; empty entries are ignored, so an empty value skips nothing. It has no effect on the on-demand job. |
| `review_on_push` | boolean | the automatic job's `if:` condition | `true` | Review each push (`synchronize`) to an open pull request, only the commits new since the last complete review ([ADR 0011](adr/0011-review-every-push-incrementally.md)). **New in v1.4.0.** It needs `synchronize` in the caller's `pull_request` types (the templates have it); the workflow cannot add a trigger. Each push can spend up to `budget_usd`. Set `false` to review only on open, ready for review and `/wachiman review`. It has no effect on the on-demand job or the thread-reply job. From v1.5.0 each push also counts against `auto_budget_usd`. See [reviews.md](reviews.md#reviews-on-push). |
| `push_debounce_seconds` | number | the wait step of the `review` job | `180` | Seconds a push (`synchronize`) sleeps before any model call. A newer push cancels this run through the job's concurrency group, so a burst of pushes whose gaps are shorter than the wait pays only for the last one. Cancellation prevents spend only while the earlier run is still waiting: a push that arrives after the sleep ended can cancel a run that already spent. `opened`, `ready_for_review`, the thread-reply job and the on-demand job never wait. `0` disables the wait. The wait counts toward the job's 30 minute limit and uses runner minutes. See [reviews.md](reviews.md#reviews-on-push). |

The copy-the-files template ([setup-copy.md](setup-copy.md)) has no inputs: its `review` job has the same wait step, driven by the workflow-level variable `AGENT_REVIEW_PUSH_DEBOUNCE_SECONDS` (default `180`, `0` disables). The engine does not read it.

Numeric inputs that the engine rejects (zero, negative, not a number, a fraction for `batch_lines`,
`batch_chars`, `max_turns` or `call_timeout_s`) fail the run with the message shown under
[Validation and errors](#validation-and-errors).

Defaults in `review.yml` and in `src/config.ts` are kept in sync by hand. Where they differ, the
workflow's value wins, because the workflow always passes its inputs.

### Secrets

| Secret | Required | Used for |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | one of the two | A Console API key. Passed to the engine, which gives it to Claude Code. It pays for the review, billed per token. |
| `CLAUDE_CODE_OAUTH_TOKEN` | one of the two | A token from `claude setup-token`. Passed to the engine, which gives it to Claude Code. The review runs on the Claude subscription of the person who made it. See [install.md](install.md#review-on-a-claude-subscription). |

These are the only two secrets the reusable workflow accepts, and neither is required by the
workflow itself: the engine fails before any call when it finds neither. The caller chooses by
which `secrets:` lines it passes; there is no input for it. If the token is present, the agent
gets the token and never the key, even when both are passed. A call the subscription refuses is
never retried with the key. On a subscription, the dollar figures the review shows are
API-price estimates, not charges, and the `wachiman-cost` line carries `"auth":"oauth-token"`.

The `GH_TOKEN` the engine uses is the run's own `github.token`; you do not pass it. There is no
input for a different token, an OpenAI key or a base URL.

### Permissions

Each job declares what it needs. GitHub does not let a reusable workflow have more than the
caller allows, so the caller's `permissions:` must grant at least this (the template grants
`contents: read, pull-requests: write, issues: read`). If the caller grants less, GitHub refuses
to run the job.

| Job | `contents` | `pull-requests` | `issues` |
| --- | --- | --- | --- |
| `review` (automatic) | read | write | not requested |
| `threads` (thread replies) | read | write | not requested |
| `on-demand` | read | write | read |

`review-platform.yml` is the same workflow with one more permission: each of its jobs also holds
`id-token: write`, which the engine uses to ask the spend ledger for a GitHub OIDC token. A caller
that uses it must grant `id-token: write` in its own job as well, because a called workflow cannot
hold a permission its caller did not grant. Callers of `review.yml` need nothing new. The file is
generated from `review.yml` by `scripts/generate-review-platform.ts`, and a test fails when the two
differ. See [install.md](install.md#optional-enroll-in-a-spend-ledger).

### When each job runs

| | `review` (automatic) | `threads` (thread replies) | `on-demand` |
| --- | --- | --- | --- |
| Event | `pull_request` | `pull_request_review_comment` (created) | `issue_comment` on a pull request |
| Runs when | The pull request is not a draft, its head is in the same repository (not a fork), and the actor is not `dependabot[bot]`. The caller's `on:` decides which activity types arrive; the templates list `opened`, `ready_for_review` and `synchronize`. For a `synchronize` (a push) the input `review_on_push` must also be `true`. | The comment is a reply (`in_reply_to_id` is set), its author's login equals `operator` and is not a bot, and the pull request's head is in the same repository. Anyone else's reply starts a job that GitHub shows as skipped, before any paid step. | The commenter's login equals `operator` and the comment body contains `mention`, `/wachi`, `@agent-review` or `@claude` (a substring check, see [Mentions and commands](#mentions-and-commands)). |
| Then the engine | Reviews, within `auto_budget_usd` for the pull request. | Exits without a model call unless the head was already reviewed; then answers every Wachiman thread that waits for an answer. Counts against `auto_budget_usd`. | Reviews or answers, never limited by `auto_budget_usd`. |
| Skips | A head branch starting with a `skip_branch_prefixes` entry. The job still starts and fails first if `operator` is invalid. | A fork pull request (by its `if:`). It has no draft, Dependabot or branch-prefix gate: a head that was never reviewed has nothing to answer, and the engine exits. | A fork pull request: the job stops with an error before reading the head. It has no draft, Dependabot or branch-prefix gate. |
| Checks `operator` | Only that it is set | That it is set, the login match above, and again in the engine | That it is set, and the login match above |
| Time limit | 30 minutes | 30 minutes | 30 minutes |
| Concurrency | One group per pull request; a new run cancels the earlier run of this job | One group per pull request, **never cancelling**: a reply must not cancel the review of a push. GitHub keeps one pending run per group, and a run answers every pending thread, so a dropped pending run loses nothing | One group per pull request; a new run cancels the earlier run of this job |

The three jobs use separate concurrency groups. A comment-started run does not cancel an automatic
review, and an automatic review does not cancel a comment-started run, so both can run at once on
the same pull request, each with its own budgets. A cancelled run posts nothing further, but calls
it had already made may have spent money; that spend is in no footer, so `auto_budget_usd` does not
count it.

The `threads` job exists only if the caller listens to `pull_request_review_comment: created`. The
templates do; a caller written earlier must add it ([upgrading.md](upgrading.md)).

## Engine settings

These are read by `loadConfig` in `src/config.ts`. The reusable workflow sets the ones with an
input; for the CLI you set them in the environment. The "Provider" column says where a setting
applies.

| Variable | Type | Default | Valid values | What it changes | Provider |
| --- | --- | --- | --- | --- | --- |
| `AGENT_REVIEW_OPERATOR` | string | empty | A GitHub login | Who may command the tool. Only `comment` uses it, and `comment` refuses to run (exit 1) while it is empty or a placeholder. `review` never checks it. | both |
| `AGENT_REVIEW_MENTION` | string | `/wachiman` | Any non-empty string | The command word `comment` looks for, in addition to `/wachiman`, `@agent-review` and `@claude`. An empty value counts as unset. | both |
| `AGENT_REVIEW_BUDGET_USD` | number | `3` | Finite, greater than 0 | Total for one `review` invocation. See [Budgets](#budgets). | both |
| `AGENT_REVIEW_AUTO_BUDGET_USD` | number | `6` | Finite, greater than 0 | Ceiling for all automatic runs on one pull request, summed from the engine's own signed review footers. **New in v1.5.0.** Applies only when `AGENT_REVIEW_TRIGGER` names an automatic run; `/wachiman review` (`comment`) ignores it. See [Budgets](#budgets). | both |
| `AGENT_REVIEW_SIZE_GATE_USD` | number | `6` | Finite, greater than 0 | The size gate ([ADR 0037](adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md)). **New in the next release.** In GitHub mode, a run whose estimated cost is above the gate posts one comment and no review, and spends nothing. In `local` it only prints a warning and the run continues. See [the size gate](costs.md#the-size-gate). | both |
| `AGENT_REVIEW_THREADS_BUDGET_USD` | number | `0.25` | Finite, greater than 0 | Cap for the one provider call of a `threads` run. **New in v1.5.0.** | same as the batch cap |
| `AGENT_REVIEW_TRIGGER` | string | unset | A lowercase event action: `opened`, `ready_for_review`, `synchronize`, `comment`, `thread`… | Why the run started. **New in v1.5.0.** `comment` is the operator's command and is never limited by the ceiling; any other value is an automatic run that is. Unset means a person ran the CLI by hand, which is not limited either. The workflow sets it (`github.event.action`, `comment`, `thread`); the `comment` and `threads` commands set it themselves, whatever the environment says. A value that is not a lowercase word is a usage error (exit 2). | both |
| `AGENT_REVIEW_BATCH_BUDGET_USD` | number | `0.75` | Finite, greater than 0 | Cap passed with each provider call in a review, limited by what is left of the total. | Claude: sent as `--max-budget-usd`, a soft cap. Codex: used for accounting only, never enforced. |
| `AGENT_REVIEW_ANSWER_BUDGET_USD` | number | `1` | Finite, greater than 0 | Cap for the one call that answers a `comment` question. | same as above |
| `AGENT_REVIEW_ASKERS` | string | `operator` | `operator` or `write` | Who may ask a question. `operator`: only the operator. `write`: also a collaborator whose GitHub permission is admin, maintain or write, checked on each question. Reviews stay operator-only. The reusable workflow sets it from the `askers` input; the copy template sets it at the top of its file. | both |
| `AGENT_REVIEW_ASK_CEILING_USD` | number | `3` | Finite, greater than 0 | The most the questions of everyone but the operator may spend on one pull request, summed from the answers' own cost footers. The operator's questions are not limited. Used only with `askers: write`. | both |
| `AGENT_REVIEW_BATCH_LINES` | integer | `1000` | Whole number, greater than 0 | Changed lines per batch. | both |
| `AGENT_REVIEW_BATCH_CHARS` | integer | `140000` | Whole number, greater than 0 | Diff characters per batch (the comment in the code equates this to about 40k tokens at 3.5 characters a token). It counts the diff only, not the whole prompt. | both |
| `AGENT_REVIEW_MODEL` | string | `claude-sonnet-5-5` for `claude-code`, `gpt-6.1-sol` for `codex` | Any string the provider accepts | The model name passed to the provider. Not validated by the engine; Codex additionally needs a known price. | both |
| `AGENT_REVIEW_PROVIDER` | string | `claude-code` | `claude-code`, `codex` | Which adapter runs the agent. Any other value is a usage error (exit 2) that lists the accepted ones. | n/a |
| `AGENT_REVIEW_PRICE_PER_MTOK` | string | unset | `input,cached_input,output[,cache_write]`: three or four numbers, each 0 or more | USD per million tokens, used to turn Codex's token counts into dollars. Without the fourth field, cache writes are priced at 2.5 times the input rate (see [costs.md](costs.md)). Takes precedence over the built-in price, also for a model that has one. | Codex only; ignored by Claude |
| `AGENT_REVIEW_EFFORT` | string | `high` | `low`, `medium`, `high`, `xhigh`, `max` | How hard the model reasons. Always passed explicitly, so a change in a provider CLI's own default cannot alter reviews. **New in v1.4.0.** Any other value is a usage error (exit 2). See [Reasoning effort](#reasoning-effort). | both |
| `AGENT_REVIEW_MAX_TURNS` | integer | `40` | Whole number, greater than 0 | Most agent turns one provider call may take. **New in v1.4.0.** Normal batches take 5–12 turns; the cap only stops a looping run. See [Turn cap and call timeout](#turn-cap-and-call-timeout). | Claude: sent as `--max-turns`. Codex: no such flag; ignored |
| `AGENT_REVIEW_CALL_TIMEOUT_S` | integer | `900` | Whole number, greater than 0 | Wall-clock seconds one provider call may run. Past it the process is killed (`SIGKILL`) and the call ends as `timeout`, with cost reported as 0 because the CLI prints nothing before it ends. **New in v1.4.0.** See [Turn cap and call timeout](#turn-cap-and-call-timeout). | both |
| `AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE` | string | `warn` | `warn`, `fail` | When every call is rejected for a reason on the reviewer's side (no credit, bad key, persistent rate limit): `warn` posts a notice and finishes green, `fail` posts it and throws. Any other value is a usage error (exit 2). | both |
| `AGENT_REVIEW_REASONING_EFFORT` | string | unset | same as `AGENT_REVIEW_EFFORT` | Deprecated name of `AGENT_REVIEW_EFFORT`. Still read, with a notice on stderr, and `AGENT_REVIEW_EFFORT` wins when both are set. See [Reasoning effort](#reasoning-effort). | both |
| `AGENT_REVIEW_VERIFY` | flag | off | `1`, `true`, `0`, `false` | The verifier call after the batches ([ADR 0027](adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md)). Any other value is a usage error (exit 2). `local --no-verify` turns it off for one run. **New in v1.10.0.** | both; with `codex` it needs `AGENT_REVIEW_VERIFIER_MODEL` |
| `AGENT_REVIEW_VERIFY_BUDGET_USD` | number | `1` | Finite, greater than 0 | The verifier's reserve out of `AGENT_REVIEW_BUDGET_USD`, at most half of it. | both |
| `AGENT_REVIEW_CONFIDENCE` | flag | off | `1`, `true`, `0`, `false` | PR Confidence: the claims call, the grade and the description block ([page](pr-confidence.md)). Any other value is a usage error (exit 2). | pull request reviews only |
| `AGENT_REVIEW_VERIFIER_MODEL` | string | `claude-opus-5-5` for `claude-code`, none for `codex` | Any string the provider accepts | The verifier's model; always at effort `high`. | both |
| `AGENT_REVIEW_DRY_RUN` | flag | off | `1` | Only the exact value `1` turns it on. Reads GitHub, runs the provider, and prints the review and replies instead of posting them. It still spends: see [Dry run](#dry-run). | both |
| `AGENT_REVIEW_FULL_REVIEW` | flag | off | `1` | Only with `AGENT_REVIEW_DRY_RUN=1` (alone it is a usage error, exit 2). The dry run reviews the whole pull request without reading the previous-review marker, as a first review would. See [Dry run](#dry-run). | both |
| `AGENT_REVIEW_EXCLUDE` | list | none | Comma-separated globs | Extra files to leave out, on top of the [built-in list](#excluded-files). | both |

How values are read:

- A set but empty variable counts as unset.
- Numbers are parsed with JavaScript's `Number()` and must be finite and greater than 0, so `1e3`
  is accepted. `BATCH_LINES`, `BATCH_CHARS`, `MAX_TURNS` and `CALL_TIMEOUT_S` must also be whole numbers.
- `AGENT_REVIEW_PRICE_PER_MTOK` is split on commas, each part trimmed and parsed the same way. A
  part that is empty after trimming is read as `0`, so `2,,10` means a cached-input price of 0.
- `AGENT_REVIEW_EXCLUDE` is split on commas and empty entries are dropped. Entries are not trimmed,
  so a space after a comma becomes part of the pattern and the pattern will not match.
- `AGENT_REVIEW_MODEL` falls back to the default of the selected provider only. An unrecognised
  provider also falls back to the Claude default for the model, then fails with the usage error.

### Reasoning effort

**New in v1.4.0.** In v1.3.0 the only related setting was `AGENT_REVIEW_REASONING_EFFORT`, which
only Codex used, which the engine did not check, and which left the model's own default when unset.
None of that holds from v1.4.0.

| | |
| --- | --- |
| Workflow input | `effort` (default `high`) |
| Environment variable | `AGENT_REVIEW_EFFORT` (default `high`) |
| Accepted values | `low`, `medium`, `high`, `xhigh`, `max` |
| Applies to | Both providers. Claude Code gets `--effort <value>`; Codex gets `-c model_reasoning_effort="<value>"`. |
| Where it is shown | The footer of every review and of every `comment` answer, as `effort <value>` ([cli.md](cli.md#what-it-posts)). |

How it is read:

- The effort is always explicit. Leaving it unset does not keep a model or CLI default: the engine
  uses `high` and passes it to the provider on every call.
- The value is passed as written, without translation. The engine only checks it against the five
  names above; whether the chosen model supports that level is up to the provider.
- A value outside the list is a usage error: the run stops before any call with
  `AGENT_REVIEW_EFFORT must be one of low, medium, high, xhigh, max, got "…".` and exit 2. There
  is no silent fallback to `high`. Case matters: `High` is rejected.
- A set but empty variable counts as unset, so an empty `effort` input means `high`.
- Claude Code accepts `--effort` from version 2.1.72 (per a comment in the adapter). The workflow's
  pinned `claude_code_version` is newer; if you run the CLI yourself, use at least that version.

The old variable, `AGENT_REVIEW_REASONING_EFFORT`, is deprecated:

- It is still read, and now for both providers, not only Codex.
- Whenever it is set and not empty, the engine writes
  `AGENT_REVIEW_REASONING_EFFORT is deprecated; use AGENT_REVIEW_EFFORT.` to stderr.
- `AGENT_REVIEW_EFFORT` takes precedence. When both are set, the new one is used and the old one
  is ignored, value included: an invalid old value does not fail a run whose new value is valid.
- When only the old one is set, its value is used and checked the same way. An invalid value is a
  usage error (exit 2) that names `AGENT_REVIEW_REASONING_EFFORT`.
- The `CLAUDE_REVIEW_` spelling of either name is also read (see
  [Deprecated names](#deprecated-names)). `CLAUDE_REVIEW_EFFORT` prints the usual notice;
  `CLAUDE_REVIEW_REASONING_EFFORT` prints the notice for the deprecated reasoning-effort name.
- The reusable workflow has no input for the old name; use `effort`.

### Turn cap and call timeout

Two limits stop one provider call that runs too long. Both are **new in
v1.4.0**; v1.3.0 has neither (its only hard limit was a fixed 15 minutes for Codex).

| | Turn cap | Call timeout |
| --- | --- | --- |
| Workflow input | `max_turns` (default `40`) | `call_timeout_s` (default `900`) |
| Environment variable | `AGENT_REVIEW_MAX_TURNS` | `AGENT_REVIEW_CALL_TIMEOUT_S` |
| Accepted values | A whole number greater than 0 | A whole number greater than 0 |
| Claude Code | Passed as `--max-turns`. A call that reaches it ends as `turns` and returns no review. | The process is ended with `SIGKILL` and the call ends as `timeout`. |
| Codex | Ignored: `codex exec` has no such flag. | Same limit and signal as Claude Code. |

- Normal batches take 5 to 12 turns; the turn cap only stops a looping run.
- A call that ends as `turns` has its files retried once, if at least $0.05 is left. A call that ends as `timeout` is not
  retried, and its cost is reported as 0 because the CLI prints nothing before it ends, so the
  money it spent is not in the review's total.
- Keep `call_timeout_s` well under the job's 30-minute limit: a job that reaches that limit is
  cancelled by GitHub.
- What a stopped call looks like in a review, and how to react, is in
  [costs.md](costs.md) and [troubleshooting.md](troubleshooting.md).

### Deprecated names

`CLAUDE_REVIEW_BUDGET_USD`, `CLAUDE_REVIEW_MODEL` and so on (the same suffix as each setting
above) still work. When the `AGENT_REVIEW_` name is unset or empty and the old name is set, the old
value is used and the engine writes `CLAUDE_REVIEW_X is deprecated; use AGENT_REVIEW_X.` to stderr.
The new name wins when both are set. This covers the settings in the table above only. The
variables under [Other environment variables](#other-environment-variables), including
`AGENT_REVIEW_COMMENT_AUTHOR`, have no old name. `AGENT_REVIEW_REASONING_EFFORT` is a different
kind of old name: see [Reasoning effort](#reasoning-effort).

### Dry run

`AGENT_REVIEW_DRY_RUN=1` is available from the CLI and in a copied install; the reusable workflow
has no input for it. It suppresses the writes to GitHub only. It still reads the pull request
through `gh` and still runs the provider, so it still spends money (or uses subscription quota,
since a dry run uses the machine's own provider login and does not need an API key). It is not an
offline mode.

A dry run of a pull request Wachiman already reviewed at its head prints "Already reviewed", and
after new commits it reviews only what changed. `AGENT_REVIEW_FULL_REVIEW=1` (with
`AGENT_REVIEW_DRY_RUN=1`) skips the previous-review marker, so the run is the full first review,
printed and not posted. To review a branch without GitHub at all, use
[`wachiman local`](local-review.md).

### Local mode

[`wachiman local`](local-review.md) reads the same environment, but only part of it applies.
A person runs it by hand, so it is never an automatic run, and it has no pull request, so nothing
GitHub-side applies.

- **Apply:** `AGENT_REVIEW_BUDGET_USD` (the whole run, counted in the API-equivalent estimate, $3
  by default), `AGENT_REVIEW_BATCH_BUDGET_USD`, `AGENT_REVIEW_BATCH_LINES`,
  `AGENT_REVIEW_BATCH_CHARS`, `AGENT_REVIEW_MODEL`, `AGENT_REVIEW_EFFORT`,
  `AGENT_REVIEW_MAX_TURNS`, `AGENT_REVIEW_CALL_TIMEOUT_S` and `AGENT_REVIEW_EXCLUDE`.
  Also `AGENT_REVIEW_HISTORY=1` (keep the [history](local-review.md#keep-a-history-of-your-runs-optional)
  of the run, the same as `--history`) and `AGENT_REVIEW_HISTORY_DAYS` (days to keep it, default 30,
  `0` forever, anything else exits 2 before any call). GitHub mode ignores both.
- **Apply as a warning only:** `AGENT_REVIEW_SIZE_GATE_USD`. Above it, `local` prints one line on
  stderr and continues; it never refuses or asks ([ADR 0037](adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md)).
  The money caps are `AGENT_REVIEW_BUDGET_USD` for the run and `AGENT_REVIEW_BATCH_BUDGET_USD` for
  each call.
- **Do not apply:** `AGENT_REVIEW_AUTO_BUDGET_USD` (no ceiling), `AGENT_REVIEW_THREADS_BUDGET_USD`,
  `AGENT_REVIEW_OPERATOR`, `AGENT_REVIEW_MENTION`, `AGENT_REVIEW_TRIGGER` (ignored: the run is a
  person's) and `AGENT_REVIEW_ON_PROVIDER_UNAVAILABLE` (a refused call is the `stop:` line of the
  report and the exit code).
- **Refused:** `AGENT_REVIEW_PROVIDER` other than `claude-code`, and `ANTHROPIC_API_KEY` set: both
  exit 2 before any call. `AGENT_REVIEW_DRY_RUN` changes nothing, since nothing is posted anyway;
  `AGENT_REVIEW_FULL_REVIEW` without a dry run is still a usage error.

## Other environment variables

Read directly, not through `loadConfig`.

| Variable | Needed by | Meaning |
| --- | --- | --- |
| `GH_TOKEN` | `review`, `comment` | Token the `gh` CLI uses. Must be set (exit 2 if not). The engine never passes it to the agent. In the workflow it is the run's `github.token`. |
| `GITHUB_REPOSITORY` | `review`, `comment` | `owner/name` of the repository. Must be set (exit 2 if not). |
| `REQUEST` | `comment` | The comment text. Must be set (exit 2 if not). The workflow passes it through the environment, never interpolated into a shell command. |
| `AGENT_REVIEW_COMMENT_AUTHOR` | `comment`, optional | Login of the comment's author. If set and different from the operator (compared case-insensitively), `comment` prints a notice and exits 0 without doing anything. If unset or empty, the engine does no author check of its own, so a caller that runs `comment` directly must restrict who can reach it. The workflow sets it from the event. |
| `ANTHROPIC_API_KEY` | Claude provider | Required unless `AGENT_REVIEW_DRY_RUN=1`, or unless `CLAUDE_CODE_OAUTH_TOKEN` is set. Checked before any paid call: with neither, `Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set` exits 1. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude provider | A non-empty value selects the subscription route and wins over `ANTHROPIC_API_KEY`: the agent gets the token and never the key. An empty value counts as unset. `local` and `ask` never read it. |
| `OPENAI_API_KEY` | Codex provider | Required unless `AGENT_REVIEW_DRY_RUN=1`; handed to Codex as `CODEX_API_KEY`. `OPENAI_API_KEY is not set` exits 1. |
| `CODEX_HOME`, `HOME` | Codex provider, dry run only | In a dry run, Codex uses `$CODEX_HOME`, else `$HOME/.codex`, as its login. Outside a dry run the adapter creates fresh directories. |

The agent does not inherit your environment. Each adapter passes an allowlist; see
[providers/claude-code.md](providers/claude-code.md) and [providers/codex.md](providers/codex.md).
Proxy and base-URL variables are deliberately not on those lists, so they cannot be used to
redirect the key; there is no configuration for routing provider traffic through a proxy.

The `gh` CLI and the provider's binary (`claude`, or `codex`) must be on the `PATH`. The engine runs
on Bun 1.3 or later (`package.json`).

## Mentions and commands

On-demand runs are triggered by a comment from the operator. Two pieces of code decide whether a
comment counts, and they accept the same words.

1. **The workflow's check** (the `on-demand` job's `if:`) decides whether a job starts at all. It
   requires the commenter's login to equal `operator` and the comment body to *contain* `mention`,
   `/wachi`, `@agent-review` or `@claude`. It is a substring check, and GitHub's expression
   `contains` ignores case, per GitHub's documentation. `/wachi` also matches `/wachiman`.
2. **The engine's parser** (`parseCommand` in `src/engine.ts`) decides what a started job does.
   It accepts `mention`, `/wachiman`, `/wachi`, `@agent-review` and `@claude`, case-sensitively, and
   only when the word stands alone (rules below).

So `/wachiman` is the documented command, and the other words are accepted only so a caller or a
habit from before [ADR 0023](adr/0023-one-name-for-every-surface-people-type.md) keeps working.
A custom `mention` such as `/reviewbot` works next to them; it does not replace them.

What each kind of comment does (illustrative comments from the operator on a pull request):

| Comment | Default mention (`/wachiman`) | Custom mention `/reviewbot` |
| --- | --- | --- |
| `/wachiman review` | Review | Review |
| `/wachi review` | Review | Review |
| `@claude review` | Review | Review |
| `/reviewbot review` | Job skipped | Review |
| `/Wachiman review` | Job starts, nothing happens (the check ignores case, the parser does not) | the same |
| `see docs/wachiman` | Job starts, nothing happens (substring match, but not a standalone word) | the same |

A job that starts and finds no command exits 0 without posting. It still installs Claude Code, so
it costs runner minutes but no model spend.

How the parser reads a comment, once the job has started:

- The command word must be a whole word. The character before it cannot be a letter, digit,
  underscore, `.`, `/`, `@` or `-`, and the character after it cannot be a letter, digit,
  underscore or `-`. So `docs/wachi` and `me@claude` are not commands, and `/wachi-review` is not
  either. Punctuation such as `/wachiman,` or `/wachiman:` still ends the word.
- The first match in the comment is used, on any line, and only the rest of that line is read.
  `/wachiman review` on line 3 works; text on later lines is not read as paths.
- If the first word after the command word is `review` (any case), the rest of the line is the
  scope: `review` or `review src docs/api`. Anything else, including a bare `/wachiman` or
  `/wachiman, review`, is a question, and the whole comment is sent to the answer call.
- The operator is checked again by the engine when `AGENT_REVIEW_COMMENT_AUTHOR` is set (see above).

### Scope words

Each word after `review` is compared with the pull request's changed files. A word matches a
file when it is the file's exact path or a directory prefix of it (`src` or `src/` matches
`src/a.ts`). There are no globs: `*.ts` matches nothing. Matching is case-sensitive.

- Words that match nothing (`again`, `please`, a typo) are ignored; the job log prints
  `Not paths in this pull request, ignored: …`.
- If at least one word matches, only the matching files are reviewed, from the whole pull
  request, ignoring the last-reviewed marker.
- If no word matches, the request behaves as if no path was given. **A mistyped path therefore
  does not fail.** On a head that was not reviewed yet it runs a normal unscoped review, which
  spends money on the whole pull request or on what changed since the last review. On a head that
  is already reviewed it posts `Already reviewed` and spends nothing. Check the spelling before
  relying on a scope to limit spend. This is today's behaviour; it has not been changed.
- A scoped review does not advance the incremental marker and does not change the list of files a
  partial review left unread. A path under an
  [excluded](#excluded-files) pattern is still excluded: there is no way to include it.

How to use these commands day to day is in [reviews.md](reviews.md).

## Budgets

There are five dollar settings and they bound different things. A sixth number, `size_gate_usd`, is
not one of them: it spends nothing and only decides whether a run starts (see the last row). Four of them are per invocation: one
automatic run, one comment, one thread-reply run, or one CLI call. A re-run, a second comment, or two
jobs at once each start from the full budget. The fifth, `auto_budget_usd`, adds the automatic runs
of one pull request together.

| Setting | Bounds |
| --- | --- |
| `budget_usd` / `AGENT_REVIEW_BUDGET_USD` | The sum of what one `review` invocation spends over all its calls, first calls and retries together. |
| `auto_budget_usd` / `AGENT_REVIEW_AUTO_BUDGET_USD` | What all **automatic** runs on one pull request spend together (the first review, push reviews, thread-reply runs), default $6: one full review (`budget_usd`, $3) plus room for push reviews. See below. |
| `batch_budget_usd` / `AGENT_REVIEW_BATCH_BUDGET_USD` | The cap handed to each single provider call. |
| `threads_budget_usd` / `AGENT_REVIEW_THREADS_BUDGET_USD` | The cap handed to the one call of a thread-reply run (default $0.25). |
| `answer_budget_usd` / `AGENT_REVIEW_ANSWER_BUDGET_USD` | The cap handed to the one call that answers a question. An answer does not touch `budget_usd`, and a review does not touch this. |
| `size_gate_usd` / `AGENT_REVIEW_SIZE_GATE_USD` | Not a budget: the estimated cost of the whole review above which a run posts no review and spends nothing, default $6 ([ADR 0037](adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md)). Never below the run budget. See [costs.md](costs.md#the-size-gate). |
| `ask_ceiling_usd` / `AGENT_REVIEW_ASK_CEILING_USD` | The most all questions from people other than the operator may spend on one pull request (default $3), summed from the answers' cost footers. See [Questions from collaborators](cli.md#questions-from-collaborators). |

### The ceiling per pull request

Before an automatic run plans its batches, the engine lists the pull request's reviews and its own
inline replies. It keeps those signed by this engine whose footer carries the automatic flag
(`<!-- wachi:auto -->`, written between the cost line and the signature) and adds up the dollar
amount on their cost line. Model text cannot forge either part: `<!--` is defused in everything a
model writes, and the footer is read only at the very end of the body.

- If `auto_budget_usd` minus that sum is less than $0.05 (a batch's minimum), the run posts one
  notice, "Automatic reviews paused: $X of $Y spent on this pull request. Comment `/wachiman review`
  to review now.", and starts no model call. A second notice for the same ceiling is not posted:
  later pushes post nothing. Raising `auto_budget_usd` lets the next push run.
- Otherwise the run's budget is the smaller of `budget_usd` (or `threads_budget_usd`) and what is
  left, so the pull request cannot go far past the ceiling (Claude's per-call cap is still soft).
- The first review counts. A large first review can use most of the default $2.
- `/wachiman review` and `/wachiman <question>` are not limited and not counted. A rebase or merge with
  no change in the pull request's lines is still posted at the ceiling: it costs nothing and moves
  the marker.
- **What is not counted.** A run cancelled by a newer push posts nothing, so its spend is in no
  footer. A thread-reply run whose replies were all dropped (its citations did not check out, or a
  push landed meanwhile) leaves its cost in the job log only. Footers show cents, so a very small
  cost rounds down. The ceiling is a guard rail on the engine's own accounting, not an invoice
  ([costs.md](costs.md)).

What one review does, in order:

1. Batches are processed one at a time, riskiest first.
2. Before each call, the engine computes what is left: `budget_usd` minus what the calls so far
   reported. If less than $0.05 is left, no more calls start. The remaining files are listed as not
   reviewed (`not run: budget spent`).
3. A call gets the smaller of `batch_budget_usd` and what is left.
4. **If a batch comes back with files unaccounted for, the engine makes one more call for those
   files**, again with the smaller of `batch_budget_usd` and what is left, as long as at least
   $0.05 remains. A batch can therefore cost up to two calls. This also happens when the first
   call failed or returned nothing: the retry then covers every file of the batch.
5. A call that threw without returning a result is counted at its cap, because what it spent is
   unknown.
6. The footer's cost is the engine's sum of the costs the provider reported for the review's
   calls. It is not an invoice.

Illustrative, with the defaults ($3 total, $0.75 a call): a review with five batches, each
using its full call, reaches $3.00 after four calls, so the fifth batch is not started. If the first
batch also needs a retry, that retry is a second $0.75 call, and the total is reached after three
batches. All of this is arithmetic on the settings, not a measurement of any real review.

What "cap" means depends on the provider:

- **Claude Code:** the call's cap is passed as `--max-budget-usd`, a soft, client-side limit. A
  call can overshoot it, so a review can spend more than `budget_usd`.
- **Codex:** the cap is never enforced. Cost is estimated from the token counts Codex reports,
  using the price table or `AGENT_REVIEW_PRICE_PER_MTOK`, and the only hard limit on a call is its
  run time (`AGENT_REVIEW_CALL_TIMEOUT_S`, 15 minutes by default, after which the process is
  killed). There is no turn cap. Budgets still decide how many calls
  start, but not how much one call spends.

Smaller edges:

- A total below $0.05 is accepted as a setting, but no call ever starts. The run ends with
  `The agent did not return a review for any batch.` and exit 1.
- If no batch produced any output and at least one batch's first call hit its cap, the engine posts
  a short review saying nothing was reviewed reliably, with a hint to review by path, and exits 0.
- If some batches produced output, the review is posted with partial coverage and exit 0.

Why this is not a hard dollar ceiling, what concurrent and cancelled runs cost, and what the
coverage line establishes: [costs.md](costs.md).

## Batches and excluded files

### Batches

Selected files are grouped into modules by path prefix, modules are ordered by risk (a heuristic
from file paths: workflows, credentials-like names, schema and migrations score high; docs and
styles low) and then packed into batches in that order. Each batch is one provider call. A new
batch starts when adding the next file would pass `batch_lines` (additions plus deletions) or
`batch_chars` (diff text). A single file larger than either limit becomes a batch of its own and is
not split, so a batch can exceed both limits. Neither limit is a ceiling on prompt size. The
ordering and its limits are described in [architecture.md](architecture.md).

### Excluded files

Excluded files are never sent to the agent and are not part of the "expected" files the coverage
line counts. A review that says all files were reviewed means all files that were not excluded.

Built-in patterns (`DEFAULT_EXCLUDE` in `src/engine.ts`):

```text
**/bun.lock   **/package-lock.json   **/yarn.lock   **/pnpm-lock.yaml   **/*.lock
**/dist/**    **/build/**            **/out/**
**/*.min.js   **/*.map               **/*.snap       **/*.generated.*
**/worker-configuration.d.ts
```

`AGENT_REVIEW_EXCLUDE` adds to this list; it cannot remove or override a built-in pattern. Patterns
are matched with `Bun.Glob` against each changed file's repository-relative path. Write them the
way the built-ins are written: `*.md` does not match `docs/a.md`, `**/*.md` matches at any depth.
The reusable workflow has no input for `AGENT_REVIEW_EXCLUDE`.

When everything that changed is excluded or outside the requested scope, the run posts
`Nothing to review at <sha>: …` and exits 0.

## Providers and models

| | Claude Code (`claude-code`) | Codex (`codex`) |
| --- | --- | --- |
| Where it runs | Reusable workflow and CLI | CLI only. The workflow installs neither Codex nor an OpenAI key. |
| Default model | `claude-sonnet-5-5` | `gpt-6.1-sol` |
| Credential | `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` (a Claude subscription) | `OPENAI_API_KEY` |
| Binary on `PATH` | `claude` (the workflow installs a pinned version) | `codex` |
| Cost | Reported by Claude Code | Estimated from tokens at a per-million-token price |
| Price needed | No | Yes. Built in for `gpt-6.1-sol` and `gpt-6-sol` ($2 input, $0.10 cached input, $10 output, $5 cache write); any other model needs `AGENT_REVIEW_PRICE_PER_MTOK`, or the run stops in preflight. These are constants in the code, not a current price quote: check the vendor's pricing page. |
| Dollar cap on a call | Soft | None; 15-minute time limit |
| `PRICE_PER_MTOK` | Ignored | Used |
| `EFFORT` (new in v1.4.0) | Passed as `--effort` | Passed as `model_reasoning_effort` |
| Dry run login | The machine's own Claude login | The machine's own Codex login (`$CODEX_HOME` or `~/.codex`) |

Before any paid call, the CLI runs the provider's preflight and exits 1 if the binary does not
answer `--version`, the credential is missing (outside a dry run), the Claude settings file is
missing, or the Codex model has no known price. Details of what each adapter allows the agent to
read or run: [providers/claude-code.md](providers/claude-code.md) and
[providers/codex.md](providers/codex.md).

## Claude Code installer

`src/install-claude-code.sh` downloads one Claude Code release and verifies its checksum. The
reusable workflow runs it with the two inputs below and an install directory under the runner's
temporary directory. You can also run it yourself.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_CODE_VERSION` | none, required | An exact version such as `2.1.304`. A range, a tag name or an empty value is refused. In the workflow: input `claude_code_version`. |
| `CLAUDE_CODE_SHA256` | empty | 64 lowercase hexadecimal characters. If set, the download must match it. If empty, the installer reads the expected hash from the publisher's manifest for your platform, which proves the download matches what the publisher lists, not that the publisher is uncompromised. In the workflow: input `claude_code_sha256`. |
| `CLAUDE_INSTALL_DIR` | `$HOME/.local/bin` | Where `claude` is installed. The workflow sets it to a directory under the runner's temporary directory and adds it to `PATH`. |

The installer supports Linux and macOS on x64 and arm64 (and the musl variants of Linux). It needs
`curl`, and `jq` when no checksum is given. It exits 1 with a message for an invalid version or
checksum, an unsupported platform, a manifest without your platform, or a checksum mismatch.

## Repository files

The engine reads these from the pull request's base commit, never from its head, through the
GitHub contents API. A pull request cannot change the instructions it is reviewed under; one that
edits them is reviewed under the base version and the review says the change applies after merge.

| File | Meaning |
| --- | --- |
| `.github/wachiman.md` | The repository's review focus. Optional. |
| `.github/agent-review.md`, `.github/claude-review.md` | The old names of the focus file, newest first. The first one found is read only when `.github/wachiman.md` does not exist at the base commit, with a deprecation notice on stderr. |
| `CLAUDE.md`, `AGENTS.md` | Read from the repository root only, if present. |

Each file is cut at 64 KiB (the agent is told the file was cut). A file over the contents API's
size limit arrives with no content and is treated as cut. A missing file (404) is fine; any other
GitHub error stops the review. These files can say what to look for. They cannot add severities or
topics ([cli.md](cli.md#finding-labels)), change a budget, or turn off a check. How to write them:
[review-policy.md](review-policy.md).

## Not configurable

Each of these is a fixed behaviour of the engine at this release:

- A configuration file of any kind (YAML or otherwise).
- A way to include a file that matches a built-in exclude pattern.
- File risk scores and the order they produce.
- The set of severities and topics.
- The posted review event, which is always `COMMENT`.
- A provider plugin system. The two adapters are built in.
- Routing provider calls through a proxy or a different base URL.

## Validation and errors

| Message or symptom | Cause | Exit |
| --- | --- | --- |
| `AGENT_REVIEW_X must be a positive number, got "…".` (or `positive integer`) | A numeric setting is zero, negative, not finite, or (for lines and chars) not whole. | 2 |
| `AGENT_REVIEW_TRIGGER must be a lowercase event action such as synchronize, got "…".` | The trigger has capitals, digits, spaces or punctuation. | 2 |
| `AGENT_REVIEW_EFFORT must be one of low, medium, high, xhigh, max, got "…".` | The effort (new in v1.4.0) is not one of the five names. With only the deprecated variable set, the message names `AGENT_REVIEW_REASONING_EFFORT`. | 2 |
| `Unknown provider "…". Accepted values: claude-code, codex.` | `AGENT_REVIEW_PROVIDER` is something else. | 2 |
| `GH_TOKEN is not set`, `GITHUB_REPOSITORY is not set`, `REQUEST is not set` | A required variable is missing or empty. | 2 |
| `--repo-dir … is not a directory.` | The directory does not exist. | 2 |
| `AGENT_REVIEW_PRICE_PER_MTOK must be "input,cached_input,output[,cache_write]" in USD per million tokens, got "…".` | The price is not three or four comma-separated numbers of 0 or more. Raised as an ordinary error, not a usage error. | 1 |
| `Neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set` / `OPENAI_API_KEY is not set` | Missing credential outside a dry run. | 1 |
| `The Claude Code binary "claude" did not run (--version)` / `The Codex binary "codex" did not run (--version)` | The binary is missing or broken. | 1 |
| `No price is known for model "…"` | Codex model without a built-in price and without `AGENT_REVIEW_PRICE_PER_MTOK`. | 1 |
| `The operator login is empty.` / `…is still the template placeholder "…".` | `comment` ran with an empty or placeholder operator. | 1 |
| Workflow annotation `operator is not set` | The `operator` input is empty or a placeholder. | job fails |

The full list of exit codes, including ones that can follow a posted review, is in
[cli.md](cli.md#exit-codes). Symptom-by-symptom recovery is in
[troubleshooting.md](troubleshooting.md).
