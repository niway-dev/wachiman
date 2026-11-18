# Wachiman for coding agents

You are a coding agent. A person asked you to install, configure, diagnose, upgrade or uninstall Wachiman in a repository. This page tells you how to do that from chat, with explicit commands and no terminal prompt the person cannot see.

## Rules

- **Ask in chat for every choice you cannot detect.** Do not guess an operator, a mode or an account.
- **Make every command non-interactive.** Give every answer as a flag. Use `--json` where the command has it. Use `--yes` only to skip Wachiman's own confirmations.
- **Never ask for or paste credentials in chat.** The person signs in to Claude in the official flow (`claude auth login`, or the sign-in a profile command opens). The person adds the `ANTHROPIC_API_KEY` repository secret in GitHub. You never see either value.
- **`--yes` or "install it" is not permission to commit, push or open a pull request.** Show the changes and ask before each of the three. Never merge, and never enable auto-merge.
- **Use only flags you saw in `wachiman <command> --help` for the installed version.** An unknown flag is a usage error (exit 2). Do not guess a replacement; read the help again.

## Discovery

Run these first. They change nothing.

```sh
wachiman --version
wachiman init --help
wachiman project show --json     # is this repository bound to an account?
wachiman profile list --json     # which accounts exist on this machine?
wachiman doctor --json           # what a local run would use, and what would fail
```

If `wachiman` is not found, ask the person before installing it globally. It needs Node.js 20 or newer, or Bun 1.3 or newer, plus a Claude Code installation (`claude`) for local reviews:

```sh
npm i -g wachiman      # or: bun add -g wachiman
```

