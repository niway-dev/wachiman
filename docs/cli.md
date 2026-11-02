# Command-line contract

`agent-review` is one command with two subcommands. The reusable workflow and the copied caller
workflow both run exactly this; anything else that wants to drive a review can too. Every setting
it reads is listed in [configuration.md](configuration.md); this page covers the commands, what
they post and how they exit.

```sh
bun src/cli.ts review <pr> [paths…] [--repo-dir <dir>]
bun src/cli.ts comment <pr> [--repo-dir <dir>]   # the comment text comes from $REQUEST
bun src/cli.ts --help
bun src/cli.ts --version
```

`package.json` declares `"bin": {"agent-review": "src/cli.ts"}` and the file starts with
`#!/usr/bin/env bun`, so an installed copy can be run as `agent-review …`. Bun is required (the
engine uses `Bun.Glob`), and so are the `gh` CLI and the provider's binary on the `PATH`.

Argument rules, as implemented:

- The command (`review` or `comment`) must be the first argument. `--help`/`-h` and
  `--version`/`-v` are recognised only as the first argument too.
- `<pr>` must be digits only and greater than 0.
- `--repo-dir` may appear anywhere after the command. It is removed from the arguments before the
  rest are read, so it is never taken for a path.
- `comment` takes no paths: `comment takes no paths.` exits 2.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--repo-dir <dir>` (or `--repo-dir=<dir>`) | `.` | The checked-out pull request head. The engine reads no file from it itself: it gets the diff and file list from GitHub through `gh`. It gives the head's absolute path to the agent, which reads files there, and uses it to turn paths the agent reports into repository-relative ones. A directory that does not exist is a usage error. |

Neither adapter starts the agent inside the head. Each starts it in an empty scratch directory and
tells it where the head is, so that a `CLAUDE.md`, `AGENTS.md` or settings file in the reviewed
branch is not loaded as instructions (see [providers/claude-code.md](providers/claude-code.md) and
[providers/codex.md](providers/codex.md)). The engine process itself runs in whatever directory
you launch it from.

The reusable workflow runs the engine from its own checkout (`engine/`) and passes the head
(`head/`) here, so the process's working directory is never the reviewed code. Run it the same way:
`bun --no-env-file --config=<engine>/bunfig.toml <engine>/src/cli.ts review 7 --repo-dir <head>`.
Bun reads `bunfig.toml` (including `preload`, which runs code) and `.env` from the working
directory; `--no-env-file` and `--config=` keep both of those out. Write `--config=<path>` with the
equals sign: `-c <path>` did not replace the working directory's config in Bun 1.3.4.

## Commands

| Command | What it does |
| --- | --- |
| `review <pr> [paths…]` | Reviews the pull request and posts one GitHub review with inline comments, then replies in its own open threads when there is work to do. See "Incremental reviews" and "Scope" below. |
| `comment <pr>` | Routes the operator's comment (from `REQUEST`) to a review, an answer or nothing. See "What `comment` does" below. |

### Incremental reviews

- First review of a pull request: every changed file that is not [excluded](configuration.md#excluded-files).
- Later unscoped `review`: only what changed since the last reviewed commit, when that commit is an
  ancestor of the head. If it is not (after a force-push or rebase), the whole pull request is
  reviewed again, and the engine logs that it fell back to a full review.
- The last reviewed commit is the one recorded by the engine's own most recent complete, unscoped
  review. A scoped review, or one that left files unreviewed, does not move it. The marker is read
  only from reviews by `github-actions[bot]` that carry the engine's signature; an unsigned legacy
  marker counts only on reviews from before 2026-11-01 and before the first signed review.
- If the head is the last reviewed commit and no path was given, the review is skipped with an
  `Already reviewed` notice. A request with a path that matches a changed file always runs.

### Scope

`review src docs/api` limits the review to changed files that are exactly those paths or lie under
them. Words are paths or directory prefixes, never globs, and words that name no changed file are
ignored.

**A scope that matches nothing is not an error.** If every word is ignored, the engine behaves as if
no path had been given: on a head that has not been reviewed it runs a normal (possibly full) paid
review, and on an already-reviewed head it posts `Already reviewed`. Today a mistyped path can
therefore widen a review instead of narrowing it. Details and the exact matching rules:
[configuration.md](configuration.md#scope-words).

### What `comment` does

The checks run in this order:

1. If `AGENT_REVIEW_OPERATOR` is empty or a template placeholder (`EDIT…`, `your-github-login`),
   `comment` fails with exit 1. This is checked before anything else, including before it looks at
   the comment.
2. If `AGENT_REVIEW_COMMENT_AUTHOR` is set and is not the operator (case-insensitive), it prints a
   notice and exits 0 without doing anything. If it is unset, the engine does no author check: a
   caller that runs `comment` directly decides who may reach it.
3. If the comment contains no command word (`AGENT_REVIEW_MENTION`, default `/wachi`, or the
   aliases `/wachiman`, `@agent-review`, `@claude`), nothing happens and it exits 0.
4. If the first word after the command word is `review`, it runs `review` with the remaining words
   as paths.
5. Otherwise the whole comment is a question, and one agent call answers it as a pull request
   comment.

The workflow's own filter for which comments start a job is looser than the parser used in step 3,
and for custom mentions the two accept different words. That is documented, with examples, under
[Mentions and commands](configuration.md#mentions-and-commands).

Because the provider check runs before `comment` reads the request (see [Exit codes](#exit-codes)),
even a comment that would do nothing needs a working provider binary and credential.

## What it posts

- `review`: one GitHub review with the event `COMMENT`, never an approval or a change request. Its
  first line says whether coverage is complete or partial, and it ends with a "Coverage by batch"
  table and a footer `<sub>{model label} · effort {effort} · {n} batches · ${cost}</sub>`; the
  `· {n} batches` part appears only when the review ran more than one batch. The footer names the
  provider and model, for example "Claude Sonnet 5.5 via Claude Code 2.1.304", and the reasoning
  effort the run used (`low`, `medium`, `high`, `xhigh` or `max`, [configuration.md](configuration.md#reasoning-effort)).
  The `· effort {effort}` part is **new in the release after v1.3.0**: the footer of a v1.3.0
  review is `<sub>{model label} · {n} batches · ${cost}</sub>` and has no effort field. A finding on a line of the diff is an
  inline comment on that line; one on a line outside the diff goes in the body under "Outside the
  diff". Coverage is reported by the agent per file, not measured line by line.
- A complete, unscoped review also ends with `<!-- agent-review sha=<head> -->`; the next
  unscoped review starts from that commit. The older `<!-- claude-review sha=… -->` marker is still
  read, never written (see "Incremental reviews" for the cutoff).
- `review` when nothing is to be done: a short review body. `Already reviewed at <sha>` when the
  head was already reviewed, `Nothing to review at <sha>` when every changed file is excluded or
  outside the requested paths.
- `review` when the agent ran out of its budget before finishing any batch: a short review body
  saying nothing was reviewed reliably and suggesting a review by path. The process exits 0. If
  some batches did finish, their findings are posted with the unfinished files listed as not
  reviewed.
- Replies in threads: when a review has work to do and an earlier complete, unscoped review left a marker, the engine looks
  at the tool's own unresolved threads on the pull request and may post a reply in each ("Looks
  addressed" or "Still open"). Only the first 100 review threads of the pull request are fetched,
  at most 30 comments per thread, and only replies by an `OWNER`, `MEMBER` or `COLLABORATOR` reach
  the agent. The engine never resolves a thread. These limits belong to `review`, not to answers.
  Threads are not read when a review ends early as `Already reviewed` or `Nothing to review`, and
  nothing starts a run when someone replies in a thread, so a reply on an unchanged head waits for
  a later review that has work (a push, or a request with a path that matches). That is today's
  behaviour.
- `comment` with a question: one pull request comment (not a review) holding the answer, written in
  English, and a footer `<sub>{model label} · effort {effort} · ${cost}</sub>` (no batch count,
  since an answer is one call). As with a review, the `· effort {effort}` part is new in the
  release after v1.3.0; v1.3.0 prints `<sub>{model label} · ${cost}</sub>`. The answer is one call over the whole diff, with no batching, no coverage check and no
  thread context, capped by `answer_budget_usd`.
- With `AGENT_REVIEW_DRY_RUN=1` it reads GitHub but prints instead of posting. It still calls the
  agent, so it still costs money.

Before posting, the engine refuses to post anything that contains something shaped like a provider
credential, and exits 1 with `The output contains something shaped like a provider credential; not
posting it.` This is a check for the provider's key and key-shaped strings, not a general secret
scanner. See [SECURITY.md](../SECURITY.md).

## Environment

Required for both commands:

| Variable | Meaning |
| --- | --- |
| `GH_TOKEN` | Token for `gh`. It is never given to the agent. |
| `GITHUB_REPOSITORY` | `owner/name` of the repository. |
| `REQUEST` | `comment` only: the comment text. Pass it through the environment, never interpolated into a shell command. |
| Provider credentials | For `claude-code`: `ANTHROPIC_API_KEY`. For `codex`: `OPENAI_API_KEY`. Neither is needed with `AGENT_REVIEW_DRY_RUN=1`, which uses the machine's own login. |

The `gh` CLI and the provider's binary (`claude` for `claude-code`, `codex` for `codex`) must be on
the `PATH`.

All optional settings (`AGENT_REVIEW_BUDGET_USD`, `AGENT_REVIEW_MODEL`, `AGENT_REVIEW_PROVIDER`,
`AGENT_REVIEW_DRY_RUN`, `AGENT_REVIEW_EXCLUDE`, `AGENT_REVIEW_COMMENT_AUTHOR` and the rest) are in
[configuration.md](configuration.md#engine-settings), with their types, defaults, valid values and
which provider they apply to. Two things hold for every one of them: budgets and sizes must be
positive numbers (lines and chars, whole numbers), and anything else is a usage error.

### Deprecated names

`AGENT_REVIEW_X` settings fall back to the old `CLAUDE_REVIEW_X` names, with a notice on stderr.
Installed copies can migrate one variable at a time; the new name wins when both are set. The
fallback covers the engine settings only: [configuration.md](configuration.md#deprecated-names).

### Repository files

The engine reads `.github/agent-review.md` (the review focus), the old `.github/claude-review.md`
name, `CLAUDE.md` and `AGENTS.md` from the pull request's base commit, so a pull request cannot
change the rules it is reviewed under. Details, size limits and what these files cannot do:
[configuration.md](configuration.md#repository-files). A YAML configuration file is not
implemented.

## Finding labels

Every finding is labelled on two axes, each an emoji followed by its word, for example
`🟠📝 **Fix · docs: stale 'Read by' cell**`. The decision is
[ADR 0003](adr/0003-two-axis-finding-labels.md).

| Severity | Emoji | For the author | Where it is posted |
| --- | --- | --- | --- |
| `blocker` | 🔴 Blocker | Fix before merging: the reviewer can name the input, state or trust boundary that fails | Inline, or "Outside the diff" |
| `fix` | 🟠 Fix | Wrong today; fix it in this pull request; does not block the merge | Inline, or "Outside the diff" |
| `consider` | 🟡 Consider | Would be better; the author may decline | Inline, or "Outside the diff" |
| `info` | ⚪ Info | Nothing to change; awareness only | Always the body, under "For your information" |

A severity is advice, not a status. "Blocker" is the reviewer's recommendation that the author
act before merging; Wachiman never approves, requests changes or blocks a merge, and nothing it
posts can fail a required check.

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

A repository's focus file (`.github/agent-review.md`) may say what to look for, but it may not add
severities or topics: a label means the same thing in every repository that runs the reviewer.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | A review or answer was posted, or there was nothing to do (no command word, not the operator, nothing to review, already reviewed), or the agent ran out of budget before finishing any batch and a notice was posted. `--help` and `--version` also exit 0. |
| `1` | Engine error. **Not the same as "nothing was posted"**: see below. |
| `2` | Usage error: unknown command, missing or invalid pull request number, `comment` given paths, a `--repo-dir` that is not a directory, missing `GH_TOKEN`, `GITHUB_REPOSITORY` or `REQUEST`, an invalid numeric setting, or an unknown provider. The message and the usage text go to stderr. |

Exit 1 covers:

- Before any call is paid for: a missing provider binary, settings file or credential, a Codex model
  with no known price, an empty or placeholder operator in `comment`, and a malformed
  `AGENT_REVIEW_PRICE_PER_MTOK`. The malformed price is raised as an ordinary error, so it exits 1
  although it is a bad setting. Nothing has been posted.
- During a review: a failed `gh` call, no batch returning a review (when no call hit its cap),
  output refused because it looked like a credential, and an answer the agent did not give.
  Normally nothing has been posted, but exit 1 is not a promise of that.
- **After the review was posted:** the review is posted first and the thread replies after it. If a
  reply fails, the process exits 1 although the review is already on the pull request. A review
  whose last attempt to post failed in an unclear way (for example a network error after GitHub
  accepted it) may also have landed; the engine checks for that before it retries, but if retries
  run out the outcome is unknown.

Before re-running after exit 1, look at the pull request: a review may already be there. A complete,
unscoped review that was posted moves the incremental marker, so running again on the same head
says `Already reviewed` instead of repeating the replies that failed.

A batch that fails or overruns does not end the review: the batches that ran are posted and the
rest are listed as not reviewed.

Which exit code you get follows the order of the checks in `main`:

1. Arguments: `--help` and `--version` exit 0; an unknown command, a bad pull request number,
   `comment` with paths, or a bad `--repo-dir` exit 2.
2. Settings: an invalid numeric setting exits 2, then an unknown provider exits 2, then a malformed
   Codex price exits 1.
3. `GH_TOKEN`, `GITHUB_REPOSITORY`, then (for `comment`) `REQUEST`: each missing one exits 2.
4. The provider's preflight: any failure exits 1.
5. Only then does `review` or `comment` run.

## Providers

The engine (`src/engine.ts`) is provider-neutral. It asks a `ProviderAdapter`
(`src/providers/types.ts`) to run one call and gets back structured output, text, cost, turns,
duration and a terminal reason. Filtering, risk, batches, retries, coverage, budgets, posting and
threads stay in the engine.

Two adapters exist: [Claude Code](providers/claude-code.md), the default and the only one the
reusable workflow installs, and [Codex](providers/codex.md) (ADR 0004), which is available from the
CLI only. Each brings its own sandbox story (what the agent may read or run), its own
structured-output path and its own cost accounting; the differences that affect settings are in
[configuration.md](configuration.md#providers-and-models). There is no plugin system.
