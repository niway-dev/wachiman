# Test activity: Cal.com and Discourse
## In one minute
Observed: Cal.com’s matched test-file count rises, then falls (T, table below).  
Observed: Discourse’s matched test-file count rises at both intervals (T).  
Observed: recent PR test-touch rates favor Discourse (P).  
Inferred: feature removal explains part of Cal.com’s decline; counts do not establish test quality.  
Not found: a published coverage percentage in the inspected repository files.

## Cal.com → cal.diy
Observed, T: file counts; ratio = matched test files / source files.
| Date (UTC) | Commit | unit | integration | Playwright | API | Total tests | Source | Ratio |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2024-11-15 | [tree](https://github.com/calcom/cal.diy/tree/1c05952077e645231095825ce1d63947856e3103) | 187 | 7 | 71 | 37 | 302 | 4248 | 0.071 |
| 2025-11-15 | [tree](https://github.com/calcom/cal.diy/tree/1012f2f153605c36b5f72d4fabe4bc435f6390a1) | 421 | 24 | 92 | 79 | 616 | 5737 | 0.107 |
| 2026-11-15 | [tree](https://github.com/calcom/cal.diy/tree/ae027bb70e694e2d2c44569f398d6cbcee0389b1) | 418 | 15 | 66 | 42 | 541 | 4454 | 0.121 |

Observed: [team/org test cleanup](https://github.com/calcom/cal.diy/pull/28953), merged April 22, 2026, falls between the latter snapshots (`gh pr view 28953 -R calcom/cal.diy --json body,mergedAt,mergeCommit`; [pinned merge](https://github.com/calcom/cal.diy/commit/04fcd9f3abfd0d96e16fa8eb6c41a7841d551795)). Its description says the routes were already removed; this PR is test cleanup, not evidence of the feature-removal date.

Observed, P + F, [latest sampled merge](https://github.com/calcom/cal.diy/commit/ae027bb70e694e2d2c44569f398d6cbcee0389b1):

| Latest merged PRs | Touch tests | Add test file | Delete test file | Bots | Both kinds | Median test/non-test additions (both) |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 40% | 10% | 10% | 0% | 30 | 31 / 16 |

Observed: largest net test-line deletions found by S + F (incomplete search). Removed / net removed:

- [cleanup(test): remove org booking integration coverage](https://github.com/calcom/cal.diy/pull/29019): **1841 / 1841**, `F(29019)`, [merge](https://github.com/calcom/cal.diy/commit/c2c95b371a691a5db042db7705f7708dbe62ce96). Description removes organization booking/audit and watchlist coverage.
- [test: cleanup old skipped e2e tests](https://github.com/calcom/cal.diy/pull/26597): **817 / 816**, `F(26597)`, [merge](https://github.com/calcom/cal.diy/commit/3cb59b787414338e730a1c9b864fe9e9d5fd42a2). Description’s automated summary removes outdated/flaky and skipped suites.
- [cleanup(test): remove round robin lucky user integration coverage](https://github.com/calcom/cal.diy/pull/29020): **792 / 792**, `F(29020)`, [merge](https://github.com/calcom/cal.diy/commit/6a2b84ab02d8a5155744752e0445fd400da19402). Description removes obsolete round-robin host-selection coverage.
- [cleanup(test): remove signup membership integration coverage](https://github.com/calcom/cal.diy/pull/29014): **472 / 472**, `F(29014)`, [merge](https://github.com/calcom/cal.diy/commit/03fc126d796bd3d42a433a21bf2f3316081518a8). Description removes obsolete team/organization signup-membership coverage.
- [chore: remove Mintlify AI chat from CMD+K widget](https://github.com/calcom/cal.diy/pull/26485): **470 / 470**, `F(26485)`, [merge](https://github.com/calcom/cal.diy/commit/5794584624fda5f5c85f9681e8bcab9a53decc98). Description removes the Mintlify AI chat feature.

Coverage — **not found**: public percentage, Codecov/Coveralls badge or target, or coverage collection in inspected test workflows (C; [snapshot](https://github.com/calcom/cal.diy/commit/ae027bb70e694e2d2c44569f398d6cbcee0389b1)).

## Discourse
Observed, T: file counts; ratio = matched test files / source files.
| Date (UTC) | Commit | requests | models | system | lib | other Ruby | frontend | Total tests | Source | Ratio |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2024-11-15 | [tree](https://github.com/discourse/discourse/tree/876591fdabbf085c5f7937a419f6aa08a2eeb893) | 127 | 165 | 126 | 368 | 364 | 535 | 1685 | 6354 | 0.265 |
| 2025-11-15 | [tree](https://github.com/discourse/discourse/tree/5d9889bcce0c1da0d5ecc8ade1ef0dc1a9dde55d) | 143 | 176 | 185 | 412 | 407 | 594 | 1917 | 10410 | 0.184 |
| 2026-11-15 | [tree](https://github.com/discourse/discourse/tree/e9ce3bb0348af7746afa7c9b9d2afbde6462933c) | 193 | 220 | 301 | 684 | 643 | 984 | 3025 | 13154 | 0.230 |

Observed, P + F, [latest sampled merge](https://github.com/discourse/discourse/commit/9517af5f5c0a9560bec1eee46d7eb175c4f81e0b):

| Latest merged PRs | Touch tests | Add test file | Delete test file | Bots | Both kinds | Median test/non-test additions (both) |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 65% | 9% | 0% | 2% | 58 | 78.5 / 18.5 |

Observed: largest net test-line deletions found by S + F (incomplete search). Removed / net removed:

- [DEV: post type dropdown cleanup](https://github.com/discourse/discourse/pull/42589): **1417 / 901**, `F(42589)`, [merge](https://github.com/discourse/discourse/commit/f6cd2193e614be6a07a2261fe97c4dc42edd1fb4). Description cleans unused code while modernizing the composer dropdown.
- [DEV: Remove dual mode support for palettes and drop theme-owned palettes](https://github.com/discourse/discourse/pull/34467): **498 / 493**, `F(34467)`, [merge](https://github.com/discourse/discourse/commit/7ee52c8f859eadbe7c1526c936bd480ebda61c71). Description abandons unreleased dual-mode and theme-owned palettes.
- [DEV: Drop legacy topic-list and raw-handlebars compilation system](https://github.com/discourse/discourse/pull/32081): **448 / 417**, `F(32081)`, [merge](https://github.com/discourse/discourse/commit/f0057c7353b8c81e5c315f51d1be06c8e22e4731). Not found: description is empty; inferred from title: legacy template-system removal.
- [DEV: Drop support for template overrides and mobile-specific templates](https://github.com/discourse/discourse/pull/33101): **412 / 408**, `F(33101)`, [merge](https://github.com/discourse/discourse/commit/cb6cc8dcd339b5036fecfd8ae0301accc7df4ee1). Not found: description only links an external topic; inferred from title: template-override removal.
- [DEV: Drop `discourse.legacy-array-like-object.proxied-array`](https://github.com/discourse/discourse/pull/45517): **501 / 405**, `F(45517)`, [merge](https://github.com/discourse/discourse/commit/037eaa72a3fb96b323e6d71ad4fd8e8d8b414f34). Description removes a deprecated array proxy after telemetry showed no ecosystem use.

Coverage — **not found**: published percentage/badge/target or collection in inspected CI. **Observed:** optional `COVERAGE`-enabled SimpleCov in `spec/rails_helper.rb` (C; [source](https://github.com/discourse/discourse/blob/9517af5f5c0a9560bec1eee46d7eb175c4f81e0b/spec/rails_helper.rb)).

## Method and limits

All measurements are **observed**, unless explicitly labeled inferred/not found. Read-only collection on November 16, 2026; no code executed from clones. Commands below use `R` for the repository above, `D` for its clone, and `SHA` for the linked commit. Counts are files, not cases or assertions.

- Clone: `git clone --filter=blob:none --no-checkout https://github.com/$R.git $D`, beneath `mktemp -d /tmp/testmetrics-XXXX`.
- T: `git -C "$D" rev-list -1 --first-parent --before="${DATE}T23:59:59Z" origin/main`; `git -C "$D" ls-tree -r --name-only "$SHA"`. Count paths with the following Python regexes, unchanged across dates.
- Cal tests: `\.test\.tsx?$`, `\.integration-test\.tsx?$`, `\.e2e\.tsx?$`, `\.e2e-spec\.tsx?$`. Discourse: `^spec/.*_spec\.rb$`, split by `spec/{requests,models,system,lib}/`, remainder “other Ruby”; frontend `^(?:app/assets/javascripts|frontend)/.*/tests/.*-test\.(?:js|gjs)$`. Plugin-local tests outside these roots are excluded.
- Source: suffix `\.(ts|tsx|js|jsx)$` (Cal) or `\.(rb|js|gjs)$` (Discourse), excluding matched tests and directory components `test|tests|spec|__tests__|fixture|fixtures|vendor|node_modules`. “Source” includes configuration/support code matching this proxy.
- P: initial `gh pr list -R "$R" --base main --state merged --limit 100 --json number,author,mergedAt,files`. To correct creation-time ordering, rerun with `--limit 1000 --search 'merged:>=2026-04-01'` (Cal) or `'merged:>=2026-11-12'` (Discourse); sort `mergedAt` descending and retain the latest hundred.
- F(n): `gh api repos/$R/pulls/$n`; `gh api --paginate --slurp 'repos/'"$R"'/pulls/'"$n"'/files?per_page=100'`. Sum `additions`/`deletions` for matched paths; net deletion = deletions minus additions. File additions/deletions use statuses `added`/`removed`; renames do not qualify. Medians include zero additions and use all changed non-test files, not only source. No returned file list was truncated. Bot rule: API bot flag, `[bot]`, or known `dependabot`, `renovate`, `discourse-translator-bot`; undisclosed automation may escape detection.
- S: `gh search prs "$TERM" -R "$R" --merged --base main --merged-at 2024-11-16..2026-11-16 --match title --limit 100 --json number,title`, separately for `remove`, `delete`, `cleanup`, `drop`; union with recent PR samples and the cited Cal cleanup. Rank measured net deletions. This is **not** a guaranteed repository-wide top five; keyword/result caps miss candidates. Reasons paraphrase descriptions; missing descriptions are labeled.
- C: `git -C "$D" ls-tree -r --name-only "$SHA"` for coverage/config paths; `git -C "$D" show "$SHA:$PATH"` for README, Cal unit/API-unit workflows, Discourse test workflow, Gemfile and spec helpers. No dashboard percentage was located; this limited inspection cannot prove coverage is absent elsewhere. Ratios measure repository composition, not execution frequency, assertion strength or coverage.
