# Command-line contract

`wachiman` is one command. Three subcommands are for GitHub; `local` reviews a branch on your own
machine and posts nothing; `setup`, `doctor`, `profile` and `project` manage and explain which
Claude account `local` uses, and `init` writes the GitHub caller workflow. The reusable workflow and the copied caller
workflow both run exactly this; anything else that wants to drive a review can too. Every setting
it reads is listed in [configuration.md](configuration.md); this page covers the commands, what
they post and how they exit.

```sh
bun src/cli.ts review <pr> [paths…] [--repo-dir <dir>]
bun src/cli.ts comment <pr> [--repo-dir <dir>]   # the comment text comes from $REQUEST
bun src/cli.ts threads <pr> [--repo-dir <dir>]   # answer the pending Wachiman threads, no review
bun src/cli.ts local [paths…] [--base <ref> | --from <commit> | --commit <commit>] [--max-depth <n>] [--repo-dir <dir>] [--input <file>] \
  [--format terminal|markdown|json] [--output <file>] [--profile default|isolated[:<name>]] [--agent-prompt]
bun src/cli.ts setup [--profile <name>] [--repo-dir <dir>] [--yes] [--json]
bun src/cli.ts init [--mode github|local|both] [--operator <login>] [--version <tag>] [--path <file>] \
  [--force] [--dry-run] [--yes] [--repo-dir <dir>]
bun src/cli.ts doctor [--json] [--profile <name> | --all-profiles] [--repo-dir <dir>] [--redact-paths]
bun src/cli.ts profile list|create|add|login|remove|default ...
bun src/cli.ts project show|unbind ...
bun src/cli.ts --setup-profile [<name>]          # alias of `profile create`
bun src/cli.ts --help
bun src/cli.ts --version
```

`package.json` declares `"bin": {"wachiman": "src/cli.ts", "agent-review": "src/cli.ts"}` and the file
starts with `#!/usr/bin/env bun`, so an installed copy can be run as `wachiman …`; `agent-review …` is
the name before the naming release and still works. Bun is required (the
engine uses `Bun.Glob`), and so are the `gh` CLI and the provider's binary on the `PATH`.

Argument rules, as implemented:

