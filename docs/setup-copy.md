# Setup by copying the files

> This is the "copy the files" setup, documented today. The reusable workflow, which is the
> planned recommended install, will replace it; until then these steps are the way to run the
> tool. Paths in the "Files" table are paths in this repository (`src/`, `templates/`).

An advisory code review on GitHub pull requests, run by an agent CLI (today Claude Code, `claude -p`) in GitHub Actions and
paid from Anthropic Console API credits. Findings arrive as **inline review comments** you can
answer in their threads. The review is advisory: it never approves, requests changes or blocks a
merge.

It is meant for repositories whose pushers you trust, not for untrusted or fork pull requests.

## What it does

| When | What happens | Cost |
| --- | --- | --- |
| A pull request opens ready for review, or leaves draft | Full review in batches; afterwards, only what changed since the last reviewed commit |
| A push to an open pull request (`synchronize`) | Review of only the commits new since the last review; a rebase with no change in the pull request's lines posts one line and calls no model. Each push can spend up to `AGENT_REVIEW_BUDGET_USD`; remove `synchronize` from the trigger to opt out | $0.05–0.16 measured for one batch in v1; a large pull request costs several batches, at most `AGENT_REVIEW_BUDGET_USD` ($3) in total |
| The operator comments `/wachi review` | Review of what changed since the last reviewed commit; the agent answers the operator's replies in its open threads | ~$0.05 measured |
| `/wachi review <path>…` | Review of those paths only; words that name no changed file are ignored | — |
| Any other `/wachi …` by the operator | The question is answered as a comment | at most `AGENT_REVIEW_ANSWER_BUDGET_USD` ($1) |
| A batch hits its cap, or the pull request budget is spent | The review posts what ran; batches that did not run are listed as not reviewed and their files make it "partial" | at most $3 (soft cap) |

Skipped: drafts, fork pull requests, Dependabot and `release-please--*` branches. Lockfiles, build
output and generated files are dropped first. A file no batch accounts for marks the review
"⚠️ Partial review" on its first line. There is no size gate and no file-count guard: money bounds
the run, not size . The review body is kept under 60,000 characters (GitHub refuses
about 65,000): a long "Not reviewed" list is cut to what fits and ends with "… and N more (see
the Coverage by batch table)".

## Batches

- **Risk is computed from the path.** `riskScore` gives each file the highest weight of the
  `RISK_RULES` globs it matches (workflows 8, `ipc`/`preload` 8, credentials-like names 7,
  `scripts/**` 7, `package.json`, shared types, migrations/schema/`db`, shell and `infra` 6,
  `main` 5). Production code scores 4, tests 2, documentation, styles and messages 1, whatever
  their path. The default weights are a starting point you tune per repository by editing `RISK_RULES`;
  a configuration file is planned to replace editing the code.
- **Modules, then batches.** Files are grouped into modules (`moduleKey`: the first directory, or
  two segments under `apps/` and `packages/`), the riskiest module first, production code before
  tests before documentation inside it. A batch closes at `AGENT_REVIEW_BATCH_LINES` changed
  lines (1000) or `AGENT_REVIEW_BATCH_CHARS` characters of diff (140000, about 40k tokens at 3.5
  characters a token); one file above either limit is a batch of its own. Documentation is
  reviewed, with the same instruction as code, in the last batches because it scores lowest.
