# A/B 2026-11-03: the data-path questions (PR #88) on the batches that missed the field run's bugs

- **Status:** run and scored 2026-11-02. 20 provider calls, $11.11 in total.
- **Question:** does [PR #88](https://github.com/niway-dev/wachiman/pull/88)
  (`feat/data-path-questions`, ADR 0016 on that branch) make Wachiman find the real Medium+ bugs
  it missed in the [2026-11-02 field run](https://github.com/niway-dev/wachiman/blob/docs/field-run-kaipu-workspaces/docs/benchmark/2026-11-02-field/README.md),
  without adding false findings? PR #88 adds five questions to a batch's prompt, and only when
  the batch's added lines show the matching pattern.

## In one minute

- **The questions fired on every batch that held a missed bug.** All 10 bugs sit in 5 batches.
  Each of those batches fired 4 or 5 of the 5 questions, so no bug was ruled out as a trigger miss.
- **Found, over 2 runs per arm (20 bug-runs per arm):**

  | | A: `main` (47933f0) | B: PR #88 (5348cd6) |
  | --- | --- | --- |
  | Bug-runs found / partly found / missed | **2 / 1 / 17** | **12 / 4 / 4** |
  | Distinct bugs found at least once (of 10) | 2 | **7** (+1 only partly) |
  | Bugs found in both runs | 0 | 5 |
  | Mean cost per batch | $0.59 | **$0.52** |
  | Mean turns per batch | 7.7 | **5.9** |
  | Findings posted, all runs | 34 | 39 |
  | Findings not matching a target bug | 31 | 26 |
  | Invalid findings (quick check against the code) | 0 | **0** |

- **What B gained:** #479's High bug (roll-forward deletes an unverified source) in both runs.
  Also #479's dropped journal, #478's two brand-colour write-backs, #482's interleaving edits and
  #483's listing probe with no overall deadline.
- **What neither arm found:** #482 `copyToAll` from an unreadable source, and #482 adopting a
  pending id without rebinding the gate. No question targets the second one.
- **What B may have lost:** in run 1, A found two real bugs outside the target list that B's
  run 1 did not: #483's account-tied assignment queue (a real Medium) and #478's offline-edit
  `pendingInit` (Low). B found the queue bug in run 2 and never found `pendingInit`. Two runs
  cannot tell crowding-out from noise.
- **Cost:** B was cheaper per batch, not dearer: 12 % less money and fewer turns. ADR 0016's cost
  reopen condition ("25 % above the average without a confirmed finding") is not met.
- **Biggest caveat:** this is an **in-sample** test. The five questions were written from these
  exact misses. Some of their text names the cases outright: `bounded-wait` mentions "a hotkey,
  capture start, a listing" and "an lstat"; `stale-write-back` mentions "target unreachable now,
  written when it returns". The result shows the questions reach the bugs they were written for.
  It does not show they generalise. A held-out set decides that.

## Per bug

`found` = a finding (or a `contracts` entry) that states the bug's mechanism, i.e. the same root
cause, not only the same file. `partial` = the right mechanism with the wrong consequence or path,
or the mechanism mentioned only in passing. `—` = not found. Heads are the first head each bot
reviewed in the field run; the bugs are present there.

| # | PR @ head | Bug (field-run wording) | Batch | Question aimed at it fires? | A r1 | A r2 | B r1 | B r2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | #478 @ `07a47af` | Default→brand-colour upgrade overwrites a rename made on another Mac (folder reachable) | 1 of 3 | `stale-write-back`, on `registry.ts` | — | **found** | **found** | **found** |
| 2 | #478 @ `07a47af` | The same upgrade, deferred while the folder is unplugged, overwrites the remote rename on reconnect | 1 of 3 | `stale-write-back`, on `registry.ts` | — | — | **found** (same finding as #1, "The unplugged case is worse…") | **found** (same finding as #1, "The same thing happens when the folder is not connected…") |
| 3 | #479 @ `aac7202` | **High.** Roll-forward healing deletes the source without checking it is still the moved item | 2 of 5 | `destructive-step`, on `move-item.ts` | — | — | **found** (`move-item.ts:675`) | **found** (`move-item.ts:675`) |
| 4 | #479 @ `aac7202` | Roll-forward drops the journal even when `unlink` failed | 2 of 5 | `destructive-step` (part 2), on `move-item.ts` | — | — | **found** (`move-item.ts:676`) | partial (contract only: "unlink errors are swallowed (675)", no journal consequence) |
| 5 | #482 @ `833ca60` | Capture-start refresh does not bound the availability probe | 2 of 6 (`workspace-settings.ts`); the caller is in 1 of 6 | `bounded-wait`, on `workspace-settings.ts` | partial (batch 1: capture-start lag "up to ~2 s", misses that `isAvailable` is unbounded) | — | partial (batch 2: "`isAvailable`… has no timeout", but for the All-scope read, not capture start) | partial (same as B r1) |
| 6 | #482 @ `833ca60` | Two edits of the same workspace interleave and lose a key | 2 of 6 | `overlapping-calls`, on `workspace-settings.ts` | — | — | **found** (`workspace-settings.ts:224`) | **found** (`workspace-settings.ts:224`) |
| 7 | #482 @ `833ca60` | `copyToAll` from an unreadable source clears every other workspace's override | 2 of 6 | `destructive-step` (part 3), on `workspace-settings.ts` | — | — | — | — |
| 8 | #482 @ `833ca60` | An unreadable (not missing) machine settings file is treated as empty and overwritten | 1 of 6 | `read-error-as-empty`, on `settings-overrides.ts` | **found** (`settings-overrides.ts:220`) | — | **found** (`settings-overrides.ts:220`) | **found** (`settings-overrides.ts:220`) |
| 9 | #482 @ `833ca60` | Capture-start refresh adopts a pending workspace's id without rebinding the gate | 1 of 6 | none targets it; the batch fires 4 others | — | — | — | — |
| 10 | #483 @ `443a9b0` | The eviction probe of a Library listing has no overall deadline | 3 of 7 | `bounded-wait`, on `dataless.ts` and `library-vault.ts` | — | — | **found** (`dataless.ts:76`) | partial (`dataless.ts:69`, a finding about partial `stat` output that adds "the whole wait… one `lstat` per path with no limit") |

Bug #9 has a near relative in A's #478 run 2: "Edit can move the active workspace's id without
rebinding the gate" (`workspaces/index.ts:289`). It is the same family (a probe adopts an id,
nobody calls `gate.adopt`) on a different code path. It checks out by reading
(`editWorkspace` never calls `workspaceGate().adopt`, and `listState` then sees before == after),
and the field run lists no such bug, so it counts as a new valid finding, not as bug #9.

## Per run

Cost and turns are the provider's `total_cost_usd` and `num_turns`. Every call ended `success`; none
reached the $0.75 batch cap or the 40-turn cap. "Other" = findings that match no target bug. Each
was checked against the code at the head, some only by reading the cited lines (marked "light" in
the notes below).

| Batch | Arm, run | Order | Cost | Turns | Findings | Target | Other: valid / partly / invalid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #478 b1 | A r1 | 1st | $0.573 | 7 | 3 | 0 | 3 / 0 / 0 |
| #478 b1 | B r1 | 2nd | $0.619 | 7 | 5 | 1 | 3 / 1 / 0 |
| #478 b1 | A r2 | 1st | $0.648 | 7 | 5 | 1 | 4 / 0 / 0 |
| #478 b1 | B r2 | 2nd | $0.519 | 6 | 4 | 1 | 3 / 0 / 0 |
| #479 b2 | B r1 | 1st | $0.549 | 9 | 4 | 2 | 2 / 0 / 0 |
| #479 b2 | A r1 | 2nd | $0.584 | 10 | 3 | 0 | 3 / 0 / 0 |
| #479 b2 | A r2 | 1st | $0.598 | 12 | 4 | 0 | 4 / 0 / 0 |
| #479 b2 | B r2 | 2nd | $0.520 | 7 | 3 | 1 | 2 / 0 / 0 |
| #482 b1 | B r1 | 1st | $0.468 | 6 | 2 | 1 | 1 / 0 / 0 |
| #482 b1 | A r1 | 2nd | $0.676 | 9 | 3 | 2 | 1 / 0 / 0 |
| #482 b1 | A r2 | 1st | $0.570 | 7 | 2 | 0 | 2 / 0 / 0 |
| #482 b1 | B r2 | 2nd | $0.444 | 4 | 2 | 1 | 1 / 0 / 0 |
| #482 b2 | B r1 | 1st | $0.460 | 6 | 5 | 2 | 3 / 0 / 0 |
| #482 b2 | A r1 | 2nd | $0.623 | 8 | 3 | 0 | 3 / 0 / 0 |
| #482 b2 | B r2 | 1st | $0.477 | 5 | 4 | 2 | 2 / 0 / 0 |
| #482 b2 | A r2 | 2nd | $0.525 | 7 | 5 | 0 | 5 / 0 / 0 |
| #483 b3 | B r1 | 1st | $0.571 | 4 | 5 | 1 | 4 / 0 / 0 |
| #483 b3 | A r1 | 2nd | $0.581 | 6 | 3 | 0 | 3 / 0 / 0 |
| #483 b3 | B r2 | 1st | $0.575 | 5 | 5 | 1 | 4 / 0 / 0 |
| #483 b3 | A r2 | 2nd | $0.537 | 4 | 3 | 0 | 3 / 0 / 0 |
| **A total** | | | **$5.914** | 77 | 34 | 3 | 31 / 0 / 0 |
| **B total** | | | **$5.201** | 59 | 39 | 13 | 25 / 1 / 0 |

Per batch, B against A (mean of 2 runs): #478 $0.57 vs $0.61, #479 $0.53 vs $0.59, #482 b1
$0.46 vs $0.62, #482 b2 $0.47 vs $0.57, #483 $0.57 vs $0.56. B's prompts are 3,100 to 3,800
characters longer (the question section). They took fewer turns, so B still cost less. Two runs
per arm cannot separate that from noise.

Notes on the "other" findings:

- **Partly valid (1):** B r1 #478, "rollback skips the case where the folder had no identity.json".
  The field audit (`pr-478.md`, F2) rates the same claim partly valid: the gap is real, but the
  `absent` branch is nearly unreachable because `edit` probes first.
- **Real bugs outside the target list:** #483's account-tied assignment queue (A r1, A r2, B r2;
  a real Medium in the field run, fixed in `a47dea62`). #478's offline edit clearing `pendingInit`
  (A r1; field-run D12, Low). The #478 edit/gate finding above (A r2).
