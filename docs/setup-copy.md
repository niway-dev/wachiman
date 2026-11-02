# Migrate a copied installation

This page is for a repository that already runs Wachiman from a copy of the files: `src/` copied
to `scripts/agent-review/` and a workflow built from
[`templates/caller-workflow.yml`](../templates/caller-workflow.yml). It explains how to move to
the maintained reusable workflow, and it keeps the reference for the copy setup for as long as
copied installations exist. For a new installation, use [install.md](install.md) instead.

## Status: the copy setup is legacy

The reusable workflow is implemented and is the recommended install
([install.md](install.md), [ADR 0001](adr/0001-distribution-and-trust.md)). The copy template is
still in the repository and still runs, but it is a one-time snapshot: nothing updates it. To get
a fix you copy `src/` again by hand.

What changes when you migrate:

- **Who supplies the engine.** In a copy, the engine lives in your repository, so on a
  `pull_request` the engine that runs with your key is the pull request's own copy. In the
  reusable workflow the engine is checked out from the release you pin, next to the pull request
  head and never from it. This is a better separation, not a sandbox: the trust assumption is the
  same in both setups. Everyone who can push a branch must be someone you trust with the key,
  because they can edit the workflow file that holds it ([SECURITY.md](../SECURITY.md)).
- **Who decides when it updates.** You do, by changing one pin line in the caller
  ([install.md](install.md#how-updates-arrive)), instead of copying files.
- **What you can configure.** The reusable workflow takes the inputs listed in
  [configuration.md](configuration.md). Some settings of a copy have no input there (see below).

## Migrate, step by step

1. **Identify what you have.** Find the workflow file (usually `.github/workflows/agent-review.yml`,
   or an older name), the folder holding the copied engine (usually `scripts/agent-review/`,
   or the older `scripts/claude-review.ts`), the operator login (set twice in the template: the
   `AGENT_REVIEW_OPERATOR` value and the `if:` of the on-demand job), and any environment
   settings you changed. The template names its own `EDIT THIS` markers.
2. **Back up your policy.** Keep your focus file (`.github/agent-review.md`, or the older
   `.github/claude-review.md`) and any settings you tuned. The focus file needs no migration:
   the current engine reads it from the pull request's base commit
   ([review-policy.md](review-policy.md)).
3. **Map your settings.** Use the table below. Anything marked "no input" does not carry over.
4. **Make one pull request that swaps the workflows.** In that pull request, add the caller file
   [`templates/agent-review-caller.yml`](../templates/agent-review-caller.yml) as
   `.github/workflows/agent-review.yml` (replacing the copy workflow, which uses the same
   file name) with `operator` set to the login you used before and your mapped inputs. Reuse the same
   repository secret `ANTHROPIC_API_KEY`. Leave `scripts/agent-review/` in place for now. A
   `pull_request` workflow runs from the pull request's own branch, so this pull request is
   reviewed by the reusable workflow alone, with no duplicate review. The job summary names the
   engine commit that ran.
5. **Read the result before you merge.** Check that a review was posted as described in
   [install.md](install.md#how-to-tell-it-worked). If you gave the caller a different file name, or
   kept the old workflow file, both workflows will answer the same pull requests and you will pay
   for both. Remove or disable the old one.
6. **Merge, then validate the comment path on the next pull request.** `/wachi review` runs from
   the default branch, so it can be tried only after the merge ([install.md](install.md#ask-for-a-review)).
7. **Clean up in a later pull request.** Once the new setup has worked on a second pull request,
   delete `scripts/agent-review/` (including its `bunfig.toml`). Keep it until then; it is what
   makes rollback a one-step revert.

### Settings map

| In the copy | In the reusable workflow |
| --- | --- |
| `AGENT_REVIEW_OPERATOR` and the login in the on-demand `if:` | `operator` (required, set once) |
| `AGENT_REVIEW_BUDGET_USD`, `AGENT_REVIEW_BATCH_BUDGET_USD`, `AGENT_REVIEW_ANSWER_BUDGET_USD` | `budget_usd`, `batch_budget_usd`, `answer_budget_usd` |
| `AGENT_REVIEW_BATCH_LINES`, `AGENT_REVIEW_BATCH_CHARS` | `batch_lines`, `batch_chars` |
| `AGENT_REVIEW_MODEL`, `AGENT_REVIEW_PROVIDER` | `model`, `provider` (the workflow installs Claude Code only; see [providers/codex.md](providers/codex.md)) |
| `AGENT_REVIEW_MENTION` | `mention` |
| `CLAUDE_CODE_VERSION`, `CLAUDE_CODE_SHA256` | `claude_code_version`, `claude_code_sha256` |
| Bun version in the workflow | `bun_version` |
| The `release-please--` branch check in the job `if:` | `skip_branch_prefixes` |
| Old `CLAUDE_REVIEW_*` variables | Rename to the `AGENT_REVIEW_*` input above ([cli.md](cli.md#deprecated-names)) |
| `AGENT_REVIEW_EXCLUDE` | no input |
| `AGENT_REVIEW_DRY_RUN` | no input |
| `AGENT_REVIEW_REASONING_EFFORT` | `effort` from the release after v1.3.0 (variable `AGENT_REVIEW_EFFORT`, default `high`, both providers); the old name still works but is deprecated and ignored when the new one is set ([configuration.md](configuration.md)). At v1.3.0 there is no input |
| `AGENT_REVIEW_PRICE_PER_MTOK` | no input (Codex setting) |
| Edits you made to the copied engine, such as `RISK_RULES` weights | not carried over |

There is no engine configuration file. The risk weights and the built-in excludes (lockfiles,
build output and generated files) are fixed in the engine at the release you pin, so a local edit
to the copied code has no equivalent. Nothing here promises that a setting without an input will
get one.

### Reviews you already have

The incremental starting point is kept in a marker at the end of each review the engine posted.
A review posted by a copy that predates review signatures carries an unsigned marker. The current
engine still reads an unsigned marker only if the review was submitted before
2026-11-01T00:00:00Z and before any signed review on that pull request, and it still recognises
unsigned finding threads created before that date. A copy that keeps posting unsigned reviews
after that date produces markers that the current engine ignores. On such a pull request the
first review after migration is a review of the whole pull request, and it spends accordingly.
Details: [upgrading.md](upgrading.md).

### Roll back

Revert the migration pull request. That restores the copy workflow and, because you kept
`scripts/agent-review/`, the engine it runs. A copy made before review signatures may not
recognise the markers the current engine writes, and could review a whole pull request again; this
has not been checked against every older copy, so try it on a small pull request. To turn Wachiman
off altogether, see [uninstall.md](uninstall.md).

## How the copy setup works

This part describes the legacy setup. The review itself (batches, risk order, retries, coverage)
works the same way in both installs and is described once, in
[architecture.md](architecture.md#the-pipeline-stage-by-stage); costs and what the limits mean
are in [costs.md](costs.md).

| When | What happens |
| --- | --- |
| A pull request opens ready for review, or leaves draft | A review in batches; after a complete, unscoped review, later requests cover only what changed since it |
| The operator comments `/wachi review` | A review of what changed since the last complete, unscoped review; when it has work to do, it also answers the replies in its open threads |
| `/wachi review <path>…` | A review of those paths only; words that name no changed file are ignored |
| Any other `/wachi …` by the operator | The question is answered as a comment |
| A batch hits its limit, or the pull request's budget is spent | The review posts what ran; batches that did not run are listed as not reviewed and the review is "partial" |

The automatic job is skipped for draft pull requests, fork pull requests, Dependabot and
`release-please--` branches. The comment job is not skipped for drafts, Dependabot or those
branches; it refuses fork pull requests. Lockfiles, build output and generated files are dropped
first. A file no batch accounts for marks the review "⚠️ Partial review" on its first line. There
is no size gate and no file-count guard. The review body is kept under 60,000 characters (GitHub
refuses about 65,000): a long "Not reviewed" list is cut to what fits and ends with "… and N more
(see the Coverage by batch table)".

The per-call limit on Claude Code is a soft client-side cap and can be exceeded
([providers/claude-code.md](providers/claude-code.md)). A dry run
(`AGENT_REVIEW_DRY_RUN=1 GH_TOKEN=… GITHUB_REPOSITORY=… bun scripts/agent-review/cli.ts review <pr>`)
reads GitHub and prints the review instead of posting it, but it still calls the agent, so it
costs money.

### Files

| Copy to | From |
| --- | --- |
| `scripts/agent-review/` | The whole `src/` folder of this repository: `cli.ts`, `engine.ts`, `config.ts`, `install-claude-code.sh` and `providers/` (including `providers/claude-code.settings.json`, which the adapter looks for next to itself and refuses to run without). Leave out the `*.test.ts` files, or keep them and run them with `bun test ./scripts/agent-review` |
| `scripts/agent-review/bunfig.toml` | The `bunfig.toml` at the root of this repository. The workflow passes it with `--config=` so Bun reads no `bunfig.toml` from the pull request's checkout |
| `.github/workflows/agent-review.yml` | `templates/caller-workflow.yml`: edit its trust paragraph, the operator login (twice) and the other `EDIT THIS` markers |
| `.github/agent-review.md` | Write it: the repository's review focus, as a short list. Optional |

The CLI contract (commands, environment, exit codes) is in [cli.md](cli.md). The CLI needs Bun
(the workflow pins 1.3.4) and nothing else from the repository.

### Setup, in order

1. **An API key.** In the Anthropic Console, create a key for this repository. Check what
   spending limits and usage reporting your account offers and how they are enforced; this project
   does not set or verify them. Promotional credits may expire: check your billing page.
2. **A repository secret, not an environment secret.** The jobs name no environment, so an
   environment secret is not passed to them:
   ```sh
   gh secret set ANTHROPIC_API_KEY -R <owner>/<repo>    # no --env
   ```
   In the web UI: Settings → Secrets and variables → Actions → **Repository secrets** → New
   repository secret.
3. **Copy the files** above. Run
   `bun --no-env-file --config=scripts/agent-review/bunfig.toml scripts/agent-review/cli.ts --help`
   once to check the copy.
4. **Write `.github/agent-review.md`**: the rules a reviewer of this repository must know, taken
   from its `CLAUDE.md`, not invented.
5. **Open the pull request that adds the files, ready for review.** A `pull_request` workflow
   runs from the pull request's own branch, so it reviews itself. The comment job runs from the
   default branch, so `/wachi review` can only be tried once the workflow is merged. The pull
   request that installs the files gets only the automatic review; a reply in a review thread
   never starts a run.

### Things that will surprise you

- **A pull request opened before the workflow reached the default branch gets no automatic
  review.** Comment `/wachi review` on it after the merge.
- **Toggling a pull request to draft and back re-runs the automatic review, but that does not
  force a new review.** If the head was already reviewed completely, the reply is
  `Already reviewed at …`. The same is true of a plain `/wachi review`. Push a change, or name a
  path: `/wachi review <path>` ([install.md](install.md#ask-for-a-review)).
- **Every comment on a pull request starts a workflow run**, skipped unless it is the operator's
  `/wachi` (or the `@agent-review` and `@claude` aliases). Concurrency is per job for that reason:
  a workflow-level group lets a skipped run cancel a review.
- **`anthropics/claude-code-action@v1` failed with `billing_error`** in one setup while `claude -p`
  with the same key, version and runner worked. The tool calls `claude -p` directly. If you try the
  action, its errors are hidden unless `show_full_output: true`, which prints every tool result.
- **An output that looks like a provider key is refused.** The CLI posts nothing and fails if text
  it would post matches the job's key or the shape of a key, which includes a review that quotes
  one ([troubleshooting.md](troubleshooting.md)).

### Security model

The same hardening applies as in the reusable workflow: Claude Code runs with `--restricted`,
`--strict-mcp-config` and `--tools Read,Glob,Grep`, and the CLI, not the agent, holds the tokens
and posts the review ([SECURITY.md](../SECURITY.md),
[providers/claude-code.md](providers/claude-code.md)). What is not tested, including the
`/proc` deny rules and a full paid run of the hardening flags, is listed in
[SECURITY.md](../SECURITY.md#what-is-unverified).

**This is not a sandbox.** Managed settings still apply, and an encoded key would pass the output
check. The copy cannot separate the engine from the head. You must trust everyone who can push
to the repository. Reviewing outside contributors' code needs a different design.

### Settings

The full list of `AGENT_REVIEW_*` variables, their defaults and the exit codes is in
[configuration.md](configuration.md) and [cli.md](cli.md). The template sets, in the workflow
`env` (the review job reads it from the pull request's branch, which the trust assumption
covers):

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_CODE_VERSION` | `2.1.304` | Pinned Claude Code; bump by hand and run a review |
| `AGENT_REVIEW_BATCH_LINES` | `1000` | Changed lines per batch |
| `AGENT_REVIEW_BATCH_BUDGET_USD` | `0.75` | Limit for one batch call; retries count against the total |
| `AGENT_REVIEW_BUDGET_USD` | `3` | Total for all batches (and retries) of one review |
| `AGENT_REVIEW_ANSWER_BUDGET_USD` | `1` | Limit for one question |
| `AGENT_REVIEW_OPERATOR` | (edit) | The login allowed to command the tool |

## Migrating a very old copy

An older copy used `CLAUDE_REVIEW_*` variables, `scripts/claude-review.ts` and `@claude`. The
current CLI reads each old variable when the new one is unset (with a notice on stderr), reads
`.github/claude-review.md` when the new focus file is absent, and accepts `@claude` as an alias,
so a repository can switch to the new files first and rename variables afterwards. Reviews that
carry the old unsigned marker are covered in "Reviews you already have" above.
