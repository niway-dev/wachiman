# Your first advisory review

This tutorial takes a repository with no Wachiman installation to one posted review. It uses the
reusable workflow, pinned to release **v1.5.0**. You will add one caller file and one secret,
open a pull request, and read the review. It takes a few minutes and spends a small amount on
your own model API key, or on your Claude subscription if you choose that route
([below](#review-on-a-claude-subscription)).

Wachiman is advisory. The review is a plain comment review: it never approves, requests changes
or blocks a merge.

## Before you start

You need:

- **A GitHub repository whose pushers you trust with your API key.** The workflow holds the key,
  and on a pull request GitHub runs the workflow file from the pull request's own branch, so
  anyone who can push a branch can change the workflow and read the key. Nothing in this tool
  defends against that. Read [SECURITY.md](../SECURITY.md) first; it is short, and it says what
  is still unverified.
- **An Anthropic API key, or a Claude subscription token.** The reusable workflow runs Claude
  Code and reads only `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. This tutorial uses the
  key; to pay from a Claude plan instead, see
  [Review on a Claude subscription](#review-on-a-claude-subscription). Create the key in the
  [Anthropic Console](https://console.anthropic.com). Usage is billed by Anthropic to the account that owns the key. Check what usage reporting and
  spending limits that account offers, and how they are enforced, before relying on them: this
  project does not set or verify them. Other providers: Codex is command-line only
  ([providers/codex.md](providers/codex.md)).
- **Permission to add a repository secret and a workflow file.** Creating repository secrets
  usually needs admin access. If your organisation restricts which actions and reusable
  workflows may run, allow `niway-dev/wachiman/.github/workflows/review.yml`.
- **Your GitHub login**, spelled exactly as on GitHub. It becomes the `operator`: the only person
  whose comments can start a review on demand.
- **Pull requests from branches in the same repository.** Fork pull requests are skipped on
  purpose.

## Choose where reviews run

After installing the [npm CLI](local-review.md#from-npm), run `wachiman init` inside your
Git repository. Choose local, GitHub Actions, or both. Local setup offers your current
Claude session, so you do not need to find its configuration directory. Both mode prepares
the workflow and then continues into account setup. Existing project bindings are proposed
on subsequent runs; existing workflows need `--force` before replacement.

For local reviews only, follow [local setup](local-review.md#configure-this-project).
The GitHub tutorial below requires an API key; local reviews use your Claude sign-in.

## Three steps

`wachiman init` prepares steps 1 and 3: it writes the caller file with your operator and the
release tag you pin. Adding the secret (step 2) and opening the pull request remain manual
actions in GitHub:

```sh
wachiman init --mode github --operator <your-github-login> --version v1.5.0
```

On a terminal, `wachiman init` asks for whatever the flags leave out: the review mode, your
operator login, the release tag and the workflow file path. It previews the file before it
writes it. `--dry-run` prints the file and writes nothing; `--force` replaces an existing file
and keeps a `.bak` copy. It never commits, pushes or opens the pull request. Copying the file by
hand, as below, works the same.

1. **Add the caller file.** Copy
   [`templates/wachiman-review-caller.yml`](../templates/wachiman-review-caller.yml) to
   `.github/workflows/wachiman-review.yml`. Its `uses:` line pins `v1.5.0`. The file is short:

   ```yaml
   name: Wachiman review
   on:
     pull_request: { types: [opened, ready_for_review, synchronize] }
     pull_request_review_comment: { types: [created] }
     issue_comment: { types: [created] }
   permissions: { contents: read, pull-requests: write, issues: read }
   jobs:
     review:
       uses: niway-dev/wachiman/.github/workflows/review.yml@v1.5.0
       with:
         operator: EDIT-THIS-github-login
       secrets:
         ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
   ```

   The caller owns three decisions: when the workflow runs (`on:`), which secret it passes, and
   the permission ceiling (`permissions:`). The reusable workflow cannot exceed that ceiling.
   `pull-requests: write` is what lets it post the review; only the comment job requests
   `issues: read`. [configuration.md](configuration.md) lists every other input.
2. **Add the secret.** Save the key as the repository secret `ANTHROPIC_API_KEY` (Settings,
   Secrets and variables, Actions, **Repository secrets**). An organisation secret shared with
   the repository also works. An *environment* secret does not: the job names no environment.
3. **Set the operator.** Replace `operator: EDIT-THIS-github-login` with your GitHub login. The
   jobs fail with an `operator is not set` error while it is empty or still a placeholder
   (`EDIT…`, `your-github-login`), because anyone could register a placeholder login and become
   the operator.

Commit the change on a branch and open a pull request that adds the caller file. Do not turn on
auto-merge for it: merging puts a workflow that uses your key on the default branch, so read the
file once more first.

## Review on a Claude subscription

The review can run on a Claude Pro, Max, Ultra, Team or Enterprise plan instead of an API key.
Claude Code documents this route for CI: `claude setup-token` makes a one-year token, and you
pass it as `CLAUDE_CODE_OAUTH_TOKEN`
([Anthropic's page](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)).

1. **Make the token.** On your laptop, signed in to the account whose plan should pay, run
   `claude setup-token`. It prints the token and saves it nowhere. The token can only make model
   requests.
2. **Save it as a repository secret.** Run `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo OWNER/REPO`
   and paste the token at the prompt, so it never lands in your shell history.
3. **Pass it in the caller.** Under `secrets:`, use the token line instead of the key line:

   ```yaml
       secrets:
         CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
   ```

What to know before choosing it:

- **The credential is chosen by which secret you pass.** If the token is present, the agent
  gets the token and never the API key, even when the caller passes both. If only the key is
  passed, nothing changes. If neither is passed, the run fails and says so.
- **There is no fallback to the key.** When the plan refuses a call (a usage limit, a rejected
  token), the run reports that and stops, the same way a refused API call is reported. It never
  retries with an API key, because that would spend money you did not decide to spend.
- **The token is tied to one person's plan.** It draws on that person's usage limits, shared
  with their own use of Claude. Anthropic recommends an API key for a secret shared across an
  organisation's repositories, because
  [an OAuth token is tied to the subscription of the person who ran `claude setup-token`](https://code.claude.com/docs/en/github-actions#set-up-for-an-organization).
- **The dollar figures become estimates.** `claude -p` still reports a cost, but on a
  subscription it is what the calls would cost at API prices, not a charge. The budgets and the
  per-pull-request ceiling keep using it to bound the work. The review footer, the "paused"
  notice and the `wachiman-cost` log line say it is an estimate (`auth` is `oauth-token`).
- **The trust rule is the same as for the key.** Anyone who can push a branch of the repository
  can change the workflow and read the token. A personal plan is under Anthropic's consumer
  terms (training setting, retention); a Team or Enterprise plan is under commercial terms.
  [ADR 0037](adr/0037-the-actions-review-can-run-on-a-claude-code-subscription-token.md) records
  the decision.
- **The token lasts a year.** When it expires or is revoked, calls are refused with an
  authentication error; make a new one with the same steps.

## What the first run does

The pull request that adds the caller file is the first one reviewed, because a `pull_request`
workflow runs from the pull request's own branch.

1. Open the pull request ready for review (not as a draft). The `opened` event starts the
   **Wachiman review** job. A draft starts it later, when you mark it ready for review.
2. In the repository's **Actions** tab, open the run named after your workflow (`Wachiman review`).
   The job summary starts with a line such as `Engine niway-dev/wachiman@<sha>`. That is the
   exact commit of the engine that ran with your key; it should be the commit `v1.5.0` points to
   (see the next section).
3. The job installs Bun and Claude Code, checks the Claude Code download against a SHA-256, runs
   the review and posts it.

That first pull request changes only the workflow file, so the review is small, but it is a real
model call on your key.

## How to tell it worked

A green job is not enough. It also stays green when the review was skipped on purpose. Look at
the pull request's **Conversation** tab for a review by `github-actions[bot]` (the identity the
workflow token uses, which other workflows in the repository share).

- **A review whose first line starts `👮 **Wachiman** ·`**, for example
  `review of the whole pull request, at abc1234: all 1 files reviewed.` (the commit is
  illustrative). This is the success case.
  Below it are the counts of findings, a summary, a collapsed "Coverage by batch" table and a
  footer with the model and the reported cost. Zero findings is a valid review.
- **`⚠️ Partial review`** on the first line: some files were not reviewed (budget, or the
  model did not account for them). The line lists them. This is a result, not a crash. See
  [costs.md](costs.md).
- **`Nothing to review at …`**: every changed file was a lockfile, build output or generated
  file, or fell outside the paths you asked for. No model call was made. This is also a normal
  result.
- **No review at all**: see [troubleshooting.md](troubleshooting.md). The usual reasons are a
  draft, a fork, a Dependabot pull request, a branch starting with `release-please--`, an
  `operator` still left as a placeholder, or a missing secret.

Reported cost is the provider adapter's figure, not an invoice; reconcile spending in your
provider's console ([costs.md](costs.md)).

## Ask for a review

Only the operator's comments count, unless `askers` allows collaborators to ask (see
[Ask a question](reviews.md#ask-a-question)). Comment on the pull request:

| You write | What happens |
| --- | --- |
| `/wachiman review` | Reviews what changed since the last complete, unscoped review. With no such review yet, it reviews the whole pull request. |
| `/wachiman review src/auth docs/notes.md` | Reviews only those changed files or directories (an exact path or a directory prefix, not a glob). |
| `/wachiman` followed by a question | Answers it as one pull request comment. One model call over the diff and the latest review, capped by `answer_budget_usd`. Each file and line reference it makes is checked against the head and linked there. |
| `/wachiman` alone, or `/wachiman explain` | Explains the change in five fixed sections (what it does, how it is built, what it connects to, open findings, what was not covered). One model call, same cap. |

The command word is the workflow's `mention` input, `/wachiman` by default. The older `/wachi`,
`@agent-review` and `@claude` still work, so a caller or a habit from before the naming release
keeps answering. Comment requests need the caller file on the repository's
default branch, because GitHub runs `issue_comment` workflows from there. They work on any open
pull request from then on, including ones opened earlier.

### Things to know before you comment

- **A push starts a review of the new commits.** The template lists `synchronize`, and the
  `review_on_push` input is `true` by default, so each push to an open pull request is reviewed
  (only the commits new since the last complete review), and each push can spend up to
  `budget_usd`. A caller written before ADR 0011 lists only `opened` and `ready_for_review`:
  bumping the pin does not add `synchronize`, so edit the caller. To review only on request,
  remove `synchronize` or pass `review_on_push: false` ([reviews.md](reviews.md#reviews-on-push)).
- **An unchanged head gets no new review.** If the head commit was already reviewed completely
  and you ask again without paths, the reply is a short review saying
  `Already reviewed at abc1234` and nothing is analysed. To look at it again anyway, name a
  path: `/wachiman review <path>`. Replies in finding threads are not processed in the
  unchanged-head case either (next point).
- **Your reply in a finding's thread gets an answer, with conditions.** The template lists
  `pull_request_review_comment`, so your reply (only yours, as `operator`) starts a short job that
  answers the threads waiting for an answer, once the head has been reviewed. A reply that asks a
  question (it starts with the command word and is not `review`) is answered in that thread. A new
  comment in the review panel (not a reply) that asks a question after the command word is answered
  under itself, with the file and line it was written on. Anyone else's comment starts nothing,
  unless it starts with the command word and `askers` is `write`, which is off by default; then the
  job starts, and the engine answers only a question from someone with write access. A caller
  without that trigger gets no such answer ([upgrading.md](upgrading.md#answering-thread-replies-without-a-push)).
- **Automatic runs share a ceiling.** The first review, push reviews and thread replies on one pull
  request together spend at most `auto_budget_usd` (default $6); then one notice is posted and
  `/wachiman review` still works ([costs.md](costs.md#the-ceiling-per-pull-request)).
- **A mistyped path can widen the request.** Words after `review` that match no changed file
  are ignored. If none match, the request runs as an unscoped review, which may spend more than
  the scoped one you meant. Check the path spelling against the pull request's file list.
- **A partial or scoped review does not move the starting point.** Only a complete, unscoped
  review does, so the next plain `/wachiman review` may cover more than you expect.
- **A comment request is not gated like the automatic review.** The automatic review skips
  drafts, Dependabot and `release-please--` branches. A comment from the operator runs on any
  same-repository pull request, including those.
- **A second request cancels the first** if the first is still running on the same pull request.

More on scoping, questions and reading results: [reviews.md](reviews.md).

## What pinning a version does and does not guarantee

The caller pins the reusable workflow with `@v1.5.0`. The recommendation is an exact release tag
such as this one, not the floating `v1`.

**What the pin does.** It chooses the workflow file and the engine together. The workflow
checks the engine out at the commit of the workflow file that was called, so the two are always
the same version, and the run records that commit in its job summary. Defaults written in the
workflow, such as the pinned Claude Code version, the Bun version and the budgets, belong to the
release too. They change when you change the pin or pass an input.

**What it does not do.**

- **An exact tag is a maintainers' policy, not an immutable reference.** Maintainers do not move
  published release tags, and this repository's rules protect `v*` tags. But
  [releasing.md](releasing.md) says release tags can be moved or deleted through a repository
  admin bypass, which the release process needs for the floating alias. Someone with that
  authority could re-point a tag. A full 40-character commit SHA cannot be re-pointed, so it is
  the stronger pin against a moved tag. Read the commit a tag points to with
  `git ls-remote https://github.com/niway-dev/wachiman refs/tags/v1.5.0`.
  The cost of a SHA is readability: add a trailing comment with the version, as this
  repository's own workflows do, so a person can tell what is pinned.
- **It does not review the code for you.** A pin selects a release. Reading what it does is
  your job; the release notes are in [CHANGELOG.md](../CHANGELOG.md).
- **It does not protect the caller file.** Anyone who can push a branch can edit your caller,
  including the `uses:` line, and that edited file runs on their pull request with your key
  ([SECURITY.md](../SECURITY.md)).
- **It does not freeze what is downloaded at run time.** The workflow downloads Bun and Claude
  Code at the versions it names. Claude Code's SHA-256 is checked against the publisher's
  manifest unless you pass your own `claude_code_sha256`
  ([providers/claude-code.md](providers/claude-code.md)). The runner image is GitHub's.
- **It does not remove trust in the maintainers.** The engine that runs with your key is this
  repository's code at the commit you pin.

The floating `v1` tag is moved by the release workflow after each stable 1.x release (or not,
when that step fails). Whoever can move it runs code with your key, and a release can reach your
repository before you have seen it, so it is not recommended.

## Checks before enabling

- The secret `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`, if you review on a subscription)
  exists in the repository (or the organisation, shared with it), and the caller passes it.
- The operator login is yours, spelled exactly as on GitHub.
- You are not expecting fork reviews: fork pull requests are skipped on purpose.
- Everyone who can push to the repository is someone you trust with the key. Read
  [SECURITY.md](../SECURITY.md).
- You know what a run can spend: [costs.md](costs.md).

## Optional: enroll in a spend ledger

Enrolling is optional. A repository that does not set `ledger_url` changes nothing and needs no new
permission.

A spend ledger keeps a daily and a weekly limit across repositories ([costs.md](costs.md#the-spend-limit)).
To use one, call `wachiman-platform.yml` instead of `review.yml` and grant `id-token: write` in the
caller's job. A called workflow cannot hold a permission its caller did not grant, which is why
`review.yml` itself never asks for it:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: read
  id-token: write      # lets the job ask the ledger for a GitHub OIDC token
jobs:
  review:
    uses: niway-dev/wachiman/.github/workflows/wachiman-platform.yml@vX.Y.Z
    with:
      operator: your-github-login
      ledger_url: https://your-ledger.example.com
      daily_budget_usd: 5   # optional, stricter than the account's limit
```

`vX.Y.Z` is a placeholder. `wachiman-platform.yml` exists only from the first release that contains it,
so pin that release or a later one: an earlier tag, such as the `v1.5.0` used elsewhere on this page,
has no such file. The release tooling (release-please) only bumps the version in `src/init/options.ts`;
it does not rewrite the tag in this example, in the caller template or in your caller file, and
`wachiman init` writes the `review.yml` form only.

`ledger_url` must start with `https://`: the job's identity token is sent to it. The token's
audience is `ledger_url` exactly as you wrote it, minus any trailing slashes, and it must equal the
ledger service's `LEDGER_AUDIENCE` setting character for character (scheme, host and path), or the
ledger answers `unauthorized`. Write `https://ledger.example.com`, not `https://ledger.example.com/`
in one place and without the slash in the other.

`templates/wachiman-review-caller.yml` carries the same block as a comment. The token is used only
to authenticate to the ledger; the agent that reads your code never sees it.

## Optional: a focus file

Add `.github/wachiman.md` to say what this repository's reviews should look at beyond the
defaults. It is read from the pull request's base commit, so a pull request cannot change the
rules it is reviewed under. See [review-policy.md](review-policy.md).

## Optional: settings

Only `operator` is required. Every other input, with its default, type and the environment
setting it becomes, is in [configuration.md](configuration.md#inputs); that page is the only place
the inputs are listed. The ones people change first are `mention` (the command word), the budgets
(`budget_usd`, `auto_budget_usd`, `batch_budget_usd`, `answer_budget_usd`), `skip_branch_prefixes` and
`review_on_push`. `askers` (default `operator`) lets collaborators with write access ask questions,
with `ask_ceiling_usd` (default `3`) as the most their questions may spend on one pull request. The
collaborator setting is off by default. Budgets apply per run, not per month, and the Claude Code limit on a call is a
soft client-side cap, so it can be exceeded ([costs.md](costs.md)).

## How updates arrive

Releases do not reach your repository by themselves. You change the pin, or you ask a tool to
propose the change.

- **Dependabot is optional, and you turn it on.** Nothing in this repository enables it for
  you. With it enabled for GitHub Actions, it opens a pull request for each new release that
  changes the `uses:` line, with the release notes linked. You read it and merge or close it.

  ```yaml
  # .github/dependabot.yml
  version: 2
  updates:
    - package-ecosystem: github-actions
      directory: /
      schedule:
        interval: weekly
  ```

  The automatic review skips Dependabot's own pull requests, so they cost no review budget. A
  release is not adopted until that pull request is merged; the `uses:` line on your default
  branch is what comment requests run.
- **A change to the pin made in any pull request runs on that pull request.** Because GitHub
  runs a pull request's own workflow file, a person who edits `uses:` in a branch gets the new
  version on that branch before anyone has merged it. Treat a change to this file as a change
  to code that holds your key.
- **A bad release is undone by you.** Edit the pin back to the previous release and merge. With
  an exact tag or a SHA the previous release is what it was, subject to the limits above. Policy
  changes and new major versions also arrive as a change to your caller.
- **Moving between releases, old names and rollback in detail:**
  [upgrading.md](upgrading.md). To turn it off: [uninstall.md](uninstall.md).

## Private repositories

- Calling a workflow across owners requires the workflow's repository to be public, which this
  one is. If it were private, only repositories allowed to use it could call it.
- Same organisation, private use: set this repository's Settings, Actions, General, Access to
  "Accessible from repositories in the organisation".
- The workflow checks the engine out with the job's own token. A token for your repository
  cannot read another private repository, so a private engine repository is not expected to
  work without extra setup.
- A private repository owned by a different user than this repository's organisation was seen
  calling `@v1` and checking out the engine across owners. That was a one-off observation on an
  earlier release, not a test in this repository.

## Where to go next

- Nothing happened, or it failed: [troubleshooting.md](troubleshooting.md).
- Ask for the review you mean, and read the result: [reviews.md](reviews.md).
- What a run can cost and what "all files reviewed" establishes: [costs.md](costs.md).
- Tell the reviewer what matters in your repository: [review-policy.md](review-policy.md).
- Every input and setting: [configuration.md](configuration.md).
- Turn it off and remove it: [uninstall.md](uninstall.md).
