# Sentry: testing state, round 2

First pass (inventory, guidance, CI sharding, unit vs acceptance): [repos/sentry.md](../repos/sentry.md).

Pinned commit for repo links: [`57147b0`](https://github.com/getsentry/sentry/tree/57147b07eefa76e7b5753b12cceded2379b17e4c) (master, 2026-11-16). Labels: **observed** (read in a file, PR or API), **inferred**, **not found**.

## In one minute

- Coverage is a tool, not a goal: no Codecov config, no coverage gate, no published figure. Coverage data is only used to pick which tests to run [observed; "not a goal" statement not found].
- One required check per area ("Backend", "Frontend"), each an aggregate of many jobs. Master runs the full suite; PRs run selected tests [observed].
- Flaky tests are quarantined (`it.isKnownFlake()`), reported through a Sentry project and an issue template, never gated by a threshold [observed].
- The repo tells agents when NOT to add tests: no RTL smoke test for styling, no new test files, no "test plan" in PRs [observed].
- Agents are everywhere: the latest 500 master commits carry 202 AI-agent or bot trailer lines; how many distinct commits that is was not counted [observed, sample of 500].

## 1. Coverage

- No `codecov.yml` or `.codecov.yml` in the tree (404 on `codecov.yml`; tree search for "codecov" finds only the Codecov product integration code) [observed].
- Workflows contain no coverage upload step. The only `CODECOV_TOKEN` is in the webpack step of [`acceptance.yml`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.github/workflows/acceptance.yml), likely bundle analysis [inferred].
- Python coverage exists as data: [`make test-backend-ci-with-coverage`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/Makefile) runs `--cov . --cov-context=test`, so each line records which test ran it. A combined DB is read from `gs://getsentry-coverage-data/latest/.coverage.combined` [observed]. Who uploads it was not found (likely a job outside this repo) [inferred].
- The docs call coverage imperfect: "Code coverage is not perfect and can miss some spots" ([selective testing](https://github.com/getsentry/sentry-docs/blob/bb0dff4e48bbc8facc4fcc4a815483c652e2239f/develop-docs/backend/testing/selective-testing.mdx)) [observed].
- Other "coverage" ratchets are not line coverage: type coverage diff (workflow named "[NOT REQUIRED] type coverage diff"), CODEOWNERS coverage with a baseline file, and an API-docs response-field ratchet ([`response_coverage.py`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/src/sentry/apidocs/response_coverage.py), baseline: "Only remove lines") [observed].
- Figure, target, PR gate: **not found**. Searched tree, workflows, Makefile, `gh search code/prs codecov` (only product-feature PRs).

## 2. How tests run day to day

- PR gate: [`backend-required-check`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.github/workflows/backend.yml) "is the only required backend check" and needs tests, migration tests, API docs, API client, typing and more. `frontend-required-check` does the same for Jest, TypeScript, oxlint, knip. Acceptance has its own `acceptance-required-checks` [observed].
- Not required: type-coverage diff and stories preview are named "[NOT REQUIRED]" [observed].
- Master: backend and frontend workflows also run on `push` to master; the docs say "`master` will always run the full testing suite" [observed].
- Selection: coverage DB plus import analysis, full-suite fallbacks (first pass). New since then: [#127569](https://github.com/getsentry/sentry/pull/127569), [#129917](https://github.com/getsentry/sentry/pull/129917), and [#129556](https://github.com/getsentry/sentry/pull/129556) (always run `test_principal.py`) [observed]. Frontend scopes Jest to changed files, full run above 1,000 files [observed].
- Cross-repo: label "Trigger: getsentry tests" dispatches the getsentry suite ([`getsentry-dispatch.yml`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.github/workflows/getsentry-dispatch.yml)) [observed].
- Flaky: per-shard failures are posted as one PR comment ([`report-backend-test-failures.js`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.github/workflows/scripts/report-backend-test-failures.js)); flaky issue template with dropdown "Timeout / Jest Snapshot / Insta Snapshot / Assertion failure" [observed]. Quarantine detail in the first pass.
- Nightly: no `schedule` trigger in the workflows besides release; the nightly shuffle job from #108286 is not in these files [observed absence].
- Release gating: [`release.yml`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.github/workflows/release.yml) runs on a monthly cron (`0 17 15 * *`) via Craft and has a `force` input for "release-blockers". It runs no tests itself; tests gate at merge time [observed]. Deploy gating beyond this: not found.

## 3. Documentation from tests

- Doctests: no `doctest` setting in `pyproject.toml` [not found].
- Executed examples: the `@sentry/api` README examples are type-checked against the packed package ([`10542c9`](https://github.com/getsentry/sentry/commit/10542c9a8171d4cee9f9a8140d605bbddcd39ff3), #131217: "nothing kept its TypeScript examples in step with the API") [observed].
- Component docs: 129 `*.stories.*` files; AGENTS rule "Add `*.stories.mdx` stories for new components"; a skill asks authors "When should they NOT use it" [observed]. This is a custom MDX story system, not Storybook [inferred].
- API docs from tests: `tests/apidocs/` (68 files), OpenAPI built in CI and diffed; response-coverage baseline [observed].
- Snapshots as reference: 1,538 `.pysnap` files and PNG visual snapshots approved in the PR ([snapshot docs](https://github.com/getsentry/sentry-docs/blob/bb0dff4e48bbc8facc4fcc4a815483c652e2239f/develop-docs/frontend/testing/snapshot-testing.mdx)) [observed].
- Docs about tests: [testing tips](https://github.com/getsentry/sentry-docs/blob/bb0dff4e48bbc8facc4fcc4a815483c652e2239f/develop-docs/development-infrastructure/testing.mdx), selective testing, snapshot testing; the frontend and backend testing indexes are stubs (first pass).

## 4. Test cleanups

- [#42515](https://github.com/getsentry/sentry/pull/42515) (2022-12-20, merged) "Remove Enzyme", body "Merry Christams"; follows many "Convert ... to RTL" PRs in 2022 (for example [#39740](https://github.com/getsentry/sentry/pull/39740)). Stated reason: none in this PR [observed].
- [#47800](https://github.com/getsentry/sentry/pull/47800) (opened 2023-04-21, closed unmerged 2023-06-16) "Remove acceptance tests with no interactions": tests "only add entropy to our build status and increase CI time" [observed].
- [#40312](https://github.com/getsentry/sentry/pull/40312) (2022-10-20, merged) removed sampling acceptance tests [observed title only].
- [#93538](https://github.com/getsentry/sentry/pull/93538) (2025-06, closed) remove acceptance-test env code and `getDynamicText` spec [observed]; [#97624](https://github.com/getsentry/sentry/pull/97624) (first pass) did delete replay acceptance tests.
- Flaky deletions: [#66277](https://github.com/getsentry/sentry/pull/66277) (2024-03-05, no reason given) and [#100628](https://github.com/getsentry/sentry/pull/100628) (2025-09-30, moved range tests out of unit, referenced Sentry issue SENTRY-TESTS-19KX) [observed].
- Speed: [#129544](https://github.com/getsentry/sentry/pull/129544) and [#127569](https://github.com/getsentry/sentry/pull/127569) (first pass). Engineering blog post on these cleanups: not found (one web search; only an old post on running Python tests across environments).

## 5. Written rules

Create:
- [`tests/AGENTS.md`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/tests/AGENTS.md): "you MUST add test cases to existing test files rather than creating new test files"; "Do not weaken assertions just to make CI green" [observed].
- [`react-testing` skill](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.agents/skills/react-testing/SKILL.md): avoid "vague checks such as 'renders correctly'"; "Never rely on test execution order" [observed].

Do not create:
- Same skill: "Do not add an RTL smoke test merely to accompany a styling change"; no `toHaveStyle` or class-name assertions for appearance; if nothing is testable, "note in the PR that the change has no automated visual coverage" [observed].
- Do not mock hooks or components; no `findBy` for loading indicators ("flakey") [observed].
- [`gh-pr.md`](https://github.com/getsentry/sentry/blob/57147b07eefa76e7b5753b12cceded2379b17e4c/.claude/commands/gh-pr.md): "We should never focus on a test plan in the PR" [observed]. PR template: only legal boilerplate (first pass).
- `AGENTS.md`: source of truth for agent rules; "Do not add to CLAUDE.md or Cursor rules". `CLAUDE.md` files exist alongside [observed]. `.github/CONTRIBUTING.md` only points to docs [observed]. No rule "do not test X" beyond the above [not found].

## 6. AI and tests

- In the latest 500 master commits (2026-11-10 to 2026-11-16) trailer lines counted: 130 `sentry-junior[bot]` (Sentry's own agent, with session links), 42 "Claude Opus 5.5", 14 "Claude", 7 "Codex", 9 "Generated with Claude Code" [observed; counts are trailer lines, not unique commits].
- Agent-written test work is visible: #131217 above carries a junior session footer [observed].
- Rules: 15+ skills in `.agents/skills/` including `hybrid-cloud-test-gen` and `generate-snapshot-tests`; AGENTS tells agents which tests to run locally; `scraps-review` skill reviews PRs. No rule limiting AI-written tests or requiring disclosure [not found].
- [#114687](https://github.com/getsentry/sentry/pull/114687)-style batches suggest bot-opened quarantine PRs [inferred, first pass].

## Signals for an AI reviewer

- Flag a new test file where an existing mirrored file should be extended.
- Flag RTL assertions about styles, or vague "renders"/"error exists" checks; ask for the exact message or payload.
- Do not ask for a unit test on a pure styling change; ask for a visual snapshot or the PR note.
- Do not demand line-coverage numbers; Sentry does not enforce them. Ask which behavior or failure case is untested.
- Treat `it.isKnownFlake()` or skip added to make CI green as a smell; the repo says "Do not weaken assertions just to make CI green".

## Caveats

- `gh search` hit the rate limit midway, so cleanup PR searches are partial (enzyme, acceptance, flaky only; no "selective testing" origin PR, no Selenium search).
- Commit-trailer counts come from one week, not history.
- Coverage uploads may exist in the private getsentry repo; I did not look there.
- Branch protection could not be read (404), so "required" comes from workflow comments, not settings.
