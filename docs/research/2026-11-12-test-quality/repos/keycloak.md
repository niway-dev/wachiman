# Keycloak: how it tests

- Date: 2026-11-12
- Status: evidence
- Source commit: https://github.com/keycloak/keycloak/tree/1f4a80f58de70e2a2a19647966daa769ddd11445
- Related: [index](../README.md)

## In one minute

- Keycloak's stated policy is "integration/functional first": unit tests only for "isolated classes such as small utils", and no mocking framework accepted ([docs/tests-development.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/docs/tests-development.md)).
- Most behavior is verified by driving a real server (embedded or remote) with a real browser and real HTTP, using realms declared per test class.
- The old JUnit 4 Arquillian testsuite is officially deprecated. A CI gate blocks new files there, so every touched test migrates to a JUnit 5 framework in `test-framework/` + `tests/`.
- Flakiness is handled mechanically: 2 surefire reruns, automatic flaky-test reports, a `flaky-test` issue label, and fixes that name the race.
- Observed contradiction: the "no mocking" rule is documented, yet Mockito appears in newer modules (ssf, operator, ipatuura). The rule describes the core server, not the whole repo.
- Admin UI is tested with vitest (pure functions) and Playwright (against a real server started in CI).

## 1. Test inventory (observed, counted from the git tree at the commit)

Counts come from `gh api .../git/trees/main?recursive=1` (not truncated, 13,623 files) plus grep/wc.

| Area | Count | Notes |
| --- | --- | --- |
| Java main sources (`src/main`) | 6,498 files | `services` alone has 1,630 |
| Plain unit tests outside testsuite dirs (`*Test.java` under `src/test`) | 635 | `services` 124, `quarkus/tests` 63, `core` 52, `operator` 36, crypto modules ~80 |
| Legacy Arquillian (`testsuite/integration-arquillian`) | 483 `*Test.java` | plus `testsuite/model` 38 |
| New framework tests (`tests/`) | 786 `*Test.java` (782 in `tests/base`) | 14 JUnit Platform `*TestSuite` classes in `tests/base/.../suites` |
| New framework self-tests (`test-framework/tests`) | 31 | framework tests itself |
| Quarkus distribution ITs (`quarkus/tests/integration`) | 63 | |
| Admin UI Playwright specs | 75 admin-ui + 10 account-ui | in `js/apps/*/test/` |
| Admin UI vitest | 14 `*.test.ts(x)` | against 620 non-test src files |

Ratio (inferred, crude): about 635 unit classes vs ~1,270 integration classes (483 + 786), so roughly 1:2 by class count. New-framework classes already exceed the legacy suite. UI: 14 vitest + 85 Playwright files over ~620 admin-ui sources.

## 2. Written guidance

