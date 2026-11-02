# Architecture

This document describes the engine as released in v1.3.0 (when it was written, `src/` and the
workflows on `main` matched that release): the engine runs from a sibling `engine/` checkout, the reviewed head
is passed as `--repo-dir`, and the agent gets an allowlisted environment. Decisions and their
reasons are in the ADRs ([0001](adr/0001-distribution-and-trust.md),
[0002](adr/0002-typescript-on-bun-zero-dependencies.md)); this page is how the system works and
what a change has to keep true. For what to do when something goes wrong, see
[troubleshooting](troubleshooting.md); for spend, see [costs](costs.md); for how to ask for a
review, see [reviews](reviews.md).

The review is advisory. It is posted as a `COMMENT` review, never approves or requests changes, and
is not a required check. A finding labelled "Blocker" is a severity word, not a merge gate.

## Thesis

The model only judges. Everything that code can decide, code decides, before and after the call.
A model that is handed a whole pull request chooses what to read, rations its own effort, and
posts in an inconsistent shape: some files get read closely, some not at all, and nobody can tell
which. So the engine picks the files, orders them by a path-based risk guess, cuts them into batches,
puts the numbered diff in front of the model, asks for a structured answer, checks that every
selected file appears in the model's own list of files reviewed (or has a closed skip reason),
hands each call a spend cap, and does the posting itself. The model returns findings and a list of
what it says it read; the code turns that into a GitHub review. The engine cannot see what the
model actually read, so "reviewed" always means "reported as reviewed by the model" (see
[stage 6](#the-pipeline-stage-by-stage)).

## The flow

```
 review <pr>                                   comment <pr>  ($REQUEST)
     |                                              |
     |                              operator check, author check, parseCommand
     |                                      |                    |
     |                                  "review ..."         anything else
     v                                      v                    v
 listFiles --> since last marker? --> filterFiles --> planBatches     answer(): 1 call,
 (gh api)      (compareFiles)        (exclude, scope)  (risk, modules)  free text
                                                          |                |
              per batch, riskiest first, until budget ends|                |
                  buildBatchPrompt --> provider.run --> batchGaps          |
                  (diff in stdin)      (read-only,       |-- gaps: one     |
                                        JSON schema,     |   retry         |
                                        per-batch cap)   v                 |
                                              mergeOutputs --> buildReview |
                                                                  |        |
                              refuseLeak --> postReview (COMMENT) <+-------+
                                             inline + body + coverage + marker
```

## The pipeline, stage by stage

All names are in `src/engine.ts` unless a file is given.

1. **Filter.** `listFiles` reads the changed files from GitHub. `lastReviewedSha` finds the last
   `<!-- agent-review sha=... -->` marker (the old `claude-review` marker is still read) in the
   tool's own reviews. A review is the tool's only if `github-actions[bot]` wrote it and it
   carries the `<!-- wachi:review -->` signature, because every workflow of the repository posts
   as that same account. The marker counts only as the last line of the body, right after the
   signature (`readSignedMarker`); one anywhere else is ignored. Reviews posted before signatures
   existed (marker right after `</sub>`) are read only while they come before the first signed
   review and were created before `LEGACY_CUTOFF` (2026-11-01); if that commit is behind the head, `compareFiles` narrows the review to what
   changed since (`status === "ahead"`), otherwise it reviews the whole pull request. `resolveScope`
   turns `review <paths>` words into paths: a word counts only if it is the exact name of a
   changed file or a directory prefix of one (there is no glob expansion), and any other word is
   ignored with a log line. If every word misses, the scope is empty and the request runs as an
   unscoped review (or, when the head was already reviewed, answers "Already reviewed").
   `filterFiles` then drops `DEFAULT_EXCLUDE` (lockfiles, build output, snapshots, source maps,
   generated files) plus `AGENT_REVIEW_EXCLUDE`. *Why:* paying a model to read a lockfile buys
   nothing, and re-reading commits it already saw buys less. Binary and very large files are not
   dropped here: GitHub sends no patch for them, and the prompt tells the model to read the file
   itself or record a closed skip reason (`SKIP_REASONS`). The list of changed files comes from
   GitHub's paginated pull-request files endpoint; the engine does not check that list for
   completeness, so a file GitHub leaves out is outside the review.

2. **Risk score.** `riskScore` gives each path a weight from its path alone: the highest
   matching rule in `RISK_RULES` (8 for workflows and `ipc`/`preload` directories; 7 for
   credential-like names and `scripts/`; 6 for `package.json`, shared types, migrations/schema/db,
   shell files and `infra/`; 5 for `main/`), else a base weight by `fileKind` (code 4, tests 2,
   docs, styles and message files 1). A test or a document gets its kind's weight whatever its
   path. This is a heuristic: it does not read file contents or understand a language, its rules
   were taken from the first consumer's layout, and there is no per-repository configuration.
   *Why:* when the budget runs out, the files not reached should be the ones a path convention
   says matter least. It orders the work; it does not say a file is more or less likely to be
   wrong.

3. **Batching.** `planBatches` groups files by `moduleKey` so a module's code, tests and docs share
   a call, orders modules by their riskiest file, and packs them into batches of at most
   `AGENT_REVIEW_BATCH_LINES` changed lines and `AGENT_REVIEW_BATCH_CHARS` characters of diff. A
   file over either limit gets a batch of its own. Inside a batch, code comes before tests before
   docs. The limits count changed lines and diff characters, not what fits in a model's context, and
   an oversized file is still sent whole. *Why:* a smaller batch is meant to keep the model from
   skimming, and risk order makes the budget cut-off land on the files the heuristic ranks lowest.

4. **Prompt assembly.** `buildBatchPrompt` writes, in order: the pull request and commit, the
   pointer to the ADRs, the list of every selected file for orientation (excluded files are only
   counted), the batch's own file list, the line-number convention, the review instruction, the thread
   instruction when open threads exist, the label rules (`RULES`: each severity with the test a
   finding must pass, each topic, the combination rules, and the instruction not to report that a
   decision record is edited, since the engine does that, and the evidence rules: cite the line
   behind every premise of a "blocker" or "fix" or ask it as a "question", suggest a fix only for
   the failure shown, search all callers of a shared contract, no escape clauses), the
   repository's instructions
   (`renderInstructions`, see below) and last the diff. `annotateDiff` prefixes each diff
   line with its line number in the file at the head, so a finding's `line` is one GitHub can anchor
   a thread to. The prompt goes to the provider through stdin because a large diff would exceed
   the argument-length limit. It includes the no-rationing sentence: "You do not manage a budget:
   the harness that runs you enforces its own limits, so never shorten your reading to save
   effort." The review instruction also asks the model to read a file in full before reporting a
   finding on it. *Why of the evidence rules:* in a real review the model stated a premise as fact
   that a line outside the diff's hunks disproved, and extended a correct fix to a code path whose
   comment said why it must not change; both cost the owner more than the extra reading costs.
   Findings can be judged afterwards with the verdict convention in
   [precision](precision.md). *Why of the no-rationing sentence:* the model reasons about effort it cannot see; the harness owns the budget, so
   the model should not trade coverage for it.

5. **The provider call.** `reviewBatch` writes `pr.json` and `threads.json` to a scratch directory
   and calls `deps.provider.run` asking for the neutral read tools (`read`, `glob`, `grep`;
   Claude Code gets exactly those three, Codex reads through shell commands in a read-only
   sandbox), `SCHEMA` as the output schema (files reviewed, files skipped with a closed reason, findings, thread replies,
   summary), the head as a readable directory (the adapter starts the agent in an empty scratch
   directory, not in the head) and a per-batch spend cap. Paths the agent reports are made
   repository-relative afterwards (`relativisePaths`), because it reads by absolute path. *Why:* a structured
   answer is what makes the coverage check possible; limiting the agent to reading is what keeps
   it from running commands in the process that holds the key (see the harness below; this is not
   a sandbox).

6. **Coverage check and retry.** `batchGaps` returns the files of the batch the model did not list in
   `files_reviewed`. A skip counts only with one of two closed reasons (`binary`,
   `no_diff_and_unreadable`) and only for a file GitHub sent no patch for. If there are gaps and at
   least `MIN_BATCH_USD` remains, the batch runs once more with only those files (`retry: true` in
   the prompt); a batch whose first call returned nothing usable has all its files as gaps, so it
   is retried the same way. Files still unaccounted for after that make the review partial: its
   first line says "Partial review", counts the files and lists the ones not reviewed.
   Coverage is therefore the model's own report checked against the selected files. It shows the
   model claimed to cover every selected file; it is not a measurement of how much of a file was
   read, and the engine has no way to observe reads. The expected set holds only the selected
   files: lockfiles and other excluded files, files outside a requested scope and files missing
   from GitHub's list are not in it, so "all N files reviewed" means all N selected files.
   *Why:* silence about a file is the failure that cannot be seen from the outside, so the code
   asks again once and then reports honestly what the model did and did not claim.

7. **Budget arithmetic.** `review` tracks `spent` across one invocation, adding up the first
   calls and retries of every batch. Each call is capped at `min(AGENT_REVIEW_BATCH_BUDGET_USD,
   remaining)`. A batch is not started when less than `MIN_BATCH_USD` (0.05) remains; its files are
   listed as "not reached: the pull request's budget was spent". `attempt` catches a call that
   died without a result and counts it at its cap, because what it spent is unknown. The budget is
   per run, not per pull request over time: every new `review` run starts again at zero, so an
   automatic review plus later `/wachi review` runs each spend up to their own total. How firmly a
   cap is enforced depends on the adapter. Claude Code receives `--max-budget-usd`, a soft cap that
   can be overshot, so `spent` can exceed the total slightly. The Codex adapter is handed the cap
   but does not enforce it: it estimates cost from token events using a built-in or overridden
   price, and only a 15-minute `SIGKILL` timeout (reported as `budget`) ends a runaway call. A dry
   run still calls the provider and spends. If no batch returned a result and a call ended on its
   budget, the review is a short body saying so; if none returned a result for another reason, the
   run fails with an error and posts nothing. *Why:* money, not pull request size, bounds the run,
   and an unknown cost is assumed to be the worst case. See [costs](costs.md) for what that means
   for a bill.

8. **Merge and posting.** `mergeOutputs` joins the batches: `dedupeFindings` keeps one finding
   per path, line and topic (the higher severity wins, blocker > fix > consider > info), it merges
   skips, and treats a file reviewed in a retry as reviewed. `adrNotices` then adds one
   `⚪🏛️ Info · adr` finding for every reviewed file under a `docs/adr/` directory, deduplicated with
   the model's findings the same way. `buildReview` labels each finding with `label` (two emojis,
   then severity, topic and title in words, from the `SEVERITY` and `TOPIC` tables, the only place
   the emojis live), turns findings on commentable lines (`commentableLines`: added and context
   lines of the patch) into inline comments, puts the rest under "Outside the diff", and puts every
   `info` finding under "For your information", never inline, because information needs no reply.
   The count line (`countLine`) reads "N finding(s): B blocker(s), F to fix, C to consider" and
   omits empty groups.
   Every comment the engine posts (review body, inline finding, thread reply, answer, notice)
   starts with `BRAND` ("👮 **Wachiman**") on its first line: reviews post as
   `github-actions[bot]`, whose name and avatar do not say which tool wrote them (ADR 0005).
   It writes a first line saying whether coverage is complete or partial, the summary, a "Coverage
   by batch" table, a footer with the model label, batch count and cost, and, only for a complete,
   unscoped review, the marker for the next incremental run. Every piece of model text (summary,
   finding titles and bodies, thread replies, answers) and every repository-controlled string
   (file names in the lists and the moved findings, batch labels, skip reasons) goes through
   `neutralise`, which turns `<!--` and `-->` into entities, so neither the model nor a file name
   can write a marker or a signature. The engine
   adds the signatures itself: `<!-- wachi:review -->` in the review body, `<!-- wachi:finding -->`
   in each inline comment, `<!-- wachi:reply -->` in each thread reply. The body is kept under
   `MAX_BODY_CHARS`, shortening only the list of unreviewed files (`fitList`). `refuseLeak` asks
   the provider's `leaksSecret` about every piece of text about to be posted and aborts the
   whole post if one matches. `postReview` sends one review with `event: "COMMENT"`. `gh` failures
   are `GhError`s carrying the HTTP status, GitHub's message and the `errors` array of the response
   (`parseGhFailure`). A 422 saying "An internal error occurred, please try again", at the top
   level or in `errors[].message` under a generic "Validation Failed", is transient: the same
   review is retried after 1 s and 3 s. Each `postReview` call adds a unique
   `<!-- wachi:attempt id=… -->` line as the last line of the body, and before each retry the
   engine looks for a `github-actions[bot]` review carrying that id, because the POST may have
   landed; an older review of the same commit does not count. Only a validation 422 (a line
   GitHub cannot anchor) makes `moveCommentsToBody` post the comments in the body: it reserves
   room for the heading and an "N more not shown" note, cuts the list to fit and, if the rest of
   the body is near the limit, trims the Summary and coverage table first, so the result never
   exceeds `MAX_BODY_CHARS`. Any other error (auth, permission, rate limit, network) is rethrown:
   no degraded review is posted. Replies to
   open threads are posted only for comment ids the engine itself handed over; each is a separate
   POST after the review, so if one fails the command stops with an error although the review is
   already posted. *Why:* the model
   cannot approve, request changes, invent a thread id or move the incremental marker past a file
   nobody read.

9. **The conversation path.** `comment` (called by `src/cli.ts comment`) first runs
   `operatorProblem` (an empty or template-placeholder operator is an error), then ignores a
   comment whose author is not `AGENT_REVIEW_OPERATOR`, then `parseCommand` looks in the first
   matching line for the mention (the configured one, `/wachi` by default, or one of
   `MENTION_ALIASES`: `/wachiman`, `@agent-review`, `@claude`; the keyword must start a word).
   `review [paths]` runs the pipeline above; anything else goes to `answer`: one provider call
   with `AGENT_REVIEW_ANSWER_BUDGET_USD`, free-text output, the pull request metadata, file list
   and full diff in a scratch directory, the same leak check, posted as a pull request comment. It
   has no batching, no coverage check and no thread handling.
   *Thread replies.* They are handled only inside a `review` run, not as a conversation. With a
   previous marker, `openThreads` fetches the tool's unresolved threads (first 100 threads, first
   30 comments each; first comment by `github-actions` and carrying the finding signature, or,
   before `LEGACY_CUTOFF`, an unsigned comment in the old label format created before that date)
   and `openBotThreads` keeps only replies from `OWNER`, `MEMBER` or `COLLABORATOR`, so a
   stranger's reply on a public repository never reaches the model. `assignThreads` hands each
   thread to the batch that holds its file, and the model may answer with "Looks addressed" or
   "Still open". Nothing triggers on a thread reply itself (the caller listens to
   `issue_comment`, not to review comments), and a `review` on a head that was already reviewed
   returns "Already reviewed" before threads are read. So a reply in a thread gets an answer only
   at the next review run that has work: a new commit since the last marker, or an explicit
   path. The engine never resolves a thread. *Why:* the operator gate is enforced twice (workflow
   and CLI) because only one of them can fail loudly.

