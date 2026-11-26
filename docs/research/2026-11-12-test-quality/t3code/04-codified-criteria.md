# t3code: testing rules the maintainers wrote down

- Date: 2026-11-12
- Status: evidence
- Related: [index](../README.md), [inventory](01-pr-inventory.md)

Source repository: https://github.com/pingdotgg/t3code. All file links point at `main` as read on 2026-11-12.

## In one minute

- After deleting about 11,000 tests, tests grew back from 9,316 to 10,991 in five days (about 335 a day). The maintainers found the cause was accumulation, not bad single tests: a new `it` per fix, the same case at several layers, copy text under test (https://github.com/pingdotgg/t3code/pull/26166).
- Their written rules reduce to three: test only behavior that can break, extend an existing case before adding one, and test at one layer (the lowest that fails on `main`).
- Their review agent (`test-signal`) is deliberately one-sided: it may ask for fewer or smaller tests, never for more coverage, and answers `All clear` when it finds nothing.
- Wait-related flakiness is handled by lint, not prose: five test-only rules ban sleeps, polling, wall-clock deltas, per-test timeouts and frame waits.
- Their eval has 9 cases (5 bad, 4 guard). Guards include a good bug-fix test and a legitimate new table row, so "flag less" is measured as hard as "flag more".
- The purge overshot: four restore PRs brought back 29 deleted cases, with the condition that twice as many low-value tests be deleted first (https://github.com/pingdotgg/t3code/pull/24058).

## The written guidance

Two files carry the same rules and must change together: [docs/internals/testing.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/testing.md) (also written for review bots) and [AGENTS.md](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md) (lines 105-126, written for coding agents). Introduced by https://github.com/pingdotgg/t3code/pull/26166 (merge commit https://github.com/pingdotgg/t3code/commit/68495b641b3e5834421b6549751eb65ed66fc6f4).

What to test:
- "Test behavior that can break, such as orchestration and event-sourcing, provider protocol translation, auth and permission guards, persistence and migrations, external-format parsing, race fixes."
- Leave out: "what types already guarantee, trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to static markup."
- "Extend before you add... Write a new `it` only when no case fits."
- "Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test, at each call site, or in web and mobile copies."
- Browser tests only for "layout and scrolling, focus and pointer input, real workers, or a component wired to its hooks". Logic goes to `*.logic.test.ts`, because a browser test file costs seconds of module loading and a unit test milliseconds.

Bug-fix proof depends on the bug:
- Logic, data, state and protocol bugs: "a failing test first (the fewest that fail on `main` for that reason...)", then the fix.
- Purely visual bugs: before/after captures and "no test"; do not ask for a UI test when a capture shows it.
- Server-only fix with no visible surface: the test plus a short runtime transcript.

Review guidance: ask for a missing test "only when it would catch a real regression. Do not ask for one assertion per constant, label, or `switch` case." When flagging, name the fix: "fold it into the existing case or table, delete it, keep one layer, or move a browser test whose assertions would pass without rendering into a unit test."

Waiting rules: drain the effect worker or await the specific `Deferred`/event; "A test that needs a timeout to pass is wrong." `it.effect` runs on a `TestClock`; `it.live` only for subprocess or network fixtures. No `retry` ("flaky tests are fixed, not retried"), no elapsed-time assertions, `it.skip` needs `// quarantine: #1234 <why>`.

Browser-test conventions: `await using screen = await render(...)`, no lifecycle hooks, no module-level mutable state, `router: false` only with a one-line reason.

## The test-signal agent

File: [.macroscope/check-run-agents/test-signal.md](https://github.com/pingdotgg/t3code/blob/main/.macroscope/check-run-agents/test-signal.md). The prompt is 27 lines and mostly a pointer to the guidance.

- Scope: "only the tests this pull request adds or grows. Tests it moves, renames, or deletes are not findings." It includes `**/*.test.*`, overriding the repo-wide ignore of test files.
- Criteria: it reads `## What to test` in `testing.md` and holds new tests to it. The rules live in one place, not duplicated in the prompt (an earlier draft had them inline; CodeRabbit's review pushed on wording there, see below).
- Output: one brief inline comment per finding with one fix. "Ask only for fewer or smaller tests, never for more coverage." No findings: the entire reply is exactly `All clear`.
- Config: model `gpt-6-1-terra`, reasoning low, budget 1 run, 5 per PR, `conclusion: neutral` (never blocks the merge).

## The evals

Files: [evals/test-signal/README.md](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/README.md), [cases.ts](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/cases.ts), [grade.ts](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/grade.ts). Purpose: cut the prompt to the fewest words that still work, on a cheap model.

Grading: a bad case passes when an inline comment lands inside a target test (2 lines of slack above). A guard case passes only if there are zero comments and the reply is exactly `All clear`. Default: 2 samples per case, a third if they disagree.

Bad cases (must be flagged):
1. Copy text asserted at every call site: "PR" vs "MR" label tested in 11 files (real, https://github.com/pingdotgg/t3code/pull/23999).
2. Same two cases added to a service test and its wrapper test (real, https://github.com/pingdotgg/t3code/pull/22452).
3. A new `it` next to a table that already covers the behavior (synthetic).
4. A test asserting the mock call the code makes, already covered above it (synthetic).
5. A test checking a return type the signature declares (`typeof x === "boolean"`) (synthetic).
6. A browser test that never renders, for a pure function in a `.logic.ts` file (synthetic).

Guard cases (must stay silent):
1. A deadlock race fix with its test (https://github.com/pingdotgg/t3code/pull/22094).
2. A clone retry fix (https://github.com/pingdotgg/t3code/pull/23170).
3. A diff that only deletes tests (https://github.com/pingdotgg/t3code/pull/22592).
4. The right way to add the case from bad #3: a new row in the existing table.

Note: the PR body says 5 bad and 4 guard; `cases.ts` lists 6 bad on the main ref I read, so the set grew after merge.

## Rules enforced by lint

Plugin: [oxlint-plugin-t3code/rules/](https://github.com/pingdotgg/t3code/tree/main/oxlint-plugin-t3code/rules). Quoted messages are the rules' own.

- `no-polling-loop-in-tests`: loops that wait on `yieldNow`/`sleep` with a predicate decide-to-continue. Counter-bounded flushes are allowed. "Spinning on `yieldNow`/`sleep` is scheduler- and load-dependent." Promoted from warn to error in https://github.com/pingdotgg/t3code/pull/23983: "A warn that exits 0 only grows." 14 files with 25 hits stay at warn as a burn-down list.
- `no-real-time-wait-in-tests`: real-clock waits; also flags TestClock sleeps that nothing advances (the test "can only time out") and mixed `setTimeout`/`Effect.sleep`. The blanket browser-test exemption was removed after measuring zero fires in 53 browser files.
- `no-wall-clock-in-tests`: `Date.now()`/`performance.now()` readings; "elapsed-time assertions pass or fail with runner load." Readings that feed a mock are allowed.
- `no-test-timeout-or-unreasoned-skip`: per-test timeouts and retries "hide waits that should be event-driven"; skips need a quarantine comment with an issue.
- `no-frame-waits-in-browser-tests`: `requestAnimationFrame`/`transitionend` waits "race the renderer".
- `require-disposable-render`: browser tests must use the disposable `render` helper; bans raw `react-dom/client`, `act` around real input, lifecycle hooks.
- `no-dom-test-environment` (https://github.com/pingdotgg/t3code/pull/21937): rejects every `@vitest-environment` pragma and jsdom/happy-dom imports. "Web DOM tests belong in `*.browser.test.{ts,tsx}`." The motivating test used a jsdom pragma to bypass the browser project, then was rewritten to check real Chromium focus; reverting the fix made it fail (1 failure, 2 passes), which was the proof it tests something.
- `no-test-in-loop` (use `.each`) and `no-manual-effect-runtime-in-tests` (use `it.effect` with test layers).

## Test infrastructure decisions

From https://github.com/pingdotgg/t3code/pull/22714:
- Problem: "501 of 1,012 agent server test runs started from the root" and lost the server setup (git config, `fileParallelism: false`, 120 s timeouts); 21 web browser runs from the root failed.
- Fix: the root config lists package configs as `test.projects` when run from the root; package-directory runs (all of CI) are unchanged.
- Clean env: a setup file deletes `ANTHROPIC_*`, `CLAUDE_*`, `CODEX_*`, `OPENAI_*`, `T3CODE_*` in every Node test project, because agent shells carry proxy tokens that failed a provider-registry test. Opt-out: `T3CODE_TEST_KEEP_PROVIDER_ENV=1`.
- DOM: web DOM tests run in real Chromium; mobile jsdom tests moved to a dedicated project so the lint guard needs no allowlist.
- Hooks and CI: https://github.com/pingdotgg/t3code/pull/26167 makes the pre-commit hook run lint and knip, because lint was the most common CI failure (13 of 40 sampled): fix agent mistakes "as high up as possible: in code or tooling first, prose last".

## What the bots said

On https://github.com/pingdotgg/t3code/pull/26166 the GitHub API returns 3 inline comments and 3 reviews from `coderabbitai[bot]`, not 8 (the 8 may count review-level or collapsed items).
- https://github.com/pingdotgg/t3code/pull/26166#discussion_r4395011373 (minor): the agent prompt said an existing case "in the same file" covers a behavior, but the general rule has no file restriction. Suggested removing it so duplicates in other files are caught. This is a real engagement with the test rules.
- https://github.com/pingdotgg/t3code/pull/26166#discussion_r4395617622: replies that the current check no longer contains the restriction, since it delegates to `testing.md`.
- https://github.com/pingdotgg/t3code/pull/26166#discussion_r4395689673 (minor): the eval CLI lacked a documented `--baseline` flag. Tooling only, not about test rules.

CodeRabbit did not judge the rules themselves; it checked the prompt for consistency with them. The same PR widened CodeRabbit's test glob to `**/*.test.*` after the old `{ts,tsx}` pattern missed 13 `cjs/mjs/js/py` tests.

## Signals for a reviewer

Good test (checkable):
- Fails on `main` before the fix, for the bug's reason; the PR shows how (revert-the-fix run, as in https://github.com/pingdotgg/t3code/pull/21937).
- Targets one of the named risk areas: persistence, auth guards, protocol translation, parsing, a race.
- Is a row or assertion in an existing table or case when one covers the behavior.
- Waits on a `Deferred`, event, or drained worker, never a duration.
- Assertions can fail: the restored permission tests were found to "pass if the guard never ran" (https://github.com/pingdotgg/t3code/pull/24011).

Bad test (checkable):
- Asserts copy text, a constant, or a `switch` case per test.
- Mirrors the implementation's mock call (`toHaveBeenCalledWith` of what the code just did) or restates a declared type.
- The same case appears in a wrapper, at each call site, or in both web and mobile copies.
- A browser test whose assertions would pass without rendering.
- New `it` adjacent to a table or `it.each` that already covers the input.
- Contains `sleep`, polling, `Date.now()` deltas, `retry`, a timeout argument, or an unreasoned `skip`.

Boundary rule: place the test at the lowest layer that fails on `main`. Pure logic goes to a unit test beside it; a real browser only for layout, scrolling, focus, pointer input, workers, or hook wiring. Visual-only fixes get captures, no test.

Suggestions to give: always one concrete fix: fold into the existing case, delete, keep one layer, or move to a unit test. Never ask for more coverage than a real regression would need.

What a mapping skill could automate:
- Find existing tests for the changed symbol and report whether a table or `it.each` already covers the new input (extend-before-add).
- List other layers (wrapper, call sites, web/mobile twins) that assert the same expectation.
- Classify a browser test as render-dependent or not.
- Flag banned waiting constructs (cheap regex, and already lint-enforced upstream).
- For a bug fix, check that the test touches the fixed code path and ideally fails on the base commit.

## Caveats

- t3code is an agent-heavy codebase with an event-sourced server and the Effect library; rules such as `TestClock` and `drain` are stack-specific and do not transfer literally.
- The rules are a reaction to an over-growth problem; the purge also over-deleted (29 cases restored), so deletion advice needs a guard for risk areas.
- I did not read the full `run.ts`, the eval run results, or how often the agent actually fires; effectiveness is unmeasured here. The `docs/testing*` search found only `docs/internals/testing.md`; `CONTRIBUTING.md` and `CLAUDE.md` add nothing test-specific (CLAUDE.md just imports AGENTS.md).
