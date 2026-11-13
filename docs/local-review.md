# Review a branch locally, on your own Claude subscription

## 1. Who it is for

`wachiman local` reviews the branch you have checked out in a clone, with the same engine and
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
(`CLAUDE.md`, `AGENTS.md`, `.github/wachiman.md`) at the merge-base, and the prompt. They go to
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

- [Bun](https://bun.sh) 1.3 or later. The npm package installs it for you (next section); a clone
  runs with a Bun you installed yourself.
- Claude Code (`claude` on your `PATH`), signed in. The local mode was exercised with Claude Code
  2.1.311 (see section 7).
- The engine: the npm package `wachiman` (Node 20 or later runs its launcher) or a clone of this
  repository. A clone needs no `bun install`: the engine has no dependencies of its own.

No `gh`, no `GH_TOKEN`, no `ANTHROPIC_API_KEY`. If `ANTHROPIC_API_KEY` is set in your shell, the
local mode refuses to start: with a key present `claude -p` would bill the key.

### From npm

The npm package is published (version 1.10.0 was published by hand, without a provenance statement;
later versions are published by the release workflow). You can also install from source (next section).

```sh
npm i -g wachiman          # or: bun add -g wachiman; or, without installing: npx wachiman doctor
wachiman --version
```

The package contains the TypeScript source, the skills and the templates, and one dependency: the
official npm package [`bun`](https://www.npmjs.com/package/bun) (published by oven-sh, maintainers
jarred and robobun, source [oven-sh/bun](https://github.com/oven-sh/bun)), pinned to an exact
version. Installing `wachiman` therefore downloads Bun: measured for Bun 1.3.4, 23 MB (macOS arm64)
to 42 MB (Windows x64) compressed and 60 to 115 MB unpacked (Windows 115 MB). Its `bin` is a Node
script that runs the package's own `src/cli.ts` with the two isolation flags described below, using
that Bun first and a Bun on your `PATH` second.

How the launcher picks a Bun:

1. The Bun that npm installed next to `wachiman`, found from the package's own location (never
   from the directory you run it in). It is used only if `bun --version` answers with 1.3 or later.
2. Otherwise a Bun on your `PATH`, judged the same way. Only absolute `PATH` entries count, so a
   `bun` inside the repository you are reviewing never runs.
3. Otherwise it prints one of three messages and exits 2: `wachiman needs Bun 1.3 or later:
   https://bun.sh` followed by a line saying the `bun` package is missing and no Bun is on `PATH`;
   a line naming the Bun it found (with its path) that did not run; or a line naming the version
   when one runs but is older than 1.3. All list `npm install -g bun`, https://bun.sh and, on Windows,
   `powershell -c "irm bun.sh/install.ps1|iex"` (open a new terminal afterwards).

The launcher changes no environment variable and downloads and installs nothing itself.

`npm i -g wachiman --ignore-scripts` (and any setup that skips dependency install scripts, which
newer npm versions can warn about, and pnpm 10 already blocks by default, which is documented pnpm behavior that was not tested here) installs the `bun` package without its binary: it leaves a small
placeholder that cannot run (in bun@1.3.4 an empty file, `ENOEXEC`). The launcher detects it and uses the Bun on your `PATH` instead; with
neither, it exits 2 with the message above. `bun add -g wachiman` was tried on macOS with Bun 1.4.2
and a packed tarball: Bun installed the dependency with a working binary, and `wachiman --version`
ran with only Node on `PATH`. The launcher itself runs on Node, so Node 20 or later must be on `PATH` even when you install with Bun.

On Windows the package is written to work, in Git Bash and in PowerShell: the launcher is a Node
script and npm creates the `wachiman.cmd` and `wachiman.ps1` shims. It is not tested in CI; it should
work wherever Node and Bun run (see the Windows note below).

Supply chain: Bun's own `postinstall` runs when `bun` is installed and copies the platform binary
from `@oven/bun-<platform>` into place. Wachiman's provenance statement covers Wachiman's files,
not that binary download. If your policy does not allow it, install with `--ignore-scripts` and use
a Bun you installed from a source you trust. The package is published by the release workflow
(see [releasing](releasing.md#publishing-to-npm)). Install the optional agent skills separately with `wachiman skills install`; it preserves unmarked or edited copies. See [`skills`](cli.md#skills).

### From a clone (unreleased source, and the agent skills)

Install the global `wachiman` command, and the `wachiman-review`, `wachiman-loop` and `wachiman-audit` agent
skills, once from your clone (not from a temporary worktree):

```sh
scripts/install-local.sh              # links ~/.local/bin/wachiman and the skill; --uninstall removes them
```

It links `bin/wachiman` into `~/.local/bin` (put that on your `PATH`) and the skill into
`~/.agents/skills` and every Claude Code config directory (`~/.claude`, `~/.claude-*`,
`$CLAUDE_CONFIG_DIR`). It never touches `~/.wachiman`, replaces only its own symlinks, and moves
any other file it finds to `~/.local/state/wachiman-install/backup/<timestamp>/`.

That script is for contributors: the links point into your clone. Whoever runs Wachiman from a
package runs `wachiman skills install` instead. From a clone, run `bun src/cli.ts skills install`,
which is the same command. It copies the two skills into the same directories (it does not install
the command), refuses anything under `~/.wachiman`, marks every copy it makes, leaves any copy
without that marker (or with edits) in place with a warning, and `wachiman skills uninstall` removes
only the marked copies. See [`skills`](cli.md#skills).

From either install, `wachiman` runs the engine of its own package, or of its clone (or
`$WACHIMAN_DIR`), and passes `--no-env-file` and `--config=` so a `.env` or `bunfig.toml` of the
reviewed repository stays out of the engine process (Bun reads both from its working directory, and `bunfig.toml` can run code; see
[the command-line contract](cli.md#options)). It changes no environment variable and adds no flag:
the account is chosen inside the command (see "Profiles" below), and `ANTHROPIC_API_KEY` is refused
there, so `bun src/cli.ts local` and `wachiman local` behave the same. If your shell exports a key,
run `env -u ANTHROPIC_API_KEY wachiman local ...`. Earlier versions of the wrapper dropped the key and
turned `WACHIMAN_PROFILE` into `--profile`; it no longer does either, and `WACHIMAN_PROFILE` is now
one rung of the precedence below.

Check the setup any time with `wachiman doctor`: it lists what a local run would use and what would
fail, makes no model call and no request of its own, and exits 1 when a required check fails.

**Windows: not tested in CI, expected to work.** The npm package is written to work on Windows with
Node (Bun comes with the package), and it should work wherever Node and Bun run, but nothing
tests it there. CI had a `windows-latest` job; it was removed because it produced failures unrelated to
the product, mostly runner-speed timeouts. If the package does not work, the launcher prints the
install commands. The bash wrapper (`bin/wachiman`) and `scripts/install-local.sh` are POSIX only.

On Windows, the fallback Bun is a `bun.exe` on `PATH` (the official installer puts it in
`%USERPROFILE%\.bun\bin`) or the npm-global `node_modules\bun\bin\bun.exe` next to the `bun.cmd`
shim that `npm i -g bun` creates. The Windows install line is
`powershell -c "irm bun.sh/install.ps1|iex"`; open a new terminal afterwards so `PATH` is reloaded.

Prefer no install? The raw command is
`bun --no-env-file --config=<engine>/bunfig.toml <engine>/src/cli.ts local --repo-dir <clone>`.

### Configure this project

From an existing Git worktree, run:

```sh
wachiman init --mode local
```

Choose **Use my current Claude session** to use your normal sign-in and settings, or
select an existing profile, create an isolated one, or register a directory you already
use. Enter prefers the project's binding, then your configured default, then your current
session. Review the binding and confirm it. Wachiman saves references under its own home;
it does not copy credentials or write configuration into your repository.

The final checks make no model call. `local: ready` means the required machine/account
checks passed; the review range still needs to be valid. If a check fails, the binding
stays saved, the command exits 1 and shows a doctor command for this repository. Fix the
reported issue before running the review. A signed-out current session needs your normal
`claude` sign-in; an isolated/external account has its own login command.

`wachiman setup` can change the binding later. `wachiman init` without `--mode` also offers
GitHub or both. GitHub setup leaves secret creation and workflow submission as manual steps.

Escape, Ctrl-C or EOF cancels with exit 130. A confirmed directory creation, login, workflow
write or binding is reported accurately if a later stage is cancelled. Re-running keeps the
existing binding selected. Use `NO_COLOR=1` for plain output; Windows suggestions name their
shell. In scripts use `wachiman setup --profile default --yes` (or a registered profile): no
prompt is shown, and `--profile` is required.

## 4. Run

```sh
wachiman local --repo-dir .                      # the current branch against origin's default branch
wachiman local --repo-dir . --base develop src   # against develop, only files under src/
wachiman local --repo-dir . --format markdown --output review.md
wachiman local --repo-dir . --commit abc1234      # exactly one commit
wachiman local --repo-dir . --from abc1234        # that commit and everything after it, up to HEAD
```

| Option | What it does |
| --- | --- |
| `--repo-dir <dir>` | The clone. Default: the current directory |
| `--base <ref>` | What the branch is compared with. Default: `origin/HEAD` when it resolves (the remote's default branch), else `main`. No fetch is made: fetch first if your base is stale |
| `--from <commit>` | Review from that commit forward, inclusive: `<commit>^ → HEAD`. It must be an ancestor of `HEAD`, which must be a branch |
| `--commit <commit>` | Review exactly that commit: `<commit>^ → <commit>`. `HEAD` can be anywhere, even detached; your working tree is not touched |
| `--max-depth <n>` | The most commits the review may span, from its start commit to `HEAD`. Default 250. The cap catches a wrong base, such as reviewing all of `main` by accident; it does not limit cost, the size gate does. Over it, the run stops with exit 2 before any call; raise it (or lower it) for one run. A positive integer; no environment variable |
| `[paths…]` | Review only the changed files under these paths. A word that names no changed file is ignored, with a line on stderr |
| `--input <file>` | Review a `wachiman.review-input/1` file ([formats](formats/README.md)) instead of computing the diff; its `change.head.sha` must exist in `--repo-dir` |
| `--confidence <file>` | Grade the change as the pull request in `{ "title", "body", "number"?, "url"? }`: PR Confidence, in `fidelity` of the `/2` JSON ([page](pr-confidence.md#grade-a-pull-request-on-your-laptop)) |
| `--format terminal\|markdown\|json` | Default `terminal` (plain text). `markdown` holds every finding and ends with the prompt for your agent. `json` is the [`ReviewResult`](formats/README.md) |
| `--output <file>` | Write the report there instead of stdout |
| `--agent-prompt` | With `terminal`: also print the prompt for your agent |
| `--profile default\|isolated[:<name>]` | Which Claude Code profile runs the review (below). Default `default` |

What is reviewed is the **committed** change. Uncommitted edits and untracked files are never part
of it. Which commits depend on the option:

**Which range**

| You pass | Reviewed range | `HEAD` | Depth |
| --- | --- | --- | --- |
| nothing, or `--base <ref>` | `merge-base(base, HEAD) → HEAD` | a branch (not the base itself, unless `--base` names a commit) | at most `--max-depth` (250) |
| `--from <commit>` | `<commit>^ → HEAD`: the commit and everything after it | a branch that contains `<commit>` | at most `--max-depth` (250) of `<commit>^..HEAD` |
| `--commit <commit>` | `<commit>^ → <commit>`: that commit alone | anywhere: any branch, or detached | 1 |

`--commit`, `--from` and `--base` exclude each other, and `--input` excludes all three. For a merge
commit, `<commit>^` is its first parent, and the preamble says so. A root commit (no parent) is
compared with the empty tree. The instruction files (`CLAUDE.md` and the rest) are read from the
start of the range, as at the merge-base: with `--commit` that is the commit's parent, so a commit
that adds or edits `CLAUDE.md` is reviewed under the old rules. With `--history`, a run of an old
commit never settles findings first seen at a newer head: they stay `unknown`.

**The start commit and the depth.** The merge-base is the start commit of the review. A big range
is fine, but not all of `main`: the range may span at most 250 commits (`--max-depth <n>` changes
that for one run), however many files or lines they touch. Over the limit, the run stops with exit
2 and no call is made; pass a closer `--base <commit>` or raise `--max-depth`. On the base branch
itself there is no branch to review, so the run stops with exit 2 unless you pass `--base
<commit>` to name where the review starts (that range obeys the same limit). The engine takes a snapshot of the head commit (`git
archive` into a temporary directory) and the model reads that, so you can keep editing while it
runs.

Before any call, stderr shows what will be reviewed:

```text
base: origin/main (1a2b3c4)
merge-base: 9f8e7d6
depth: 12 commits (max 250)
head: feat/export (5d6e7f8)
files: 6 (0 excluded)
batches: 1
```

With `--commit abc1234` the first lines are `mode: one commit (abc1234)`, `start: 9f8e7d6`
(the parent), `depth: 1 commit` and `head: abc1234`; with `--from abc1234` they are `mode: from abc1234
to HEAD`, `start: …`, `depth: … (max 250)` and `head: feat/export (…)`. The report's headline names
the commit and its parent instead of a base branch. For `--commit`, `head.ref` in the JSON result is
the branch when `HEAD` is on that commit, else the short sha.

Progress and warnings go to stderr; the report goes to stdout (or `--output`), so
`--format json | jq` works. Each batch is one `claude` call; the 2026-11-04 trial on a 6-file pull
request took 34 s for its one call. `Ctrl-C` stops the review after the call it interrupts,
removes the snapshot and exits 130.

**Profiles.** A profile is the Claude account (a Claude Code configuration directory) that runs the
review. There are three kinds:

- `default`: your own `claude` with its usual configuration directory.
- A **managed** profile: `~/.wachiman/claude-<name>`, a directory that holds only a sign-in, so none
  of your own `CLAUDE.md`, skills, hooks or MCP servers can reach the review.
- An **external** profile: a configuration directory you already use, registered in place with
  `wachiman profile add`. Wachiman never writes into it.

`local` picks the account by the first rule that applies, and a rule that applies and fails stops
the run (exit 2) instead of falling to the next:

1. `--profile <name>` (also `default`, `isolated` and `isolated:<name>`, which mean the managed
   profile of that name).
2. The project binding made by `wachiman setup`.
3. `WACHIMAN_PROFILE`.
4. The default set by `wachiman profile default <name>`.
5. The built-in `default`.

Before any call, stderr shows the choice, for example `profile: work (managed; chosen by project
binding; WACHIMAN_PROFILE=other ignored)`.

```sh
wachiman profile create work                  # managed profile; starts claude, run /login, then /exit
wachiman profile add personal --config-dir ~/.claude-personal   # an external profile, used in place
wachiman profile list                         # what exists, and which projects use it (--json too)
wachiman setup --profile work                 # bind this repository to it; run from the clone
wachiman project show                         # what local would use here, and why
wachiman profile default work                 # the fallback for repositories with no binding
wachiman profile login work                   # sign in again
wachiman profile remove work [--delete-dir]   # forget it (the directory stays unless --delete-dir)
```

The binding is stored in `~/.wachiman/config.json`, keyed by the repository's origin URL (or its git
directory when it has no origin), so every clone and worktree of one origin shares it. `setup`
prints what it will write and, on a terminal, asks first; nothing is written to the repository. Without a terminal
it needs `--profile` (the guided wizard for the bare `wachiman setup` is not built yet, so for now
it exits 2 and writes nothing). `WACHIMAN_HOME` (an absolute path) replaces `~/.wachiman`.

`wachiman --setup-profile [<name>]` is the old spelling of `profile create`. Wachiman never sees the
sign-in and does not check that it worked: run `wachiman doctor` (the `auth` row) or `local` to find
out. A managed profile that holds more than a sign-in (a `CLAUDE.md`, `hooks/`, `skills/`,
`agents/`, `commands/`, `.mcp.json`, or a `settings.json` with hooks or MCP servers) is refused. On
macOS the sign-in is stored in the keychain under the directory's path: moving or renaming
`~/.wachiman` signs the profile out, and `profile remove --delete-dir` does not remove the keychain
entry.

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
on for one run with `--history`, or for every run with `WACHIMAN_HISTORY=1`.

- **What is saved.** One file per run, `~/.wachiman/history/<name>-<hash>/runs/<time>-<sha7>.json`,
  holding the whole result, including the finding text, which quotes your code. It is as sensitive
  as a `--output` report. The history directories are set to mode 0700 and files to 0600 on every save. `<name>-<hash>` comes from the
  `origin` URL (credentials removed), so every clone and worktree of one repository shares a
  history; without an `origin` it comes from the clone's git directory.
- **What it tells you.** Each finding is labelled `new` or `open since <sha7>`, with an id. A
  finding is the same as an earlier one when the file matches (renames followed) and the
  cited line has the same text (the topic may differ), or the topic matches and the title is the
  same once digits and punctuation are ignored.
  No model decides that. An earlier finding this run did not repeat is `probably fixed` (the file
  was reviewed and the cited code changed), `not repeated` (reviewed, code unchanged: the reviewer
  just did not say it again) or `unknown` (the file was not reviewed: a path scope, a skip, a usage
  limit). It says "probably" because a fix is inferred from absence, never observed. With
  `--format json`, stdout is unchanged; stderr lists this run's findings with their labels and ids
  (`This run (history):`), then this block.
- **`wachiman history`** lists what is tracked, per repository: status, first and last head,
  runs, id and your verdict. `--since 7d`, `--all-repos` and `--json` narrow or reshape it. It reads
  files and local git metadata only (it asks `git` for the repository's key): no `claude`, no GitHub.
- **Verdicts.** `wachiman history --verdict <id> correct|partial|wrong [--reason "…"]` records
  your judgement, with the words of [precision](precision.md). It appears in the listing and in
  later reports. It does not change a review: a finding you called wrong is still reported if the
  reviewer repeats it, which is how you see a persistent false positive.
- **Retention.** 30 days, per repository, pruned when that repository is saved
  (`WACHIMAN_HISTORY_DAYS=<n>`, `0` keeps everything). A repository you stop reviewing keeps
  its files until you forget them.
- **Forget.** `wachiman history --forget [--repo-dir <dir>]` deletes one repository's history;
  `--forget --all` deletes `~/.wachiman/history`. Neither touches `~/.wachiman/claude-*`.
- **Nothing is exported.** No upload, no sync. The files never leave the laptop unless you copy them.

### Let your coding agent run it

[`skills/wachiman-review`](../skills/wachiman-review/SKILL.md) is an agent skill. It teaches a coding
agent, such as Claude Code or Codex, to run this review for you: it picks the range from what you
ask ("my branch", "only commit X", "from X on"), finds your profile with `project show` and `profile list`, runs `local` with
`--history`, presents the findings, and records your verdicts with `history --verdict`. It never
uses the GitHub modes and never reviews the code itself. Its sibling
[`skills/wachiman-loop`](../skills/wachiman-loop/SKILL.md) drives `wachiman loop`: it fixes what a round
reports, or judges a finding wrong with a reason, and calls the next round (never to make it converge). A third skill,
[`skills/wachiman-audit`](../skills/wachiman-audit/SKILL.md), compares Wachiman's posted findings with
CodeRabbit's or Pullfrog's on the same commits, through `scripts/pair.ts` in
[wachiman-benchmarks](https://github.com/niway-dev/wachiman-benchmarks). `wachiman skills install`
copies all three (see section 3). To link them by hand from a clone instead, link each folder into your
agent's skills directory and set `WACHIMAN_DIR` to this clone:

```sh
ln -s "$PWD/skills/wachiman-review" ~/.claude/skills/wachiman-review
export WACHIMAN_DIR="$PWD"   # in your shell profile
```

## 6. Limits

- **Work limits, and the estimate guard.** Each call is bounded by `WACHIMAN_MAX_TURNS` and
  `WACHIMAN_CALL_TIMEOUT_S`; the run by `WACHIMAN_BUDGET_USD` (default $3), counted in the
  API-equivalent estimate. See [configuration](configuration.md#local-mode).
- **Size warning, never a refusal.** Before the first call, `local` estimates what reviewing all of
  the change would cost. When that is above `WACHIMAN_SIZE_GATE_USD` (default $6) and above your
  budget, it prints one warning line on stderr and carries on. The money caps are
  `WACHIMAN_BUDGET_USD` for the run (default $3) and `WACHIMAN_BATCH_BUDGET_USD` for each
  call (passed to Claude Code as `--max-budget-usd`, a soft cap); there is no per-pull-request
  ceiling. On a subscription the cost is Claude Code's API-equivalent figure, not a bill. See
  [the size gate](costs.md#the-size-gate) and [ADR 0037](adr/0037-a-pull-request-above-the-size-gate-is-not-reviewed.md).
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
| `stop: error — the provider refused the call (auth): Not logged in · Please run /login` (exit 1) | The profile is not signed in. Run `claude` and `/login` for `default`, or `wachiman profile login <name>` for another profile; `wachiman doctor` shows which one is in use |
| `` `main` and HEAD have no common ancestor `` (exit 2) | The base is unrelated history. Pass the right `--base` |
| `No base branch found; pass --base <ref>` (exit 2) | No `origin/HEAD` and no `main`. Pass `--base`, or run `git remote set-head origin --auto` |
| `HEAD is on main, which is the base: there is no branch to review. …` (exit 2) | You are on the base branch, or on a branch with no commit past it. Check out your branch, or pass `--base <commit>` to review from that commit |
| `The range from 1a2b3c4 to 5d6e7f8 is 251 commits, more than the maximum depth of 250. …` (exit 2) | The range is deeper than the limit, and nothing was sent. Pass a closer `--base <commit>`, or raise the limit with `--max-depth <n>` |
| `HEAD is detached; check out a branch, or pass --input` (exit 2) | Check out a branch (`git switch -c review-me`) |
| `The snapshot lacks N file(s) that the head commit has …` | `export-ignore` or a submodule. The review goes on without those files; remove the attribute on a temporary branch if they matter |
| `history: … cannot be read (…); moved to … .unreadable-<seconds>` | A history run file is not JSON or is structurally invalid. It was moved aside as `<name>.json.unreadable-<seconds>` (renamed, not deleted) and skipped; the run went on. Delete it when you no longer need it. A file written by another format version (say, after a downgrade) is skipped with a warning and left where it is |
| An isolated profile seems to use another account | A `claude` **shell function or alias** that sets `CLAUDE_CONFIG_DIR` does not affect Wachiman (it starts the binary from `PATH`, without a shell), but it does affect a `claude` you run by hand to sign in. That is why `profile create` and `profile login` exist: they start the binary themselves with the profile's directory. Check with `type claude` |

Exit codes: 0 a report was printed (complete, partial, or ended by a usage limit), 1 no call
returned a review, 2 usage error, 130 interrupted. See [cli.md](cli.md#local).

## Review uncommitted tracked changes

```sh
wachiman local --working-tree staged
wachiman local src --working-tree all --format json --history
```

`staged` reviews the current index against `HEAD`. `all` includes unstaged edits and deletions
of the index's tracked paths. Stage a new file to include it: untracked and ignored files are
excluded. A temporary index and object database keep the real checkout unchanged; a change
during capture aborts with a retry message. After capture, later edits cannot affect the review.
Symlinks are read as link text. Conflicts, unborn HEAD, split indexes, sparse/skip-worktree
entries, gitlinks and non-UTF-8 paths are explicitly refused. No configured filters, hooks, fsmonitor, external
diff or submodule commands run during capture.

JSON uses result `/2` automatically for working-tree reviews; `/1` is refused before model calls.
Committed reviews keep their existing `/1` default. With `--history`, finding fingerprints can
match earlier runs; a missing finding involving a temporary tree stays unknown rather than being
called fixed. See [the CLI contract](cli.md#working-tree-snapshots) for capture and cleanup rules.
