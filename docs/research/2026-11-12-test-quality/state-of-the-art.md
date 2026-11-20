# State of the art: test linters and configurable review policy

- Date: 2026-11-12
- Status: research
- Related: [synthesis](synthesis.md), [decisions](decisions-2026-11-12.md)

## In one minute

- No mainstream tool classifies tests by value. Smell detectors and lint plugins find structural problems (no assertion, `.only`, fixed sleeps); none says "this test is low value, delete it".
- The only established proof of a test's value is mutation testing: a test that kills no mutant protects nothing. It is too slow to run whole-repo per PR, so Google and Stryker both run it on the diff or incrementally.
- Lint plugins are cheap, deterministic and already cover most "bad test" rules we would write (`expect-expect`, `no-focused-tests`, `no-wait-for-timeout`). A test-map skill should reuse them, not reimplement them.
- Every AI reviewer takes free-text, path-scoped instructions. Only some give test-specific handling, and in all of them "test policy" is just a path glob plus prose. Blocking is opt-in and separate from the instructions.
- LLM-based test-quality work (2024-2026) is mostly academic and shows accuracy around 75-80% for smell detection, with refactors that sometimes add new smells. It is usable as a second-opinion classifier, not as a gate.

## Q1 — Linters, smell detectors and proof of test value

| # | Name | URL | What it does | Adoption / maintenance | Relevance to us |
|---|------|-----|--------------|------------------------|-----------------|
| 1 | tsDetect (TestSmellDetector, Java) | https://github.com/TestSmells/TestSmellDetector | Rule-based detector for about 19-21 smell types (Assertion Roulette, Eager Test, Mystery Guest...) in Java tests; the reference tool of the research catalogue at testsmells.github.io. | 80 stars, last push 2022-10; most-cited and most-forked in a 2021 mapping study (count of smells unverified, sources disagree). Academic, effectively unmaintained. | Source of the smell vocabulary, not a tool to run on TypeScript. |
| 2 | JNose Test | https://sol.sbc.org.br/index.php/sbes/article/view/17051 | Java smell detector with an extensible core (JNose-Core); reported precision 91-100% in its own paper. | Academic (UFBA); no adoption data found (unverified). | Confirms the pattern: smells are detected by AST heuristics. |
| 3 | PyNose | https://arxiv.org/abs/2108.04639 | Python smell detector (PyCharm plugin) from ASE 2021; adds the "Suboptimal Assert" smell. | Research tool; maintenance status not checked (unverified). | Same lesson in another language. Nothing here for TypeScript or Playwright. |
| 4 | eslint-plugin-jest | https://github.com/jest-community/eslint-plugin-jest | Rules such as `no-disabled-tests`, `no-focused-tests`, `valid-expect`, `expect-expect`. | 1,175 stars, pushed 2026-11-09, widely used. | The practical form of "test smell detection" in JS. |
| 5 | eslint-plugin-vitest and eslint-plugin-testing-library | https://github.com/vitest-dev/eslint-plugin-vitest and https://github.com/testing-library/eslint-plugin-testing-library | Vitest-flavoured equivalents and Testing Library misuse rules. | 518 and 1,065 stars; both pushed within the last month. | Direct fit if Wachiman's target repos use Vitest. |
| 6 | eslint-plugin-playwright | https://github.com/playwright-community/eslint-plugin-playwright | `expect-expect` (test has no assertion), `no-wait-for-timeout` (fixed sleeps cause flakiness), `valid-expect`. | 398 stars, pushed 2026-11-02. | Strongest cheap proxy for "assertionless" and "flaky by construction" e2e tests. |
| 7 | rubocop-rspec | https://github.com/rubocop/rubocop-rspec | RSpec-specific cops (example length, multiple expectations, nesting). | 861 stars, pushed 2026-11-07. | Shows that style/size limits are configurable per directory; a model for severity config. |
| 8 | tparallel (Go) | https://github.com/moricho/tparallel | Go linter that checks `t.Parallel()` use. | 28 stars, last push 2024-06 (stale). | Minor. Go linters (thelper, tparallel) were named in the brief but I did not verify thelper. |
| 9 | Stryker (StrykerJS) | https://github.com/stryker-mutator/stryker-js | Mutation testing for JS/TS with a Vitest runner and `--incremental` mode that re-tests only changed mutants. | 3,361 stars, v10.1.1 on 2026-10-23. | The proof tool for "does this test protect anything". Incremental mode makes PR-scoped runs plausible; it does not see changes outside mutated and test files. |
| 10 | mutmut and PIT | https://github.com/boxed/mutmut and https://github.com/hcoles/pitest | Mutation testing for Python and Java. | 1,537 and 1,890 stars; both pushed within the last week. | Not our languages; relevant only as proof the approach is standard. Little detail verified (search was thin). |
| 11 | State of Mutation Testing at Google (ICSE-SEIP 2018) | https://research.google/pubs/state-of-mutation-testing-at-google/ | Diff-based mutation testing in code review: about 1.1M mutants over 70,000+ diffs, 150,000 findings shown; reported usefulness rose from 20% to 80% after feedback. | Used by thousands of Google engineers; figures vary between paper versions. | The key design precedent: mutate only changed lines, show survivors as review comments, let reviewers mark them unhelpful. |
| 12 | knip | https://github.com/webpro-nl/knip | Finds unused files, exports and dependencies in JS/TS. | 12,658 stars, v6.45.1 on 2026-11-11. | Test files count as entry points by default, so exports used only by tests are hidden. `--production` mode reveals test-only exports (from third-party summaries; check knip.dev). |
| 13 | Trunk Flaky Tests | https://docs.trunk.io/flaky-tests/overview | Detects flaky tests from CI results and quarantines them so they stop failing the merge gate. | Commercial, CI-agnostic. Vendor claims only (unverified). BuildPulse and Datadog Test Optimization are alternatives. | Quarantine is a runtime-history signal; a static test-map cannot provide it. |
| 14 | Evaluating LLMs at Detecting and Correcting Test Smells | https://arxiv.org/abs/2506.07594 | Compares GPT-4-Turbo, LLaMA 3 70B, Gemini 1.5 Pro on Python and Java; best detection accuracy 74% (Python) and 80% (Java); fixes sometimes introduce new smells. | Academic preprint, June 2025. | Evidence that an LLM verdict on test quality is a hint, not proof. |
| 15 | LTM: similarity-based test suite minimization | https://arxiv.org/abs/2304.01397 | Uses code-model embeddings plus a genetic algorithm to drop redundant tests; fault detection 0.84 vs 0.81 for the prior approach. | Academic; revised through 2024. I did not find a 2025-2026 LLM pruning tool in use (unverified). | The nearest thing to automated test pruning, and it is research-grade. |
| 16 | ast-grep, jscodeshift, ts-morph | https://github.com/ast-grep/ast-grep, https://github.com/facebook/jscodeshift, https://github.com/dsherret/ts-morph | AST tools to find and rewrite code in bulk, so tests can be deleted or moved by script. | 16,581 / 10,049 / 6,227 stars; all active (ts-morph last push 2026-09-29). | ast-grep rules are YAML, so "find tests matching pattern X" can be a declarative, reviewable rule file. |

