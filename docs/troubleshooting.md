# Troubleshooting

Find the symptom, read the cause, apply the fix. Messages are quoted exactly as the engine and the
workflow print them, so you can search this page for the text you see in the Actions log or on the
pull request.

Wachiman is advisory. A failed, skipped or cancelled run blocks nothing: it posts comments, it
never approves, requests changes or gates a merge. The one cost of a failure is money already
spent on calls that finished before it.

## Start here: what actually happened

1. **Open the run.** On the repository's Actions tab, open the "Agent review" run for the event you
   expected: the pull request opening, or your comment. Every comment on a pull request starts a
   run of the caller workflow, so a long list of "skipped" runs is normal.
2. **Read the job status.** The reusable workflow has two jobs, `Agent review` (automatic, on
   `opened` and `ready_for_review`) and `Agent on demand` (your comment). GitHub prefixes them
   with the caller job's id.

   | Status | Meaning |
   | --- | --- |
   | Skipped | The job's `if:` was false. Nothing ran. See [No run, or a skipped job](#no-run-or-a-skipped-job). |
   | Green, but the later steps are skipped | The branch matched `skip_branch_prefixes`. See the same section. |
   | Red | A step failed. Open it and match its last line against the sections below. |
   | Green, but nothing on the pull request | The engine decided there was nothing to do, or the comment was not a command. See [My command did nothing](#my-command-did-nothing). |
   | Cancelled | A newer run replaced it, or it hit the 30-minute limit. See [Cancelled and timed-out runs](#cancelled-and-timed-out-runs). |

3. **Find the engine version.** The step "Record the engine version" writes
   `Engine niway-dev/wachiman@<sha>, run from engine/ ...` into the job summary. That is the exact
   commit that ran. Quote it when you ask for help.
4. **Read the provider lines.** In the step "Review the pull request" (or "Review or answer"),
   each agent call prints one JSON line, for example `{"is_error":false,"terminal_reason":"success","turns":9,"cost_usd":0.12,"duration_ms":41000}`.
   The values here are illustrative. Add the `cost_usd` values to see what a run spent.
5. **Before you re-run, look at the pull request.** A red job does not always mean nothing was
   posted: see [The job is red but a review is there](#the-job-is-red-but-a-review-is-there).
   Re-running repeats the paid calls.

## No run, or a skipped job

| What you see | Cause | Fix |
| --- | --- | --- |
| No run at all when the pull request opened | The caller file is not in the pull request's merge result. A pull request opened before the workflow reached the default branch gets no review. | Comment `/wachi review` on it (the comment path reads the file from the default branch), or open the pull request after the file has merged. |
| No run at all, pull request has a merge conflict | GitHub does not run `pull_request` workflows on a pull request that cannot be merged. This is GitHub's behaviour; this repository does not test it. | Resolve the conflict, then comment `/wachi review`. |
| No run after a push, a reopen or a new commit | The caller's `pull_request` types do not include `synchronize` (a caller written before ADR 0011 lists only `opened` and `ready_for_review`), or `review_on_push` is `false`, or the pull request is a draft, a fork's, Dependabot's or on a skipped branch prefix. A reusable workflow cannot add a trigger, so bumping the pinned release does not fix the first case. | Add `synchronize` to the `pull_request` types ([upgrading.md](upgrading.md#review-on-every-push-synchronize)), or comment `/wachi review` to review what changed since the last reviewed commit. On an unchanged head that ends at `Already reviewed` (see below). |
| `Agent review` skipped on a `pull_request` event: the pull request is a draft | The job requires `draft == false`. | Mark it ready for review. That event starts the review. |
| `Agent review` skipped: the pull request is from a fork | The job requires the head repository to equal your repository. Forks are skipped on purpose. See [Fork pull requests](#fork-pull-requests). | See that section. |
| `Agent review` skipped: the actor is `dependabot[bot]` | Dependabot pull requests are skipped so they cost nothing. | Comment `/wachi review` if you want one reviewed. The comment path has no Dependabot check. |
| `Agent review` is green, the later steps are skipped, and the log says `Branch <name> matches skipped prefix <prefix>; not reviewing.` | The head branch starts with one of `skip_branch_prefixes` (default `release-please--`). The prefix list applies to the automatic job only. | Change `skip_branch_prefixes`, or comment `/wachi review`. |
| `Agent on demand` skipped on a comment | One of the gate conditions failed: the comment is on an issue and not a pull request, the author is not `operator`, or the body contains none of the mention, `@agent-review` or `@claude`. | See [My command did nothing](#my-command-did-nothing). |
| Your first `/wachi review` does nothing in the pull request that installed the workflow | GitHub runs `issue_comment` workflows from the default branch, which has no caller file yet. | Merge first. Only the automatic review runs in the installing pull request. |

## My command did nothing

A comment goes through two checks. The workflow gate decides whether the job starts. The engine's
parser then decides what the comment means. A comment can pass the first and fail the second, which
leaves a green job with nothing posted.

**1. Who may command.** Only the one GitHub login set as `operator` in your caller file. A
maintainer, an organisation owner or another collaborator is not the operator, so their comment
skips the job without a message. The engine compares the login without regard to case. If the job
starts and the author differs, the engine prints `Comment by <author>, not the operator <operator>; nothing to do.` and exits 0.

**2. The workflow gate.** The job starts when the comment body contains your `mention` (default
`/wachi`), `@agent-review` or `@claude`, anywhere in the text.

- With the default `mention`, `/wachiman review` also starts the job, only because `/wachi` is a
  substring of `/wachiman`.
- With a custom `mention` such as `/reviewbot`, a comment that has only `/wachiman review` does not
  start the job. Use your configured mention, `@agent-review` or `@claude`. The engine's parser
  accepts `/wachiman`, but the gate does not check for it.
- With a custom `mention`, `/wachi` stops working: neither the gate nor the parser accepts it.

**3. The parser.** Once the job runs, the engine finds the first occurrence of the command in the
comment and reads the rest of that line. Each result below comes from running the engine's parser on that exact text (default mention):

| Comment | Result |
| --- | --- |
| `/wachi review` | Review |
| `/wachi review src/ docs/` | Review of those two paths |
| `/wachi Review src/` | Review (the word `review` is not case-sensitive) |
| `/Wachi review`, `/WACHI review` | Ignored: the command is case-sensitive. The job still starts, so it is green and posts nothing |
| `see docs/wachi review` | Ignored: the command must start a word, so a `/` or `.` or `@` before it disqualifies it |
| `/wachi: review`, `/wachi, review`, `/wachi please review` | **A question, not a review.** The first word after the command must be exactly `review` |
| `/wachi review` on one line, `src/a.ts` on the next | Review of everything, with no path: paths count only on the same line |
| `/wachi` alone, or `/wachi what changed?` | A question |

A question is answered as a pull request comment by one agent call that costs up to
`answer_budget_usd` (default 1 USD). If you wanted a review and got an answer, look at the first
word after the command.

**4. Paths.** `/wachi review <path>…` takes file names or directory prefixes of the pull request's
changed files. Globs are not expanded. A word that matches no changed file is ignored, and the log
says `Not paths in this pull request, ignored: <words>`. If every word is ignored, the review runs
without a scope. A mistyped path therefore does not fail: it can start a full review or, on an
unchanged head, produce the `Already reviewed` comment below. Read that log line when a scoped
review covers more than you expected.

**5. "Already reviewed".** When the head commit is the one the last complete review covered, and
the request has no matching path, the engine posts a review whose body reads:

> Already reviewed at `abc1234`. Push changes, or ask `/wachi review <paths>`.

This is a normal result, and the job is green. Push a change, or name paths to review them again.
A scoped review always covers the named files in full, so it can cost as much as a first review of
them.

**6. "Nothing to review".** The body reads:

> Nothing to review at `abc1234`: the N changed file(s) are all lockfiles, build output or generated, or outside the requested paths.

The built-in exclude list (lockfiles, build output, generated files) removed every file, or your
paths matched only excluded files. `AGENT_REVIEW_EXCLUDE` adds patterns where it can be set. See [configuration.md](configuration.md).

**7. A reply in a review thread got no answer.** The engine does not run when you reply. It reads
open threads only while it is reviewing something: a later `/wachi review` or a scoped one. On an
unchanged head, an unscoped `/wachi review` stops at `Already reviewed` before it looks at
threads, so the reply stays unanswered. Push a change, or comment `/wachi review <file>` with the
path the thread is on. Only replies from `OWNER`, `MEMBER` and `COLLABORATOR` are passed to the
agent. See [reviews.md](reviews.md).

## Fork pull requests

- **Automatic review:** the `Agent review` job is skipped.
- **On-demand:** the job runs a check before it reads anything from the head. It fails, red, with:

  ```text
  Pull request #<n> comes from <owner/repo>, not <your owner/repo>; not running.
  ```

  The failing step is "Refuse a fork pull request".

This is intended. A fork pull request carries code you have not vetted, and the job holds your API
key. Do not switch the caller to `pull_request_target` to get around it: [SECURITY.md](../SECURITY.md)
says it must not be used. If you want a review of a contributor's change, a maintainer can read it
and push it to a branch of your repository. Wachiman is not built to review code from people you do
not trust.

## Operator is not set

Both jobs start with a check and fail, red, with this annotation:

```text
operator is not set: The workflow input 'operator' is empty or still a template placeholder ('<value>'). Set it to your GitHub login in the caller workflow. ...
```

`operator` is an input under `with:` in the caller file. It is not the secret. Set it to the GitHub
login of the one person who may start reviews by comment.

The check refuses an empty value, `your-github-login`, and any value that begins with `edit`
(compared without regard to case). That is a safety rule, because the template's `EDIT-THIS-github-login`
is a name anyone could register. It also rejects a real login that starts with `edit`, such as
`edith`, and no setting overrides it.

The engine repeats the check with its own messages, which you see when you run the CLI directly:
`The operator login is empty. ...` and `The operator login is still the template placeholder "<value>". ...`.

## Secrets and credentials

### `ANTHROPIC_API_KEY is not set`

The line reads `agent-review: ANTHROPIC_API_KEY is not set`, the step fails with exit 1, and no
paid call was made. The caller passed an empty value. Check each of these:

- The secret exists and is spelled exactly `ANTHROPIC_API_KEY`. The reusable workflow accepts no
  other secret name.
- The caller file passes it: `secrets: ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`.
- It is a repository secret (or an organisation secret shared with this repository), not an
  environment secret. The caller's job declares no environment, so an environment secret is not
  visible to it. A copy-install setup lost a run to this mistake ([setup-copy.md](setup-copy.md)).
- A fork pull request or a Dependabot pull request would not receive your secrets either, but both
  are skipped before this point.

### The key is set, but no review comes back

The engine checks only that the key is not empty. It does not check that the key is valid, has
credit, or is within its spend limit. A key that Anthropic rejects shows up as calls with no
result: `A batch call failed: ...` lines, or JSON lines with `"is_error":true`, and finally
`agent-review: The agent did not return a review for any batch.` What Claude Code prints for a rejected key was not captured, so the first diagnostic is outside
Wachiman: open the Anthropic Console
and check that the key is active and that the workspace has credit and no exhausted limit.

### The provider binary

`agent-review: The Claude Code binary "claude" did not run (--version): ...` means the `claude`
program is not on `PATH` or does not start. In the reusable workflow the "Install Claude Code" step
runs first and fails first, so you meet this mainly when you run the CLI yourself. The check runs
before any call is paid for.

### Installing Claude Code

The "Install Claude Code" step runs `src/install-claude-code.sh`. Its messages:

| Message | Cause | Fix |
| --- | --- | --- |
| `CLAUDE_CODE_VERSION must be an exact version such as 2.1.304 (got '<value>').` | `claude_code_version` is not `x.y.z`. `latest`, a range and a leading `v` are refused. | Set an exact version, or remove the input to use the default. |
| `CLAUDE_CODE_SHA256 must be 64 lowercase hex characters.` | `claude_code_sha256` is uppercase, short or has extra characters. | Paste the 64 lowercase hex characters, or leave it empty. |
| `Unsupported operating system: <os>` or `Unsupported architecture: <arch>` | The runner is not Linux or macOS on x64 or arm64. | Use `ubuntu-latest` (the reusable workflow's runner). |
| `jq is required to read the manifest.` | No `jq`, and no `claude_code_sha256` was given. | Install `jq`, or pass `claude_code_sha256`. |
| `No SHA-256 for platform <platform> in the manifest of <version>.` | The publisher's manifest has no entry for this version and platform. | Pick a version that publishes your platform. |
| `curl: (<code>) The requested URL returned error: 404` (from `curl -fsSL --retry 3`) | The version does not exist at the download site. The code is curl's and varies by curl version. | Check the version number. |
| `SHA-256 mismatch for Claude Code <version> (<platform>).`, followed by `expected:` and `actual:` lines | The downloaded binary does not match the expected hash. | See below. |

On a hash mismatch the install stops before the binary becomes executable, and that is the point.
If you set `claude_code_sha256`, check that it belongs to the same version and the same platform
(`linux-x64` on `ubuntu-latest`). If you did not set it, re-run once. If it still fails, do not work
around it: open an issue with the version and both hashes. A persistent mismatch can mean a corrupt
download or something worse, and this page cannot tell which. See
[providers/claude-code.md](providers/claude-code.md).

## Budget, partial coverage and cost

### The review says "Partial review"

The first line of the review reads, after the brand:

> Partial review: the agent reviewed X of Y files of the whole pull request, at `abc1234`. Not reviewed: ... Ask `/wachi review <paths>` for the rest.

Open the collapsed "Coverage by batch" table. Each row's status tells you why:

| Status | Meaning |
| --- | --- |
| `reviewed` | The agent accounted for every file in the batch on the first call. |
| `reviewed after a retry` | The first call left files unaccounted for, or returned nothing, and the single retry covered them. |
| `N file(s) left after a retry` | The retry also left files out (a retry that again hit `max_turns` shows here). This is also what a batch whose calls failed shows, when budget remained for the retry. |
| `N file(s) left: budget spent` | Files were left out and less than 0.05 USD remained for a retry. |
| `N file(s) left: the call timed out` | The call was killed at `call_timeout_s` and is not retried. Raise `call_timeout_s` (keep it under the 30 minute job limit) or lower `batch_lines`. |
| `not run: budget spent` | The review's total budget was gone before this batch started. |

The source also defines the labels `ran out of its budget`, `hit the turn limit`, `timed out`,
`the call failed` and `returned no review`, but the retry logic replaces them with one of the statuses above whenever a batch has a
file left over. This is read from the code, not observed in a run. The failure itself is in the
log: `A batch call failed: ...`, or a JSON line with `"is_error":true`.

A file in the "Not reviewed" list can carry a reason in parentheses: `binary` or
`no_diff_and_unreadable` (GitHub sent no diff and the agent could not read it), or
`not reached: the pull request's budget was spent`. A file with no reason is one the agent did not
account for after the retry.

To cover the rest, comment `/wachi review <path> <path>` with the listed files. To avoid it next
time, raise the budgets or lower the batch size: see [costs.md](costs.md) and
[configuration.md](configuration.md). Coverage is what the agent reports per file. It is not a
measurement of which lines it read.

A partial or scoped review does not move the incremental marker. The next plain `/wachi review`
therefore starts again from the last complete review and pays for the same files again.

### "The agent ran out of its budget"

The comment reads:

> The agent ran out of its budget ($0.75 a batch, $3 the pull request) before finishing any batch: nothing here was reviewed reliably. Review part of it: `/wachi review <path> [path…]`.

The numbers are your settings. The job is green and exit 0, and the comment is the only output.
Review part of the pull request with a path, or raise `batch_budget_usd` and `budget_usd`.

### `The agent did not return a review for any batch.`

The line reads `agent-review: The agent did not return a review for any batch.`, exit 1, and nothing
is posted. Causes, in the order to check:

- Every batch call failed. The `A batch call failed: <first 300 characters of the error>` lines above it say why.
- Every call ended in an error result with no review. The JSON lines show `"is_error":true`.
- `budget_usd` is below 0.05. The engine starts no batch when less than 0.05 USD remains, so a total
  under that starts none, and the run ends with this line at no cost.

### The cost was higher than the budget

Check these before you assume a bug:

- The cap is per call, and Claude Code enforces it on the client side. A call can overshoot it
  ([providers/claude-code.md](providers/claude-code.md)).
- A call that died without a result is counted at its cap, because what it spent is unknown. The
  footer total can therefore be higher or lower than the real bill.
- `budget_usd` limits one invocation. An automatic review and a `/wachi review` use separate
  concurrency groups, so they can run at once on the same pull request and each spends its own
  budget. Each retry, each question and each re-run is a new invocation.
- A cancelled or timed-out run keeps what its finished calls cost.

The Anthropic Console shows what you were billed. The number in the review footer, `<sub>… · $0.00</sub>`,
is the engine's own sum of what the provider reported.

### `The agent did not answer (<reason>).`

A question failed. The reason is `budget` when the answer cap ended the call, `turns` when it reached `max_turns`, `timeout` when `call_timeout_s` killed it, or `error`. Nothing is
posted and the job is red. Narrow the question, or raise `answer_budget_usd`.

## Output refused: a credential-shaped string

```text
agent-review: The output contains something shaped like a provider credential; not posting it.
```

Before it posts anything, the engine checks the review, every inline comment, every thread reply and
every answer for your exact API key and for a string shaped like an Anthropic key (`sk-ant-`
followed by a long run of key characters). One match stops the whole post: no review and no
replies from that run. Exit 1.

The usual cause is a diff that contains a key-looking string, such as a test fixture or a document,
which the agent quoted. Check the pull request first. If the string is a real key, treat it as
leaked and revoke it. If it is a harmless fixture, ask for a review of the other files with
`/wachi review <paths>`.

There is no setting to turn this check off, and you should not want one. It is not a secret scanner.
An encoded or split key passes it ([SECURITY.md](../SECURITY.md)).

## GitHub errors

Failed GitHub calls print `agent-review: gh <first three arguments> failed: <gh's error output>`.
For example:

```text
agent-review: gh pr view 5 failed: HTTP 401: Bad credentials (https://api.github.com/graphql)
```

| Status in the message | Typical cause | What to do |
| --- | --- | --- |
| 401, 403 | The token is missing or lacks a permission. The workflow token is capped by the `permissions:` block in your caller. | Keep the template's `permissions: { contents: read, pull-requests: write, issues: read }`. Narrowing it causes this. |
| 404 | The pull request, or a file at the base commit, does not exist. A missing optional instruction file is normal and is handled quietly. Any other read error aborts. | Check the pull request number and repository. |
| Rate limit, network, 5xx | GitHub or the network. Only one case is retried: see below. | Re-run the job later. |
| `Could not read the base commit of pull request #<n>.` | GitHub returned no base commit. | Re-run. |

### The transient 422 and the retry

GitHub sometimes answers the review POST with a 422 whose text is "An internal error occurred, please
try again". Only this error is retried: after 1 second and again after 3 seconds. The log shows:

```text
GitHub answered with a transient error; retrying in 1 s. <error>
```

Before each retry the engine checks whether the review landed anyway, by looking for the attempt
id it wrote into the body. If it did:

```text
The review was posted despite the error; not posting it again.
```

If all retries fail, the job is red. Check the pull request for a review before you re-run. Other
GitHub calls (listing files, reading threads, posting a reply or an answer) are not retried.

### Inline comments moved into the body

```text
GitHub refused the inline comments; posting them in the body. <error>
```

This is a warning, not a failure. GitHub rejected the review because one comment pointed at a line
it could not anchor (a validation 422). The engine posts the same review once more with the findings
in the body instead of on their lines. The job is green.

### Other warnings

- `.github/claude-review.md is deprecated; rename it to .github/agent-review.md.` The old focus
  file is read only when the new one is missing.
- `<path> at the base commit is over 64 KB: cut.` An instruction file is longer than 64 KiB, and
  the review sees only the first part, with a notice. See [review-policy.md](review-policy.md).
- `CLAUDE_REVIEW_<NAME> is deprecated; use AGENT_REVIEW_<NAME>.` An old variable name still works.
  See [upgrading.md](upgrading.md).

## The job is red but a review is there

Exit code 1 means an engine error. It does not prove that nothing was posted. The engine posts the
review first and the thread replies after it, one request each. If a reply fails, the job goes red
after the review is already on the pull request. A POST that failed in an ambiguous way after its
retries may also have landed.

Look at the pull request before you re-run. If the review is there and complete, a re-run on the
same head commit ends at `Already reviewed` and spends nothing on the agent. To get the missing
thread replies, comment `/wachi review <file>` with the thread's file.

## Exit codes

The canonical table is in [cli.md](cli.md). What each code means when you read a failed job:

| Code | When | Note |
| --- | --- | --- |
| 0 | A review or an answer was posted, or there was nothing to do: not a command, not the operator, `Already reviewed`, `Nothing to review`, an all-budget `ran out of its budget` comment. | Green does not mean a review exists. |
| 1 | An engine error: missing key or binary, a failed `gh` call, `The agent did not return a review for any batch.`, the credential-shaped output refusal, a failed answer. | Not always "nothing posted": see above. |
| 2 | A usage error: unknown command, bad pull request number, a missing `GH_TOKEN`, `GITHUB_REPOSITORY` or `REQUEST`, an invalid numeric setting such as `AGENT_REVIEW_BUDGET_USD must be a positive number, got "0".`, or an unknown provider. | Printed with the usage text. |

One setting breaks that pattern: a malformed `AGENT_REVIEW_PRICE_PER_MTOK` (the Codex price override)
exits 1, not 2. That setting is available only in the CLI.

## Codex and the reusable workflow

The reusable workflow installs only Claude Code, and it passes only `ANTHROPIC_API_KEY`. The
`provider` input accepts any string and does not stop you from writing `codex`, but the run cannot
work: the workflow never installs Codex and never passes `OPENAI_API_KEY`. If you set
`provider: codex` and leave the default `model`, you get this first:

```text
agent-review: No price is known for model "claude-sonnet-5-5". Set AGENT_REVIEW_PRICE_PER_MTOK="input,cached_input,output" (USD per million tokens).
```

That message is correct but misleading here. Setting a price does not fix it. The Codex adapter is
available from the command line only; see [providers/codex.md](providers/codex.md). Remove the
`provider` input from your caller.

## Cancelled and timed-out runs

- Each job has a 30-minute limit. Batches run one after another, and the review is posted only
  after the last one, so a timeout or a cancellation posts nothing, and the calls that finished
  were paid. A re-run starts again from the beginning. To shorten a run, review a part with
  `/wachi review <paths>` or lower the batch size.
- A second `/wachi review` on the same pull request cancels the first run that is still in progress
  (concurrency is per pull request and per job, with `cancel-in-progress`). The automatic review has
  its own group, so a comment during it does not cancel it, and both run.

## Asking for help

Open an issue on [niway-dev/wachiman](https://github.com/niway-dev/wachiman/issues) with the
engine commit from the job summary, the `uses:` line from your caller, the exact last line of the
failing step, and what you expected. Do not paste API keys, source code from a private repository
or whole logs. Redact first. Report a vulnerability privately, as [SECURITY.md](../SECURITY.md) says.
