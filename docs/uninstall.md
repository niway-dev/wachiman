# Disable and uninstall

Wachiman lives in your repository and your accounts. It is a caller workflow file, one repository
secret and whatever optional files you added. There is no service, account or subscription run by
this project to cancel, and there is no uninstall command, so removing it is ordinary repository
work that you do yourself.

## Stop spending now

Pick the least disruptive of these.

1. **Disable the workflow.** In the repository, open Actions, choose "Wachiman review" in the left
   list, and use the menu to disable it. From a terminal:

   ```sh
   gh workflow disable "Wachiman review" -R <owner>/<repo>
   ```

   Nothing in your files changes, and you re-enable it the same way. A disabled workflow starts no
   new runs for pull requests or comments.
2. **Cancel runs in progress.** Disabling does not stop a run that has started. Cancel it in the
   Actions tab, or run `gh run cancel <run-id> -R <owner>/<repo>`. Model calls that already finished
   are paid. A review is posted only after its last batch, so a run cancelled before that posts
   nothing.
3. **Remove the secret as a brake.** If you cannot disable the workflow quickly, deleting
   `ANTHROPIC_API_KEY` makes every run stop at `wachiman: ANTHROPIC_API_KEY is not set` before
   any paid call. The runs show red, which is noisy. Disabling is cleaner.

## Remove it

1. **Delete the caller file**, `.github/workflows/wachiman-review.yml` if you used the template's name (`agent-review.yml` before the naming release),
   through your normal change process. Comment-triggered runs use the file on your default branch,
   so `/wachiman` stops when the deletion merges.
2. **Check that nothing waits for the check.** If you made "Wachiman review" a required status check
   in branch protection or a ruleset, remove that requirement first. Otherwise a pull request
   waits for a check that never reports. The review is advisory by design and is not a required
   check unless you made it one.
3. **Delete the secret**, in Settings, Secrets and variables, Actions, or:

   ```sh
   gh secret delete ANTHROPIC_API_KEY -R <owner>/<repo>
   ```

   If other workflows use the same secret, keep it. If it is an organisation secret shared with
   many repositories, remove this repository from its access list instead of deleting it.
4. **Revoke the key at the provider if it was only for this.** Deleting the GitHub secret removes
   your repository's copy. It does not make the key invalid: the key keeps working at Anthropic
   until you delete it in the [Anthropic Console](https://console.anthropic.com), where you
   created it. Do this when the key was dedicated to Wachiman, and always if you suspect it leaked.
   Do not delete a key that other tools still use.
5. **Remove optional files you no longer need.** Only if nothing else in the repository uses them:
   - `.github/wachiman.md` (or the older `.github/agent-review.md` or `.github/claude-review.md`): the review focus file.
     Nothing else reads it. Leave `CLAUDE.md` and `AGENTS.md`: they are yours, and other tools read
     them.
   - `.github/dependabot.yml`: keep it if it also updates other actions, which is its normal use.
     The `github-actions` entry covers every workflow file, so it is rarely safe to delete.
   - A copied install ([setup-copy.md](setup-copy.md)): the `scripts/agent-review/` folder
     (including its `bunfig.toml` and `providers/`), the copied workflow
     `.github/workflows/wachiman-review.yml`, and the decision record you wrote for it.
6. **Confirm it is gone.** In Actions, check that no "Wachiman review" workflow is listed and that new
   pull requests and comments start no run of it. A `gh workflow list -R <owner>/<repo>` that does
   not show it is enough.

## Remove the local command

`wachiman local` and the other local commands are separate from the workflow above.

- **Installed from npm:** `npm uninstall -g wachiman`. `npx wachiman` leaves a copy in npm's
  cache; `npm cache ls wachiman` lists it and `npm cache clean --force` clears the whole cache.
- **Installed from a clone:** `scripts/install-local.sh --uninstall` from the clone removes the
  symlinks that script made (the command and the skills) and nothing else.
- **Wachiman's own data** is in `~/.wachiman` (or `$WACHIMAN_HOME`): `config.json` (profiles and
  project bindings), the review history if you turned it on, and one `claude-<name>` directory per
  account profile Wachiman created. A profile directory holds that account's `claude` sign-in, so
  deleting it signs that account out on this machine; a profile that points at your own
  `CLAUDE_CONFIG_DIR` is never touched, and neither is a directory you registered. Delete
  `~/.wachiman` only when you want all of this gone.

## What stays behind

- **Comments on past pull requests.** Reviews, inline comments, thread replies and answers stay
  where they were posted, written by `github-actions[bot]`. The engine's only GitHub writes are three kinds of POST (a
  review, a reply in a review thread, a pull request comment). It never edits or deletes what it
  posted, and it has no cleanup command. They carry hidden HTML
  comments that markdown does not display: `<!-- wachi:review -->`, `<!-- wachi:finding -->`,
  `<!-- wachi:reply -->`, `<!-- wachi:attempt id=… -->` and `<!-- agent-review sha=… -->`. They do
  nothing once the tool is gone. If you want the comments removed, do it by hand with GitHub's own
  controls, and check GitHub's current documentation for what can be hidden or deleted.
- **Actions history.** Past runs, their job summaries and their logs stay until GitHub's retention
  settings remove them. The logs contain the per-call JSON lines with model cost.
- **A record at the provider.** Anthropic keeps its own usage and billing records for the key's
  calls, under its policies, not this project's.

## What the tool never created

Checked against the code of v1.3.0, the engine's GitHub calls are reads, plus those three kinds of
POST. So there is nothing else to delete:

- **No branches, draft pull requests, issues, labels or releases.** [ADR 0007](adr/0007-learned-memory-by-draft-pr.md)
  proposes a `wachi/learn` branch and a draft pull request for learned memory. Its status line
  reads "Not implemented", and `src/` contains no code that pushes a branch or opens a pull
  request. If you see such a branch, it did not come from this release.
- **No GitHub App, webhook or repository setting.** Comments come from the workflow's own token as
  `github-actions[bot]`, so no app was installed.
- **No account with this project.** The engine contacts GitHub (through `gh`), the model provider
  (through its CLI) and, to install Claude Code, the publisher's download site. Nothing in `src/`
  calls an endpoint run by this project. The only thing you fetch from the project is the workflow
  and engine code from its public repository on GitHub, at the ref you pinned. That stops when the
  caller file is gone.

Your code and pull request text were sent to the model provider while reviews ran, and the provider's
retention is governed by its own terms. Removing Wachiman does not undo that. See
[SECURITY.md](../SECURITY.md) and the [FAQ](faq.md).
