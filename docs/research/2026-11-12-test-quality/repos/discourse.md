# Discourse: how it tests

- Date: 2026-11-12
- Status: evidence
- Source commit: https://github.com/discourse/discourse/tree/07e27ad972ac208ee568f071b07f757d4bdbd873
- Related: [index](../README.md)

Method: git tree via the GitHub API (not truncated), a sparse blobless clone at that commit used only with grep/wc (nothing was run), `gh pr view` / `gh search prs`. "Observed" = counted or read; "inferred" = my reading.

## In one minute

- Observed: about 4,400 RSpec files (2,032 core, about 2,340 in plugins) plus about 1,580 QUnit files (978 core, 601 plugins). Browser (system) specs are 301 core and 353 plugin files, supported by 242 page-object files.
- Observed: they publish AI-agent guidance (AGENTS.md, CLAUDE.md, AI-AGENTS.md, and `.skills/discourse-writing-rspec-tests`, `.skills/discourse-writing-js-tests`). It says: assert behavior at the public boundary, mock only external boundaries, one concept per `it`, each layer asserts only what it owns.
- Observed: system specs are for user flows ("one system test per user flow, not per internal code path"); branches go to cheaper tests. Request specs replaced controller specs.
- Observed: CI is parallel (`bin/turbo_rspec`, separate backend, system, frontend jobs). Failed specs are retried once when 10 or fewer fail, and passes-on-retry are logged as flaky and reported to humans.
- Observed: flakiness is handled by fixing or deleting the test, not by tolerating it. Recent PRs trim redundant tests "so each behavior is covered once, at the layer that owns it".
- Inferred: the written rules are newer than much of the code. Many existing specs break them (see section 4), so a reviewer should apply the rules to the diff, not to the surrounding file.

## 1. Test inventory (observed, counts from the tree)

| Kind | Files |
| --- | --- |
| Core RSpec total (`spec/**/*_spec.rb`) | 2,032 |
| `spec/lib` / `system` / `models` / `services` / `requests` / `jobs` | 683 / 301 / 218 / 217 / 187 / 153 |
| `spec/serializers` / `integration` | 94 / 72 |
| Plugin specs (all `plugins/*/spec`) | about 2,337 (biggest: discourse-ai, chat, discourse-workflows) |
| Plugin system specs | 353 (chat 116, discourse-ai 47) |
| Page objects (`spec/system/page_objects` etc.) | 242 (357 incl. plugins) |
| Fabricator files (`spec/fabricators`) | 128 |
| QUnit core (`frontend/discourse/tests`) | 978: integration 455, unit 275, acceptance 246 |
| QUnit plugins (`plugins/*/test/javascripts`) | 601 |

Ratios (inferred as rough): core Ruby spec files to `app/` + `lib/` Ruby files is 2,032 to 2,411 (0.84); QUnit files to frontend source files is 978 to 2,778 (0.35); plugin spec files to plugin non-spec Ruby is 2,337 to 3,394 (0.69). By example count: 2,172 `it` blocks in `spec/system`, 6,641 in `spec/requests`, about 30,500 in all of `spec/`; 8,704 QUnit `test(` calls.

Other counts (grep over core `spec/`): 8,239 `fab!` lines, 17,398 `Fabricate(` calls, 39 skip/xit/pending, 0 `sleep` in `spec/system`, 0 QUnit skips.

## 2. Written guidance (observed)

