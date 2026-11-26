# Cal.com: testing state, round 2

- Date: 2026-11-16
- First pass: [repos/calcom.md](../repos/calcom.md) (inventory, agent rules, shards, unit vs e2e). Not repeated here.
- Source commit: [ae027bb](https://github.com/calcom/cal.diy/tree/ae027bb70e694e2d2c44569f398d6cbcee0389b1) (`calcom/cal.com` redirects to `calcom/cal.diy`; team/org removed in [PR 28953](https://github.com/calcom/cal.diy/pull/28953)).
- Labels: **observed** (read in repo or API), **inferred**, **not found**.

## In one minute

- Observed: coverage is stated but not measured in CI. The rule says "This is enforced automatically in our CI pipeline", but no workflow collects coverage, and the one PR that tried was closed unmerged.
- Observed: the merge queue (`merge_group`) runs everything unconditionally, including every e2e job. The label `ready-for-e2e` only gates the per-PR run.
- Observed: flakiness has no quarantine or tracker. It is handled by Playwright retries, the written advice "E2E tests can be flaky", and one-off root-cause fix PRs, many written by Devin sessions.
- Observed: the docs-from-tests story is thin. The OpenAPI file is generated from the app, not checked by tests; there are no Storybook stories; snapshots are 2 files.
- Observed: the tests removed in April 2026 went as a series of small `cleanup(test)` PRs, each verified by running the remaining suite.

## 1. Coverage

- Observed: `@vitest/coverage-v8` is a dev dependency ([package.json](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/package.json)) and API v2 has a `test:cov` script. No `coverage`/`codecov` string appears in any of the 50 workflow files, in `vitest.workspace.ts`, or as a Codecov config in the tree. No threshold found.
- Observed: [PR 27563](https://github.com/calcom/cal.diy/pull/27563) (2026-02-03, Devin-assisted, requested via Slack by a maintainer) proposed `unit-tests-coverage.yml`: coverage as a 14-day artifact, "not added to the `required` job", "No external coverage service". Closed unmerged 2026-02-18 after being marked stale.
- Observed: [testing-coverage-requirements.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/rules/testing-coverage-requirements.md) also says "Global coverage tracking as a key metric that improves over time". No published figure found (searched the tree, workflows, PRs/issues for "codecov" and "coverage").
- Inferred: the 80% number is a norm for reviewers and agents, not a gate. The only enforcement is the PR-template checkbox and review.
- Observed: contributors do open "improve coverage" PRs by hand, e.g. [PR 28721](https://github.com/calcom/cal.diy/pull/28721) (2026-04-03).

## 2. Day-to-day use

- Observed, gate on every PR (via [pr.yml](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/.github/workflows/pr.yml)): type check, lint, unit, API v2 unit, security audit; Prisma migration check only when Prisma files change. Everything is skipped when only non-code files change (`paths-filter`).
- Observed, label-gated: integration, builds and all e2e run only with `ready-for-e2e`. External authors also need a maintainer's `run-ci` label before any CI runs (a `trust-check` job; the file header warns not to check out PR code before it).
- Observed, merge queue: [all-checks.yml](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/.github/workflows/all-checks.yml) triggers on `merge_group` and runs lint, type check, unit, integration and four e2e suites with no label. Its final job fails on any `failure`, `skipped` or `cancelled`.
- Not found: a scheduled test run. `schedule:` appears only in `cron-*.yml` app jobs. `performance-tests.yml` is manual.
- Observed, flaky tests: no quarantine. Guidance in [ci-check-failures.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/rules/ci-check-failures.md): "E2E tests can be flaky", "Focus only on CI failures that are directly related to your code changes". [Issue 28668](https://github.com/calcom/cal.diy/issues/28668) (2026-03-30) asked for a central flaky tracker; labeled Stale and "needs approval", open, no comments.
- Observed, releases: [release-docker.yaml](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/.github/workflows/release-docker.yaml) triggers on `v*` tags and runs a "Build and test Docker image" action. That test is a health check polling `/auth/login` for up to 60 tries. It does not run the test suites. Inferred: the merge queue is the real release gate.

## 3. Documentation that comes from tests

- Executed examples: observed. [packages/platform/examples/base](https://github.com/calcom/cal.diy/tree/ae027bb70e694e2d2c44569f398d6cbcee0389b1/packages/platform/examples/base) is a Next.js sample app for the platform atoms, with 5 Playwright specs under `tests/` (booker, availability, create event type, team event type, Apple connect), run by `e2e-atoms.yml`. It is not in `all-checks.yml`'s `needs` list. Inferred: it keeps the example working, and it doubles as the documented usage.
- Storybook: not found. No `.stories.*` file or `.storybook` dir in the 10,291-path tree; only two `_storybookData.ts` leftovers.
- OpenAPI: observed that API v2 generates it from the Nest app ([generate-swagger-script.ts](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/apps/api/v2/src/swagger/generate-swagger-script.ts)) into a committed [docs/api-reference/v2/openapi.json](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/docs/api-reference/v2/openapi.json). No workflow mentions swagger/openapi and no e2e-spec references it, so a drift check was not found.
- Snapshots: observed, 2 sets, both Playwright: an icons PNG and a webhook-response text file under `apps/web/playwright/*-snapshots`. No Vitest `__snapshots__`.
- Docs on which tests to write: [agents/commands.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/commands.md) lists how to run each kind; the `agents/skills/calcom-api` skill documents the API. Neither explains choosing a kind (the choice is only in a code comment, first pass).

## 4. Test cleanups

- April 2026 removal: [PR 28953](https://github.com/calcom/cal.diy/pull/28953) (2026-04-22) and [PR 28954](https://github.com/calcom/cal.diy/pull/28954) (Playwright helpers and fixtures). Then about a dozen `cleanup(test): remove ... integration coverage` PRs on 2026-04-26/28, e.g. [PR 29010](https://github.com/calcom/cal.diy/pull/29010). Stated reason: the features are gone. Each lists the verification commands it ran (`VITEST_MODE=integration yarn test <file>`, `yarn type-check:ci --force`).
- Flake sweep, 2026-03-25 to 04-08: about ten PRs (e.g. [28587](https://github.com/calcom/cal.diy/pull/28587), [28630](https://github.com/calcom/cal.diy/pull/28630), [28682](https://github.com/calcom/cal.diy/pull/28682), [28787](https://github.com/calcom/cal.diy/pull/28787)). Reason in each: nondeterminism (missing mocks, cross-file DB cleanup, UI waits). All carry a Devin session link. Observed: they fix rather than delete.
- CI speed: [PR 26636](https://github.com/calcom/cal.diy/pull/26636) (2026-01-10) caches the git checkout: "20+ separate checkouts per workflow run" on a ~1.3 GB repo.
- Devin automation removed: [PR 28703](https://github.com/calcom/cal.diy/pull/28703) (2026-04-01) deleted the workflows that ran Devin on review feedback, merge conflicts and stale PRs.
- Jest to Vitest: not found. API v2 still uses Jest (`test` and `test:e2e` scripts). Searched PR titles for "jest" and "vitest"; the search API was rate limited, so this is weak.

## 5. Written rules, for and against

- For: PR template checkbox "I confirm automated tests are in place that prove my fix is effective or that my feature works"; [AGENTS.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/AGENTS.md) "Run relevant tests before pushing"; [culture-accountability.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/rules/culture-accountability.md) "Can we add tests for this before merging?"; [quality-thorough-code-review.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/rules/quality-thorough-code-review.md) "If someone wants to commit untested code, push back".
- Mostly-against, only about running, not writing: [quality-pr-creation.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/rules/quality-pr-creation.md) "For most PRs, you only need to run linting and type checking"; skipped e2e: "Do not try to fix anything related to skipped E2E tests".
- Not found: any rule on which tests are unwanted (no ban on mock-only, snapshot or coverage-padding tests). Searched `agents/`, AGENTS.md, CLAUDE.md, PR template. `.cursor` and `.claude` show as single tree entries (likely symlinks to `agents/`; inferred). Mocking guidance exists ([testing-mocking.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/rules/testing-mocking.md): prefer simple fakes) but does not forbid anything.

## 6. AI and tests

- Observed: [culture-leverage-ai.md](https://github.com/calcom/cal.diy/blob/ae027bb70e694e2d2c44569f398d6cbcee0389b1/agents/rules/culture-leverage-ai.md) says "Generate 80% of boilerplate and non-critical code using AI" and lists "Building comprehensive test suites" under "Where AI excels". The coverage rule adds "Near 100%, especially with AI assistance for generating tests". Humans keep "Complex business logic" and "Domain-specific edge cases".
- Observed: in a 400-PR sample (merged PRs sorted by last update, spanning 2021 to 2026-11), 85 bodies link an `app.devin.ai/sessions` URL ("Requested by: @human"). Commits show `devin-ai-integration[bot]` as co-author. Biased sample; not a rate.
- Observed: Devin's test work is mostly fixing flakes and adding mocks, not new feature tests. Humans also write explicit test PRs ([PR 27690](https://github.com/calcom/cal.diy/pull/27690), 2026-02-17: gaps found in review of a regression fix).
- Not found: any rule that bans or limits AI-written tests, or asks for human review of them beyond the general PR review.

## Signals for an AI reviewer

- A claim like "enforced in CI" is not backed by a coverage job; do not flag a PR for "dropping coverage", and be skeptical of tests added only to reach 80%.
- Flaky-fix PRs follow a pattern worth checking: missing `vi.mock`, unordered `findMany`, shared cleanup queries, UI waits. Verify the fix names the root cause.
- Booking or availability changes should add a scenario test under `handleNewBooking/test/`; the merge queue will run e2e anyway, so a missing e2e is caught late.
- Removed-feature PRs should name the verification command and delete the dead tests with the code.
- No rule says when not to add a test, so over-testing is a reviewer judgment call.

## Caveats

- No clone; the tree and files were read through the GitHub API at one commit. Workflow reading was by grep plus targeted views.
- GitHub search hit its rate limit; PR-title searches (Jest to Vitest, deleted e2e) are incomplete. The 400-PR sample is ordered by update time, so it skews to recent.
- Coverage may exist in a private or hosted pipeline that the OSS repo does not show.
