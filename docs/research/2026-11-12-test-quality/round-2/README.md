# Round 2: testing state in six large repos (2026-11-16)

Scope: the five Martian benchmark repos (Sentry, Grafana, Cal.com, Discourse, Keycloak) plus Cap, read from a qualitative agent and an independent metrics agent. Round 1 is [synthesis](../synthesis.md); t3code is [the purge](../t3code/02-the-big-purge.md) and [codified criteria](../t3code/04-codified-criteria.md). Labels: [observed], [inferred], [not found].

## In one minute

- **Tests are growing** (Sentry, Grafana, Discourse, Keycloak; Cap from near zero). Tests outpaced source from 2025 to 2026 in Sentry, Grafana and Keycloak; Discourse's ratio fell over 2024→2026 (0.265 → 0.230) even as its test count grew. Cal.com shrank (616 → 541 files), likely because it removed features [inferred]. The timing matches rising agent use, a correlation only [inferred].
- **No repo treats coverage as a goal** (all six). None enforces a percentage. Grafana runs a non-blocking nightly dashboard; Sentry uses coverage data to select tests; Cal.com's "80%, enforced in CI" is not enforced.
- **PRs run a subset** (all six). Cal.com adds a label and merge queue for the slow layer; only Keycloak runs full CI on main nightly. No test-gated release found.
- **Flakes are fixed by cause, rarely quarantined.** Sentry quarantines with `it.isKnownFlake()`; Grafana skips by hand.
- **Docs from tests means machine contracts, not prose** (Discourse, Grafana, Sentry, Keycloak). Doctests: none.
- **Cleanups are small and reasoned, never a purge.** Largest net deletion found: 1,841 lines (Cal.com PR 29019); the largest gross removal was 1,969 lines (Sentry PR 127135, 1,329 net).
- **"Do not test" rules exist in four repos, in agent files** (Sentry, Grafana, Discourse, Keycloak); Cal.com and Cap have none.
- **AI is in the tests everywhere**, but only Grafana and Keycloak have rules about AI-written tests.

## Comparison

Ratio = test files / source files by path proxy. "Not comparable" means the denominator or layers changed in ways the ratio hides (see disagreements).

| Repo | Dominant layer 2026 | Ratio 2024→2026 | PRs touching tests (of last 100) | Coverage | Docs from tests | Notable cleanup | "Do not test" rule | AI-in-tests signal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Sentry](sentry.md) | Python 2,741 ≈ frontend 2,663; acceptance 79 → 54 | 0.37 → 0.40 (proxy) | 66% | Data only; no gate, no figure | README examples type-checked; `tests/apidocs` | #112698 removed assertion-free acceptance tests (−969 lines) | Yes: "Do not add an RTL smoke test merely to accompany a styling change" | 202 agent or bot trailer lines in the last 500 master commits (share of commits unknown) |
| [Grafana](grafana.md) | Frontend 2,927 > Go 2,321 | 0.35 → 0.52 (rises with repo growth) | 44% | Daily per-team job, non-blocking, no target | Swagger drift check; stories run as a11y tests | Cypress → Playwright; #135525 dropped externalized e2e | Yes: "no slop tests"; skip modules slated for deletion | AI_POLICY: tests must "fail for the right reasons"; 15/100 Claude trailers |
| [Cal.com](calcom.md) | Vitest unit 418 of 541 | 0.07 → 0.12 (source shrank) | 40% | Not measured; "80%" unenforced | Thin: one example app | April 2026 team/org removal, about 12 `cleanup(test)` PRs | No (not found) | AI "excels" at "comprehensive test suites"; Devin links in 85/400 PRs |
| [Discourse](discourse.md) | Frontend 984, lib 684; system 126 → 301 | 0.27 → 0.23 (not comparable) | 65% | SimpleCov behind env var only | rswag specs generate OpenAPI | Flakes fixed, not skipped | Yes: "Don't assert that internal methods are or aren't called" | Claude co-author on test-adding commits; no AI rule |
| [Keycloak](keycloak.md) | New framework 900 > "unit" 675 > Arquillian 533 | 0.24 → 0.34 (not comparable) | 67% | None found; "sufficient test coverage" | `GuideTest` checks docs; approved CLI help | Arquillian deprecated Feb 2026; #47389 deleted "no value" tests | Yes: "Unit tests are avoided" | AI allowed with disclosure; 74/600 commits carry a Copilot or Claude trailer |
| [Cap](cap.md) | TS/JS 852; Rust `tests/` 61 | 0.006 → 0.32 (not comparable) | 84% | None; "no strict coverage yet" | None | None found (one revert) | No (not found) | Trailers banned; 1/100 "Generated with Claude Code"; Greptile in 95/100 |

