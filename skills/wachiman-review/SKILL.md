---
name: wachiman-review
description: Use when the developer asks to review, audit or "analyse" their own code with Wachiman on their laptop — a branch, one commit, or a range from a commit — including on employer code that must not reach GitHub, when they ask Wachiman to explain or answer a question about such a change ("explain this change", "ask about this branch"), and when they judge a finding from such a review as right or wrong.
---

# Review local code with Wachiman

## Why

Wachiman reviews a change in an empty, isolated Claude Code profile with fixed rules: only
committed work, a capped range, no telemetry, nothing posted anywhere, and an opt-in history on the
laptop that tracks which findings were real. Your own session carries the developer's skills,
`CLAUDE.md` and plugins, so **you never review the code yourself: you choose the range, run the
CLI, and present its result.**

## The one command

Every review is `wachiman local`. The wrapper only sets the Bun flags that keep the reviewed
project's dotenv files and `bunfig.toml` out. It changes no environment variable and adds no flag:
`local` itself decides which account runs (see "Choose the profile") and refuses to start when
`ANTHROPIC_API_KEY` is set, so run it as `env -u ANTHROPIC_API_KEY wachiman local ...` when the
variable may be set in the developer's shell.

```sh
env -u ANTHROPIC_API_KEY wachiman local --repo-dir <clone> <range> [--profile <name>] \
  --history --format json --output <tmp>/review.json 2> <tmp>/run.log
```

Pass `--profile` only when no project binding exists, as below. If `command -v wachiman` finds nothing, stop: ask the developer for the path of their
Wachiman clone (once) and tell them to run `scripts/install-local.sh` from it, then retry. Never
fall back to GitHub modes.

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

Ask Wachiman, never the file system. Do not read inside any profile directory.

1. Run `wachiman project show --json --repo-dir <clone>`. If `binding` is present, the project is
   bound to a profile: **do not pass `--profile`** (a flag would override the binding the developer
   chose). `resolved.profile` says which account `local` will use; mention it in one line.
2. If there is no `binding`, run `wachiman profile list --json`. `profiles[].name` is what
   `--profile` takes. Without a binding, `local` uses a profile on its own only when `resolved.rung`
   in the `project show` output is `env` or `configDefault`; pass `--profile` then only if the
   developer names another. A lone registered profile is not used automatically: with
   `resolved.rung` `builtIn`, `local` runs on the developer's own `claude`. Ask which account
   (name the only one, if there is one), then pass `--profile <name>`. Offer `wachiman setup --profile <name>` to bind the
   choice to this project so nobody has to ask again (it writes only under `~/.wachiman`, never in
   the repository).
3. `profiles` empty → offer `wachiman profile create` (the developer signs in once), or
   `--profile default` only after telling them their own plugins could reach the review.

If `resolved` holds an `error`, relay it: it names the setting to fix, and `wachiman doctor` shows
the rest.

## Present the result

From the JSON, with the labels from `run.log`: the coverage line first (and what was not reviewed), then findings by severity
with `path:line`, title, one sentence of why, the history label (`new` / `open since <sha7>`) and
its id. Then the estimated cost (an API-price estimate, not a bill) and the report path. Findings
are the reviewer's claims, not verified bugs: say so, and offer to check one against the code.

## Questions about a change

When the developer asks what a change does, or asks a question about it ("how does the retry
work?", "explain this branch"), run `wachiman ask` with the same range and profile rules as above.
Use the same scope flags as `local` (`--commit`, `--from`, `--base`, `--working-tree staged|all`);
with no question, `ask` gives a five-section walkthrough.

```sh
env -u ANTHROPIC_API_KEY wachiman ask "<question>" --repo-dir <clone> <range> [--profile <name>] \
  --format json 2> <tmp>/ask.log
```

The JSON has `sections[]` (each with `title`, `body` and `refs[]` of `path` and `line`) and
`notAnswered`. Present the answer section by section. Cite each claim as `path:line` from its
`refs`, and never add a path or line that is not in the JSON. `removedRefs` says how many
references did not check out against the code: say so when it is above zero.

When `hasReview` is `false`, the answer comes from the diff alone and the log carries the notice to
run a review first. Say that, and offer to run `wachiman local --history` on the same range so the
answer can use its findings. `ask` never runs a review itself. It reads the stored history without
`--history`, and writes nothing to the repository or the history (only the `--output` file, if given).

## Record a verdict

When the developer says a finding is right, wrong or half right:

```sh
wachiman history --repo-dir <clone> --verdict <id> correct|partial|wrong --reason "<their words>"
```

`wachiman history --repo-dir <clone>` lists what is tracked.

## Never

| Tempting | Instead |
| --- | --- |
| `wachiman review <pr>`, `WACHIMAN_DRY_RUN`, `gh`, a GitHub token | `local`: the GitHub modes post to the PR and need the code on GitHub |
| A verdict as a PR comment or `Verdict:` reply | `history --verdict`: it stays on the laptop |
| Running with `ANTHROPIC_API_KEY` set | `env -u ANTHROPIC_API_KEY wachiman local ...`: `local` refuses a key; the subscription pays |
| `--max-depth 1000` because "review everything" | A closer start commit, or the number the developer chose |
| Reading the diff and reviewing it yourself | The CLI's review is the isolated one |
| Copying the report into an issue, chat tool or benchmark | It quotes the code; keep it on the laptop |
