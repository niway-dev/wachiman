# Configuration reference

Every setting Wachiman reads, where it comes from, what it defaults to and what it changes. For a
first install read [install.md](install.md) instead; this page is for looking things up.

This page describes the code on the `main` branch. The latest release is v1.3.0, and one setting
here is newer than it: [reasoning effort](#reasoning-effort), marked **new in the release after
v1.3.0**. Everything else on this page is the same in v1.3.0. If your caller pins a tag, check
`src/config.ts` and `.github/workflows/review.yml` at that tag. Wachiman is advisory: no setting
here makes a review approve, request changes or block a merge.

- [Where settings come from](#where-settings-come-from)
- [Reusable workflow](#reusable-workflow): [inputs](#inputs), [secret](#secret),
  [permissions](#permissions), [when each job runs](#when-each-job-runs)
- [Engine settings](#engine-settings) (`AGENT_REVIEW_*`), including [reasoning effort](#reasoning-effort)
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
[`templates/agent-review-caller.yml`](../templates/agent-review-caller.yml)). It has two jobs: an
automatic review (`review`) and an on-demand run started by a comment (`on-demand`).

### Inputs

Only `operator` is required. Values you do not set take the default shown. Each input reaches the
engine through the environment variable in the third column; those variables are described under
[Engine settings](#engine-settings).

| Input | Type | Sent to | Default | What it changes |
| --- | --- | --- | --- | --- |
| `operator` | string, required | `AGENT_REVIEW_OPERATOR` | none | The one GitHub login whose comments can start an on-demand run. Both jobs fail early while it is empty or a template placeholder (`EDIT…`, `your-github-login`, compared case-insensitively, whitespace removed). This is true of the automatic job too, even though it never compares the operator to anyone. |
| `mention` | string | `AGENT_REVIEW_MENTION` | `/wachi` | The command word the on-demand job listens for. See [Mentions and commands](#mentions-and-commands): the workflow's check and the engine's parser accept different sets of words. |
| `budget_usd` | number | `AGENT_REVIEW_BUDGET_USD` | `3` | Total for one review invocation, across all its batches and retries. Not a monthly or per-pull-request limit. See [Budgets](#budgets). |
| `batch_budget_usd` | number | `AGENT_REVIEW_BATCH_BUDGET_USD` | `0.75` | The cap given to each provider call (a batch's first call and its retry each get one). |
| `answer_budget_usd` | number | `AGENT_REVIEW_ANSWER_BUDGET_USD` | `1` | The cap given to the one call that answers a question. Separate from `budget_usd`. |
| `batch_lines` | number | `AGENT_REVIEW_BATCH_LINES` | `1000` | Changed lines (additions plus deletions) per batch. A whole number. |
| `batch_chars` | number | `AGENT_REVIEW_BATCH_CHARS` | `140000` | Characters of diff per batch. A whole number. |
| `model` | string | `AGENT_REVIEW_MODEL` | `claude-sonnet-5-5` | The model name passed to the provider. The workflow always sends a value, so the engine's per-provider default never applies here. |
| `effort` | string | `AGENT_REVIEW_EFFORT` | `high` | Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max`. **New in the release after v1.3.0; not in v1.3.0, whose workflow has no such input.** Sent to the engine by both jobs and used by both providers. See [Reasoning effort](#reasoning-effort). |
| `provider` | string | `AGENT_REVIEW_PROVIDER` | `claude-code` | Selects the adapter. The workflow installs only Claude Code and passes only `ANTHROPIC_API_KEY`, so `claude-code` is the only value that can work in it. Setting `codex` fails before any call (the default `model` has no Codex price, and the Codex binary and key are not provided). Codex is available from the CLI only: [providers/codex.md](providers/codex.md). |
| `claude_code_version` | string | installer `CLAUDE_CODE_VERSION` | `2.1.304` | The exact Claude Code version downloaded. See [Claude Code installer](#claude-code-installer). |
| `claude_code_sha256` | string | installer `CLAUDE_CODE_SHA256` | empty | SHA-256 of the Claude Code binary for the runner's platform (`linux-x64` on `ubuntu-latest`). Empty means the installer reads the expected hash from the publisher's manifest. |
| `bun_version` | string | `oven-sh/setup-bun` | `1.3.4` | The Bun version the engine runs on. Not an engine setting. CI in this repository pins Bun separately. |
| `skip_branch_prefixes` | string | the automatic job's first gate step | `release-please--` | Comma-separated head-branch prefixes whose pull requests the automatic job does not review. Spaces are removed; empty entries are ignored, so an empty value skips nothing. It has no effect on the on-demand job. |

Numeric inputs that the engine rejects (zero, negative, not a number, a fraction for `batch_lines`
or `batch_chars`) fail the run with the message shown under
[Validation and errors](#validation-and-errors).

Defaults in `review.yml` and in `src/config.ts` are kept in sync by hand. Where they differ, the
workflow's value wins, because the workflow always passes its inputs.

### Secret

| Secret | Required | Used for |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | The only secret the reusable workflow accepts. Passed to the engine, which gives it to Claude Code. It pays for the review. |

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
| `on-demand` | read | write | read |

### When each job runs

| | `review` (automatic) | `on-demand` |
| --- | --- | --- |
| Event | `pull_request` | `issue_comment` on a pull request |
| Runs when | The pull request is not a draft, its head is in the same repository (not a fork), and the actor is not `dependabot[bot]`. The caller's `on:` decides which activity types arrive; the template lists `opened` and `ready_for_review`. | The commenter's login equals `operator` and the comment body contains `mention`, `@agent-review` or `@claude` (a substring check, see [Mentions and commands](#mentions-and-commands)). |
| Skips | A head branch starting with a `skip_branch_prefixes` entry. The job still starts and fails first if `operator` is invalid. | A fork pull request: the job stops with an error before reading the head. It has no draft, Dependabot or branch-prefix gate. |
| Checks `operator` | Only that it is set | That it is set, and the login match above |
| Time limit | 30 minutes | 30 minutes |
| Concurrency | One group per pull request; a new run cancels the earlier run of this job | One group per pull request; a new run cancels the earlier run of this job |

The two jobs use separate concurrency groups. A comment-started run does not cancel an automatic
review, and an automatic review does not cancel a comment-started run, so both can run at once on
the same pull request, each with its own budgets. A cancelled run posts nothing further, but calls
it had already made may have spent money.

## Engine settings

These are read by `loadConfig` in `src/config.ts`. The reusable workflow sets the ones with an
input; for the CLI you set them in the environment. The "Provider" column says where a setting
applies.

| Variable | Type | Default | Valid values | What it changes | Provider |
| --- | --- | --- | --- | --- | --- |
| `AGENT_REVIEW_OPERATOR` | string | empty | A GitHub login | Who may command the tool. Only `comment` uses it, and `comment` refuses to run (exit 1) while it is empty or a placeholder. `review` never checks it. | both |
| `AGENT_REVIEW_MENTION` | string | `/wachi` | Any non-empty string | The command word `comment` looks for, in addition to `/wachiman`, `@agent-review` and `@claude`. An empty value counts as unset. | both |
| `AGENT_REVIEW_BUDGET_USD` | number | `3` | Finite, greater than 0 | Total for one `review` invocation. See [Budgets](#budgets). | both |
| `AGENT_REVIEW_BATCH_BUDGET_USD` | number | `0.75` | Finite, greater than 0 | Cap passed with each provider call in a review, limited by what is left of the total. | Claude: sent as `--max-budget-usd`, a soft cap. Codex: used for accounting only, never enforced. |
| `AGENT_REVIEW_ANSWER_BUDGET_USD` | number | `1` | Finite, greater than 0 | Cap for the one call that answers a `comment` question. | same as above |
| `AGENT_REVIEW_BATCH_LINES` | integer | `1000` | Whole number, greater than 0 | Changed lines per batch. | both |
| `AGENT_REVIEW_BATCH_CHARS` | integer | `140000` | Whole number, greater than 0 | Diff characters per batch (the comment in the code equates this to about 40k tokens at 3.5 characters a token). It counts the diff only, not the whole prompt. | both |
| `AGENT_REVIEW_MODEL` | string | `claude-sonnet-5-5` for `claude-code`, `gpt-6.1-sol` for `codex` | Any string the provider accepts | The model name passed to the provider. Not validated by the engine; Codex additionally needs a known price. | both |
| `AGENT_REVIEW_PROVIDER` | string | `claude-code` | `claude-code`, `codex` | Which adapter runs the agent. Any other value is a usage error (exit 2) that lists the accepted ones. | n/a |
| `AGENT_REVIEW_PRICE_PER_MTOK` | string | unset | `input,cached_input,output`: three numbers, each 0 or more | USD per million tokens, used to turn Codex's token counts into dollars. Takes precedence over the built-in price, also for a model that has one. | Codex only; ignored by Claude |
| `AGENT_REVIEW_EFFORT` | string | `high` | `low`, `medium`, `high`, `xhigh`, `max` | How hard the model reasons. Always passed explicitly, so a change in a provider CLI's own default cannot alter reviews. **New in the release after v1.3.0.** Any other value is a usage error (exit 2). See [Reasoning effort](#reasoning-effort). | both |
| `AGENT_REVIEW_REASONING_EFFORT` | string | unset | same as `AGENT_REVIEW_EFFORT` | Deprecated name of `AGENT_REVIEW_EFFORT`. Still read, with a notice on stderr, and `AGENT_REVIEW_EFFORT` wins when both are set. See [Reasoning effort](#reasoning-effort). | both |
| `AGENT_REVIEW_DRY_RUN` | flag | off | `1` | Only the exact value `1` turns it on. Reads GitHub, runs the provider, and prints the review and replies instead of posting them. It still spends: see [Dry run](#dry-run). | both |
| `AGENT_REVIEW_EXCLUDE` | list | none | Comma-separated globs | Extra files to leave out, on top of the [built-in list](#excluded-files). | both |

How values are read:

- A set but empty variable counts as unset.
- Numbers are parsed with JavaScript's `Number()` and must be finite and greater than 0, so `1e3`
  is accepted. `BATCH_LINES` and `BATCH_CHARS` must also be whole numbers.
- `AGENT_REVIEW_PRICE_PER_MTOK` is split on commas, each part trimmed and parsed the same way. A
  part that is empty after trimming is read as `0`, so `2,,10` means a cached-input price of 0.
- `AGENT_REVIEW_EXCLUDE` is split on commas and empty entries are dropped. Entries are not trimmed,
  so a space after a comma becomes part of the pattern and the pattern will not match.
- `AGENT_REVIEW_MODEL` falls back to the default of the selected provider only. An unrecognised
  provider also falls back to the Claude default for the model, then fails with the usage error.

### Reasoning effort

**New in the release after v1.3.0.** It is on `main` and is not in v1.3.0, the latest release. In
v1.3.0 the only related setting was `AGENT_REVIEW_REASONING_EFFORT`, which only Codex used, which
the engine did not check, and which left the model's own default when unset. None of that holds on
`main`.

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

## Other environment variables

Read directly, not through `loadConfig`.

| Variable | Needed by | Meaning |
| --- | --- | --- |
| `GH_TOKEN` | `review`, `comment` | Token the `gh` CLI uses. Must be set (exit 2 if not). The engine never passes it to the agent. In the workflow it is the run's `github.token`. |
| `GITHUB_REPOSITORY` | `review`, `comment` | `owner/name` of the repository. Must be set (exit 2 if not). |
| `REQUEST` | `comment` | The comment text. Must be set (exit 2 if not). The workflow passes it through the environment, never interpolated into a shell command. |
| `AGENT_REVIEW_COMMENT_AUTHOR` | `comment`, optional | Login of the comment's author. If set and different from the operator (compared case-insensitively), `comment` prints a notice and exits 0 without doing anything. If unset or empty, the engine does no author check of its own, so a caller that runs `comment` directly must restrict who can reach it. The workflow sets it from the event. |
| `ANTHROPIC_API_KEY` | Claude provider | Required unless `AGENT_REVIEW_DRY_RUN=1`. Checked before any paid call: `ANTHROPIC_API_KEY is not set` exits 1. |
| `OPENAI_API_KEY` | Codex provider | Required unless `AGENT_REVIEW_DRY_RUN=1`; handed to Codex as `CODEX_API_KEY`. `OPENAI_API_KEY is not set` exits 1. |
| `CODEX_HOME`, `HOME` | Codex provider, dry run only | In a dry run, Codex uses `$CODEX_HOME`, else `$HOME/.codex`, as its login. Outside a dry run the adapter creates fresh directories. |

The agent does not inherit your environment. Each adapter passes an allowlist; see
[providers/claude-code.md](providers/claude-code.md) and [providers/codex.md](providers/codex.md).
Proxy and base-URL variables are deliberately not on those lists, so they cannot be used to
redirect the key; there is no configuration for routing provider traffic through a proxy.

The `gh` CLI and the provider's binary (`claude`, or `codex`) must be on the `PATH`. The engine runs
on Bun 1.3 or later (`package.json`).

## Mentions and commands

On-demand runs are triggered by a comment from the operator. Two separate pieces of code decide
whether a comment counts, and for custom mentions they do not agree.

1. **The workflow's check** (the `on-demand` job's `if:`) decides whether a job starts at all. It
   requires the commenter's login to equal `operator` and the comment body to *contain* `mention`,
   `@agent-review` or `@claude`. It is a substring check, and GitHub's expression `contains`
   ignores case, per GitHub's documentation.
2. **The engine's parser** (`parseCommand` in `src/engine.ts`) decides what a started job does.
   It accepts `mention`, `/wachiman`, `@agent-review` and `@claude`, case-sensitively, and only
   when the word stands alone (rules below).

`/wachiman` is in the parser's list but not in the workflow's. With the default mention `/wachi`
it still works, because `/wachi` is a substring of `/wachiman` and the check passes. With a custom
mention that is not a substring of `/wachiman`, a comment containing only `/wachiman` never starts
a job. With a custom mention, use that mention. This is a known inconsistency, not a promise that
`/wachiman` works.

What each kind of comment does (illustrative comments from the operator on a pull request):

| Comment | Default mention (`/wachi`) | Custom mention `/reviewbot` |
| --- | --- | --- |
| `/wachi review` | Review | Job skipped |
| `/wachiman review` | Review | Job skipped (the parser would accept it, but the job never starts) |
| `@claude review` | Review | Review |
| `/reviewbot review` | Job skipped | Review |
| `/Wachi review` | Job starts, nothing happens (the check ignores case, the parser does not) | `/Reviewbot review`: the same |
| `see docs/wachi` | Job starts, nothing happens (substring match, but not a standalone word) | n/a |

A job that starts and finds no command exits 0 without posting. It still installs Claude Code, so
it costs runner minutes but no model spend.

How the parser reads a comment, once the job has started:

- The command word must be a whole word. The character before it cannot be a letter, digit,
  underscore, `.`, `/`, `@` or `-`, and the character after it cannot be a letter, digit,
  underscore or `-`. So `docs/wachi` and `me@claude` are not commands, and `/wachi-review` is not
  either. Punctuation such as `/wachi,` or `/wachi:` still ends the word.
- The first match in the comment is used, on any line, and only the rest of that line is read.
  `/wachi review` on line 3 works; text on later lines is not read as paths.
- If the first word after the command word is `review` (any case), the rest of the line is the
  scope: `review` or `review src docs/api`. Anything else, including a bare `/wachi` or
  `/wachi, review`, is a question, and the whole comment is sent to the answer call.
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
- A scoped review does not advance the incremental marker. A path under an
  [excluded](#excluded-files) pattern is still excluded: there is no way to include it.

How to use these commands day to day is in [reviews.md](reviews.md).

## Budgets

There are three dollar settings and they bound different things. All of them are per invocation: one
automatic run, one comment, or one CLI call. Nothing adds up across invocations, days or pull
requests. A re-run, a second comment, or two jobs at once each start from the full budget.

| Setting | Bounds |
| --- | --- |
| `budget_usd` / `AGENT_REVIEW_BUDGET_USD` | The sum of what one `review` invocation spends over all its calls, first calls and retries together. |
| `batch_budget_usd` / `AGENT_REVIEW_BATCH_BUDGET_USD` | The cap handed to each single provider call. |
| `answer_budget_usd` / `AGENT_REVIEW_ANSWER_BUDGET_USD` | The cap handed to the one call that answers a question. An answer does not touch `budget_usd`, and a review does not touch this. |

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
  using the price table or `AGENT_REVIEW_PRICE_PER_MTOK`, and the only hard limit on a call is
  15 minutes of run time, after which the process is killed. Budgets still decide how many calls
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
| Credential | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` |
| Binary on `PATH` | `claude` (the workflow installs a pinned version) | `codex` |
| Cost | Reported by Claude Code | Estimated from tokens at a per-million-token price |
| Price needed | No | Yes. Built in for `gpt-6.1-sol` and `gpt-6-sol` ($2 input, $0.10 cached input, $10 output); any other model needs `AGENT_REVIEW_PRICE_PER_MTOK`, or the run stops in preflight. These are constants in the code, not a current price quote: check the vendor's pricing page. |
| Dollar cap on a call | Soft | None; 15-minute time limit |
| `PRICE_PER_MTOK` | Ignored | Used |
| `EFFORT` (new after v1.3.0) | Passed as `--effort` | Passed as `model_reasoning_effort` |
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
| `.github/agent-review.md` | The repository's review focus. Optional. |
| `.github/claude-review.md` | The old name of the focus file. Read only when `.github/agent-review.md` does not exist at the base commit, with a deprecation notice on stderr. |
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
| `AGENT_REVIEW_EFFORT must be one of low, medium, high, xhigh, max, got "…".` | The effort (new after v1.3.0) is not one of the five names. With only the deprecated variable set, the message names `AGENT_REVIEW_REASONING_EFFORT`. | 2 |
| `Unknown provider "…". Accepted values: claude-code, codex.` | `AGENT_REVIEW_PROVIDER` is something else. | 2 |
| `GH_TOKEN is not set`, `GITHUB_REPOSITORY is not set`, `REQUEST is not set` | A required variable is missing or empty. | 2 |
| `--repo-dir … is not a directory.` | The directory does not exist. | 2 |
| `AGENT_REVIEW_PRICE_PER_MTOK must be "input,cached_input,output" in USD per million tokens, got "…".` | The price is not exactly three comma-separated numbers of 0 or more. Raised as an ordinary error, not a usage error. | 1 |
| `ANTHROPIC_API_KEY is not set` / `OPENAI_API_KEY is not set` | Missing credential outside a dry run. | 1 |
| `The Claude Code binary "claude" did not run (--version)` / `The Codex binary "codex" did not run (--version)` | The binary is missing or broken. | 1 |
| `No price is known for model "…"` | Codex model without a built-in price and without `AGENT_REVIEW_PRICE_PER_MTOK`. | 1 |
| `The operator login is empty.` / `…is still the template placeholder "…".` | `comment` ran with an empty or placeholder operator. | 1 |
| Workflow annotation `operator is not set` | The `operator` input is empty or a placeholder. | job fails |

The full list of exit codes, including ones that can follow a posted review, is in
[cli.md](cli.md#exit-codes). Symptom-by-symptom recovery is in
[troubleshooting.md](troubleshooting.md).
