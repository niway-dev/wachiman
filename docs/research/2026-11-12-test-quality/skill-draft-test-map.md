# Draft skill: test-map

- **Date:** 2026-11-12
- **Status:** draft, not installed. Where it would live (cs-tack `skills/`, or the Wachiman repo) is an open decision.
- **Related:** [synthesis](synthesis.md), [index](README.md)

Everything below the line is the proposed `SKILL.md`. Numeric caps in Phase 4 are chosen defaults, not measured values; the evidence supports the direction (merge and move before delete, evidence in risk areas), not the numbers.

---

## Proposed frontmatter

```yaml
---
name: test-map
description: Use when the user or another agent says "map the tests", "clean up tests", "too many tests", "why is CI slow from tests", or asks which tests in a repository are worth trimming, merging or moving to a cheaper layer. Produces a map of the suite and a capped, evidence-backed candidate list. Does not edit tests. Judging single tests is cs-audit-tests.
---
```

## Proposed body

# Map the tests and propose a cleanup

## Relationship to cs-audit-tests

`test-map` answers "where is the weight, and which tests should we look at first". It is static, cheap, and
read-only: it outputs an inventory and a candidate list. `cs-audit-tests` answers "is this test worth
keeping": it reads every test in a slice, marks R/F/C/D, hunts gaps and edits. Run `test-map` first; hand
its candidate list to `cs-audit-tests` Step 1 as the slice to ledger. `test-map` never judges a test beyond
its signals and never edits.

## Relationship to Wachiman

Wachiman reviews a diff; `test-map` scans a whole repo. They share one signal list (Phase 2) and one
keep-guard list (Phase 3), taken from the same research. Wachiman applies the diff-only subset: tests the
PR adds or grows (mirror, wait, merge into a table, lower layer), and removed tests that match a
keep-guard shape (ask for the named evidence). It never executes tests and never edits. Where Wachiman
asks for a regression test on a bug fix, `test-map` does not: it never adds tests. If the lists drift,
the Wachiman prompt and this skill should be regenerated from one file.

## Why

Over-testing is accumulation (a new `it` per fix, the same case at several layers), not a few bad tests.
But cutting is as risky as adding: a mass purge had to restore tests that were the sole guard of live
behavior. So the map finds weight with cheap signals, the keep-guards protect what must stay, and the
proposal is small, ranked and evidenced.

## Phase 1: Inventory (static, no test execution)

Work from `git ls-files`. Treat layer-by-name as a claim, not a fact: confirm by imports.

| Language | Test files | Layer signals |
| --- | --- | --- |
| TS/JS (vitest, jest, playwright) | `\.(test\|spec)\.[cm]?[jt]sx?$` | e2e: `@playwright/test`, `cypress`, dir `e2e/`; browser/component: `\.browser\.test\.`, `vitest/browser`, `@testing-library`; integration: `\.integration\.`, `supertest`, `testcontainers`; else unit |
| Python (pytest) | `(^\|/)(tests?/\|test_.*\.py$\|.*_test\.py$)` | e2e: `playwright`, `selenium`; integration: `pytest.mark.integration`, `APITestCase`, `django.test`, db fixtures; else unit |
| Go | `_test\.go$` | integration: `func TestIntegration`, `//go:build integration`, `testcontainers`; e2e: dir `e2e/`; else unit |
| Ruby (rspec) | `_spec\.rb$` | e2e: `spec/system`; integration: `spec/requests`, `spec/features`, `spec/controllers`; unit: `spec/models`, `spec/lib` |
| Java (JUnit) | `src/test/java` | integration: `*IT`, `*IntegrationTest`, `@SpringBootTest`, `@Testcontainers`, `@DatabaseTest`; else unit |

