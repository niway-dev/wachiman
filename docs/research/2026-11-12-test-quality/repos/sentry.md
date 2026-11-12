# Sentry: how it tests

- Date: 2026-11-12
- Status: evidence
- Source commit: https://github.com/getsentry/sentry/tree/92a70b986e939981e6f451f7dc8e7f864d108123
- Related: [index](../README.md)

Labels: **[observed]** = read in a file, PR or command output; **[inferred]** = my reading.

## In one minute

- Most Python tests are Django-backed endpoint/model tests that use a real database, with factories on shared base classes. Pure unit tests exist but are the minority [observed: counts below; docs say endpoint integration tests are "the bulk"].
- Selenium acceptance tests are a small remnant (51 files vs 2,541 under `tests/sentry`). Appearance moved to visual snapshots and behavior to Jest/RTL; several acceptance suites were deleted [observed].
- Guidance is written for agents in `tests/AGENTS.md` and a `react-testing` skill. Many rules are enforced by custom lint (S015, S020, S031) instead of review comments [observed].
- CI runs 30 shards, picks tests from a coverage database plus import analysis, retries failures, and has a flaky-test issue template and a shuffle/pollution job [observed].
- Flakiness is treated as a test-isolation problem. Fixes are mostly state reset, deterministic time and ordering, not retries [observed: PRs below].

## 1. Test inventory

Commands ran on the tree JSON at the commit above (file counts, not test-function counts).

| Kind | Files | Note |
| --- | --- | --- |
| `tests/**/test_*.py` total | 2,775 | 3,238 `.py` files incl. helpers |
| `tests/sentry/` | 2,541 | the main suite; mirrors `src/sentry/` |
| `tests/snuba/` | 85 | needs Snuba (ClickHouse) |
| `tests/apidocs/` | 68 | |
| `tests/acceptance/` | 51 | Selenium + Chrome |
| `tests/relay_integration/`, `symbolicator`, `integration`, `apigw` | 6 / 3 / 3 / 4 | external services |
| `static/**/*.spec.*`/`*.test.*` | 2,592 | Jest + RTL; 7,338 other `.ts/.tsx/.js/.jsx` |
| `.pysnap` (insta) files | 1,538 | snapshot data |

Ratios: Python test files to `src/**/*.py` (5,155) is about 0.54. Jest files to non-test frontend files is about 0.35 [inferred: rough, file-level]. Inside `tests/sentry`, the largest areas are `integrations` (307 files), `api` (220), `seer` (144), `workflow_engine` (137).

Code-search approximate counts (GitHub search, may be capped): `freeze_time` appears in about 210 test files, `unittest.mock` in about 1,042; `MockApiClient` in about 984 frontend files.

## 2. Written guidance