- **Found by both arms, valid Low:** #478 trailing-space folder name, edit name re-check outside the
  lock, non-string colour reported as `invalid-name`. #479 whole `.kaipu/drag` wipe, post-commit
  heal reporting `io`. #482 failed hash record leaving own edit pending, sequential All-scope
  refresh, `persistActive` throwing after `setActive`. #483 500 sequential 15 s assign calls,
  `load()` overwriting an early enqueue, a direct assign leaving an older queued entry.
- **B only, valid Low:** #478 `create`'s undo removing an identity it may not own; `checkNewLocation`
  reporting an invalid name as `parent-missing`. #482 `apply` skipping `changed()` on its early
  returns; `uploadMode` refused for an unreachable folder; "serializes concurrent updates" test
  using distinct ids (light); folder rewrite dropping unknown keys (light); refresh without a catch
  in `requireCaptureWorkspace` (light). #483 catalog refresh overwriting a confirmed workspace;
  unreadable queue file read as empty; partial `stat` output read as a full answer.
- **A only, valid Low:** #479 healed record copied with the source's tag ids. #482 `policy` stored
  but never forwarded by `openQuietCapture`; N+1 broadcasts in `copyToAll`; "not a fresh read"
  tests changing prefs after the handler returned (light); a slow refresh overwriting a newer cache
  entry. #483 synced drag copy with an uncaught `copyFile`.

