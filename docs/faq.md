# FAQ and limitations

Short answers to what a developer asks before giving Wachiman an API key. Each one links to the
page that owns the detail. This page describes `v1.3.0`.

## Trust

### Does it block merges?

No. It posts a GitHub review with the event `COMMENT`. It never approves, never requests changes
and is not a merge gate. A finding labelled "Blocker" is a recommendation to the author; nothing
enforces it. (The workflow's job shows up as an ordinary check run. Marking it required in your
branch protection would be your own configuration, not something Wachiman asks for.) See
[reviews.md](reviews.md).

### Is it a sandbox? Can I run it on pull requests from people I do not trust?

No, and no. **This is not a sandbox.** You must trust everyone who can push to a repository that
runs it, because the workflow holds your key and a pull request can edit workflow files. The
agent has read-only tools and gets no GitHub token, which limits what a review can do. It does
not make an untrusted branch safe. Read [SECURITY.md](../SECURITY.md), including the list of what
is unverified.

### Does it review pull requests from forks?

No. The automatic review skips them, and a comment on a fork's pull request is refused before
anything from the head is read. Forks get no secrets from GitHub anyway. Dependabot's pull
requests are skipped by the automatic review too. See [install.md](install.md) and
[SECURITY.md](../SECURITY.md).

### Where does my code go?

To the model provider you chose, and to nobody else on this project's side. Concretely:

- The job runs in **your** GitHub Actions. The engine and your pull request's head are checked out
  on the runner.
- For each batch, the engine puts the diff and your [instruction files](review-policy.md) into the
  prompt and makes the pull request's title and body available to the agent. The agent can also
  read other files of the head with its read tools. All of that is sent to the provider:
  Anthropic by default, with your `ANTHROPIC_API_KEY`, under your terms with them.
- The review is posted to GitHub through the job's own token.

Wachiman does not remove the need to decide whether your code may go to that provider. See
[costs.md](costs.md) for what a call involves and [providers/claude-code.md](providers/claude-code.md)
for the agent's environment.

### What does this project run? Does it see my code or my key?

The engine's code contains no network calls of its own. It talks to GitHub through the `gh` CLI
and to the model through the provider's CLI (`claude`, or `codex`). The only download its scripts
make is the pinned Claude Code binary, fetched from the publisher and checked against a SHA-256
([providers/claude-code.md](providers/claude-code.md)); the workflow also uses GitHub's checkout
and Bun setup actions. Your key stays in your repository secrets. A search of the engine's source
found no analytics or telemetry sender. That says nothing about the project's website, GitHub or
your model provider, which have their own policies.

### Does it learn from my reviews or store anything?

No. Nothing persists between runs except what is already on the pull request:

- Each complete review ends with a hidden line recording the commit it covered; the next review
  reads it from the pull request's own review history.
- Threads and replies are ordinary GitHub review comments.

There is no database and no memory of your repositories. The proposals for "learned" lessons
([ADR 0007](adr/0007-learned-memory-by-draft-pr.md)) and a policy folder
([ADR 0006](adr/0006-repository-review-policy.md)) are marked proposed and are not implemented.
What you can tune today is in [review-policy.md](review-policy.md). The accuracy script
([precision.md](precision.md)) reads GitHub when you run it; the engine does not run it.

The engine writes the pull request's title, body and open threads (and, for a question, its diff)
into temporary directories on the runner, and the engine's code does not delete them. On a GitHub-hosted runner the machine is
discarded after the job. On a runner that persists, they stay until the temp directory is cleaned.

## Cost and models

### What does it cost?

Model usage on your API key, plus normal GitHub Actions minutes. The defaults are a budget of
`$3` for one review, `$0.75` for one batch call and `$1` for one question. They are **budgets, not
price quotes**: the review stops starting new batches when the budget is spent. For Claude the cap
is soft, so a call can exceed it a little; the Codex adapter has no dollar cap at all. This page
gives no typical price: it depends on the size of the change and the model. See
[costs.md](costs.md) and [configuration.md](configuration.md).

### Which models can it use?

The default is `claude-sonnet-5-5`, run through Claude Code. The `model` input is passed to Claude
Code as given; the engine does not check it, and no other Claude model is documented as tested
here. The Codex adapter defaults to `gpt-6.1-sol`. See [configuration.md](configuration.md) and
[providers/claude-code.md](providers/claude-code.md).

### Does it work with Codex or OpenAI models?

From the command line, yes. In the reusable workflow, not yet. The engine has a Codex adapter
(`AGENT_REVIEW_PROVIDER=codex`, needs `OPENAI_API_KEY` and the `codex` binary), but the reusable
workflow installs only Claude Code and passes only `ANTHROPIC_API_KEY`. The two adapters are
hardened differently, and the Codex page lists what its hardening does not cover (for example, the
model can run the branch's code inside Codex's sandbox). See
[providers/codex.md](providers/codex.md).

### Can it run on self-hosted runners?

Not through the reusable workflow as it stands. Both of its jobs use `runs-on: ubuntu-latest`, and
there is no input to change that. You can copy the files and edit `runs-on`
([setup-copy.md](setup-copy.md)), but the copy cannot separate the engine from the reviewed
head, and a self-hosted setup has not been tested or reviewed for security here. The Claude Code
installer script supports Linux and macOS on x64 and arm64
([providers/claude-code.md](providers/claude-code.md)). A runner that persists between jobs keeps
the temporary files described above.

## Using it

### Why did it not review my latest push?

If the caller listed `synchronize`, it does: each push is reviewed, only the commits new since the
last review ([reviews.md](reviews.md#reviews-on-push)). A caller written before that default lists
only `opened` and `ready_for_review`; add `synchronize` to its `pull_request` types, or comment
`/wachi review` for one push. Also check that the pull request is not a draft, a fork's, Dependabot's
or on a skipped branch prefix, and that `review_on_push` is not `false`.

### Does it read every changed line?

Not in a way anyone can verify. It reviews the files the engine selected, after dropping lockfiles,
build output, generated files and similar. It splits them into batches and asks the model to list
the files it reviewed; the engine checks the list, retries missing files once and reports the rest
as not reviewed. That is the model's report, not a measurement of lines read. Files go
to the model in an order based on their paths, which is a heuristic. See
[reviews.md](reviews.md) and [architecture.md](architecture.md).

### Why did my reply in a thread get no answer?

A reply starts nothing. Wachiman reads threads only during a later review that has work to do.
See [reviews.md](reviews.md).

### What does a dry run cost?

It prints the review instead of posting it, and it still calls the model, so it can still spend
money (or use the machine's own login). The reusable workflow has no dry-run input. See
[cli.md](cli.md).

### What language are the reviews in?

English. The review prompt asks for English, and so does the question path. The path-based risk
order fits some repository layouts better than others: its defaults were taken from one project's
`ipc`, `preload` and `apps/<name>/src` layout. See [reviews.md](reviews.md).

## Quality

### How accurate is it?

This page gives no accuracy figure. Findings can be wrong. [precision.md](precision.md) describes how the project counts a finding as
correct, wrong or partly correct from the author's `Verdict:` replies, and how to run the script on
your own pull requests. Its samples are small, and one wrong finding moves a group of ten by ten
points. Judge it on your repository.

## Getting help

### Where do I report a problem?

For a vulnerability, use GitHub's private vulnerability reporting, as described in
[SECURITY.md](../SECURITY.md). It is a one-person project handled on a best-effort basis, with no
SLA. For anything else, open an issue on the repository. If a run failed, start with
[troubleshooting.md](troubleshooting.md).