## 1. Do they add many tests, and which layer dominates?

Yes, and the pace picked up. Test files, 2024 → 2025 → 2026 ([Sentry and Grafana](metrics-sentry-grafana.md), [Cal.com and Discourse](metrics-calcom-discourse.md), [Keycloak and Cap](metrics-keycloak-cap.md)): Sentry 3,236 → 3,980 → 5,458; Grafana 2,724 → 3,430 → 5,959; Discourse 1,685 → 1,917 → 3,025; Keycloak 1,243 → 1,503 → 2,236; Cal.com 302 → 616 → 541; Cap 2 → 2 → 914 [observed].

Fast unit or component tests dominate in five repos; Keycloak is integration-first by policy. The slow layer shrinks where it hurt (Sentry acceptance 79 → 54, Cal.com Playwright 92 → 66), but Discourse system specs more than doubled. Cap's two-to-914 jump resembles t3code before its purge [inferred].

## 2. Coverage

None of the six enforces, publishes or gates PRs on a percentage [not found, scoped to inspected files]. Cal.com's "enforced automatically in our CI" has no job behind it; the one PR that tried was closed unmerged. Grafana's "intentional, not incidental" is the closest stated goal. Cap: "no strict coverage yet".

## 3. How tests are used

- Gate: Sentry and Keycloak aggregate into one status check; Cap's only required checks are real-capture verifiers, not unit CI [observed]. Branch protection was unreadable elsewhere.
- Selection: Sentry uses a coverage database; Keycloak, Grafana and Cal.com use path filters; Cap runs about 20 hand-picked `cargo test` filters; Discourse has an open PR for affected-only runs.
- Nightly: Keycloak (main is not built on push) and Cap; the other four [not found].
- Release: none found. Grafana's visual release test is `continue-on-error`.
- Flaky: Keycloak labels and tracks (497 closed issues); Discourse and Cap fix by cause; Cal.com ran a Devin fix sweep.

## 4. Does documentation come from tests?

Partly, as contracts. Discourse generates OpenAPI from request specs. Grafana fails CI when committed specs drift. Sentry type-checks README examples. Keycloak runs the reverse: `GuideTest` fails on broken doc variables and anchors. Cal.com and Cap: nothing meaningful.

## 5. Have they cleaned up tests?

Yes, small and with reasons. Cal.com deleted tests with the features that owned them (−1,841 lines in one PR). Sentry removed assertion-free navigation tests and consolidated detector tests (−1,329 net). Keycloak ports tests off a deprecated framework and deletes ones that "serve no value". Grafana moved Cypress to Playwright. Discourse and Cap fix instead of delete.

## 6. Written rules for creating, and not creating, tests

Every repo asks for tests with changes except Cap. Not creating: extend an existing file (Sentry), fewest examples (Discourse), no unit tests or mock frameworks (Keycloak), no slop and no tests for code slated for deletion (Grafana). These live in `AGENTS.md` and skills, so they are written for agents.

## AI and tests

Agent use is high and partly invisible: Sentry's own agent authors PRs, Devin fixes Cal.com flakes, Keycloak maintainers use Copilot on flake fixes, Cap bans trailers. Rules on AI-written tests: Grafana (confirm tests "fail for the right reasons") and Keycloak (disclose whole-solution generation). Cal.com instead encourages AI to build "comprehensive test suites".

## Where the sources disagree