- **One call per batch**, in sequence, with the batch's annotated diff inside the prompt, sent on
  stdin (an argument would hit Linux's 128 KB limit). The prompt says the model manages no budget
  and that "read, nothing to flag" is a reviewed file.
- **Closed skip reasons.** `files_skipped` accepts `binary` and `no_diff_and_unreadable`, and a
  skip counts only for a file GitHub sent no diff for. A file with a diff in the prompt can always
  be read.
- **One retry per batch.** A batch that leaves files unaccounted for is re-run once with only
  those files, inside the remaining budget. This is the coverage re-run.
- **Budgets.** Each call gets `--max-budget-usd = min(AGENT_REVIEW_BATCH_BUDGET_USD, remaining
  total)`; the total is `AGENT_REVIEW_BUDGET_USD`. Below $0.05 left, no batch starts and the
  rest is listed as not reached. A call that dies without a result is counted at its cap and does
  not end the review. The CLI cap is a client-side soft limit and can overshoot.
- **Review body.** The first line starts with "👮 **Wachiman**", as every comment the
  tool posts does, and says whether the review is complete or partial. A collapsed
  "Coverage by batch" table lists each batch with its files, lines, highest risk, status
  (`reviewed`, `reviewed after a retry`, `ran out of its budget`, `not run: budget spent`, …),
  turns and cost; the footer shows the model, the number of batches and the total cost. The
  `<!-- agent-review sha=… -->` marker (the old `<!-- claude-review sha=… -->` is still read) is written only when every kept file is accounted for.
- **Dry run.** `AGENT_REVIEW_DRY_RUN=1 GH_TOKEN=… GITHUB_REPOSITORY=… bun scripts/agent-review/cli.ts
  review <pr>` reads GitHub but prints the review and replies instead of posting them. It still
  calls the agent, with whatever login the machine has, so it costs money; it does not print the
  batches and prompts without calling Claude.

Stdin prompts predate Claude Code 2.1.304 (the pin, kept). Checked at $0 on 2.1.308: a stdin prompt
with `-p --restricted --strict-mcp-config --tools Read,Glob,Grep --output-format json` is accepted
and reaches the API (a fake key ends in `api_error`, cost 0). The hardening flags themselves have
not run in a paid review: the runs that proved the engine predate them.

Not implemented yet: fan-in in the score, callers and
decision records assembled for the high-risk batch (4.5), YAML configuration, splitting an oversize
file by hunks with `too_large`, per-batch transcripts, and a dry run that prints batches and
prompts without calling Claude.

## Files

| Copy to | From |
| --- | --- |
| `scripts/agent-review/` | The whole `src/` folder of this repository: `cli.ts`, `engine.ts`, `config.ts` and `providers/` (including `providers/claude-code.settings.json`, which the adapter looks for next to itself and refuses to run without). Leave out the `*.test.ts` files, or keep them and run them with `bun test ./scripts/agent-review` |
| `scripts/agent-review/bunfig.toml` | The `bunfig.toml` at the root of this repository. The workflow passes it with `--config=` so Bun reads no `bunfig.toml` from the pull request's checkout |
| `.github/workflows/agent-review.yml` | `templates/caller-workflow.yml`: edit its trust paragraph, the operator login (twice) and the other `EDIT THIS` markers |
| `.github/agent-review.md` | Write it: the repository's review focus, as a short list. Optional |

The CLI contract (commands, environment, exit codes) is in [cli.md](cli.md); the Claude Code
hardening is in [providers/claude-code.md](providers/claude-code.md). The copy is a one-time
snapshot: to update it, copy `src/` again.

The CLI needs Bun (the workflow pins 1.3.4) and nothing else from the repository.

## Setup, in order

1. **An API key with a spend limit.** In the Anthropic Console, create a key for this repository,
   ideally in its own workspace with a monthly limit. Promotional credits may expire: check
   Settings → Billing.
2. **A repository secret, not an environment secret.** This mistake cost the first setup a run:
   ```sh
   gh secret set ANTHROPIC_API_KEY -R <owner>/<repo>    # no --env
   ```
   In the web UI: Settings → Secrets and variables → Actions → **Repository secrets** → New
   repository secret.
3. **Copy the files** above. Run `bun --no-env-file --config=scripts/agent-review/bunfig.toml scripts/agent-review/cli.ts --help` once to check the copy.
4. **Write `.github/agent-review.md`**: the rules a reviewer of this repository must know, taken
   from its `CLAUDE.md`, not invented.
5. **Open the pull request that adds the kit, ready for review.** A `pull_request` workflow runs
   from the pull request's own branch, so it reviews itself. The `/wachi` job runs from the
   default branch, so it can only be tried after the merge. **First-install limitation** (seen in a
   real setup): GitHub runs `issue_comment` workflows from the default
   branch's copy of the file, so the pull request that installs the kit only gets the automatic
   review on open/ready. `/wachi review` and thread replies work from the next pull request, once
   the workflow is on the default branch.

## Things that will surprise you

- **`anthropics/claude-code-action@v1` failed with `billing_error`** while `claude -p` with the
  same key, version and runner worked. The tool calls `claude -p` directly. If you try the action,
  its errors are hidden unless `show_full_output: true`, which prints every tool result.
- **A pull request opened before the workflow reached the default branch gets no review.** Comment
  `/wachi review` on it.
- **Re-running a review on purpose**: toggle the pull request to draft and back
  (`gh pr ready <n> --undo && gh pr ready <n>`), or comment `/wachi review`. Each toggle shows up
  as a `ready_for_review` run in the Actions list.
- **Every comment on a pull request starts a workflow run**, skipped unless it is the operator's
  `/wachi` (or the `@agent-review` and `@claude` aliases). Concurrency is per job for that reason: a workflow-level group lets a skipped run
  cancel a review.
- **`gh --jq` prints string results raw**, like `jq -r`. The script relies on it.
- **Line numbers**: the agent reads a diff whose lines carry their number in the file at the head.
  Without that it cited positions in the diff file, and the comment could not be anchored.
- **A key guard that matches the literal `sk-ant-` prefix fires on a review that quotes it.** The
  CLI matches the job's exact key or the full key shape.

## Security model

Claude Code (the default adapter; Codex is documented in docs/providers/codex.md) runs with `--restricted --strict-mcp-config --tools Read,Glob,Grep`
and the adapter's `--settings` file: no shell, no MCP servers, the head's user, project and local settings (its
`.claude/` hooks included) ignored, no GitHub token in its environment, `/proc` denied to every
read tool (unverified under `--restricted`), and `--max-budget-usd` per call. Whether the head's
`CLAUDE.md` still loads as memory under `--restricted` is unverified. The CLI holds the tokens, posts the
review, and posts nothing at all if any text it would post contains the key. On a public repository, only replies by
`OWNER`, `MEMBER` or `COLLABORATOR` reach the agent, and only the operator's `/wachi` (or `@agent-review`, `@claude`) starts a run.

**This is not a sandbox.** Managed settings still apply, and an encoded key would pass the output
check. The tool is safe only when
everyone who can push is trusted. Reviewing outside contributors' code needs a different design.

## Settings

The full table of `AGENT_REVIEW_*` variables, their defaults and the exit codes is in
[cli.md](cli.md). In the workflow `env` (the review job reads it from the pull request's branch;
the trust assumption covers that) the template sets:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_CODE_VERSION` | `2.1.304` | Pinned Claude Code; bump by hand and run a review |
| `AGENT_REVIEW_BATCH_LINES` | `1000` | Changed lines per batch |
| `AGENT_REVIEW_BATCH_BUDGET_USD` | `0.75` | Cap per batch call, retries included in the total |
| `AGENT_REVIEW_BUDGET_USD` | `3` | Total for all batches (and retries) of one review |
| `AGENT_REVIEW_ANSWER_BUDGET_USD` | `1` | Cap for one question |
| `AGENT_REVIEW_OPERATOR` | (edit) | The login allowed to command the tool |

## Migrating an older copy

An older copy used `CLAUDE_REVIEW_*` variables, `scripts/claude-review.ts` and `@claude`. The new
CLI reads each old variable when the new one is unset (with a notice on stderr), reads the old
`<!-- claude-review sha=… -->` marker and `.github/claude-review.md`, and accepts `@claude` as an
alias, so a repository can switch to the new files first and rename variables afterwards.
