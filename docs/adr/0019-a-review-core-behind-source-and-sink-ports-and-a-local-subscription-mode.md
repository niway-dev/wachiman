# ADR 0019: A review core behind source and sink ports, and a local mode on the developer's own subscription

- **Status:** proposed 2026-11-03. **Nothing is implemented.** The extraction, the connector, the
  sinks and the `local` command are described in the spec and do not exist on any branch. Amends
  [ADR 0001](0001-distribution-and-trust.md) decision 7 (the provider adapter was the only
  boundary) and its trust model (which assumed a CI job holding an API key).
- **Date:** 2026-11-03
- **Spec:** [2026-11-03-local-review-design.md](../specs/2026-11-03-local-review-design.md)
- **Issue:** [#103](https://github.com/niway-dev/wachiman/issues/103)
- **Evidence:** [research 2026-11-03](../research/2026-11-03-greptile-skills-and-local-review.md)
  (terms, data and telemetry facts; the diff parity probe: `git diff -M --inter-hunk-context=1
  base...head` reproduced GitHub's patches on 1,397 files of 64 pull requests).
- **Numbering:** 0014 and 0015 are reserved by #80, 0017 and 0018 by #90, so this record is 0019.

## Context

Wachiman reviews pull requests from a GitHub Actions job that holds an API key. The owner wants to
run the same review on an employer's code from a laptop, signed in to the unmodified `claude`
binary with a personal subscription, with nothing posted and no telemetry: a local tool is far
easier to get approved than a CI job and a key, and permission for exactly that was granted on
2026-11-03.

`review()` in `src/engine.ts` reads the change from GitHub (`gh pr view`, the files list, the
marker, the compare API, the threads), plans and runs the batches, and posts the result. The only
seam is the provider adapter (ADR 0001 decision 7). Everything between filtering and posting is
already source-neutral, but it is reachable only through a pull request number and a `gh`
function. A local review would have to fake `gh`, which keeps every pull request assumption, or
duplicate the pipeline, which lets the two drift.

The same cut answers a second request: other git hosts. A GitLab or Gitea connector needs to feed
the pipeline per-file diffs from a different API and post the result somewhere else; it has no
need to change how a batch is reviewed.

Claude Code's terms (checked 2026-11-03) allow an end user to sign in to the unmodified binary with
their own subscription and forbid third parties from routing requests through those credentials or
intermediating tokens. A personal Pro or Max account is under Consumer terms (training setting,
retention), a Team or Enterprise account under commercial terms. `ANTHROPIC_API_KEY`, when present,
is what `claude -p` bills.

## Decision

1. **A review core behind two ports.** `reviewChange(input, options, deps)` takes a neutral,
   versioned `ReviewInput` (`wachiman.review-input/1`) and returns a versioned `ReviewResult`
   (`wachiman.review-result/1`). It contains filtering, scope, risk, batching, instructions
   rendering, evidence, data-path questions, prompt assembly, the provider call, output checks,
   coverage and retry, budget arithmetic, merging, the confidence rule, dedupe and the ADR
   notices. It has no `gh` dependency. The pattern is the hub's
   [ports and adapters](https://github.com/csdev19/general-knowledge/blob/main/architecture/domain-layer-contracts.md);
   this record documents only its application.
2. **Source connectors produce the input.** `github` is today's path (`gh pr view`, the files
   list, instructions through the contents API, the incremental and rebase logic, the threads).
   `local-git` is new: it reads the clone, computes `merge-base(base, HEAD) → HEAD` with
   `git diff -M --inter-hunk-context=1`, reads the instructions from the merge-base commit (ADR
   0006, same rule), and snapshots `HEAD` into a temporary directory that the diff, the agent's
   reads, the evidence and the citation checks all share. The local connector needs no host and
   so serves every host; host API connectors (GitLab, Bitbucket, Gitea) are a non-goal here, and
   the format carries only fields they can fill, with blob SHAs, title, description, author and
   conversation optional.
3. **Sinks consume the result.** GitHub posting (`buildReview`, `refuseLeak`, `postReview`, the
   reply POSTs) is today's and is unchanged in output. Terminal and Markdown file are new; the
   Markdown report holds every finding and ends with a copy-paste prompt for the developer's own
   agent. The JSON sink writes the result as is and ships in the same slice (decision 9).
4. **The provider stays the Claude Code adapter**, with an explicit `auth: "subscription"` mode
   for local runs: it refuses to start when `ANTHROPIC_API_KEY` is set, strips it from the child
   environment, passes `USER` (without it, `claude -p` on macOS answers "Not logged in"; probe of
   2026-11-03), never reads or forwards OAuth tokens or `~/.claude` contents, sets the
   non-essential-traffic switches (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and the related
   variables) and `--no-session-persistence`, and keeps every hardening flag of the GitHub mode.
5. **The promise of the local mode is exactly this:** "Wachiman sends no telemetry and makes no
   GitHub requests in local mode; your code is sent to your configured Claude account for the
   review." No GitHub call is possible by construction (the core has no `gh`; the `local`
   command builds none), and a test proves it with a `gh` stub that throws.
6. **Cost is an estimate and the bounds are work bounds.** `total_cost_usd` is labelled an
   API-equivalent estimate everywhere it is shown; the run is bounded by calls, turns per call,
   time per call and total minutes, with `--max-budget-usd` kept as a guard on the estimate. A
   quota or auth stop ends the run with a partial result that lists what was not reviewed, and
   the engine never waits for a window to reset.
7. **Extraction before feature.** One behaviour-preserving pull request moves the pipeline into
   the core, gated by byte-identical prompts in the fake-provider tests before and after. The
   local connector, the adapter mode and the sinks follow in a second pull request; the guide
   ships after one real local run on known commits has been compared with its posted GitHub
   review.
8. **First slice: committed changes only.** `--working-tree` is the next slice with its own
   design, not a deferred wish.
9. **Both formats are public and versioned** (owner, 2026-11-03). `agent-review local --input
   <file> --repo-dir <clone>` reviews a `ReviewInput` written by any producer, and `--format
   terminal|markdown|json` picks the sink; the JSON sink writes `ReviewResult` unchanged. JSON
   Schemas for both live in `docs/formats/`. Inside `/1` only optional fields are added; removing,
   renaming or retyping a field is `/2`, and the core refuses a version it does not know.
   `headDir` is never in the file: the core snapshots `head.sha` from `--repo-dir`.
10. **The GitHub review is one rendering of the result.** `buildReview` is the GitHub sink; the
    terminal, Markdown and JSON sinks render the same `ReviewResult`, so a fact the result
    carries reaches every destination.

## Alternatives rejected

- **A fake `gh` that answers from local git.** Smallest diff, but every pull request assumption
  stays (numbers, markers, compare statuses, threads), the local mode would inherit GitHub-shaped
  error paths, and a GitLab connector would have to fake `gh` too.
- **A second pipeline for local runs.** Two prompt assemblies drift; the measured review (every
  benchmark so far) would no longer be the one a developer runs.
- **Read the OAuth token and call the API directly.** Forbidden by Claude Code's terms
  ("developers may not collect, store, or intermediate Claude.ai credentials or session tokens")
  and enforced against third parties in February 2026. Also unnecessary: the binary already runs.
- **Fall back to an API key when one is present.** Convenient and silently billed to whoever owns
  the key, on code the key's owner may not have approved. Refused by decision 4.
- **Review the working tree in the first slice.** The diff, the files the agent reads and the
  citation checks must share one state; a developer keeps editing during a 10-minute review.
  The snapshot answers it for committed work; uncommitted work needs an index-aware snapshot and
  its own decisions (staged vs unstaged, untracked), hence a separate slice.
- **`--bare` for isolation.** It skips keychain reads, which is how the binary finds its sign-in
  on macOS. `--safe-mode` is a candidate instead, adopted only if a populated-HOME harness shows
  it adds a property and leaves sign-in working.
- **Mimic GitHub's missing patches for very large files.** GitHub's limit is undocumented; a
  guessed threshold reproduces neither GitHub nor the truth. Local runs review them (owner's
  decision, 2026-11-03).
- **An in-process type only, with `--input` later.** The first draft's recommendation: no
  compatibility promise before a second producer exists. Rejected by the owner: the formats are
  the seam for other hosts and tools, and a standard result is what lets runs from different
  sources be compared. The additive-only rule inside `/1` is the cost of the promise.

## Consequences

- `src/engine.ts` gains two exported types and one function, and `review()` shrinks to a
  connector plus a sink. The pipeline diagram in `docs/architecture.md` grows two seams.
- A local review and a GitHub review of the same commits send the same prompts, so every benchmark
  result transfers to the local mode, and a prompt change is measured once.
- The trust boundary of the local mode is the developer's machine and account, not a CI job. The
  reviewed repository is still untrusted code (engine-owned working directory, `--no-env-file`,
  `--config=`, scratch directory for `claude`, `--restricted`, `--strict-mcp-config`). The
  developer's own `~/.claude` customisations are a new input the GitHub mode never had; what is
  claimed about them is what the populated-HOME harness shows.
- The code reviewed leaves the machine once, to Anthropic, under the terms of the account that is
  signed in. The guide explains Consumer versus commercial terms and the training setting; the
  tool cannot check either.
- Subscription usage is governed by the plan's limits, not by dollars; a run that fires many
  batches is heavier than "ordinary, individual usage" of the plan, so the local mode reviews on
  request, never on every save or in a loop.
- The run directory that `reviewBatch` leaves behind today (`pr.json`, `threads.json`,
  `evidence.json`, never removed) is removed in both modes: a behaviour change in the extraction
  pull request, called out there.
- Incremental state, threads, the ceiling and learned memory remain GitHub-side; a local run
  reviews the whole requested range every time and gains none of them.
- The Codex adapter is untouched; whether it stays is #90's question.

## Non-goals

- Host API connectors and posting to GitLab, Bitbucket or Gitea.
- Uncommitted or untracked changes in this slice.
- Local incremental reviews, thread follow-up, memory, the automatic ceiling.
- Running the developer's agent on the findings.
- Any change to what the model is asked, or to the output schema.
- A hosted service, a queue or an account of Wachiman's own (ADR 0001).

## Reopen if

- A change to either format cannot be additive: publish `/2`, and decide then how long `/1` is
  still read.
- The populated-HOME harness shows that the developer's customisations reach the review and no
  flag stops them: shrink the guide's isolation claim to what the harness shows, or require a
  dedicated `CLAUDE_CONFIG_DIR` for local runs.
- A Claude Code release stops reporting `total_cost_usd` or enforcing `--max-budget-usd` when
  signed in with a subscription (both held on 2.1.318 in the 2026-11-03 probe): drop the
  estimate guard and bound by work only.
- Anthropic's terms for subscription use of the binary change: revisit decision 4 and the guide.
- A local review on the same commits finds fewer than half of the posted review's
  Medium-or-higher findings and the difference is not explained by the inputs: the extraction
  changed something the prompt parity test cannot see.
