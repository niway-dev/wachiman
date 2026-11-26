# Grafana: testing state, round 2

First pass: [repos/grafana.md](../repos/grafana.md). This round does not repeat it.

Pinned commit for all file links: `d09f100ad0a454468e6e49002808b126f75fc755` (main, 2026-11-16). Labels: observed / inferred / not found.

## In one minute

- Observed: no Codecov, no coverage gate on PRs. Frontend coverage is computed nightly per code-owning team and pushed to an internal metrics store; no target is published.
- Observed: merge gating is path-filtered unit, integration and Playwright jobs on every PR; the only scheduled test run found is an hourly frontend perf job. Flaky tests are skipped by hand, not quarantined by tooling.
- Observed: tests as docs are modest: 2 Go example tests, 153 Storybook `.story.tsx` plus 113 MDX files, and a CI job that fails when committed Swagger/OpenAPI specs drift.
- Observed: the strongest written rules are AI-era: `AGENTS.md`, three skills under `.claude/skills/`, and `AI_POLICY.md` (Oct 2026), all with explicit "bad test" language.
- Observed: Claude co-author trailers appear on 15 of the latest 100 `main` commits (13-16 Nov 2026).

## 1. Coverage

- Observed: no `codecov*` file in the tree (29,058 paths searched at the pin). No `coverageThreshold` found in `jest.config.js` (grep for "coverage" hits only a memory comment).
- Observed: [report-frontend-coverage-to-bench.yaml](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.github/workflows/report-frontend-coverage-to-bench.yaml) runs daily (`cron: "0 0 * * *"`) on `main`, runs Jest coverage per CODEOWNERS team, and pushes to Prometheus through `grafana-bench`. The step is `continue-on-error: true`, so it is a dashboard, not a gate. Scripts: `test:coverage:by-codeowner`, `test:coverage:changes` (`--changedSince=origin/main`) in `package.json`.
- Observed: Go: the Makefile integration targets pass `-covermode=atomic -coverprofile=...`; no published figure or PR check found.
- Observed: the goal is "intentional, not incidental" coverage. [frontend-testing-strategy skill](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.claude/skills/frontend-testing-strategy/SKILL.md): before preview, "confirm coverage is _intentional_, not merely _incidental_". Coverage as a number is not stated as a target.
- Observed: a coverage push did happen as a squad effort, the `dataVizTestingSprint` label (37 issues/PRs, April-July 2026), e.g. [#121861 "Heatmap: Test coverage"](https://github.com/grafana/grafana/pull/121861).
- Not found: any public coverage percentage; branch protection settings (not readable read-only).

## 2. Day-to-day gating

- Observed: on `pull_request` and push to `main`/`release-*`: [backend-unit-tests.yml](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.github/workflows/backend-unit-tests.yml), [pr-test-integration.yml](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.github/workflows/pr-test-integration.yml), pr-frontend-unit-tests.yml, pr-e2e-tests.yml, storybook-a11y.yml (Playwright a11y over 6 themes). So PR and main run the same suites.
- Observed: scheduled: only `frontend-perf-tests.yaml` (hourly) and the coverage report (daily). No nightly full-test workflow found.
- Observed: releases: [release-build.yml](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.github/workflows/release-build.yml) has a "Run Meticulous tests" job (visual replay tests against the built image) marked `continue-on-error: true`, so it does not block. Inferred: unit suites gate PRs, which keeps `main` releasable; [WORKFLOW.md](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/WORKFLOW.md) says "Main and release branches MUST always build without failure".
- Observed: flaky handling is manual: [#134910](https://github.com/grafana/grafana/pull/134910) and [#135480](https://github.com/grafana/grafana/pull/135480) (first pass). No flaky label exists in the repo's first 100 labels matching "flak". Not found: a quarantine list or auto-rerun of tests (the one rerun script, `renovate-approve.yml`, reruns infra-cancelled runs).
- Not found: which checks are "required" (branch protection not visible).

## 3. Documentation that comes from tests

- Observed, Go examples: only 2 `example_test.go` ([errutil](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/pkg/apimachinery/errutil/errors_example_test.go), sqltemplate). Not a convention.
- Observed, Storybook: 153 `*.story.tsx`, 113 `.mdx`. [storybook.md](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/contribute/style-guides/storybook.md) says stories are "Used as a tool for documentation" and that edge-case stories help reproduce bugs. Stories are also tests: [storybook-a11y.yml](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.github/workflows/storybook-a11y.yml) runs `test:storybook` per theme.
- Observed, API specs: [swagger-gen.yml](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/.github/workflows/swagger-gen.yml) job "Verify committed API specs match" fails if regenerated specs differ. `TestIntegrationOpenAPIs` in `pkg/tests/apis/openapi_test.go` compares the live server to 35 files under `openapi_snapshots/`.
- Observed, golden files: 15 `.golden` files, 2,780 paths under `testdata/`, 72 `.snap` (first pass). Canvas panels use a draw-call snapshot harness instead of pixel diffs (panel-testing-strategy skill).
- Observed, reverse: [contribute/style-guides/testing.md](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/contribute/style-guides/testing.md) and the skills explain which tests to write.

## 4. Test cleanups

- Observed: Cypress to Playwright, July 2025 to April 2026 (PRs in first pass). Stated reason: not found in the PR bodies, which are the empty template, e.g. [#123025](https://github.com/grafana/grafana/pull/123025). Related, open since 2024-03: [#84394](https://github.com/grafana/grafana/issues/84394) "Prometheus: Improve integration tests with plugin-e2e" (move to Playwright-based `plugin-e2e`).
- Observed: Enzyme is no longer in the root `package.json` (0 matches at the pin). Removal PR and date: not found (GitHub search was rate-limited after the first queries; web search returned only other projects).
- Observed: April 2026 DataViz sprint added or backfilled panel tests and deleted dead code ([#122548 "ThresholdControlsPlugin: Delete"](https://github.com/grafana/grafana/pull/122548)). Reason recorded later in [#129154](https://github.com/grafana/grafana/pull/129154) (2026-07-24): to encode what "the DataViz squad wants" from those reviews.
- Observed, speed/dedupe: [#135964](https://github.com/grafana/grafana/pull/135964) (first pass) stops tests running three times.
- Not found: a Grafana blog post on test migration.

## 5. Written rules: add tests, and do not

- Observed: [CONTRIBUTING.md](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/CONTRIBUTING.md): "Write or update tests". PR template: "Ensure you include and run the appropriate tests". No checklist item for tests.
- Observed: [AGENTS.md](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/AGENTS.md): "Write tests for new functionality"; "Keep changes focused — avoid over-engineering"; "Before running `git push`, stop and get explicit human approval". Also nested `AGENTS.md` in 13 directories (e.g. `packages/grafana-ui`, `e2e-playwright/alerting-suite`).
- Observed, when NOT to test (frontend skill, Step 3 "Don't test what shouldn't exist"): "Skip modules slated for deletion", because tests on deprecated code "signal it's load-bearing". Deferring depth is fine: "leave an explicit note rather than shipping a shallow test that looks complete."
- Observed, unwanted tests: Principle 3 "no slop tests" (unfocused, verbose, asserting existence); Principle 4 "Do not simply update failing tests to pass after changing behaviour"; E2E "keep it targeted and few"; "No argument → ask which file/area; don't blanket-generate."
- Observed, regression rule: "A regression test must fail on `main`" (prove red by reverting the fix).
- Observed, layer by feature-toggle phase: unit tests in every PR while Experimental; full diamond plus a "testing review" before preview.

## 6. AI and tests

- Observed: [AI_POLICY.md](https://github.com/grafana/grafana/blob/d09f100ad0a454468e6e49002808b126f75fc755/AI_POLICY.md), added by [#134928](https://github.com/grafana/grafana/pull/134928) (2026-10-14). Lists "Generating tests" as welcome, requires: "Generate tests, then confirm that the tests cover the intended behaviour and fail for the right reasons." Maintainers may reject work that "Changes behaviour without adequate tests". Limits: about 3 open PRs, 500 lines, no "3,000-line AI-generated pull request".
- Observed: skills exist to gate AI tests: panel-testing-strategy ([#129154](https://github.com/grafana/grafana/pull/129154)) says "so AI-proposed (and human-written) panel tests match that bar"; its description includes "reviewing AI-generated panel tests for slop".
- Observed: 15 of the latest 100 `main` commits carry `Co-authored-by: Claude ...` trailers, e.g. [341d3c2](https://github.com/grafana/grafana/commit/341d3c2b1). No "generated with" PR footer checked.

## Signals for an AI reviewer

- A test that asserts only existence (`toBeDefined`, "it rendered") or whose expectation was edited to match new behaviour with no stated reason.
- A bug-fix PR without a regression test, or one whose test would also pass on `main`.
- New tests for code marked deprecated or slated for deletion.
- A new test layer mismatch: a broad Playwright spec for logic an RTL/unit test covers, or a `TestIntegration*` test with no SQL need (first pass).
- PR size and count over the AI policy bounds (about 500 lines), which also hurts test review.

## Caveats

- GitHub search API hit its rate limit early; cleanup PR coverage is thin (no Enzyme PR, no Cypress rationale). Absence claims were checked against the tree at the pin, not all branches or open PRs, and not T3 threads.
- Branch protection and required checks are not visible; "gate" is inferred from `pull_request` triggers.
- The 15-of-100 AI-trailer figure is a 3-day window and undercounts untagged AI use.