- Philosophy: "We focus primarily on integration/functional level tests. Unit tests are avoided... We do not use any mocking frameworks" ([docs/tests-development.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/docs/tests-development.md)). Still names the legacy `LoginTest` as the model, so it lags the migration (inferred).
- Assertion style: prefer Hamcrest `assertThat` for readable failure messages (same file).
- [CONTRIBUTING.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/CONTRIBUTING.md): PR checklist "Includes functional/integration test"; "Do not add mock frameworks or other testing frameworks".
- PR template ([docs/pull_request_template.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/docs/pull_request_template.md)) is only a comment pointing to CONTRIBUTING; it has no test checklist.
- [AGENTS.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/AGENTS.md) exists: issues for flaky tests get the `flaky-test` label, flaky CI jobs `flaky-job`. It says nothing else about test style.
- New framework docs ([test-framework/docs/](https://github.com/keycloak/keycloak/tree/1f4a80f58de70e2a2a19647966daa769ddd11445/test-framework/docs)): README, WRITING_TESTS, [BEST_PRACTICES](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/test-framework/docs/BEST_PRACTICES.md) (cleanup by realm lifecycle, `assertThrows` instead of try/catch, `AssertEvents` for events), GITHUB (slow-test report).
- Migration: [tests/docs/MIGRATING_TESTS.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/tests/docs/MIGRATING_TESTS.md) (script `migrate.sh`, "Do not squash the commits"), [tests/docs/README.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/tests/docs/README.md) (a `@DatabaseTest` is "a curated subset... Merely creating a realm, user, or client as test setup is not a reason to add the annotation").

## 3. CI (observed in [ci.yml](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/.github/workflows/ci.yml))

- Runs on every `pull_request`; a `conditional` job skips CI for unrelated changes; superseded PR runs are cancelled.
- Splitting: Base IT in 6 groups (legacy), `Base1..4TestSuite` for the new framework, Quarkus IT by suite (`zip-slow, zip-fast, storage, smoke`) on ubuntu and windows, separate jobs for adapters, clustering, SCIM, SSF, AuthZEN, admin-v2.
- Matrices: DBs `postgres, mysql, oracle, mssql, mariadb` (plus `edb`, Aurora, Azure); browsers `chrome, firefox` for Forms IT; Playwright `chromium, firefox` in [js-ci.yml](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/.github/workflows/js-ci.yml).
- Retries: `-Dsurefire.rerunFailingTestsCount=2` on legacy jobs; Playwright `retries: process.env.CI ? 1 : 0` ([config](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/js/apps/admin-ui/playwright.config.ts)).
- Flaky handling: the [upload-flaky-tests action](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/.github/actions/upload-flaky-tests/action.yml) greps surefire XML for `<flakyFailure` and uploads it. Introduced by [PR 16034](https://github.com/keycloak/keycloak/pull/16034) "Re-run failing tests to identify flaky tests... Reports the flaky tests to GitHub Issues". As of the check, 138 open issues carry `flaky-test` (e.g. [#54665](https://github.com/keycloak/keycloak/issues/54665)). Where the issue is created from the artifact was not found in this repo (unknown).
- Hygiene gates: `Testsuite Deprecation Check`, and a build step that fails if a suite list names a class that no longer exists after a migration.

## 4. Unit vs integration vs e2e boundary

Observed split: pure algorithms and parsers are unit; anything involving flows, sessions, persistence, providers or UI runs against a real server.

| Kind | Examples | Judgment |
| --- | --- | --- |
| Unit | [HmacTest](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/core/src/test/java/org/keycloak/jose/HmacTest.java) (sign/verify), [policies/util.test.ts](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/js/apps/admin-ui/src/authentication/policies/util.test.ts) (serialize/parse) | Small, deterministic, input to output. Old style (JUnit 4, logger noise) but fine. |
| Integration (real server, no UI focus) | [EmptyPasswordHashTest](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/tests/base/src/test/java/org/keycloak/tests/login/EmptyPasswordHashTest.java) | Strong: security property (a rejected login still does one hash, against user enumeration by timing) measured by counting hash operations through a custom provider, with the comment "instead of asserting wall-clock latency". |
| Integration (config variants) | [LoginTest](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/tests/base/src/test/java/org/keycloak/tests/forms/LoginTest.java) | Realm per method, events injected, browser driver; broad, large class. |
| E2E (browser) | [flows.spec.ts](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/js/apps/admin-ui/test/autentication/flows.spec.ts) | Real server plus `adminClient` for setup, includes axe accessibility checks. Setup via REST, not clicks. |
| Mocked (exception) | [PodTemplateTest](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/operator/src/test/java/org/keycloak/operator/testsuite/unit/PodTemplateTest.java) | Mockito deep stubs on a Kubernetes context; the operator is not the server. |

Auth flows (login, token, brokering, MFA) are tested end to end: the test opens the login form in a browser, submits, then parses the OAuth response (observed in `EmptyPasswordHashTest`).

## 5. Test hygiene history

1. [Issue 46291](https://github.com/keycloak/keycloak/issues/46291) (2026-02-12) and [PR 46351](https://github.com/keycloak/keycloak/pull/46351) (2026-02-24): CI check that blocks new files in the old testsuite. The script says "Adding new file(s) is forbidden. Maximum 100 lines can be added to a single file."
2. [testsuite/DEPRECATED.md](https://github.com/keycloak/keycloak/blob/1f4a80f58de70e2a2a19647966daa769ddd11445/testsuite/DEPRECATED.md): why, in their words: Arquillian "is not a community maintained project anymore", "uses JUnit 4", "test configuration got messy over the years", "steep learning curve".
3. [Commit a7af380](https://github.com/keycloak/keycloak/commit/a7af380f71076b3a5b9372bee955541bfd1fd11a) (2024-11-01): first split of `test-framework` into modules and placeholder for the new testsuite. This dates the start of the migration (inferred).
4. [PR 52270](https://github.com/keycloak/keycloak/pull/52270) (2026-09-15): composites migrated "while preserving file history", legacy `AbstractKeycloakTest` coupling removed. Pattern: ported, not deleted; fixtures were fixed so flows complete.
5. [Commit a325ce7](https://github.com/keycloak/keycloak/commit/a325ce765a3c448f5f482c7bd12947610babce4c) (2026-09-09): migrates some reset-password methods specifically "to fix the flaky test". Migration as a flakiness remedy.
6. [PR 21684](https://github.com/keycloak/keycloak/pull/21684) (2023-07-18): flaky `SessionTimeoutsTest`; the body explains the race (replication wrote to cache after the session expired; maxIdle `-2` was misread). Good template: root cause, not a longer wait.
7. [PR 53922](https://github.com/keycloak/keycloak/pull/53922) (2026-10-13): LDAP flake fixed by disabling pagination because of unexpected ApacheDS responses; closes two flaky issues.
8. [Issue 47020](https://github.com/keycloak/keycloak/issues/47020) (2026-03-10): spike to use an AI agent for reproducible Arquillian-to-new-framework migration. Not verified as delivered.

Not found: a PR that deleted tests as redundant. Search results for "remove test" were weak (rate limit hit); the evidence shows ports, not deletions.

## 6. Notable patterns

- Server and fixtures are injected by annotation: `@KeycloakIntegrationTest(config = ...)`, `@InjectRealm(config = ..., lifecycle = LifeCycle.METHOD)` (or `CLASS`), `@InjectOAuthClient`, `@InjectPage`, `@InjectWebDriver`, `@InjectEvents`, `@InjectRunOnServer`, `@InjectUser`, `@InjectClient`, `@InjectHttpServer`. Realms are built in `RealmConfig` classes, not JSON.
- Run-on-server: test code executes inside the server for internal state (also in legacy `RunOnServerTest`), keeping tests mostly black box.
- Server variants via `KeycloakServerConfig` (custom providers, features); embedded or remote via `KC_TEST_SERVER`.
- Mocking: none in the core server tests; real DBs through containers (`KC_TEST_DATABASE=postgres`); test doubles are real providers, e.g. `CountingPasswordHashProviderFactory`.
- Browser: Selenium (HtmlUnit default, Chrome/Firefox) in Java; Playwright for admin/account UI.
- Slow-test report: threshold env `KC_TEST_GITHUB_SLOW_METHOD`/`_CLASS` set to 10s/60s in ci.yml.

## Signals for a reviewer

Good test (checkable):
- Asserts an observable outcome of a flow (response, event, DB state), not internal calls.
- Setup is declared (realm config, injected fixtures), and cleanup uses lifecycle, not try/finally.
- Security-relevant tests assert the property (no enumeration, token rejected), ideally deterministic (counters, not timing).
- Flake fix states the race and removes it; no bare `sleep`/retry added.

Bad test:
- New file or more than ~100 added lines under `testsuite/` (the repo itself blocks this).
- JUnit 4 or `org.junit.Assert` in new code; `try/catch` instead of `assertThrows`.
- Mock framework added in core server code (policy: rejected).
- Test that only asserts "no exception", or a changed assertion in a bug fix.

Unit to e2e boundary:
- Pure input to output code (parsers, crypto helpers, util): unit.
- Anything with sessions, flows, persistence, providers, or redirects: server-backed integration.
- Use browser/Playwright only when rendering or user interaction is the point; do setup through the admin API.

Suggestions to give:
- "Add a test that logs in end to end" for auth-path changes; point to an existing sibling test as template (their own advice).
- Annotate `@DatabaseTest` only when persistence behavior differs by vendor.
- Migrate touched legacy tests rather than extending them.

A test-mapping skill could automate: map changed `services/...` files to sibling tests in `tests/base/.../tests/<area>`; flag changes in `testsuite/` over the threshold; check new test classes use `@KeycloakIntegrationTest`; flag `@Inject*` realm lifecycle mismatches (inferred, not implemented).

## Caveats

Observed from the tree and docs at one commit; GitHub search hit a rate limit so history is a sample, `docs/tests-development.md` is partly stale versus the migration, Mockito counts came from a capped code search (16 files), and no Keycloak code was run.
