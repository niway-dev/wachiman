# Cap: how it tests

Commit read: `4fb2fa7ffe00a80d36bf5c4a11c36558483d6f2c` on `main` ([tree](https://github.com/CapSoftware/Cap/tree/4fb2fa7ffe00a80d36bf5c4a11c36558483d6f2c)), 2026-11-16. Labels: observed, inferred, not found.

## In one minute

- Observed: tests are many but selective. About 860 TS test files (80% in `apps/web/__tests__`) and 61 Rust files under `tests/`; the CI runs a hand-picked list of `cargo test` filters, not the whole workspace.
- Observed: no coverage measurement anywhere. `AGENTS.md` says "no strict coverage yet".
- Observed: the strongest gates are not unit tests but real-capture workflows ("Engine verify", "Verify recording"), the only two required status checks on `main`.
- Observed: the last 100 merged PRs are all by one maintainer, with Greptile review in 95 PR bodies. Agent rules exist but mostly say how to verify, not when to add tests.
- Observed: flaky tests are fixed by diagnosing the race and rewriting the test, not by retries or skips.

## 0. Rough inventory

Counts from the git tree API at the pinned commit (observed):

| Layer | Where | Files |
| --- | --- | --- |
| Vitest (web unit, DB, e2e) | `apps/web/__tests__` | ~694 |
| Bun test | `apps/media-server/src` (74), `apps/render-farm` (16), `packages/infra-mcp`, `sdk-recorder`, `recorder-core`, `scripts/loops` | ~130 |
| Chrome extension | Vitest + Playwright (`apps/chrome-extension/e2e`, 3 specs, 17 unit) | ~20 |
| Rust `tests/` integration | `crates/verify` (21), `recording` (11), `rendering` (11), `export` (6), `apps/desktop-gpui` (5), others | 61 |
| Rust unit `#[cfg(test)]` | GitHub code search reports 396 files matching `cfg(test)` (single search, treat as approximate); 902 `.rs` files total | ~396 |
| Node `--test` | `scripts/*.test.mjs`, `.agents/skills/building/scripts` | ~11 |
| Swift | `swift test` for `apps/mobile-ios` in CI | not counted |

Notes:
- The desktop app is now GPUI (Rust-native UI), in `apps/desktop-gpui` (763 files). There is no `apps/desktop` Tauri directory; only a leftover `apps/desktop-gpui/tauri.conf.json` and a [performance comparison asset](https://github.com/CapSoftware/Cap/blob/4fb2fa7ffe00a80d36bf5c4a11c36558483d6f2c/.github/assets/gpui-vs-tauri-electron-performance.html). Tauri tests: not found (inferred: the app was migrated off Tauri).
- GPUI UI has only a few `tests/` files (glass presets, i18n build); a real-app smoke runs in `picker-smoke.yml` and `instant-reliability.yml` (observed workflow names). No Storybook (not found).
- Few tests visible for: `packages/ui` and `apps/web` React components (the tests are logic, DB and API oriented; inferred from directory names, not read file by file).

## 1. Coverage

Not found. No `codecov`, `llvm-cov`, `tarpaulin` or "coverage" in `ci.yml` or the tree. `AGENTS.md`: "Prefer unit tests for logic and light smoke tests for flows; no strict coverage yet" ([AGENTS.md](https://github.com/CapSoftware/Cap/blob/4fb2fa7ffe00a80d36bf5c4a11c36558483d6f2c/AGENTS.md)). Searched merged PR titles for "coverage": the search API was rate-limited, so this is not exhaustive.

## 2. How tests are used in CI

Observed in [`ci.yml`](https://github.com/CapSoftware/Cap/blob/4fb2fa7ffe00a80d36bf5c4a11c36558483d6f2c/.github/workflows/ci.yml) (runs on push, `pull_request`; a `changes` job filters by path):
- `typecheck` job also runs Chrome extension, recorder SDK, render-farm, Loops and workspace-tooling tests.
- `web-tests` runs `__tests__/unit` ("about a minute on this runner").
- `rust-tests` runs about 20 named `cargo test` filters (`-p cap-recording --lib -- --test-threads=1`, `--test cli ...`) instead of `cargo test --workspace`. Inferred: speed and platform constraints.
- `clippy` runs `cargo clippy --workspace -- -D warnings`; `ios` runs `swift test`.
- `lint-biome` ends `biome ci . || true`, so lint is non-blocking while `format-biome` blocks (observed).
- Other test workflows: `infra-database.yml` (MySQL suites), `engine-verify.yml`, `verify-recording.yml` (real capture), `recording-reliability.yml`, `instant-reliability.yml`, `sync-tests.yml`, `test-self-hosting.yml`, plus perf budgets (`perf-budget.yml`, `performance-regressions.yml`). Several also run nightly (cron).

Merge gating: a [repository ruleset](https://github.com/CapSoftware/Cap/rules) (via `gh api repos/CapSoftware/Cap/rules/branches/main`) lists two required checks: "Engine verify" and "Verify recording". `ci.yml` jobs are not listed as required (observed; classic branch protection returns 404).
Releases: `desktop-release.yml` is `workflow_call` with `needs: draft`/`build`; I found no test job gating it (inferred from grep, workflow not read in full).
Flakiness: no retry or quarantine mechanism found (`continue-on-error`, retry plugins: none). The practice is root-cause fixes, see section 4.

## 3. Documentation from tests

Not found: no Storybook, no doctest-driven docs, no generated API docs from tests. Observed related items:
- [`docs/recording-reliability.md`](https://github.com/CapSoftware/Cap/blob/4fb2fa7ffe00a80d36bf5c4a11c36558483d6f2c/docs/recording-reliability.md) states an invariant contract ("Decode every video frame and audio sample... Do not use `-shortest`... broader tolerances"), which the verify workflows enforce. It explains what to check, not which tests to write.
- `AGENTS.md` "Testing" is three lines. Rust doc tests: not checked.

## 4. Cleanups and migrations

I found no PR that removes or disables tests (searches by title were cut short by GitHub search rate limits; only the latest 100 merged PRs were scanned). What exists is repair work:
- [#4284](https://github.com/CapSoftware/Cap/pull/4284) (2026-11-16): fixes a test that counted requests shared across tests; the PR says "The download code is fine."
- [#4285](https://github.com/CapSoftware/Cap/pull/4285) (2026-11-16): serialises MySQL suites that drop a shared table.
- [#4243](https://github.com/CapSoftware/Cap/pull/4243) (2026-11-14): relaxes an assertion in an auto-top-up race to "accept either amount", after a failure on main.
- [#4261](https://github.com/CapSoftware/Cap/pull/4261) (2026-11-14): "tests that depend on how fast the build machine is" broke the Railway image build.
- [#4215](https://github.com/CapSoftware/Cap/pull/4215) (2026-11-13): adds Infra database suites to CI.
Migration Tauri to GPUI exists structurally (see section 0); the specific PRs were not traced.

## 5. Written rules about tests

- `AGENTS.md` Testing: "Name tests `*.test.ts(x)` near sources", "`cargo test` per crate; tests in `src` or `tests`", "no strict coverage yet". Post-edit checks tell agents to run "scoped, fast checks over full workspace gates", `cargo check -p <crate>` and Biome on touched files, and "report anything skipped". Notably the post-edit gate lists no test command.
- `CLAUDE.md` is one line: "Read `AGENTS.md`". No `.cursor` rules, no PR template (`.github` has only a bug-report issue template).
- `CONTRIBUTING.md`: no mention of tests (observed by grep).
- The "building" skill ([SKILL.md](https://github.com/CapSoftware/Cap/blob/4fb2fa7ffe00a80d36bf5c4a11c36558483d6f2c/.agents/skills/building/SKILL.md)) asks for evidence per OS and says infrastructure-only changes can give "relevant test evidence" in place of a demo.
- Rules on when NOT to add a test: not found. The only "do not" nearby is for comments ("Default to no code comments").

## 6. AI and tests

- Observed: all 100 most recent merged PRs are authored by one account (`richiemcilroy`); no bot authors. 95 of 100 bodies carry a Greptile summary with a confidence score. `Co-authored-by` trailers are banned in `AGENTS.md`, so agent authorship is hidden; one PR body has "Generated with Claude Code". Inferred: agents write most code, given the agent-rule files, PR volume (about 70 PRs in four days) and PR bodies mentioning "agent testing".
- `.claude/agents/coderabbit-pr-reviewer.md` applies CodeRabbit review comments automatically (observed).
- Test PRs are titled `test(...)` and tied to a CI failure or a race, so tests appear as reaction to failures (inferred from section 4 sample). 94 of 100 PR bodies mention "test"; whether each PR adds a test file was not measured.
- Rule: "Deep Investigation Default" asks agents to separate "verified vs merely plausible" and to "verify the actual user-visible outcome". No rule specific to AI-written tests.

## Signals for an AI reviewer

- Read workflow-level gates, not just file counts: the only required checks are real-capture verifiers; unit CI is advisory.
- A test that "fails sometimes" should get a cause (shared state, timing, shared DB table) as in #4284 and #4285, not a retry or skip.
- Check that CI actually runs the new test: Cap uses an explicit list of `cargo test` filters, so a new Rust test can go unrun.
- Agent rules here are about lint and scope; a reviewer cannot assume a rule asks for tests or forbids them.
- Greptile-style bot summaries are in PR bodies; treat their confidence score as bot output, not evidence.

## Caveats

- GitHub search hit its rate limit, so section 4 uses only the latest 100 merged PRs and found no removals; older removals may exist.
- The 396 `cfg(test)` figure is a code-search count, not a tree count.
- The ruleset's required checks were read via API at fetch time (2026-11-16), not pinned to the SHA.
- Release gating and Rust doc tests were only grepped, not read in depth.
