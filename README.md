# Wachiman

<img src="docs/assets/wachi.png" alt="Wachiman, a cartoon watchman with a cap and a whistle" width="96" align="right">

Advisory code reviews by an agent CLI. Review a branch on your laptop with your own Claude
subscription, or review every pull request inside your own GitHub Actions with your own API key or Claude subscription token.
One engine, same findings either way. Wachiman never approves or blocks a merge: it warns, you
decide.

**Documentation: [wachiman.dev/docs](https://wachiman.dev/docs/what-it-is/)** ·
[npm](https://www.npmjs.com/package/wachiman) · [Changelog](CHANGELOG.md)

Wachiman (pronounced *watchman*) is named after the Peruvian *wachimán*, the street watchman who
warns you and lets you decide; the Spanish word comes from the English one.

## Contents

- [Install](#install)
- [What you can do with it](#what-you-can-do-with-it)
- [Documentation](#documentation)
- [What a pull request review looks like](#what-a-pull-request-review-looks-like)
- [What it will not do](#what-it-will-not-do)
- [The trust decision, in brief](#the-trust-decision-in-brief)
- [Providers and platforms](#providers-and-platforms)
- [License](#license)
- [Commit messages](#commit-messages)

## Install

```sh
npm i -g wachiman      # or: bun add -g wachiman
wachiman --version
wachiman init          # set up this project: local reviews, GitHub Actions, or both
```

You need Node 20 or later and, for local reviews, Claude Code (`claude`) signed in. The package
installs [Bun](https://bun.sh) for you through its `bun` dependency (a 23 to 42 MB download); with
`--ignore-scripts` it uses a Bun already on your `PATH`. No API key is needed for local reviews.
Details, the supply-chain note and installing from a clone: [docs/local-review.md](docs/local-review.md#3-install).

`wachiman init` asks which mode you want. Local setup uses your current Claude session (or a
separate profile), checks the machine and account, and prints the first review command. GitHub
setup writes the workflow file; adding the secret and pushing the workflow stay manual steps.
See [project setup](docs/local-review.md#configure-this-project).

## What you can do with it

| Way | Where it runs | What you need | Guide |
| --- | --- | --- | --- |
| `wachiman local` | Your laptop, on a branch or commit; nothing is posted | Claude Code signed in; no API key | [docs/local-review.md](docs/local-review.md) |
| Reusable GitHub Actions workflow | Your repository's runners, on each pull request | A provider API key, or a Claude subscription token, as a secret | [docs/install.md](docs/install.md) |

A GitHub App is a design only; it is not implemented.

**Review your branch before you push.** `wachiman local` reviews the committed change on your
branch with your own signed-in `claude` and prints the findings in the terminal, or writes them as
Markdown or JSON. Nothing is posted, no GitHub requests are made and no telemetry is sent; your
code goes to your configured Claude account. Read [docs/local-review.md](docs/local-review.md)
before running it on an employer's code.

```sh
wachiman local                                # current branch against origin's default branch
wachiman local --commit abc1234               # exactly one commit
wachiman local --from abc1234                 # that commit and everything after it
wachiman local --format markdown --output review.md
```

**Loop until clean.** `wachiman loop --base main` runs one review round per call and exits `0`
when nothing keeps it open, `10` while findings do and `11` when it stopped without converging; a
coding agent fixes between calls and the CLI never edits code ([docs/cli.md](docs/cli.md#loop)).

**Ask about a change.** `wachiman ask "<question>"` answers one question about the same local
change, grounded in its stored review when there is one; with no question it walks you through the
change ([docs/cli.md](docs/cli.md#ask)).

**See what local runs cost.** `wachiman status` shows the cost of the runs kept on this laptop
([docs/cli.md](docs/cli.md#status)); workflow runs are not in it. `wachiman dashboard` writes one
offline HTML page (or JSON) with the spend per day and repository, the findings by severity and
verdict and the loop rounds ([docs/local-dashboard.md](docs/local-dashboard.md)).

**Let your coding agent run it.** `wachiman skills install` copies the `wachiman-review` agent
skill, which teaches Claude Code or Codex to pick the range from what you ask, run a local review
and present the findings, and the `wachiman-loop` skill, which fixes between loop rounds ([docs/local-review.md](docs/local-review.md#let-your-coding-agent-run-it)).

**Review every pull request in GitHub Actions.** A short caller file in your repository pins a
release, passes your key and names the operator. Start with [docs/install.md](docs/install.md),
from an empty repository to a posted review; the caller file is
[`templates/wachiman-review-caller.yml`](templates/wachiman-review-caller.yml). Already copied the
engine into a repository? [docs/setup-copy.md](docs/setup-copy.md) explains how to move to the
maintained workflow.

## Documentation

The guides are published at **[wachiman.dev/docs](https://wachiman.dev/docs/what-it-is/)**. The
same material, in this repository:

| I want to… | Read |
| --- | --- |
| Get a first review on a repository | [docs/install.md](docs/install.md) |
| Know what I am trusting, and what is unverified | [SECURITY.md](SECURITY.md) |
| Look up an input, a default or an environment setting | [docs/configuration.md](docs/configuration.md) |
| Find out why there was no review, or an error | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Ask for reviews, scope them, read the results | [docs/reviews.md](docs/reviews.md) |
| Understand what a run can cost and what coverage means | [docs/costs.md](docs/costs.md) |
| Read the PR Confidence grade in a description (trial) | [docs/pr-confidence.md](docs/pr-confidence.md) |
| Tell the reviewer what matters in my repository | [docs/review-policy.md](docs/review-policy.md) |
| Adopt a new release, or roll one back | [docs/upgrading.md](docs/upgrading.md) |
| Turn it off and remove it | [docs/uninstall.md](docs/uninstall.md) |
| Quick answers and limitations | [docs/faq.md](docs/faq.md) |
| Run the engine from the command line | [docs/cli.md](docs/cli.md) |
| Review a branch on my laptop, on my own Claude subscription | [docs/local-review.md](docs/local-review.md) |
| See the spend, findings and loops of my local reviews on one page | [docs/local-dashboard.md](docs/local-dashboard.md) |
| See what a provider adapter runs and inherits | [docs/providers/claude-code.md](docs/providers/claude-code.md), [docs/providers/codex.md](docs/providers/codex.md) |
| Move from a copied installation | [docs/setup-copy.md](docs/setup-copy.md) |
| Understand how a review is built | [docs/architecture.md](docs/architecture.md) |
| Measure false positives | [docs/precision.md](docs/precision.md) |
| See how it compares with Pullfrog and CodeRabbit | [wachiman-benchmarks](https://github.com/niway-dev/wachiman-benchmarks) |
| See what changed in a release | [CHANGELOG.md](CHANGELOG.md) |
| Cut a release (maintainers) | [docs/releasing.md](docs/releasing.md) |

Design decisions are recorded as ADRs in [docs/adr/](docs/adr/), starting with
[ADR 0001: distribution and trust](docs/adr/0001-distribution-and-trust.md) and
[ADR 0002: TypeScript on Bun, no runtime dependencies besides Bun itself](docs/adr/0002-typescript-on-bun-zero-dependencies.md).

## What a pull request review looks like

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
  draft, and, if your caller lists `synchronize`, on each push (only the new commits). The operator
  you name can comment `/wachiman review` to ask for another review of what changed, or any other
  `/wachiman …` text to ask a question. An answer reads the latest review and checks its file and
  line references against the pull request's head. `/wachiman` alone, or `/wachiman explain`, gets
  a walkthrough of the change. A reply the operator writes in a review thread gets an answer
  without a push. All automatic runs on one pull request together stop at $6 by default
  (`auto_budget_usd`); `/wachiman review` is not limited. Only the operator can ask by default. A
  collaborator can be allowed to ask too (set the `askers` input to `write`; their questions then
  share a ceiling of $3 per pull request, `ask_ceiling_usd`). Details: [docs/reviews.md](docs/reviews.md).
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

## Providers and platforms

The current release is on [npm](https://www.npmjs.com/package/wachiman) and in
[CHANGELOG.md](CHANGELOG.md). The command-line contract ([docs/cli.md](docs/cli.md)) and the
provider adapter boundary are in place. The older `CLAUDE_REVIEW_*` variables,
`.github/claude-review.md`, `/wachi` and the `@claude` mention are still
read with a notice; see [docs/upgrading.md](docs/upgrading.md).

- **Claude Code** (`claude -p`) is the provider the reusable workflow installs and runs, with
  `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` to run on a Claude subscription
  ([docs/providers/claude-code.md](docs/providers/claude-code.md)).
- **Codex CLI** (`codex exec`, for OpenAI models) is a second adapter, available only from the
  command line. The reusable workflow does not install it or pass an OpenAI key
  ([docs/providers/codex.md](docs/providers/codex.md)).
- **npm releases:** version 1.10.0 was published by hand, without a provenance statement; the
  release workflow publishes later versions with one.
- **Platforms:** macOS and Linux are covered by CI. Windows (Git Bash, PowerShell) is not tested
  in CI and is expected to work wherever Node and Bun run.

## License

Wachiman is **source available**, not open source. It is licensed under the
[Functional Source License, Version 1.1, ALv2 Future License](LICENSE) (`FSL-1.1-ALv2`), a
[Fair Source](https://fair.io/) license. Copyright 2026 Niway S.A.C.

- **You may** use it for any purpose except a Competing Use: run it on your own repositories and
  in your company, read and modify it, fork it for internal use, use it for non-commercial
  education and research, and use it to give professional services to a client who may also
  use it.
- **You may not**, without a commercial license, make it available to others as a commercial
  product or service that does what Wachiman does, hosted or packaged.
- **Each version published under FSL-1.1-ALv2 also becomes available under Apache 2.0 two years
  after that version is made available.** The license says so under "Grant of Future License".
- **Commercial license:** write to contact@niway.com. There is no price list.
- **Name and logo:** the license grants no rights to them. See [TRADEMARKS.md](TRADEMARKS.md).

### Licensing history

Everything published before the commit that replaced LICENSE, including releases through v1.3.0,
remains available under GNU AGPL version 3 or any later version, as stated in those versions'
LICENSE files. The
`LICENSE` file inside each release tag says which license that release carries. The reason for the
change is recorded in [ADR 0013](docs/adr/0013-license-fsl-1-1-alv2.md).

Benchmark reports and the review dataset live in
[niway-dev/wachiman-benchmarks](https://github.com/niway-dev/wachiman-benchmarks); they moved there
from `docs/benchmark/` on 2026-11-02. Quoted third-party text in them, and in this repository's
history, belongs to its authors and is reproduced for research and comparison; it is not covered by
the license above.

## Commit messages

Releases and the changelog are generated from commit messages, so pull request titles (squash
merges use them) follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:` is a minor release, `fix:` and `perf:` a patch, `feat!:` or a `BREAKING CHANGE:` footer a
major one. `docs:`, `test:`, `ci:`, `build:`, `chore:` and `style:` appear in no release notes.
Release pull requests are titled `chore: release X.Y.Z`.
