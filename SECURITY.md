# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use GitHub's private
vulnerability reporting: the "Report a vulnerability" button under this repository's Security tab.
It is enabled once the repository is public (GitHub does not offer it on private repositories).
Include what you did, what you expected and what happened.

This is a one-person project: reports are handled on a best-effort basis, with no SLA.

## Trust assumptions

These assumptions are what make the tool acceptable to run with an API key. Everything below
describes the default Claude Code workflow (`review.yml` with `provider: claude-code`) unless a
sentence says otherwise. If an assumption does not hold for your repository, do not install it.

- **Only trusted people can push branches to a repository that runs it.** The review job holds
  your API key, and on `pull_request` GitHub runs the workflow file from the pull request's own
  branch. A person who can push can therefore change the workflow and read the key. Nothing in
  this tool defends against that. The same holds for `pull_request_review_comment`, the event that
  starts a thread-reply run: it is documented to run the workflow file from the pull request's merge
  commit and to give a same-repository head the repository's secrets, like `pull_request`, but the
  first real install has not yet verified that ([ADR 0012](docs/adr/0012-automatic-thread-replies-and-a-per-pr-ceiling.md)).
- **Fork pull requests are excluded from review.** The automatic job skips them. The on-demand job
  reads the pull request's head repository name with the job's token, and stops before checking
  out or reviewing the head if it is not the calling repository. Data about a fork pull request
  (such as that repository name) can therefore reach a job; the review of its code does not run.
  GitHub's default is to give `pull_request` runs from forks no repository secrets, but this tool
  does not enforce that and does not rely on it alone. `pull_request_target` is not used and must
  not be added.
