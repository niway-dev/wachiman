# Install Wachiman: the procedure for a coding agent

You are a coding agent, and a person asked you to install Wachiman in their repository. Before you
follow this file:

1. Resolve the release tag first (step 2 below: two read-only commands, nothing is installed). Then
   read [on-your-machine.md](on-your-machine.md) at that tag and check it against the code at that
   tag. It lists everything Wachiman installs, runs, reads, writes and sends over the network.
2. Give the person your verdict first: what you checked, what you found, and anything you could not
   verify. Keep it short.
3. Follow the rest of this file **only after the person said yes** to that verdict.

If the code does something that page does not list, stop and tell the person. Do not install.

This file is the short, gated procedure. The full command reference for agents is
[agents.md](agents.md); the human walkthrough is [install.md](install.md).

Every **Ask** below is a stop. Say what you are about to do, wait for the answer, and do not infer a
yes from an earlier one.

## Rules that never change

- [ ] **Never ask for, read, print or store a key or token.** Not `ANTHROPIC_API_KEY`, not
      `CLAUDE_CODE_OAUTH_TOKEN`, not a sign-in file. You never see the value.
- [ ] Do not unset, export or edit the person's environment variables.
- [ ] Use only flags you saw in `wachiman <command> --help` for the installed version.
- [ ] Do not start a paid review unless the person asks for one.
- [ ] Never merge a pull request and never enable auto-merge.
- [ ] Stage files by name, never `git add -A`.

## 1. Choose the mode

**Ask** once, in one message: "Do you want Wachiman to review on your machine with your Claude
subscription (local), as a GitHub Actions workflow billed to an API key or a subscription token
(Actions), or both?"

| Mode | What it adds | What it costs |
| --- | --- | --- |
| Local | A binding from this repository to a Claude account in `~/.wachiman`. No file in the repository, no GitHub request | Uses the person's Claude plan |
| Actions | One caller workflow file in the repository (`init` is run with `--no-agent-pointer` and `--no-pr-template`, so it writes nothing else) and one repository secret the person adds | Billed to the key or token owner |
| Both | Both of the above | Both |

Do not ask again unless the person changes their mind.

## 2. Resolve the release

Use the latest **stable** release. Never a prerelease, a branch or a floating tag such as `v1`.

```sh
gh release list --repo niway-dev/wachiman --exclude-pre-releases --exclude-drafts --limit 1 --json tagName --jq '.[0].tagName'
npm view wachiman version
```

The tag is `v<version>`, and the npm version is the same number without the `v`. If the two do not
match, report both and **Ask** which to use. Call the result `<tag>` and `<version>` below.

## 3. Look at what exists first

These commands change nothing:

```sh
git status --short
git remote            # names only; a remote URL can carry a token, so do not print it
grep -rn "niway-dev/wachiman" .github/workflows 2>/dev/null
ls .wachiman.yml .github/wachiman.md 2>/dev/null
wachiman --version 2>/dev/null
```

- [ ] A workflow in `.github/workflows` that already calls `niway-dev/wachiman` is the caller.
      Update it. **Never create a second caller.**
- [ ] A copied install of the engine in the repository (see [setup-copy.md](setup-copy.md)): report
      it and **Ask** whether to move to the maintained workflow. Do not delete anything on your own.
- [ ] An existing `.wachiman.yml`: keep it. `init` does not overwrite it without `--force`.
- [ ] A dirty working tree: say so, and work on a new branch so nothing of the person's is mixed in.

## 4. Install the CLI

Show the command, then **Ask** before running it. It changes the person's global packages.

```sh
npm i -g wachiman@<version>
```

On a machine that uses Bun, `bun add -g wachiman@<version>` is the equivalent. Then run
`wachiman --version` and check it prints `<version>`. If the person already has that version,
skip this step.

Tell the person that npm also installs the `bun` package, whose install script downloads the Bun
runtime from the npm registry; it is listed in
[on-your-machine.md](on-your-machine.md#what-installing-adds).

## 5a. Local path

Skip this section if the mode is Actions only.

- [ ] `claude` is installed and signed in: `claude auth status`. If it is not signed in, tell the
      person to run `claude auth login` themselves.
- [ ] `ANTHROPIC_API_KEY` is **unset** in the shell. Check with `test -z "${ANTHROPIC_API_KEY:-}"`
      and look at the exit code only; never print the variable. If it is set, local runs refuse to
      start. Tell the person, and do not unset it for them.
- [ ] `wachiman profile list --json` shows the accounts on this machine. **Ask** which account this
      repository should use, or whether to use their current session (`--profile default`).
- [ ] **Ask** before writing the binding. Then run, with the person's choice:

```sh
wachiman setup --profile <name> --yes --json
wachiman doctor --json
```

Do not run `wachiman init` for local mode. `setup` writes the binding in `~/.wachiman/config.json`
and nothing in the repository, while `init` would also offer to write `.wachiman.yml`, a pointer
block in `AGENTS.md` or `CLAUDE.md`, and the PR template. If the person wants those, they are a
separate **Ask**.

`doctor` makes no model call. Report each required check. Do not run `wachiman local` unless the
person asks for a first review; it is a real review that uses their Claude plan.

## 5b. Actions path

Skip this section if the mode is local only.

- [ ] `gh auth status` shows the GitHub account that owns the repository. If it does not, stop and
      tell the person.
- [ ] The operator is the person's GitHub login, spelled exactly as on GitHub. Detect it with
      `gh api user --jq .login`, then **Ask** to confirm it.
- [ ] Preview, writing nothing:

```sh
wachiman init --mode github --operator <login> --version <tag> --no-agent-pointer --no-pr-template --dry-run --json
```

- [ ] Show the plan: each file and its action. It should list the workflow file only; if it lists
      anything else, say so. **Ask** before the real run.
- [ ] Create the branch, then run the same command without `--dry-run`:

```sh
git switch -c wachiman-setup
wachiman init --mode github --operator <login> --version <tag> --no-agent-pointer --no-pr-template --json
```

- [ ] Check that **exactly one** workflow file calls `niway-dev/wachiman`, and that its `uses:` line
      ends in `@<tag>`: a release tag, not a branch and not `v1`.

## 6. The credential, which is the person's to add

You do not create the secret. Give the person this command to run in their own terminal, and say
that `gh` will prompt for the value there:

```sh
gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo>
```

For a Claude subscription token instead, the name is `CLAUDE_CODE_OAUTH_TOKEN` (see
[install.md](install.md#review-on-a-claude-subscription)), and the caller passes that name.

After they say it is done, check the **name** only:

```sh
gh secret list --repo <owner>/<repo>
```

Report whether the name is listed. Never read, print or ask for the value.

## 7. Show the diff and wait

```sh
git status --short
git diff
```

**Ask** this exact question, filled in:

> I changed these files: `<list>`. Do you want me to commit them on branch `<branch>`, push to
> `<remote>`, and open a pull request against `<base>`? You can say yes to all, or only to some.

Do each step only if the person said yes to it. Do not merge, and do not enable auto-merge.

## 8. Final report

Say what is ready and what is still pending, per mode. Do not say "all set" while anything is
pending.

- **Local:** ready when the account is bound and `wachiman doctor` passed. Say which required checks
  passed or failed.
- **Actions:** ready only after the secret exists and the workflow is merged on the default branch.
  Say whether the secret name is listed, which branch holds the change, and the pull request link if
  one was opened.
- **Paid review:** say whether any review ran. If none did, say so plainly: "No review was run, so
  nothing was spent."
- **Not verified:** anything you could not check, including what [on-your-machine.md](on-your-machine.md#what-is-not-verified)
  lists as unverified.