```sh
# test files (adjust the regex per language above)
git ls-files | rg '\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$|_spec\.rb$|(^|/)test_.*\.py$|.*_test\.py$|src/test/java' > /tmp/tests.txt
# files whose imports contradict their name (the "integration" that mocks, the "unit" that boots a server)
rg -l 'vi\.mock|jest\.mock|@patch|mockito' $(rg '(integration|e2e)' /tmp/tests.txt)
# approximate test count per file
rg -c '^\s*(it|test)(\.each)?[(`]|^\s*def test_|^func Test|@Test\b|^\s*(it|specify) ' $(cat /tmp/tests.txt) | sort -t: -k2 -nr | head -30
# area = workspace package, else top directory
awk -F/ '{print ($1=="packages"||$1=="apps"||$1=="services") ? $1"/"$2 : $1}' /tmp/tests.txt | sort | uniq -c | sort -nr
# source lines versus test lines
git ls-files | rg -v -f <(sed 's/^/^/' /tmp/tests.txt) | rg '\.(ts|tsx|js|py|go|rb|java)$' | xargs wc -l | tail -1
xargs wc -l < /tmp/tests.txt | tail -1
```

Output table:

| Area | Layer | Files | Tests (approx) | Test LOC | Source LOC | Ratio |
| --- | --- | --- | --- | --- | --- | --- |

Counts are file and regex counts, not exact test counts. Compare ratios inside one repo only; no
threshold is supported by evidence (observed range about 0.10 to 0.84). Read the repo's declared layer
ladder first (AGENTS.md, test directories, CI jobs); say so in the report if none is written down.

## Phase 2: Static smell scan

Run each scan on test files only. Every hit is a signal, not a verdict. Record `file:line`, signal, and
the false-positive risk that applies.

| Signal | Scan | Flags | False-positive risk |
| --- | --- | --- | --- |
| Real-time waits | `rg -n 'setTimeout\(\|\bsleep\(\|time\.sleep\|time\.Sleep\|Thread\.sleep\|waitForTimeout\|Date\.now\(\)\|performance\.now\(\)\|advanceTimersByTime\|requestAnimationFrame\|\{ ?timeout:\|\bretry' <tests>` | sleeps, polling, wall-clock deltas, timers advanced to a source constant, retries, timeouts | a fake clock is right when the time rule is the behavior (DST, expiry); skip those |
| Mock-call-only | per file: `rg -c 'toHaveBeenCalled\|assert_called\|\.expects\(\|verify\(\|received\(' f` against `rg -c 'toEqual\|toBe\(\|toStrictEqual\|assert .* ==\|to eq\|assertEquals' f`; then read files where calls outnumber values | tests asserting only calls on mocks they set up | call order that is observable; a call to an external API is the contract |
| Existence or render-only | `rg -n 'toBeDefined\(\)\|toBeTruthy\(\)\|not\.toThrow\(\)\|toBeInTheDocument\(\)\|assertIsNotNone\|is not None$\|typeof .* === '` where it is the only assertion in the test | "exists", "no throw", "page loaded" | deliberate smoke tests; low risk |
| Trivial snapshot | `rg -U 'toMatchInlineSnapshot\(\s*`[^`\n]{0,60}`'`; `.snap` files with one short entry | snapshot of a primitive or short string | repos that use snapshots on purpose for appearance |
| Duplicate literals across files | titles: `rg -on '(it\|test)(\.each)?\(\s*["'"'"'`]([^"'"'"'`]+)' -r '$2' <tests> \| awk -F: '{print $3}' \| sort \| uniq -c \| sort -nr \| awk '$1>1'`; strings: `rg -ohN '"[A-Za-z][^"]{12,}"' <tests> \| sort \| uniq -c \| sort -nr \| head -30` | the same expected string or case in 3+ files (copy text, wrapper-plus-service twins, web-and-mobile twins) | parallel cases that are deliberately separate |
| Test-only exports | `knip` if configured (`npx knip --include exports,files`). Fallback: list symbols imported by tests, keep those with no reference outside tests: `rg -oNI --glob '*{test,spec}*' 'import \{([^}]+)\}' -r '$1' \| tr ',' '\n' \| sed 's/ as .*//;s/ //g' \| sort -u \| while read s; do [ -n "$s" ] && ! rg -qw "$s" --glob '!*{test,spec}*' --glob '!**/tests/**' <src roots> && echo "$s"; done` | symbols and `_forTests` seams only tests use | published library API; dynamic imports; name collisions in the fallback |
| Skip or only without reason | `rg -n '\.(skip\|only)\(\|\bxit\(\|\bxdescribe\(\|fixme\|pytest\.mark\.skip\|t\.Skip\(\|@Disabled\|@Ignore' <tests>`; a hit is "without reason" when neither the line nor the line above has `#[0-9]+\|issues/\|quarantine\|https?://`. A committed `.only` is always a finding | silent skips and focused tests | low |
| Asserts what types enforce | `rg -n 'typeof .* === .(boolean\|string\|number)\|toBeInstanceOf\|isinstance\(' <tests>`; decode-a-literal-then-read-it-back needs a read | return-type checks; schema decode round-trips | the schema is the boundary being tested (parsing external formats) |
| Wrong layer | `rg -L 'render\(\|page\.\|mount\(' $(rg '\.browser\.test\.\|/e2e/' /tmp/tests.txt)` | browser or e2e files that never render | helper-wrapped render; read before flagging |
| Table rows adding no branch | files with `it.each`, `parametrize`, `t.Run` tables: count rows; flag tables with 3+ rows sharing one expected literal, or a new `it` beside a table over the same function | rows in the same equivalence class | a row may encode a past bug; never propose removal unless every source branch keeps at least one row (name the branch list) |

## Phase 3: Keep-guards (never auto-propose deletion)

For every Phase 2 hit, run the guards. Any guard hit moves the candidate to "guarded": merge or move may
be proposed with evidence; deletion needs the named evidence in Phase 4.

