# Test quality: synthesis of the evidence

- **Date:** 2026-11-12
- **Status:** research synthesis. Nothing here is decided or built. Anything that changes the
  engine or the review prompts goes through a spec and an ADR first.
- **Related:** [index](README.md); t3code: [PR inventory](t3code/01-pr-inventory.md),
  [the big purge](t3code/02-the-big-purge.md),
  [over-cuts and restores](t3code/03-over-cuts-and-restores.md),
  [codified criteria](t3code/04-codified-criteria.md); repos: [Cal.com](repos/calcom.md),
  [Sentry](repos/sentry.md), [Grafana](repos/grafana.md), [Keycloak](repos/keycloak.md),
  [Discourse](repos/discourse.md).

Labels: **[observed]** is stated in an evidence doc (which got it from a PR, file or count).
**[inferred]** is my reading across them. I did not re-check upstream pages in this pass; every
upstream URL below is copied from an evidence doc.

## In one minute

- **Over-testing is accumulation, not bad single tests.** After t3code deleted about 11,000 of
  25,928 tests, the suite regrew from 9,316 to 10,991 in five days [observed]. The maintainers
  answered with authoring-time rules (extend an existing case, test at one layer) and lint, not
  another purge.
- **Deleting is as risky as adding.** The purge cut 22 auth tests it had to restore inside the same
  PR, then 29 more cases and 9 over-cuts in follow-ups [observed]. Restored tests share a shape:
  sole guard, an invariant types cannot express, a boundary, or a named past failure.
- **The sources agree on principles and differ on layers.** Assert outcomes at the public seam, no
  real-time waits, e2e for whole flows only. They split on mocks and layering: Keycloak is
  integration-first with no mock framework; Cal.com leans on unit tests with an in-memory database.
- **Retries are contested, root-cause fixes are not.** Five repos retry (1 to 2 times) but track and
  fix causes; t3code bans retries and enforces it by lint.
- **Bots said nothing useful about tests.** CodeRabbit did not comment on any t3code removal PR and
  Macroscope decided on eligibility only. A reviewer that reads which tests matter fills a real gap.
