# t3code: the purge pipeline and the test-signal agent, in rebuildable detail

- Date: 2026-11-12
- Status: evidence
- License of source: MIT (`gh api repos/pingdotgg/t3code/license` returns `MIT`). We may adapt the prompts, rubric wording and eval code with attribution to the t3code authors (https://github.com/pingdotgg/t3code). Quotes below are marked as such.
- Related: [02](02-the-big-purge.md), [04](04-codified-criteria.md), [index](../README.md)

Labels: **[Observed]** = stated in a PR or readable in a file I fetched. **[Inferred]** = my reading. This extends 02 and 04; it does not repeat their taxonomy or lint-rule tables.

## In one minute

- **[Observed]** The purge ([#22557](https://github.com/pingdotgg/t3code/pull/22557)) committed no tooling. One commit, 1,895 files, all of them tests, fixtures, docs or config. The rubric, prompts, swarm driver, voting script and AST deleter were run locally and are not in the repository. What we have is the PR body's description of them.
- **[Observed]** The rubric is two sentences: a delete list of eight classes and a keep list of six areas. There is no scoring scale, no output schema and no prompt text anywhere public.
- **[Observed]** The measurement is a single table made with the vitest JSON reporter, same commands and machine, per package: test counts and wall time before and after.
- **[Observed]** The re-audit was human plus model review of the deletions after the fact: 22 tests restored inside the purge, then four restore PRs (29 cases) conditional on a second purge ([#24058](https://github.com/pingdotgg/t3code/pull/24058)) that deleted 126 more.
- **[Observed]** The test-signal agent ([#26166](https://github.com/pingdotgg/t3code/pull/26166)) is a 27-line file for the Macroscope check-run-agent product, 88 words of instruction that point at `docs/internals/testing.md`. It is tuned with a committed eval of 10 cases (6 bad, 4 guard).
- **[Inferred]** The reusable core is three things: a short rubric in prose, a pointer-style review prompt, and an eval that grades "flag the bad" and "stay silent on the good" equally.

## The purge pipeline, step by step

Timeline: PR opened 2026-10-20T23:38Z, merged 2026-10-21T00:17Z (about 40 minutes open; the restore PRs call it "the 2026-10-20 test snap"). Author t3dotgg. Single commit message: `test: delete 11k low-signal tests so CI runs faster and flakes less`, with a `Co-Authored-By: Claude Opus 5.5` trailer ([commits API](https://api.github.com/repos/pingdotgg/t3code/pulls/22557/commits)).

1. **Inputs.** **[Observed]** "A swarm of Claude Haiku 5.5 agents read every test file." The unit is a test file, the decision unit is a test title. The universe was all test files (`*.test.*`, including `.browser.test.*`) in seven workspaces, 25,928 tests. **[Inferred]** The swarm got the file text and the rubric; whether it got the code under test is not stated.
2. **Rubric.** **[Observed]** One written rubric shared by all agents. Full text in the next section. No prompt wording, examples or output format is published.
3. **Classification passes.** **[Observed]** "About half the files (987) got two independent passes. There a test is deleted only when both agree... The other files got one pass." **[Inferred]** The two-pass half was probably chosen by risk or size, because the PR does not say why 987. Deletion needs agreement of both passes, so a double pass is strictly more conservative than a single one. An unstated detail is what a single pass means for the other half: the PR says nothing about a stricter threshold there.
4. **Voting.** **[Observed]** "A third Haiku vote settled the ~1,900 disagreements." So disagreement means one pass said delete and the other said keep, and a third independent pass is the tiebreaker (2 of 3 wins). **[Inferred]** The 1,900 are test-level, not file-level.
5. **Applying deletions.** **[Observed]** "Deletions are applied with the TypeScript AST, matched by test title, not by hand. Imports and helpers left unused afterwards are removed the same way." **[Inferred]** Mechanism: parse each file, find `it`/`test` calls (and likely `it.effect`, `it.each` rows) whose first string argument equals a title on the delete list, remove the node, then run an unused-import and unused-helper pass. Title is the join key because it survives across passes and needs no line numbers. Titles are not unique within a file, so an unstated tie-break must exist.
6. **Follow-on cleanup.** **[Observed]** `knip --exports` then failed on about 420 exports used only by deleted tests. They were un-exported, and about 48 declarations with no caller were deleted ("so there is no production behavior change"). One production file, `builtInProviderAdapterDrivers.ts`, only fed a test and was removed together with its doc line. Orphaned fixtures (`*.fixture.mjs`) went, `shardWeights.json` was edited to drop deleted files and scale trimmed ones "by their measured speedup", and the `knip.jsonc` and test-list entries were updated. **[Inferred]** knip is the dead-code oracle after every deletion round; it is how a test purge turns into a source purge.
7. **Verification.** **[Observed]** Typecheck (all packages), lint, fmt check and `knip:check` on the rebased head. Before/after table, "same commands and machine (vitest JSON reporter)":

   | Package | Tests | Wall time |
   |---|---|---|
   | server | 7,478 to 4,840 | 1,040s to 564s |
   | web (unit + browser) | 8,509 to 4,240 | 132s to 53s |
   | mobile | 3,478 to 2,199 | 34s to 27s |
   | client-runtime | 2,261 to 1,260 | 8s to 6s |
   | desktop | 1,665 to 934 | 20s to 5s |
   | shared | 1,842 to 1,235 | 5s to 3s |
   | contracts | 695 to 139 | 1s to 1s |
   | total | 25,928 to 14,847 | summed file time 1,205s to 490s |

   The 59% figure is the summed per-file time, not CI wall time. **[Observed]** The PR also lists residual failures that "fail the same way on `main` on this machine" (four server suites) and one flaky browser test, to separate pre-existing failures from regressions. It found a side effect: with fewer tests Vite's dependency scan missed `@base-ui/react/autocomplete` and reloaded mid-run, so browser tests now pre-bundle it. A purge can expose test-infrastructure coupling.
   **[Inferred]** Method for us: run the JSON reporter per package on `main` and on the branch, sum `assertionResults` count and per-file duration, and diff. The mutation-proof method from [#13922](https://github.com/pingdotgg/t3code/pull/13922) was not used here.
8. **Review rounds.** **[Observed]** "Reviewed with sol-loop: 2 rounds with GPT-6.1 Sol. Sol verdict: approved." Result: 22 auth boundary tests restored, which the swarm cut as "timing" although they use the deterministic Effect clock (session and websocket credential expiry, desktop bootstrap expiry and rotation, MCP credential liveness and isolation, the one-scope-per-RPC guard, scope-narrowing checks). **[Observed]** Bot comments only on the PR: Macroscope "Needs Human Approval" (auth directories touched, auth coverage removed), a thread-transfer size report, and a diagram explainer from an outside user. No human line comments. The `sol-loop` is a local skill; I found no copy in the repository (code search for `sol-loop` in the repo returned nothing).
9. **Re-audit after merge.** **[Observed]** Four restore PRs, merged 2026-10-23 within 20 minutes of each other: [#23977](https://github.com/pingdotgg/t3code/pull/23977) (render scheduler, 27 lines: "the only direct test", scheduler "still ships"), [#23980](https://github.com/pingdotgg/t3code/pull/23980) (clipboard failure logs must not leak secrets, 5 tests), [#23991](https://github.com/pingdotgg/t3code/pull/23991) (7 DST scheduling tests, expected instants recomputed so a wall-clock regression would fail all three New York cases), [#24011](https://github.com/pingdotgg/t3code/pull/24011) (16 project-permission browser tests, 556 lines). Pattern in every body: name the behavior, say that the deleted test was the only guard, restore byte-for-byte, and run the file. #24011 went further: review found three restored revocation tests that "could pass if the guard never ran" (a `.blur()` that Chromium never fires on a newly disabled input), so they were strengthened and mutation-checked ("with the grant recheck short-circuited, exactly those three tests fail and the other 13 pass").
   **The deal [Observed]**: [#24058](https://github.com/pingdotgg/t3code/pull/24058) says "delete at least twice as many low-value tests first, so the suite does not just grow back". It removed 126 cases (4.3x the 29 restored; 2,561 net lines), by class: dead exports with their tests (each symbol "grep-verified caller-less across the repo"), duplicates with stronger twins, copy and schema mirrors, trivial table rows ("every implementation branch keeps at least one row"). Then a Claude Opus 5.5 review found 9 cuts that went too deep and restored them in a second commit (`test: restore guards cut too deep in the low-value sweep`): for example the checkpoint `diff.noprefix` guard, the preview-tools allOf guard, timestamp rows, amount-regex branches, the release-notes heading skip. Two nits were declined with reasons. **[Inferred]** The re-audit loop is: restore requests come from noticing an unprotected behavior later; each restore must be paid for by deleting a multiple of low-value tests; every deletion round gets a second reviewer from a different model family, whose job is to find over-cuts.

## The rubric

**[Observed]** Everything the PR publishes ([body](https://github.com/pingdotgg/t3code/pull/22557)), MIT, quoted verbatim:

> Delete: type-redundant, trivial logic, basic DOM behavior, real or fake timers, mock-call mirrors, smoke tests, duplicate table cases, and wall-clock perf asserts. Keep: orchestration and event-sourcing correctness, provider protocol translation, auth and permission guards, persistence and migrations, external-format parsing, and deterministic race fixes.

Plus the problem statement: "a lot of tests check things types already guarantee, mirror the code, or wait on real timers. They cost time and give no signal."

Observations that matter when rebuilding:

- **[Observed]** The rubric carries no examples, no decision rule for conflicts, and no per-class threshold. The `Keep` list is a short allowlist of risk areas, so it works as a veto: a "delete" candidate inside a keep area should survive.
- **[Observed]** The veto failed in practice twice: the 22 auth tests cut as "real or fake timers" (the clock was the deterministic `TestClock`, so the "timers" class should not apply), and DST tests (a keep area in spirit, "deterministic race fix", not in letter). **[Inferred]** The weak class is "real or fake timers": it conflates flaky wall-clock waits (bad) with deterministic virtual clocks (good). A rebuild should split that class by clock kind.
- **[Observed]** The post-merge restore PRs add negative evidence about the rubric's other classes: "only direct test of a shipping module" (render scheduler), "only test of a security property" (secret redaction), "only test of a calendar edge" (DST). **[Inferred]** The missing rubric line is "delete only if some other test or the type system still fails when the behavior breaks", which is what the later guidance expresses as "the lowest layer that fails on `main`".
- **[Observed]** The later codified form (the "What to test" bullets) is in [04](04-codified-criteria.md) and shorter; it replaced the rubric as the working standard.

## The test-signal agent

Introduced by [#26166](https://github.com/pingdotgg/t3code/pull/26166) (merged 2026-10-28, merge commit [68495b6](https://github.com/pingdotgg/t3code/commit/68495b641b3e5834421b6549751eb65ed66fc6f4)). Files on main: [test-signal.md](https://github.com/pingdotgg/t3code/blob/main/.macroscope/check-run-agents/test-signal.md), [testing.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/testing.md), the other checks next to it ([effect-service-conventions.md](https://github.com/pingdotgg/t3code/blob/main/.macroscope/check-run-agents/effect-service-conventions.md), [ui-consistency.md](https://github.com/pingdotgg/t3code/blob/main/.macroscope/check-run-agents/ui-consistency.md)).

**File structure [Observed].** YAML front matter, then a markdown body. The front matter, verbatim except for comment placement:

```
title: Test Signal
model: gpt-6-1-terra
reasoning: low
input: incremental
tools: [browse_code, modify_pr]
include: ["**/*.test.*"]     # comment: overrides ignore.md, which skips test files for every other check
exclude: [".repos/**"]
requires: [Check]
maxBudgetPerRun: 1
maxBudgetPerPR: 5
conclusion: neutral
```

The body (the part the model sees) is three short paragraphs:

> Review only the tests this pull request adds or grows. Tests it moves, renames, or deletes are not findings. The rules are in `docs/internals/testing.md` under `## What to test`; read that section first and hold new tests to it.
>
> Post each finding as a brief inline comment on the new test with one fix. Ask only for fewer or smaller tests, never for more coverage.
>
> When there are no findings, make the entire final response exactly `All clear` on one line with nothing else.

**Prompt structure, in order [Observed]:** (1) scope: tests added or grown, with explicit non-findings (moves, renames, deletes); (2) criteria by reference: one section of one document, read first; (3) output contract: inline comment, brief, one fix, direction restricted to "fewer or smaller"; (4) empty-output contract: exact string `All clear`. **[Inferred]** The three non-obvious choices are all about suppressing noise: the scope exclusion avoids flagging the purge itself, the direction restriction avoids a "write more tests" bot, and the exact-string rule makes silence machine-checkable.

**Inputs [Observed]:** the PR's diff for files matching `include` (`input: incremental`, so only the new push), and `browse_code` (read files and grep at the PR head). `modify_pr` is the comment-posting tool. The eval's stand-in tools are `read_file(path, start_line, end_line)`, `grep(pattern, path)`, and `post_comment(path, line, body)`.

**Criteria source [Observed]:** `testing.md` `## What to test`, six bullets (behavior that can break plus a leave-out list, extend before you add, one layer, browser tests only when a real browser is needed, how to ask for a missing test and what to name as the fix, backend ships tests). The text is in [04](04-codified-criteria.md). `AGENTS.md` repeats the writing rules for coding agents and says to change both together.

**Output contract [Observed]:** zero or more inline comments, each with one fix; final message either free text or exactly `All clear`. The eval grader enforces the latter literally (`input.final.trim() !== "All clear"` fails a guard), so "All clear. Nice tests." fails.

**CI wiring [Observed, partly Inferred].** There is no GitHub workflow for it: the file list of `.github/workflows` has no macroscope or test-signal entry. It runs inside Macroscope, a hosted review product that reads `.macroscope/check-run-agents/*.md` and posts a GitHub check run. `requires: [Check]` **[Inferred]** means it starts after the repo's `Check` job passes. `conclusion: neutral` means the check run ends neutral, so it appears on the PR and never blocks merge. Budget caps (1 per run, 5 per PR) bound cost, and the PR notes the model is "GPT-6.1 Terra at low reasoning, with a smaller budget". `.macroscope/ignore.md` is a repo-wide skip list that includes test files; the agent's own `include` overrides it for this check only. CodeRabbit's test glob was widened in the same PR to `**/*.test.*` because the old `{ts,tsx}` glob missed 13 `cjs/mjs/js/py` tests.

**How the prompt was shortened [Observed]** ([#26166 body](https://github.com/pingdotgg/t3code/pull/26166)):

| Prompt | Words | Terra bad | Terra good | Luna bad | Luna good |
|---|---|---|---|---|---|
| First draft with checklist | 231 | 5/5 | 4/4 | 5/5 | 2/4 |
| Shorter reporting | 196 | 5/5 | 4/4 | 5/5 | 2/4 |
| Pointer to testing.md (shipped) | 88 | 5/5 | 4/4 | 5/5 | 2/4 |

Final shipped prompt: Terra 27/27 samples, an earlier five-sample run 44/45, Sol 18/18. "GPT-6 Luna is too weak for this check at any length": it flags good bug-fix tests on every prompt. "Adding a table-row line back made Luna flag more good tests." Lesson: a cheaper model needs the rules to live in one referenced document rather than in the prompt, and the minimal model is chosen by the guard cases, not the bad cases (all models caught all bad cases).

## The evals

Location: [evals/test-signal/](https://github.com/pingdotgg/t3code/tree/main/evals/test-signal): [README.md](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/README.md), [cases.ts](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/cases.ts), [grade.ts](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/grade.ts), [run.ts](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/run.ts), [run.test.ts](https://github.com/pingdotgg/t3code/blob/main/evals/test-signal/run.test.ts) (unit tests for the grader).

**Run script [Observed].** `pnpm test-signal --out runs/baseline`. The script reads the check file, strips front matter, hashes the body (12-char SHA-256 prefix) and counts words. For each case it builds a "world": for a `real` case, `git diff <rev>~1 <rev> -- <paths>` (an empty diff is an error, so a guard cannot pass vacuously); for a `synthetic` case, it takes the file at `rev`, inserts one test after an `after` anchor string, and diffs before/after. It calls a Responses-API model with a wrapper system prompt (stand-in for Macroscope's, which is "not public"):

> You are a Macroscope Check Run Agent reviewing a GitHub pull request. Follow the check instructions below. Read the repository at the pull request head with read_file and grep. Leave inline review comments with post_comment. Then give your final response. `<check_instructions>` body `</check_instructions>`

The user message is the diff in a fenced block. The loop runs up to 16 steps: the model calls `read_file`, `grep` (git grep at `rev`, overlay files searched in served form, 80 lines max, bad regex errors returned to the model) or `post_comment` (recorded, answered "Posted."). The rule files (`docs/internals/testing.md`, `AGENTS.md`) are served from the current checkout because old case commits predate them. Flags: `--prompt <variant>`, `--case <id>` (repeat), `--samples <n>` (default 2, a third when exactly one of two passes), `--concurrency` (6), `--reasoning` (low), `--model` (defaults `gpt-6.1-terra`, `gpt-6-luna`). Output: `results.ndjson` per sample and `summary.md` (prompt hash, words, per model: bad caught, guards clean, errors, tokens, list of failing cases). A case passes by majority of samples; an errored sample counts as a failure. Cost about 0.5M tokens for a full run on both models.

**Grading [Observed].** Bad: pass if any comment lands in a target test's line range, with 2 lines of slack above (models often anchor on the blank line or brace above). Target ranges are found by test title (`it(` / `test(` / `describe(` lines) up to the next test start. Guard: pass only if zero comments and the final reply is exactly `All clear`.

**Cases [Observed]** (10 on main: 6 bad, 4 guard; the #26166 body says 9, so one bad case was added after merge):

| Case id | What it contains | Expected |
|---|---|---|
| `copy-text-at-every-call-site` | Real, from [#23999](https://github.com/pingdotgg/t3code/pull/23999): "PR" vs "MR" label tests in 3 files (5 test titles) | flag the 5 targets |
| `same-case-in-wrapper-test` | Real, from [#22452](https://github.com/pingdotgg/t3code/pull/22452): the same two cases in `threadAccess.test.ts` and `OrchestratorMcpService.test.ts` | flag either copy of either case (4 target titles) |
| `new-it-for-a-table-row` | Synthetic: a new `it` for a Windows path next to a table that already covers it | flag it |
| `mock-call-mirror` | Synthetic: a test whose only assertion is `respond` called with `"decline"`, covered above it | flag it |
| `type-guaranteed` | Synthetic: `typeof f() === "boolean"` | flag it |
| `logic-in-browser-test` | Synthetic: a pure-function test placed in a `.browser.test.tsx` that never renders | flag it |
| `deadlock-race-fix` | Real, from [#22094](https://github.com/pingdotgg/t3code/pull/22094): run metrics read lineage inside the transaction | no comment, `All clear` |
| `clone-retry-fix` | Real, from [#23170](https://github.com/pingdotgg/t3code/pull/23170): clones retry over HTTPS when SSH is refused | no comment, `All clear` |
| `deleted-tests` | Real, from [#22592](https://github.com/pingdotgg/t3code/pull/22592): a diff that only prunes tests | no comment, `All clear` |
| `new-table-row` | Synthetic: the right way to add the Windows path case (a row in the existing table) | no comment, `All clear` |

The #26166 body counts 5 bad and 4 guard; `cases.ts` on main has 6 bad and 4 guard. Case data model: `id`, `kind` (bad or guard), `source` (human note), `rev` (commit), `targets` (path plus test title), and either `paths` (real) or `path`, `after`, `insert` (synthetic). **[Observed]** The README says to add a real case by naming a merged commit and its test paths, a synthetic case by inserting one test after an anchor, and bad cases by listing titles.

## What we would need to rebuild it

| Component | What it needs | Per language |
|---|---|---|
| Classifier prompt | The two-list rubric, plus fixes the PRs imply: split "timers" by clock kind, a veto for risk areas, "delete only if another layer still fails when the behavior breaks". Output one JSON verdict per test: id, `delete`/`keep`, class, one-line reason | Rubric is language-agnostic; examples per framework |
| Test enumeration | List tests as (file, title, line range) | JS/TS: AST (`it`, `test`, `it.each`). Python: `ast` for `def test_`. Go: `go test -list`. Swift/Kotlin: framework-specific parser |
| Voting | Run N independent passes, delete only on agreement, third vote on splits. Store per-pass JSON so disagreements are countable | None |
| AST deleter | Remove a test node by title, then clean unused imports and helpers. Titles are not unique, so key by (file, title, ordinal) | Per language: TypeScript compiler or ts-morph, `libcst` for Python, tree-sitter elsewhere |
| Dead-code oracle | After deletion, find exports only tests used | knip (TS); `vulture` (Python); `deadcode` or `staticcheck` (Go) |
| Measurement script | Per package: count and per-file time before and after, same machine; list failures that also fail on base | vitest JSON reporter; pytest `--junitxml`; `go test -json` |
| Re-audit pass | A second model family reviews deletions, looking for the only guard of a behavior; each restore is paid by deleting a multiple of low-value tests; mutation-check restored tests by breaking the code | Mutation tool optional (Stryker, mutmut); manual short-circuit works |
| Review agent | A pointer-style prompt, one criteria doc, `All clear` contract, include and exclude globs, comment budget, neutral conclusion | Host product differs (Macroscope here; for Wachiman, our own runner) |
| Evals | The 10-case structure: real diffs by commit plus synthetic insertions; grader by test title with slack; guards require zero comments and the exact reply; majority of 2 to 3 samples; prompt hash and word count in `summary.md` | The test-title locator is a regex over `it(`; needs a per-language version |
| Wrapper prompt and tools | Mimic the host: `read_file`, `grep`, `post_comment`, a 16-step loop | None |

**[Inferred]** Wachiman fits the review-agent and evals rows directly. The purge rows (classifier, voting, AST deleter) fit a one-off skill with scripts rather than review behavior.

## Gaps

- No published prompts, swarm driver, vote-tally script, AST deleter or measurement script from the purge; they were local.
- No precision figure for the rubric or the swarm; the only quality signal is 22 restored tests, then 29 restores and 9 over-cuts in the second sweep.
- Not stated: why 987 files got two passes, what the single-pass half did differently, how duplicate titles were handled, and how many of the 11,000 deletions came from each class.
- Macroscope's real wrapper prompt and how `requires: Check` is scheduled are not public; the eval uses a stand-in.
- No measurements of how often `test-signal` fires on real PRs or its false-positive rate in production; the eval covers 10 cases only.
- The `sol-loop` and Muse Code workflows (reviewers and implementers) are named but not in the repository.