- The command (`review`, `comment`, `threads`, `local`, `history`, `setup`, `doctor`, `profile` or `project`) must be the first argument. `--help`/`-h`,
  `--version`/`-v` and `--setup-profile` are recognised only as the first argument too.
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
| `setup [--profile <name>]` | Binds this repository to an account profile; on a terminal without `--profile` it asks. See [`setup`](#setup-doctor-profile-and-project). |
| `init` | Writes the GitHub caller workflow, or hands over to `setup`. See [`init`](#init). |
| `doctor` | Reports what a local run would use and what would fail. |
| `profile …`, `project …` | Manage account profiles and the repository's binding. |
| `skills install\|uninstall` | Copies the `wachiman-review` and `wachiman-audit` agent skills into place, or removes the copies it made. See [`skills`](#skills). |
| `--setup-profile [<name>]` | The same as `profile create [<name>]`: creates `~/.wachiman/claude-<name>` (default name `isolated`) and starts `claude` in it so you can sign in. |

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
3. If the comment contains no command word (`AGENT_REVIEW_MENTION`, default `/wachiman`, or the
   aliases `/wachi`, `@agent-review`, `@claude`), nothing happens and it exits 0.
4. If the first word after the command word is `review`, it runs `review` with the remaining words
   as paths.
5. Otherwise the whole comment is a question, and one agent call answers it as a pull request
   comment.

The workflow's own filter for which comments start a job is looser than the parser used in step 3,
and for custom mentions the two accept different words. That is documented, with examples, under
[Mentions and commands](configuration.md#mentions-and-commands).

Because the provider check runs before `comment` reads the request (see [Exit codes](#exit-codes)),
even a comment that would do nothing needs a working provider binary and credential.

### What `threads` does

`threads` is an automatic run (`AGENT_REVIEW_TRIGGER` is forced to `thread`): it counts against
`AGENT_REVIEW_AUTO_BUDGET_USD` ([ADR 0012](adr/0012-automatic-thread-replies-and-a-per-pr-ceiling.md)).
The checks run in this order, and each "exits 0" ends the run without a model call:

1. An empty or placeholder `AGENT_REVIEW_OPERATOR` is an error (exit 1).
2. If `AGENT_REVIEW_COMMENT_AUTHOR` is set and is not the operator (case-insensitive), it prints a
   notice and exits 0.
3. If the last reviewed commit (the signed marker) is not the head, it exits 0: the review of that
   push reads the same replies and answers them. The same when no review exists.
4. It keeps the tool's own open threads whose latest comment is a reply by an `OWNER`, `MEMBER` or
   `COLLABORATOR` and where Wachiman has written fewer than two replies. None: exit 0.
5. If the pull request's automatic spend has reached the ceiling, it posts the one notice for that
   ceiling (never twice) and exits 0.
6. One provider call, capped by the smaller of `AGENT_REVIEW_THREADS_BUDGET_USD` and what is left
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
| `--max-depth <n>` | `50` | The most commits from the start commit (the merge-base, or `--from`'s parent) to `HEAD`. A deeper range exits 2 before any call; a positive integer, for this run only. Size (files, lines, batches) never blocks a run. With no `--base`, a `HEAD` on the base branch itself is refused; `--base <commit>` names the start instead. Not checked for `--input` |
| `[paths…]` | the whole change | Only the changed files under these paths; a word that names no changed file is ignored with a line on stderr |
| `--input <file>` | none | A `wachiman.review-input/1` file ([formats](formats/README.md)) instead of the local diff; its `change.head.sha` is snapshotted from `--repo-dir`. Takes no `--base`, `--from`, `--commit` or paths |
| `--format terminal\|markdown\|json` | `terminal` | Plain text; a Markdown report with every finding and the prompt for your agent; or the `ReviewResult` JSON |
| `--output <file>` | stdout | Write the report to a file; its path is printed on stderr |
| `--agent-prompt` | off | With `terminal`, also print the prompt for your agent (Markdown always has it, JSON never) |
| `--profile <name>` | see "Which account" below | `default` is your own `claude`; a name is a registered profile (managed or external); `isolated` and `isolated:<name>` name the managed profile `~/.wachiman/claude-<name>` (which must exist and hold nothing but a sign-in) |
| `--verify` | on (follows `AGENT_REVIEW_VERIFY`, on unless set to `0`/`false`); `--verify` forces it on | After the batches, one more call on `AGENT_REVIEW_VERIFIER_MODEL` (default Opus 5.5) tries to refute each finding above `info`. A finding is dropped only when the verifier shows a checked disproof; one it cannot settle stays, marked `inconclusive`; a true bug that predates the change is `supported` with origin `pre-existing`. The verifier can read the base commit as well as the head. The record is `verification` in `--format json --result-version 2` ([ADR 0027](adr/0027-one-verifier-call-per-pull-request-drops-a-finding-only-with-a-checked-disproof.md), [ADR 0030](adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)) |
| `--no-verify` | — | Turn verification off for this run, even when `AGENT_REVIEW_VERIFY` is on. With `--verify` it is a usage error |
| `--result-version 1\|2` | `1` for a committed change | With `--format json` only (any other use exits 2): which result version to write. `1` is the committed form (`toResultV1`): no `verification` block, and one line in `execution.notices` saying how verification went. `2` is the full result, with each finding's `origin`, `verification` and `tier` |
| `--history` | off (or `AGENT_REVIEW_HISTORY=1`) | Save the run under `~/.wachiman/history` and label each finding `new` or `open since <sha7>`; see [local review](local-review.md#keep-a-history-of-your-runs-optional). The prompts are the same with or without it |

Both `--x value` and `--x=value` work. Before any call, `local` prints the resolved base, the
merge-base, the depth and the head (`base: main (1a2b3c4)`, `merge-base: …`, `depth: 12 commits (max 50)`, `head: feat/x (…)`); with `--commit` or
`--from` it prints the mode and the start instead (`mode: one commit (abc1234)` or `mode: from abc1234 to HEAD`, then `start: …`, `depth: …`, `head: …`; `start: the empty tree (a root commit)` for a root commit). It also prints the file
count and the number of batches on stderr, then `verify: off` or `verify: on (<model>, reserve $<n>)`; the provider's progress follows there too. **It
prints, never posts:** the report goes to stdout (or `--output`), so `--format json` on stdout is
the result alone.

It refuses to start, with exit 2, when `ANTHROPIC_API_KEY` is set, when `AGENT_REVIEW_PROVIDER`
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
| `setup [--profile <name>] [--repo-dir <dir>] [--yes] [--json]` | Binds this repository to a profile, prints exactly what it will write, asks `Bind <repo> to <name>?` (only on a terminal), then runs the `doctor` summary. On a terminal without `--profile` it is a wizard: see below |
| `doctor [--json] [--profile <name> \| --all-profiles] [--repo-dir <dir>] [--redact-paths]` | One row per check: `wachiman`, `bun`, `git`, `tar`, `config`, `profile`, `auth`, `environment`, `project`, `history`, `skills`, `isolation`. `--all-profiles` repeats `profile`, `auth` and `isolation` for every profile. `--redact-paths` swaps paths for `<home-path-N>` and `<external-path-N>` and URLs for `<remote>`, so the output can be shared. `--json` prints `wachiman.doctor/1` |

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
showing its default (numbered lists mark `(default)`, text shows `[value]`, Enter takes it):

1. `Set up this repository?` after printing the repository and its current binding.
2. Which profile: the registered profiles (name, kind, directory, binary or `PATH`; `(current)`
   and `(global default)` marked), then `Register an existing Claude configuration directory
   (external)` and `Create a new isolated profile (managed)`. Registering asks for the directory,
   the `claude` binary (empty for `PATH`) and a name; the entry stays pending. Creating asks for a
   name and then, naming the side effect, whether to create `~/.wachiman/claude-<name>` and open
   Claude there so you can sign in; that directory and sign-in happen at once, and nothing is
   registered yet.
3. A summary of the profile's name, kind, directory and binary, and the repository's identity and
   scope, then `Bind <repo> to <profile>?`. Only a yes saves anything, and it saves the pending
   profile (if any) and the binding in one locked write.

Then it checks the account (offering `Sign in now?` when signed out) and prints the `doctor`
summary and the `wachiman local` line. Escape, Ctrl-C or Ctrl-D exits 130; before the final yes no
configuration is saved, and a managed directory or a Claude sign-in that already happened is
listed, never described as undone.

### `init`

```sh
wachiman init [--mode github|local|both] [--operator <login>] [--version <tag>] [--path <file>] \
  [--force] [--dry-run] [--yes] [--repo-dir <dir>]
```

First-time setup of a repository. `--mode github` writes the maintained caller workflow
(`templates/wachiman-review-caller.yml`) to `.github/workflows/wachiman-review.yml` with your
`operator:` and the release tag you pin, and a one-line header that says Actions is billed through
the repository secret `ANTHROPIC_API_KEY` while local runs use your signed-in `claude`. `--mode
local` writes nothing and prints the `wachiman setup` line; `--mode both` writes the workflow, then
prints that line, or on a terminal offers to run the setup wizard in the same process. It never
commits, pushes, opens a pull request or creates a secret.

| Flag | Rule |
| --- | --- |
| `--mode` | Mandatory without a terminal |
| `--operator <login>` | Mandatory for `github` and `both` without a terminal; a GitHub login |
| `--version <tag>` | `vX.Y.Z` or a 40-character commit SHA, written after `review.yml@`. Default: the release tag bundled in this build (`DEFAULT_WORKFLOW_REF`, moved by release-please at each release commit); the CLI's own version is never used as a tag |
| `--path <file>` | Default `.github/workflows/wachiman-review.yml`, relative to the repository top level (also when run from a subdirectory); a `.yml` or `.yaml` file directly in `.github/workflows/` |
| `--force` | Replaces an existing file after copying it to `<file>.bak-<YYYYMMDD-HHMMSS>` (an existing backup is never overwritten); without it an existing file is exit 2 |
| `--dry-run` | Prints the rendered file to stdout and writes nothing |
| `--yes` | No prompts |

`--mode local` with `--operator`, `--version`, `--path`, `--force` or `--dry-run` is exit 2. A
`.github`, `workflows` or target that is a symbolic link is refused. On a terminal the file is
previewed on stderr and `Write it?` is asked first; Escape, Ctrl-C or Ctrl-D exit 130 and write
nothing.

### `skills`

```
wachiman skills install [--dir <path>]… [--json]
wachiman skills uninstall [--dir <path>]…
```

`install` copies `skills/wachiman-review` and `skills/wachiman-audit` (copies, not symlinks) into
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
| `--verdict <id> correct\|partial\|wrong [--reason <text>]` | Record your judgement of a finding (the id is in the report and the listing); the listing shows it |
| `--forget [--all]` | Delete this repository's history, or all of `~/.wachiman/history`; prints what was removed. It takes no `--all-repos`, `--json` or `--since` (usage error) |

Exit codes: 0 listed, recorded or forgotten (a missing history prints one line and exits 0); 2 usage
error, including a `--verdict` id that matches no finding.

### `status`

`wachiman status` shows what this laptop kept of its local runs and what they cost, so you can see
where the spend goes. It reads the history files under `~/.wachiman/history` and, without
`--all-repos` or `--repo`, runs `git rev-parse` and `git remote get-url` in `--repo-dir` to find the
repository's key. It runs no `claude`, calls no GitHub and sends nothing.

**What it covers.** Only runs saved by `wachiman local --history` (or `AGENT_REVIEW_HISTORY=1`).
Runs made by the GitHub Actions workflow are not in those files and are not counted, so the total is
the local spend, not Wachiman's whole spend. The cost is Claude Code's `total_cost_usd`: an
API-equivalent estimate, not a bill. A new `--history` run deletes runs older than 30 days
(`AGENT_REVIEW_HISTORY_DAYS`, `0` keeps them all), so the total reaches back at most that far.

| Option | What it does |
| --- | --- |
| `--since <n>d` | Only runs from the last `n` days |
| `--all-repos` | Every repository in the history, not just this clone's |
| `--repo <name\|key>` | One repository by name or key, from any directory |
| `--model <text>` | Only runs whose model id contains the text (`sonnet`, `claude-haiku-5-5`) |
| `--profile <name>` | Only runs made with that account profile |
| `--by day\|repo\|model\|profile` | How the table groups runs (default `day`) |
| `--json` | `wachiman.status/1`: the filters, totals, groups and every run with its attributes |

Each run in the JSON carries `at`, `repositoryKey`, `repository`, `change`, `head`, `model`,
`effort`, `profile`, `engineVersion`, `costUsdEstimate`, `tokens` and `findings`, so any other
cut can be made with a JSON tool. A pull request number is not among them: a local run reviews a
branch or a commit.

Exit codes: 0 printed (with no run kept it prints one line saying how to start, and exits 0); 2
usage error.

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
  Threads are not read when a review ends early as `Already reviewed` or `Nothing to review`. A
  reply on an unchanged head is answered by `threads`, which the workflow starts when the operator
  replies (see "What `threads` does").
- `comment` with a question: one pull request comment (not a review) holding the answer, written in
  English, and a footer `<sub>{model label} · effort {effort} · ${cost}</sub>` (no batch count,
  since an answer is one call). As with a review, the `· effort {effort}` part is new in
  v1.4.0; v1.3.0 prints `<sub>{model label} · ${cost}</sub>`. The answer is one call over the whole diff, with no batching, no coverage check and no
  thread context, capped by `answer_budget_usd`.
- With `AGENT_REVIEW_DRY_RUN=1` it reads GitHub but prints instead of posting. It still calls the
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
| `AGENT_REVIEW_COMMENT_AUTHOR` | Optional, for `comment` and `threads`: the login of the comment's author. When set and not the operator, nothing runs. |
| Provider credentials | For `claude-code`: `ANTHROPIC_API_KEY`. For `codex`: `OPENAI_API_KEY`. Neither is needed with `AGENT_REVIEW_DRY_RUN=1`, which uses the machine's own login. `local` uses the signed-in `claude` and refuses to start when `ANTHROPIC_API_KEY` is set. |

The `gh` CLI and the provider's binary (`claude` for `claude-code`, `codex` for `codex`) must be on
the `PATH`.

Read by the account commands and `local`:

| Variable | Meaning |
| --- | --- |
| `WACHIMAN_HOME` | The Wachiman home, an absolute path. Default `~/.wachiman` |
| `WACHIMAN_PROFILE` | The profile `local` uses when there is no `--profile` and no project binding |

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

The engine reads `.github/wachiman.md` (the review focus), the old `.github/agent-review.md` and
`.github/claude-review.md` names, `CLAUDE.md` and `AGENTS.md` from the pull request's base commit, so a pull request cannot
change the rules it is reviewed under. Details, size limits and what these files cannot do:
[configuration.md](configuration.md#repository-files). A YAML configuration file is not
implemented.

## Finding labels

Every finding is labelled on two axes, each an emoji followed by its word, and starts with a
**tier word**, for example `Important · 🟠📝 **Fix · docs: stale 'Read by' cell**`. The two-axis
decision is [ADR 0003](adr/0003-two-axis-finding-labels.md); the tier word and the result
version that carries it are [ADR 0030](adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md).

The tier word is derived by code, never written by the model: `Pre-existing` when verification
showed the defect in the base commit (origin `pre-existing`), else `Important` for `blocker` and
`fix`, else `Nit`. On GitHub it sits outside the bold part, so older readers of the label still
parse it. The terminal and Markdown reports add what the verifier found after the confidence
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
It is shown after the title, for example `Important · 🟠🐛 **Fix · bug: Face is lost (confidence high)**`.

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
| `0` | A review or answer was posted, or there was nothing to do (no command word, not the operator, nothing to review, already reviewed), or the agent ran out of budget before finishing any batch and a notice was posted. `--help` and `--version` also exit 0. |
| `1` | Engine error. **Not the same as "nothing was posted"**: see below. |
| `2` | Usage error: unknown command, missing or invalid pull request number, `comment` or `threads` given paths, an `AGENT_REVIEW_TRIGGER` that is not a lowercase word, a `--repo-dir` that is not a directory, missing `GH_TOKEN`, `GITHUB_REPOSITORY` or `REQUEST`, an invalid numeric setting, or an unknown provider. The message and the usage text go to stderr. |

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

`local` has its own codes:

| Code | Meaning |
| --- | --- |
| `0` | A report was printed: complete, partial, or ended by the account's usage limit (`stop: quota`) |
| `1` | No call returned a review (a refused sign-in, an unclassified error, every batch failed), after printing the report that says why; or the `claude` binary did not run |
| `2` | Usage error: an unknown option or format, `ANTHROPIC_API_KEY` set, a profile that cannot be resolved or is refused, a corrupt `config.json`, a provider other than `claude-code`, a refused or missing isolated profile, no merge-base, a detached or unborn `HEAD`, a `HEAD` on the base branch, a range deeper than the maximum depth, an `--input` of another format or whose head is not in the clone |
| `130` | Interrupted with `Ctrl-C`; the snapshot was removed |

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
