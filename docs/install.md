# Install with the reusable workflow

Pin an exact release tag, such as `v1.0.0`. Exact tags never move, so the engine that runs with
your key is the one you read when you chose the tag, and every update is a change to your caller
file that you make or approve (see "How updates arrive"). The floating `v1` tag exists for
compatibility but is not recommended: it moves on every compatible release, so a release you have
not seen would run with your key.

Your repository keeps one short caller file. It owns the triggers, the secret it passes and the
permission ceiling; the reusable workflow in this repository runs the engine.

## Three steps

1. **Add the caller file.** Copy
   [`templates/agent-review-caller.yml`](../templates/agent-review-caller.yml) to
   `.github/workflows/agent-review.yml`. Its `uses:` line names the latest exact release tag;
   check the [releases](https://github.com/niway-dev/wachiman/releases) if you want another.
2. **Add the secret.** Create an Anthropic API key at <https://console.anthropic.com> and save it
   as the repository secret `ANTHROPIC_API_KEY` (Settings, Secrets and variables, Actions).
3. **Set the operator.** Replace `operator: EDIT-THIS-github-login` with the GitHub login of the
   one person who may start reviews by comment. Only that login's `/wachi` comments (or the older
   `@agent-review` and `@claude`) start a run.
   The jobs fail with a clear error while `operator` is empty or still a placeholder
   (`EDIT…`, `your-github-login`), because anyone could register a placeholder login.

Open a pull request. The automatic review runs when it opens or leaves draft.

**First install:** the pull request that adds the caller file only gets the automatic review.
`/wachi review` and replies in review threads start working from the next pull request,
because GitHub runs `issue_comment` workflows from the default branch.

## Optional: a focus file

Add `.github/agent-review.md` to say what this repository's reviews should look at beyond the
defaults (for example "payments code must never log card data"). It is read from the pull
request's **base commit**, together with `CLAUDE.md` and `AGENTS.md`, so a pull request cannot
change the rules it is reviewed under. A pull request that edits one of them is reviewed under
the old version, and the review says the change takes effect after merge. It cannot add severities or
topics to the finding labels (see [cli.md](cli.md#finding-labels)).

## Optional: settings

The reusable workflow takes these `with:` inputs. Only `operator` is required.

| Input | Default | Meaning |
| --- | --- | --- |
| `operator` | none | Login allowed to start on-demand runs |
| `mention` | `/wachi` | Command that starts a run (`@agent-review` and `@claude` are also accepted) |
| `budget_usd` | `3` | Most one pull request review may spend |
| `batch_budget_usd` | `0.75` | Most one batch may spend |
| `answer_budget_usd` | `1` | Most one on-demand question may spend |
| `batch_lines` | `1000` | Changed lines per batch |
| `batch_chars` | `140000` | Diff characters per batch |
| `model` | `claude-sonnet-5-5` | Model the agent uses |
| `effort` | `high` | Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max`; printed in every review footer |
| `provider` | `claude-code` | Agent provider |
| `claude_code_version` | `2.1.304` | Pinned Claude Code version |
| `claude_code_sha256` | empty | Optional SHA-256 of the Claude Code binary for the runner platform; empty reads it from the publisher manifest (see [providers/claude-code.md](providers/claude-code.md)) |
| `bun_version` | `1.3.4` | Pinned Bun version |
| `skip_branch_prefixes` | `release-please--` | Comma-separated head branch prefixes that are not reviewed |
| `review_on_push` | `true` | Review each push to an open pull request, only the new commits. Needs `synchronize` in the caller's `pull_request` types (the template has it). Each push can spend up to `budget_usd`; set `false` to review only on open, ready for review and `/wachi review`. See [reviews.md](reviews.md#reviews-on-push) |

Input defaults are kept in sync by hand with the defaults in `src/config.ts`. CI pins Bun
separately from the `bun_version` input. `AGENT_REVIEW_EXCLUDE` and `AGENT_REVIEW_DRY_RUN` have no
input here; they exist only in the copy-the-files install.

## Checks before enabling

- The secret `ANTHROPIC_API_KEY` exists in the repository (or the organisation, shared with it).
- The operator login is yours, spelled exactly as on GitHub.
- The repository is not expecting fork reviews: fork pull requests are skipped on purpose.
- Everyone who can push to the repository is someone you trust with the key. Read
  [SECURITY.md](../SECURITY.md).

## How updates arrive

- **Every release is a pull request to your repository.** Add Dependabot for GitHub Actions and
  it opens one pull request per new release, changing only the tag in the `uses:` line, with the
  release notes linked. You read it and merge it, or close it. Nothing runs with your key before
  that. The reusable workflow skips Dependabot's own pull requests, so they cost no review budget.

  ```yaml
  # .github/dependabot.yml
  version: 2
  updates:
    - package-ecosystem: github-actions
      directory: /
      schedule:
        interval: weekly
  ```

- **A bad release is undone by you, not by the maintainer.** If a release turns out to be broken
  or compromised, edit the tag in your caller back to the previous release and merge. An exact
  tag never moves, so the previous release is still exactly what it was. The maintainer publishes
  a fixed release, and Dependabot brings it as the next pull request.
- **A policy change or a new major version** also arrives as a pull request to your repository (a
  new `@v2.0.0` in the caller, or a policy update you review). Each run records the exact engine
  commit in its job summary.
- **The floating `v1` tag** moves on every compatible release. It is kept for callers that
  installed it, and it is not recommended: whoever can move that tag runs code with your key, and a
  release reaches your repository before you have seen it. A full commit SHA is also accepted by
  GitHub but is not needed: an exact tag is protected by this repository's ruleset, which forbids
  moving or deleting `v*` tags, and a tag stays readable in your file where a SHA does not.

## Private repositories

- Calling a workflow across owners requires this repository to be public, and it is. If it were
  private, only repositories that are allowed to use it could call it.
- Same organisation, private use: set this repository's Settings, Actions, General, Access to
  "Accessible from repositories in the organisation".
- The workflow checks the engine out with the job's own token. A token for your repository
  cannot read another private repository, so a private engine repository is not expected to work
  without extra setup.
- Verified live: a private repository owned by a different user than this repository's
  organisation called `@v1`, and the engine checkout resolved the tag across owners with the
  job's own token.
