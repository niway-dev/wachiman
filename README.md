# Wachiman

<img src="docs/assets/wachi.png" alt="Wachiman, a cartoon watchman with a cap and a whistle" width="96" align="right">

Advisory pull request reviews by an agent CLI, run inside your own GitHub Actions with your own
API key. Wachiman (pronounced *watchman*) is named after the Peruvian *wachimán*, the street
watchman who warns you and lets you decide; the Spanish word comes from the English one.

## What it is

A GitHub Actions workflow that reads a pull request and posts one GitHub review on it. Each
finding is an inline comment on its line, labelled with a severity (when to act: Blocker, Fix,
Consider) and a topic (what it is about: bug, docs, security…), for example `🟠📝 Fix · docs`.
Information that asks for no reply, such as a notice that the pull request edits a decision
record, goes in the review body. Every comment opens with "👮 **Wachiman**".

- **It runs in your repository.** The workflow runs on your runners and spends your own provider
  key. This project operates no service that receives your code or your key.
- **It is advisory.** The review is posted as a plain comment review. It never approves,
  requests changes or blocks a merge, and "Blocker" is a label on a comment, not a status
  GitHub enforces.
- **It starts on a pull request and on request.** It reviews when a pull request opens or leaves
  draft. After that, the operator you name comments `/wachi review` to ask for another review of
  what changed, or any other `/wachi …` text to ask a question. A push alone does not start a
  review. Details: [docs/reviews.md](docs/reviews.md).
- **Large pull requests are reviewed in batches**, riskiest files first (the risk is a score
  computed from file paths, not a reading of the code). Each batch is one agent call with a
  spend limit. What that limit does and does not guarantee, and what "all files reviewed"
  establishes, is in [docs/costs.md](docs/costs.md).

## What it will not do

- It does not approve, request changes, gate a merge or replace a human review.
- It does not run your code or tests. In the Claude Code workflow the agent is started with
  read-only tools and no shell; that is a tested configuration, not a sandbox
  ([SECURITY.md](SECURITY.md)).
- It does not check every changed file in every case: lockfiles, build output and generated files
  are dropped first, and coverage is what the model reports per file. If some files are not
  reviewed, the first line of the review says so.
- It is not a sandbox, and it is not a tool for reviewing code from people you do not trust (see
  below).

## The trust decision, in brief

Installing it gives a workflow your model API key and read access to your pull requests. Before
you do:

- **Everyone who can push a branch to the repository must be someone you trust with the key.** On
  a pull request GitHub runs the workflow file from the pull request's own branch, so a person
  who can push can change the workflow and read the key. Nothing in this tool defends against
  that. Fork pull requests are skipped.
- **Your code goes to the model provider.** The review sends the pull request's diff, and the
  files the agent chooses to read, to the provider you configured (Anthropic, for Claude Code)
  from your runner.
- **The version you pin decides what runs with your key.** See
  [docs/install.md](docs/install.md#what-pinning-a-version-does-and-does-not-guarantee).

This is not a sandbox. What is enforced, what the tests show and what is still unverified:
[SECURITY.md](SECURITY.md).

## Status and providers

The current release is **v1.3.0** ([CHANGELOG.md](CHANGELOG.md)). The command-line contract
([docs/cli.md](docs/cli.md)) and the provider adapter boundary are in place. The older
`CLAUDE_REVIEW_*` variables, `.github/claude-review.md` and the `@claude` mention are still read
with a notice; see [docs/upgrading.md](docs/upgrading.md).

- **Claude Code** (`claude -p`) is the provider the reusable workflow installs and runs, with
  `ANTHROPIC_API_KEY` ([docs/providers/claude-code.md](docs/providers/claude-code.md)).
- **Codex CLI** (`codex exec`, for OpenAI models) is a second adapter, available only from the
  command line. The reusable workflow does not install it or pass an OpenAI key
  ([docs/providers/codex.md](docs/providers/codex.md)).
- **npm:** nothing is published. `package.json` has a `bin` entry, but the supported ways to run
  Wachiman are the reusable workflow and, for existing users, a copy of the files.

## Install

The recommended way is the reusable workflow: a short caller file in your repository pins a
release, passes your key and names the operator.

**Start here: [docs/install.md](docs/install.md)**, the first advisory review from an empty
repository to a posted review. The caller file itself is
[`templates/agent-review-caller.yml`](templates/agent-review-caller.yml).

Already copied the engine into a repository? That setup still runs, and
[docs/setup-copy.md](docs/setup-copy.md) explains how to move to the maintained workflow.

## Documentation map

| I want to… | Read |
| --- | --- |
| Get a first review on a repository | [docs/install.md](docs/install.md) |
| Know what I am trusting, and what is unverified | [SECURITY.md](SECURITY.md) |
| Look up an input, a default or an environment setting | [docs/configuration.md](docs/configuration.md) |
| Find out why there was no review, or an error | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Ask for reviews, scope them, read the results | [docs/reviews.md](docs/reviews.md) |
| Understand what a run can cost and what coverage means | [docs/costs.md](docs/costs.md) |
| Tell the reviewer what matters in my repository | [docs/review-policy.md](docs/review-policy.md) |
| Adopt a new release, or roll one back | [docs/upgrading.md](docs/upgrading.md) |
| Turn it off and remove it | [docs/uninstall.md](docs/uninstall.md) |
| Quick answers and limitations | [docs/faq.md](docs/faq.md) |
| Run the engine from the command line | [docs/cli.md](docs/cli.md) |
| See what a provider adapter runs and inherits | [docs/providers/claude-code.md](docs/providers/claude-code.md), [docs/providers/codex.md](docs/providers/codex.md) |
| Move from a copied installation | [docs/setup-copy.md](docs/setup-copy.md) |
| Understand how a review is built | [docs/architecture.md](docs/architecture.md) |
| Measure false positives | [docs/precision.md](docs/precision.md) |
| See what changed in a release | [CHANGELOG.md](CHANGELOG.md) |
| Cut a release (maintainers) | [docs/releasing.md](docs/releasing.md) |

Design decisions are recorded as ADRs in [docs/adr/](docs/adr/), starting with
[ADR 0001: distribution and trust](docs/adr/0001-distribution-and-trust.md) and
[ADR 0002: TypeScript on Bun, no runtime dependencies](docs/adr/0002-typescript-on-bun-zero-dependencies.md).

## License

GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

## Commit messages

Releases and the changelog are generated from commit messages, so pull request titles (squash
merges use them) follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:` is a minor release, `fix:` and `perf:` a patch, `feat!:` or a `BREAKING CHANGE:` footer a
major one. `docs:`, `test:`, `ci:`, `build:`, `chore:` and `style:` appear in no release notes.
Release pull requests are titled `chore: release X.Y.Z`.