- Agent guide: [AGENTS.md](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/AGENTS.md) (same size as [CLAUDE.md](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/CLAUDE.md) and `AI-AGENTS.md`; a [Cursor rule](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/.cursor/rules/ai-agents-always.mdc) includes it). Its Testing section is two lines pointing to skills, plus `bin/qunit` usage.
- [RSpec skill](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/.skills/discourse-writing-rspec-tests/SKILL.md): "Test behavior, not implementation"; "Don't over-mock — mock external boundaries (HTTP, third-party services), not internal collaborators"; "Don't assert that internal methods are or aren't called"; "Each layer asserts what it owns... Don't re-assert a lower layer's contract from above"; "Limit nesting to 2 levels"; "Optimize for the fewest test examples possible".
- [System-test reference](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/.skills/discourse-writing-rspec-tests/references/system-tests.md): "Assert what users see, not database state"; do not race transient states (use `with_pending_requests`); exact `have_current_path` strings; verify persistence by refreshing; "Never use raw selectors in test files - delegate to page objects"; use `time:` metadata so the browser clock is frozen too.
- [Request-spec reference](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/.skills/discourse-writing-rspec-tests/references/request-specs.md): request specs replace controller specs; one `describe "#action"` per action.
- [QUnit skill](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/.skills/discourse-writing-js-tests/SKILL.md): prefer `assert.dom`; "stub network boundaries via pretender, not internal collaborators"; naming `Integration | Component | PollInfo`.
- Public docs: [system specs](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/docs/developer-guides/docs/03-code-internals/21-system-specs.md) (Playwright driver, Chrome only, "always be observing for changes in the DOM... not manually waiting"), [QUnit run guide](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/docs/developer-guides/docs/03-code-internals/05-run-test-suites.md). [docs/TESTING.md](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/docs/TESTING.md) is only about MailHog. [CONTRIBUTING.md](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/CONTRIBUTING.md) says nothing about tests.

## 3. CI (observed)

Source: [tests.yml](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/.github/workflows/tests.yml).

