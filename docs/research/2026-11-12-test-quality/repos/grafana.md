# Grafana: how it tests

- Date: 2026-11-12
- Status: evidence
- Source commit: https://github.com/grafana/grafana/tree/59a3f879c9d6a18eca0e0070db23d88901f9e7da
- Related: [index](../README.md)

Method: git tree API at the commit above (not truncated) plus a blobless sparse clone of `*_test.go` files, counted with grep. Everything labeled "observed" was read or counted; "inferred" is my reading.

## In one minute

- Observed: Go has 2,653 test files vs 4,640 non-test files; frontend has about 2,900 `*.test.ts(x)` files; Playwright has 244 specs. Unit tests dominate; e2e is small.
- Observed: the integration boundary is a naming contract. `TestIntegration*` means "needs the SQL database matrix" (SQLite, MySQL, Postgres). Tests that merely combine components or use in-memory storage must use plain `Test*` names.
- Observed: the written frontend rule is an "inverted testing diamond" with a strict "assert behavior, not existence" bar, and an AI-slop checklist, shipped as a repo skill.
- Observed: Cypress is gone (removed April 2026); e2e is Playwright only. Betterer was also removed (Sept 2025) in favor of ESLint suppressions.
- Observed: flaky tests are handled by skip-with-TODO, fix, or reclassification, not by retry-everything. CI retries Playwright once.
- Inferred: much of the signal for a reviewer is in mismatches between a test's name/location and what it actually needs (database, clock, browser).

## 1. Test inventory

| Kind | Count (observed) |
| --- | --- |
| Go `*_test.go` | 2,653 (pkg 2,411; apps 240) vs 4,640 non-test `.go` (pkg 3,512; apps 1,107) |
| Go `func Test*` | 12,002; of which `func TestIntegration*` 1,553 in 555 files |
| `SkipIntegrationTestInShortMode` calls | 1,031 |
| `pkg/tests/` (boots a real server via `testinfra`) | 345 test files, 297 with `TestIntegration*` |
| Jest/RTL `public/` | 2,349 `*.test.ts(x)` vs 4,807 source files; `packages/` 560 vs 1,472 |
| Playwright `e2e-playwright/` | 244 `*.spec.ts` (panels-suite 59, dashboard-new-layouts 49, dashboards-suite 34, various-suite 30) |
| Snapshots | 72 `.snap` files |
| Cypress | 0 files |

Go style counts (observed): 1,208 files use table-driven loops; 2,010 use `t.Run`; 2,310 import `testify/require`; 217 import `testify/mock`; 13 import gomock; 119 use `testing/synctest`; 285 `time.Sleep` lines remain; 71 `*fake*.go` and 151 `*mock*.go` files exist.

## 2. Written guidance

- Go: [contribute/backend/style-guide.md](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/contribute/backend/style-guide.md) has an Integration Tests section: "Reserve this prefix for tests that need coverage across these SQL databases, not simply tests that combine several components or happen to use a database." It adds: "If you do not follow this convention, your integration test may be run twice or not run at all." Also `require` for hard checks, `assert` for soft checks, `t.Cleanup` over `defer`, `t.Run` only for cases, not to group assertions.
- [AGENTS.md](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/AGENTS.md): "use `testing/synctest` over sleeps and time-based assertions"; frontend tests follow the `frontend-testing-strategy` skill; `make test-go-unit`, `make test-go-integration`, `pnpm e2e:playwright`.
- [.claude/skills/frontend-testing-strategy/SKILL.md](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/.claude/skills/frontend-testing-strategy/SKILL.md): "assert concrete behavior, not existence"; rejects `toBeDefined`, `not.toThrow`, length-mirrors-input; "Do not simply update failing tests to pass after changing behaviour"; "Minimize mocking"; never mock `@grafana/runtime/internal` to fake a feature flag; anti-flake rules; do not add tests to modules slated for deletion.
- [contribute/style-guides/testing.md](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/contribute/style-guides/testing.md): prefer `*ByRole` queries and `userEvent.setup()` over `fireEvent`.
- [PR template](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/.github/PULL_REQUEST_TEMPLATE.md) only says "Ensure you include and run the appropriate tests"; no test checklist (observed).

## 3. CI

- Observed, [backend-unit-tests.yml](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/.github/workflows/backend-unit-tests.yml): `go test -short` over packages split by `scripts/ci/backend-tests/shard.sh` (shard count in matrix).
- Observed, [pr-test-integration.yml](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/.github/workflows/pr-test-integration.yml): separate SQLite, MySQL 8.0 and Postgres jobs, each sharded; packages found by `pkgs-with-tests-named.sh -b TestIntegration`; runs `-run '^TestIntegration'` with `GRAFANA_TEST_DB` set; MySQL/Postgres run `-p=1`. There is also a pgvector workflow.
- Observed, [pr-frontend-unit-tests.yml](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/.github/workflows/pr-frontend-unit-tests.yml): Jest in 8 shards (`pnpm run test:ci`).
- Observed, [pr-e2e-tests.yml](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/.github/workflows/pr-e2e-tests.yml): builds backend and frontend once, runs Playwright in 8 shards, plus a Storybook Playwright job. [playwright.config.ts](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/playwright.config.ts): `retries: CI ? 1 : 0`, `workers: 4` on CI, `trace: 'retain-on-failure'`.
- Observed: change-detection jobs skip suites when relevant code did not change. No automatic flaky quarantine job found (inferred from absence in the workflow list).