## The execution harness

`.github/workflows/review.yml` is a reusable workflow (`workflow_call`) with two jobs.

| Job | Runs when | What it does |
| --- | --- | --- |
| `review` | `pull_request`, not a draft, head repository equals the calling repository, actor is not Dependabot | Checks the operator input, skips branches with a prefix in `skip_branch_prefixes`, then runs `cli.ts review` |
| `on-demand` | `issue_comment` on a pull request, commenter login equals `operator`, body contains the mention input, `@agent-review` or `@claude` | Checks the operator input, refuses a pull request whose head repository is not the calling repository, then runs `cli.ts comment` |

Both have a 30-minute timeout and their own concurrency group per pull request with
`cancel-in-progress: true` (the groups are per job, not per workflow, so a skipped `on-demand`
never cancels a review; a newer run of the same job for the same pull request cancels the older
one). Both run with `contents: read` and `pull-requests: write` (`issues: read` for `on-demand`).

When a run starts is decided by the caller. The caller template listens for `pull_request` of
type `opened` and `ready_for_review`, and `issue_comment` of type `created`, so a pull request
gets one automatic review when it is opened or marked ready, and later pushes are reviewed when the
operator asks for it.

**The command gate.** The parser accepts `/wachiman` as an alias, but the workflow's `if:` only
tests that the comment body contains the `mention` input, `@agent-review` or `@claude`. With the
default `/wachi`, a `/wachiman` comment passes the gate because `/wachi` is a substring of it. With
a custom `mention` that does not contain `/wachiman`, a `/wachiman` comment does not start the
job. Use the configured mention as the command that always routes.