Notes:

- Smell detectors and lint rules answer "is this test written badly?". Mutation testing answers "does this test catch anything?". These are different questions, and only the second is about value.
- Test impact analysis and selective testing (running only tests affected by a change) got no tool-specific evidence in my search. I did not verify tools such as Nx affected, Jest `--changedSince`, or Datadog's impact analysis. Treat that area as open.
- Test-only export detection works the other way around from what we may want: knip is built to treat tests as legitimate consumers. Finding "code that only tests use" needs production mode.

## Q2 — How AI reviewers let teams set policy

| Tool | Config file / format | Per-path override | Test-specific handling | Blocking? |
|------|----------------------|-------------------|------------------------|-----------|
| CodeRabbit | `.coderabbit.yaml`; `reviews.path_instructions` (list of `path` glob plus `instructions`, max 20,000 chars), `path_filters`, `profile: chill` or `assertive`, `pre_merge_checks.custom_checks`. Source: https://docs.coderabbit.ai/reference/configuration.md | Yes: path_instructions and `!` exclusions in path_filters; auto-approval overrides by path and team | The official example is a `tests/**` instruction ("descriptive names, edge cases, error paths"); no built-in test classifier | Opt-in: `request_changes_workflow`; custom checks have `mode: off / warning / error`, and `error` can block only when request-changes is on |
| Greptile | `.greptile/config.json` (settings and structured rules with `scope` globs, `strictness` 1-3), `.greptile/rules.md`, `files.json`. https://www.greptile.com/docs/code-review/greptile-config-reference | Yes: directory cascade (child inherits and can override or `disabledRules` by id) plus rule `scope` | None found | Not verified |
| Macroscope | `macroscope.md` in repo root or any folder; parent files merge, `macroscope_root.md` stops inheritance. Custom Rules is beta and runs as a separate CheckRun. Docs seen only via mirrors; verify at docs.macroscope.com | Yes: by folder | None found | Reports as a check run; blocking behaviour not verified |
| Graphite (Diamond, now Graphite Agent) | Dashboard "Rules & exclusions": custom prompts or file-based rules. https://graphite.com/docs/ai-review-customization | Exclusions and rules by file pattern (details not fully verified) | None found | Not verified |
| GitHub Copilot code review | `.github/copilot-instructions.md` (repo-wide), `.github/instructions/**/*.instructions.md` with `applyTo` glob, `AGENTS.md`; `excludeAgent` frontmatter picks code review vs coding agent. https://docs.github.com/en/copilot/tutorials/customize-code-review | Yes, via `applyTo` (`applyTo` confirmed by a GitHub changelog, not by the docs page I fetched) | None built in | By default its reviews do not count toward required approvals; optional approval mode exists |
| Qodo / PR-Agent | `.pr_agent.toml` (same keys as `configuration.toml`); `[pr_reviewer] extra_instructions`, `[ignore] glob`. https://github.com/qodo-ai/pr-agent | File exclusion by glob; instructions are global prose, not per path (as far as verified) | None found | Review tool has `require_score_review` style settings; hard blocking not verified |
| Sourcery | `.sourcery.yaml`; top-level `ignore`, custom rules with `paths.include` / `paths.exclude`. https://docs.sourcery.ai/Coding-Assistant/Reference/Configuration/sourcery-yaml/ | Yes, per rule | Docs example excludes `test_*.py` from a rule, i.e. tests are opted out, not specially reviewed | Not verified |

