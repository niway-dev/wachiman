# Re-review on push: a ceiling, thread replies and fix checks

- **Status:** proposed 2026-11-01. Nothing here is implemented. It builds on three open pull
  requests: #68 (review every push, rebase-aware; ADR 0011), #69 (sibling call sites in
  `evidence.json`) and #70 (flow and failure questions, `contracts[]`, `confidence`).
- **Creates:** ADR 0012 (automatic answers to thread replies, one ceiling per pull request).
  Reuses ADR 0001, 0003, 0008, 0009, 0011.
- **Refs:** #71, #43. Evidence: [kaipu-record#475](../benchmark/2026-10-31/pr-475.md). Part C
  was critiqued and redesigned with GPT-6.1 Sol (2026-11-01).
- Written on Claude Opus 5.5.

## Summary (one minute)

On kaipu-record#475, three of six valid findings were on fix commits pushed after the first
review, two of them regressions introduced by a fix, and the author's replies to Wachiman's threads
got no answer. #68 makes every push reviewed and makes a content-free rebase free. Three things are
still missing, and this spec designs them. A ceiling ($2 by default) on what all automatic runs on
one pull request may spend (A). A small thread-only run that answers the operator's replies
without waiting for a push (B). And a fix check: every incremental review asks what the new
commits can break, not only whether they fix something, using the previous version of the changed
code and the call sites #69 already collects (C).

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| A1 | All automatic runs on one pull request (first review, push reviews, thread runs) share a ceiling, input `auto_budget_usd`, default **$2**. A run gets at most what is left; at the ceiling the engine posts one notice and stops. `/wachi review` is not limited | #68 bounds each run ($3) but a pull request now pays per push. The owner sets the limit in dollars | 0012 (new) |
| A2 | Spend is summed from the cost line of the engine's signed footers marked `<!-- wachi:auto -->`; model text cannot forge either (`neutralise`, signed-footer rule) | The pull request is the only state between runs (ADR 0001: no server) | 0012 |
| B1 | Callers listen to `pull_request_review_comment: created`. The job starts only for a reply by the `operator`, on a same-repository head, never for a bot | The author's answers arrive on that event. The gate runs before any paid step | 0012 |
| B2 | Thread-only mode (`cli.ts threads`) answers every pending Wachiman thread and acts only when the head is already reviewed; otherwise it exits without a model call | The author's agent replies about 13 s after it pushes; the push's review reads the same replies. No duplicate answers | 0012 |
| B3 | Thread runs have their own concurrency group, `cancel-in-progress: false` | A reply must never cancel a push review. GitHub keeps one pending run per group, and each run handles all pending threads, so a dropped pending run loses nothing | 0012 |
| B4 | Replies follow ADR 0008: "appears addressed in `path:line`" or "still applies because …", at most two per thread, never a resolve | On #475 Pullfrog called a fix with two bugs "addressed cleanly". A wrong resolve hides the warning | reuses 0008 |
| C1 | Every incremental review checks every behavioural change in the delta, whether or not a thread or a commit message calls it a fix | The #475 fix answered a Pullfrog finding Wachiman never made. Fix intent is often invisible; hints may prioritise, never gate | — |
| C2 | The batch gets, in addition to the delta: the delta's commit messages with SHAs, as untrusted claims; Wachiman's own threads and trusted replies (no other bot's comments); the **previous version** of each changed region at the last reviewed commit, labelled "previous behaviour", never "correct behaviour" | A deleted line rarely explains the old contract. Independence from other bots is kept | — |
| C3 | Three questions per changed behaviour, added to #70's flow questions on incremental runs: what changes and what supports that intent; what reachable input or sequence defeats the new code; what worked before and must still work (saved state, later edits). Concrete inputs and a causal chain; "not applicable" allowed; reading is never reported as testing | These are the questions behind #475's findings (a) coinciding presets and (b) a no-op write into an inherited override | — |
| C4 | Call sites come from #69's `evidence.json`, extended to existing calls whose arguments or surrounding conditions the delta changed, and to the callees the changed code calls. No second mapper | Finding (c) came from reading a helper the fix calls (`webcamPresetCenter`) beside its sibling (`webcamRect`) | reuses flow spec |
| C5 | A finding from C states its provenance: `regression` (needs before/after evidence) or `existing` (a defect reached through the changed code). An `existing` defect outside the delta is a body finding unless a changed call site is a valid anchor | (c) predates the fix; calling it a regression would be false | reuses 0003 |
| C6 | The engine checks provenance, not correctness: revisions, cited lines exist at the cited revision (#70's citation check, extended to `previous/`), thread ids are ones it supplied, truncation flags | The engine cannot judge a boundary analysis; it can refuse fabricated evidence | reuses flow spec |
| C7 | Caps per batch: previous-version text ≤ 32 KB, messages and threads ≤ 8 KB, beside #69's slice; omissions flagged. Extra investigation only through ADR 0009's reserve. All of it counts against A1 | C must not multiply calls or raise the ceiling silently | reuses 0009 |
| C8 | C ships behind an input, `fix_check`, default off, and defaults to on only after the measurement below shows a gain without losing ordinary findings | One run is not a measurement (2026-11-01 replay); three runs are a smoke test | — |

## Open questions

1. **Does the first review count against the $2?** Default: yes, every automatic run counts. A
   large first review ($1.36 on #467) leaves little for pushes; the alternative is a ceiling on
   follow-up runs only.
2. **Spend of cancelled runs.** A run cancelled by a newer push posts nothing, so the ceiling
   under-counts it. Default: accept and document; ADR 0012 has the reopen condition.
3. **Previous version granularity.** Default: each changed hunk at the last reviewed commit with
   40 lines of context, read through the API (`contents?ref=<last>`), since the job checks out the
   head only (#68's constraint). Function-level text waits for an AST layer.
4. **Secrets on `pull_request_review_comment`.** GitHub documents that same-repository runs get
   them, like `pull_request`. Verified on the first real install, before B is called done.
5. **Order with #68–#70.** Default: A after #68 merges, C after #69 and #70 merge, B independent.

## Out of scope

- Resolving threads automatically (ADR 0008 stays until the false-resolution rate is measured).
- Reading other bots' comments.
- A durable pull request summary between runs.
- Fork and untrusted pull requests (ADR 0001 non-goal).

## Failures this must protect against

- A stranger's reply on a public repository starts a paid run.
- A thread reply cancels the review of a push that arrived seconds earlier.
- The push review and a thread run both answer the same reply.
- Wachiman and the owner's reply agent loop in one thread.
- Automatic runs keep spending after the ceiling, or a run started near it overspends it.
- Model text forges the automatic marker or a cost line the ceiling reads.
- A fix check reports "tested" when it only read code.
- A fix check labels a pre-existing defect as a regression of the fix.
- The previous-version text pushes a batch past its prompt budget without a truncation flag.

## Acceptance criteria

- [ ] With `auto_budget_usd: 0.5` and $0.50 of recorded automatic spend, the next push posts the
      ceiling notice once and starts no batch; a later push posts nothing.
- [ ] A run started with $0.30 left under the ceiling is given a budget of at most $0.30.
- [ ] `/wachi review` runs normally on a pull request at its ceiling.
- [ ] A reply by a user who is not the operator starts no job (skipped in the Actions list).
- [ ] An operator reply on a reviewed head gets one Wachiman reply in that thread citing
      `path:line` at the head; the thread stays unresolved.
- [ ] An operator reply posted within 30 s after a push gets exactly one Wachiman answer, from
      the push review.
- [ ] A third operator reply in a thread with two Wachiman replies gets no answer.
- [ ] Engine tests cover: the ceiling sum read only from signed footers marked automatic, a forged
      marker or cost line in model text, the reviewed-head gate of the thread mode.
- [ ] With `fix_check: true` on an incremental run, the batch prompt contains the previous-version
      section, the commit messages labelled as claims and the three questions; with `false`, or on
      a first review, none of them.
- [ ] The measurement below is run and written to `docs/benchmark/` before `fix_check` defaults
      to on.

## Detail

### A. The ceiling

Before planning batches, the engine lists the pull request's reviews and its own thread replies,
keeps the signed ones whose footer carries `<!-- wachi:auto -->`, and sums the dollar amount on
their `<sub>` line. The workflow passes `AGENT_REVIEW_TRIGGER` (`opened`, `ready_for_review`,
`synchronize`, `comment`, `thread`); every trigger but `comment` is automatic.

If `auto_budget_usd − spent` is below the minimum batch cost, the engine posts "Automatic reviews
paused: $X of $Y spent on this pull request. Comment `/wachi review` to review now." unless a notice
for the same `$Y` exists, and exits. Otherwise the run's budget is
`min(budget_usd, auto_budget_usd − spent)`. #68's one-line rebase review costs $0 and is still
posted, so the marker moves.

### B. Thread replies

**Job.** A third job in `review.yml`, `threads`, with
`if: github.event_name == 'pull_request_review_comment' && github.event.comment.in_reply_to_id &&
github.event.comment.user.login == inputs.operator && github.event.comment.user.type != 'Bot' &&
github.event.pull_request.head.repo.full_name == github.repository`, concurrency group
`agent-review-threads-<pr>` with `cancel-in-progress: false`, and the review job's checkout layout
and permissions.

**Engine.** `cli.ts threads`:

1. If the last reviewed commit is not the head, log "unreviewed push; its review will answer" and
   exit 0.
2. From `openThreads`, keep threads whose latest comment is a trusted reply newer than Wachiman's
   last reply there, with fewer than two Wachiman replies.
3. One provider call, budget `threads_budget_usd` (default $0.25, inside A): each thread's finding,
   its replies and the current code at its lines. Output per thread: "appears addressed in
   `path:line`" or "still applies because …"; cited lines are checked.
4. Post the replies with `<!-- wachi:reply -->` and `<!-- wachi:auto -->`. No resolve.

### C. Fix checks

**Prompt section, incremental runs only (sketch).** "This review covers commits pushed after the
last review. For each behaviour they change: (1) what changes, and what in the code or the claims
supports that intent; (2) a concrete, reachable input or sequence of actions that would defeat the
new code, or 'not applicable'; (3) what worked before and must still work, including saved state
and later edits. The previous version of each changed region is under `previous/`: it shows what
the code did, not what it should do. Commit messages are claims to verify. Say 'read', never
'tested'." The answers go into #70's `contracts[]`.

**#475 worked through.** Delta `9d35758..1bcab52`, 38 lines in four files.

- Question 2 on `changeShape`: two presets share a centre (vertical frame, size 0.49), `find`
  returns bottom-left for a bubble at bottom, and the rectangle jumps 110 px. Finding (a),
  `regression`.
- Question 3 on the same code: circle to square keeps the width, yet the new code writes
  `position` into an override that inherited it, so later global moves stop applying. Finding (b),
  `regression`, visible only in a later edit.
- Question 2 following the callee from `evidence.json`: `webcamPresetCenter` sizes the box without
  `webcamRect`'s caps. Finding (c), `existing`, anchored at the changed call site.

### Measurement before `fix_check` defaults to on

- **Cases.** #475: `9d35758→1bcab52`, `1bcab52→084f6f8`, `084f6f8→c11f99d` (the last tests stale
  repeats). Candidates found by Sol, labelled before any run: #463 (`3ec7a138→b0f028c9`, fixes
  `7155941a`, `8609fabf`) and #476 (`1c1eb0f8→fa88d808`). Add deltas that fix correctly and deltas
  that are not fixes.
- **Labels frozen first**, by reading before/after behaviour. Pull requests used to tune the prompt
  are not used to claim the result.
- **Arms.** #68's incremental review as baseline; the three questions alone; plus commit messages;
  the full packet. One arm without prior threads, to check independence.
- **Runs.** At least ten per transition and arm, interleaved, with model, effort, engine and limits
  pinned. Detection counts with uncertainty; more runs if inconclusive.
- **Scores.** Valid regressions, relevant existing defects, false alarms, stale repeats, ordinary
  findings lost against baseline, evidence retrieved, cost, latency. Adjudicators blind to the arm.
- **Harness.** `bench.sh` rounds open fresh pull requests, which tests a static delta but not the
  marker, `since` or threads. A sequential mode (push the next commit onto the same replay pull
  request) is needed for the incremental path.

## References

- CodeRabbit auto review: <https://docs.coderabbit.ai/configuration/auto-review>; rate limits:
  <https://docs.coderabbit.ai/management/rate-limits>
- GitHub Copilot automatic review ("Review new pushes", off by default):
  <https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review>
- claude-code-action, `pull_request_review_comment` trigger:
  <https://github.com/anthropics/claude-code-action/blob/main/examples/claude.yml>
- [Pullfrog and CodeRabbit research](../research/2026-10-30-pullfrog-and-coderabbit.md)