**Sibling checkout layout.** The head goes into `head/` with `persist-credentials: false`. The
engine goes into `engine/`, checked out from `job.workflow_repository` at `job.workflow_sha`, so
the engine version always equals the called workflow's version. Bun is started with `engine/` as
its working directory:

```
bun --no-env-file --config=bunfig.toml src/cli.ts review "$PR" --repo-dir "$GITHUB_WORKSPACE/head"
```

*Why:* Bun reads `bunfig.toml` (whose `preload` runs code) and `.env` from the working directory.
If the head were the working directory, a pull request could run code, or point
`ANTHROPIC_BASE_URL` at another host, inside the process that holds the key. With `engine/` as the
working directory, `--no-env-file` and `--config=` (the engine's own minimal `bunfig.toml`; write
it with the equals sign, `-c <path>` did not replace the working directory's config in Bun 1.3.4),
nothing from the head is loaded. `test/bun-isolation.test.ts` checks this with a hostile fixture.

**Environment.** The workflow passes inputs to the engine as `AGENT_REVIEW_*` variables and the
comment text as `REQUEST`; untrusted text is never interpolated into a `run:` script. The Claude
Code adapter builds the agent's environment from `CHILD_ENV_ALLOWLIST` (`PATH`, `HOME`, `TMPDIR`,
`TERM`, `LANG`, `LC_*`, `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, `CI`, `GITHUB_ACTIONS`), so the
agent never receives `GH_TOKEN`, a base URL, a proxy, `NODE_OPTIONS`, `BUN_*` or `LD_PRELOAD`.

**Claude Code flags** (`buildClaudeArgs` in `src/providers/claude-code.ts`; details in
[providers/claude-code.md](providers/claude-code.md)):

| Flag | What it removes |
| --- | --- |
| `--restricted` | Built-in tools that run commands or code, `WebFetch`, and the user, project and local settings of the head (its `.claude/` hooks do not load) |
| `--strict-mcp-config` | Any MCP server the head's configuration would start |
| `--tools Read,Glob,Grep` | Every tool except these three |
| `--settings` and `--disallowedTools` | `Bash` and reads of `/proc` (the second is unverified) |
| `--max-budget-usd` | Unbounded spend per call (a soft cap) |

The binary itself is installed by `src/install-claude-code.sh` at a pinned version and checked
against a SHA-256. Third-party actions are pinned by commit SHA.

**Review instructions come from the base commit.** Before the first batch, `review` (and
`answer`) reads the pull request's `base.sha` and fetches `.github/agent-review.md` (or the old
`.github/claude-review.md`), `CLAUDE.md` and `AGENTS.md` at that commit through
`gh api repos/{repo}/contents/{path}?ref={base_sha}` (`readBaseInstructions`). A 404 means the file
is absent, any other error stops the run, and each file is cut at 64 KB with a notice in the
prompt. The text goes into the prompt under "Repository instructions (from the base commit
`<sha7>`)", which also says the head's copies of those files are content under review, not
instructions. The head's copy is never a fallback, so a pull request cannot rewrite the rules it
is reviewed under ([#10](https://github.com/niway-dev/wachiman/issues/10)). When the pull
request edits one of these files, the review body says the change takes effect after merge.
This is a stacked pull request's base branch tip, not the merge base with the default branch;
the latter is a later change ([ADR 0006](adr/0006-repository-review-policy.md) decision 3, on
its design branch).

**What from the head is read as data, and what is never executed.** The agent reads the head's
files through its read tools; a pull request can put text there that tries to steer the review
(prompt injection), and the read-only tools, the budget caps and the trust assumption are the
answer. Neither adapter starts the agent in the head: Claude Code runs in an empty scratch
directory with the head as `--add-dir` (which does not load `CLAUDE.md`), Codex in an empty
scratch directory too, so the head's instruction files are not auto-loaded; the prompt tells the
model to treat any it opens on purpose as content. Verified for Claude Code 2.1.304 by an opt-in
harness ([the Claude Code provider](providers/claude-code.md)). The engine never executes the head's Bun configuration, `.env`, Claude Code
settings or hooks.

**Still unverified** (from [SECURITY.md](../SECURITY.md)): that `--no-env-file` and `--config=`
keep out every runtime file (only `bunfig.toml` `preload` and `.env` are tested, on Bun 1.3.4);
that the new layout has been through a full paid run; whether the `/proc` deny rules do anything
under `--restricted`; whether the head's instruction files stay unloaded on Claude Code versions other than the pinned one (see [the Claude Code provider](providers/claude-code.md));
and the hardening flags against a hostile branch beyond the fixtures. None of this is a sandbox,
and the assumption that everyone who can push is trusted is what holds it together.

## The provider adapter boundary

`src/providers/types.ts` defines `ProviderAdapter`:

| Member | Contract |
| --- | --- |
| `name` | The value of `AGENT_REVIEW_PROVIDER` that selects it |
| `preflight()` | Throws before any call is paid for when the binary, settings or credential is missing |
| `modelLabel()` | Text for the review footer |
| `leaksSecret(texts)` | True when any text holds a credential of this provider; the engine throws and posts nothing |
| `run(request)` | One call to completion: returns structured output or text, cost, turns, duration and a terminal reason (`success`, `budget`, `error`); throws when there is no result at all |

The request carries the prompt, the head's directory (which an adapter must not use as the agent's working directory), extra readable directories, neutral tool
names (`read`, `glob`, `grep`), the spend cap (a soft one), an optional output schema and whether the prompt
goes through stdin. `getProvider` in `src/providers/index.ts` maps a name to an adapter and
rejects unknown names as a usage error.

Engine-owned: filtering, risk, batches, retries, coverage, budgets, posting, threads. Adapter-owned:
the binary and its flags, the settings file, the child environment, tool-name mapping, cost and
terminal-reason extraction, the credential shape.

**Rule for a second provider.** It is added only when a consumer needs it or a measured comparison
is wanted, and it must bring its own hardening story, with the tests that back it, its own
structured-output path and its own cost accounting. The two adapters differ: Claude Code has no
shell tool, while Codex reads through shell commands inside its read-only sandbox and has no
per-call spend cap ([Codex adapter](providers/codex.md)).
There is no plugin system. The interface is drawn from one example, so expect to redraw it when
the second adapter does not fit.

## Configuration

Settings are read once by `loadConfig` in `src/config.ts`; each `AGENT_REVIEW_X` falls back to the
deprecated `CLAUDE_REVIEW_X` with a notice. The variables, their defaults and the workflow inputs
that set them are listed in [configuration.md](configuration.md), the one home for defaults, and
[cli.md](cli.md) describes the command line. This page does not repeat them.

The built-in exclude list (`DEFAULT_EXCLUDE`), risk rules (`RISK_RULES`), label rules (`RULES`,
`SEVERITY`, `TOPIC`), the output schema (`SCHEMA`) and `MIN_BATCH_USD` are constants in
`src/engine.ts`, not settings.

When the engine runs through the reusable workflow, the workflow always passes its inputs, so the
workflow defaults are the ones consumers get; the `src/config.ts` defaults apply to direct CLI use
and the copy-the-files install. The two sets must stay equal.

## Invariants a change must keep

- No `pull_request_target` trigger, anywhere, and no caller template that adds one.
- No `secrets: inherit`: the caller passes `ANTHROPIC_API_KEY` explicitly.
- Fork pull requests never run: the `review` job checks the head repository, the `on-demand` job
  checks it before it reads the head.
- Untrusted text (a comment body, a branch name, a pull request title) is never interpolated into
  a `run:` script; it goes through `env:`.
- The model never approves or requests changes. The review event is always `COMMENT`.
- The incremental marker is written only when the review is complete and unscoped, that is, when
  every file is accounted for.
- Model text is neutralised (`neutralise`) before it is posted, and ownership of a review or a
  thread is the `github-actions[bot]` login plus an engine-written signature, never the login
  alone. The unsigned legacy branches (`lastEngineMarker`, `isWachiFinding`, `precision.ts`) are a
  deprecation window for items created before `LEGACY_CUTOFF` (2026-11-01); an unsigned item created
  at or after it is treated as another workflow's imitation. Delete the branches once the date has
  passed.
- The reviewed head is never the engine's working directory, and the engine never executes
  anything from it.
- The agent gets no GitHub token and an allowlisted environment. Claude Code gets read tools only;
  Codex reads through shell commands inside a read-only sandbox (the reusable workflow does not
  install Codex).
- Budgets and batch sizes come from the caller's inputs or the environment, never from the pull
  request.
- Only the operator can start an on-demand run, and only replies from `OWNER`, `MEMBER` or
  `COLLABORATOR` reach the agent.
- Text containing the key or something shaped like one is not posted.
- Third-party actions stay pinned by full commit SHA, and the Claude Code binary stays pinned and
  hash-checked.

## Known limits and open issues

What this page cannot promise, in the order a reader is most likely to rely on it:

- **Coverage is reported by the model.** The engine checks the model's list of files reviewed
  against the files it selected. It cannot confirm that every line was read, and it does not
  verify that GitHub's file list was complete. Excluded files and files outside a requested scope
  are not part of "all files reviewed".
- **Risk order is a path heuristic.** It decides which files are read first when money runs out.
  The rules fit some layouts (`apps/*/src`, `ipc`, `preload`, `main`) better than others and are
  not configurable per repository. The decision-record directory the prompt names, `docs/adr/`, is
  fixed too ([#5](https://github.com/niway-dev/wachiman/issues/5)).
- **Spend caps are per call and soft.** Claude Code's cap can be overshot, Codex has no dollar cap
  (only a 15-minute timeout), a dry run still spends, and each run has its own total
  ([costs](costs.md)).
- **Thread replies are not a conversation.** A reply is answered only during a later review run
  that has work; nothing triggers on the reply, and `answer` never reads threads.
- **`/wachiman` routing.** It always parses, but the workflow gate routes it only with the default
  mention (see the command gate above).
- **An on-demand answer** is one call over the whole diff with no batching or coverage check.
- **Trust.** The review trusts everyone who can push to the repository
  ([SECURITY.md](../SECURITY.md)). Posted output is checked only for the key's exact value and
  for strings shaped like a provider key, so an encoded key passes
  ([#11](https://github.com/niway-dev/wachiman/issues/11)). One account with repository admin
  rights can move the floating `v1` tag and so change the code every `@v1` consumer runs with its
  key ([#8](https://github.com/niway-dev/wachiman/issues/8)); exact tags are protected by a
  ruleset that has an admin bypass ([releasing](releasing.md)).
- **Providers.** Two adapters exist, Claude Code and Codex ([ADR 0004](adr/0004-codex-provider.md)).
  The reusable workflow installs only Claude Code.
- **Unverified.** [SECURITY.md](../SECURITY.md) lists what has not been verified, including that
  the sibling-checkout layout and the hardening flags have been through a full paid review. This
  page does not claim more than that list.

Planned work is not in the code described above: ADRs
[0006](adr/0006-repository-review-policy.md), [0007](adr/0007-learned-memory-by-draft-pr.md),
[0008](adr/0008-thread-follow-up-authority.md) and
[0009](adr/0009-investigation-is-requested-by-the-model-and-admitted-by-the-engine.md) are
proposals with their specs in `docs/specs/`. Actions in this repository's own workflows are
pinned by commit SHA ([#9](https://github.com/niway-dev/wachiman/issues/9) is closed), and review
instructions come from the base commit ([#10](https://github.com/niway-dev/wachiman/issues/10) is
closed).