## Method

1. **Ground truth.** The 10 bugs of the field run's "Wachiman's misses, by cause" table, with the
   head, file and line from the per-PR audits (`prs/pr-478.md` … `pr-483.md` on
   `docs/field-run-kaipu-workspaces`). The head is the first one the bots reviewed, which is where
   Wachiman's full review missed them. Bug #2 was first reported at `649c902`. It is present at
   `07a47af` too: the unplugged branch of `upgradeDefaultColor` (`registry.ts:405-428`) sets
   `pendingIdentity` without reading the folder.
2. **Batches.** [`harness/ab.ts plan`](harness/ab.ts) builds each pull request's file list from
   `git diff <merge-base> <head>` in the kaipu-record clone, in GitHub's patch format. It then runs
   the engine's own `filterFiles` (default excludes) and `planBatches` (1000 lines, 140000 chars,
   the production defaults). The batches match the field run's coverage tables: #479 has 5
   batches, batch 2 = 5 files, 853 lines, risk 5; #482 has 6 batches of 682/806/573/990/997/145
   lines; #483 batch 3 = 21 files, 984 lines, risk 6. Plans:
   [`raw/plan/`](raw/plan/). Per-file question triggers:
   [`raw/plan/per-file-questions.json`](raw/plan/per-file-questions.json).
