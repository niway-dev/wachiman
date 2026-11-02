# Working with reviews

How to ask Wachiman for the review you want, read what it posts, and answer it. This page
describes what `v1.3.0` does today, including the places where the behaviour is narrower than
you might expect. Setup is in [install.md](install.md); every setting is in
[configuration.md](configuration.md); what a review costs is in [costs.md](costs.md).

**A review is advice.** Wachiman posts a GitHub review with the event `COMMENT`. It never
approves, never requests changes and never blocks a merge, including when a finding is labelled
"Blocker". That label is a recommendation to the author, not a status GitHub enforces.

## Ask for a review

| What you do | What happens |
| --- | --- |
| Open a pull request, or mark a draft ready for review | The automatic review runs. |
| Push more commits | Nothing. A push does not start a review. |
| Comment `/wachi review` (as the operator) | A review of what is new since the last complete review, or of the whole pull request if there is none. |
| Comment `/wachi review <path> [path…]` | A review of only those paths. See [Limit a review to some paths](#limit-a-review-to-some-paths). |
| Comment `/wachi` followed by anything else | The comment is treated as a question and answered. See [Ask a question](#ask-a-question). |

Rules that apply to all of them:

- **Only the operator can start a run by comment.** The operator is the one GitHub login you set
  as `operator` in the caller workflow. A comment from anyone else does nothing.
- **The automatic review skips** draft pull requests, pull requests from forks, Dependabot's pull
  requests and head branches that start with a skipped prefix (default `release-please--`).
  These checks apply only to the automatic review. A comment from the operator also works on a
  draft or on a skipped branch; it is refused only for a fork.
- **The keyword.** The default is `/wachi`. `/wachiman`, `@agent-review` and `@claude` are
  accepted as well. The keyword must start a word (`docs/wachi` is not a command), it is
  matched case-sensitively (`/Wachi review` is ignored), and it can be on any line of the
  comment. Only the rest of that line is read for `review` and paths.
- **A comment that contains the keyword is a command.** If the word after it is not `review`,
  the comment becomes a question and spends a model call. A bare `/wachi` is treated the same
  way.
- **If you set a custom `mention`, use it.** The workflow decides whether to start a job by
  looking for your `mention`, `@agent-review` or `@claude` in the comment. The engine also
  understands `/wachiman`, but the workflow does not look for it on its own: with
  `mention: /reviewbot`, a comment with only `/wachiman review` never starts a run. With the
  default `/wachi`, `/wachiman review` works, because the text contains `/wachi`.
- **A new comment cancels an unfinished one.** Two on-demand runs on the same pull request do
  not run side by side: starting the second cancels the first if it is still running.
- **First install.** The pull request that adds the caller file gets only the automatic review.
  Commands become available once the caller file is on the default branch, including on existing
  open pull requests. See [install.md](install.md).

## Read a review

One review has up to three parts: a summary in the review body, inline comments on lines of the
diff, and a footer. Everything the engine posts starts with "👮 **Wachiman**" and comes from the
`github-actions[bot]` account, because that is who GitHub says posted it. The name is plain text;
the avatar does not identify the tool.

**Illustrative review.** The layout below follows what the engine's formatter produces; the
content and amounts are invented. It is not a recorded review.

```text
👮 **Wachiman** · review of the changes since `a1b2c3d`, at `e4f5a6b`: all 3 files reviewed.

2 finding(s): 1 to fix, 1 to consider; 1 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡🧪 **Consider · tests: No test for the empty list** (`src/page.ts`): …

### Summary

…

▸ Coverage by batch (collapsed table: batch, files, lines, highest risk, status, turns, cost)

Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.42
```

An inline finding, on its line in the diff, looks like this:

```text
👮 **Wachiman** · 🟠🐛 **Fix · bug: Zero limit breaks the page count**

…the reasoning, citing the lines it rests on…
```

### The two labels on a finding

Every finding has a **severity** (when the author should act) and a **topic** (what it is about).
Any severity can go with any topic. The decision is [ADR 0003](adr/0003-two-axis-finding-labels.md);
the contract is in [cli.md](cli.md#finding-labels).

| Severity | Meaning |
| --- | --- |
| 🔴 Blocker | Fix before merging. The reviewer can name the input, state or trust boundary that fails. |
| 🟠 Fix | Wrong today. Fix it in this pull request; it does not block the merge. |
| 🟡 Consider | Would be better. The author may decline. |
| ⚪ Info | Nothing to change. Awareness only. |

| Topic | About |
| --- | --- |
| 🐛 bug | The code does the wrong thing for some input or state. |
| 🔐 security | Credentials, user data, or a trust boundary the change weakens. |
| 📜 rules | A violation of `CLAUDE.md`, `AGENTS.md` or a repository convention. |
| 🏛️ adr | A change that contradicts a decision record, or the notice that one is edited. |
| 📝 docs | Documentation or comments that are stale or contradict the code. |
| 🧪 tests | Missing coverage, or a test that does not test what its name says. |
| ⚡ perf | Cost, latency, repeated work, N+1 queries. |
| 🧹 cleanup | Duplication, dead code, a misleading name. |
| ❓ question | Something the reviewer could not determine and asks the author. |

These are the only labels. A repository's instructions cannot add one
([review-policy.md](review-policy.md)).

### Where each finding appears

- **Inline, on its line.** A "Blocker", "Fix" or "Consider" finding on a line that is part of the
  diff (an added or unchanged line shown in a hunk). This is the only place you can reply to it.
- **"Outside the diff", in the review body.** A finding about a whole file, or about a line the
  diff does not show. It has no thread.
- **"For your information", in the review body.** Every "Info" finding goes here, never inline,
  because information asks for no reply. The engine adds one "Info · adr" notice itself for each
  reviewed file under a `docs/adr/` directory ("Edits an accepted decision record").
- **If GitHub refuses the inline comments**, the engine posts them in the body under "On their
  lines (GitHub refused them inline)" instead, and says so. That only happens for a validation
  error. Other failures stop the run and post nothing.

Two reports of the same problem on the same file, line and topic are shown once, at the higher
severity.

### The count line and the footer

The count line says how many findings there are and how many are Blockers, to fix or to consider.
"Info" findings are in the total but have no group of their own.

The **model, effort, number of batches and cost are in the footer of the review body** (`Claude
Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.42`). Releases up to v1.3.0 do
not print the effort. The batch count appears only when there was more than one batch. Inline comments carry no footer and no cost. The cost is what the provider reported
for the calls of that run (for Codex, an estimate from token counts), and a call that died
without a result is counted at its cap. See [costs.md](costs.md).

## Coverage: what "reviewed" means

The first line of the review says whether everything was covered:

- Complete: "review of the changes since `a1b2c3d`, at `e4f5a6b`: all 3 files reviewed."
- Partial: "⚠️ **Partial review**: the agent reviewed 3 of 4 files … Not reviewed: … Ask
  `/wachi review <paths>` for the rest."

Read the number as "files in this run", not "files in the pull request":

- **Excluded files are not counted.** Before anything is read, the engine drops lockfiles (`*.lock`,
  `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), build output (`dist/`, `build/`, `out/`),
  minified files, source maps, snapshots, `*.generated.*` files and `worker-configuration.d.ts`.
  "All files reviewed" does not include them. The exact list is `DEFAULT_EXCLUDE` in
  `src/engine.ts`. The reusable workflow cannot add to it.
- **A scoped review counts only its paths.** Its first line still says "the whole pull request",
  and the count is the number of scoped files that ran.
- **Coverage is reported by the model.** The engine asks the model to list the files it reviewed
  and checks that each file of the batch is listed. It cannot measure which lines were actually
  read. A file with a diff may not be skipped; only a file GitHub sent no diff for (binary, or too
  large) may be skipped, and only with the reason `binary` or `no_diff_and_unreadable`.
- **A file that is unaccounted for gets one retry**, in a second call with only those files, if
  budget remains. What is still missing after that is listed under "Not reviewed". A file the
  budget never reached is listed with the reason "not reached: the pull request's budget was
  spent".

The **Coverage by batch** table (collapsed under the summary) shows each batch's files, changed
lines, highest risk score, status, turns and cost. Statuses include "reviewed", "reviewed after a
retry", "N file(s) left after a retry", "ran out of its budget", "the call failed" and "not run:
budget spent".

If every batch ran out of its budget before finishing, the review is a short body saying so and
nothing was reviewed reliably. Ask for part of it with `/wachi review <path>`.

## Batches, and what "riskiest first" means

The engine does not hand the whole pull request to the model in one call. It cuts the reviewable
files into **batches** and makes one provider call per batch, one after another.

1. **Group by module.** Files that share a directory prefix (the first directory; more segments
   under `apps/` and `packages/`) are kept next to each other.
2. **Order by a risk score.** Each file gets a score from its path, and modules are ordered by
   their highest-scoring file, highest first. Inside a batch, production code comes before tests,
   and tests before documentation.
3. **Pack.** Files fill a batch until it would pass 1,000 changed lines or 140,000 characters of
   diff (both settable). A single file over either limit gets a batch of its own; it is not
   split. A module bigger than one batch spans several.

"Riskiest first" is a **path heuristic**, and nothing more:

- The score comes only from the file's path and kind. Workflows, process boundaries (`ipc`,
  `preload`), names that suggest credentials or access control, scripts, `package.json`,
  migrations and schemas, shell files and infrastructure score high. Other code scores 4, tests
  2, documentation and styles 1, whatever their path. The rules are listed in
  [architecture.md](architecture.md).
- It does not read the code. It cannot tell that an innocent-looking file holds the dangerous
  change, and the defaults were taken from one project's layout (`ipc`, `preload`, `main`,
  `apps/<name>/src`). Repositories laid out differently get a less useful order.
- It is not configurable from the reusable workflow. Changing it means editing the engine.
- It decides **order, not care.** A low-scoring file is read with the same prompt as a high one.
  The order matters when the budget runs out: the batches that did not run are the lowest-scoring
  ones.

## Re-review: what a second `/wachi review` covers

| The operator comments… | …and the engine does |
| --- | --- |
| `/wachi review`, a complete review exists, the head moved ahead of it | Reviews only the files that changed since the commit of the last complete review. The first line says "changes since `…`". |
| `/wachi review`, no complete review yet | Reviews the whole pull request. |
| `/wachi review`, head unchanged since the last complete review | Posts "Already reviewed at `…`. Push changes, or ask `/wachi review <paths>`." No model call. |
| `/wachi review`, the last reviewed commit is no longer behind the head (for example after a force-push that rewrote it) | Reviews the whole pull request again. |
| `/wachi review`, but every changed file is excluded | Posts "Nothing to review at `…`", saying the files are lockfiles, build output, generated, or outside the requested paths. |

Only a **complete, unscoped** review moves the starting point for the next one. A partial review
or a scoped review does not, so after either, the next plain `/wachi review` starts from the last
complete one and covers everything since, including files the partial or scoped review already
read. A pull request that always comes back partial therefore keeps being reviewed from the same
older commit.

## Limit a review to some paths

`/wachi review src/billing docs/pricing.md` reviews only those paths.

- A path is **an exact file name or a directory prefix**, as GitHub lists the changed files
  (`src/billing` or `src/billing/`). Globs (`src/**`), a leading `./` and a trailing slash on a
  file name match nothing.
- The path must name a file **changed by the pull request**. Anything else after `review` is
  ignored without an error, so "again" or "please" does no harm.
- A scoped review covers those files' full change in the pull request, not only what is new since
  the last review.

**Check what you typed.** If none of the words after `review` name a changed file, the engine
does not refuse: it runs an unscoped review instead. A mistyped path therefore starts a full
incremental review and spends budget on it. (If the head has not moved since the last complete
review, you get "Already reviewed" and nothing is spent.) The ignored words are written to the
job log, not to the pull request.

A scoped review is also how you ask for the files a partial review left out: the partial review's
first line gives the command, with the files it did not reach.

## Reply to a finding

Each inline finding is a normal review thread. You can reply to it, and Wachiman can answer, but
**a reply does not start anything by itself.**

- The caller workflow listens to `pull_request` (opened, ready for review) and `issue_comment`
  (created). A reply inside a review thread is neither, so nothing runs when you post it.
- Wachiman reads threads only **during a later review that has work to do**: a `/wachi review` that
  reaches the model, either because new reviewable files changed since the last complete review or
  because you named paths in the pull request. It also needs a previous complete review to exist.
- If the head has not moved and you ask for a plain `/wachi review`, you get "Already reviewed"
  and the replies wait. If there is nothing reviewable in the change, you get "Nothing to review"
  and they wait as well. There is no command that only answers replies; the closest is a scoped
  review of a small file, which carries the open threads along with it.

When a review does read threads:

- **Which threads.** The pull request's first 100 review threads, with at most 30 comments each,
  that are unresolved and whose first comment is a Wachiman finding. Threads on files outside the
  run are handed to the first batch.
- **Which replies the model sees.** Only replies from people GitHub marks `OWNER`, `MEMBER` or
  `COLLABORATOR`. A stranger's reply on a public repository is dropped before the model reads
  anything. See [SECURITY.md](../SECURITY.md).
- **What it does with them.** The model decides, for each thread, whether the current code
  addresses the finding, and may post a short reply, "Looks addressed" or "Still open", with the
  commit it checked. It does so even for a thread nobody replied to, and it may leave a thread
  without a reply. It can answer only threads the engine handed over.
- **What it never does: resolve a thread.** You resolve threads yourself. A resolved thread is
  not read again, which is also how you stop it from coming back.

Replies posted after the review itself appear in the thread as
`👮 **Wachiman** · **Still open** at `e4f5a6b`: …`.

[ADR 0008](adr/0008-thread-follow-up-authority.md) proposes more (the operator's `Verdict:` reply
resolving a thread, a cap of two replies per thread, follow-up even when no file changed). It is
marked proposed and is not implemented. None of that happens today. The `Verdict:` replies that
[precision.md](precision.md) counts are read by that script only, not by the engine.

## Ask a question

A comment from the operator that contains the keyword but does not continue with `review` is
answered as a question:

```text
/wachi why does the retry loop ignore the budget?
```

- It makes **one model call** over the whole diff, with the pull request's title and body and the
  repository's instructions ([review-policy.md](review-policy.md)). Its budget is
  `answer_budget_usd` (default `$1`).
- The model's **whole message is posted** as one pull request comment, with a footer showing the
  model and cost. The engine adds no batching and no coverage check, so a very large diff is not
  guaranteed to be read in full.
- The **entire comment text** is the question, not only the line with the keyword.
- It does not read review threads, and answers in English.

## What a review will not tell you

- It is not a substitute for CI or for a human. Findings can be wrong. How to measure how often
  is in [precision.md](precision.md); this documentation states no accuracy figure.
- "All files reviewed" means the model said it reviewed each file the engine selected. See
  [Coverage](#coverage-what-reviewed-means).
- Nothing here changes who may merge. Branch protection, required reviews and required checks
  stay yours to configure.
- Problems with the run itself (no review appeared, a red job) are in
  [troubleshooting.md](troubleshooting.md).
