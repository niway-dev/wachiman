# t3code: the pull requests that removed and set up tests

- **Date:** 2026-11-12
- **Status:** evidence inventory. Counts of test files come from a path regex (`.test.`, `.spec.`, `__tests__`, `/test/`, `/tests/`) and are approximate.
- **Related:** [index](../README.md)

## In one minute

- Between 2026-09-27 and 2026-10-28, t3dotgg opened five pull requests that removed tests. Three merged (#22557, #24058, #26238) and two were closed without merging (#13922, #23984).
- The largest merged removal, #22557, deleted about 11,000 of 25,928 tests (about 451 test files). The PR body gives the reason: the suite was "huge and noisy" and many tests checked things the types already guarantee, mirrored the code, or waited on real timers.
- The removals were not all clean. Review rounds in #24058 restored 9 tests it had cut. On 2026-10-23, four separate PRs restored 29 more test cases that had been removed.
- Test setup came before the removals. From 2026-02-08 to 2026-10-28, the repo gained a root Vitest config, CI test steps, browser tests, per-package configs, a lint rule against DOM test environments, and a testing guide with a review agent.
- The review bots did not judge test quality. CodeRabbit left no comment on any deletion PR. Macroscope flagged the deletion PRs by rule (size, and paths that touch authentication), not by reading which tests mattered. Neither bot anticipated the 29 cases that had to be restored.

## Removed tests

All five PRs were opened by t3dotgg. Diff counts are from the PR metadata. Test file counts are approximate (see Caveats).

| PR | Title | State | Diff | Files changed | Test files removed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| https://github.com/pingdotgg/t3code/pull/13922 | test: cut ~1,000 useless tests and fix 27 that could never fail | Closed, not merged (2026-09-27 to 2026-10-19) | +985 / -15100 | 397 | 23 (about 690 tests and about 360 table rows) | Macroscope: "Not approved" (large test cleanup, touches auth): https://github.com/pingdotgg/t3code/pull/13922#issuecomment-5853088039 . CodeRabbit: no comment. |
| https://github.com/pingdotgg/t3code/pull/22557 | test: delete 11k low-signal tests so CI runs faster and flakes less | Merged (2026-10-20 to 2026-10-21) | +5771 / -258735 | 1895 | About 451 (the PR body says 456; 461 removed files including fixtures). About 11,000 of 25,928 tests. | Body: the suite "got huge and noisy" and many tests "check things types already guarantee, mirror the code, or wait on real timers." Macroscope: "Needs Human Approval": https://github.com/pingdotgg/t3code/pull/22557#issuecomment-6304299813 . Macroscope said "Approvability was decided on eligibility alone," so it did not review the contents. CodeRabbit: no comment. |
| https://github.com/pingdotgg/t3code/pull/23984 | chore: delete 20k lines of code that nothing reaches | Closed, superseded by https://github.com/pingdotgg/t3code/pull/26238 (2026-10-23 to 2026-10-28) | +5550 / -26055 | 920 | 14 | Mentions fixtures left behind by #22557. Macroscope: "Needs Human Approval": https://github.com/pingdotgg/t3code/pull/23984#issuecomment-6359907474 . |
| https://github.com/pingdotgg/t3code/pull/24058 | test: delete low-value tests and dead test-only exports | Merged (2026-10-23) | +69 / -2630 | 49 | 7 (126 cases) | Review rounds restored 9 tests that had been cut too far. Macroscope: approved: https://github.com/pingdotgg/t3code/pull/24058#pullrequestreview-5626775551 . |
| https://github.com/pingdotgg/t3code/pull/26238 | chore: delete 18k lines of code that nothing reaches | Merged (2026-10-28) | +4192 / -22141 | 876 | 9 | Described as "code that only its own tests keep alive." Macroscope: "Needs Human Approval": https://github.com/pingdotgg/t3code/pull/26238#issuecomment-6458027702 . |

## Set up tests

| Date | Author | Change | What it set up | Bot review |
| --- | --- | --- | --- | --- |
| 2026-02-08 | t3dotgg | Commit https://github.com/pingdotgg/t3code/commit/68d778ba50ce5d8067f585c418898a93852feafe (no PR) | Root `vitest.config.ts`, Vitest ^3, and the `test` script `turbo run test` | Not applicable (no PR) |
| 2026-02-08 | t3dotgg | Commit https://github.com/pingdotgg/t3code/commit/2fc933652828b51f35b48579c86b71858224b10c (no PR) | `.github/workflows/ci.yml` step "Lint, Typecheck, Test" | Not applicable (no PR) |
| 2026-03-04 | juliusmarminge | https://github.com/pingdotgg/t3code/pull/162 | Vitest at the root and in the web app | CodeRabbit skipped. Macroscope: 13 inline comments. |
| 2026-03-05 | juliusmarminge | https://github.com/pingdotgg/t3code/pull/167 (inside a timeline PR) | Browser tests (`vitest.browser.config.ts`, Playwright in CI) | Macroscope comments only on the timeline code, not on the test setup. |
| 2026-06-03 | juliusmarminge | https://github.com/pingdotgg/t3code/pull/2899 (+16444 / -4575) | Vite+ and pnpm migration, with a `vite.config.ts` per package | Macroscope: 4 blocking issues: https://github.com/pingdotgg/t3code/pull/2899#issuecomment-4597936962 |
| 2026-09-04 | juliusmarminge | https://github.com/pingdotgg/t3code/pull/9538 | On-demand Windows test workflow | Not recorded |
| 2026-10-19 | juliusmarminge | https://github.com/pingdotgg/t3code/pull/21937 | oxlint rule `t3code/no-dom-test-environment` | Not recorded |
| 2026-10-21 | t3dotgg | https://github.com/pingdotgg/t3code/pull/22714 "local test runs use package configs and a clean env" | Local test runs use each package's config. The PR says: "In 14 days, 501 of 1,012 agent server test runs started from the root and lost the server setup." | CodeRabbit: 1 actionable: https://github.com/pingdotgg/t3code/pull/22714#pullrequestreview-5596182940 |
| 2026-10-23 | t3dotgg | https://github.com/pingdotgg/t3code/pull/23983 | The no-polling-loop-in-tests rule becomes an error | Not recorded |
| 2026-10-28 | t3dotgg | https://github.com/pingdotgg/t3code/pull/26166 "New tests extend existing cases and stay at one layer" | Testing guidance, a test-signal review agent, and evals | CodeRabbit: 8 inline comments: https://github.com/pingdotgg/t3code/pull/26166#discussion_r4395011373 |

## Restores

Four PRs, all merged on 2026-10-23, each restored one test file. Together they restored 29 test cases. The "+N" figures below are the diff additions recorded in the source notes. They are not case counts. The 29-case total is the case count from the same notes.

- https://github.com/pingdotgg/t3code/pull/23977: render scheduler (+27)
- https://github.com/pingdotgg/t3code/pull/23980: clipboard secret redaction (+92)
- https://github.com/pingdotgg/t3code/pull/23991: DST scheduling (+131)
- https://github.com/pingdotgg/t3code/pull/24011: project settings permissions (+556)

I found no later bulk restoration. The same-day restoration in #24058 (9 tests) is listed under Removed tests.

## What the review bots said

- **CodeRabbit** left no comment on any of the five removal PRs. It did comment on the setup PRs (#22714 and #26166).
- **Macroscope** marked the large removal PRs "Not approved" or "Needs Human Approval" (#13922, #22557, #23984, #26238). It approved #24058. For #22557 it said its decision came from eligibility rules alone, not from reading the tests. Its notes on the other PRs point to size and to changes in authentication code.
- **Neither bot** flagged the tests that had to be restored later. The 29 restored cases show that a rule-based review does not replace a review of which tests matter.

## Caveats

- Test file counts come from a path regex, so they are approximate. Each count is a file count, not a test count, unless the row says otherwise.
- #22557's body says 456 removed test files. The metadata gives about 451 test files and 461 removed files including fixtures. The table shows the range.
- #12977 is excluded. Its base was stale and its noise could not be verified.
- The search covers only from 2026-02-08 onward. Earlier history was not checked.
- The figures come from the verified data for this inventory. I did not re-check them against GitHub in this pass, and I did not run git.