| Guard | Cheap detection |
| --- | --- |
| Sole guard of live behavior | the module has callers outside tests (`rg -w <symbol>` excluding tests) and only one test file imports it (`rg -l "from '.*<module>'" <tests>`). No other test asserting it = sole guard |
| Invariant types cannot express; security, auth, permissions, redaction | path, test title or imports match `auth\|permission\|grant\|scope\|token\|secret\|redact\|csrf\|session\|password\|oauth\|crypto\|sanitiz\|escap`. Keywords miss (a purge cut 22 auth tests labelled "timing"): read the assertion, not only the name |
| Boundary cases | `timezone\|TZ=\|DST\|America/\|Asia/\|Europe/\|leap\|locale\|revok\|expir\|coalesc\|dispos\|cancel\|MAX_\|limit\|boundary\|[0-9]+ ?(MB\|KB\|bytes)`; fake-clock use (`useFakeTimers\|TestClock\|freeze_time\|Timecop\|setSystemTime`) means time is the behavior |
| Regression test citing a failure | in titles, comments or the three lines above: `#[0-9]{2,}\|issues/[0-9]+\|pull/[0-9]+\|\b[A-Z]{2,}-[0-9]+\b\|regression\|fixes`; and `git log -S'<test name>' --oneline -- <file>` for a fix commit or PR number |
| Data-repair migration | path `migrat\|alembic\|db/migrate\|flyway\|liquibase` and the test asserts rows after the migration. Schema-only checks (`PRAGMA table_info`, "column exists") are not guarded |

## Phase 4: Proposal

Build one candidate per test (or per file, when every test in it shares the signal).

| Action | When |
| --- | --- |
| delete | mirror, type restatement, constant or copy restated, test-only export (delete the export too), unreachable code |
| merge into existing case | new `it` beside a table or `it.each` that covers the branch; name the table `file:line` |
| move down a layer | browser or e2e test whose assertions pass without rendering; branch matrix in e2e |
| move to e2e | many mocks restating a flow across auth, redirect or persistence, and an e2e tier exists |
| replace wait with fake clock | sleep, polling, timer advanced to a source constant |
| replace mock with fake | hand-set return values on a mocked repository or client, then asserted |

Rules:

1. Per candidate: action, evidence (signal plus `file:line`), guards checked and result, confidence, and
   the fix in one sentence.
2. Confidence: **high** = two independent signals and no guard hit; **medium** = one signal confirmed by
   reading the assertions; **low** = one regex hit. Propose only high and medium; list low as "looked at,
   not proposed".
3. Cap: at most 20 candidates per batch, one package per batch. Prefer merge, move and fake over delete.
4. A deletion in a guard area needs named evidence: the stronger twin by path and line (and what it
   asserts; reject a weaker twin), the caller search for dead code (and the release range for a protocol),
   or the remaining table row per source branch. A UTC-only test does not replace a DST one.
5. A cost motive (slow tests) leads to a move or a fake, not a delete.

Report format (markdown):

```
## Summary
| Layer | Files | Tests | Candidates | Guarded |
## Candidates by action
| Action | Count | Confidence mix |
## Candidates
1. <action> <file:line> (<confidence>)
   Evidence: <signal, hit>
   Guards: <checked, result>
   Fix: <one sentence>
## Looked at, not proposed
## Not scanned (and why)
```

## Verification rules

Applies to whoever applies the batch (a human, or `cs-audit-tests` Step 3).

1. Run the suite before and after each batch. Record test count and wall time per package; the report
   states both. Baseline failures are recorded, not fixed.
2. A deletion batch never mixes with production changes. Removing a test-only export is the one exception,
   shipped as a separate commit.
3. A second reviewer pass on every deletion, from fresh context, with the candidate list and diff only. The
   over-cut lesson: the first pass of a purge missed 9 tests that cited past issues.
4. Re-run dead-code searches at merge time; the proof goes stale when `main` moves.
5. For a kept guarded test with no proof it can fail, suggest a mutation check (break the guard, see it
   fail). Do not run it as part of the map.

## What it never does

- Delete or edit a test without a report that lists its evidence.
- Touch a test in a keep-guard area without named evidence.
- Raise coverage targets or use coverage as evidence of value (a covered line is not an asserted invariant).
- Add tests. A suspected gap goes to the report as a pointer to `cs-audit-tests` Step 2.
- Treat a keyword or a regex hit as a verdict.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Trusting the layer from the file name | Confirm from imports; report mismatches |
| Reporting hit counts as the result | The result is the capped candidate list and the guarded list |
| Proposing delete for a slow test | Propose a move or a fake |
| Skipping the keep-guards on "obvious" mirrors | Run them; a mirror in `auth/` still needs a named twin |

---

## Appendix: notes for the decision (not part of the skill)

- **Reuse from `cs-audit-tests`:** the junk patterns and retention bar are the same ideas; `test-map`
  only detects them statically. Keep one source of truth: if the signal list changes, change both, or have
  `cs-audit-tests` point at this list.
- **Word count** of the skill body was not measured; the tables are dense, so check with `wc -w` before installing.
- **Untested:** the rg patterns were written from the evidence docs and not run against a real repo.
