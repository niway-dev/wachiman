# t3code: over-cut tests that were restored, and unreachable-code deletions

- Date: 2026-11-12
- Status: evidence
- Related: [index](../README.md), [inventory](01-pr-inventory.md)

Labels: **[observed]** is stated in a PR body, patch, or comment; **[inferred]** is our reading.

## In one minute

- **[observed]** The four restore PRs (all merged 2026-10-23) bring back 29 cases deleted by the "2026-10-20 test snap" (the purge in https://github.com/pingdotgg/t3code/pull/22557, ~11,000 tests). None was triggered by a production bug: each was a re-audit by the maintainer's agent pipeline (author t3dotgg, Muse Wonder Full, reviewed by GPT-6.1 Sol and Claude Opus 5.5).
- **[observed]** Every restored file was the only guard for its behavior ("the only direct test", "the only test proving", "Nothing on main checked either behavior").
- **[observed]** The bug classes are secret leakage in logs, DST time arithmetic, permission re-checks under races, and coalescing/cancellation. These are invariants that types do not express.
- **[observed]** The follow-up deletion PR https://github.com/pingdotgg/t3code/pull/24058 removed 126 cases and itself restored 9 over-cuts after an Opus review round. Most carried a past bug or issue number.
- **[observed]** Tests of deleted dead code were deleted together with the code (https://github.com/pingdotgg/t3code/pull/26238); the closed predecessor https://github.com/pingdotgg/t3code/pull/23984 was only superseded because it went 581 commits stale.
- **[inferred]** Valuable tests guard a stated invariant at a boundary, name a concrete failure, and have no stronger twin. Deleted ones were mirrors of constants, duplicates, or tests of code nobody calls.

## The restored tests

Trigger for all four: **re-audit** (observed: PR bodies open with "The 2026-10-20 test snap deleted ..."). No linked issues, no human review comments. Bug class is inferred from the asserted behavior.

| PR | What it asserts | Bug class | Trigger | Link |
| --- | --- | --- | --- | --- |
| Render scheduler (1 test, +27) | Two invalidations in one frame make one request; a frame renders once; dispose cancels exactly once; nothing renders after dispose. Drives frame callbacks directly. | Concurrency / lifecycle (coalescing, cancellation, disposal) | Re-audit: scheduler still ships, both device viewers use it, "no guard" | https://github.com/pingdotgg/t3code/pull/23977 |
| Clipboard redaction (5 tests, +92) | On clipboard or haptic failure, logs carry only the fixed target label, never the copied value or nested causes. | Security: secret/OAuth leakage in logs | Re-audit: "a future logging change could leak OAuth state or codes with nothing failing in CI" | https://github.com/pingdotgg/t3code/pull/23980 |
| DST scheduling (7 tests, +131) | Interval schedules advance by elapsed time across spring-forward/fall-back in America/New_York; fixed-time schedules stay on the local calendar; UTC and Asia/Tokyo as controls. Real service, TestClock, in-memory SQLite. | Time zones / DST boundary | Re-audit; tests originally came with the real bug fix https://github.com/pingdotgg/t3code/pull/15768 | https://github.com/pingdotgg/t3code/pull/23991 |
| Project settings permissions (16 tests, +556) | Panel rechecks grants when access is revoked during an update, after removal confirmation, or mid-edit; scope and post-removal navigation cases. | Permissions / authorization races | Re-audit: surviving logic test "only covers removal planning copy" | https://github.com/pingdotgg/t3code/pull/24011 |

Notes **[observed]**:

- #23991 review recomputed expected instants: if intervals regressed to wall-clock addition, all three New York cases would fail.
- #24011 review found the restored revocation tests were vacuous (they only asserted "not called", and one passed because Chromium drops focus without firing blur). They were rewritten to assert the denial toast, and a mutation check showed exactly 3 tests fail when the grant recheck is short-circuited. A restored test was strengthened, not just copied.

## #24058 review rounds

https://github.com/pingdotgg/t3code/pull/24058 (merged 2026-10-23) was the "delete twice as many first" half of the deal. Its body states 126 cases removed, 4.3x the 29 restored. Review ran as 2 rounds of GPT-6.1 Sol (high) and 2 rounds of Opus 5.5. **[observed]** There are no GitHub review comments or threads on it; the rounds are only described in the PR body and the second commit (https://github.com/pingdotgg/t3code/commit/75d659328).

Round 1 (Opus) found 9 over-cuts, restored in the second commit. Reasons below are the bug or issue reference in the body; the one-line purpose is read from the patch (**[inferred]** where marked).

| Restored guard | Reason given | Purpose |
| --- | --- | --- |
| Checkpoint `diff.noprefix` | Issue #9438 | Diff keeps `a/` and `b/` prefixes when repo config disables them (patch) |
| Preview-tools `allOf` guard | Issue #5128 | No tool schema with multiple `allOf` descriptions (patch) |
| Preview-tools `tabId` check | none cited | Every tool allows explicit tab target (patch) |
| Troubleshooting doc-anchor test | none cited | Contract constants must match headings in the user guide (patch) |
| One `threadAccess` wiring case | Issue #22452 | Bare uuid error points at the `mcp:` thread (patch) |
| Four timestamp rows | Issue #20094 | none beyond reference |
| Three amount-regex branches | Issue #21519 | none beyond reference |
| Release-notes heading skip | Issue #9138 | Markdown/HTML headings are not counted as changes (patch) |
| `Ctrl++` row, two multi-model send guard rows | none cited | Literal edge input; send blocked without git thread/branch/models (patch) |

Round 2 approved. Two nits were declined with reasons (a circular sections test, a minor `updateMachine` assert). **Observed pattern:** a majority of the 9 are tied to a numbered past issue, i.e. regression tests. Source: PR body, which only lists issue numbers, so "regression test" is **[inferred]** from that.

What went, and why it was safe **[observed]**: dead exports plus their tests (every symbol grep-verified caller-less), duplicates with "stronger twins", copy/schema mirrors (MCP tool description strings, decode-then-read-back), trivial table rows while "every implementation branch keeps at least one row".

## Unreachable-code deletions

- https://github.com/pingdotgg/t3code/pull/26238 (merged 2026-10-28, +4,192/-22,141, 876 files) replaced https://github.com/pingdotgg/t3code/pull/23984 (closed same day, 920 files).
- **How "unreachable" was decided [observed]:** per-item proof, not coverage. Examples: 26 capability flags `true` on all 146 protocol-2 releases (all 142 tags checked); 11 WebSocket methods and 3 HTTP routes "no client calls today and no protocol-2 release ever called"; React Compiler output checked for each removed `useMemo`/`useCallback`; `check:changed` includes knip. Coverage is not mentioned.
- **Tests of deleted code [observed]:** the category "Code only tests use" (e.g. `ProjectionStore.layerMemory`, whole `ProviderRuntimeEventV2` union, OpenCode CLI inventory) goes with its tests. Roughly 9 test files and 182 deleted lines in test-named files are in the diff (our `gh` count, approximate). No test was restored afterward in the sources read.
- **Why #23984 was closed [observed]:** the t3dotgg comment (https://github.com/pingdotgg/t3code/pull/23984#issuecomment-6457984449): it "fell 581 commits behind `main` and conflicted in 257 files", so deletions were redone and re-proven on current main. Not a quality rejection.
- **Semantic conflict [observed]:** rebasing found `nextQueuedRun` had changed on main to skip held runs (https://github.com/pingdotgg/t3code/pull/17885); main's version was kept. Dead-code proof goes stale as main moves.
- **Risk noted by the bots [observed]:** Macroscope marked both "Needs Human Approval" (reach of removals not established).

## The pattern

**[inferred]** from the above. Restored/kept tests shared:

1. **Invariant outside the type system.** "Logs never contain the secret", "intervals use elapsed time", "grant is rechecked after revocation". A type-checker cannot see these.
2. **A boundary where simple code breaks.** DST transitions, revocation mid-update, config disabling diff prefixes.
3. **Sole guard.** Each restore PR states nothing else covered the behavior. Deleted tests had "stronger twins".
4. **A named past failure.** Issue or fix PR numbers (#15768, #9438, #5128, #22452, #20094, #21519, #9138).
5. **Product code still ships and is used.** The scheduler, the clipboard helper and the settings panel are live. Tests of dead exports were safe to drop.
6. **Failure-mode visibility.** Restores were checked by mutation or recomputation (DST, grant recheck), so the test provably fails when the guard breaks.

Deleted tests lacked these: copy strings and schema mirrors, duplicate cases, trivial table rows, and tests whose only subject was uncalled code.

## What the bots said

- **Macroscope:** approved all four restores and #24058 on "eligibility alone" (test-only, no product change): https://github.com/pingdotgg/t3code/pull/23977, https://github.com/pingdotgg/t3code/pull/23980, https://github.com/pingdotgg/t3code/pull/23991, https://github.com/pingdotgg/t3code/pull/24011, https://github.com/pingdotgg/t3code/pull/24058#issuecomment-6362451476. It never evaluated the deleted tests' value. "No code objects were reviewed." It asked for human approval on #23984 and #26238.
- **CodeRabbit:** commented on three restores, with weak-assertion nitpicks only. #23977: "Assert that rendering waits for the frame callback" (https://github.com/pingdotgg/t3code/pull/23977#discussion_r4357071165). #23980: the `Error`-in-`JSON.stringify` serializes as `{}` hole in the redaction test (https://github.com/pingdotgg/t3code/pull/23980#pullrequestreview-5625187735). #23991 and #24011 had summaries only. Nothing on #24058 or #26238. Neither bot flagged an over-cut before restore.

## Signals for a reviewer

Flag a PR that removes a test when any of these holds, and ask for the evidence listed:

1. **Name or body mentions secrets, tokens, redaction, auth, grants, permissions.** Ask: what else asserts this is never logged or never allowed? Suggest keeping or moving it.
2. **Test uses time zones, DST, clocks, locales, or dates.** Ask for the replacement that crosses the boundary. A UTC-only test is not a substitute.
3. **Test exists because of a numbered issue or fix PR** (check `git log -S` on the test name). Ask for a reason that the regression cannot recur.
4. **Product code under test still exists and has callers.** Deletion is only safe if the code is deleted too or a "stronger twin" is named by path and line.
5. **Removed test is the only direct test of a module** (lifecycle, cancellation, coalescing, retries, races). Ask which test now covers it.
6. **Claimed "duplicate".** Ask for the twin's path and what it asserts; reject if it checks a weaker property.
7. **Claimed "dead code".** Ask for the caller search (grep or knip) and, for protocol or API surface, the release or tag range checked. Re-run the check at merge time, since main moves.
8. **Table-driven cut.** Accept only if every implementation branch keeps at least one row.
9. **When keeping a test, verify it can fail.** Suggest a mutation check (break the guard, see it fail), as in https://github.com/pingdotgg/t3code/pull/24011.

## Caveats

- Triggers are all agent-driven re-audits by one team; there is no evidence of a production incident or human reviewer asking for any restore.
- #24058 review rounds are only summarized in the PR body, not as threads; reasons for 4 of the 9 restores are not cited.
- Bug classes and the "pattern" are our inference; "29 cases" is the maintainer's count (1+5+7+16).
