# t3code's big test purge: which tests were deleted, and by what criteria

- Date: 2026-11-12
- Status: evidence
- Related: [index](../README.md), [inventory](01-pr-inventory.md)

Labels: **[Observed]** = stated in the PR or visible in data I fetched. **[Inferred]** = my reading. PRs: [#22557](https://github.com/pingdotgg/t3code/pull/22557) (merged 2026-10-20, author t3dotgg, merge commit [05696c6](https://github.com/pingdotgg/t3code/commit/05696c636ec2a101a763505d820b83891e529ccd)) and [#13922](https://github.com/pingdotgg/t3code/pull/13922) (closed 2026-10-19).

## In one minute

- **[Observed]** #22557 deleted about 11,000 of 25,928 tests (25,928 to 14,847). Per the PR it deleted 456 test files and trimmed 1,195. The files API shows 451 removed files, 1,895 changed files, and 258,735 deleted lines. It cut summed test-file time by 59%.
- **[Observed]** The stated reason is cost and noise, not "tests are bad in general". Release CI failed most of the time on flaky browser tests, and many tests "check things types already guarantee, mirror the code, or wait on real timers".
- **[Observed]** The selection was done by a swarm of Claude Haiku 5.5 agents applying one written rubric (delete list and keep list), two independent passes on about half the files, a third vote on about 1,900 disagreements, and AST-based deletion by test title.
- **[Observed]** Kept: orchestration and event-sourcing correctness, provider protocol translation, auth and permission guards, persistence and migrations, external-format parsing, deterministic race fixes. A human review restored 22 auth tests the swarm had cut as "timing".
- **[Inferred]** The rubric was applied unevenly. Some deleted tests look like real behavior guards (a 32 KiB paste boundary, a memory-retention check, a notification matrix), so the purge optimizes suite cost under a coverage-loss tolerance, not per-test truth.
- **[Observed]** #13922 (about 690 tests, 23 files) was closed by a maintainer taking over, who rebuilt a smaller, layered stack. #22557 merged after one commit, two Sol review rounds, and a rubric that scales.

## Stated criteria (quoted)

From the [#22557 body](https://github.com/pingdotgg/t3code/pull/22557):

- Problem: "a lot of tests check things types already guarantee, mirror the code, or wait on real timers. They cost time and give no signal."
- Delete: "type-redundant, trivial logic, basic DOM behavior, real or fake timers, mock-call mirrors, smoke tests, duplicate table cases, and wall-clock perf asserts."
- Keep: "orchestration and event-sourcing correctness, provider protocol translation, auth and permission guards, persistence and migrations, external-format parsing, and deterministic race fixes."
- Exceptions kept on purpose: both `reactCompilerCoverage.test.ts` ("documented perf guard"), slimmed `bundledDev.test.ts` (guards a Vite upgrade) and `fileEditorVirtualization.test.ts` (guards a patched dependency).
- Correction after review: 22 auth boundary tests "cut as 'timing' (they use the deterministic Effect clock)" were restored.

From the [#13922 body](https://github.com/pingdotgg/t3code/pull/13922) (earlier, narrower): about 6% of 18,029 tests "protected nothing": restated types or constants, only checked mocks, repeated a sibling test, or guarded already-removed code. It also fixed 27 tests that "could never fail", each proven by breaking product code and watching the test fail, and kept 26 flagged tests "when they were the only guard for real behavior" (dev-stage prod database guard, Clerk passkey behavior).

## Where the deletions fell

Aggregated from the [files API](https://api.github.com/repos/pingdotgg/t3code/pulls/22557/files) (deleted lines, files touched, files removed outright). Counts include non-test files (fixtures, exports, docs).

| Area | Deleted lines | Files touched | Removed |
|---|---:|---:|---:|
| apps/server | 91,507 | 433 | 67 |
| apps/web | 69,986 | 588 | 211 |
| apps/mobile | 19,395 | 253 | 90 |
| packages/client-runtime | 18,247 | 147 | 24 |
| apps/desktop | 16,707 | 124 | 17 |
| packages/shared | 6,759 | 93 | 10 |
| infra | 5,954 | 32 | 6 |
| packages/contracts | 5,661 | 40 | 12 |

By kind: `*.browser.test.*` 147 files, 104 removed outright, 26,923 deleted lines (71% of that kind removed whole). Unit `*.test.*` 1,501 files, 347 removed, 227,310 deleted lines (so most unit files were trimmed, not removed).

**[Inferred]** Web carries the most removals (211 files, mostly `components/`: 142 removed test files), consistent with the "flaky browser tests" motive. Server was mostly trimmed (4,840 tests left of 7,478), and `orchestration-v2` lost only 12 whole files.

## Taxonomy of deleted tests

Sample: 27 deleted files across web, mobile, server, desktop, contracts, client-runtime (patches read from the files API). **The classification is mine [Inferred]**; a file can fit several rows, I picked the dominant one.

| Category | Sample count | Example | Why it carried little signal |
|---|---:|---|---|
| Trivial pure logic or constant tables | 9 | [thread-row-emphasis.test.ts](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/mobile/src/features/threads/thread-row-emphasis.test.ts): `expect(shouldRecedeThreadRow({ status: "working", selected: false })).toBe(true)` | Restates a three-line function; a change in the rule is a change in the test. |
| Schema/type-guaranteed decode | 3 | [providerRuntime.test.ts](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/packages/contracts/src/providerRuntime.test.ts) ("decodes turn.plan.updated...") | The Effect Schema already enforces the shape; the test re-asserts it. |
| Mock-call mirror | 4 | [nativeTerminalModule.test.ts](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/mobile/src/features/terminal/nativeTerminalModule.test.ts): `expect(expoMocks.requireNativeView).toHaveBeenCalledWith("T3TerminalSurface")` | Asserts the mock was called the way the code calls it. |
| DOM/shortcut/browser behavior | 4 | [RightPanelTabs.keyboard.browser.test.tsx](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/web/src/components/RightPanelTabs.keyboard.browser.test.tsx) (317 lines) | Slow, real browser, per-platform matrix; flake source. |
| Fake/real timers | 1 | [useLiveRefresh.browser.test.tsx](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/web/src/hooks/useLiveRefresh.browser.test.tsx): `vi.advanceTimersByTime(44_999)` | Pins a 45 s constant via a simulated clock. |
| Schema-only migration | 1 | [047_ProjectionProjectIcon.test.ts](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/server/src/persistence/Migrations/047_ProjectionProjectIcon.test.ts): `PRAGMA table_info` then `assert.equal(projectIcon?.notnull, 0)` | Checks a column exists; the migration itself is the spec. |
| Platform/environment-bound | 3 | [PortalCaptureShortcut.dbus.test.ts](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/desktop/src/snapShot/PortalCaptureShortcut.dbus.test.ts): `it.runIf(spawnSync("dbus-daemon"...))` | Runs only where a daemon exists; skipped or flaky elsewhere. |
| Subprocess memory/GC check | 1 | [detachStackFrame.memory.test.ts](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/server/src/git/detachStackFrame.memory.test.ts) (`--expose-gc` child process) | Slow and environment-sensitive. Arguably a real guard (see Caveats). |
| Cache/async state with expiry | 1 | [sourceHighlightingState.test.ts](https://github.com/pingdotgg/t3code/blob/c3540a7854f693db52dc61e6920295665538fabc/apps/mobile/src/features/files/sourceHighlightingState.test.ts) ("recomputes after the idle cache entry expires") | Time-dependent cache behavior; I did not verify whether it used fake timers. |

"Duplicate of another layer", "test-only export" and "snapshot of trivial output" appear in the rubric or follow-on cleanup but I did not isolate a clear sample file for them. The test-only export effect is visible in the PR: about 420 exports that only deleted tests used were un-exported, and about 48 declarations nothing called were deleted.

## What was kept and why

**[Observed]** Contrast inside the same area, at the [merge commit](https://github.com/pingdotgg/t3code/commit/05696c636ec2a101a763505d820b83891e529ccd):

- `apps/server/src/persistence/Migrations`: 10 test files deleted, 16 kept. Deleted ones are mostly index or column additions (`019_ProjectionSnapshotLookupIndexes`, `029_..OrderingIndexes`, `056_RemoveRedundantProjectionIndexes`, `047_ProjectionProjectIcon`). Kept ones transform data: [046_RepairAutomaticSettlementTimestamps](https://github.com/pingdotgg/t3code/blob/05696c636ec2a101a763505d820b83891e529ccd/apps/server/src/persistence/Migrations/046_RepairAutomaticSettlementTimestamps.test.ts) ("repairs automatic stamps and leaves manual settlement alone"), [031_AuthAuthorizationScopes](https://github.com/pingdotgg/t3code/blob/05696c636ec2a101a763505d820b83891e529ccd/apps/server/src/persistence/Migrations/031_AuthAuthorizationScopes.test.ts) ("invalidates role-based auth records..."), [064_CanonicalizeThreadPullRequestLinks](https://github.com/pingdotgg/t3code/blob/05696c636ec2a101a763505d820b83891e529ccd/apps/server/src/persistence/Migrations/064_CanonicalizeThreadPullRequestLinks.test.ts). **[Inferred]** The line: "does data survive or get repaired" is kept; "does the column exist" is not.
- `apps/server/src/auth`: 0 files deleted, 10 trimmed. [RpcAuthorization.test.ts](https://github.com/pingdotgg/t3code/blob/05696c636ec2a101a763505d820b83891e529ccd/apps/server/src/auth/RpcAuthorization.test.ts) survives, including "declares exactly one scope for every RPC in the server group", an invariant over a whole table, plus per-method scope assertions. [SessionStore.test.ts](https://github.com/pingdotgg/t3code/blob/05696c636ec2a101a763505d820b83891e529ccd/apps/server/src/auth/SessionStore.test.ts) keeps expiry, rotation and token-signing tests.
- `apps/server/src/orchestration`: no deletions in the files list; `orchestration-v2` lost 12 whole test files but kept most.
- Guards for build tooling and perf (React compiler coverage, Vite, patched dependency) were kept explicitly with a reason.

## #13922 vs #22557

| | [#13922](https://github.com/pingdotgg/t3code/pull/13922) | [#22557](https://github.com/pingdotgg/t3code/pull/22557) |
|---|---|---|
| Size | about 690 tests, 23 files, 397 paths, +15,100 lines changed | about 11,000 tests, 1,895 paths |
| Motive | Quality: tests that protect nothing, plus fix 27 that could never fail | Cost: CI time and flakes |
| Method | Manual or agent read, mutation proof for fixes | Rubric + Haiku swarm + double pass + AST deletion |
| Proof | Break code, see test fail, revert | Before/after counts and wall time per package |
| Outcome | Closed | Merged |

**[Observed]** The comment that closed #13922 came from a different maintainer (juliusmarminge), not the author. He said the PR "correctly identified tests that passed without reaching their guard, missing suite discovery, and a substantial amount of constant/library/mock-only coverage", but that main had moved to V2 so obsolete repairs were omitted, and "uncertain deletions were preserved rather than chasing the old ~1,000-test count". He rebuilt it as four layered PRs ([#21848](https://github.com/pingdotgg/t3code/pull/21848) assertion repairs, [#21849](https://github.com/pingdotgg/t3code/pull/21849) suite discovery, [#21850](https://github.com/pingdotgg/t3code/pull/21850) client pruning, [#21851](https://github.com/pingdotgg/t3code/pull/21851) runtime pruning). His classification of the 397 paths: 263 preserved, 30 pruned, 88 superseded or moved, 16 repaired. Source: [closing comment](https://github.com/pingdotgg/t3code/pull/13922#issuecomment-6274313370).

**[Inferred]** Why one closed and one merged: #13922 was stale against a moving main (the V1 to V2 move), and a review stack was judged safer than one big diff. #22557 changed the goal from "find bad tests" to "cut the cost of the suite", accepted a lossy rubric, was rebased on a fresh head, and was verified by suite-level numbers. I found no human review comments on #22557; only bots and an explainer comment. Macroscope flagged it as "Needs Human Approval" because it touches auth directories and removes auth coverage.

## Process

**[Observed]** AI-assisted end to end. "Created with Claude Opus 5.5 (test selection by Claude Haiku 5.5) in Claude Code." Selection: Haiku swarm, one rubric, two passes on 987 files, third vote on about 1,900 disagreements. Edits: TypeScript AST scripts matched by title, unused imports removed the same way. Review: "sol-loop: 2 rounds with GPT-6.1 Sol... approved". Verification: typecheck, lint, fmt, knip, per-package before/after timing with the vitest JSON reporter. #13922 and its replacement stack also state AI authorship (Opus 5.5, GPT-6.1-Sol, GPT-6-Astra). No eval of the rubric's precision is reported; the only quality check described is the human/Sol review that restored 22 tests.

## Signals for a reviewer

Each is a checkable heuristic. They describe what this maintainer treated as low signal, not universal truth.

- **Bad test (flag):**
  1. Every assertion is `toHaveBeenCalledWith` on a mock the test itself configured.
  2. The test decodes a literal through a schema and asserts the same fields the schema declares.
  3. The expected value is a literal copy of a constant or table in the code under test.
  4. Fake timers advance to a constant that is also in the source (`advanceTimersByTime(44_999)` against `45_000`).
  5. Table rows whose inputs hit the same branch as a sibling row.
  6. A test of an export that has no production caller (knip flags it).
- **Good test (keep):** the test fails if a real invariant breaks: an auth or scope guard, an invariant over the whole table (every RPC has exactly one scope), a data-transforming migration with before/after rows, a parser of an external format, a deterministic race fix.
- **Unit vs e2e:** in this PR the browser-test tier was cut hardest (71% of `*.browser.test.*` files removed whole) for flake and time. Suggest a unit test of the logic extracted from a component, not another browser test of DOM or shortcut behavior.
- **What to suggest:** replace a mock-mirror with an input/output test of the pure function; mutate the product code and check the test fails (the #13922 method); delete a test whose only failure mode is an edit to its own constant.
- **Automatable by a mapping skill:** (a) ratio of `expect(...).toHaveBeenCalled*` to value assertions per test; (b) test titles or paths touching `auth`, `permission`, `scope`, `migration`, `parse` get a "protected area" flag, and deletions there need a reason; (c) deleted-test diff vs. the file's remaining coverage of the same function; (d) fake-timer use plus a numeric literal that appears in source; (e) exports referenced only from test files.

## Caveats

- The swarm's deletions are not a ground truth of "bad": some deleted tests look meaningful (the 32 KiB UTF-8 paste boundary in `textPaste.test.ts`, the notification matrix, the memory-retention check), and the PR says its own rubric lists migrations as kept while 10 migration tests were cut. I did not check whether coverage elsewhere replaces them.
- My sample is 27 files (about 6% of removed files), skewed toward larger ones; the taxonomy counts are indicative, not a distribution.
- The PR says 456 deleted files; the files API shows 451. I did not reconcile this.
- I did not read #22557 inline review threads beyond the API listing (none found) or the commit history (a single commit).