- **Wachiman should be lopsided.** For added tests: ask for fewer, smaller, lower-layer. For removed
  tests in risk areas: ask for evidence. For bug fixes: ask for a regression test (this deviates
  from t3code's agent, see below).
- **Cheap signals do most of the work.** Waits, mock-only assertions, duplicated literals and
  test-only exports are regex- or knip-detectable. Sole-guard and "does it fail?" need judgment
  or execution.

## Where the sources agree and disagree

"Not found" means the evidence doc did not find it, not that it is absent.

| Principle | t3code | Cal.com | Sentry | Grafana | Keycloak | Discourse |
| --- | --- | --- | --- | --- | --- | --- |
| Assert behavior at the public seam, not mock calls | ✓ bans mock-call mirrors | ✓ asserts DB rows; fakes over `mockDeep` | ✓ lint S001 bans call-count asserts; yet about 1,042 files use mocks | partial: frontend skill yes; no Go policy found | ✓ black box through real flows | ✓ rule; legacy Mocha stubs remain |
| One layer per behavior | ✓ "lowest layer that fails on `main`" | partial: edge cases in integration, standard in e2e | not found (layers visible in base classes) | partial: layer by job, e2e "few" | not found | ✓ "covered once, at the layer that owns it" |
| Extend an existing case before adding | ✓ | not found | ✓ "MUST add... to existing test files" | not found | not found | partial: "fewest test examples possible" |
| Real dependencies over mocks | partial: real Chromium, in-memory SQLite, test clock | ✗ mostly: prismock, global fetch and calendar mocks | ✓ real Postgres; Kafka `LocalProducer` "instead of mocks" | partial: MSW yes; Go has 217 `testify/mock` files | ✓ no mock frameworks (Mockito in newer modules) | partial: mock external boundaries only |
| No real-time waits | ✓ five lint rules; one at warn for 14 files | partial: fixed case by case | partial: `freeze_time`, relative times | ✓ rule (`synctest`); 285 `time.Sleep` remain | partial: counts hash ops, not latency | ✓ zero `sleep` in system specs |
| Regression tests tied to a past bug are kept | ✓ 9 restored, 6 cite an issue | partial: PR template asks for proof | not found | not found | partial: checklist asks for a test | not found |
| E2E only for whole user flows | ✓ browser tier cut 71% whole | ✓ | ✓ acceptance is a 51-file remnant | ✓ "keep it targeted and few" | partial: auth flows run in a browser by default | ✓ "one system test per user flow" |
| Flake handling | fix; retry banned; skip needs an issue | e2e retries 2, unit none; skip last resort | reruns plus tracking; quarantine helper | skip with TODO, fix, or reclassify; Playwright retry 1 | reruns 2, auto report, label (138 open) | retry once if 10 or fewer fail; log; report |
| Lint-enforced test rules | ✓ about nine custom rules | not found | ✓ S001, S015, S020, S031 | partial: three jest rules | partial: CI gate on legacy suite | not found (190 of 301 system files break the selector rule) |
| Agent-facing test guidance | ✓ AGENTS.md, guide, review agent, evals | ✓ `agents/rules/*.md` | ✓ `tests/AGENTS.md`, skill | ✓ skill targets "AI-generated tests for slop" | partial: AGENTS.md covers flaky labels only | ✓ two skills |

The real disagreements:

**Mocks and layers.** Keycloak writes "We do not use any mocking frameworks" and runs about 1,270
integration classes against 635 unit classes, but Mockito appears in newer modules (operator, ssf).
Cal.com runs most of its logic through Vitest with prismock, and its "integration" files sometimes
use `vi.mock`. Discourse sits between them. [Inferred] The split follows the product: Keycloak's
behavior is a real login flow, so a mock restates the contract; Cal.com's is booking logic that
needs scenario data. What they share is "mock what you do not own, never assert the mock".

**Retries.** t3code: "flaky tests are fixed, not retried." Keycloak, Discourse, Cal.com and
Grafana retry in CI. Sentry disables reruns in its shuffle job so they do not hide pollution.
[Inferred] Retry is acceptable as a reported signal, not as a silent fix. A reviewer should flag an
added retry, timeout or unexplained skip, not the existing CI config.

**Overlap.** The hub says overlap between API and e2e "is coverage, not waste" ([baseline](#compared-with-our-baseline)).
t3code and Discourse say the opposite for branches, and keep one flow-level test at the top.

**Coverage targets.** Cal.com asks for "near-80%+" coverage of new code; t3code's agent never asks
for more. [Inferred] A coverage rule invites padding; no repo measured it.

**Mass deletion** is single-source. Keycloak ported tests, Cal.com deleted tests only with removed
features, Sentry and Discourse delete case by case. Only t3code purged.

## What a good test is

Each property is checkable by a reviewer.

1. **It fails when the named invariant breaks, and the PR shows it.** Evidence: t3code
   [#24011](https://github.com/pingdotgg/t3code/pull/24011) restored tests that "pass if the guard
   never ran", rewrote them, and showed exactly 3 fail when the grant recheck is short-circuited
   ([03](t3code/03-over-cuts-and-restores.md)). [#21937](https://github.com/pingdotgg/t3code/pull/21937)
   reverted the fix and saw 1 failure. [#13922](https://github.com/pingdotgg/t3code/pull/13922)
   fixed 27 tests that "could never fail" ([02](t3code/02-the-big-purge.md)).
2. **It asserts an outcome a caller can see**: a return value, persisted row, response, thrown
   error or rendered text. Cal.com's `expectBookingToBeInDatabase`; Sentry's lint against
   `assert_called_once`; Discourse "Don't assert that internal methods are or aren't called"
   ([calcom](repos/calcom.md), [sentry](repos/sentry.md), [discourse](repos/discourse.md)).
3. **The assertion is specific.** Grafana rejects `toBeDefined` and `not.toThrow`; Sentry's own guide
   asks for content, yet an observed spec only checks that a dialog exists
   ([grafana](repos/grafana.md)).
4. **It guards something the type system cannot express**, at a boundary: secrets never logged, DST
   arithmetic, a grant rechecked after revocation, coalescing and cancellation
   ([03](t3code/03-over-cuts-and-restores.md)). Keycloak's `EmptyPasswordHashTest` counts hash
   operations "instead of asserting wall-clock latency" ([keycloak](repos/keycloak.md)).
5. **It is the lowest layer that fails on the bug.** t3code's rule; Discourse's "each layer
   asserts what it owns" ([04](t3code/04-codified-criteria.md)).
6. **It is deterministic**: explicit dates and time zones, fake clocks, ordered queries, its own
   data, no waits. Cal.com [#28672](https://github.com/calcom/cal.diy/pull/28672) (unordered
   `findMany`); Sentry S031 (settings that "outlive the test"); Discourse
   [#45461](https://github.com/discourse/discourse/pull/45461) (row order, shared caches).
7. **It extends an existing case or table when one fits.** t3code, Sentry `tests/AGENTS.md`.
8. **It names a failure**: an issue or fix PR in the name or body. Six of the nine over-cuts restored
   in t3code [#24058](https://github.com/pingdotgg/t3code/pull/24058) cite an issue.
9. **It is cheap for what it proves.** Browser tests only for layout, focus, pointer input, workers or
   hook wiring (t3code); setup through an API, not clicks (Keycloak, Grafana).

## What a bad test is

Confidence is how well the evidence supports the signal, not how often it fires.

| Category | From the diff alone | With repo context | Example | Confidence |
| --- | --- | --- | --- | --- |
| Mock-call mirror | Every assertion is `toHaveBeenCalledWith` or `expects().once` on a mock the test set up | The call is not observable to a user or contract | t3code `nativeTerminalModule.test.ts` (4 of a 27-file sample) | High: three rule sets ban it |
| Type- or schema-guaranteed | Decodes a literal and asserts the same fields; `typeof x === "boolean"` | The schema or signature declares exactly that | t3code `providerRuntime.test.ts` (3 of 27) | High |
| Constant or copy restated; trivial logic | Expected literal equals a constant in the diff; one test per `switch` case or label | Grep finds the literal in source; function is a few lines | t3code `thread-row-emphasis.test.ts` (9 of 27) | High for constants, medium for "trivial" |
| Duplicate case or layer | New `it` beside an `it.each`; same assertion in wrapper and service | Another file asserts the same expectation | "PR" vs "MR" label tested in 11 files ([#23999](https://github.com/pingdotgg/t3code/pull/23999)) | Medium to high |
| Waits and timing | `sleep`, polling, `Date.now()` deltas, timer advanced to a source constant, retry, timeout, bare `skip` | Lint config shows the repo bans it | `useLiveRefresh.browser.test.tsx` (`advanceTimersByTime(44_999)`) | High, but see false positives below |
| Vacuous assertion | Only "not called", existence, "no throw", "page loaded" | Mutation: break the guard, test still passes | #24011 restored tests; Sentry `test_account_settings.py` | High to spot, needs execution to prove |
| Wrong layer | Browser or e2e test whose assertions touch a pure function | Test never renders; branch matrix in e2e | t3code bad eval case 6; Cal.com flags e2e that "only checks a branch" | Medium |
| Test of unreachable or test-only code | `export` added only for a test; `_forTests` seam | No callers outside tests (knip, grep) | t3code [#26238](https://github.com/pingdotgg/t3code/pull/26238): about 420 exports un-exported | High with knip |
| Schema-only migration | `PRAGMA table_info`, "column exists" | Migration only adds a column or index | t3code `047_ProjectionProjectIcon.test.ts` (1 of 27) | Medium; data-transforming migrations were kept |
| Mislabeled layer | `TestIntegration*` without a SQL need; "integration" that mocks | Check what the test needs | Grafana [#135964](https://github.com/grafana/grafana/pull/135964) | Medium |
| Order or state dependence | `findMany` plus `[0]`; assigns settings or globals | Parallel runs show cross-file effects | Cal.com #28672; Sentry S031 | High for these patterns |
| Test bent to fit new behavior | Expected values edited in a bug-fix PR | PR text gives no reason | Grafana skill: "Do not simply update failing tests" | Low to medium |

**False positives to respect.** A fake clock is correct when the time rule is the behavior: the
restored DST tests use `TestClock`. Call order is a contract when observable.

## When to move from unit to integration or end-to-end

Move up when:

- **The behavior lives in the seam.** Sessions, flows, persistence, providers, redirects (Keycloak);
  endpoints through the real stack (Sentry `APITestCase`); booking edge cases on a scenario builder
  (Cal.com).
- **The failure depends on the real engine or vendor.** SQL differences (Grafana earns
  `TestIntegration` only for the SQL matrix; Keycloak's `@DatabaseTest` only when vendors differ);
  data-transforming migrations (t3code kept these).
- **Rendering, focus, pointer input or layout is the point.** t3code's jsdom ban came from a test
  that only checked focus properly in real Chromium.
- **A whole flow crosses auth, redirects or payments.** One e2e per flow (Cal.com, Discourse).
- **A mock would restate the contract it checks.** [Inferred] from Keycloak and Sentry.

Do not move up, and push branches down, when:

- **It is a branch matrix, validation or formatting.** Unit test; "one flow, push branches down"
  (Discourse).
- **The e2e would assert only "page loaded"** (Sentry's weakest acceptance tests), or the owner
  layer already covers it.
- **The change is visual.** Capture or snapshot, no test (t3code); snapshots for appearance, RTL
  for behavior (Sentry).
- **The logic can be extracted from a component.** Test it as a unit (`*.logic.test.ts`).
- **Using a database is the only reason.** Grafana: not "simply tests that... happen to use a
  database"; Keycloak: "Merely creating a realm... is not a reason".

[Inferred] A reviewer should read the repo's declared ladder first (AGENTS.md, test directories,
suffixes). Keycloak's default is integration; t3code's is the cheapest layer that fails.

## Removed tests: when a reviewer should flag them

The 29 restored cases ([03](t3code/03-over-cuts-and-restores.md)): render scheduler
([#23977](https://github.com/pingdotgg/t3code/pull/23977)), clipboard redaction
([#23980](https://github.com/pingdotgg/t3code/pull/23980)), DST scheduling
([#23991](https://github.com/pingdotgg/t3code/pull/23991)) and permission races
([#24011](https://github.com/pingdotgg/t3code/pull/24011)).

| Restored (observed) | Safe to delete (observed) |
| --- | --- |
| Each was "the only direct test" of live code | Had a "stronger twin" in another test |
| Invariant types cannot express: secret never logged, elapsed-time arithmetic | Mirror of a constant, copy string or schema decode |
| Boundary: DST transition, revocation mid-update, coalescing and disposal | Trivial table row, while "every implementation branch keeps at least one row" |
| Security or redaction | Dead export, removed with its code (grep-verified callers) |
| Regression for a cited issue or fix PR (#15768, #9438, #5128, #22452, #20094, #21519, #9138) | Test of unreachable code, with per-item proof (release range, knip) |

**Evidence a reviewer should ask for**, one per claim:

- "Duplicate": the twin's path and what it asserts. Reject a weaker twin.
- "Dead code": the caller search and, for a protocol, the release range. Re-run at merge time; the
  proof went stale when `main` moved ([#23984](https://github.com/pingdotgg/t3code/pull/23984)).
- "Table row": which branch still has a row.
- Any removal touching secrets, auth, permissions, time zones, migrations or concurrency: which test
  now covers it, and does it cross the boundary (a UTC-only test does not replace a DST one).
- A removed test that cites an issue: why it cannot recur (`git log -S` on the test name).

Do not trust keywords alone: the swarm cut 22 auth tests as "timing" although they used a
deterministic clock. Do not treat the 29 restores as proof of value: all came from re-audits by one
team's agents, none from a production incident [observed]. Only #24011 shows the restored tests fail
when the guard breaks.

**The gap.** CodeRabbit left no comment on any of the five removal PRs and made only
weak-assertion nitpicks on three restores. Macroscope approved the restores and #24058 on
"eligibility alone" ("No code objects were reviewed") and asked for human approval on the large
purges by size and auth paths. Neither anticipated an over-cut [observed].

## What Wachiman should suggest about tests

| Suggestion | Trigger | Example wording |
| --- | --- | --- |
| Delete | Added test is a mirror, type restatement or test-only-export test, outside risk areas | "This asserts the same fields the schema already enforces, so it can only fail when the test is edited; consider deleting it." |
| Merge into an existing case | New `it` beside a table or `it.each` that covers the branch, here or in another file | "`parseDuration` already has a table at line 40; add this input as a row instead of a new case." |
| Move to a lower layer | Browser or e2e test whose assertions pass without rendering | "None of these assertions need a DOM; test `formatRange` as a unit beside the logic." |
| Move to e2e | Many mocks restate a flow across auth, redirect or persistence, and the repo has an e2e tier | "Every collaborator is mocked, so this checks the mocks agree; one route-level test would cover the real wiring." |
| Fake clock for the wait | `sleep`, polling, `Date.now()` delta, timer advanced to a source constant | "Replace the 2s sleep with the fake clock and advance it, or await the event." |
| Fake for the mock | Hand-set return values on a `vi.fn()` repository or client, then asserted | "An in-memory repository would let this assert the saved result instead of the call." |
| Assert the outcome | Assertions are only calls on mocks | "Assert the returned total, not that `charge` was called." |
| Add the regression test | Fix PR for a logic, data, state or protocol bug, no test fails without the change | "This fixes #412, but no test fails on the old code; a case with a negative balance would." |
| Show it can fail | New test in a risk area with no evidence it fails without the guard | "Please show this fails when the recheck is removed." |

**t3code's stance** [observed]: its `test-signal` agent reviews only tests the PR adds or grows,
asks only for fewer or smaller tests, never for more coverage, replies exactly `All clear` when it
finds nothing, and never blocks (`conclusion: neutral`). Its eval guard cases (a bug-fix test, a new
table row, a deletion-only diff) must stay silent.

**Where Wachiman should deviate:**

1. **Bug fixes without a regression test.** t3code's agent never asks, but its own AGENTS.md
   requires a failing test first for logic bugs, and its restores show unguarded behavior gets lost.
   The baseline says a gap "is worth more than ten deletions". Exempt visual-only fixes, as t3code
   does.
2. **Removed tests.** t3code's agent ignores deletions. Wachiman should comment on a removal that
   touches the restored-test shape above, and stay silent on safe ones.
3. **Scope of the one-sided rule.** Keep "never ask for more coverage" for new features: ask for a
   test only when a named regression would otherwise pass.

[Inferred] These deviations are untested; the t3code eval measured fewness, not them.

## Heuristics a test-mapping skill can automate

**(a) Static and cheap**

| Signal | How to compute | False-positive risk |
| --- | --- | --- |
| Layer by path or suffix | Globs: `.test`, `.integration-test`, `.e2e`, `.browser.test`, `_test.go`, `spec/system` | Names lie: Cal.com "integration" with `vi.mock`; Grafana prefix errors. Treat as a claim |
| Counts per layer; test-to-source ratio | Count files per layer from the tree | Observed ratios range from about 0.10 (Cal.com unit) to 0.84 (Discourse core). No threshold supported; compare within one repo |
| Test growth in a PR | Added `it` or `test` per changed source line | Large features. Use as a prompt to look, not a finding |
| Waits, sleeps, polling, `Date.now`, retry, timeout | Regex on added lines | Fake-timer use where timing is the behavior |
| Mock-call-only tests | Count `toHaveBeenCalled*` and `.expects` against value assertions per test | Observable call order; calls to an external API |
| Weak matchers | `toBeDefined`, `not.toThrow`, `typeof`, "page loaded" | Low; some smoke tests are deliberate |
| Duplicate text across files | Normalize `it` titles and expected string literals; match across files | Parallel cases that are deliberately separate |
| New `it` beside a table | Same file has `it.each` or a table over the same function | Medium: a row may not fit the table |
| Test-only exports | Symbol referenced only from test files (knip or grep) | Library public API; dynamic imports |
| Skip without reason | `.skip`, `xit`, `fixme` with no issue link | Low |
| Trivial snapshot | Snapshot of one primitive or short string | High: Sentry uses snapshots on purpose |
| Source change with no test change | Map `X.ts` to `X.test.ts`, `__tests__/`, `tests/`, route | Config, pure refactors, distant test locations |
| Issue numbers for a removed test | `git log -S` on the test name | Needs history; messages may lack numbers |

**(b) Needs judgment or execution**

| Signal | How to compute | False-positive risk |
| --- | --- | --- |
| Coverage of deleted code | Coverage on base against head | High: a covered line is not an asserted invariant; t3code used per-item proof, not coverage |
| Does the test fail without the fix | Run it on the parent commit, or mutate the guard | Cost and setup; equivalent mutants |
| Sole guard / stronger twin | Find other tests asserting the same behavior; compare strength | Needs a model's judgment |
| Flake history | CI rerun reports (Sentry JSON, Keycloak `flakyFailure`, Discourse flaky JSON) | Infrastructure failures read as flakes |
| Protected-area match | Names or paths with auth, permission, scope, migration, parse, secret | Keyword misses ("timing" cut 22 auth tests) |

## Compared with our baseline

Baseline: `general-knowledge/conventions/test-audits.md`, `monorepos/testing-strategy.md` with
`monorepos/testing/*.md`, and the `cs-audit-tests` skill.

**What the evidence confirms.**

- "A test earns its place by catching a credible failure that nothing else catches." The restores
  (sole guard, named failure) are that bar in practice.
- "One owner per failure." t3code's one layer, Discourse's [#43629](https://github.com/discourse/discourse/pull/43629).
- "A regression test must fail first." t3code's #13922, #21937 and #24011 prove it by breaking
  the code; no other repo showed this in the PRs read.
- The junk patterns (mirror, restated constants, test-only exports, "production code whose only
  callers are tests") match t3code's categories and #26238.
- "Judge by assertions, not by name." #24011 found vacuous restored tests; "timing" mislabeled 22.
- `e2e.md`'s `gotoHydrated` waits on a flag, not a duration, which matches the no-waits rule.

**What is new.**

- Authoring-time gates: extend before adding, one layer (the baseline mentions extending only for gap tests).
- Lint for waits, skips and retries, so prose is not the only guard.
- Bug-fix proof depends on the bug: logic needs a failing test, visual fixes a capture.
- A reviewer's silence is a measured property (guard cases).
- Dead-code proof goes stale when `main` moves; layers can be a naming contract (Grafana `TestIntegration`).

**What the evidence refines or contradicts.**

1. **"The overlap is coverage, not waste"** (`testing-strategy.md`) pulls against "One owner per
   failure" (`test-audits.md`). The evidence sides with one owner: t3code's regrowth and Discourse's
   trims show same-behavior-at-several-layers is where tests accumulate. Keep overlap to one
   golden-path e2e per flow, not branches.
2. **"Application unit... Use cases with mocked repositories"** with `vi.fn()` repo mocks is the
   shape most prone to mock mirrors. `integration.md` says "Assert on real outputs... not mock
   interactions", but `unit-and-component.md` does not. Cal.com's rule (fakes over `mockDeep`),
   Keycloak and Sentry favor in-memory fakes or real dependencies.
3. **"Slow or static is not a deletion reason."** It held up: the restores prove it. But t3code's
   deletion motive was cost (59% less summed test-file time), and the sound response to cost is to
   move a test to a lower layer, not delete it. Add: removals in risk areas need named evidence,
   not a pattern match.

## Open questions

- No measured precision or recall for the t3code rubric or for the `test-signal` agent. Its eval
  has about 9 to 10 cases, 2 samples each.
- Restores came from one team's agent re-audits, not from incidents or human reviewers.
- Does "one layer" hold outside t3code and Discourse? The hub and Cal.com allow some overlap.
- Does a review comment change an agent's later tests? Nothing here measures it.
- Is the regression-test deviation noisy? Untested. Does a coverage rule cause padding? Inferred.
- Where does a reviewer find a repo's layer ladder when it is not written down?

## Caveats

- Counts are file counts from path regex or grep, not test counts; the t3code taxonomy is a
  27-file sample (about 6% of removed files) classified by one reader.
- t3code is agent-heavy and uses Effect; rules like `TestClock` do not transfer literally. The other
  five are mature human-led repos with partial adoption of their own written rules.
- Cal.com's tree is the stripped `cal.diy`; some GitHub searches were rate-limited, so PR lists
  are samples. This synthesis reads the evidence docs, not upstream.
