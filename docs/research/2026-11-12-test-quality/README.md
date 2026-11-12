# Test quality: what a good test is, and what Wachiman should say about tests

- **Date:** 2026-11-12
- **Status:** research in progress. Nothing here is decided or built. Anything that changes the
  engine or the review prompts goes through a spec and an ADR first.
- **Why:** AI agents write tests compulsively. Wachiman will review the tests that we (and our
  agents) create, so it needs an evidence-based reading of what a test is worth. Two sources of
  evidence: the maintainer of `pingdotgg/t3code` deleting about 11,000 of 25,928 tests in one PR,
  and the testing practice of the five large open-source repositories in Martian's Code Review
  Bench (Cal.com, Sentry, Grafana, Keycloak, Discourse).
- **Baseline we already have:** the general-knowledge hub (`conventions/test-audits.md`,
  `monorepos/testing-strategy.md`, `monorepos/testing/*`) and the `cs-audit-tests` skill. This
  research checks that baseline against the evidence; it does not restart it.

## Questions this research answers

1. What makes a test good?
2. What makes a test bad (low signal, flaky, tautological, mirror of the code)?
3. When should a unit test become an integration or end-to-end test?
4. What should a reviewer suggest about a test, and when should it flag removed tests?
5. What heuristics can a skill use to map a repository's tests and clean them up?

## Documents

Each document is one unit of evidence. The synthesis is written last, from these.

| Document | Source | Status |
| --- | --- | --- |
| [t3code/01-pr-inventory.md](t3code/01-pr-inventory.md) | t3code PRs that removed and set up tests | pending |
| [t3code/02-the-big-purge.md](t3code/02-the-big-purge.md) | #22557 and #13922: which tests were deleted, by category | pending |
| [t3code/03-over-cuts-and-restores.md](t3code/03-over-cuts-and-restores.md) | #24058, the four restore PRs, #26238 | pending |
| [t3code/04-codified-criteria.md](t3code/04-codified-criteria.md) | #26166 guidance and test-signal agent, lint rules, config PRs | pending |
| [repos/calcom.md](repos/calcom.md) | Cal.com testing practice | pending |
| [repos/sentry.md](repos/sentry.md) | Sentry testing practice | pending |
| [repos/grafana.md](repos/grafana.md) | Grafana testing practice | pending |
| [repos/keycloak.md](repos/keycloak.md) | Keycloak testing practice | pending |
| [repos/discourse.md](repos/discourse.md) | Discourse testing practice | pending |
| synthesis.md | All of the above | pending |
| skill draft | Test-mapping heuristics | pending |
