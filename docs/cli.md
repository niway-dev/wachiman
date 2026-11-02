# Command-line contract

`agent-review` is one command with two subcommands. The reusable workflow and the copied caller
workflow both run exactly this; anything else that wants to drive a review can too.

```sh
bun src/cli.ts review <pr> [paths…] [--repo-dir <dir>]
bun src/cli.ts comment <pr> [--repo-dir <dir>]   # the comment text comes from $REQUEST
bun src/cli.ts --help
bun src/cli.ts --version
```

`package.json` declares `"bin": {"agent-review": "src/cli.ts"}` and the file starts with
`#!/usr/bin/env bun`, so an installed copy can be run as `agent-review …`. Bun is required (the
engine uses `Bun.Glob`).

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--repo-dir <dir>` (or `--repo-dir=<dir>`) | `.` | The checked-out pull request head. The engine starts the agent with it as working directory; it reads nothing from it itself, and nothing else from the current directory. A directory that does not exist is a usage error. |

The reusable workflow runs the engine from its own checkout (`engine/`) and passes the head
(`head/`) here, so the process's working directory is never the reviewed code. Run it the same way:
`bun --no-env-file --config=<engine>/bunfig.toml <engine>/src/cli.ts review 7 --repo-dir <head>`.
Bun reads `bunfig.toml` (including `preload`, which runs code) and `.env` from the working
directory; `--no-env-file` and `--config=` keep both of those out. Write `--config=<path>` with the
equals sign: `-c <path>` did not replace the working directory's config in Bun 1.3.4.

## Commands

| Command | What it does |
| --- | --- |
| `review <pr> [paths…]` | Reviews the pull request. After the first review, only what changed since the last reviewed commit. With paths, only those paths (words that name no changed file are ignored). Posts one GitHub review with inline comments, and replies in its own open threads. |
| `comment <pr>` | Fails with exit 1 when `AGENT_REVIEW_OPERATOR` is empty or a template placeholder (`EDIT…`, `your-github-login`). Reads the comment from `REQUEST`. If it mentions the tool (`AGENT_REVIEW_MENTION`, default `/wachi`, or the aliases `@agent-review` and `@claude`): `review [paths…]` runs a review, anything else is a question answered as a pull request comment. A comment without a mention does nothing. |

## What it posts

- `review`: one review (event `COMMENT`, never an approval or a change request) whose first line
  says whether coverage is complete or partial, with a "Coverage by batch" table and a footer
  `<sub>{model label} · {n} batches · ${cost}</sub>`; the `· {n} batches` part appears only when
  the review ran more than one batch. The footer names the provider and model, for
  example "Claude Sonnet 5.5 via Claude Code 2.1.304". A complete, unscoped review ends with
  `<!-- agent-review sha=<head> -->`; the next review starts from that commit. The older
  `<!-- claude-review sha=… -->` marker is still read, never written.
- `review` when nothing changed: a short review body saying so ("Already reviewed", "Nothing to
  review").
- `comment` with a question: one pull request comment holding the answer and a footer with the
  model label and cost (no batch count, since an answer is one call). The `answer` path has
  limits: it puts the whole diff in one call (no batching), reads only the first 100 review
  threads of the pull request, and at most 30 comments per thread.
- With `AGENT_REVIEW_DRY_RUN=1` it reads GitHub but prints instead of posting. It still calls the
  agent, so it costs money.

## Environment

Required:

| Variable | Meaning |
| --- | --- |
| `GH_TOKEN` | Token for `gh`. It is never given to the agent. |
| `GITHUB_REPOSITORY` | `owner/name` of the repository. |
| `REQUEST` | `comment` only: the comment text. Pass it through the environment, never interpolated into a shell command. |
| Provider credentials | For `claude-code`: `ANTHROPIC_API_KEY`. For `codex`: `OPENAI_API_KEY`. Neither is needed with `AGENT_REVIEW_DRY_RUN=1`, which uses the machine's own login. |

The `gh` CLI and the provider's binary (`claude` for `claude-code`) must be on the `PATH`.

Settings, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_REVIEW_BUDGET_USD` | `3` | Total for all batches (and retries) of one review |
| `AGENT_REVIEW_BATCH_BUDGET_USD` | `0.75` | Cap for one batch call, further limited by what is left of the total |
| `AGENT_REVIEW_ANSWER_BUDGET_USD` | `1` | Cap for one question answered by `comment` |
| `AGENT_REVIEW_BATCH_LINES` | `1000` | Changed lines per batch |
| `AGENT_REVIEW_BATCH_CHARS` | `140000` | Characters of diff per batch (about 40k tokens at 3.5 characters a token) |
| `AGENT_REVIEW_DRY_RUN` | unset | `1`: read GitHub, print the review instead of posting. The reusable workflow has no input for it; it works only in the copy-the-files install |
| `AGENT_REVIEW_MODEL` | `claude-sonnet-5-5` for `claude-code`, `gpt-6.1-sol` for `codex` | The reviewer model, passed to the provider |
| `AGENT_REVIEW_PROVIDER` | `claude-code` | Which adapter runs the agent: `claude-code` (docs/providers/claude-code.md) or `codex` (docs/providers/codex.md). Any other value is a usage error that lists the accepted ones |
| `AGENT_REVIEW_PRICE_PER_MTOK` | unset | `codex` only: `"input,cached_input,output"` in USD per million tokens, for a model without a built-in price |
| `AGENT_REVIEW_EFFORT` | `high` | Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max`. Passed as `--effort` (Claude Code) or `model_reasoning_effort` (Codex), never translated, so pick a value your provider and model accept. An unknown value stops the run at startup. Printed in every review footer |
| `AGENT_REVIEW_MAX_TURNS` | `40` | Most agent turns one provider call may take. Passed as `--max-turns` (Claude Code); Codex has no such flag and ignores it. Normal batches take 5–12 turns; the cap only stops a looping run |
| `AGENT_REVIEW_CALL_TIMEOUT_S` | `900` | Wall-clock seconds one provider call may run. Past it the process is killed (`SIGKILL`) and the call ends as `timeout`, with cost reported as 0 because the CLI prints nothing before it ends. Applies to both providers |
| `AGENT_REVIEW_REASONING_EFFORT` | unset | Deprecated alias of `AGENT_REVIEW_EFFORT` (logs a warning); `AGENT_REVIEW_EFFORT` wins when both are set |
| `AGENT_REVIEW_MENTION` | `/wachi` | The keyword `comment` looks for. `@agent-review` and `@claude` always work as aliases. The keyword must start a word, so `docs/wachi` is not a command |
| `AGENT_REVIEW_OPERATOR` | unset | The login allowed to command the tool. `comment` requires it: empty, `your-github-login` and anything starting with `EDIT` are refused. The workflow checks it first; the CLI checks it again when the comment author is known (see below) |
| `AGENT_REVIEW_EXCLUDE` | unset | Extra globs to drop, comma-separated, on top of lockfiles, build output and generated files. The reusable workflow has no input for it; it works only in the copy-the-files install |
| `AGENT_REVIEW_COMMENT_AUTHOR` | unset | `comment` only: the comment author's login. A different author than `AGENT_REVIEW_OPERATOR` makes `comment` do nothing and exit 0 |

The defaults in `src/config.ts` and the defaults of the reusable workflow's inputs (see
[install.md](install.md)) are kept in sync by hand; change both together. CI pins Bun
separately (in `.github/workflows/ci.yml`) from the workflow's `bun_version` input.

Budgets and sizes must be positive numbers; batch lines and chars, the turn cap and the call timeout, positive integers. Anything
else is a usage error.

### Deprecated names

Each `AGENT_REVIEW_X` falls back to the old `CLAUDE_REVIEW_X` when the new one is unset or empty,
with one line on stderr per variable (`CLAUDE_REVIEW_X is deprecated; use AGENT_REVIEW_X.`).
Installed copies can migrate one variable at a time. The new name wins when both are set.

### Repository files

| File | Meaning |
| --- | --- |
| `.github/agent-review.md` | Optional. The repository's review focus, read from the pull request's base commit and appended to the rules. A pull request that edits it is reviewed under the base version. |
| `.github/claude-review.md` | The old name. Read, from the base commit, when the new file is absent, with a notice on stderr. `CLAUDE.md` and `AGENTS.md` are read from the base commit the same way. |

A YAML configuration file is not implemented.

### Finding labels

Every finding is labelled on two axes, each an emoji followed by its word, for example
`🟠📝 **Fix · docs: stale 'Read by' cell**`. The decision is
[ADR 0003](adr/0003-two-axis-finding-labels.md).

| Severity | Emoji | For the author | Where it is posted |
| --- | --- | --- | --- |
| `blocker` | 🔴 Blocker | Fix before merging: the reviewer can name the input, state or trust boundary that fails | Inline, or "Outside the diff" |
| `fix` | 🟠 Fix | Wrong today; fix it in this pull request; does not block the merge | Inline, or "Outside the diff" |
| `consider` | 🟡 Consider | Would be better; the author may decline | Inline, or "Outside the diff" |
| `info` | ⚪ Info | Nothing to change; awareness only | Always the body, under "For your information" |

| Topic | Emoji | Covers |
| --- | --- | --- |
| `bug` | 🐛 | The code does the wrong thing for some input or state |
| `security` | 🔐 | Credentials, user data, or a trust boundary the change weakens |
| `rules` | 📜 | A violation of `CLAUDE.md`, `AGENTS.md` or a repository convention |
| `adr` | 🏛️ | A change that contradicts a decision record, or (engine notice) one that edits a file under `docs/adr/` |
| `docs` | 📝 | Documentation or comments that are stale or contradict the code |
| `tests` | 🧪 | Missing coverage, or a test that does not test what its name says |
| `perf` | ⚡ | Cost, latency, repeated work, N+1 queries |
| `cleanup` | 🧹 | Duplication, dead code, a misleading name |
| `question` | ❓ | Something the reviewer could not determine and asks the author |

Two tests settle a severity that feels uncertain, and apply before the list above:

- If the only thing wrong is a comment, docstring, name or documentation, the severity is
  `consider` or lower, never `fix`. The exception is a document that makes users do something
  harmful.
- If a user can lose data or see a wrong result silently, the severity is `fix` or higher even
  when the trigger is rare.

A finding also carries a **confidence**, separate from severity: severity says how bad the finding
is if it is true, confidence says how sure the reviewer is that it is true, given what it read.
It is shown after the title, for example `🟠🐛 **Fix · bug: Face is lost (confidence high)**`.

| Confidence | Meaning |
| --- | --- |
| `high` | The reviewer read the lines that establish every premise, and the failure follows from them |
| `medium` | The argument holds, but a premise rests on code the reviewer did not read or a condition it could not confirm |
| `low` | Plausible, not established |

A `low` confidence finding at `fix` or above is posted with the topic `question`, worded as a
question to the author. The engine does not enforce this; it is a rule in the prompt, and
[precision](precision.md) tabulates verdicts by confidence so the rule can be checked. A finding
without a confidence (the engine's own notices, reviews from before the field existed) shows none. The decision
is in the [flow questions spec](specs/2026-10-31-flow-questions-and-evidence-design.md), decision 9.

A repository's focus file (`.github/agent-review.md`) may say what to look for, but it may not add
severities, topics or confidence levels: a label means the same thing in every repository that
runs the reviewer.

### The "What the change connects to" block

Each batch also answers the **flow questions** (what a new action or call changes, which existing
path does the same and what it does before and after, how the result reaches the user, what
happens when background work finishes or the user goes Back, and what happens when the call
fails) as `contracts`: one entry per question, with `action`, `location`, `equivalent_path`,
`before_after`, `visible_effect`, `failure_mode`, a `status` (`closed` or `open`), `evidence`
(`path:line` or `path:from-to`), and for an open entry an `open_question` and `candidates`, the
files that would answer it. The review body shows them in a collapsed block after the summary and
before the coverage table: open entries as questions with their candidate files, closed ones one
line each.

The engine checks the shape of each entry, and that every cited file exists in the checked-out
head and every cited line is within it (the engine reads only inside the head). A citation that
does not resolve prints a warning on stderr and marks the entry `evidence_checked: false`, which
the block shows as "A citation did not resolve in the head"; the entry is not removed. The engine
does not check that an answer is true. Contracts from several batches are merged: one entry per
action and location. When the body would exceed its size limit, the contracts block is cut first:
shrunk to what fits, or dropped, before the coverage table and the summary are touched.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | A review or answer was posted, or there was nothing to do (no mention, not the operator, nothing to review, already reviewed). `--help` and `--version` also exit 0. |
| `1` | Engine error; nothing was posted. Includes a missing provider binary or credential (checked before any call is paid for), a failed `gh` call, and no batch returning a review. |
| `2` | Usage error: unknown command, missing or invalid pull request number, missing `GH_TOKEN`, `GITHUB_REPOSITORY` or `REQUEST`, an invalid setting, or an unknown provider. |

A batch that fails or overruns does not end the review: the batches that ran are posted and the
rest are listed as not reviewed.

## Providers

The engine (`src/engine.ts`) is provider-neutral. It asks a `ProviderAdapter`
(`src/providers/types.ts`) to run one call and gets back structured output, text, cost, turns,
duration and a terminal reason. Filtering, risk, batches, retries, coverage, budgets, posting and
threads stay in the engine.

Two adapters exist: [Claude Code](providers/claude-code.md), the default, and
[Codex](providers/codex.md) (ADR 0004). Each brings its own sandbox story (what the agent may read
or run), its own structured-output path and its own cost accounting. There is no plugin system.
