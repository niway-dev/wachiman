# Review a branch locally, on your own Claude subscription

## 1. Who it is for

`agent-review local` reviews the branch you have checked out in a clone, with the same engine and
the same prompt as the GitHub workflow, and prints the review in your terminal (or writes it as
Markdown or JSON). It runs on the `claude` you are already signed in to: no API key, no GitHub
token, no `gh`, and nothing is posted anywhere.

> **Wachiman sends no telemetry and makes no GitHub requests in local mode; your code is sent to
> your configured Claude account for the review.**

It is for a developer who wants a second reader before opening a pull request, including on an
employer's code that cannot run through a CI key. The design is in
[ADR 0019](adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
and [the spec](specs/2026-11-03-local-review-design.md).

## 2. Before you run it on someone else's code

The review sends your code to Anthropic, through your Claude account. What happens to it there
depends on which account you sign in with ([Claude Code data usage](https://code.claude.com/docs/en/data-usage),
read 2026-11-03):

| Account | Training | Retention |
| --- | --- | --- |
| Personal Free, Pro, Max or Ultra (Consumer Terms) | Used for training **when the training setting is on**. Turn it off in the [privacy controls](https://claude.ai/settings/data-privacy-controls) first | 30 days with the setting off (5 years with it on) |
| Team or Enterprise (commercial terms) | Not used for training unless the organisation opts in | 30 days, or zero data retention for qualified Enterprise organisations |

A Team or Enterprise account of your employer is the easier request to approve.

**What leaves the machine:** the diff of the branch, the files the model chooses to read in the
snapshot (read-only tools only: `Read`, `Glob`, `Grep`), the repository's instruction files
(`CLAUDE.md`, `AGENTS.md`, `.github/agent-review.md`) at the merge-base, and the prompt. They go to
`api.anthropic.com` through your `claude`. **What does not:** nothing goes to GitHub, and Wachiman
itself sends nothing. Claude Code's own metrics, error reports, feedback survey, auto-updater and
marketplace auto-install are switched off in every call (see section 7 for what is verified).

**The local transcript.** Claude Code normally keeps each session's transcript, which holds the
reviewed code, in plain text under the profile's `projects/` folder for 30 days. Wachiman passes
`--no-session-persistence` to every call, so no transcript is written. Wachiman itself keeps
nothing either, unless you turn on the history (section 5).

A request to your employer can be this short:

```text
I would like to run Wachiman (https://github.com/niway-dev/wachiman) on my laptop to review my own
branches before I open pull requests. It runs Claude Code under my <personal Pro | company Team>
Claude account, with training turned off, and Anthropic keeps the data for 30 days. It sends the
branch's diff and the files the model reads to Anthropic only; nothing goes to GitHub or anywhere
else, no transcript is kept on disk, and no history unless I turn it on. Can I use it on <repository>?
```

## 3. Install

- [Bun](https://bun.sh) 1.3 or later.
- Claude Code (`claude` on your `PATH`), signed in. The local mode was exercised with Claude Code
  2.1.311 (see section 7).
- A clone of this repository: the engine. It needs no `bun install` (no dependencies).

No `gh`, no `GH_TOKEN`, no `ANTHROPIC_API_KEY`. If `ANTHROPIC_API_KEY` is set in your shell, the
local mode refuses to start: with a key present `claude -p` would bill the key.

Run the engine from its own directory, with its own Bun configuration, and point it at the clone
you want reviewed:

```sh
bun --no-env-file --config=<engine>/bunfig.toml <engine>/src/cli.ts local --repo-dir <clone>
```

`--no-env-file` and `--config=` keep a `.env` or `bunfig.toml` of the reviewed repository out of
the engine process (Bun reads both from its working directory, and `bunfig.toml` can run code);
see [the command-line contract](cli.md#options). An alias is fine:

```sh
alias wachi-local='bun --no-env-file --config=$HOME/src/wachiman/bunfig.toml $HOME/src/wachiman/src/cli.ts local'
```

## 4. Run

```sh
wachi-local --repo-dir .                      # the current branch against origin's default branch
wachi-local --repo-dir . --base develop src   # against develop, only files under src/
wachi-local --repo-dir . --format markdown --output review.md
```

| Option | What it does |
| --- | --- |
| `--repo-dir <dir>` | The clone. Default: the current directory |
| `--base <ref>` | What the branch is compared with. Default: `origin/HEAD` when it resolves (the remote's default branch), else `main`. No fetch is made: fetch first if your base is stale |
| `[paths…]` | Review only the changed files under these paths. A word that names no changed file is ignored, with a line on stderr |
| `--input <file>` | Review a `wachiman.review-input/1` file ([formats](formats/README.md)) instead of computing the diff; its `change.head.sha` must exist in `--repo-dir` |
| `--format terminal\|markdown\|json` | Default `terminal` (plain text). `markdown` holds every finding and ends with the prompt for your agent. `json` is the [`ReviewResult`](formats/README.md) |
| `--output <file>` | Write the report there instead of stdout |
| `--agent-prompt` | With `terminal`: also print the prompt for your agent |
| `--profile default\|isolated[:<name>]` | Which Claude Code profile runs the review (below). Default `default` |

What is reviewed is the **committed** change: `merge-base(base, HEAD) → HEAD`. Uncommitted edits
and untracked files are not part of it. The engine takes a snapshot of the head commit (`git
archive` into a temporary directory) and the model reads that, so you can keep editing while it
runs.

Before any call, stderr shows what will be reviewed:

```text
base: origin/main (1a2b3c4)
merge-base: 9f8e7d6
head: feat/export (5d6e7f8)
files: 6 (0 excluded)
batches: 1
```

Progress and warnings go to stderr; the report goes to stdout (or `--output`), so
`--format json | jq` works. Each batch is one `claude` call; the 2026-11-04 trial on a 6-file pull
request took 34 s for its one call. `Ctrl-C` stops the review after the call it interrupts,
removes the snapshot and exits 130.

**Profiles.** `default` is your own `claude` with its usual configuration directory.
`isolated` (or `isolated:<name>`) is a separate Claude Code configuration directory,
`~/.wachiman/claude-<name>`, that holds only a sign-in, so none of your own `CLAUDE.md`, skills,
hooks or MCP servers can reach the review. Create one once:

```sh
bun --no-env-file --config=<engine>/bunfig.toml <engine>/src/cli.ts --setup-profile [<name>]
```

It starts `claude` in that directory; run `/login`, sign in, then `/exit`. Wachiman never sees the
sign-in and does not check that it worked: run `local --profile isolated` to find out. A profile
that holds more than a sign-in (a `CLAUDE.md`, `hooks/`, `skills/`, `agents/`, `commands/`,
`.mcp.json`, or a `settings.json` with hooks or MCP servers) is refused. On macOS the sign-in is
stored in the keychain under the directory's path: moving or renaming `~/.wachiman` signs the
profile out.

## 5. Read the report

- **Labels.** Each finding has a severity (`Blocker`, `Fix`, `Consider`, `Info`), a topic and the
  model's confidence, as on GitHub: see [Finding labels](cli.md#finding-labels).
- **Coverage.** The first line says `all N files reviewed`, or `Partial: reviewed X of N; not
  reviewed: …` with the reason for each file left out.
- **The cost line** (`Cost: $0.18, an API-equivalent estimate …, not a bill`) is Claude Code's
  `total_cost_usd`: what the calls would cost at API prices. On a subscription you are not billed
  for it; the calls count against your plan's usage instead.
- **`stop:`** says how the run ended: `complete`, or why it ended early (section 6).
- **The prompt for your agent** (at the end of the Markdown, or with `--agent-prompt`) is the
  review as a task for your own coding agent: paste it into Claude Code, Codex or Cursor in the
  same clone. It asks the agent to check each finding against the current code, fix the valid
  ones, report the rejected ones with the reason, and run the checks. Wachiman launches nothing.

### Keep a history of your runs (optional)

Off by default: without the switch, `local` neither reads nor creates `~/.wachiman/history`. Turn it
on for one run with `--history`, or for every run with `AGENT_REVIEW_HISTORY=1`.

- **What is saved.** One file per run, `~/.wachiman/history/<name>-<hash>/runs/<time>-<sha7>.json`,
  holding the whole result, including the finding text, which quotes your code. It is as sensitive
  as a `--output` report. The history directories are set to mode 0700 and files to 0600 on every save. `<name>-<hash>` comes from the
  `origin` URL (credentials removed), so every clone and worktree of one repository shares a
  history; without an `origin` it comes from the clone's git directory.
- **What it tells you.** Each finding is labelled `new` or `open since <sha7>`, with an id. A
  finding is the same as an earlier one when the file (renames followed) and topic match and the
  cited line has the same text, or the title is the same once digits and punctuation are ignored.
  No model decides that. An earlier finding this run did not repeat is `probably fixed` (the file
  was reviewed and the cited code changed), `not repeated` (reviewed, code unchanged: the reviewer
  just did not say it again) or `unknown` (the file was not reviewed: a path scope, a skip, a usage
  limit). It says "probably" because a fix is inferred from absence, never observed. With
  `--format json`, stdout is unchanged and this block goes to stderr.
- **`agent-review history`** lists what is tracked, per repository: status, first and last head,
  runs, id and your verdict. `--since 7d`, `--all-repos` and `--json` narrow or reshape it. It reads
  files and local git metadata only (it asks `git` for the repository's key): no `claude`, no GitHub.
- **Verdicts.** `agent-review history --verdict <id> correct|partial|wrong [--reason "…"]` records
  your judgement, with the words of [precision](precision.md). It appears in the listing and in
  later reports. It does not change a review: a finding you called wrong is still reported if the
  reviewer repeats it, which is how you see a persistent false positive.
- **Retention.** 30 days, per repository, pruned when that repository is saved
  (`AGENT_REVIEW_HISTORY_DAYS=<n>`, `0` keeps everything). A repository you stop reviewing keeps
  its files until you forget them.
- **Forget.** `agent-review history --forget [--repo-dir <dir>]` deletes one repository's history;
  `--forget --all` deletes `~/.wachiman/history`. Neither touches `~/.wachiman/claude-*`.
- **Nothing is exported.** No upload, no sync. The files never leave the laptop unless you copy them.

## 6. Limits

- **Work limits, and the estimate guard.** Each call is bounded by `AGENT_REVIEW_MAX_TURNS` and
  `AGENT_REVIEW_CALL_TIMEOUT_S`; the run by `AGENT_REVIEW_BUDGET_USD` (default $3), counted in the
  API-equivalent estimate. See [configuration](configuration.md#local-mode).
- **A usage limit ends the run.** When your plan's usage runs out mid-review, the run stops (it
  never waits for the window to reset) and prints a partial report:
  `stop: quota — the account's usage limit ended the run; N file(s) not reviewed: …`. Exit code 0.
- **No memory between runs, unless you turn on `--history`.** No incremental reviews, threads or
  precision memory: those live on GitHub. Each run reviews the whole branch. The history labels
  findings; it never changes what is reviewed or what is sent.
- **Committed changes only**, and only what `git archive` exports: a file marked `export-ignore`
  in `.gitattributes`, or a submodule, is missing from the snapshot (a warning names it).

## 7. What is verified and what is not

The probes below are recorded in [the spec](specs/2026-11-03-local-review-design.md#the-subscription-probe-2026-11-03).
They name Claude Code 2.1.318, but the same machine reported 2.1.311 on 2026-11-04, so the version
of those rows is unconfirmed.

| Claim | Status | Claude Code version |
| --- | --- | --- |
| The telemetry switches stop Claude Code's own traffic | Partly: a logging proxy on 2026-11-04 saw the Datadog log intake disappear with the switches and only `api.anthropic.com` remain. Statsig and Sentry never appeared with or without them, so nothing is proven about those. Not cross-checked with a packet capture | 2.1.318 as recorded (unconfirmed) |
| A populated `~/.claude` does not reach the review | Verified for `CLAUDE.md`, skills, commands, agents, hooks, user MCP servers and the account's claude.ai connectors (all absent with Wachiman's flags, harness of 2026-11-04). **Plugins are untested** | not recorded |
| `--safe-mode` | Not adopted: the harness showed it adds nothing over `--restricted` and `--strict-mcp-config` | not recorded |
| On a subscription, `total_cost_usd` is reported and `--max-budget-usd` is enforced | Verified by the subscription probe of 2026-11-03 (enforced after the call that crosses it) | 2.1.318 as recorded (unconfirmed) |
| No transcript is written with `--no-session-persistence` | Verified by the same probe | 2.1.318 as recorded (unconfirmed) |
| `local` end to end on a subscription | One smoke run, 2026-11-04: a throwaway repository with a one-file branch, Haiku at effort `low`, the `default` profile pointed at a signed-in isolated directory, no API key. 1 call, 3 turns, 7 s, $0.0023 estimate, the planted off-by-one found, and no `projects/` or `session-env/` written to the profile. The wire was not observed | 2.1.311 |
| Findings match a posted CI review on the same commits (level c) | Not yet run | — |
| What the wire shows during a whole local review | Not yet run | — |
| The shape of a real quota stop | Not yet run: the tests use Claude Code's "usage limit" wording | — |

## 8. Troubleshooting

| You see | Why, and what to do |
| --- | --- |
| `ANTHROPIC_API_KEY is set. The local review runs on your signed-in claude; …` (exit 2) | The key would bill instead of your subscription. `unset ANTHROPIC_API_KEY` for the run, or use the GitHub mode |
| `stop: error — the provider refused the call (auth): Not logged in · Please run /login` (exit 1) | The profile is not signed in. Run `claude` and `/login` for `default`, or `--setup-profile` for an isolated profile |
| `` `main` and HEAD have no common ancestor `` (exit 2) | The base is unrelated history. Pass the right `--base` |
| `No base branch found; pass --base <ref>` (exit 2) | No `origin/HEAD` and no `main`. Pass `--base`, or run `git remote set-head origin --auto` |
| `HEAD is detached; check out a branch, or pass --input` (exit 2) | Check out a branch (`git switch -c review-me`) |
| `The snapshot lacks N file(s) that the head commit has …` | `export-ignore` or a submodule. The review goes on without those files; remove the attribute on a temporary branch if they matter |
| `history: … cannot be read (…); moved to … .unreadable-<seconds>` | A history run file is not JSON or is structurally invalid. It was moved aside as `<name>.json.unreadable-<seconds>` (renamed, not deleted) and skipped; the run went on. Delete it when you no longer need it. A file written by another format version (say, after a downgrade) is skipped with a warning and left where it is |
| An isolated profile seems to use another account | A `claude` **shell function or alias** that sets `CLAUDE_CONFIG_DIR` does not affect Wachiman (it starts the binary from `PATH`, without a shell), but it does affect a `claude` you run by hand to sign in. That is why `--setup-profile` exists: it starts the binary itself with the profile's directory. Check with `type claude` |

Exit codes: 0 a report was printed (complete, partial, or ended by a usage limit), 1 no call
returned a review, 2 usage error, 130 interrupted. See [cli.md](cli.md#local).