- **The engine never runs inside the reviewed head.** The reusable workflow checks the head out
  into `head/` and the engine into a sibling `engine/`, and starts Bun with `engine/` as its
  working directory, `--no-env-file` and `--config=bunfig.toml` (the engine's own file). Bun
  therefore does not load a `bunfig.toml` (whose `preload` runs code) or a `.env` file (which could
  set `ANTHROPIC_BASE_URL` or a proxy) from the head. The head's path is passed with `--repo-dir`.
  The agent CLI gets an allowlisted environment: no GitHub token, base URL, proxy or runtime
  option (see [docs/providers/claude-code.md](docs/providers/claude-code.md)).
- **The agent is configured to only read.** In the default workflow, Claude Code runs with
  `--restricted`, `--strict-mcp-config`, `--tools Read,Glob,Grep` and the adapter's own settings
  file (which denies `Bash` and `/proc` reads; see
  [docs/providers/claude-code.md](docs/providers/claude-code.md)). With the default pinned
  version (2.1.304) and the tested configurations, that leaves it no shell, starts no MCP server, ignores
  the user, project and local settings of the branch under review, and gives it no GitHub token in
  its environment. **Managed Claude Code settings on the runner still apply**, and the claims stop
  at the versions and checks listed under "What is unverified". They do not cover Codex (see
  "Codex is not the workflow's provider" below). Each call has a spend cap, which for Claude Code
  is soft: a call can overshoot it (see [docs/costs.md](docs/costs.md)).
- **The CLI holds the credentials.** It posts the review and posts nothing at all (it stops with an
  error) if any text it would post (the review body, its inline comments, thread replies and
  answers) contains the active provider's API key, either the job's exact key or anything shaped
  like one: `sk-ant-…` for the Claude Code adapter, `sk-…` for the Codex adapter. That is all the
  check does. It is not a secret scanner: it does not look for the GitHub token, other secrets in
  the repository or the runner, or any credential of another shape, and an encoded or split key
  would pass. Text that merely looks like a key (an example key in a diff, say) also stops the
  post.
- **Only trusted people can start a run on demand.** Only the operator's `/wachi` comment (or its `@agent-review` and `@claude` aliases) starts
  an on-demand run, and only replies from `OWNER`, `MEMBER` or `COLLABORATOR` reach the agent.

- **Supply chain, and the maintainer.** The ref a consumer pins decides which code runs with
  their key. Exact release tags (`v1.3.0`) are recommended, and a tag ruleset on `v*` is meant to
  stop them being moved or deleted. That ruleset is a GitHub setting that nothing in this
  repository's files proves, and [docs/releasing.md](docs/releasing.md) records that a repository
  admin can bypass it (the release process uses that bypass to move the floating `v1` tag). So a
  maintainer with admin rights keeps the ability to move an exact tag, and a consumer who pins one
  trusts this project's maintainer not to. A full commit SHA cannot be moved this way; it is the
  stronger pin, at the cost of a less readable caller file. The floating `v1` tag moves on every
  compatible release and is not recommended. Consumers can receive new releases as Dependabot pull
  requests, but only if they enable Dependabot for GitHub Actions in their own repository (see
  [docs/install.md](docs/install.md)). Third-party actions in this repository's workflows are
  pinned by full commit SHA and updated by Dependabot. The Claude Code binary is downloaded at a
  pinned version and checked against a SHA-256 before it is installed. By default that hash comes
  from the publisher's own manifest, so the check shows the download is intact, not that the
  publisher is trustworthy; a consumer can pin the hash itself (see
  [docs/providers/claude-code.md](docs/providers/claude-code.md)).

This is not a sandbox. Managed Claude Code settings on the runner still apply.

## Codex is not the workflow's provider

The Codex adapter ([docs/providers/codex.md](docs/providers/codex.md)) is available from the command
line only. The reusable workflow does not install Codex or pass `OPENAI_API_KEY`. Everything above
about read-only tools does not apply to it: Codex's model reads by running shell commands inside
Codex's own sandbox, so it can run code from the head there. Its Linux sandbox on GitHub runners and
its API-key login have not been verified, and it has no per-call dollar cap. Do not run it on a
branch you do not trust.

## What from the head is executed, and what is read

Never executed by the engine: the head's Bun configuration and environment files, and its Claude
Code settings and hooks (see above). Still read as data: the head's files through the agent's read
tools. The review instructions (the focus file `.github/agent-review.md`, `CLAUDE.md` and
`AGENTS.md`) are read from the pull request's base commit, never from the head, and the prompt
says the head's copies are content under review. Neither provider starts inside the head: each
runs in an empty scratch directory and gets the head as a readable directory (`--add-dir` for
Claude Code), so the head's `CLAUDE.md` is not auto-loaded as project memory
(`test/provider-isolation.test.ts`, [the Claude Code provider](docs/providers/claude-code.md)).
Content the agent reads on purpose, by absolute path, can still
try to steer the review (prompt injection); that is what the read-only tools, the budget caps and
the trust assumption are for.

The model's text cannot forge the engine's state: HTML comments in everything it writes are
neutralised, so it cannot write the incremental marker (which would make the next run skip
unreviewed commits) or the hidden signatures the engine uses to tell its reviews and threads from
other `github-actions[bot]` workflows. Until reviews posted before signatures existed are gone,
an unsigned review or thread in the old format is still accepted, and another workflow in the
same repository could imitate it.

The "copy the files" install cannot separate engine and head: the copied engine sits in the
consumer repository, so on `pull_request` it is the pull request's own copy. It uses the same Bun
flags, but the reusable workflow is the preferred install.

## What is unverified

- That the `v*` tag ruleset exists as described and who can bypass it. It is a hosted setting, not
  something the repository's files or tests show.
- That Bun's `--no-env-file` and `--config=` keep out every runtime file. Only `bunfig.toml`
  `preload` and `.env` are tested (Bun 1.3.4, `test/bun-isolation.test.ts`); other files Bun can
  read from a working directory are avoided by never using the head as one, not by a test.
- The new workflow layout has not been exercised in a full paid run.

- Whether the `/proc` deny rules in the engine settings have any effect under `--restricted`.
- That the head's instruction files stay unloaded on a Claude Code version other than 2.1.304
  (checked) and 2.1.314 (a `--restricted` probe only). The opt-in harness
  `test/provider-isolation.test.ts` re-checks any binary; the child environment must never carry
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`, which makes `--add-dir` directories load.
- The hardening flags have been checked to be accepted by the CLI, but they have not been
  exercised in a full paid review.

Claims about hardening are limited to what has been tested, and none is a guarantee against a
malicious branch.
