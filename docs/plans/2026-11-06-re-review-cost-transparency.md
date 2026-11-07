# Plan: re-review cost transparency and two token leaks

Working document for the PR that implements it; the shipping PR deletes it.

## Why

Audit of kaipu-record on 2026-11-06 (PRs 535-541, $3.75 total) found three defects in the push
re-review path of `src/engine.ts`:

1. A pull request with a binary file (PNG) never gets the incremental marker
   `<!-- agent-review sha=… -->`, because the model skips the file as `binary`, the review is
   "partial", and `buildReview` writes the marker only when every expected file was reviewed
   (`notReviewed.length === 0`). Every push then pays a full review (PR 540: 3 × ~$0.45).
2. The push re-review feeds `openThreads` (every unresolved Wachiman thread) to the model, so it
   re-reads and re-answers threads Wachiman already answered (PR 539: two "Looks addressed"
   replies on one thread). The thread-only run already uses `pendingThreads`.
3. The push-path inline reply carries no cost; the cost sits only in the review body footer. The
   owner wants every run to show what it cost and the pull request's running total.

Owner decisions (2026-11-06): classify binaries by script, never by the model; keep "report,
never resolve" (ADR 0008) and filter answered threads; resolving threads automatically stays a
possible later option for teams that want it, not part of this change; show "this run" and
"this PR so far" on every run.

## Changes

### A. Binary files leave the expected list before the model sees them (engine, deterministic)

- In `reviewChange` (the review core), after `filterFiles`, split `kept` once more: a file whose
  `patch` is absent **and** whose contents at the head are binary is `unreviewable`. Binary test:
  read the file from `input.headDir`; the first 8000 bytes contain a NUL byte. A file with no
  patch that no longer exists at the head (removed binary) is unreviewable too. A file with no
  patch that is readable text (GitHub omitted the patch for size) stays in the batch, as today.
  Put the helper next to `filterFiles` and unit-test it with a temp dir.
- `ReviewResult.coverage` gains `unreviewable: { path: string; reason: "binary" }[]`. Check
  `src/formats.ts` and its tests for whether adding a field to the result needs a format note;
  keep `REVIEW_RESULT_FORMAT` unless the format tests demand a bump.
- `buildReview`: the headline stays "all N files reviewed" when `notReviewed` is empty, and adds
  ", not reviewable: `mock.png` (binary)" when the unreviewable list is not empty. The marker
  rule (`!scoped && notReviewed.length === 0`) does not change; unreviewable files are not in
  `expected`. The "Partial review" headline keeps its meaning: a readable file was not reviewed.
- The batch prompt's `files_skipped` paragraph stays for large text files the model cannot read.
- Tests: `src/engine.fake.test.ts:179-185` ("The binary logo is the only file not reviewed, so the
  review is partial and unmarked") flips: the logo is unreviewable, the review is complete, the
  marker is written. Check the other `LOGO` fixtures (~550, 617, 656, 691) and
  `src/review-core.fake.test.ts` (`icon.png` coverage) and `src/ceiling.fake.test.ts:511-517`.
  Fixtures that want a binary must now give the fake head dir a file with a NUL byte; add a
  helper for that.
- `src/local.ts` and the sinks (`src/sinks/*.ts`) render coverage: show the unreviewable list the
  same way, one line.

### B. The push re-review answers only pending threads

- `src/engine.ts` ~2467: `const threads = last ? pendingThreads(fetchThreads(gh, repo, pr)) : [];`
  (`pendingThreads` is exported at ~1780; it adds `wachi_replies`).
- Widen the `Thread`/`conversation` type so `wachi_replies` travels to `threads.json`
  (~2974, ~2990); the thread-only run already writes it.
- Batch prompt (~2846-2850): say the threads listed are the ones waiting for an answer (the
  owner wrote last), that `wachi_replies` counts earlier replies, that when it is 1 this is the
  last reply allowed and must end with what Wachiman waits for from the owner, and to answer no
  thread that is not in the file. Keep "Do not repeat a finding that already has an open thread."
- Tests: `src/engine.fake.test.ts:592` (push-path replies) gains a case where a thread already
  answered by Wachiman (latest comment is `github-actions`) is neither written to `threads.json`
  nor replied to; and a case with two Wachiman replies already (cap reached).

### C. Every run shows its cost and the pull request's running total

- `automaticSpend` (~1802) also returns `runs`: the number of bodies with a non-null
  `readAutoCost`. `ceilingRoom` (~1821) returns `{ room, spent, runs }` instead of a number so
  `review()` and `threadReplies()` get the total without a second API round trip; update its
  callers and tests (`src/ceiling.fake.test.ts`).
- Re-review headline: "review of the changes since `e41c267` (2 commits: `012efef`, `1e34f38`),
  at `1e34f38`". `compareFiles` (~1441) adds `sha` to each commit in its jq; list at most 10
  short shas, then "and N more". Pass the list through `ReviewInput.since` (optional
  `commits?: string[]`) into `buildReview`.
- Review body footer: `costLine` gets `extra` entries so the line reads
  `… · re-review · 2 commits · PR so far $0.77 over 3 automatic runs · 4 in / … · $0.11`.
  "PR so far" = spent before this run + this run, runs = earlier runs + 1. Only automatic runs
  (`isAutomatic(config.trigger)`) show it; an operator's `/wachi review` is not counted and shows
  nothing. `readAutoCost` (`AUTO_FOOTER`, ~605) reads the last `$` before `</sub>` because
  `[^\n]*` is greedy; add a unit test in `src/engine.test.ts` that a footer with an earlier
  `PR so far $0.77` still yields the final figure, and fix the `costLine` doc comment in
  `src/cost.ts` that says the dollar figure is the only `$`.
- Push-path inline replies (~2554-2566): append
  `\n\n<sub>this run $0.11 · PR so far $0.77 over 3 automatic runs</sub>` **without**
  `<!-- wachi:auto -->`, so the ceiling does not count the run twice (the review body already
  carries the flagged line). Add a ceiling test: a reply with this unflagged line is not summed.
- Thread-only run (~2759): its first reply keeps the flagged cost line and adds
  `PR so far $… over N automatic runs` to `extra`; the other replies get the unflagged
  `this run · PR so far` line.
- Failed-run notices (~2487-2500) keep their flagged cost line; add "PR so far" there too.

### D. Docs

- `docs/costs.md`: a short section "What each run shows" with the footer and reply formats;
  update the ceiling paragraph (replies' unflagged lines are not summed).
- `docs/reviews.md` (or wherever the headline is documented): the "not reviewable" list and the
  commit list on a re-review.
- ADR 0011: Consequences gains a line that binary files are excluded by the engine, so a
  pull request with images keeps incremental reviews. ADR 0008: Status gains a line that the push
  path now honours the pending filter and the two-reply cap; "resolve automatically" stays a
  non-goal with a note that a later opt-in setting could offer it. ADR 0012: a line that replies
  show the running total unflagged.
- Delete this plan in the shipping PR? No: the PR that ships the change deletes it. Keep it until
  the PR is merged; the PR body links it.

## Out of scope

- Resolving threads automatically (future opt-in).
- Counting cancelled runs in the ceiling (ADR 0012 reopen condition).
- Budget-exhausted or provider-rejected skips still block the marker.

## Verification

`bun test` green; `bun run typecheck` (or whatever `package.json` names) green. Add a fake
end-to-end case in `engine.fake.test.ts`: a pull request with one PNG and two text files, first
review complete with marker, a push re-review that lists the commits, shows "PR so far", and
posts a reply with the unflagged cost line, and a third push that does not re-answer the thread.
