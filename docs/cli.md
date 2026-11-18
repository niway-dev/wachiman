# Command-line contract

`wachiman` is one command. Three subcommands are for GitHub; `local` reviews a branch on your own
machine and posts nothing; `setup`, `doctor`, `profile` and `project` manage and explain which
Claude account `local` uses, and `init` writes the GitHub caller workflow. The reusable workflow and the copied caller
workflow both run exactly this; anything else that wants to drive a review can too. Every setting
it reads is listed in [configuration.md](configuration.md); this page covers the commands, what
they post and how they exit.

A coding agent that installs or maintains Wachiman for a person reads [agents.md](agents.md) first: it
maps each wizard question to a flag and shows the non-interactive command sequence.

```sh
bun src/cli.ts review <pr> [paths…] [--repo-dir <dir>]
bun src/cli.ts comment <pr> [--repo-dir <dir>]   # the comment text comes from $REQUEST
bun src/cli.ts threads <pr> [--repo-dir <dir>]   # answer the pending Wachiman threads, no review
bun src/cli.ts local [paths…] [--base <ref> | --from <commit> | --commit <commit> | --working-tree staged|all] [--max-depth <n>] [--repo-dir <dir>] [--input <file>] \
  [--format terminal|markdown|json] [--output <file>] [--profile default|isolated[:<name>]] [--agent-prompt]
bun src/cli.ts setup [--profile <name>] [--repo-dir <dir>] [--yes] [--json]
bun src/cli.ts init [--mode github|local|both] [--project-kind monorepo|single] [--operator <login>] [--version <tag>] [--path <file>] \
  [--force] [--dry-run] [--yes] [--json] [--repo-dir <dir>]
bun src/cli.ts doctor [--json] [--profile <name> | --all-profiles] [--repo-dir <dir>] [--redact-paths]
bun src/cli.ts profile list|create|add|login|remove|default ...
bun src/cli.ts project show|unbind ...
bun src/cli.ts --setup-profile [<name>]          # alias of `profile create`
bun src/cli.ts --help                            # a short index of the commands (about 25 lines)
bun src/cli.ts <command> --help                  # or: help <command>; that command's own page
bun src/cli.ts help ci                           # review, comment, threads, reset-confidence
bun src/cli.ts --version
```

Help is printed from the arguments alone: it loads no configuration and makes no git, GitHub or model
call, so `wachiman <command> --help` works anywhere. Every command's page has its usage, a
description, the flags with their defaults, the environment variables that command reads, its exit
codes and examples; `profile`, `project`, `skills` and `ledger` also have a page per subcommand (`wachiman
profile create --help`). The four commands that only a GitHub Actions run uses (`review`, `comment`,
`threads`, `reset-confidence`) are not in the root help; `wachiman help ci` lists them with the GitHub
variables and exit codes. `--setup-profile` still works and is also left out of the root help. This
page remains the full reference for the environment variables and exit codes.

