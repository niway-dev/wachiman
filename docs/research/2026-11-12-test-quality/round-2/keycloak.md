# Keycloak: testing state, round 2

First pass (inventory, no-mocks policy, CI, hygiene history): [repos/keycloak.md](../repos/keycloak.md). This round does not repeat it.

All file links are pinned to commit [8d59d2e](https://github.com/keycloak/keycloak/tree/8d59d2e77f0c9822138a288d53649e374ea774de) (main on 2026-11-16). Labels: **observed** (read it), **inferred**, **not found**.

## In one minute

- No coverage measurement at all: no JaCoCo, Codecov or Sonar file, and none in the root pom. The merge rule is qualitative: "There is sufficient test coverage" (observed).
- The CI workflow does not run on pushes to `main`. Full CI on main happens only through a nightly job (04:00 UTC) that dispatches `ci.yml`, `js-ci.yml`, `operator-ci.yml`, CodeQL and conformance (observed).
- Flakiness is tracked by humans plus label: 5 open and 497 closed `flaky-test` issues, mostly created by one maintainer, each naming a test and a CI job (observed).
- The Arquillian testsuite was deprecated on 2026-02-25 and migration is mostly by touched file, with 53 open and 46 closed "[Test Framework] Migrate X" issues. Tests are also deleted when judged valueless (observed).
- Rules exist for both directions, and AI is explicitly allowed with disclosure; roughly 1 in 8 recent commits carries a Copilot or Claude co-author trailer (observed).

## 1. Coverage

- **Tooling: not found.** No path matching `jacoco|codecov|sonar|coverage` among 17,307 tree entries, and zero matches in the root `pom.xml`. Issue/PR searches for jacoco, codecov, sonarcloud: nothing. The only static analysis document is [docs/static-code-analysis.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/docs/static-code-analysis.md), about the Checker Framework for unclosed resources.
- **Figure and target: not found.** Nothing is published.
- **Enforcement on PRs: qualitative only.** [PR-CHECKLIST.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/PR-CHECKLIST.md) says "There is sufficient test coverage" and [CONTRIBUTING.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/CONTRIBUTING.md) lists "Includes functional/integration test". "Coverage" is used as a human judgment, not a number. Issues like [#49462](https://github.com/keycloak/keycloak/issues/49462) "review test coverage" use it the same way.
- **Closest thing (observed):** a curated `@DatabaseTest` subset for the database matrix ([tests/docs/README.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/tests/docs/README.md)): "each selected test adds work to the database matrix".

## 2. Tests day to day

- **PR gate (observed):** [ci.yml](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/.github/workflows/ci.yml) runs on `pull_request`; a `conditional` action maps changed paths to jobs. A final `Status Check` job aggregates needs. PR-CHECKLIST: "All required status checks have passed successfully". Branch-protection settings could not be read (404), so which jobs are "required" is not found.
- **Main and nightly (observed):** `ci.yml` has `push: branches-ignore: [main, dependabot/**, copilot/**, tmp/**]`, so main is not built on push. [schedule-nightly.yml](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/.github/workflows/schedule-nightly.yml) (`0 4 * * *`) runs `ci.yml`, `documentation.yml`, `js-ci.yml`, `operator-ci.yml`, `codeql-analysis.yml`, `conformance.yml` on the default branch. [quarkus-next.yml](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/.github/workflows/quarkus-next.yml) runs nightly against Quarkus snapshots. Playwright on Firefox runs only on scheduled runs (js-ci: "Only test with Firefox on scheduled runs"; see [PR 41461](https://github.com/keycloak/keycloak/pull/41461), 2025-07-28).
- **Flaky tracking (observed):** [AGENTS.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/AGENTS.md) says issues for flaky tests get `flaky-test`, flaky CI jobs `flaky-job`. Counts today: 5 open, 497 closed `flaky-test`; 1 open `flaky-job`. The first pass recorded 138 open, so a large bulk closure happened since (inferred; cause not checked). Example [#55172](https://github.com/keycloak/keycloak/issues/55172): names the test, the job ("Forms IT (firefox)"), the error, and notes "Surefire reruns did not help". Fixes follow the pattern "Closes #55084" with a wait-for-row change ([commit affecd9](https://github.com/keycloak/keycloak/commit/affecd9293cc85726a9a82f8c9289ab39ed477a4)).
- **Release gating: not found.** No release workflow in `.github/workflows` and [RELEASES.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/RELEASES.md) says nothing about tests. Releases are probably cut elsewhere (inferred).

## 3. Documentation from tests, and the reverse

- **Docs checked by tests (observed):** `docs/documentation/tests` has [GuideTest](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/docs/documentation/tests/src/test/java/org/keycloak/documentation/test/GuideTest.java) (variables, includes, images, internal anchors) and `ExternalLinksTest`. [documentation.yml](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/.github/workflows/documentation.yml) runs the first on pushes and nightly, and external links in a separate job.
- **Snapshot/approval files (observed):** `quarkus/tests/integration/.../approvals/cli/help/*.approved.txt` (e.g. `HelpCommandDistTest.testBootstrapAdmin.approved.txt`) pin CLI help output.
- **Generated code from OpenAPI, type-checked (observed):** the admin client package runs `generate:openapi` (Kiota from [openapi.json](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/js/libs/keycloak-admin-client/openapi.json)) and `generate:doc-examples`, whose command ends with `tsc -p src/generated/doc-examples/tsconfig.doc-check.json`, so generated doc examples must compile.
- **Executed quickstarts: not found** in this repo.
- **Docs about writing tests (observed):** see section 5 and the first pass.

## 4. Test cleanups and migrations

- **Timeline (observed):** framework prototype started May 2024 ([blog, 2024-11-14](https://www.keycloak.org/2024/11/preview-keycloak-test-framework): the old suite is "almost unreadable" without docs and "the Arquillian framework is not fully supported anymore"); first migration issue [#32447](https://github.com/keycloak/keycloak/issues/32447) (2024-08-28); deprecation announced [2026-02-25](https://www.keycloak.org/2026/02/deprecating-arquillian-and-keycloak-test-framework-support), full support from 26.6.0, with "the whole admin tests package has been migrated"; the CI block on new legacy files ([commit 619a5a0](https://github.com/keycloak/keycloak/commit/619a5a0e6302769f86c8e0c1cf48ef8f854a3111), 2026-02-24).
- **Why (stated):** [DEPRECATED.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/testsuite/DEPRECATED.md): "It's using JUnit 4", "test configuration got messy", "steep learning curve". Limited edits allowed: "primarily to add test-cases when resolving bugs".
- **How far (observed/inferred):** 53 open and 46 closed issues titled "[Test Framework] Migrate ..." (for example [#55161](https://github.com/keycloak/keycloak/issues/55161) UserInfoTest, 2026-11-13). Open ones are per-class and recent, so migration is ongoing, driven by touched files.
- **Deletion, not just porting (observed):** [PR 47389](https://github.com/keycloak/keycloak/pull/47389) (2026-03-24) "Delete tests checking feature availability" because they "really serve no value as it doesn't check if providers/endpoints are disabled/enabled as expected". [PR 50591](https://github.com/keycloak/keycloak/pull/50591) (2026-07-10) reviewed the legacy DB matrix from [#47808](https://github.com/keycloak/keycloak/issues/47808): none "required to be migrated" because the SQL was already covered by the new DB suite.

## 5. Written rules: create and not create

- **When to add (observed):** CONTRIBUTING: "Includes functional/integration test". Copilot instructions: "Include docs/tests when behavior changes", "Start with tests closest to changed modules". [.github/copilot-instructions.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/.github/copilot-instructions.md) is the closest file to a test instruction for agents.
- **When not to add (observed):**
  - "Unit tests are avoided and only recommended for isolated classes such as small utils" ([tests-development.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/docs/tests-development.md)).
  - "Do not add mock frameworks or other testing frameworks that are not already part of the testsuite" (CONTRIBUTING); Copilot file: "Do not introduce new test frameworks".
  - "do not create new tests under `testsuite`"; "If integration tests are needed, they belong under `tests`" (Copilot file); "Adding new files is not allowed" (DEPRECATED.md).
  - `@DatabaseTest`: "Merely creating a realm, user, or client as test setup is not a reason to add the annotation".
  - BEST_PRACTICES: avoid asserting events via raw `Assertions`; use `Assertions.assertThrows` instead of try/catch; abstract base classes "only ... to a limited extent".
- **Copilot reviewer rules (observed):** comment only at ">85%" confidence; "Do not comment on: Formatting; Minor naming suggestions". The file says the complaint was that it "is overly verbose and hallucinates".

## 6. AI and tests

- **Policy (observed):** CONTRIBUTING "Use of Generative AI": AI "may be used to assist in writing code, tests, or documentation, provided that you fully understand every change". Required: understand the change, engage with review, be able to revise yourself, "disclose AI agents usage" in the PR description for whole-solution generation, comply with Apache 2.0. "Submitting AI-generated code you do not understand is not acceptable."
- **Agent files (observed):** [AGENTS.md](https://github.com/keycloak/keycloak/blob/8d59d2e77f0c9822138a288d53649e374ea774de/AGENTS.md) (issue templates, signoff, drafts "only when asked", PRs state "rationales, assumptions, and decisions"), `.github/copilot-instructions.md` (2026-07-14, [PR 50090](https://github.com/keycloak/keycloak/pull/50090)), `.claude/skills` and `skills/` (translation review, release notes; no test skill).
- **Usage (observed):** among the latest 600 commits on main (2026-09-23 to 2026-11-13), 63 carry `Co-authored-by: Copilot` and 11 a Claude trailer. Flaky-test fixes are among them, e.g. [affecd9](https://github.com/keycloak/keycloak/commit/affecd9293cc85726a9a82f8c9289ab39ed477a4) and [ae77487](https://github.com/keycloak/keycloak/commit/ae77487191861f586538b0b51d2c4987c10294d5), by a maintainer with `Closes #` links.
- **Migration by AI (observed, not delivered as far as checked):** [#47020](https://github.com/keycloak/keycloak/issues/47020) is still open: "Claude + Opus 4.6", spec-kit specs, agent command for migration patterns.
- **Rejected PR (observed):** [PR 44311](https://github.com/keycloak/keycloak/pull/44311) ("comprehensive TDD testing") was closed for having no issue and mixing aspects.

## Signals for an AI reviewer

- Flag a new file, or new tests, under `testsuite/`; the repo forbids it. Tests belong in `tests/` with `@KeycloakIntegrationTest`.
- Flag added mocking or new test frameworks in server code; do not ask for coverage numbers, since none are measured.
- For flake fixes, expect a linked `flaky-test` issue and a cause (a wait on a condition, a race), not a longer sleep or a retry.
- Ask a PR to link an issue and have test and docs together; ask for AI-use disclosure only when a whole solution looks generated.
- Stay quiet on formatting and naming (Spotless owns formatting).

## Caveats

Observations come from a single commit plus live GitHub state on 2026-11-16. The search API was rate-limited once and counts are point-in-time. Branch protection is unreadable without admin rights. The AI-trailer rate is a regex over a 600-commit window and misses unmarked AI use. No Keycloak code was run.