3. **Trigger check before paying.** `selectQuestions` on each batch, then on each file of the batch
   (to see whether the question aimed at a bug fires on the bug's own file). All five batches
   fired. Every aimed question fired on the bug's own file.
4. **Arms.** A = a detached worktree at `origin/main` `47933f0`; B = at
   `origin/feat/data-path-questions` `5348cd6`. [`harness/ab.ts run`](harness/ab.ts) imports the
   arm's own `src/engine.ts`, `src/evidence.ts`, `src/contracts.ts` and
   `src/providers/claude-code.ts` and repeats `reviewBatch` step by step: `pr.json` and an empty
   `threads.json` in a scratch dir; call-site evidence with `planEvidence` + `collectEvidence`
   (as `gatherEvidence` does); `buildBatchPrompt` with its default arguments, so B adds its
   questions exactly as the engine would; `ClaudeCodeProvider.run` with the arguments
   `runProvider` passes; `checkOutput(relativisePaths(...))` on the result. The harness code is
   the same for both arms. A dry run checked that A's and B's prompts differ only in the "Risks
   this part's added lines show" section, and that `evidence.json` is byte-identical.
5. **Same inputs.** One detached worktree of the clone per head (`/tmp`, removed afterwards).
   Base instructions (`CLAUDE.md`, `AGENTS.md`, `.github/agent-review.md`) read from the clone at
   the merge base. The pull request's title and body from today's API (`raw/meta/`). Model
   `claude-opus-5-5`, effort `high`, batch budget $0.75, 40 turns, 900 s: the values of
   kaipu-record's caller workflow and `review.yml`'s defaults.
6. **Local credentials.** No `ANTHROPIC_API_KEY` was available, so the provider ran with
   `requireApiKey: false` on the machine's Claude Code login. The provider's child-environment
   allowlist drops `USER`, and without it Claude Code cannot read the macOS keychain ("Not logged
   in"). That first attempt cost $0 and is kept in `raw/478-b1/A-r1-failed-not-logged-in/`. The fix
   is [`harness/claude-with-user.sh`](harness/claude-with-user.sh), passed through the provider's
   own `binary` option: it sets `USER` and runs the real `claude`. Arguments, prompt and every
   other variable stay as the engine sets them.
7. **Order and repeats.** Two runs per arm per batch. The A/B order was drawn at random per batch
   and per pass ([`raw/order.txt`](raw/order.txt)). The five batches of a pass ran in parallel.
8. **Scoring.** One reader (this agent) read every finding and every `contracts` entry
   ([`raw/<batch>/<arm>-r<n>/review.md`](raw/)). Each was matched against the audit's mechanism,
   and every other finding was checked against the code at the head.

Raw files per run: `prompt.txt`, `evidence.json`, `info.json` (questions, engine SHA, part),
`result.json` (the provider's full result), `output.json` (the checked batch output), `review.md`
(a readable rendering), `log.txt`.

## Limits

- **In-sample.** The questions were designed from these 10 misses (ADR 0016 cites the field
  run's items 1–5), and some of their wording names these cases. A positive result here is
  necessary, not sufficient. Generalisation needs bugs no one knew when the questions were written.
- **Small N.** 5 batches, 2 runs per arm, 10 bugs. One run moves a bug's row a lot. A found
  bug #8 in run 1 and missed it in run 2, which shows how noisy a single run is.
- **Batch level, not full PR.** Each run reviews one batch with the full-review framing, not the
  whole pull request. Findings that other batches would have posted, merging, deduplication and
  the review budget across batches are not measured. Bug #5 spans two batches, and both were run.
- **Not blind.** The scorer knew which arm wrote each output and knew the target bugs. "Found",
  "partial" and "valid" are one reader's calls. The quotes behind each are in the per-bug table
  and in `raw/`.
- **Validity by reading.** Nothing was run. Findings marked "light" were checked only at the cited
  lines.
- **Inputs differ slightly from production.** The file list comes from `git diff` rather than
  GitHub's API (GitHub may omit very large patches; none of these batches holds one). Instructions
  are read at the merge base instead of the base branch's tip at review time. The pull request
  body is today's, not the one at review time. Both arms got the same inputs, so the comparison
  holds; the absolute numbers may differ from a live run.
- **Arm A is `main` (v1.4.0 flow questions and call-site evidence), not the v1.3.0 that missed
  these bugs live.** A still missed 8 of the 10 in both runs.

## Recommendations (not applied; the questions were not tuned during the experiment)

1. **`destructive-step` part 3 does not reach `copyToAll` (bug #7).** It fired on
   `workspace-settings.ts` and B answered other parts of it, but in both runs it never asked
   where `copyToAll`'s source values come from. A clause like "when the value it copies comes from
   a read that can fail or time out, what is written in its place?" would aim at the source side.
   Untested.
2. **`bounded-wait` got B to say `isAvailable` is unbounded, but B tied that to the wrong
   caller (bug #5).** The question already names "capture start". B attached the gap to the
   Settings All-scope read, which sits in the same file, and never followed the capture-start
   caller in `screenshot-ipc.ts` (another batch). Asking the model to list every caller of the
   unbounded call and check each one may close this. It is a cross-batch read, so it costs turns.
3. **Bug #9 (adopted id, gate not rebound) is a side-effect-across-files bug with no question.**
   A's #478 run 2 found the same family on another path without any question. Collecting such
   bugs is worth it before writing a sixth question.
4. **Measure the losses on a larger set.** In run 1, B missed two real bugs that A found (#483
   account queue, #478 `pendingInit`). Whether the questions crowd out other reading needs more
   runs than two.
5. **Next measurement:** run arms A and B on held-out pull requests, ideally full-PR replays in
   kaipu-bench repositories, with a fixed cost margin agreed before the run, as ADR 0016's reopen
   condition proposes.
