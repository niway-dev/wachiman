# Wachiman

<img src="docs/assets/wachi.png" alt="Wachiman, a cartoon watchman with a cap and a whistle" width="96" align="right">

Advisory pull request reviews by an agent CLI, run inside your own GitHub Actions with your own
API key. Wachiman (pronounced *watchman*) is named after the Peruvian *wachimán*, the street
watchman who warns you and lets you decide; the Spanish word comes from the English one. Comment
`/wachi review` (or `/wachiman review`) on a pull request to ask for a review of what changed.
Every comment it posts opens with "👮 **Wachiman**", so you can tell it apart from other bots.

Each finding arrives as an inline review comment on its line, labelled with a severity (when to
act: Blocker, Fix, Consider) and a topic (what it is about: bug, docs, security…), for example
`🟠📝 Fix · docs`, and you can answer it in its thread. Information that asks for no reply, such as
a notice that the pull request edits a decision record, goes in the review body instead. The review never approves, requests changes or blocks a
merge. For a large pull request the files are grouped into batches ordered by a risk score
computed from their paths, riskiest first, and each batch is one agent call with a spend cap, so
money bounds the run rather than pull request size. If some files are not reviewed, the first
line of the review says so.

The default agent is [Claude Code](https://claude.com/claude-code) (`claude -p`); the Codex CLI
(`codex exec`, for OpenAI models such as GPT Sol) is a second adapter behind the same small
provider interface, available from the CLI while its workflow integration is pending
([docs/providers/codex.md](docs/providers/codex.md)). The key stays in
your repository's secrets, and nothing is sent to a service run by this project.

## Status

**Release candidate: `v1.0.0-rc.2` is tagged and passed a live run in a consumer, across owners. Release-please is set up and will cut `v1.0.0` from Conventional Commits when its release pull request is merged** (see
[docs/releasing.md](docs/releasing.md)). The command-line contract is done: one
CLI (`src/cli.ts`, with a `bin` entry) and a provider adapter boundary, documented in
[docs/cli.md](docs/cli.md) and [docs/providers/claude-code.md](docs/providers/claude-code.md).
Until `v1.0.0` is cut, the CLI contract may still change; the old `CLAUDE_REVIEW_*` variables,
the `<!-- claude-review sha=… -->` marker, `.github/claude-review.md` and the `@claude` mention
keep working, with a notice, so older installed copies can migrate gradually.

## Install

There are three ways. The first two work today; the third is deferred.

1. **Reusable workflow (recommended).** A short caller workflow in your repository
   calls a reusable workflow here. You choose the triggers, the secret and the permission
   ceiling; fixes arrive through a version tag.
2. **Copy the files.** Copy the `src/` folder and the workflow template into
   your repository and run `bun scripts/agent-review/cli.ts`. See
   [docs/setup-copy.md](docs/setup-copy.md).
3. **npm (later).** `package.json` already has a `bin` entry, so publishing is a step and not a
   restructure, but it is deferred until the contract is stable.

## Usage

```sh
bun --no-env-file --config=bunfig.toml src/cli.ts review <pr> [paths…] --repo-dir <head>
bun --no-env-file --config=bunfig.toml src/cli.ts comment <pr> --repo-dir <head>   # the comment is in $REQUEST
```

Settings, environment and exit codes: [docs/cli.md](docs/cli.md). The agent behind it, and what
its hardening covers: [docs/providers/claude-code.md](docs/providers/claude-code.md).

## Install with the reusable workflow

**Pin an exact release tag** such as `v1.0.0`: exact tags never move, and a Dependabot pull
request brings each new release to your repository for you to read before it runs. The floating
`v1` tag exists but is not recommended: it would run every new release with your key before you
have seen it. See [docs/install.md](docs/install.md).

Add this file as `.github/workflows/agent-review.yml`, save `ANTHROPIC_API_KEY` as a repository
secret and set your login as `operator`:

```yaml
name: Agent review
# Get the key at https://console.anthropic.com and save it as the repository secret ANTHROPIC_API_KEY.
# Pin an exact release tag (`@v1.0.0`): it never moves, every update arrives as a Dependabot pull
# request you read first, and a bad release is undone by editing the tag back. Do not use the floating
# `@v1`: it would run each new release with your key before you have seen it.
# First install: the installing pull request gets only the automatic review. `/wachi review`
# and thread replies work from the next pull request, because `issue_comment` runs from the default branch.
on:
  pull_request: { types: [opened, ready_for_review, synchronize] }
  issue_comment: { types: [created] }
permissions: { contents: read, pull-requests: write, issues: read }
jobs:
  review:
    uses: niway-dev/wachiman/.github/workflows/review.yml@v1.0.0
    with:
      operator: EDIT-THIS-github-login
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Full steps, settings and updates: [docs/install.md](docs/install.md). Maintainers:
[docs/releasing.md](docs/releasing.md).

## Security model

The agent can only read: Claude Code runs with `--restricted`, `--strict-mcp-config` and
`--tools Read,Glob,Grep`, so it has no shell and no MCP servers, ignores the reviewed branch's own
`.claude/` settings and hooks, and receives no GitHub token. The script, not the agent, holds the
tokens, posts the review, and throws, posting nothing at all, if any text it would post contains your API key.

This is not a sandbox. You must trust everyone who can push to a repository that runs it, because
the workflow holds your key and a pull request can edit workflow files. Fork pull requests are
skipped. Do not use it to review code from people you do not trust. Details and what is still
unverified: [SECURITY.md](SECURITY.md).

## Design

[ADR 0001: distribution and trust](docs/adr/0001-distribution-and-trust.md); [ADR 0002: TypeScript on Bun, no runtime dependencies](docs/adr/0002-typescript-on-bun-zero-dependencies.md).
How the pieces fit together: [docs/architecture.md](docs/architecture.md).

## License

GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

## Commit messages

Releases and the changelog are generated from commit messages, so pull request titles (squash
merges use them) follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:` is a minor release, `fix:` and `perf:` a patch, `feat!:` or a `BREAKING CHANGE:` footer a
major one. `docs:`, `test:`, `ci:`, `build:`, `chore:` and `style:` appear in no release notes.
Release pull requests are titled `chore: release X.Y.Z`.