Adoption: PR-Agent has 16,004 stars (pushed 2026-11-12). Other vendors are closed source; I have no verified adoption numbers.

Notes:

- The common shape is: a version-controlled file, glob-scoped prose instructions, an exclusion list, and a strictness knob. Nobody offers a typed "this is a test of kind X" concept.
- CodeRabbit is the only one where I confirmed a blocking mechanism and a test-path example in primary docs.
- Config is read from the PR's base branch in CodeRabbit (third-party claim, unverified), which matters for a rollout.

## What this means for a test-map skill

- Classify with existing signals first. `eslint-plugin-playwright`, `-jest`/`-vitest` and `-testing-library` already give deterministic findings (no assertion, skipped, focused, fixed sleeps). Run them and map their output rather than writing new smell rules.
- Treat "value" as a claim that needs proof. The only established proof is mutation survival, so the map should say "unproven" for a test with no mutation data, not "low value".
- If mutation data is wanted, follow Google's design: diff-scoped, shown as reviewable findings, with a way to mark a finding useless. Stryker incremental with the Vitest runner is the available JS option.
- Bulk edits should be declarative where possible: ast-grep rules for "find", jscodeshift or ts-morph only for rewrites that need types.
- Keep runtime-history signals (flaky, slow) as optional inputs. They come from CI result stores, not from the repository.

## What this means for Wachiman's test policy config

- Use the market's shape: a repo file, glob-scoped rules, a per-path severity, and an exclusion list. Copy CodeRabbit's `path_instructions` plus Greptile's directory cascade (inherit, override, disable by id).
- Add one thing others lack: a small set of named test kinds (for example unit, integration, e2e) that a glob maps to, so policy can say "e2e tests must assert" without prose.
- Keep blocking separate from instructions, as CodeRabbit does (mode off / warning / error). Default to warning.
- Give tests their own default stance. Sourcery opts tests out of rules; CodeRabbit treats tests as just another path. A deliberate default ("tests are reviewed for value, not style") would be a differentiator.
- Make the effective config inspectable on a PR (CodeRabbit has `@coderabbitai configuration`, per third-party sources), so teams can see which rule applied.

## Caveats

- Many details come from web-search summaries and third-party guides, not the primary docs. Items marked "not verified" or "unverified" were not confirmed.
- Star and push dates are from the GitHub API on 2026-11-12. I did not check release cadence for every repo.
- The CodeRabbit schema and examples were read from its official configuration reference. The Copilot, Greptile, Macroscope, Graphite, Qodo and Sourcery rows are from search results and one Copilot docs page.
- Test impact analysis and 2025-2026 LLM test-pruning tools were searched but yielded no solid tool-level evidence.
- The tool count in the brief exceeded what I could verify; thelper, Playwright-specific smell detectors beyond the ESLint plugin, and Macroscope blocking behaviour were not checked.