## 4. Unit vs integration vs e2e

Stated rule (observed): pick the layer by job; logic/IO is unit, composition is integration or visual, a key user journey is e2e, "keep it targeted and few". Go side: SQL-matrix need is the only thing that earns "integration".

- Unit, Go: [pkg/util/strings_test.go](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/pkg/util/strings_test.go), a table of inputs and expected outputs. Good: pure function, small. Weak: bare tuples with no case names.
- Integration, Go: [pkg/tests/api/folders/api_folder_test.go](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/pkg/tests/api/folders/api_folder_test.go): `TestIntegration*` wrappers run each scenario under a feature-toggle matrix via `testinfra`, boots a real server. Appropriate; 956 lines is heavy.
- Unit/component, frontend: [DashboardPicker.test.tsx](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/public/app/features/alerting/unified/components/rule-editor/DashboardPicker.test.tsx): RTL with `setupMswServer()` (network mocked at HTTP level, real component code), behavior-named cases such as "lists panels within collapsed rows of a legacy dashboard". Only one narrow module mock (virtualized sizer).
- E2E: [dashboard-links-without-slug.spec.ts](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/e2e-playwright/dashboards-suite/dashboard-links-without-slug.spec.ts): imports a fixture dashboard through the API in `beforeAll`, sets a feature toggle, tags `@dashboards`. Sound: setup via API, UI only for the journey.

Cypress to Playwright (observed): suites removed one by one in July-Aug 2025 ([#108699](https://github.com/grafana/grafana/pull/108699), [#108700](https://github.com/grafana/grafana/pull/108700), [#108709](https://github.com/grafana/grafana/pull/108709), [#109038](https://github.com/grafana/grafana/pull/109038)), final removal [#123025](https://github.com/grafana/grafana/pull/123025) (2026-04-21). The PR bodies I read give no reason (template only); reason not established.

## 5. Hygiene history (observed unless noted)

1. [#123025](https://github.com/grafana/grafana/pull/123025), 2026-04-21, "Chore: Remove Cypress". Final step of the Playwright move; no stated reason.
2. [#135964](https://github.com/grafana/grafana/pull/135964), 2026-10-26: renames three NATS embedded-server tests off `TestIntegration` so they run once, not three times (SQLite/MySQL/Postgres). Reason: they never needed a SQL database.
3. [#116280](https://github.com/grafana/grafana/pull/116280), 2026-01-14: "We run this in unit test suites, but it's an integration test. Let's call a horse a horse and skip it here."
4. [#134910](https://github.com/grafana/grafana/pull/134910), 2026-10-14, "fix or skip detected flaky tests": a table of skips (Playwright accessibility, provisioning git-sync integration tests) and one real fix (debouncer test).
5. [#135480](https://github.com/grafana/grafana/pull/135480), 2026-10-20, "CI: Skip flaky tests": linked only to failing enterprise CI runs.
6. [#110469](https://github.com/grafana/grafana/pull/110469), 2025-09-04, "Chore: Remove betterer": "Simpler tooling for frontend development", after moving to ESLint suppressions (`eslint-suppressions.json`, 851 entries at this commit).
7. [#136992](https://github.com/grafana/grafana/pull/136992) and [#137421](https://github.com/grafana/grafana/pull/137421), Nov 2026: fixes flakiness with fake clocks and `synctest` instead of sleeps.

## 6. Notable patterns

- Fakes vs mocks (observed counts above; policy inferred): hand-written fakes and `testify/mock` coexist; no written Go policy found. Frontend skill is explicit: minimize mocks, prefer MSW and real code.
- Lint gates (observed in [eslint.config.js](https://github.com/grafana/grafana/blob/59a3f879c9d6a18eca0e0070db23d88901f9e7da/eslint.config.js)): `jest/no-focused-tests`, `jest/expect-expect`, `testing-library/prefer-user-event`.
- Snapshots are rare (72 files); the skill calls unreadable DOM snapshots "limiting".
- The AI-era guidance is in-repo: the skill targets "AI-generated tests for slop".

## Signals for a reviewer

- Good test (checkable): asserts a concrete value or visible user outcome; name states the behavior; goes through `getByRole`/`userEvent`; fake clock instead of sleep; real code with network mocked at HTTP level.
- Bad test: only `toBeDefined`/`not.toThrow`/length mirror; test updated to match new behavior with no reason; mocks of child components or feature-flag internals; new `time.Sleep`; tests added to deprecated code.
- Boundary check: a Go test named `TestIntegration*` without `SkipIntegrationTestInShortMode(t)` (or the reverse: SQL-free test with the prefix) is wrong per the style guide. A new e2e spec that could be an RTL test with MSW is a candidate for downgrade.
- Suggestions to give: split table cases with names; replace sleeps with `synctest`; move setup to API calls in e2e `beforeAll`; rename tests to match the layer.
- A test-mapping skill could automate (inferred): changed file to nearest co-located `*.test.ts(x)` / `*_test.go`; prefix/skip-guard consistency; banned assertion patterns; whether a new skip carries a TODO or link.

## Caveats

- Counts are by filename and grep, not coverage; `time.Sleep`/mock counts include generated or legacy code.
- GitHub search was rate-limited and keyword-weak; the PR list is a sample, not exhaustive. Cypress removal rationale and Drone history were not found.