- Matrix by `build_type` (backend, frontend, system) and target (core, plugins, core-plugins, chat, official-plugins, themes).
- Backend: `bin/turbo_rspec --use-runtime-info` (parallel processes, cached runtime log to balance). System: same runner on `spec/system`, processes = `nproc/2 + 2`, minified JS, MinIO for S3 tests; failed-system-test artifacts uploaded. Frontend: `bin/rake qunit:test`, `QUNIT_PARALLEL = nproc/2`.
- Flaky policy: with `DISCOURSE_TURBO_RSPEC_RETRY_AND_LOG_FLAKY_TESTS=1`, [runner.rb](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/lib/turbo_tests/runner.rb) reruns failures only if there are 10 or fewer ("ignored because there are more than 10 failures"). Examples that fail then pass go to `tmp/turbo_rspec_flaky_tests.json`, uploaded as an artifact on `main` pushes.
- Tracking: [PR 43250](https://github.com/discourse/discourse/pull/43250) (2026-09-04) notifies "Patch Triage" from those artifacts; [PR 42338](https://github.com/discourse/discourse/pull/42338) (prototype, closed) tried automated Copilot repair. I did not find the external tracker itself.
- Open: [PR 45527](https://github.com/discourse/discourse/pull/45527) records which tests touch which code and runs only affected tests on a PR (reason: full suite costs 80-110 runner minutes).

## 4. Unit vs request vs system boundary

Stated rules (observed, section 2): models own validations/scopes/callbacks; services own orchestration, authorization, return values; request specs own the HTTP contract; jobs own execution and idempotency; system specs own whole user flows; QUnit component tests for UI local to a component.

Examples at the inspected commit:

- Unit-level (service): [email_sending_failures_spec.rb](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/spec/services/problem_check/email_sending_failures_spec.rb), 58 lines, one `.call` entry point, a few contexts, `fab!` records, one `Jobs.stubs` for a collaborator count. Good: small, outcome-based. Weak spot: the assertion on a long literal message is brittle.
- Request: [bookmarks_controller_spec.rb](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/spec/requests/bookmarks_controller_spec.rb), `describe "#create"`, asserts status (200, 429, 400) and error JSON. Good coverage of rate limit and limit errors. It uses `let` plus `Fabricate`, not `fab!`, so it follows older style.
- System: [bookmarks_spec.rb](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/spec/system/bookmarks_spec.rb), page objects (`topic_page`, `bookmark_modal`), user-perspective names. But it also asserts `Bookmark.find_by(...)`, which the system-test guide says to avoid.
- QUnit component: [d-copy-button-test.gjs](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/frontend/discourse/tests/integration/components/d-copy-button-test.gjs): `render`, `assert.dom`, stubs only the browser clipboard.

Gap between rule and code (observed): 190 of 301 core system spec files still use raw CSS finders or `have_css`; 268 reference page objects. Inferred: adoption is partial, rules apply to new code.

Acceptance to system (observed trend, inferred policy): 246 core QUnit acceptance files still exist, and [PR 20421](https://github.com/discourse/discourse/pull/20421) (2023-02-23) ported sidebar acceptance tests to system tests because "The acceptance tests are flaky... easier to work with and reason about". I found no written policy to migrate everything.

## 5. Test hygiene history (observed)

1. [PR 17045](https://github.com/discourse/discourse/pull/17045) (2022-06-09): removed a re-skipped acceptance test; "has resulted in more pain for us than the value the test provides."
2. [PR 20421](https://github.com/discourse/discourse/pull/20421) (2023-02-23): acceptance to system port, reason flakiness.
3. [PR 27728](https://github.com/discourse/discourse/pull/27728) (2024-07-05): skipped flaky poll QUnit tests after a specific commit, linking CI evidence (a temporary skip with proof).
4. [PR 43629](https://github.com/discourse/discourse/pull/43629) (2026-09-14): trimmed workflow button specs that "tested the same behaviour at several layers"; keeps each behavior "covered once, at the layer that owns it".
5. [PR 43310](https://github.com/discourse/discourse/pull/43310) (2026-09-04): dead code and redundant tests removed around the review queue after a redesign.
6. [PR 44467](https://github.com/discourse/discourse/pull/44467) (2026-10-11): fewer app loads and setup in system tests; consolidates flows, UTC timezone for fabricated users to avoid an extra request.
7. [PR 45461](https://github.com/discourse/discourse/pull/45461) (2026-11-02, closed unmerged): stabilizes reported flaky tests; causes named: fixture identity (user id 99 merging roles), unspecified row order, shared caches, transient browser state.
8. [PR 43250](https://github.com/discourse/discourse/pull/43250) (2026-09-04): flaky reports sent to triage.

## 6. Notable patterns (observed)

- Fabricators: 128 files; `fab!` (TestProf `let_it_be`) for shared records, 8,239 uses; inline `Fabricate` 17,398.
- Time: `freeze_time` in 215 spec files (680 lines); system specs use `time:` metadata so Ruby and browser clocks agree ([rails_helper.rb](https://github.com/discourse/discourse/blob/07e27ad972ac208ee568f071b07f757d4bdbd873/spec/rails_helper.rb)).
- Mocking: Mocha `.expects/.stubs` 2,286 lines vs rspec-mocks `receive` 482, `stub_request` (WebMock) 700. The guide wants mocks only at external boundaries, yet Mocha stubs of internals remain (inferred: legacy).
- Tracking helpers (`DiscourseEvent.track_events`, `MessageBus.track_publish`) instead of mocking `trigger`/`publish`.
- Page objects: classes under `PageObjects::Pages|Components|Modals`, instantiated with `let`.

## Signals for a reviewer

Good test:
- Drives the public entry point, asserts returned value, persisted state, enqueued job, response, or rendered output; names state a positive condition.
- Uses `fab!` for shared setup, `freeze_time`/`time:` for time, HTTP stubbed at the boundary.

Bad test:
- `expects(:internal_method).once/never` on a collaborator; raw CSS selectors or `sleep` in a system spec; regex `have_current_path`; DB assertions in a system spec; racing a spinner; more than 2 nesting levels; a literal in a negative assertion.
- Test written for the same behavior at several layers (PR 43629).

Unit to e2e boundary (checkable):
- Model/service change should have a model/service spec; endpoint change a request spec checking status and payload; a system spec only when a user flow or browser-server interaction changes. Component-local UI belongs in a QUnit integration test.
- Several system specs differing only internally: one flow, push branches down.

Suggestions to give:
- Replace an internal-call mock with an observable assertion; move a branch from system to request/service; put the saved-state check after `page.refresh`; remove the duplicate lower-layer assertion.

A test-mapping skill could automate:
- Map changed paths to the expected spec dir (`app/models/x.rb` to `spec/models/x_spec.rb`, controller to `spec/requests/x_controller_spec.rb`, `frontend/discourse/app/components/x` to `tests/integration/components/x-test.gjs`).
- Flag diffs with new `sleep`, raw selectors in `spec/system`, `Mocha expects(...).never`, or new tests with skip/pending.

## Caveats

- Counts are file/line greps (filenames and regex), not parsed ASTs; `time:` metadata was not found by my regex though the code uses it.
- Old merged PRs came from keyword search, so the sample is not exhaustive; I did not find the Patch Triage tracker's own location, and no written acceptance-to-system policy.
- Nothing from the clone was executed.
