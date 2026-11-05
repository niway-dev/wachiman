# ADR 0020: An opt-in, on-laptop review history with deterministic finding tracking

- **Status:** proposed 2026-11-05. **Not implemented**: no branch contains any of it. The plan is
  [2026-11-05-local-review-history.md](../plans/2026-11-05-local-review-history.md). Depends on
  ADR 0019's local mode (merged in #111 and #112).
- **Date:** 2026-11-05
- **Spec:** [2026-11-05-local-review-history-design.md](../specs/2026-11-05-local-review-history-design.md)
- **Issue:** [#103](https://github.com/niway-dev/wachiman/issues/103)
- **Numbering:** 0014 and 0015 are reserved by #80, 0017 and 0018 by #90; #99's draft reuses
  0019, which is merged, and must renumber. This record is 0020.

## Context

`agent-review local` (ADR 0019) reviews the whole committed range every time and keeps nothing
on disk: no transcript, no marker, no memory. That is the promise the guide makes to a developer
running it on an employer's code, and it is also why two runs of the same branch are two
unrelated reports. The developer cannot tell which findings are new, which were already there at
the last commit, which disappeared because the code changed, and which the reviewer simply did
not repeat. GitHub mode has that memory in the signed marker and the compare API (ADR 0011),
which a laptop has no equivalent of.

The owner asked, on 2026-11-05, for a history that answers "what did Wachiman find in this
repository this month, and what did I fix", on code that can never feed the benchmarks, with
four constraints: it is off unless turned on; nothing leaves the machine; it lets the developer
judge whether the reviewer was right; and the sameness of two findings is decided without a
model call in the first slice.

Other tools track findings across runs by hashing content rather than line numbers and infer a
fix from absence in a later run of the same scope: SARIF's `partialFingerprints` and
`baselineState` (`new`, `unchanged`, `updated`, `absent`), GitHub code scanning's
`primaryLocationLineHash` keyed by rule id, SonarQube's line hash then message then block move,
Semgrep's hash of path, rule and matched content. The spec cites each page read.

## Decision

1. **Opt-in, and off means off.** The history is read or written only with `--history` or
   `AGENT_REVIEW_HISTORY=1`. Without them `local` never opens, creates or stats
   `~/.wachiman/history`. GitHub mode (`review()`) has no path to the store at all.
2. **On the laptop only.** The store is `~/.wachiman/history/`, directories 0700, files 0600,
   written atomically (temporary name, `fsync`, rename). There is no export, upload or benchmark
   hook, and the guide says the files hold the review text, which quotes code.
3. **One immutable file per run; state by replay.** Each run writes
   `<repo-key>/runs/<utc-timestamp>-<sha7>.json` holding the unchanged public `ReviewResult`, a
   `tracking` record per finding and the earlier findings the run settled. `history` replays the
   files in order. Verdicts are an append-only `verdicts.jsonl`. The format is internal and
   versioned (`wachiman.history-run/1`); a file that does not parse or has another version is
   moved aside as `<name>.unreadable-<unix-seconds>` with a warning, never overwritten.
4. **The repository key** is `<basename>-<hash8>`: the first 8 hex digits of SHA-256 over the
   credential-stripped, normalised `origin` fetch URL, or over the real path of the common git
   directory when there is no `origin`. Clones and worktrees of one remote share a history.
5. **A finding's identity is deterministic, in two tiers.** Same repository, same path (a
   rename in the later run's `previous_filename` is followed), same `topic`, then (a) the same
   line hash (SHA-256 of the cited line's text without whitespace, valid only when that text has
   at least 8 characters and occurs once in the file at that head) or (b) the same title key
   (lowercased, backticks and punctuation removed, digit runs replaced by `#`, whitespace
   collapsed). `line: 0` findings use (b) only. Severity and confidence are not identity. A model
   is never asked whether two findings are the same.
6. **Statuses.** A finding with a match is `open` (first id, first head, run count); without one
   it is `new`. An earlier open finding absent from a run that lists its file in
   `coverage.reviewed` is `probably-fixed` when its cited region changed (the line hash is not
   found in the file at the new head; for `line: 0`, the blob `sha` differs) and `not-repeated`
   when it did not; a finding whose file the run did not review stays `unknown`. A settled
   finding that matches again is `open` with a `reopened` count. Partial coverage, scopes,
   excludes, skips and quota stops never mark anything fixed.
7. **The developer's verdict reuses the precision vocabulary**: `history --verdict <id>
   correct|wrong|partial [--reason]`, counted as `docs/precision.md` counts GitHub verdicts.
   Verdicts are recorded and shown; they never change what the engine reviews.
8. **Retention** is 30 days by default (`AGENT_REVIEW_HISTORY_DAYS`, `0` keeps forever), pruned
   at save time for the repository being written; `history --forget [--repo-dir] | --all`
   deletes on request.
9. **The report shows the status** (terminal and Markdown label each finding and add a "since
   the last run" block); `--format json` on stdout stays the result alone and the block goes to
   stderr. `agent-review history` lists the replayed state and needs no clone and no `claude`.

## Alternatives rejected

- **Match by path, topic and normalised title only** (the starting proposal). A model rewords a
  title between runs more often than it moves a line; title-only matching would report the same
  defect as `new` and `probably-fixed` in alternation. Content hashing is what every tool
  surveyed does; the title key stays as the second tier.
- **Match by path, line and topic** (the engine's own dedupe key). Any edit above the finding
  shifts the line, so every finding would be new after every commit.
- **Ask the model whether two findings are the same.** Excluded by the owner for this slice;
  also a paid call per earlier finding, and a non-reproducible status.
- **A hash of the remote URL as the whole key.** `ls ~/.wachiman/history` would be opaque to
  the developer who owns the files; the readable basename costs nothing and the hash keeps two
  `api` repositories apart.
- **A clone-path key.** Two worktrees of one repository would have two histories, and moving a
  clone would lose it.
- **An index file updated on every run.** One corruptible file that every command depends on;
  replaying immutable run files has no such failure.
- **A `--reject` flag with its own words.** The repository already has a verdict vocabulary
  (`correct`, `partial`, `wrong`, `unjudged`) and a counter; a second vocabulary would make a
  local count incomparable with the GitHub one.
- **Suppress findings marked `wrong` in later runs.** That is learned memory on a laptop, which
  ADR 0007 decides is proposed as a reviewable pull request instead; it would also hide the
  persistent false positive the listing is meant to show.
- **Skip unchanged files in a `--history` run.** Changes the batch lists and the prompt, breaking
  prompt parity with GitHub mode (ADR 0019 level b); the local counterpart of ADR 0011 needs its
  own design. Reopen condition below.
- **A public JSON Schema for the history file.** A compatibility promise for a file only this
  engine reads; the embedded `ReviewResult` already has one.
- **Pruning every repository at every save.** Deletes data of a repository the developer did not
  touch; pruning the written repository plus `--forget` is predictable.

## Consequences

- The guide's promise gains a clause and stays checkable: "no transcript is kept on disk, and no
  history unless you turn it on". A test asserts the absence of the directory after a run
  without the flag, and GitHub mode is tested never to create `~/.wachiman`.
- The developer gets, per repository, a list of findings with `new`, `open`, `probably-fixed`,
  `not-repeated` and `unknown`, with verdicts and their counts. `not-repeated` is also the first
  local measure of the reviewer's consistency on unchanged code.
- "Fixed" is always inferred, never observed; the word `probably` stays in the status and the
  guide says why.
- The public result format does not change; the history wraps it, so any reader of
  `wachiman.review-result/1` can read a run file's `result`.
- A change to the hash or title-key rule is a `/2` of the history format; `/1` files are then
  moved aside, not migrated. Retention makes that cheap.
- Employer code (the quoted lines in finding bodies) sits in plaintext under `~/.wachiman`, mode
  0600, for 30 days by default. The guide says so beside the `--output` report, which holds the
  same text.
- `src/local.ts` grows a save step between `reviewChange` and the snapshot removal, and the
  sinks grow an optional annotation; `src/cli.ts` grows a `history` command.

## Non-goals

A local incremental review, verdict-driven suppression, export or sync, a team history, GitHub
mode, the working tree, matching across files or repositories, a model-judged sameness.

## Reopen if

- The owner wants a `--history` run to skip files unchanged since the last run (the local ADR
  0011): that needs a design that keeps prompt parity or accepts its loss.
- The `not-repeated` count on real repositories shows the two tiers mislabel findings often
  enough that a third tier (context lines, or a model judgement) is worth its cost.
- The owner wants local runs of an owned repository in the benchmarks: an explicit export
  would amend decision 2.