- [`tests/AGENTS.md`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/tests/AGENTS.md): "you MUST add test cases to existing test files rather than creating new test files"; tests mirror `src/` paths; "Tests should ALWAYS be procedural with NO branching logic"; "NEVER directly call `Model.objects.create`" (use fixtures/factories); use `pytest.raises`; Kafka code uses `LocalProducer` with `MemoryMessageStorage` "instead of mocks".
- [`.agents/skills/react-testing/SKILL.md`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.agents/skills/react-testing/SKILL.md): "Test user workflows"; assert what the user sees; query by role first, test id last; "Avoid mocking hooks, functions, or components"; do not assert styles in RTL, "Cover colors, typography, spacing... in colocated `*.snapshots.tsx`"; "Do not add an RTL smoke test merely to accompany a styling change."
- [`static/AGENTS.md`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/static/AGENTS.md): "ALWAYS colocate tests".
- Other test skills: [`hybrid-cloud-test-gen`](https://github.com/getsentry/sentry/tree/92a70b986e939981e6f451f7dc8e7f864d108123/.agents/skills/hybrid-cloud-test-gen), [`generate-snapshot-tests`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.agents/skills/generate-snapshot-tests/SKILL.md).
- Public docs (repo getsentry/sentry-docs, commit https://github.com/getsentry/sentry-docs/tree/bb0dff4e48bbc8facc4fcc4a815483c652e2239f): [testing tips](https://github.com/getsentry/sentry-docs/blob/bb0dff4e48bbc8facc4fcc4a815483c652e2239f/develop-docs/development-infrastructure/testing.mdx) ("Endpoint integration tests is where the bulk of our test suite is focused"), [selective testing](https://github.com/getsentry/sentry-docs/blob/bb0dff4e48bbc8facc4fcc4a815483c652e2239f/develop-docs/backend/testing/selective-testing.mdx), [snapshot testing](https://github.com/getsentry/sentry-docs/blob/bb0dff4e48bbc8facc4fcc4a815483c652e2239f/develop-docs/frontend/testing/snapshot-testing.mdx). The backend/frontend testing index pages are stubs.
- [PR template](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.github/PULL_REQUEST_TEMPLATE.md) has only legal boilerplate; no testing checklist [observed].

## 3. CI

- Backend [`backend.yml`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.github/workflows/backend.yml): `select-tests` job downloads a coverage database from GCS, maps changed files to tests ([`compute-sentry-selected-tests.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.github/workflows/scripts/compute-sentry-selected-tests.py)), adds tests that import changed files, and runs the full suite for core files (`conftest.py`, `testutils/pytest/`, constants). Label "Trigger: Override Selective Testing" forces everything; `master` always runs all. If coverage download fails, it runs the full suite.
- Shards: up to 30, balanced by recorded durations; xdist `--dist=loadfile` inside a shard; 60-minute job cap.
- Retries: `pytest-rerunfailures` is installed; reruns are tracked in JSON reports ([`json_report_reruns.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/src/sentry/testutils/pytest/json_report_reruns.py)) and shown by [`show_flaky_failures.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/src/sentry/testutils/pytest/show_flaky_failures.py). Exact rerun count was not found in files I read [not observed].
- Acceptance: separate [`acceptance.yml`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.github/workflows/acceptance.yml), Chrome for Testing, 5 shards for backend changes, 10 for frontend-only.
- Frontend: Jest sharded and weekly rebalanced ([`jest-balance.yml`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.github/workflows/jest-balance.yml)); tests run only when testable files changed.
- Flaky tooling: [flaky issue template](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/.github/ISSUE_TEMPLATE/flaky.yml) (label `Type: CI Flakiness`); `it.isKnownFlake()` in Jest (16 frontend files, "behaves identically to `it()`", used to keep known flakes from blocking CI, per [#114687](https://github.com/getsentry/sentry/pull/114687), closed); thread-leak detector with a `thread_leak_allowlist` marker (27 test files); stale-DB-read detector; per-attempt failures sent to a `sentry-tests` Sentry project [observed in PR text].

## 4. Unit vs integration vs acceptance

No single stated rule found; the boundary is visible in base classes [observed in [`cases.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/src/sentry/testutils/cases.py)]: plain pytest functions (no DB), `TestCase` (DB, transaction rollback), `APITestCase` (endpoint via HTTP client), `SnubaTestCase` (real ClickHouse, marker `snuba`), `IntegrationTestCase`, `AcceptanceTestCase(TransactionTestCase)` (browser), plus `TransactionTestCase` for relay/Kafka. Snuba-dependent tests must go in `tests/snuba/` or carry the marker.

| Kind | Example | Judgment |
| --- | --- | --- |
| Unit | [`test_numbers.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/tests/sentry/utils/test_numbers.py): `def test_base36() -> None` asserts a full encode table | Good: no fixtures, exact outputs. Long literal tables are hard to review [inferred]. |
| Integration (API + DB) | [`test_organization_details.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/tests/sentry/core/endpoints/test_organization_details.py), 2,157 lines, `APITestCase`, factories | Good coverage depth; also uses `patch(...)` in a few places [observed]. |
| Snuba | [`test_organization_events_stats.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/tests/snuba/api/endpoints/test_organization_events_stats.py): `store_event`, `before_now(days=1)` anchor | Real storage, relative times; costly to run [inferred]. |
| Relay integration | [`test_message_filters.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/tests/relay_integration/test_message_filters.py): `requires_kafka`, posts an event, retrieves it | True end-to-end ingest; has a baseline test proving the setup works. |
| Acceptance | [`test_account_settings.py`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/tests/acceptance/test_account_settings.py): clicks, waits for loading spinner | Weak: assertions are mostly "page loaded"; a smoke test [inferred]. |
| Frontend | [`organizationApiKeysList.spec.tsx`](https://github.com/getsentry/sentry/blob/92a70b986e939981e6f451f7dc8e7f864d108123/static/app/views/settings/organizationApiKeys/organizationApiKeysList.spec.tsx): clicks "Remove API Key", expects a dialog | Follows role-based queries, but only asserts a dialog exists; the repo's own guide asks for specific content. |

## 5. Test hygiene history

- [#97624](https://github.com/getsentry/sentry/pull/97624) (2025-08-11, merged): delete replay acceptance tests, "since we don't rely on these tests anymore".
- [#97589](https://github.com/getsentry/sentry/pull/97589) / [#124841](https://github.com/getsentry/sentry/pull/124841): skip flaky UI tests (both closed; pattern of skipping rather than keeping).
- [#114687](https://github.com/getsentry/sentry/pull/114687) (2026-05-02, closed): quarantine 9 frontend tests with `it.isKnownFlake()`, found via failures on master in the `jest` Sentry project. A dozen near-identical PRs were opened the same day, a bot-like batch [inferred].
- [#108286](https://github.com/getsentry/sentry/pull/108286) (2026-02-14, closed): on shuffle failure, bisect to the polluting test, else file a flaky issue. States flaky tests are "much more common than test pollutions" and disables rerunfailures there so retries do not hide them.
- [#128264](https://github.com/getsentry/sentry/pull/128264) (2026-10-20, merged): fix flaky tests from per-attempt failure events; one commit per cause. One fix was a real production bug: uptime index paginated with no `order_by`.
- [#128470](https://github.com/getsentry/sentry/pull/128470) (2026-10-21, merged): lint rule S031 bans assigning to Django settings in tests ("can outlive the test that set them").
- [#127569](https://github.com/getsentry/sentry/pull/127569) (2026-10-15, merged): selective shards split by file because every shard imported every selected file; plus [#129917](https://github.com/getsentry/sentry/pull/129917) full suite when the file list is too large.
- [#129544](https://github.com/getsentry/sentry/pull/129544) (2026-11-02, merged): reuse one Chrome per xdist worker, about 21% less acceptance time.

## 6. Notable patterns

- Mocking: `unittest.mock` is common (about 1,042 test files); lint bans fragile helpers (S001: `not_called`, `called_once`, `called_once_with`) and pytest-style `unittest` asserts. Frontend forbids mocking hooks/components and mocks the network with `MockApiClient`.
- Snapshots: insta `.pysnap` for Python (1,538); frontend appearance goes in `it.snapshot` rendered to PNG and approved in a PR check; Jest DOM snapshots discouraged.
- Time: `freeze_time`, `before_now(...)`; S015 rejects hardcoded current/future years; EAP tests use a 29-day window to avoid the 30-day retention edge.
- DB: real Postgres, `--reuse-db`, factories on `Fixtures`; temporary models via a `fixtures` Django app; 180s lock timeout under xdist to fail fast.
- Isolation: `override_settings`/`override_options`, thread-leak and stale-read detectors, nightly shuffle job.

## Signals for a reviewer

Good test (checkable):
- Asserts a specific value, message or request payload, not "does not raise"/"dialog exists".
- Uses fixtures or factories, not `Model.objects.create`; no `if` in the test body; relative time, not a fixed current year.
- Lives at the mirrored path and extends an existing file.

Bad test:
- Raw `settings.X = ...`, `assert_called_once` style, module-level state changes without reset.
- New acceptance test whose assertions are only "page loaded"; RTL test asserting CSS/class for appearance.
- Mocked hook/component in a frontend test; order-dependent data.

Unit to e2e boundary:
- Pure function: plain pytest, no DB. Endpoint/model: `APITestCase`. Needs ClickHouse: Snuba test. Needs browser: acceptance, only for flows nothing cheaper covers.
- Appearance: snapshot. Behavior: RTL.

Suggestions to give: replace a smoke assertion with the exact outcome; move a UI check down to RTL; add the missing failure/permission case for an endpoint; use `override_options`.

A test-mapping skill could automate: `src/x/y.py` to `tests/x/test_y.py`; flag a changed source file with no touched test; detect Snuba-needing tests outside `tests/snuba/`; run the banned-pattern greps above.

## Caveats

Counts are file-level, not test-function-level; code-search numbers are approximate; I did not run any tests or read a clone; rerun counts and the Jest flake mechanics were not fully verified; the PR template carries no testing guidance; I did not touch the benchmark data.