A bare `wachiman` with no arguments opens the [launcher](#interactive-launcher-and-intro) on a terminal and prints the root help and exits 0 anywhere else.

`package.json` installs `wachiman` through the Node launcher
`bin/wachiman.js`. Node 20 or later must be on `PATH`. The package installs Bun as
its dependency, with `chalk` and `@clack/prompts` for the terminal screens; the launcher uses that binary when usable, otherwise a compatible
Bun on `PATH`. Source contributors can still run `bun src/cli.ts`. Git and the
provider binary are needed for local reviews; GitHub commands also need `gh`.

Argument rules, as implemented:

- The command (`review`, `comment`, `threads`, `reset-confidence`, `local`, `loop`, `ask`, `history`, `status`, `dashboard`, `ledger`, `setup`, `init`, `doctor`, `profile`, `project`, `skills` or `upgrade`) must be the first argument. `--help`/`-h`,
  `--version`/`-v`, `help` and `--setup-profile` are recognised only as the first argument too. `--help` or `-h` after a command prints that command's help and exits 0, before any other argument is checked. It is not a request where it is text or a value: after a `--`, as the value of `--reason`, or anywhere but the first argument of `ask`, whose other words are the question.
- `<pr>` must be digits only and greater than 0.
- `--repo-dir` may appear anywhere after the command. It is removed from the arguments before the
  rest are read, so it is never taken for a path.
- `comment` and `threads` take no paths: `comment takes no paths.` exits 2.

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
| `threads <pr>` | Answers the Wachiman threads that wait for an answer, with no review, and only when the pull request's head was already reviewed. See "What `threads` does" below. |
| `local [paths…]` | Reviews the committed branch of a clone on your own signed-in `claude` and prints the review; no GitHub call, nothing posted. See [`local`](#local) below and [the guide](local-review.md). |
| `loop [--base <ref>]` | One round of a review loop on your own signed-in `claude`: a review with history on, a comparison with the rounds before it, and an exit code to branch on (`0` converged, `10` findings open, `11` stopped). A coding agent fixes between calls; the CLI never edits code. See [`loop`](#loop) below. |
| `dashboard [--json] [--out <file>] [--refresh]` | Writes one static HTML page, or prints JSON, with the spend, findings and loop rounds of every repository in the local history, from a rebuildable SQLite index. With a ledger connected it also shows GitHub Actions spend. No model call; a request only with `--refresh`. See [`dashboard`](#dashboard) and [the guide](local-dashboard.md). |
| `ledger connect <url>`, `ledger disconnect`, `ledger pull [--since <n>d]` | Connect to the spend ledger with a read token, and download its entries to the laptop so `status` and `dashboard` can show Actions runs next to laptop runs. See [`ledger`](#ledger). |
| `ask [question…]` | Answers one question about the local change (or walks through it when there is no question), on your own signed-in `claude`; no GitHub call, nothing posted. See [`ask`](#ask) below. |
| `setup [--profile <name>]` | Binds this repository to an account profile; on a terminal without `--profile` it asks. See [`setup`](#setup-doctor-profile-and-project). |
| `init` | Writes the GitHub caller workflow and the repository settings file, or hands over to `setup`. See [`init`](#init). |
| `doctor` | Reports what a local run would use and what would fail. |
| `profile …`, `project …` | Manage account profiles and the repository's binding. |
| `upgrade [--check] [--repo-only] [--to <version>]` | Updates the CLI, then moves the workflow pin in this repository to the new release. See [`upgrade`](#upgrade). |
| `skills install\|uninstall` | Copies the `wachiman-review`, `wachiman-loop` and `wachiman-audit` agent skills into place, or removes the copies it made. See [`skills`](#skills). |
| `pr-template show\|install\|status\|check\|format\|risk\|strip` | Installs the PR description template, reports its state, checks and reorders a description, and computes the risk floor. No model call. See [`pr-template`](#pr-template) and [the guide](pr-template.md). |
| `memory check` | Checks the repository memory in `.wachiman/memory/`: malformed entries, globs that match no file, budget overruns; then suggests likely duplicates and entries to archive. No model call. See [`memory`](#memory). |
| `memory archive <id>` | Moves one entry to `.wachiman/memory/archive.md` in the working tree. See [`memory`](#memory). |
| `memory candidates`, `add`, `show`, `propose` | Keeps memory candidates on the laptop and proposes an approved entry as one commit on the branch `wachiman/memory`. No model call. See [`memory`](#memory). |
| `--setup-profile [<name>]` | The same as `profile create [<name>]`: creates `~/.wachiman/claude-<name>` (default name `isolated`) and starts `claude` in it so you can sign in. |

### Incremental reviews

- First review of a pull request: every changed file that is not [excluded](configuration.md#excluded-files).
- Later unscoped `review`: only what changed since the last reviewed commit, when that commit is an
  ancestor of the head. If it is not (after a force-push or rebase), the whole pull request is
  reviewed again, and the engine logs that it fell back to a full review.
- The last reviewed commit is the one recorded by the engine's own most recent unscoped review,
  complete or partial. A scoped review does not move it. The marker is read only from reviews by
  `github-actions[bot]` that carry the engine's signature; an unsigned legacy marker counts only on
  reviews from before 2026-11-01 and before the first signed review.
- **After a partial review the next run resumes.** A partial, unscoped review (its budget ran out,
  or a model left files out) also records the files it did not review. The next unscoped run
  reviews what changed since that commit **and** those files, each once, the unread ones with their
  whole diff against the base (nothing of them was ever reviewed), even when they also changed. A
  push that changes no file still reviews the unread ones: it does not stop at `Already reviewed`
  or at a "rebased, no new changes" notice. A file that left the pull request, or is excluded now,
  is dropped without a word. When everything is reviewed, the review is complete and the next push
  is incremental again.
- A file that the run did not reach (the budget was spent) is carried again and again, until the
  pull request's `auto_budget_usd` ceiling stops the automatic runs. A file that was sent to the
  agent and came back not reviewed is carried once; if it comes back not reviewed a second time,
  the review names it as "Not reviewed after two tries" and the next push no longer carries it:
  ask `/wachiman review <paths>` for it.
- If the unread files are too many to record (the marker is capped at 10,000 characters, about
  110 files), the review writes no list, logs a warning, and the next unscoped run reviews the whole
  pull request again, as it did before this list existed.
- If the head is the last reviewed commit, no path was given and no file is waiting, the review is
  skipped with an `Already reviewed` notice. A request with a path that matches a changed file
  always runs.

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

1. If `WACHIMAN_OPERATOR` is empty or a template placeholder (`EDIT…`, `your-github-login`),
   `comment` fails with exit 1. This is checked before anything else, including before it looks at
   the comment.
2. If `WACHIMAN_COMMENT_AUTHOR` is set and is not the operator (case-insensitive), it prints a
   notice and exits 0 without doing anything, unless `WACHIMAN_ASKERS=write`; then see
   [Questions from collaborators](#questions-from-collaborators). If it is unset, the engine does no
   author check under `askers: operator`: a caller that runs `comment` directly decides who may reach
   it. Under `askers: write` an unset author is an error (exit 1), because nobody can then be trusted
   without a login.
3. If the comment contains no command word (`WACHIMAN_MENTION`, default `/wachiman`, or the
   aliases `/wachi`, `@claude`), nothing happens and it exits 0.
4. If the first word after the command word is `review`, it runs `review` with the remaining words
   as paths.
5. Otherwise the whole comment is a question, and one agent call answers it as a pull request
   comment. With nothing after the command word, or only the word `explain`, the request is a
   walkthrough of the change instead, in five fixed sections.

The workflow's own filter for which comments start a job is looser than the parser used in step 3,
and for custom mentions the two accept different words. That is documented, with examples, under
[Mentions and commands](configuration.md#mentions-and-commands).

Because the provider check runs before `comment` reads the request (see [Exit codes](#exit-codes)),
even a comment that would do nothing needs a working provider binary and credential.

### Questions from collaborators

Only the operator's comments run a review. With `WACHIMAN_ASKERS=write`, a collaborator's
comment that asks a question is answered too. In the reusable workflow that is the `askers` input
(default `operator`), and the ceiling in step 4 is the `ask_ceiling_usd` input (default `3`); the
copy template sets both at the top of its file. After step 1 above, such a comment must pass these
checks, in this order:

1. It must have an author (`WACHIMAN_COMMENT_AUTHOR`), or the run exits 1.
2. It must be a question or a walkthrough request. Anything else, including `review`, prints a
   notice and exits 0.
3. GitHub must report the author's permission on the repository as `admin`, `maintain` or `write`
   (or a role named `maintain`), from `repos/{repo}/collaborators/{login}/permission`. Bots, a failed
   lookup and any other permission are refused. A refusal posts nothing; it is a line in the job log.
4. The question ceiling must have room. Each answer to a collaborator ends with a footer that records
   its cost. The sum of those footers on the pull request, plus `WACHIMAN_ANSWER_BUDGET_USD`, must
   not exceed `WACHIMAN_ASK_CEILING_USD` (default `3`). When it would, the engine posts one notice
   and answers nothing. It does not post the notice again while it is still the latest Wachiman
   comment on the pull request.

The operator's questions are not limited by the ceiling, and their answers do not count toward it.
A call that fails still posts a note with its cost, so the ceiling counts what was spent.

### What `threads` does

`threads` is an automatic run (`WACHIMAN_TRIGGER` is forced to `thread`): it counts against
`WACHIMAN_AUTO_BUDGET_USD` ([ADR 0012](adr/0012-automatic-thread-replies-and-a-per-pr-ceiling.md)).
The checks run in this order, and each "exits 0" ends the run without a model call:

1. An empty or placeholder `WACHIMAN_OPERATOR` is an error (exit 1).
2. If `WACHIMAN_COMMENT_AUTHOR` is set and is not the operator (case-insensitive), it prints a
   notice and exits 0.
3. If the last reviewed commit (the signed marker) is not the head, it exits 0: the review of that
   push reads the same replies and answers them. The same when no review exists.
4. It keeps the tool's own open threads whose latest comment is a reply by an `OWNER`, `MEMBER` or
   `COLLABORATOR` and where Wachiman has written fewer than two replies. None: exit 0.
5. If the pull request's automatic spend has reached the ceiling, it posts the one notice for that
   ceiling (never twice) and exits 0.
6. One provider call, capped by the smaller of `WACHIMAN_THREADS_BUDGET_USD` and what is left
   under the ceiling, sees each thread's finding, its replies and the head's lines at the finding.
   Each answer is "appears addressed in `path:line`" or "still applies because …"; every cited
   `path:line` must exist in the head, and a reply whose citation does not is dropped. The engine
   rechecks the head and each thread before posting, and posts the replies. The first one carries
   the run's cost line and the automatic flag for the ceiling. It never resolves a thread.

Like `comment`, `threads` needs a working provider binary and credential before it checks anything.

### `local`

`local` reviews `merge-base(base, HEAD) → HEAD` (or one commit, or a commit forward: see `--commit` and `--from`) of the clone given by `--repo-dir` (default: the
current directory): the committed change only, read from a `git archive` snapshot of the head, so
edits made during the run change nothing. It builds the same `ReviewInput` the GitHub mode
builds, with the `local-git` connector, and sends the same prompt
([architecture](architecture.md#the-review-core-and-its-ports)).

| Option | Default | What it does |
| --- | --- | --- |
| `--base <ref>` | `origin/HEAD` when it resolves, else `main` | The branch the change is compared with. No fetch is made |
| `--from <commit>` | none | Review from that commit forward, inclusive: `<commit>^ → HEAD`. The commit must be an ancestor of `HEAD`, and `HEAD` a branch. A root commit starts from the empty tree. The depth limit applies to `<commit>^..HEAD`. Excludes `--base`, `--commit` and `--input` |
| `--commit <commit>` | none | Review exactly that commit: `<commit>^ → <commit>` (the first parent for a merge commit; the empty tree for a root commit). Any commit of the clone, whatever `HEAD` is, even detached; nothing in the working tree is touched. Depth is 1. Excludes `--base`, `--from` and `--input` |
| `--working-tree staged\|all` | none | Explicitly review tracked local changes against `HEAD`: the index (`staged`) or index plus unstaged tracked edits/deletions (`all`). Excludes all untracked and ignored files. Cannot combine with `--base`, `--from`, `--commit` or `--input`. Paths are allowed. |
| `--max-depth <n>` | `250` | The most commits from the start commit (the merge-base, or `--from`'s parent) to `HEAD`. A deeper range exits 2 before any call; a positive integer, for this run only. Size (files, lines, batches) never blocks a run. With no `--base`, a `HEAD` on the base branch itself is refused; `--base <commit>` names the start instead. Not checked for `--input` |
| `[paths…]` | the whole change | Only the changed files under these paths; a word that names no changed file is ignored with a line on stderr |
| `--input <file>` | none | A `wachiman.review-input/1` or `/2` file ([formats](formats/README.md)) instead of the local diff; its `change.head.sha` is snapshotted from `--repo-dir`. Takes no `--base`, `--from`, `--commit` or paths |
| `--format terminal\|markdown\|json` | `terminal` | Plain text; a Markdown report with every finding and the prompt for your agent; or the `ReviewResult` JSON |
| `--output <file>` | stdout | Write the report to a file; its path is printed on stderr |
| `--agent-prompt` | off | With `terminal`, also print the prompt for your agent (Markdown always has it, JSON never) |
| `--profile <name>` | see "Which account" below | `default` is your own `claude`; a name is a registered profile (managed or external); `isolated` and `isolated:<name>` name the managed profile `~/.wachiman/claude-<name>` (which must exist and hold nothing but a sign-in) |
| `--verify` | off (follows `WACHIMAN_VERIFY`); `--verify` forces it on | After the batches, one more call on `WACHIMAN_VERIFIER_MODEL` (default Opus 5.5) tries to refute each finding above `info`. A finding is dropped only when the verifier shows a checked disproof; one it cannot settle stays, marked `inconclusive`; a true bug that predates the change is `supported` with origin `pre-existing`. The verifier can read the base commit as well as the head. The record is `verification` in `--format json --result-version 2` ([ADR 0027](adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md), [ADR 0030](adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)) |
| `--no-verify` | — | Turn verification off for this run, even when `WACHIMAN_VERIFY` is on. With `--verify` it is a usage error |
| `--result-version 1\|2` | `1` for committed; `2` for working-tree | With `--format json` only (any other use exits 2): which result version to write. `1` is the committed form (`toResultV1`): no `verification` block, and one line in `execution.notices` saying how verification went. `2` is the full result, with each finding's `origin`, `verification` and `tier` |
| `--history` | off (or `WACHIMAN_HISTORY=1`) | Save the run under `~/.wachiman/history` and label each finding `new` or `open since <sha7>`; see [local review](local-review.md#keep-a-history-of-your-runs-optional). The prompts are the same with or without it |
| `--no-memory` | off | Review as if the repository had no `.wachiman/memory/` folder: nothing is loaded, no conventions reach the prompt, no exception is matched, and the result has no `memory` or `muted` field. Stderr says `memory: off (--no-memory)`. It exists for the control arm of the [memory replay](memory-replay.md); `ask` and the GitHub mode do not take it |

Both `--x value` and `--x=value` work. Before any call, `local` prints the resolved base, the
merge-base, the depth and the head (`base: main (1a2b3c4)`, `merge-base: …`, `depth: 12 commits (max 250)`, `head: feat/x (…)`); with `--commit` or
`--from` it prints the mode and the start instead (`mode: one commit (abc1234)` or `mode: from abc1234 to HEAD`, then `start: …`, `depth: …`, `head: …`; `start: the empty tree (a root commit)` for a root commit). It also prints the file
count and the number of batches on stderr, then `verify: off` or `verify: on (<model>, reserve $<n>)`; the provider's progress follows there too. **It
prints, never posts:** the report goes to stdout (or `--output`), so `--format json` on stdout is
the result alone.

Size never blocks a run. When the estimated cost of the whole review is above the larger of
`WACHIMAN_SIZE_GATE_USD` and `WACHIMAN_BUDGET_USD`, `local` prints one warning on stderr
before the first model call and continues. The run is capped by `WACHIMAN_BUDGET_USD` (default $3)
and each call by `WACHIMAN_BATCH_BUDGET_USD` (passed to Claude Code as `--max-budget-usd`, soft);
there is no `WACHIMAN_AUTO_BUDGET_USD` ceiling locally. See [the size gate](costs.md#the-size-gate)
and [ADR 0037](adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md).

It refuses to start, with exit 2, when `ANTHROPIC_API_KEY` is set, when `WACHIMAN_PROVIDER`
is not `claude-code`, for a detached or unborn `HEAD`, a `HEAD` on the base branch without `--base`, a range deeper than `--max-depth`, a base with no merge-base, `--base`, `--from` and `--commit` used together, a `--from` that is not an ancestor of `HEAD`, a `--commit` or `--from` that is not a commit, a refused
isolated profile, or an `--input` whose format is not `/1` or whose head is not in the clone.
Each `claude` call runs in subscription mode: no key, `USER` and the no-telemetry switches in its
environment, `--no-session-persistence` (see
[providers/claude-code.md](providers/claude-code.md#in-local-mode-auth-subscription)).

### Which account `local` uses

`local` picks the account by the first rule that applies. A rule that applies and then fails (a
missing profile, a refused directory) stops the run with exit 2; it never falls through to the next:

1. `--profile <name>`.
2. The project binding written by `wachiman setup`: stored under the Wachiman home, keyed by the
   repository's origin URL (credentials removed), or by its git directory when there is no origin. Every clone and
   worktree of one origin shares it.
3. `WACHIMAN_PROFILE`.
4. The default set with `wachiman profile default <name>`.
5. The built-in `default`: your own `claude` and configuration directory.

Before any call, stderr says which account runs and what it overrode (for example `profile: work
(managed; chosen by project binding; WACHIMAN_PROFILE=other ignored)`), and `claude --version` and
`claude auth status` are run in that account's environment. `bin/wachiman` changes nothing: it no
longer turns `WACHIMAN_PROFILE` into `--profile` and no longer removes `ANTHROPIC_API_KEY`, so the
wrapper and `bun src/cli.ts` behave the same. `local` still refuses to start when
`ANTHROPIC_API_KEY` is set; run it with `env -u ANTHROPIC_API_KEY` when your shell exports one.

The Wachiman home is `~/.wachiman`, or the absolute directory in `WACHIMAN_HOME`. The account
configuration is `<home>/config.json` (written with a lock and an atomic rename; a corrupt file is
a usage error, never treated as empty). No credential file is read, and nothing is written under the
repository or under an external profile's directory.

### `loop`

`loop` runs **one review round per call** and says whether to stop
([ADR 0034](adr/0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md)). It is `local` with
history turned on, result `/2` and a stop rule. The CLI never edits code: an agent (see
`skills/wachiman-loop`) fixes between calls.

```sh
wachiman loop --base main --repo-dir ~/src/app   # starts a loop; round 1 reviews the whole range
wachiman loop --repo-dir ~/src/app               # continues it: reviews only the commits since the last round
wachiman loop --max-rounds 5 --format json
```

- **State** is kept per branch beside the history (`~/.wachiman/history/<repo>/loops/`): the base,
  the head of each round and the findings seen. `--base` always starts a new loop; `--history
  --forget` removes the state with the history.
- **Flags:** `--base`, `--max-rounds <n>` (default 3), `--max-depth`, `--format terminal|json`,
  `--profile`, `--verify|--no-verify`, `--repo-dir`. It takes no paths, `--commit` or `--from`.
- **The loop stays open** while a 🔴 Blocker or 🟠 Fix is new, open or not-repeated, not refuted by
  the verifier and not judged `wrong` with a reason (`wachiman history --verdict <id> wrong
  --reason "<why>"`). The loop decides from each round's own result and the code, not from the
  history. In a file the round read, a finding it reported again is open; one it did not report is
  released as `probably-fixed` when its cited line is gone and stays open (`not-repeated`) when the
  line is still there. A file the round did not read keeps its previous state, so a Blocker or Fix
  left `unknown` by a state from the first version of the loop stays open while its file is not read.
  When the cited line is short, repeated or line 0, the loop fingerprints the file's blob instead,
  so any edit to the file releases the finding. 🟡 and ⚪ are listed and never count. A call with no new commit makes no review call and still counts as a round.
- **Output:** the round, what keeps the loop open (with ids), what no longer does and why
  (`probably-fixed`, `refuted`, `judged wrong`), the notes, and the outcome. `--format json` prints
  `wachiman.loop-round/1`.
- A converged loop has read the whole range once and the fix commits after it; the outcome says so.
  A stop is never an approval.

Exit codes: 0 converged; 10 findings still open; 11 stopped without converging (`round cap`, or
`review failed` after the review call failed twice); 2 a usage error (no loop open, detached HEAD, an
unknown flag); 130 after Ctrl-C.

### `ask`

`ask` answers one question about the change that `local` would review, with the same scope flags
and the same account rules ([which account](#which-account-local-uses)). It makes one call on your
signed-in `claude`, reads the material from a temporary directory it removes, and prints the answer.
It never runs a review and makes no GitHub call.

```sh
wachiman ask "how does the retry budget work?" --repo-dir ~/src/app --commit 1a2b3c4
wachiman ask --working-tree all          # no question: a five-section walkthrough
```

The material is the scope's diff and file list. When a stored review of this exact change exists
(the same repository, the same base and head commits, or the same tree for `--working-tree`, and the
same kept files), the answer is grounded in it and the material includes that review. Otherwise the
notice `No stored review of this change: answering from the diff alone.` goes to stderr and the
JSON has `hasReview: false`. Run `wachiman local --history` on the same range first to store one.

Every reference (`path:line`) in the answer is checked against the head snapshot: a path that is
not in it, or a line past its end, is removed and counted in `removedRefs`. For `--working-tree`
the snapshot holds the working-tree content as captured for the run, so a reference is checked
against what was reviewed, not against a file edited during the run.

| Option | Default | What it does |
| --- | --- | --- |
| `[question…]` | none | The words are the question. No words: a walkthrough with five sections, in this order: What the change does, How it is built, What it connects to, Open findings, What was not covered |
| `--base`, `--from`, `--commit`, `--working-tree staged\|all`, `--max-depth` | as `local` | The same scope as [`local`](#local); the same exclusions |
| `--profile <name>` | see "Which account" | As `local` |
| `--format terminal\|markdown\|json` | `terminal` | Plain text with the cost line; Markdown; or the JSON below |
| `--output <file>` | stdout | Write the answer to a file; its path is printed on stderr |

`--format json` prints exactly these keys: `format` (`wachiman.ask-result/1`), `question`,
`walkthrough`, `hasReview`, `sections` (each `title`, `body` and `refs` of `path` and `line`),
`notAnswered` (why a part could not be answered, or `""`), `removedRefs` (how many references were
removed) and `provider` (`label`, `model`, `costUsd`, an API-price estimate).

Two differences from `local` that matter:

- **It reads the history store without `--history`.** It needs the stored review to ground the
  answer. This is a deliberate exception to the `--history` row of the `local` table, which says
  the store is written only when that flag is given. `ask` writes nothing to the store; the only
  file it writes is `--output`, if you pass one. The local promise in
  [ADR 0019](adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  (no telemetry, no GitHub request) is unchanged.
- **It refuses `ANTHROPIC_API_KEY`, as `local` does**, so the call goes to your subscription.

Exit codes: 0 an answer was printed (an answer that says what it could not answer is still an
answer); 1 no answer (the call failed, or its output was not an answer); 2 a usage error, such as an
unknown flag or a scope that has no kept file; 130 after Ctrl-C.

### `setup`, `doctor`, `profile` and `project`

None of these starts a review, calls a model or makes a request of its own. Results go to stdout
and confirmations to stderr; `--json` prints the document named below.

| Command | What it does |
| --- | --- |
| `profile list [--json]` | Registered profiles and the unregistered `claude-*` directories under the home, with the projects bound to each and the default. `--json` prints `wachiman.profiles/1` |
| `profile create [<name>]` | Creates the managed profile `<home>/claude-<name>` (default `isolated`), registers it and starts `claude` there so you can sign in (`/login`, then `/exit`) |
| `profile add <name> --config-dir <abs> [--binary <abs>] [--note <text>]` | Registers a configuration directory you already use, in place: an external profile. Refused when the directory is relative, missing, not a directory or inside the Wachiman home (also through a symlink), when `--binary` is not an absolute, executable regular file (an npm shim is refused), and for a reserved or already used name. Wachiman never writes into the directory |
| `profile login <name>` | Starts `claude` for that profile (with `auth login` when this `claude` has it) so you can sign in again. It never reads the outcome |
| `profile remove <name> [--delete-dir] [--yes]` | Removes the registration and every binding and default that named it. The directory stays unless you pass `--delete-dir`, which is a usage error for an external profile and asks twice for a managed one |
| `profile default <name> \| --none` | Sets or clears the configured default |
| `project show [--json] [--repo-dir <dir>]` | The repository's key, its binding, and what `local` would use here now, with the rule and any ignored values. `--json` prints `wachiman.project/1` |
| `project unbind [--repo-dir <dir>] [--yes]` | Removes this repository's binding |
| `setup [--profile <name>] [--repo-dir <dir>] [--yes] [--json]` | Binds this repository to a profile, prints what it saved and where, then runs the `doctor` summary. On a terminal without `--profile` it is a wizard: see below |
| `doctor [--json] [--profile <name> \| --all-profiles] [--repo-dir <dir>] [--redact-paths]` | One row per check: `wachiman`, `bun`, `git`, `tar`, `config`, `profile`, `auth`, `environment`, `project`, `settings`, `workflow-pin`, `history`, `skills`, `isolation`. The `workflow-pin` row reads the `uses: niway-dev/wachiman/.github/workflows/<name>.yml@<ref>` lines in `.github/workflows` (read-only): a release tag older than the installed CLI is a warning with the fix `wachiman upgrade --repo-only`, a tag that is not older is ok, a commit SHA or a branch is shown and never compared, a workflow file it cannot read is named in a warning, and no Wachiman workflow (or no git repository) is skipped. It is optional. The `settings` row reads `.wachiman.yml` in the working tree (read-only: it never writes or moves anything) and reports its `kind`, `model` and `effort` and where the effective model and effort of a run come from (the environment, the file or the default); an invalid working copy is a warning, never a failure (runs read the file at the base commit or merge-base and ignore a broken one with a warning, so the fix takes effect once committed and merged), and an old `.github/wachiman.yml` is a warning: its fix is `mv .github/wachiman.yml .wachiman.yml`, or, when a root `.wachiman.yml` also exists, to merge the old file into it and remove the old one. `--all-profiles` repeats `profile`, `auth` and `isolation` for every profile. `--redact-paths` swaps paths for `<home-path-N>` and `<external-path-N>` and URLs for `<remote>`, so the output can be shared. `--json` prints `wachiman.doctor/1` |

`remove` and `unbind` ask before writing. Without a terminal (or with `CI` set) they need `--yes`;
without it they exit 2. `setup` needs `--profile <name>` when it cannot ask (no terminal, `CI` is `true` or `1`
or `--yes`) and exits 2 without it; then it skips the question and writes the binding, the name
must already resolve, and `setup` never registers or creates a profile. In `doctor`, the `auth` row reports
`networkObserved: "unknown"` always: Wachiman does not know what `claude auth status` contacts.
With `ANTHROPIC_API_KEY` set, the `environment` row fails, because `local` would refuse to start.

Exit codes: `doctor` 0 when every required check passed and 1 when one failed; `setup` 1 when the
closing `doctor` summary failed (the binding is already written); `profile` and `project` 0 done
(including a "no" answer), 2 usage error, 130 cancelled.

**The `setup` wizard** (a terminal, no `--yes`, `CI` neither `true` nor `1`) asks one question at a time, each
showing its default (on a terminal the highlighted entry and the placeholder; without one, numbered lists mark `(default)`, text shows `[value]`, and Enter takes it):

1. `Set up this repository?` after printing the repository and its current binding.
2. Which profile: your current Claude session, the registered/discovered profiles (name, kind,
   directory, binary or `PATH`; `(current)` and `(global default)` marked), then
   `Create a new isolated profile (managed)` and `Register an existing Claude configuration
   directory (external)`. Registering asks for the directory,
   the `claude` binary (empty for `PATH`) and a name; the entry stays pending. Creating asks for a
   name and then, naming the side effect, whether to create `~/.wachiman/claude-<name>` and open
   Claude there so you can sign in; that directory and sign-in happen at once, and nothing is
   registered yet.
3. There is no confirm step: picking the profile is the confirmation. Wachiman saves the pending
   profile (if any) and the binding in one locked write and prints one line, for example
   `local reviews of app (every clone of <origin>) will use the account "work-a"; saved in ~/.wachiman/config.json, nothing in the repository`.
   The wizard has three steps (Project, Claude account, Checks); started from `init` it has no
   Project step of its own and the session totals are in the `init` section.

Wachiman starts the `claude` binary itself, so it cannot see a shell alias or function that points
`claude` at another configuration directory. The profile list therefore also offers each
`~/.claude-<name>` directory in your home that no profile registers, labelled
`~/.claude-<name> (your own Claude directory, used in place)`. Picking one registers it as an
external profile named `<name>` (the same as `wachiman profile add <name> --config-dir <dir>`) and
binds it; the directory is not opened or changed.

The selector offers your current Claude session (`default`), registered/discovered profiles,
creation of an isolated profile, and registration of an existing directory. Enter prefers the
current binding, then the configured global default, then your current session. The current
session shares your normal Claude settings; it does not register or copy a profile directory.

Then it checks the account (offering `Sign in now?` for a signed-out managed/external profile; for
your current session nothing is offered or run) and prints the `doctor` summary. Required checks passing produces `local: ready` and a review
command; this does not validate the review range. A required failure produces `local: not ready`,
exit 1 (scripts read it as "this machine is not ready"), and a doctor command for this repository. The saved binding remains. Suggested paths are
shell-quoted; Windows output names PowerShell and Git Bash alternatives. Escape, Ctrl-C or Ctrl-D exits 130; before the profile is picked no
configuration is saved, and a managed directory or a Claude sign-in that already happened is
listed, never described as undone.

### `init`

```sh
wachiman init [--mode github|local|both] [--project-kind monorepo|single] [--operator <login>] [--version <tag>] [--path <file>] \
  [--force] [--dry-run] [--pr-template | --no-pr-template] [--no-agent-pointer] [--yes] [--json] [--repo-dir <dir>]
```

First-time setup of a repository. `--mode github` writes the maintained caller workflow
(`templates/wachiman-review-caller.yml`) to `.github/workflows/wachiman-review.yml` with your
`operator:` and the release tag you pin, and a one-line header that says Actions is billed through
the repository secret `ANTHROPIC_API_KEY` while local runs use your signed-in `claude`. `--mode
local` writes no workflow; on a terminal it continues directly into account selection and saves the
binding without a second question. `--mode both` writes the workflow and then continues into the same
account setup. Without prompts, local/both prints the command to run `setup` separately; it does
not log in or bind an account. Choosing local/both already requests setup, so no second general
invitation is shown. Standalone `setup` keeps its opening invitation. Init never commits, pushes,
opens a PR or creates a secret.

`init` also records what kind of repository this is, in `.wachiman.yml` (not under
`.github/workflows/`, where GitHub would parse it as a workflow). On a terminal it asks "What kind
of repository is this?" (Monorepo, Single project, or Distributed repository, which is listed as
coming soon and cannot be picked); `--project-kind monorepo|single` answers it. The kind is
metadata only, and the file never chooses an account, a profile
or a binary ([ADR 0048](adr/0048-a-repository-settings-file-at-the-root-wachiman-yml.md)). It applies
in all three modes. Without a terminal and without `--project-kind` the file is not written or
changed. A new file holds two comment lines, `kind: monorepo` (or `single`), and `model` and `effort` commented out under a line saying Wachiman's defaults are what its benchmarks measure (`init` never asks for them; see [configuration](configuration.md#the-settings-file-wachimanyml)). The same kind
leaves it untouched (`.wachiman.yml already says kind: X.`); a different or missing `kind:`
line is replaced or appended, every other line kept, after a confirmation on a terminal or with
`--force` without one. `--dry-run` never writes it and prints `would write .wachiman.yml
(kind: X)` on stderr, in every mode. Init does not commit it: the closing steps say to add it with the workflow
(`local` mode: to commit it).

`init` also writes a short pointer to the `wachiman-loop` skill into the repository's agent instruction
file: `AGENTS.md` when it exists, else `CLAUDE.md` when it exists, else a new `AGENTS.md`. The pointer is
two lines between the markers `<!-- wachiman:begin -->` and `<!-- wachiman:end -->`. It says that reviews
run with that skill, which [`skills install`](#skills) puts in place, and that repository memory lives in
`.wachiman/memory/`. A re-run replaces the block between the markers and never adds a second one; text
outside the markers is kept as it is. A file with CRLF line endings gets the block with CRLF. A link (`CLAUDE.md` pointing at `AGENTS.md` is common) is written
through to its target when the target is inside the repository; a link that leaves the repository or does not resolve is
skipped. The pointer never fails `init`: a file whose markers are not one pair, in order, on lines of their own, a skipped
link, or a failed write is reported on stderr with how to add the block by hand, and `init` keeps its exit code for
everything else it did. It is written in every mode, after the workflow and the settings file. Without a terminal it is written with no question; on a terminal `init`
shows the block and asks (default yes), and a no or a cancel at that question leaves the file as it was.
`--no-agent-pointer` skips it. `--dry-run` writes nothing and prints what it would write (or skip) on stderr.
Init does not commit it.

The Git worktree is validated before questions. Interactive stages identify the project, project
type, review mode, configuration, the Claude account when relevant, and checks/next actions. The route total
appears once the mode is known: 5 steps for `github` and for `local`, 6 for `both`. A non-empty `NO_COLOR`, `TERM=dumb` and non-terminal
output disable styling; prompts and status stay on stderr. JSON results and dry-run workflow
bytes on stdout are unchanged.

Questions on a terminal: the repository kind, the review mode, and, for `github` and `both`, your
GitHub username, prefilled with the account `gh` is signed in as (`gh api user --jq .login`; no
default when `gh` is missing or fails) and phrased with its profile URL, `https://github.com/<username>`.
Only that person's `/wachiman` comments start a paid run. The release tag (the version of this CLI,
`DEFAULT_WORKFLOW_REF`) and the workflow path (`.github/workflows/wachiman-review.yml`) are not asked;
`--version` and `--path` still override them. The tag is asked only when a build has no bundled release.

In every mode a last question, "Also install the PR description template?" (default yes), is asked unless
`--pr-template`, `--no-pr-template` or `--dry-run` settles it.

Running `init` again after a failure is safe. If the workflow file already holds what init would
write (the generated header line, which carries a date, is ignored), init says it is unchanged and
continues; the same holds without a terminal. If it differs, a terminal shows the new file and asks
`Replace the existing workflow? A .bak copy is kept.` (default yes: the person is running init again
on purpose and the earlier file is kept); without a terminal it still needs `--force` and exits 2
without it.

If the final Claude sign-in check fails, everything is already saved and the session closes with a
neutral message, not `Stopped.`: `Saved. One step left: sign in to Claude (`claude auth login`), then
run `wachiman init` again or `wachiman doctor`.` For the current session it adds that a shell alias
or function that sets `CLAUDE_CONFIG_DIR` is invisible to Wachiman and says how to register that
directory with `wachiman profile add`. The exit code stays 1.

A written workflow is reported as `github: pending`: add `ANTHROPIC_API_KEY` and submit the workflow
in GitHub. Init does not check those remote actions. Both mode reports this separately from local
readiness. If later account setup is cancelled or fails, the confirmed workflow stays and the
message says so. If that setup ends without saving a binding, init prints the `wachiman setup`
command that binds the repository later.

| Flag | Rule |
| --- | --- |
| `--mode` | Mandatory without a terminal |
| `--project-kind <kind>` | `monorepo` or `single`; `distributed` is refused as not available yet. Written to `.wachiman.yml` in every mode. Asked on a terminal when absent; without a terminal and without it, the file is not touched |
| `--operator <login>` | Mandatory for `github` and `both` without a terminal; a GitHub login |
| `--version <tag>` | `vX.Y.Z` or a 40-character commit SHA, written after `review.yml@`. Default: the release tag bundled in this build (`DEFAULT_WORKFLOW_REF`, moved by release-please at each release commit); the CLI's own version is never used as a tag |
| `--path <file>` | Default `.github/workflows/wachiman-review.yml`, relative to the repository top level (also when run from a subdirectory); a `.yml` or `.yaml` file directly in `.github/workflows/` |
| `--force` | Replaces an existing workflow after copying it to `<file>.bak-<YYYYMMDD-HHMMSS>` (an existing backup is never overwritten); without it, an existing file that differs is exit 2 (one that is identical is reported unchanged). With `--project-kind` it also lets a run without a terminal change a different `kind:` in `.wachiman.yml` (no backup; only that line changes), and it is accepted in `--mode local` for that |
| `--dry-run` | Writes nothing. With `--mode github` or `both` it prints the rendered workflow to stdout. With `--mode local` there is no workflow: it reports on stderr that it would write `.wachiman.yml` (when `--project-kind` is given) and that `--pr-template` would install the template, and exits 0. The agent pointer is previewed on stderr in every mode. When there is nothing to write (neither flag, and the pointer is skipped, already in place or turned off with `--no-agent-pointer`) it prints `dry run: nothing would be written` and the `setup` command to run next, on stderr. It writes nothing in the repository or in the Wachiman home |
| `--pr-template` / `--no-pr-template` | Also install the [PR description template](pr-template.md) (`wachiman pr-template install`, files only, no commit), in any mode; or do not. On a terminal, without either flag, `init` asks (default yes); a script that gives neither gets no template. A refusal (a hand-edited template, an invalid `.github/pr-template.json`) is reported and does not fail the rest of `init`. `--dry-run` installs nothing |
| `--no-agent-pointer` | Do not write the pointer into `AGENTS.md` or `CLAUDE.md` (see above). For a repository whose team has not adopted Wachiman, where a shared instruction file must not change |
| `--yes` | No prompts |
| `--json` | Never prompts, even on a terminal, and prints exactly one `wachiman.init/1` document on stdout (see [below](#init---json)). Every human status line goes to stderr. A missing `--mode` or `--operator` is a usage error printed as that document, exit 2 |

`--mode local` with `--operator`, `--version`, `--path` or `--force` (unless a kind is given with `--project-kind` or answered on a terminal) is exit 2; `--dry-run` is allowed. A
`.github`, `workflows` or target that is a symbolic link is refused. On a terminal the file is
previewed on stderr and `Write it?` is asked first; Escape, Ctrl-C or Ctrl-D exit 130 and write
nothing.

#### `init --json`

`--json` is for a program, such as a coding agent, that runs `init` and reads the result. It never
asks a question: a missing answer is a usage error, not a prompt. Stdout holds one document, for a
result and for a failure, and nothing else; the status lines (`wrote ...`, the next steps) go to
stderr. The exit codes are the same as without `--json`.

```json
{
  "format": "wachiman.init/1",
  "ok": true,
  "mode": "both",
  "dryRun": false,
  "repoDir": "/path/to/repo",
  "files": [
    { "path": ".github/workflows/wachiman-review.yml", "action": "created" },
    { "path": ".wachiman.yml", "action": "unchanged" }
  ],
  "local": { "status": "pending", "pending": ["wachiman setup --profile <name> --yes --repo-dir /path/to/repo"] },
  "github": { "status": "pending", "pending": ["add ANTHROPIC_API_KEY secret", "commit and open a PR"] },
  "error": null
}
```

- `files` lists each file `init` considered, relative to the repository top level, in this order: the workflow, `.wachiman.yml`, the PR description template (and `.github/pr-template.json` when it was written), the agent instruction file that holds the pointer (the file actually written, so the target of a link; `created` or `replaced` for an added or updated block, `refused` when it was skipped or failed, nothing when `--no-agent-pointer`). `action` is `created`, `replaced`, `unchanged`, `would-create`, `would-replace` (the last two only with `--dry-run`) or `refused`. A dry run reports `ok: true` and exits 0 even when a file is `refused`. A refused workflow or `.wachiman.yml` (one that differs, without `--force`) means the real run would stop with exit 2; a refused PR template is reported and the real run continues. `backup` names where the earlier file was kept. In a dry run, the rendered workflow is in that entry's `content`.
- `local.status` and `github.status` are `pending` or `not-used`: `init` alone never makes either side ready. `not-used` means the mode does not include it. `init` never binds an account without a terminal, so `local` is `pending` for `local` and `both`, with the exact `wachiman setup` command to run (replace `<name>` with a profile). `github` is `pending` for `github` and `both`: `init` neither checks nor creates the secret and never commits, pushes or opens a pull request.
- On a usage error, `ok` is `false`, `error` is `{ "code": "usage", "message": "..." }`, `files` lists what was already written or refused (empty when nothing was), and the exit code is 2. Any other failure has `"code": "failed"` and exit 1. When `--repo-dir` itself is the problem, `repoDir` is that value resolved to an absolute path.
- Running the same `init --json` again reports every file `unchanged` and leaves the repository as it was.

### Interactive launcher and intro

`wachiman` with no arguments opens a menu when stdin, stdout and stderr are all terminals and `CI`
is unset. Otherwise it prints the usage as before. The menu offers: Review changes, Ask about
changes, Review loop, Findings & usage, Configure and Exit. Review and Ask first ask for a scope
(this branch against the base, one commit, staged changes, or the whole working tree).

Before anything that spends your subscription, the launcher shows the repository, the scope, the
profile and the exact command it will run, then asks `Run it?`. Declining runs nothing and returns
to the menu; Escape or Ctrl-C exits 130 with nothing run. The launcher closes its prompt and then
runs the same command handler you would get by typing the command.

On a terminal the menus are drawn with [Clack](https://bomb.sh/docs/clack/packages/prompts/) (the
screens of `npm create astro`): arrow keys move the highlight, Enter confirms, Escape or Ctrl-C
cancels, and the lists of branches and profiles are filterable (type to narrow the list; the last
entry of the branch list lets you type any other branch or commit). The session is one frame:
a title line, the questions and their answers, status lines, a "Next steps" note, and a closing line.
A slow check (the account probe of `setup`) runs behind a spinner and never freezes it. Without a
terminal the menus are numbered lists and the prompts read lines, exactly as before.

On a terminal, `init`, `setup` and the launcher open with Wachi, the guard: a ` wachiman ` chip with
"On watch." and the version, a small rounded face under a peaked cap, with the name `Wachi:` beside the cap and a line typed
beside the eyes (for example `Shift started. Let's watch this repo.`); on a narrow terminal the name
and the line go under the face. The typing takes under a second and any
key skips it; Ctrl-C ends the session. The same scene is printed at once, with nothing typed, when
stdin or stderr is not a terminal, `NO_COLOR` is non-empty, `CI` is set, `TERM=dumb`, the terminal
is narrower than 40 columns, or `WACHIMAN_NO_ANIMATION` is set. With `NO_COLOR` or `TERM=dumb` the
scene has no color (and no non-ASCII character on `TERM=dumb`). The cursor is restored on every exit
path, including Ctrl-C. A command that the launcher starts does not repeat the intro.

Nothing here changes what a command does: the same defaults, files, `--yes`, `--json`, `--dry-run`
and exit codes apply, prompts and status stay on stderr, and no prompt or animation appears outside
a terminal. `CI` set (to anything) also keeps the launcher and the animation off, and `init` and `setup` do not ask when `CI` is `true` or `1`. The terminal screens use the packages `chalk` and `@clack/prompts`
([ADR 0002](adr/0002-typescript-on-bun-zero-dependencies.md), amendment 2026-11-13); the review
engine and the GitHub Actions path never load them. A clone that never ran `bun install` runs every
command; only a terminal screen stops, with a message that names `bun install`, and `--yes` or flags
skip it.

### `upgrade`

```
wachiman upgrade [--check] [--repo-only] [--to <version>] [--repo-dir <dir>]
```

The caller workflow pins an exact release (`uses: niway-dev/wachiman/.github/workflows/review.yml@v1.17.0`), <!-- x-release-please-version -->
so a new release never reaches CI without a change you review. `upgrade` makes that change one command, in two steps.

1. **The CLI.** It reads the latest version with `npm view wachiman version`, then installs it with the package manager
   that owns the global install: `bun add -g wachiman@latest` when the package sits under `~/.bun/install/global`,
   `npm install -g wachiman@latest` when it sits under npm's global prefix (`npm prefix -g`). A custom Bun home
   (`$BUN_INSTALL/install/global`) counts as bun. An install made with pnpm, yarn or volta is not driven: the command
   names the path and says to update it with that tool, then run `wachiman upgrade --repo-only`. On
   Windows the package manager is started through a shell so that `npm.cmd` and `bun.cmd` are found. The package manager runs with your terminal. A clone or a `wachiman-dev`
   build is never upgraded: the command says to `git pull` or run `scripts/dev-build.sh`. A CLI that is already on the
   latest version installs nothing.
2. **The repository.** In the current git repository it rewrites the `@<tag>` of every such `uses:` line in
   `.github/workflows/*.yml` to the new version and prints the files it changed and the commands to commit them
   (`git add …`, `git commit -m "chore: pin Wachiman to vX.Y.Z"`). The rest of each file stays byte for byte the same,
   and nothing is committed. A pin that is a commit SHA, a branch, a floating tag or a pre-release is listed and left alone,
   and a pin newer than the target is never moved down.

If step 1 is skipped (a clone, or an install this command does not drive), step 2 runs only when you pass `--to`;
otherwise it is skipped and the output says why. If step 1 fails, step 2 does not run, even with `--to`: the pins stay.
When a pin moves across a major version, the output asks you to read the release notes before committing.

- `--check` prints the installed and the latest version and changes nothing.
- `--repo-only` skips step 1 and pins the installed version (or `--to`); use it after upgrading the CLI another way, or
  when `wachiman doctor` reports the `workflow-pin` row as older than the CLI.
- `--to <version>` (`v1.2.3`) installs that release instead of the latest and pins it. It never downgrades the
  CLI: when the installed version is the same or newer, nothing is installed and only the pins move to the version
  you named (a pin newer than it is still never moved down). If the install fails, for example for a version that
  does not exist, the pins stay where they were and the exit code is 1; with `--repo-only --to` no install is
  attempted and the pins move.

A workflow file that cannot be read, or an unreadable `.github/workflows` directory, is listed on stderr and gives exit
code 1, because its pin was not checked. `--check` says so when the installed version is not a release version and
cannot be compared.

Exit codes: 0 done, nothing to do, or a clone that was not upgraded; 1 the package manager failed, a version could not
be read, or a workflow file could not be read or written; 2 a usage error.

### `skills`

```
wachiman skills install [--dir <path>]… [--json]
wachiman skills uninstall [--dir <path>]…
```

`install` copies `skills/wachiman-review`, `skills/wachiman-loop` and `skills/wachiman-audit` (copies, not symlinks) into
`~/.agents/skills` and into the `skills` folder of every Claude Code configuration directory that
exists: `~/.claude`, each `~/.claude-*` directory and `$CLAUDE_CONFIG_DIR`. `--dir <path>` adds a
skills directory of your own and may repeat. It makes no model call and no request.

`--json` belongs to `install`: it prints `wachiman.skills/1` on stdout, one entry per copy, with
action `installed`, `preserved` or `failed`. `uninstall --json` is a usage error (exit 2).

Each copy gets a `.wachiman-skill.json` marker (`wachiman.skill-install/1`: the version, the time
and the SHA-256 of every installed file). The marker is how Wachiman tells its copies from yours:

- A copy whose marker is intact and whose files are unmodified is replaced by the new version.
- A copy without a marker (your own skill of that name, a symlink such as the one
  `scripts/install-local.sh` makes for contributors, or a plain file), and a marked copy with a file
  you edited, are left exactly as they are, and each one is warned about on stderr. A symlink is
  never followed.
- Any target under the Wachiman home (`~/.wachiman`, or `WACHIMAN_HOME`), as written or through a
  symlink, is refused with exit 2 before anything is written. That includes a `CLAUDE_CONFIG_DIR`
  that points at a managed profile.

`uninstall` removes only the files that the marker lists and whose content still matches. An edited
file, a file you added and anything that is not a marked copy stay, with a warning; empty folders it
leaves behind are removed. Each removed copy is printed as `removed <path>` on stdout; warnings
always go to stderr.

Exit codes: 0 done (copies left in place are warnings, not failures), 1 a copy could not be written
or removed, 2 usage error or a refused target.

### `pr-template`

```
wachiman pr-template show    [--from <json>]
wachiman pr-template install [--from <json>] [--force] [--commit]
wachiman pr-template status  [--json]
wachiman pr-template check   [<file>] [--pr <n>] [--repo <owner/name>] [--title <t>] [--head <sha>] [--base <ref>] [--allow-breaking]
wachiman pr-template format  [<file>] [--write]
wachiman pr-template risk    [--base <ref>]
wachiman pr-template strip   <file>
```

Generates `.github/pull_request_template.md` from a section catalog and an optional
`.github/pr-template.json`, then checks and reorders pull request descriptions against it. No model
call, and no GitHub request except `check --pr`, which uses `gh`. `--repo-dir <dir>` points every
subcommand at another clone. `install` writes files only and never pushes; `--commit` makes one
commit of the files it wrote. `wachiman init --pr-template` runs the same install. Exit codes: 0
done or passing, 1 a finding (`check`) or a state that is not `current` (`status`), 2 a usage or
configuration error. The whole guide, with the states, the findings and the risk rules, is
[pr-template.md](pr-template.md).

### `memory`

```
wachiman memory check [--repo-dir <dir>]
wachiman memory archive <id> [--repo-dir <dir>]
wachiman memory report [--since <date>] [--format terminal|json] [--repo-dir <dir>]
wachiman memory candidates [--format terminal|json] [--repo-dir <dir>]
wachiman memory add --kind convention|exception --scope <glob> --rule <text> --why <text> [options]
wachiman memory show <id> [--repo-dir <dir>]
wachiman memory propose <id> [--repo-dir <dir>]
wachiman memory remember <pr> [--repo-dir <dir>]
```

Repository memory is a set of Markdown files in `.wachiman/memory/` at the repository root
([ADR 0056](adr/0056-repository-memory-lives-in-wachiman-memory-and-changes-only-through-one-draft-pull-request.md),
[the design](specs/2026-11-18-repository-memory-design.md)). The folder name is fixed.

- `index.md` is always loaded. It holds repository-wide entries and a table that maps a path glob to
  an area file, one row per file: ``| `apps/desktop/**` | `apps-desktop.md` |``.
- An area file is loaded only when its glob, in that table, matches a path the review reads. A file
  the table does not list is never loaded.
- `archive.md` is never loaded.

An entry is a heading `### <id> <title>` followed by fields:

```markdown
### 4c1e9a2 ADR wording edits do not need a status or date bump

- kind: exception
- scope: docs/adr/**
- rule: Only a change to the Decision section requires updating the status line.
- why: ADRs version themselves when a decision changes, not on every wording edit.
- holds while: docs/adr/README.md
- evidence:
  - 2026-11-18 operator instruction, pull request 709
- added: 2026-11-18
```

`kind` is `convention` or `exception`; `scope` is a glob (or several, separated by commas); `holds while`
is optional: a comma-separated list of path globs. When the diff touches one of them, the entry is flagged as possibly out of date and mutes nothing in that review. The `id` is the first seven hex characters of a SHA-256 digest of the kind, scope, rule,
why and `holds while` text with whitespace collapsed. Evidence and the date are not part of it, so adding
evidence keeps the id. `check` reports an entry whose heading id is not its digest. The example's id is illustrative.

**What a review does with memory.** Memory is read from the base commit only: the
merge-base for `local`, the pull request's base commit in Actions, so an entry added or changed by the
change under review has no effect on it. The review loads `index.md` and the area files its changed
files select, within `memory.max_loaded_lines` (most specific glob first; files that do not fit are
left out), and records it: the JSON result (format /2; the /1 result has no such field) carries a `memory` object with the revision (the base commit),
the files loaded, the files left out and whether the memory was over budget. When it was, the summary
says so and names what was left out. A repository without `.wachiman/memory/` is reviewed exactly as
before, with no extra field, no extra text and no extra call. The settings are in
[configuration.md](configuration.md#the-settings-file-wachimanyml).

- **Conventions** go into the review prompt, in a section labelled "Learned conventions" that follows the
  hand-written instruction files. When a hand-written file disagrees with a convention, the hand-written
  file wins, and the model is asked to say in its summary which entry it set aside.
- **Exceptions** never go into a prompt that looks for findings. The whole diff is reviewed without
  them. Afterwards, one small model call (the *matching call*) compares the candidate findings with the
  exceptions whose `scope` covers a finding's path. It is made only when there is at least one such
  exception and at least one finding of severity Consider or Info whose topic is not security; otherwise no call is made. It runs
  after verification, so it sees each finding's final severity, and it counts as a call of the review
  (its cost is in the totals). Its money is reserved out of the budget before the batches run, whenever an exception can apply: `$0.25`, or a quarter of the budget left after the verifier's reserve when that is less, so a small budget shrinks the reserve. The call's own cap is `$0.25`, or the budget still unspent when it starts when that is less; below the minimum batch budget it is not made, and every finding is posted with a notice that matching did not run.
- **The floor is in the engine, not in the prompt.** Only a Consider or Info finding can be muted. A
  Blocker or Fix finding, and a finding of any severity with the security topic, are never offered to the
  matching call, and if its answer names one anyway the engine posts the finding with a note naming the
  exception that tried to mute it. An answer that names a finding or an entry the engine did not offer, or
  an entry whose `scope` does not cover the finding's path, is ignored. An exception cannot change which
  files a review reads.
- **A muted finding is listed, never silent.** It is not posted as a comment. The summary lists it under
  "Muted by memory" with its title, its location and the id of the entry; the section is absent when
  nothing was muted. The JSON result carries the same list in `muted` (result format 2 only).
- **Fails open.** When the matching call fails, stops or answers something that cannot be read, nothing
  is muted and the summary says that matching did not run.
- **`holds while`.** When any loaded entry, convention or exception, has a `holds while` line and the
  diff touches one of those paths, the summary names the entry (id and title) and says it may be out of
  date, once per entry, whether or not the entry's own scope reaches the diff. An exception in that state
  also mutes nothing in this review. The line is absent when no entry applies, and a repository without
  memory sees no change. Wachiman only says so; it never edits the entry.

**What it does not do yet.** Personal memory (`--personal`) and the `/wachiman remember` command in
Actions are later layers.

`memory check` reads the folder from the working tree and prints each problem as
`<path>:<line>: <message>`: a malformed entry, an entry id that is not its digest, an entry scope (not checked in
`archive.md`, which no review loads) or an index glob that matches no file of the repository, an index row that names a missing file, an area file
the index does not list, a missing `index.md`, an `index.md` over `memory.max_index_lines`, and an area
file that cannot fit beside the index within `memory.max_loaded_lines`. No model is called and nothing
is written. Exit codes: 0 clean, or no memory folder; 1 problems found; 2 a usage error or an invalid
`.wachiman.yml`.

**Hygiene suggestions (layer 6).** After the problems, `memory check` prints suggestions on standard
output, one `suggestion:` line each, then a line saying nothing was changed. Suggestions are never
problems: they do not change the exit code, and Wachiman never applies one. No model is called.

- *Likely duplicates.* Two entries of the same kind (both conventions or both exceptions) in the live
  files, not `archive.md`, whose scopes overlap and whose `rule` text is near-identical. Overlap is
  judged from the literal part of each glob before its first wildcard: one prefix contains the other
  (`src/**` and `src/api/*.ts` overlap, `src/**` and `docs/**` do not), so it can say two scopes
  overlap when no real path matches both. Near-identical means the lowercase word sets of the two
  rules share at least 80% of their combined words (size of the intersection over the size of the
  union). The threshold is fixed, not a setting.
- *Contradictions are not detected.* Telling that two rules disagree needs a model, and `check` calls
  none. Only duplicates are found deterministically.
- *Archive suggestions.* An entry whose last use is more than `memory.archive_after_days` (default 90)
  days before today. An entry with no recorded use is measured from its `added` date, or from the day the
  record began if that is later (the record keeps the date of its first recording), and reported as "no use
  recorded on this laptop", which is all the record can say (a use in a pull request review is not in it). When the
  record itself is missing or cannot be read, the use of every entry is unknown: `check` makes no archive
  suggestion and, if some entry is older than the limit by its `added` date, prints one `note:` line saying so
  and why (no record yet, or what made it unreadable); it never calls such an entry unused. An unreadable record
  is left as it is. A use is recorded
  when a laptop review (`wachiman local`) runs with history on (`--history`, ADR 0020), loads memory and an entry was used: a convention whose scope
  matches a file of the diff (it was in the prompt for that diff), or an exception that muted a finding.
  A review that loads memory with history on creates the record even when no entry was used, so "nothing used"
  is known and "no record" is not mistaken for it.
  The record is entry id and date, per repository, in `<home>/history/<repository
  key>/memory-use.json`, written with mode 0600. It exists only on the laptop. **With history off, or in GitHub Actions
  where nothing persists between runs, no use is recorded; archive suggestions need history on, and `check` makes none
  when `GITHUB_ACTIONS` is `true`;** an entry used only in pull request reviews looks unused to
  the laptop. Forgetting the history (`wachiman history --forget`) forgets the record, and every entry
  is then unknown until the next laptop review with history on records one.

`memory archive <id>` moves the entry's own lines (its heading, fields and their continuations), unchanged, from its file to `.wachiman/memory/archive.md`
(created when absent), which no review loads. It runs only when you ask. It changes the working tree
only: nothing is committed, pushed or put in the memory pull request, because the propose write path
builds a commit on `wachiman/memory` around a new entry and has no step for "apply this change to
that branch". Commit the change yourself. An unknown id, or one already in `archive.md`, changes
nothing and exits 1.

**Capturing memory on the laptop (layer 3).** No model is called by any of these commands. The
developer's coding agent drafts an entry from the code and the owner's intent, hands it over with
`memory add`, shows the owner the exact text with `memory show <id>`, and runs `memory propose <id>`
only after the owner approves it.

- `memory add` stores a *candidate* under the Wachiman home (`<home>/memory-candidates/<repository
  key>/`, keyed like the local history) with its first piece of evidence. The fields come from flags or
  from `--file <json>` (`kind`, `scope`, `rule`, `why`, `holdsWhile`, `title`; a field that is not a
  string is refused, flags override the file). Besides the four required flags `--kind`, `--scope`,
  `--rule` and `--why`, `--holds-while <paths>` names the paths a fact the reason depends on lives in
  (for an exception), `--title <text>` sets a short heading (default: the start of the rule) and
  `--branch <name>` names the branch an instruction came from (default: the current branch). The id is the digest of
  kind, scope, rule, why and `holds while`, so adding the same entry again only adds evidence. There
  are three sources. `--source instruction` (the default) is an explicit instruction with a reason, from
  the current branch or `--pr <n>`; it is proposable with one piece of evidence. `--source judged` and
  `--source fixed` need `--finding <id>`: the evidence is checked against the local loop history (a
  `wrong` verdict with a reason, or the loop's `probably-fixed` mark) and its reference is the loop's
  branch or `--pr`. A fix supports only a convention, never an exception. Reactions and silence are
  not a source. `--agent` records that an agent wrote the reply.
- `memory candidates` lists them and says which can be proposed: a candidate found by the tool needs
  `memory.min_evidence` pieces of evidence (default 2) from different pull requests or branches;
  `--format json` prints `wachiman.memory-candidates/1`. `wachiman loop --format json` adds a
  `memoryCandidates` list (`id`, `title`) when a proposable candidate that has not been proposed yet
  cites a finding of the loop or its scope matches a file of one (a candidate already proposed is left
  out); with none, the output has no such key.
- `memory show <id>` prints the entry as it will be written, evidence and `added` date included. The
  text is printed as it is stored, so it is the text `propose` commits: a control character, a
  zero-width or direction-changing character in any field, or an id that is not the digest of the
  fields, is refused by `add`, `show` and `propose`, because a terminal could display it differently
  from what is committed. A value that starts with `--` is written `--rule=--strict`.
- `memory propose <id>` fetches `origin`, builds one commit in a temporary worktree on the head of
  `origin/wachiman/memory` (the default branch when that branch does not exist or was already merged),
  appends the shown text to `.wachiman/memory/index.md` (created when absent), pushes without force, and
  opens the draft pull request `chore(wachiman): memory` unless one is open. Your branch, index and
  uncommitted changes are not touched, and only files under `.wachiman/memory/` can be written. A
  colleague who pushed first is handled by fetching and applying the same entry on the new head (up to
  five attempts in all). An entry whose id is already on the branch is not written twice: your evidence lines
  are added to it. If the pull request for the branch was closed without merging, it says so and writes
  nothing until a person reopens it or deletes the branch; when the pull request was squash-merged but `wachiman/memory` still holds commits the default branch lacks, it refuses too, and the branch on origin has to be deleted. Before committing it runs the same checks
  as `memory check` on the resulting files and refuses an entry that would add a problem (for example
  a scope that matches no file). **It runs none of your git hooks for the worktree, the commit or the push** (`pre-commit`,
  `commit-msg`, `pre-push`, `post-checkout`): `core.hooksPath` points at an empty folder for those
  calls. The `ls-remote` and `fetch` it runs in your own checkout are ordinary git calls, so a hook
  such as `reference-transaction` can still run there. The commit touches only `.wachiman/memory/`, the temporary worktree has none of your
  installed tooling, and a hook that rewrites files would break "written as shown". Policy the
  repository enforces on the server (branch protection, required checks on the pull request) still
  applies; a policy that needs a local hook to pass cannot be met by this command, so propose through
  your own checkout instead. It uses your git credentials and `gh`, and prints `recorded` only after
  the push succeeded. Running it again for an entry already on the branch writes nothing but still
  opens the draft pull request when none is open. Exit 1 when it refused or failed, and also after
  `recorded` when only the draft pull request could not be opened (the entry is on the branch; open
  the pull request by hand or run the command again).

**Measuring what memory does (layer 7).** `memory report` prints what the local history says,
without calling a model. It writes nothing, except that a run file in the history that cannot be read is set aside under a new name (with a warning), as in every command that reads the history:

```
wachiman memory report [--since <date>] [--format terminal|json] [--repo-dir <dir>]
```

The default is one row per month (UTC) and a total row. `--since 2026-11-01` keeps the runs saved on
or after that day. With no history in the window it prints `No review history ...` and exits 0; a
`--format json` run then prints the document below with `"empty": true` and no periods.

- **Comments by outcome.** A comment is a finding a run posted, counted once, in the month of the
  run that first saw it, by its outcome today: `wrong`, `intentional` or `not important` when you
  judged it (`wachiman history --verdict`); else `fixed` when the loop settled it as probably fixed
  (the cited code changed and the finding did not come back); else `unjudged`. A `correct` or
  `partial` verdict without a fix stays `unjudged`. A verdict wins over the loop's own settling.
- **Muted by memory.** The findings an exception muted in the period's runs, and, in the total row,
  how many each entry id muted.
- **Memory size.** The files, entries and lines of `.wachiman/memory/` in the working tree now (not
  per month), and, per month, the lines the month's last review loaded (`-` when none of its runs
  recorded memory).
- **Entries never used.** Read from the laptop's record of when each entry was last used (the
  `memory-use.json` file in the history folder that `memory check` also reads, so the two never
  disagree): an entry is used when that record has a last-use date for it, on or after `--since` when
  given, and not before the entry's `added` date. When there is no record, or it cannot be read,
  nothing is known about use: the text says so and the JSON has `"neverUsed": null` with
  `"neverUsedReason": "no-use-recorded"`, instead of listing every entry. A record that exists and
  has no dates (history was on, nothing was used) is a real answer: every entry is listed. An entry
  that is used often and wrong is not caught by this; the `holds while` notice is
  for that.

`--format json` prints `wachiman.memory-report/1`:

```json
{
  "format": "wachiman.memory-report/1",
  "since": null,
  "empty": false,
  "periods": [
    {
      "period": "2026-11",
      "comments": 4,
      "outcomes": { "fixed": 1, "wrong": 1, "intentional": 0, "notImportant": 1, "unjudged": 1 },
      "muted": { "count": 3, "byEntry": { "4c1e9a2": 2, "0f3a9b1": 1 } },
      "memoryLoadedLines": 40
    }
  ],
  "total": { "period": "total", "comments": 4, "outcomes": { "...": 0 }, "muted": { "count": 3, "byEntry": {} }, "memoryLoadedLines": 40 },
  "memory": { "present": true, "files": 3, "entries": 4, "lines": 62 },
  "neverUsed": [{ "id": "4c1e9a2", "title": "...", "kind": "exception", "scope": "docs/**", "file": "index.md" }],
  "neverUsedReason": null,
  "useRecordedSince": "2026-10-20"
}
```

The figures are illustrative. `since` is a string or `null`; `memoryLoadedLines` is a number or `null`; `neverUsed` is a list or `null`, and `neverUsedReason` is `"no-use-recorded"` exactly when it is `null`; `useRecordedSince` is the day this laptop began recording use, or `null`, and "never used" counts only from then;
`periods` is oldest first. Keys are only added in a new format version.

**Where outcomes are recorded.** On the laptop, `wachiman local --history` keeps every run, and
`wachiman history --verdict` keeps your judgement of each finding, under `~/.wachiman/history`; the
report reads both. Unrun, unjudged or pruned history (`WACHIMAN_HISTORY_DAYS`, 30 by default) simply
is not counted. In Actions nothing persists between runs, and Wachiman has no hosted store for it, so
the report cannot be built there. What a single Actions run can tell: the result it produced (`memory`
and `muted` in its JSON result), and, for threads it followed up, whether the code looks `addressed`
or the finding is `still_open`. What it cannot record: that a finding was fixed after the run, or
that you judged it wrong, intentional or not important, unless you reply in the thread, and nothing
adds a reply's classification across runs. To measure a repository that is reviewed in Actions, run
the [replay](memory-replay.md) on the laptop.

#### Capturing memory in Actions (layer 5)

Set the workflow input `memory_proposals: true`
([configuration.md](configuration.md#inputs)) and a reply Wachiman writes in a thread can propose an
entry. It does so only when the operator's latest reply in that thread is an instruction with a reason;
a collaborator's reply, a question, or "Fixed in" never leads to one. The model drafts only the fields
(kind, scope, rule, why and, for a fact about the code, `holds while`). The engine builds the entry,
gives it its id (the digest of those fields) and shows it in the reply, in a block between two hidden
markers that no model text can write:

```text
**Proposed memory entry** `4c1e9a2`. Nothing is recorded yet. This is the exact text that would be written:
(the entry, as `memory show` prints it, with the evidence line "operator instruction, pull request 709")
To record exactly this text, the operator replies `/wachiman remember 4c1e9a2` in this thread. ...
```

The proposing reply is an ordinary thread reply, so it counts toward the two replies Wachiman writes in
a thread ([ADR 0008](adr/0008-thread-follow-up-authority.md)). A reply that is only `/wachiman remember
<id>` is not a question: the thread run does not answer it and `/wachiman` on-demand runs ignore it, so it
costs no model call. The proposal is shown only by the thread-only run (an operator reply on a head that
was already reviewed); a push review that answers threads does not propose.

**Approving it: `memory remember <pr>`.** The operator's reply `/wachiman remember <id>` in that thread
starts a separate workflow, `wachiman-memory.yml`, with one job. It is the only Wachiman job that writes
to your repository, and it is a workflow of its own because a called workflow cannot hold a permission its
caller did not grant: a `contents: write` job inside `review.yml` would stop every caller that grants only
`contents: read`. The review workflow keeps `contents: read` and `pull-requests: write`. The write job
holds `contents: write` and `pull-requests: write`, passes no model key and calls no model. It does this,
in order:

1. It starts only for a reply by the `operator` login that begins with the command word and says
   `remember`, on a pull request whose head is in this repository. A comment from anyone else starts a
   skipped job, and the engine checks the login again: it writes nothing and posts nothing.
2. It reads the thread from GitHub and takes the proposal from Wachiman's own signed replies in that
   thread. Text a person wrote, in any thread, is never a proposal.
3. It checks that the shown text is exactly one entry whose id is the digest of its fields, that the id is
   the one the operator approved, and that writing it gives the shown text back byte for byte. If not,
   it writes nothing and says why in the thread.
4. It writes the text with the same path as `memory propose`: one commit on `wachiman/memory` that
   touches only `.wachiman/memory/`, and the draft pull request `chore(wachiman): memory` unless one is
   open. Nothing is active until a person merges that pull request.
5. It replies in the thread with what it did and never resolves the thread. This reply carries its own
   signature, not the thread-reply one, so it does not count toward the two replies Wachiman writes in a
   thread; the reply that proposed the entry does. Approving the same entry twice writes it once.

The repository is checked out at its default branch, never at the pull request, and the engine comes from
this repository at the version of the workflow. Add a second caller file next to the review caller. It
exists only from the first release that contains `wachiman-memory.yml`, so the pin below must be that release or later:

<!-- x-release-please-start-version -->
```yaml
name: Wachiman memory
on:
  pull_request_review_comment: { types: [created] }
permissions: { contents: write, pull-requests: write }
jobs:
  remember:
    uses: niway-dev/wachiman/.github/workflows/wachiman-memory.yml@v1.17.0
    with:
      operator: your-github-login
```
<!-- x-release-please-end -->

Three things to know before you rely on it:

- **The repository setting for pull requests.** A workflow token can open a pull request only when the
  repository allows it: Settings, Actions, General, "Allow GitHub Actions to create and approve pull
  requests". This was not verified against every GitHub plan or organization policy. When the setting is
  off, or an organization policy overrides it, the entry is still pushed to `wachiman/memory`, the thread
  reply says so and names the setting, and the job exits 1. Turn the setting on, or open the draft pull
  request from that branch by hand; the next `remember` for any entry opens it when none is open.
- **No CI on the draft pull request at first.** A push made with the workflow token does not start other
  workflows, so the pull request gets no check run until someone pushes to the branch or closes and
  reopens it. A required check will therefore wait.
- **Proposals come from the thread-only run.** Only the run that answers an operator reply on a head that
  was already reviewed shows a proposal. Without the caller above, a proposal can be shown but the
  approving comment records nothing; `wachiman memory propose <id>` on a laptop still works.

The command is `wachiman memory remember <pr>`. It reads `REQUEST` (the comment), `WACHIMAN_COMMENT_AUTHOR`,
`WACHIMAN_COMMENT_IN_REPLY_TO`, `WACHIMAN_OPERATOR`, `GH_TOKEN` and `GITHUB_REPOSITORY`, and uses the
checkout `--repo-dir` points at. Exit 0 when the entry is recorded or already was, or when the comment was
not the operator's; exit 1 when it refused, wrote nothing, or recorded the entry without opening the draft
pull request; exit 2 for a usage error such as a missing variable.

### `history`

`wachiman history` lists the findings that `local --history` kept for the repository of
`--repo-dir` (default: the current directory). It reads files and local git metadata only: the history files
under `~/.wachiman/history`, plus `git rev-parse` and `git remote get-url` in `--repo-dir` to find the
repository's key. It runs no `claude` and calls no GitHub. With no history, `--json` prints
`{"format": "wachiman.history-state/1", "repositories": []}` rather than a message.

| Option | What it does |
| --- | --- |
| `--since <n>d` | Only findings seen in the last `n` days |
| `--all-repos` | Every repository in the history, not just this clone's |
| `--json` | The replayed state as `wachiman.history-state/1` JSON (an internal format, like the files it reads) |
| `--verdict <id> correct\|partial\|wrong\|intentional\|not-important [--reason <text>]` | Record your judgement of a finding (the id is in the report and the listing); the listing shows it. `intentional` (the code is meant to be that way) and `not-important` (right, but not worth acting on) feed [`memory report`](#memory); the loop does not release a blocking finding for them, only for `wrong` with a reason. A verdicts file written before these words reads as before |
| `--forget [--all]` | Delete this repository's history, or all of `~/.wachiman/history`; prints what was removed. It takes no `--all-repos`, `--json` or `--since` (usage error) |

Exit codes: 0 listed, recorded or forgotten (a missing history prints one line and exits 0); 2 usage
error, including a `--verdict` id that matches no finding.

### `status`

`wachiman status` shows what this laptop kept of its local runs and what they cost, so you can see
where the spend goes. It reads the history files under `~/.wachiman/history` and, without
`--all-repos` or `--repo`, runs `git rev-parse` and `git remote get-url` in `--repo-dir` to find the
repository's key. It runs no `claude`, calls no GitHub and sends nothing; the only request it can make is the explicit `--refresh`, which downloads the spend ledger. Damaged history files
are moved aside with an `.unreadable-<timestamp>` suffix and a warning on stderr.

**What it covers.** Runs saved by `wachiman local --history` (or `WACHIMAN_HISTORY=1`) and, once
you have run [`wachiman ledger pull`](#ledger), the GitHub Actions runs recorded by the spend ledger.
Without a pulled ledger, Actions runs are not counted, so the total is the local spend, not
Wachiman's whole spend. The cost is Claude Code's `total_cost_usd`: an
API-equivalent estimate, not a bill. A new `--history` run deletes runs older than 30 days
(`WACHIMAN_HISTORY_DAYS`, `0` keeps them all), so the total reaches back at most that far.

| Option | What it does |
| --- | --- |
| `--since <n>d` | Only runs from the last `n` days |
| `--all-repos` | Every repository in the history, not just this clone's |
| `--repo <name\|key>` | One repository by name or key, from any directory; ambiguous names require a key |
| `--model <text>` | Only runs whose model id contains the text (`sonnet`, `claude-haiku-5-5`) |
| `--profile <name>` | Only runs made with that named account; older records without an account use the execution profile (`default`, `isolated` or `ci`) |
| `--by day\|week\|repo\|pr\|model\|profile\|source` | How the table groups runs (default `day`); repositories are grouped by their unique key; weeks start on Monday, UTC; `pr` groups ledger runs by pull request and laptop runs by "local branch" |
| `--source laptop\|actions\|all` | Only laptop runs, only GitHub Actions runs from the pulled ledger, or both (default `all`). `--profile` leaves out Actions runs, which have no profile |
| `--refresh` | Run [`ledger pull`](#ledger) first (the only request `status` can make); without it no request is made. A failed download warns and keeps the entries already on disk. With no ledger connected it exits 2 |
| `--json` | `wachiman.status/1`: the filters, totals, groups and every run with its attributes; with a pulled ledger also `report`, the one spend report with every figure split by source and credential, and `limitUse`, the day's and week's figure against the ledger limit. With a ledger `totals.costUsdEstimate` and `groups[].costUsdEstimate` are the sum of billed (API key) and estimated dollars, not an estimate alone: read `report.totals.byCredential` for the split |

Each run in the JSON carries `at`, `repositoryKey`, `repository`, `change`, `head`, `model`,
`effort`, `profile`, `engineVersion`, `costUsdEstimate`, `tokens` and `findings`, so any other
cut can be made with a JSON tool. A pull request number is not among them: a local run reviews a
branch or a commit.

With a pulled ledger the totals line separates billed dollars (API key) from estimated dollars
(subscription, API-equivalent, not a bill), shows the day's and the week's spend against the ledger
limits when the ledger reported them, and adds a "Not counted as spend" line for reservations that never settled and runs that were not
reserved. The limit lines are the whole account's figure (Actions runs only, best-effort, counting
settled runs, runs recorded without a reservation and dollars still held by reservations) over every
repository: `--repo`, `--all-repos`, `--model`, `--since`, `--profile` and `--source` never change them.
A limit period outside the downloaded days says "no data", not zero. `status` reads the downloaded day
files directly, not the index, so it answers on a read-only home. `--source actions` with no pulled
ledger exits 2 and says to connect one. Without a pulled ledger the output is the same as before.

Exit codes: 0 printed (with no run kept it prints one line saying how to start, and exits 0); 2
usage error.

### `dashboard`

`wachiman dashboard` shows what this laptop's local runs cost, how many findings they captured and how
the review loops went, for every repository in `~/.wachiman/history`. It first brings the index at
`~/.wachiman/index.sqlite` up to date by replaying the history files (a missing, corrupt, old-schema
or stale index is deleted and rebuilt; `status` reads the downloaded ledger files, not the index, and no other command reads it), then writes one static HTML file or
prints JSON. It runs no `claude`, calls no GitHub, starts no server and never opens a browser.
`--repo-dir` is accepted and not used. What it covers and cannot show: [the guide](local-dashboard.md).

| Option | What it does |
| --- | --- |
| `--json` | Print `wachiman.dashboard/1` on stdout ([schema](formats/dashboard.v1.schema.json)) instead of writing the page |
| `--out <file>` | Where to write the HTML page; default `~/.wachiman/dashboard.html`. Missing directories are created; the file is `0600`. The path is printed. Not allowed with `--json` |
| `--refresh` | Run [`ledger pull`](#ledger) first (the only request `dashboard` can make). Without it no request is made, and the credentials file is not even read. A failed download warns and keeps the entries already on disk. With no ledger connected it exits 2 |

With a ledger connected or pulled, the page replaces its spend sections with one view of laptop and
GitHub Actions runs: a chart of what the ledger counts against its limit per day and per week
(GitHub Actions runs only, with the limit drawn as a line), a separate chart of spend by source with
no limit line, tables per repository, pull request and model with runs, calls and
dollars, every figure split by source and by credential (billed API key, estimated subscription),
reservations that never settled and runs that were not reserved as their own lines, "no data" for any
period the downloaded days do not cover, and when the ledger was last pulled. With no ledger the
page is as before, plus one line saying how to connect one.

Exit codes: 0 written or printed (also with no run kept); 1 a loop file could not be read, or the index or
the page could not be written; 2 usage error.

### `ledger`

`wachiman ledger` connects the laptop to the spend ledger (the Worker of the daily spend limit) and
downloads its entries, so `status` and `dashboard` show GitHub Actions runs next to laptop runs
([ADR 0039](adr/0039-the-laptop-reads-the-ledger-and-one-report-covers-laptop-and-actions-runs.md)).
The laptop only reads, only when you configured it, and only on an explicit command: local mode
still sends nothing and makes no GitHub request.

This is the read side and is separate from the workflow's own ledger client. The workflow reserves and
settles dollars with `ledger_url` (`WACHIMAN_LEDGER_URL`) and a GitHub OIDC identity, and exits 3
when the ledger stops a run ([configuration.md](configuration.md), `src/ledger.ts`). `ledger connect`
keeps a different credential, a read token that can call only `GET /v1/entries`, in
`credentials.json` or `WACHIMAN_LEDGER_TOKEN`. Both clients name the same service with
`WACHIMAN_LEDGER_URL` (the workflow reads it in Actions, the laptop on a command), but the read token
is never sent by the workflow and the workflow's identity is never used by the laptop. Outside GitHub Actions the engine's spend client does not use `WACHIMAN_LEDGER_URL`: it does not reserve, settle or record, and a review runs with one stderr line saying the ledger is skipped because this is not a GitHub Actions run.

| Command | What it does |
| --- | --- |
| `ledger connect <url>` | Asks for the read token on standard input without echoing it, and writes `~/.wachiman/ledger/credentials.json` (`{url, token}`) at mode `0600`. The URL must be https (http only for loopback: `localhost`, `127.0.0.1` or `[::1]`) |
| `ledger disconnect` | Deletes that file. Entries already downloaded stay on disk |
| `ledger pull [--since <n>d]` | Calls `GET /v1/entries` for the last `n` days (default 35, at most 92) and writes one file per UTC day under `~/.wachiman/ledger/<account>/<day>.json`, replacing each day as a whole, so a second pull never stores an entry twice. It also stores the limits the ledger reported. Day files outside the pulled range are kept, and the covered days are the union of all pulls that touch or overlap; a day inside the range for which the ledger returns nothing has its file deleted, and the command prints how many. Stale `*.tmp-<pid>` files left by a crash are removed at the start. This and `--refresh` are the only requests |

`WACHIMAN_LEDGER_URL` and `WACHIMAN_LEDGER_TOKEN` override the file. The token is never printed,
logged, or written anywhere but the credentials file; it is not in the index or the dashboard page.
Only the account pulled last is read. Directories of accounts pulled earlier stay on disk (a disconnect
keeps entries) and are ignored, so figures and limits never mix two accounts.

The dashboard's index (`~/.wachiman/index.sqlite`) is rebuilt from the day files like the rest and
holds nothing the files do not; `status` does not use it.

Exit codes: 0 done; 1 the ledger could not be reached, refused the token or answered something
unexpected; 2 usage error, or `pull` with no ledger connected.

## What it posts

- `review`: one GitHub review with the event `COMMENT`, never an approval or a change request. Its
  first line says whether coverage is complete or partial, and it ends with a "Coverage by batch"
  table and a footer `<sub>{model label} · effort {effort} · {n} batches · ${cost}</sub>`; the
  `· {n} batches` part appears only when the review ran more than one batch. The footer names the
  provider and model, for example "Claude Sonnet 5.5 via Claude Code 2.1.304", and the reasoning
  effort the run used (`low`, `medium`, `high`, `xhigh` or `max`, [configuration.md](configuration.md#reasoning-effort)).
  The `· effort {effort}` part is **new in v1.4.0**: the footer of a v1.3.0
  review is `<sub>{model label} · {n} batches · ${cost}</sub>` and has no effort field. A finding on a line of the diff is an
  inline comment on that line; one on a line outside the diff goes in the body under "Outside the
  diff". Coverage is reported by the agent per file, not measured line by line.
  Right after the count line, a review carries a risk map (ADR 0031): a level (low, medium or high)
  computed by the engine from the path of each changed file and from the risk facts the batches
  report, each with a `path:line` the engine checks against the head; then the judgement items
  (at most three places a person must decide) and the files to read first. On a review of one
  push, the level line starts with "This push only."; a change with no facts gets the two-line
  form without a heading.
- A complete, unscoped review also ends with `<!-- wachiman sha=<head> -->`; the next
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
  Threads are not read when a review ends early as `Already reviewed` or `Nothing to review`. A
  reply on an unchanged head is answered by `threads`, which the workflow starts when the operator
  replies (see "What `threads` does").
- `comment` with a question: one pull request comment (not a review) holding the answer, written in
  the language of the question (English for a walkthrough), and a footer `<sub>{model label} · effort {effort} · ${cost}</sub>` (no batch count,
  since an answer is one call). As with a review, the `· effort {effort}` part is new in
  v1.4.0; v1.3.0 prints `<sub>{model label} · ${cost}</sub>`. The answer is one call over the whole
  diff and the latest review the engine wrote on the pull request (its body and its finding threads,
  open or resolved), with no batching and no coverage check, capped by `answer_budget_usd`. Each file
  and line reference the answer makes is checked against the head commit: a reference to a file that
  is not there, or to a line past its end, is removed, and the comment says how many. The others link
  to that line at the head commit. Without an earlier review the answer says so in its first
  section.
- With `WACHIMAN_DRY_RUN=1` it reads GitHub but prints instead of posting. It still calls the
  agent, so it still costs money.

Before posting, the engine refuses to post anything that contains something shaped like a provider
credential, and exits 1 with `The output contains something shaped like a provider credential; not
posting it.` This is a check for the provider's key and key-shaped strings, not a general secret
scanner. See [SECURITY.md](../SECURITY.md).

## Environment

Required for `review`, `comment` and `threads`:

| Variable | Meaning |
| --- | --- |
| `GH_TOKEN` | Token for `gh`. It is never given to the agent. Not read by `local`, `setup`, `doctor`, `profile` or `project`. |
| `GITHUB_REPOSITORY` | `owner/name` of the repository. Not read by `local`, `setup`, `doctor`, `profile` or `project`. |
| `REQUEST` | `comment` only: the comment text. Pass it through the environment, never interpolated into a shell command. |
| `WACHIMAN_COMMENT_ID` | Optional, for `comment` and `threads` on a review comment: that comment's id. With it, a question is answered in the comment's thread. |
| `WACHIMAN_COMMENT_IN_REPLY_TO` | Optional: the id of the comment this one replies to. The answer is posted as a reply under the thread's first comment. |
| `WACHIMAN_COMMENT_PATH`, `WACHIMAN_COMMENT_LINE` | Optional: the file and the line the review comment is on (`line`, or `original_line` when the line moved). The question is about that line first. |
| `WACHIMAN_COMMENT_AUTHOR` | Optional, for `comment` and `threads`: the login of the comment's author. When set and not the operator, nothing runs unless `WACHIMAN_ASKERS=write` (see [Questions from collaborators](#questions-from-collaborators)). |
| Provider credentials | For `claude-code`: `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` (a subscription token from `claude setup-token`; it wins when both are set, and `local` and `ask` never read it). For `codex`: `OPENAI_API_KEY`. Neither is needed with `WACHIMAN_DRY_RUN=1`, which uses the machine's own login. `local` uses the signed-in `claude` and refuses to start when `ANTHROPIC_API_KEY` is set. |

The `gh` CLI and the provider's binary (`claude` for `claude-code`, `codex` for `codex`) must be on
the `PATH`.

Read by the account commands and `local`:

| Variable | Meaning |
| --- | --- |
| `WACHIMAN_HOME` | The Wachiman home, an absolute path. Default `~/.wachiman` |
| `WACHIMAN_PROFILE` | The profile `local` uses when there is no `--profile` and no project binding |

`WACHIMAN_NO_ANIMATION` (any non-empty value) is read only by the intro of `init`, `setup` and the launcher: it
turns the typing off and prints Wachi's scene at once. `NO_COLOR` (non-empty) turns every color off in the help,
the menus and the intro, and `TERM=dumb` also switches to ASCII symbols.

All optional settings (`WACHIMAN_BUDGET_USD`, `WACHIMAN_MODEL`, `WACHIMAN_PROVIDER`,
`WACHIMAN_DRY_RUN`, `WACHIMAN_EXCLUDE`, `WACHIMAN_COMMENT_AUTHOR` and the rest) are in
[configuration.md](configuration.md#engine-settings), with their types, defaults, valid values and
which provider they apply to. Two things hold for every one of them: budgets and sizes must be
positive numbers (lines and chars, whole numbers), and anything else is a usage error.

### Deprecated names

`WACHIMAN_X` settings fall back to the old `CLAUDE_REVIEW_X` names, with a notice on stderr.
Installed copies can migrate one variable at a time; the new name wins when both are set. The
fallback covers the engine settings only: [configuration.md](configuration.md#deprecated-names).

### Repository files

The engine reads `.github/wachiman.md` (the review focus), the old
`.github/claude-review.md` name, `CLAUDE.md` and `AGENTS.md` from the pull request's base commit, so a pull request cannot
change the rules it is reviewed under. Details, size limits and what these files cannot do:
[configuration.md](configuration.md#repository-files). A YAML configuration file is not
implemented.

## Finding labels

Every finding is labelled on two axes, each an emoji followed by its word, and starts with a
**priority word** (Must, Should, Could or FYI; see [reviews.md](reviews.md#the-priority-word)),
for example `Should · 🟠📝 **Fix · docs: stale 'Read by' cell**`. The two-axis
decision is [ADR 0003](adr/0003-two-axis-finding-labels.md); the tier word and the result
version that carries it are [ADR 0030](adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md).

The tier word is derived by code, never written by the model: `Pre-existing` when verification
showed the defect in the base commit (origin `pre-existing`), else `Important` for `blocker` and
`fix`, else `Nit`. The displayed label leads with the priority; the tier word remains only in the label
given back to the model and in the trial's word arm, and `tier` stays in `/2` as deprecated. The terminal and Markdown reports add what the verifier found after the confidence
(`(confidence high, supported)` or `(…, inconclusive)`), a `Verified:` or `Inconclusive:` line
with the lines it read, and group `Inconclusive` and `Pre-existing` findings after the findings
of the change. On GitHub those two groups are listed in the review body and open no thread; a
finding the verifier never reached (`not verified: budget`) stays where it was.

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

Two tests settle a severity that feels uncertain, and apply before the list above:

- If the only thing wrong is a comment, docstring, name or documentation, the severity is
  `consider` or lower, never `fix`. The exception is a document that makes users do something
  harmful.
- If a user can lose data or see a wrong result silently, the severity is `fix` or higher even
  when the trigger is rare.

A finding also carries a **confidence**, separate from severity: severity says how bad the finding
is if it is true, confidence says how sure the reviewer is that it is true, given what it read.
It is shown after the title, for example `Should · 🟠🐛 **Fix · bug: Face is lost (confidence high)**`.

| Confidence | Meaning |
| --- | --- |
| `high` | The reviewer read the lines that establish every premise, and the failure follows from them |
| `medium` | The argument holds, but a premise rests on code the reviewer did not read or a condition it could not confirm |
| `low` | Plausible, not established |

A `low` confidence finding at `fix` or above is posted with the topic `question`, worded as a
question to the author. The prompt asks for it and the engine enforces it: a `low` confidence
finding at `blocker` or `fix` that the model left under another topic is rewritten to `question`
(severity, title and body unchanged) and counted in the job log; see
[review-policy.md](review-policy.md). [precision](precision.md) tabulates verdicts by confidence
so the rule can be checked. A finding
without a confidence (the engine's own notices, reviews from before the field existed) shows none. The decision
is in the [flow questions spec](specs/2026-10-31-flow-questions-and-evidence-design.md), decision 9.

A repository's focus file (`.github/wachiman.md`) may say what to look for, but it may not add
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
| `0` | A review or answer was posted, or there was nothing to do (no command word, not the operator, nothing to review, already reviewed), or the agent ran out of budget before finishing any batch and a notice was posted. `--help`, `help` and `--version` also exit 0, and so does a bare `wachiman`. |
| `1` | Engine error. **Not the same as "nothing was posted"**: see below. |
| `2` | Usage error: unknown command, missing or invalid pull request number, `comment` or `threads` given paths, an `WACHIMAN_TRIGGER` that is not a lowercase word, a `--repo-dir` that is not a directory, missing `GH_TOKEN`, `GITHUB_REPOSITORY` or `REQUEST`, an invalid numeric setting, or an unknown provider. The message is one line on stderr, followed by `Run 'wachiman <command> --help'.` |
| `3` | The spend ledger stopped the run before any model call: a limit with `limit_mode: fail`, a repository the ledger does not know, a rejected identity token, no OIDC token while `ledger_url` is set, or an unreachable ledger with `ledger_unavailable: stop`. With `limit_mode: notice` a limit exits 0. Only with `ledger_url`; see [costs.md](costs.md#the-spend-limit). |

Exit 1 covers:

- Before any call is paid for: a missing provider binary, settings file or credential, a Codex model
  with no known price, an empty or placeholder operator in `comment`, and a malformed
  `WACHIMAN_PRICE_PER_MTOK`. The malformed price is raised as an ordinary error, so it exits 1
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

`local` has its own codes:

| Code | Meaning |
| --- | --- |
| `0` | A report was printed: complete, partial, or ended by the account's usage limit (`stop: quota`) |
| `1` | No call returned a review (a refused sign-in, an unclassified error, every batch failed), after printing the report that says why; or the `claude` binary did not run |
| `2` | Usage error: an unknown option or format, `ANTHROPIC_API_KEY` set, a profile that cannot be resolved or is refused, a corrupt `config.json`, a provider other than `claude-code`, a refused or missing isolated profile, no merge-base, a detached or unborn `HEAD`, a `HEAD` on the base branch, a range deeper than the maximum depth, an `--input` of another format or whose head is not in the clone |
| `130` | Interrupted with `Ctrl-C`; the snapshot was removed |

`loop` has its own codes: 0 converged, 10 findings still open, 11 stopped without converging, 2 usage error, 130 interrupted.

`setup` and `init` use 0 done (including a "no" answer), 1 for an engine error (also a `setup` whose closing `doctor` summary failed), 2 usage error and 130 cancelled with Escape, Ctrl-C or Ctrl-D.

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

Between the GitHub side and the provider, the review core reads a `wachiman.review-input/1` and
returns a `wachiman.review-result/1`, both public JSON formats described in
[formats/README.md](formats/README.md); no command reads or writes them as files yet.

### Working-tree snapshots

`wachiman local --working-tree staged` reviews the index; `--working-tree all` reviews the
tracked path set in that index with its current file contents and deletions. New files must
first be staged; ignored and untracked files are excluded. Neither mode changes the real
index, worktree or object database. Committed review remains the default without this flag.

Capture uses a temporary index and object database with read-only access to existing objects.
It runs no configured filters, hooks, fsmonitor, external diff or submodule commands. Raw blobs
are copied into the review snapshot; symlinks become link text, and symlink parents are refused.
Archive attributes do not hide files or rewrite bytes. Capture aborts with exit 2 and a retry
message when the index, HEAD or captured tracked files change. Subsequent edits do not affect it.
Unborn HEAD, conflicts, split indexes, sparse/skip-worktree entries, gitlinks and non-UTF-8
tracked paths are refused.

Working-tree input and JSON results use `/2`, with `workingTree.mode`, `baseCommit` and `tree`.
`--result-version 1` fails before provider calls. `--input` working-tree reports require an
existing tree in the selected clone; temporary capture objects are removed after history annotation.
History matches fingerprints but leaves missing findings involving ephemeral trees unknown,
without querying commit ancestry on tree ids. This slice was exercised on macOS; native Windows
and Linux execution of these new paths remain unverified locally.
