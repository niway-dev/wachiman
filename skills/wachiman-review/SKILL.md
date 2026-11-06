---
name: wachiman-review
description: Use when the developer asks to review, audit or "analyse" their own code with Wachiman (or agent-review) on their laptop — a branch, one commit, or a range from a commit — including on employer code that must not reach GitHub, and when they judge a finding from such a review as right or wrong.
---

# Review local code with Wachiman

## Why

Wachiman reviews a change in an empty, isolated Claude Code profile with fixed rules: only
committed work, a capped range, no telemetry, nothing posted anywhere, and an opt-in history on the
laptop that tracks which findings were real. Your own session carries the developer's skills,
`CLAUDE.md` and plugins, so **you never review the code yourself: you choose the range, run the
CLI, and present its result.**

## The one command

Every review is `agent-review local`. The engine is the Wachiman clone at `$WACHIMAN_DIR`; if that
is unset or has no `src/cli.ts`, ask the developer for the path once.

```sh
env -u ANTHROPIC_API_KEY bun --no-env-file --config="$WACHIMAN_DIR/bunfig.toml" \
  "$WACHIMAN_DIR/src/cli.ts" local --repo-dir <clone> <range> \
  --profile <profile> --history --format json --output <tmp>/review.json 2> <tmp>/run.log
```

Run it from a directory outside the reviewed clone, and write `--output` to a temp directory:
`--history` already keeps the result on the laptop. `--format json` writes the
`wachiman.review-result/1` document. The history goes to stderr, hence `run.log`: the
`This run (history):` block gives each finding's label (`new` / `open since <sha7>`), id and any
earlier verdict; `Since the last run` lists earlier findings this run did not repeat.

## Choose the range

| The developer says | `<range>` |
| --- | --- |
| "my branch", "what I did here" (on a feature branch) | nothing: the merge-base with the default branch |
| "commit X", "only X" | `--commit X` |
| "from X on", "from X to the latest" | `--from X` (X included) |
| "since X" with X excluded, or another base branch | `--base X` |

Find X yourself with read-only git (`git log --oneline`, `git merge-base`) when the developer
names it loosely ("the commit where I added the cart"). Show the commit you picked before running.

On a refusal, report it and propose the fix it names:
- **Depth over the maximum:** propose a closer start commit (show the last 50 with `git log`).
  Pass `--max-depth <n>` only when the developer gives that number themselves after seeing the
  depth; a hurry is not a number.
- **HEAD on the base branch** (no range given): ask which commit to start from, then use `--from`
  or `--commit`; both work on the base branch.

## Choose the profile

List the profiles with `ls -d ~/.wachiman/claude-*` (never read inside them). The name is what
follows `claude-`: `~/.wachiman/claude-personal` is `--profile isolated:personal`. One →
use it. Several → ask which account. None → offer
`agent-review --setup-profile` (the developer signs in once), or `--profile default` only after
telling them their own plugins could reach the review.

## Present the result

From the JSON, with the labels from `run.log`: the coverage line first (and what was not reviewed), then findings by severity
with `path:line`, title, one sentence of why, the history label (`new` / `open since <sha7>`) and
its id. Then the estimated cost (an API-price estimate, not a bill) and the report path. Findings
are the reviewer's claims, not verified bugs: say so, and offer to check one against the code.

## Record a verdict

When the developer says a finding is right, wrong or half right:

```sh
… src/cli.ts history --repo-dir <clone> --verdict <id> correct|partial|wrong --reason "<their words>"
```

`agent-review history --repo-dir <clone>` lists what is tracked.

## Never

| Tempting | Instead |
| --- | --- |
| `agent-review review <pr>`, `AGENT_REVIEW_DRY_RUN`, `gh`, a GitHub token | `local`: the GitHub modes post to the PR and need the code on GitHub |
| A verdict as a PR comment or `Verdict:` reply | `history --verdict`: it stays on the laptop |
| Running with `ANTHROPIC_API_KEY` set | `env -u ANTHROPIC_API_KEY`: `local` refuses a key; the subscription pays |
| `--max-depth 1000` because "review everything" | A closer start commit, or the number the developer chose |
| Reading the diff and reviewing it yourself | The CLI's review is the isolated one |
| Copying the report into an issue, chat tool or benchmark | It quotes the code; keep it on the laptop |
