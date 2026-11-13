# Cal.com: how it tests

- Date: 2026-11-12
- Status: evidence
- Source commit: https://github.com/calcom/cal.diy/tree/ef7954d16ab50882ca2f263c551537115b8a8bb1
- Related: [index](../README.md)

Note: `calcom/cal.com` now redirects to `calcom/cal.diy`, the open-source edition. Team and org features were removed in April 2026 ([PR 28953](https://github.com/calcom/cal.diy/pull/28953)), so counts describe that smaller tree.

## In one minute

- Observed: four kinds of test, told apart by file suffix. Vitest unit (`*.test.ts`), Vitest real-database integration (`*.integration-test.ts`), Playwright e2e (`*.e2e.ts`), and Jest plus supertest for the NestJS API v2 (`*.e2e-spec.ts`).
- Observed: the stated division of labor is "standard cases in e2e, difficult edge cases in integration-style Vitest" ([booking-limits.test.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/packages/features/bookings/lib/handleNewBooking/test/booking-limits.test.ts)).
- Observed: the PR template and an agent rule require tests ("80%+ for new code"). CI shards e2e 8 ways and retries it twice, but the unit run has no retry.
- Observed: flakiness is fixed one test at a time, with the root cause named in the PR. No quarantine mechanism was found.
- Observed: most flaky fixes are about determinism: unordered DB queries, dangling `fetch` from module imports, waits on UI state.
- Inferred: the e2e suite is expensive enough that it only runs on a label (`ready-for-e2e`), so unit and integration tests carry the fast feedback.

## 1. Test inventory

Counted from the recursive git tree at the commit above (7,712 files, not truncated), using `grep` on paths. File counts, not test-case counts.

| Kind | Tool | Pattern | Files |
| --- | --- | --- | --- |
| Unit | Vitest (mostly) | `*.test.ts(x)`, `*.spec.ts` | 436 (363 `.test.ts`, 55 `.test.tsx`, 18 `.spec.ts`) |
| Unit, timezone rerun | Vitest | `*.timezone.test.ts` | 4 (included above) |
| Integration, real DB | Vitest, `VITEST_MODE=integration` | `*.integration-test.ts` | 15 (13 `packages/features`, 2 `packages/trpc`) |
| Integration, in-memory DB | Vitest + prismock | `*.test.ts` under `handleNewBooking/test/` | not separable by path |
| E2E browser | Playwright | `*.e2e.ts` | 66 (77 files under `apps/web/playwright`, incl. libs) |
| E2E API | Jest + supertest | `*.e2e-spec.ts` | 42 in `apps/api/v2` |
| API unit | Jest | `apps/api/v2/**/*.spec.ts` | 17 (included in the 436) |

- By area, unit files: `packages/features` 187, `apps/web` 117, `packages/lib` 45, `packages/app-store` 33, `packages/ui` 32, `packages/trpc` 31, `packages/embeds` 18, `apps/api` 17.
- Playwright `.e2e.ts` by area: `apps/web/playwright` 77 files, `packages/embeds/embed-core` 8, `packages/platform/examples` 5.
- Ratio: 4,389 non-test `.ts/.tsx` files vs 436 unit (about 1 to 10) and 559 test files of all kinds (about 1 to 8). Observed counts, my own definition of "source".
- Also: k6 load scripts in `packages/testing/performance`; one snapshot-style file set (2 snapshot paths in the tree).
- Configs: [vitest.workspace.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/vitest.workspace.ts) switches modes by env var (unit, integration, timezone, packaged-embed); [playwright.config.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/playwright.config.ts) has projects per package.

## 2. Written guidance

- [CONTRIBUTING.md](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/CONTRIBUTING.md): "More info on how to add new tests coming soon." The testing section is thin; real guidance lives in agent rules.
- [PR template](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/.github/PULL_REQUEST_TEMPLATE.md): checkbox "I confirm automated tests are in place that prove my fix is effective or that my feature works", plus "How should this be tested?".
- [agents/rules/testing-coverage-requirements.md](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/agents/rules/testing-coverage-requirements.md): "Every PR must have near-80%+ test coverage for the code it introduces or modifies." Its example tests behavior (empty schedule, busy times, timezone).
- [testing-playwright.md](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/agents/rules/testing-playwright.md): run through `yarn e2e`; "Never push test code until those tests are passing locally"; skipped e2e makes the required check fail on purpose.
- [testing-mocking.md](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/agents/rules/testing-mocking.md): prefer simple fakes that implement the `Calendar` interface over `mockDeep`.
- [testing-timezone.md](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/agents/rules/testing-timezone.md): run with `TZ=UTC`. [AGENTS.md](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/AGENTS.md) names Vitest (unit) and Playwright (E2E) and says to run relevant tests before pushing.

## 3. CI

Observed from `.github/workflows`:

- Test workflows are `workflow_call` building blocks ([unit-tests.yml](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/.github/workflows/unit-tests.yml), [integration-tests.yml](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/.github/workflows/integration-tests.yml), [e2e.yml](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/.github/workflows/e2e.yml)), composed by [pr.yml](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/.github/workflows/pr.yml) and [all-checks.yml](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/.github/workflows/all-checks.yml).
- Unit: one job, 20 min, `yarn test --no-isolate`, then a second run with `TZ=America/Los_Angeles VITEST_MODE=timezone`.
- Integration: separate job against Postgres, `VITEST_MODE=integration`.
- E2E web: 8 shards, 4 workers each; Playwright `retries: 2` on CI, `forbidOnly` on CI. E2E API v2: 4 shards. Separate embed, embed-react and app-store e2e jobs.
- E2E and builds run only for PRs with the `ready-for-e2e` label; otherwise the aggregate `required` job fails.
- `required` needs lint, type-check, unit, api-v2 unit, integration, builds and all e2e jobs.
- Nightly: no scheduled test workflow found. The `cron-*` files are app jobs; `performance-tests.yml` is manual. Not verified: whether `pr.yml` also triggers on push to main.
- Flaky handling: no quarantine list or flaky-reporter found; only Playwright retries and fix PRs (section 5).

## 4. Unit vs e2e boundary

Stated rule (observed): booking-limits.test.ts says "These integration tests aim to cover difficult-to-test edge cases. Standard cases are currently handled in e2e tests only."

Visible pattern (observed): booking, reschedule, signup, login, payment, embed flows are e2e; formatting, limits math, schedule parsing, services are Vitest. Inferred: the e2e suite checks that pieces connect; the unit suite checks branches.

E2E examples:
- [booking-pages.e2e.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/apps/web/playwright/booking-pages.e2e.ts): creates a user via fixture, loads the public page, checks SSR HTML, OG tags and canonical link. Good: real user-visible output. Weakness: asserts a long encoded OG URL string, brittle.
- [reschedule.e2e.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/apps/web/playwright/reschedule.e2e.ts): `users.create()`, drives the UI, then reads Prisma to confirm status. Good: checks outcome in the database. Parallel mode plus `afterEach` cleanup.
- [booking-seats.e2e.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/apps/web/playwright/booking-seats.e2e.ts): had index-based attendee assertions that flaked ([PR 28672](https://github.com/calcom/cal.diy/pull/28672)).

Unit/integration examples:
- [dateTimeFormatter.test.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/packages/lib/dateTimeFormatter.test.ts): pure function, fixed ISO dates, explicit timezone and locale, asserts content. Good, though some assertions use `toContain` on fragments.
- [booking-limits.test.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/packages/features/bookings/lib/handleNewBooking/test/booking-limits.test.ts): runs `handleNewBooking` on prismock with scenario builders, checks thrown errors and `expectBookingToBeInDatabase`. Good: real behavior. Cost: large setup, heavy fixture vocabulary.
- [CalendarSyncService.integration.test.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/packages/features/calendar-subscription/lib/sync/__tests__/CalendarSyncService.integration.test.ts): despite the name, it uses `vi.mock` for the booking services, so it is unit-like. Inferred: "integration" is used loosely.

## 5. Test hygiene history

All merged PRs; dates are merge or creation dates from `gh`.

1. [PR 15161](https://github.com/calcom/cal.diy/pull/15161) (2024-05-23): skipped tests that "have turned from flakes into regular failures, blocking up the CI pipeline". Skip as last resort.
2. [PR 4072](https://github.com/calcom/cal.diy/pull/4072) (2022-09-02): one Playwright config; introduced `.e2e.ts` suffix "to distinguish between Unit and E2E tests".
3. [PR 22441](https://github.com/calcom/cal.diy/pull/22441) (2025-07-24): unskipped API v1 unit tests by adding mocks for DB and externals; also fixed status codes the tests exposed.
4. [PR 28672](https://github.com/calcom/cal.diy/pull/28672) (2026-03-30): booking-seats e2e flaked because `findMany` had no order and tests used array indices; added `orderBy`.
5. [PR 28773](https://github.com/calcom/cal.diy/pull/28773) (2026-04-07) and [PR 28787](https://github.com/calcom/cal.diy/pull/28787) (2026-04-08): "Closing rpc while fetch was pending"; transitive imports start `fetch` at load time. Fix: mock the module graph, Proxy-based map mock. The PR says all 6,821 tests passed; the error was worker shutdown.
6. [PR 28587](https://github.com/calcom/cal.diy/pull/28587) (2026-03-26): cleanup query scoped to avoid cross-file interference in parallel tests.
7. [PR 29019](https://github.com/calcom/cal.diy/pull/29019) (2026-04-28) with siblings 29012 to 29017: removed integration suites for removed org/team features, verified by running the remaining integration file and type-check.
8. [PR 28953](https://github.com/calcom/cal.diy/pull/28953) (2026-04-22): removed e2e tests hardcoded to removed `/team` and `/org` routes; "pure cleanup".

## 6. Notable patterns

- Fixtures: Playwright `users.create()` / `users.deleteAll()` ([apps/web/playwright/lib/fixtures](https://github.com/calcom/cal.diy/tree/ef7954d16ab50882ca2f263c551537115b8a8bb1/apps/web/playwright/lib)); API v2 repository fixtures under `apps/api/v2/test/fixtures`.
- Builders: [packages/testing/src/lib/bookingScenario](https://github.com/calcom/cal.diy/tree/ef7954d16ab50882ca2f263c551537115b8a8bb1/packages/testing/src/lib/bookingScenario) (`createBookingScenario`, `getOrganizer`, `getBooker`, `expectBookingToBeInDatabase`).
- Prisma: prismock (in-memory) via `packages/testing/src/lib/__mocks__/prisma.ts`; raw SQL still needs `vi.spyOn(prismock, "$queryRaw")`.
- Global setup mocks fetch and several calendar services ([setupVitest.ts](https://github.com/calcom/cal.diy/blob/ef7954d16ab50882ca2f263c551537115b8a8bb1/packages/testing/src/setupVitest.ts)).
- Time: `getDate` helpers and fixed ISO dates; timezone cannot be set per test in Vitest, so the suite is rerun with a different `TZ`.
- Snapshots: rare (2 paths).

## Signals for a reviewer

Good test (checkable):
- Asserts an outcome (DB row, thrown error, rendered text), not that a mock was called.
- Dates and timezone are explicit; no `new Date()` without fake time.
- Queries in assertions are ordered; cleanup is scoped to the test's own data.
- Each module imported by a unit test either is cheap or is mocked, so nothing starts `fetch` at import.

Bad test:
- Index-based reads of unordered results; waits for timers instead of UI state.
- Test added only to hit the coverage number (the 80% rule invites this; inferred).
- Skipped test with no linked reason.

Unit to e2e boundary:
- Pure logic, branch matrices, validation: Vitest. Cross-page flows with auth, redirects, embeds, payments: Playwright. Flag a new e2e that only checks a branch, and a booking-flow change with no e2e or scenario test.

Suggestions to give:
- Move edge cases out of e2e into a scenario test; add `orderBy`; mock heavy imports; name the real kind (unit vs integration) by suffix.

A test-mapping skill could automate:
- Map changed `X.ts` to `X.test.ts`, `__tests__/`, `test/` siblings and to `*.e2e.ts` by route name.
- Flag changed files with none; flag new `.skip`/`.fixme`; flag unordered `findMany` in test files.

## Caveats

- Counts are file counts from path patterns, not test cases or coverage.
- CI trigger conditions were read partially (greps, not full reads); nightly absence is "not found".
- Repo is now the stripped `cal.diy`; Cal.com's hosted product may test more.
- Snapshot and `.skip`/`.fixme` counts were not measured (no clone, no content scan).