Then run `wachiman --version` again. For the prerequisites of the GitHub side (secret, permissions, trust), read [install.md](install.md#before-you-start) and tell the person what applies.

## From each question to a flag

Detect the answer first (the repository, `git remote`, `gh api user --jq .login`, the discovery output). Ask only for what you could not detect. Every row is a question the interactive wizards (`init`, then `setup`) ask.

| Question | Detect first | Flag or command | Default | Effect |
| --- | --- | --- | --- | --- |
| Kind of repository | Workspaces file, several packages | `--project-kind monorepo\|single` | None without a terminal: the file is left alone | Writes `kind:` in `.wachiman.yml`. Metadata only: it never picks an account. "Distributed" has no flag and is not available |
| Where reviews run | Ask | `--mode github\|local\|both` | Required without a terminal | `local` writes no workflow and uses the person's Claude subscription. `github` writes the Actions workflow; runs are billed to an Anthropic API key held in the repository secret. `both` does both |
| Operator (GitHub login) | `gh api user --jq .login`, then confirm | `--operator <login>` | Required for `github` and `both` | Written into the workflow. Only this person's `/wachiman` comments start a paid run |
| Release to pin | Nothing | `--version <vX.Y.Z or 40-character SHA>` | The release bundled in this CLI | Written after `review.yml@` in the workflow. Do not ask unless the person wants another |
| Workflow path | Nothing | `--path <file>` | `.github/workflows/wachiman-review.yml` | A `.yml` or `.yaml` file directly in `.github/workflows/`. Do not ask unless needed |
| PR description template | Does `.github/pull_request_template.md` exist? | `--pr-template` or `--no-pr-template` | None without a terminal | Installs the template (files only). An existing template is adopted and replaced, with a backup. A dry run installs nothing |
| Replace an existing workflow or `kind:` | Does the file exist? | `--force` | Off: a differing file is exit 2 | Replaces after the person agreed. The workflow is first copied to `<file>.bak-<timestamp>` |
| Which Claude account (local, both) | `project show --json`, `profile list --json` | `wachiman setup --profile <name> --yes --json` | Required without a terminal; the profile must already exist | Binds this repository to that account in the Wachiman home (`~/.wachiman/config.json`), never in the repository |
| Use my current Claude session | Person says so | `--profile default` | None | Binds to the person's own `claude` |
| Register a Claude directory the person already uses | `profile list --json` shows `claude-*` directories | `wachiman profile add <name> --config-dir <abs> [--binary <abs>]`, then `setup --profile <name>` | None | Registers that directory in place; Wachiman never writes into it |
| Create a new isolated account | Person asks for it | `wachiman profile create <name>` | `isolated` | Creates `~/.wachiman/claude-<name>` and starts `claude` there. **The person signs in at that screen**, so run it only when they are ready |
| Set up this repository? (standalone `setup`) | Person asked for install | Running `setup --yes` | None | Answered by the command itself |

Choices with no flag:

- **Distributed repository:** not available. Offer `monorepo` or `single`.
- **Signing in to a new account:** the person does it. You cannot pass it as a flag, and you must not read the outcome from the person's credentials.
- **The `ANTHROPIC_API_KEY` secret:** the person adds it in GitHub (Settings, Secrets and variables, Actions). Wachiman never creates it.
- **`model` and `effort` in `.wachiman.yml`:** `init` does not ask. Edit the file only if the person asks, see [configuration.md](configuration.md#the-settings-file-wachimanyml).

## Install recipe

1. **Preview.** Nothing is written, in any mode:

   ```sh
   wachiman init --mode <github|local|both> [--operator <login>] --project-kind <monorepo|single> --pr-template --dry-run --json
   ```

2. **Show the plan** to the person: each file and its action, and for `both` or `local` the account you will bind. Get a yes.
3. **Run it** without `--dry-run`, keeping `--json` and the same flags. Add `--force` only if a file differs and the person agreed to replace it.
4. **Bind the account** for `local` and `both`. `init` never does this without a terminal, so it lists the command as pending:

   ```sh
   wachiman setup --profile <name> --yes --json
   ```

5. **Check:** `wachiman doctor --json`.

Read the `wachiman.init/1` document it prints (the shape below is illustrative, not observed output):

```json
{
  "schema": "wachiman.init/1", "ok": true, "mode": "both", "dryRun": false,
  "files": [ { "path": ".github/workflows/wachiman-review.yml", "action": "created" } ],
  "local":  { "status": "pending", "pending": ["wachiman setup --profile <name> --yes ..."] },
  "github": { "status": "pending", "pending": ["Add the repository secret ANTHROPIC_API_KEY", "..."] }
}
```

- `files[].action` is `created`, `replaced`, `unchanged`, `would-create`, `would-replace`, `skipped` or `refused`; a backup path is listed when one was made. Report `skipped` and `refused` files to the person; do not retry them with `--force` on your own.
- `local` and `github` each carry a status and a list of pending actions (`not-used` when the mode excludes it). Report them **separately**: local is ready when the account is bound and `doctor` passes; GitHub is ready only after the secret exists and the workflow is merged on the default branch.
- On a usage error, `ok` is `false`, `error` says which flag is missing, and the exit code is 2. Ask the person, then run again.
- Running the same command twice is safe: the second run reports `unchanged`.

Never say "all set" while anything is pending. Do not start a paid review to prove it works; `doctor` makes no model call. If the person wants a first review, tell them how ([install.md](install.md#how-to-tell-it-worked)) and let them ask.

## Before you commit, push or open a pull request

`init` wrote files and nothing else. Run `git status`, show the person the diff, then ask this exact question, filled in:

> I changed these files: `<list>`. Do you want me to commit them on branch `<branch>`, push to `<remote>`, and open a pull request against `<base>`? You can say yes to all, or only to some of these.

Do each step only if the person said yes to it. Stage only the installation's files (the paths in `files[]`, plus any template written), by name, never `git add -A`. Do not merge, and do not enable auto-merge.

## Configure

```sh
wachiman project show --json
wachiman profile list --json
wachiman setup --profile <name> --yes --json   # change this repository's account
wachiman project unbind --yes                  # remove the binding
```

Changing the pinned release, the operator, or the review focus means editing the caller workflow or `.github/wachiman.md`; show the diff first. Settings are in [configuration.md](configuration.md); `.wachiman.yml` holds `kind`, `model` and `effort` only.

## Diagnose and repair

```sh
wachiman doctor --json                 # add --all-profiles to check every account
wachiman doctor --redact-paths         # safe to paste in chat
```

`doctor` exits 1 when a required check fails. Fix the cause it names, then run it again. If `ANTHROPIC_API_KEY` is set in the shell, local runs refuse to start: tell the person, and do not unset their variable for them. For a run that failed in GitHub, follow [troubleshooting.md](troubleshooting.md) and read the failed job log; do not ask for secrets.

## Upgrade

```sh
wachiman upgrade --check               # installed and latest; changes nothing
wachiman upgrade                       # updates the CLI, then moves the pin in this repository
wachiman upgrade --repo-only           # moves the pin only
```

`upgrade` rewrites files and prints the git commands; it never commits. Show the diff and use the question above. Read the release notes first and tell the person what changed: [upgrading.md](upgrading.md).

## Uninstall

There is no uninstall command. Stop spending first (disable the workflow), then remove files and secrets by hand, following [uninstall.md](uninstall.md). Removing the workflow file, deleting a repository secret, or revoking a key are the person's decisions: ask before each. To drop only the local binding, use `wachiman project unbind --yes`; to remove an account, `wachiman profile remove <name> --yes`. A profile directory holds a sign-in, so never pass `--delete-dir` unless the person asks.

## Reference

- [cli.md](cli.md): every command and flag
- [install.md](install.md): requirements, the GitHub secret, how to tell it worked
- [configuration.md](configuration.md): settings and `.wachiman.yml`
- [troubleshooting.md](troubleshooting.md)
- [upgrading.md](upgrading.md)
- [uninstall.md](uninstall.md)
