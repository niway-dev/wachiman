# Test-file and PR metrics: Sentry and Grafana

## In one minute

Observed: matching test-file inventories grew in both repositories.  
Observed: Sentry’s recent PR sample touches tests more often than Grafana’s.  
Observed: automation accounts are prominent in both recent PR samples.  
Inferred: large test deletions often reflect consolidation or relocation, not abandoned behavior.  
Not found: a dated public overall coverage percentage in the inspected repository evidence.

## getsentry/sentry

Observed inventories; each row uses **C1** on its linked commit. Layers are disjoint.

| Date (UTC cutoff) | Commit | python | acceptance | frontend | Source files | Tests/source |
|---|---|---:|---:|---:|---:|---:|
| 2024-11-15 | [C1](https://github.com/getsentry/sentry/commit/dafa065d078c7f9596d907dcd5f8efae1701de67) | 1818 | 79 | 1339 | 8795 | 0.368 |
| 2025-11-15 | [C1](https://github.com/getsentry/sentry/commit/6812bc023ceb6695bf6b0096852fc184feb82509) | 2185 | 63 | 1732 | 11360 | 0.350 |
| 2026-11-15 | [C1](https://github.com/getsentry/sentry/commit/0af5f81845c0897698d53161532f44b0d8610328) | 2741 | 54 | 2663 | 13681 | 0.399 |

Observed command-returned merged sample: 2026-11-12T23:02:13Z–2026-11-16T16:22:37Z; all following values: **C2+C3**, [repository snapshot](https://github.com/getsentry/sentry/commit/57147b07eefa76e7b5753b12cceded2379b17e4c).

| Metric | Result |
|---|---:|
| PRs sampled | 100 |
| Touch test / add test file / delete test file | 66% / 10% / 2% |
| Touch both test and non-test files | 65 |
| Median test / non-test lines added, among both | 29 / 38 |
| Bot-authored | 53% |

Observed: largest net test-line deletions among **100 C4 candidates**, not an exhaustive ranking. Values are removed / added → net removed; **C3+C5**, pinned merge evidence below. Reasons paraphrase descriptions (observed).

- [test(aci): Consolidate detector handler tests around the new lifecycle](https://github.com/getsentry/sentry/pull/127135): **1969 / 640 → 1329** ([merge](https://github.com/getsentry/sentry/commit/c803c55dbb990169de81f5db5eca19b6660183d3)). Consolidates overlapping detector lifecycle cases and relocates tests.
- [chore(ci): Remove unused navigate-only acceptance tests](https://github.com/getsentry/sentry/pull/112698): **970 / 1 → 969** ([merge](https://github.com/getsentry/sentry/commit/a613214076ff90c548ecae9902169923541ff7c0)). Removes assertion-free navigation tests and stale skipped tests to reduce CI time.
- [test(ui): Add `renderHookWithProviders` similar to our `render`](https://github.com/getsentry/sentry/pull/99178): **593 / 247 → 346** ([merge](https://github.com/getsentry/sentry/commit/6100db9fe35afdd68b2e541b7ecd1e352275d337)). Moves hook tests onto a shared render helper.
- [test(ui): Remove useProject mocks, add lint rule](https://github.com/getsentry/sentry/pull/88574): **445 / 136 → 309** ([merge](https://github.com/getsentry/sentry/commit/e5a34504b8fac37d0ee7e80f3f1605b791ef4dee)). Replaces hook mocks with initialized ProjectsStore fixtures.
- [test(ui): Replace custom test providers with `renderHookWithProviders`](https://github.com/getsentry/sentry/pull/100241): **465 / 241 → 224** ([merge](https://github.com/getsentry/sentry/commit/1735ae261465ad007754dde9cf190e0d2cb6009f)). Replaces custom context providers with a shared hook helper.

Coverage: observed coverage-database consumption and a Codecov token in CI (**C6**, [backend](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.github/workflows/backend.yml), [acceptance](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.github/workflows/acceptance.yml)); a published percentage/date: **not found** in inspected evidence.

## grafana/grafana

Observed inventories; each row uses **C1** on its linked commit. Layers are disjoint.

| Date (UTC cutoff) | Commit | go | frontend | e2e | integration | Source files | Tests/source |
|---|---|---:|---:|---:|---:|---:|---:|
| 2024-11-15 | [C1](https://github.com/grafana/grafana/commit/9223cd8f59729eaf8714f648e74dd32dfbeec0fa) | 950 | 1452 | 276 | 46 | 7846 | 0.347 |
| 2025-11-15 | [C1](https://github.com/grafana/grafana/commit/1f1c75f81708ac669deac09d7715a56d27467fbc) | 1307 | 1691 | 344 | 88 | 9583 | 0.358 |
| 2026-11-15 | [C1](https://github.com/grafana/grafana/commit/3f36380cfd6240f348c2a6226f6fb07647746d60) | 2321 | 2927 | 365 | 346 | 11362 | 0.524 |

Observed command-returned merged sample: 2026-11-12T10:27:12Z–2026-11-16T16:06:04Z; all following values: **C2+C3**, [repository snapshot](https://github.com/grafana/grafana/commit/d09f100ad0a454468e6e49002808b126f75fc755).

| Metric | Result |
|---|---:|
| PRs sampled | 100 |
| Touch test / add test file / delete test file | 44% / 6% / 0% |
| Touch both test and non-test files | 36 |
| Median test / non-test lines added, among both | 36.5 / 31.5 |
| Bot-authored | 31% |

Observed: largest net test-line deletions among **100 C4 candidates**, not an exhaustive ranking. Values are removed / added → net removed; **C3+C5**, pinned merge evidence below. Reasons paraphrase descriptions (observed).

- [Provisioning: Share webhook integration tests across providers](https://github.com/grafana/grafana/pull/135931): **794 / 453 → 341** ([merge](https://github.com/grafana/grafana/commit/be6b7ae9dc9e204516663ed3b96565a694ccff5e)). Shares webhook integration suites across providers.
- [E2E: Remove tests for externalized datasources](https://github.com/grafana/grafana/pull/135525): **336 / 0 → 336** ([merge](https://github.com/grafana/grafana/commit/9f9edcbc0b765c21d8bbd5a86d37f99855b4848f)). Externalized plugins retain tests in their own repositories; removes network-download flakiness.
- [Run apiserver Badger tests outside the database matrix](https://github.com/grafana/grafana/pull/136013): **132 / 53 → 79** ([merge](https://github.com/grafana/grafana/commit/db744e8fa2cbdf1b1c1ae508f77dd48f5e390b9a)). Runs in-memory Badger scenarios outside the SQL database matrix.
- [Provisioning: Share OAuth connection integration tests across providers](https://github.com/grafana/grafana/pull/135926): **463 / 395 → 68** ([merge](https://github.com/grafana/grafana/commit/bcf7bdde8cd7acb4b227222f6d00082b9df09bbe)). Shares OAuth integration suites and moves existing cases.
- [Dashboards: Update remaining tests for dashboardNewLayouts default](https://github.com/grafana/grafana/pull/134946): **156 / 118 → 38** ([merge](https://github.com/grafana/grafana/commit/7a6ddfb90a59d4cbd545f9054fc8ec50fb6da2fd)). Updates tests for the new dashboard layout default.

Coverage: observed a scheduled frontend coverage job reporting to Bench (**C6**, [workflow](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.github/workflows/report-frontend-coverage-to-bench.yaml)); a public percentage/date: **not found** in inspected evidence.

## Method and limits

Observed collection date: 2026-11-16 UTC. Read-only Git/gh; active account unchanged. Blobless, no-checkout clones lived exclusively under `mktemp -d /tmp/testmetrics-XXXX`; no repository programs ran.

**Fixed classification, applied in order at every date and to PR filenames:** Sentry acceptance: `^tests/acceptance/.*\.py$`; Python: `^tests/(.*/)?test_[^/]+\.py$`; frontend: `\.(spec|test)\.tsx?$`. Grafana E2E: `^(e2e|e2e-playwright)/.*\.(ts|tsx|js)$`; integration: `^pkg/tests/.*_test\.go$`; Go: `_test\.go$`; frontend: `\.test\.tsx?$`. Source: remaining files ending `.py/.ts/.tsx` (Sentry), `.go/.ts/.tsx` (Grafana). Ratio = summed layer files/source files. These are path proxies; helpers, fixtures, generated files and unmatched tests can distort them.

**Exact commands (short form):** substitute `R` with the section’s repository, `B` with `master`/`main`, `S` with its linked SHA, `D` with the row date, `N` with the linked PR number.

- **C1:** `git rev-list -1 --first-parent --before=${D}T23:59:59Z origin/$B`; `git ls-tree -r --name-only $S`; count paths matching the regexes above.
- **C2:** `gh pr list -R $R --state merged --base $B --limit 100 --json number,author,mergedAt,files`. This requested command orders by creation, so it is a recent merged sample rather than guaranteed latest by merge time.
- **C3:** `gh api --paginate --slurp "repos/$R/pulls/$N/files?per_page=100"`; sum matching files’ `additions/deletions`; detect `status=added/removed`. Non-test additions include all other files. Medians include zero additions. Percentages use the complete sample denominator. Bot rule: `[bot]` or GitHub App author (`app/`), including Sentry Junior, release bot, Dependabot, Renovate, Cursor, alerting-team and Grafana PR automation.
- **C4:** `gh search prs --repo $R --base $B --state closed --merged --limit 100 --sort updated --json number,title,body,url "test in:title merged:2024-11-16..2026-11-16"`; rank C3 totals by deletions minus additions. Search is incomplete: title filter, updated-order cap, search indexing and renamed-file classification can omit larger deletions.
- **C5:** `gh pr view -R $R $N --json mergeCommit,mergedAt,baseRefName`.
- **C6:** `git ls-tree -r --name-only origin/$B`; `git grep -n -i -E "codecov|coveralls|--cov|coverage run|coverage report|coverage:" origin/$B -- .github/workflows README.md pyproject.toml jest.config.ts jest.config.js`; `git show origin/$B:.github/workflows/report-frontend-coverage-to-bench.yaml` (Grafana). No dashboard figure was retrieved; this is a scoped not-found result, not proof none exists.