- **Cap counts.** Qualitative: about 860 TS plus 61 Rust files, plus 396 inline `cfg(test)` files. Metrics: 852 + 61, inline Rust excluded after a failed fetch. The files agree, but the ratio omits all inline Rust tests and its 0.006 → 0.32 jump spans a Tauri-to-GPUI rewrite. Not comparable.
- **Bot share is not AI share.** Cal.com: 0% bot PRs, yet Devin links in 85/400 PRs (human-requested). Keycloak: 0% bots, 12% trailers. Sentry: 53% bot-authored (includes Dependabot and a release bot) vs 202 agent or bot trailer lines in 500 commits. Windows (4 to 14 days) and units (PR vs commit) differ.
- **Coverage at Sentry.** Metrics lists a Codecov token as coverage evidence; the qualitative report infers it belongs to webpack bundle analysis. Neither found a figure.
- **Ratios hide layer moves.** Keycloak's growth is migration: Arquillian −239 files, framework +689. Its "unit" column matches any `src/test/java/*Test.java`, which includes Quarkus integration tests [inferred]. Cal.com's ratio rose while its test files fell. Grafana's jump coincides with `.go` files doubling.
- **Sentry cleanup.** Qualitative: the "no interactions" acceptance-test PR closed unmerged. Metrics: #112698 merged later with the same rationale (not re-checked).
- **Cap "no removals".** Metrics found one revert (#3760, −354 test lines), for a crash.
- **Sentry rule scope.** "Do not weaken assertions just to make CI green" was reported as general; it sits in the query-window section only.
- **Test-touch rates** use per-repo path patterns and 4 to 14 day windows; small gaps mean nothing.

## What I spot-checked

Read-only `gh api`, default account, nothing posted.

1. **Cap file counts**: tree API at the three pinned SHAs gave 852 TS and 61 Rust `tests/` files (2026), 1 + 1 (2025), 2 + 0 (2024). Exact match. The repo tree also tripled (2,215 → 6,638 entries in a year).
2. **Grafana ratio**: reran the metrics regexes on both pinned trees: 2,724 → 5,959 test files, 0.347 → 0.524. Exact match. Side finding: `.go` files 3,734 → 7,321 and blobs +52%.
3. **Keycloak flaky labels**: search API gave 5 open, 497 closed. Matches.
4. **Sentry `tests/AGENTS.md`**: the "MUST add test cases to existing test files" quote is verbatim (line 9); the "weaken assertions" quote is real but scoped (above).
5. **Keycloak quotes**: "Unit tests are avoided and only recommended for isolated classes such as small utils" is verbatim in `docs/tests-development.md`; the no-new-mock-framework rule is in `CONTRIBUTING.md`.

Not re-checked: Sentry, Cal.com, Discourse and Keycloak file counts, PR percentages, trailer counts.

## What this means for Wachiman

- **Never ask for a coverage number.** Six of six enforce none; Cal.com's 80% is unenforced. Ask which behavior is untested. Confirms round 1.
- **Check that a new test will run.** Cap lists `cargo test` filters by hand, Sentry selects tests, Keycloak skips main on push. Extends round 1; t3code had no such case.
- **Expect accumulation in agent-heavy repos.** Cap's 2 → 914 files and Grafana's doubling echo t3code's regrowth after the purge. Flag new files where an existing one fits. Confirms round 1 and t3code's "extend an existing case".
- **Quote the repo's own rules; make layer policy per-repo.** Keycloak says "Unit tests are avoided"; t3code says use the lowest layer. Confirms round 1's "differ on layers"; contradicts one universal "lowest layer".
- **Do not flag deletions that ride with a removed feature or migration** (Cal.com −1,841 lines, Keycloak's port). Ask for evidence when tests go without their code; Sentry's removal named its reason. Extends round 1.
- **Use Grafana's wording as the AI-test check:** "fail for the right reasons" and "a regression test must fail on `main`". Cal.com's "comprehensive test suites" is the padding-inviting counterexample. Confirms round 1's "fails when the invariant breaks".

## Open gaps

- Branch protection was unreadable (404) for five repos; "gate" is inferred from triggers. Cap was read via rulesets.
- GitHub search rate limits: no Enzyme-removal PR or Cypress rationale (Grafana), no Jest-to-Vitest or deleted-e2e search (Cal.com), no older removals (Cap), thin AI-test PR search (Discourse).
- Discourse Meta pages returned 403; Saffron's flaky history is secondhand.
- Cap's inline Rust tests are uncounted. All metrics count files, not cases, assertions or mutation score.
- Sentry's coverage uploads may live in private getsentry. Why Keycloak's open flaky issues fell 138 → 5 was not checked.
- Release gating for Keycloak, Discourse and Cap was only grepped. Cal.com `*.spec.ts` tests may be unmatched by the metrics regexes [inferred].
- Next round: survival rates of AI-co-authored tests, and case counts per layer.
