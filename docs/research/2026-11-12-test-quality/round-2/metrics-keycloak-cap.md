# Keycloak and Cap: testing metrics

## In one minute

Observed: Keycloak’s matching test files rise from 1,243 to 2,236 (T; snapshots below).  
Observed: Cap’s matching test files rise from 2 to 914 (T; snapshots below).  
Observed: test-touch shares are 67% for Keycloak and 84% for Cap (P; pinned samples below).  
Inferred: file growth alone establishes neither execution nor test effectiveness.  
Not found: a published coverage percentage in the inspected default-branch evidence (C).

## keycloak/keycloak

Observed file counts (T); ratio = matching test files / source files:

| Cutoff (UTC) | Pinned commit | Unit / Arquillian / framework / JS-UI | Source | Ratio |
|---|---|---:|---:|---:|
| 2024-11-15 | [snapshot](https://github.com/keycloak/keycloak/commit/799ee85b7f55b52048c9ec567e4f7e612b59efbe) | 359 / 805 / 3 / 76 | 5,172 | 0.2403 |
| 2025-11-15 | [snapshot](https://github.com/keycloak/keycloak/commit/6260622f2e7dc7e0a9b7964075e58b663f9227b4) | 426 / 772 / 211 / 94 | 5,760 | 0.2609 |
| 2026-11-15 | [snapshot](https://github.com/keycloak/keycloak/commit/a29205c778402c02bad1d90b00c390f923d059ac) | 675 / 533 / 900 / 128 | 6,672 | 0.3351 |

Observed latest merged-PR sample (P), pinned at [commit](https://github.com/keycloak/keycloak/commit/8d59d2e77f0c9822138a288d53649e374ea774de):

| Metric | Result |
|---|---:|
| PRs touching tests | 67/100 (67%) |
| PRs adding a test file | 24/100 (24%) |
| PRs deleting a test file | 0/100 (0%) |
| Median test / non-test lines added, PRs touching both | 109 / 22; n=63 |
| Bot-authored PRs | 0/100 (0%) |

Observed largest net test-line deletions **among searched candidates**, descending (D; removed / net removed):

- [Remove tests module dependency on arquillian](https://github.com/keycloak/keycloak/pull/52334): **538 / 234**, [commit](https://github.com/keycloak/keycloak/commit/2041c326cf4a8f9fafc843a2ebf1b2f0f1e86aee). Not found: Description only links an issue; rationale not found.
- [[OID4VCI]: Remove legacy PreAuthorizedGrantTest](https://github.com/keycloak/keycloak/pull/49492): **215 / 215**, [commit](https://github.com/keycloak/keycloak/commit/242b96cdc45e3673d09ce9d27ccd7ec827a07c05). Observed description: Legacy scenarios already exist in the newer suite.
- [Remove CVE-2026-45292 baggage size-limit workaround](https://github.com/keycloak/keycloak/pull/53078): **213 / 213**, [commit](https://github.com/keycloak/keycloak/commit/773d9a163132e2b6e2f5afec77b7976594596311). Not found: Description only links an issue; rationale not found.
- [refactor: converts all existing queryability over to scim](https://github.com/keycloak/keycloak/pull/51758): **319 / 158**, [commit](https://github.com/keycloak/keycloak/commit/daada5dda1009399d297e4c7ee3dcfaf42b642ad). Observed description: Replace in-memory queryability with SCIM.
- [refactor: remove clientdefaultservice / move logic to the type provider](https://github.com/keycloak/keycloak/pull/52304): **273 / 149**, [commit](https://github.com/keycloak/keycloak/commit/8ccf3887c7717734dc35be74292258171532cb7c). Observed description: Remove DefaultClientService and move logic into the type provider.

Coverage (C; [commit](https://github.com/keycloak/keycloak/commit/a29205c778402c02bad1d90b00c390f923d059ac)): **not found**—no coverage figure/date, Codecov/Coveralls configuration or badge, or coverage workflow matched the inspected files. This is a scoped absence, not proof that coverage is never collected.

## CapSoftware/Cap

Observed file counts (T); ratio = matching test files / source files:

| Cutoff (UTC) | Pinned commit | Rust integration / TS-JS / E2E-other | Source | Ratio |
|---|---|---:|---:|---:|
| 2024-11-15 | [snapshot](https://github.com/CapSoftware/Cap/commit/8649b7b495a04dedacf5944a056a952616332b9f) | 0 / 2 / 0 | 354 | 0.0056 |
| 2025-11-15 | [snapshot](https://github.com/CapSoftware/Cap/commit/dd4ab52861fc03ae0eb1da3c330ee9a34df1f493) | 1 / 1 / 0 | 1,017 | 0.0020 |
| 2026-11-15 | [snapshot](https://github.com/CapSoftware/Cap/commit/e5fb5482796711ce3f7af06a3de9b42d8aa66d0c) | 61 / 852 / 1 | 2,853 | 0.3204 |

Observed latest merged-PR sample (P), pinned at [commit](https://github.com/CapSoftware/Cap/commit/69a52beb1e205ed89e431027b707d8cb8b5553ec):

| Metric | Result |
|---|---:|
| PRs touching tests | 84/100 (84%) |
| PRs adding a test file | 49/100 (49%) |
| PRs deleting a test file | 0/100 (0%) |
| Median test / non-test lines added, PRs touching both | 237 / 103.5; n=80 |
| Bot-authored PRs | 0/100 (0%) |

Observed: only 1/100 explicitly discloses agent generation: [PR 4273](https://github.com/CapSoftware/Cap/pull/4273), “Generated with Claude Code” (P; [commit](https://github.com/CapSoftware/Cap/commit/e5fb5482796711ce3f7af06a3de9b42d8aa66d0c)). Other agent-name mentions concern product integrations; they do not establish authorship.

Rust inline tests: **not measured completely** (R). Lazy blob retrieval was interrupted after stalling; the bulk retry failed with “did not send all necessary objects”. Partial matches are excluded from totals and ratios.

Observed largest net test-line deletions **among searched candidates**, descending (D; removed / net removed):

- [Revert recording repair (#3700)](https://github.com/CapSoftware/Cap/pull/3760): **354 / 354**, [commit](https://github.com/CapSoftware/Cap/commit/6fbbaa577dd892f3181c5429797b9f05231e3c07). Observed description: Revert repair because its dependency crashes production workflow bundles.
- [feat(web): open Cap Infra to every account](https://github.com/CapSoftware/Cap/pull/4164): **92 / 38**, [commit](https://github.com/CapSoftware/Cap/commit/18d84dbd1e7469052f7053aabc1c9d4dd11d6c3d). Observed description: Open Cap Infra access to every account.
- [fix(web): send Cap Infra playlists uncompressed](https://github.com/CapSoftware/Cap/pull/4099): **38 / 28**, [commit](https://github.com/CapSoftware/Cap/commit/3d5509809b61754643a868973a6ef5e086799b65). Observed description: Undo gzip that made production playlists unreadable.
- [fix(recording): record the whole window in macOS Focus mode](https://github.com/CapSoftware/Cap/pull/4254): **11 / 8**, [commit](https://github.com/CapSoftware/Cap/commit/f2f338b90fd4ec0194d027c45ca2a283721a150c). Observed description: Preserve full window edges in Focus recordings.
- [fix(desktop): isolate blocking folder reveal from Tokio](https://github.com/CapSoftware/Cap/pull/2399): **1 / 1**, [commit](https://github.com/CapSoftware/Cap/commit/af71b47f1927a33a65ed5b8574db6a433a23199d). Observed description: Move blocking folder reveal off Tokio workers.

Coverage (C; [commit](https://github.com/CapSoftware/Cap/commit/e5fb5482796711ce3f7af06a3de9b42d8aa66d0c)): **not found**—no coverage figure/date, Codecov/Coveralls configuration or badge, or coverage workflow matched the inspected files. This is a scoped absence, not proof that coverage is never collected.

## Method and limits

All measurements observed on 2026-11-16; no builds or repository scripts executed. Default branch is `main` in both (`gh repo view OWNER/REPO --json defaultBranchRef`). Clones: `git clone --filter=blob:none --no-checkout URL DIR`, inside `mktemp -d /tmp/testmetrics-XXXX` only.

**T:** `git rev-list -1 --first-parent --before=DATET23:59:59Z origin/main`; then `git ls-tree -r --name-only SHA`. Counts apply these ordered, mutually exclusive patterns at every snapshot:

- Keycloak: Arquillian = prefix `testsuite/integration-arquillian/`, contains `/src/test/`, suffix `.java`; framework = prefix `tests/` with those same containment/suffix rules; JS/UI = prefix `js/` and regex `\.(spec|test)\.[cm]?[jt]sx?$`; unit = regex `/src/test/java/.*Test\.java$`.
- Cap: Rust integration = `.rs` under any `tests/` directory; TS/JS = regex `\.(test|spec)\.[cm]?[jt]sx?$`; E2E/other = JS/TS under `e2e/`, `playwright/` or `tests/`, excluding preceding matches.
- Source suffix regex: Keycloak `\.(java|[cm]?[jt]sx?)$`; Cap `\.(rs|[cm]?[jt]sx?)$`. Exclude matched tests, `/src/test/`, and directory segments `test|tests|__tests__|testsuite|e2e|playwright`. Inline Rust test-bearing production files remain source. Fixtures/helpers matching layer rules count as test files.

**P:** `gh pr list -R REPO --state merged --base main --limit 100 --json number,author,mergedAt,files,title,body,mergeCommit`; enrich with `gh api repos/REPO/pulls/N/files?per_page=100 --paginate --slurp`. Sum `additions` by classifier; non-test means every other changed file, including docs. New/deleted files use status `added`/`removed`; renames excluded. Bots: `is_bot`, `[bot]`, or `dependabot|renovate|github-actions`. Samples span Keycloak November 2–16 and Cap November 13–16. PR metadata is mutable; commit links pin code, not API responses.

**D:** search window starts 2024-11-16. `gh search prs --repo REPO --merged --merged-at ">=2024-11-16" --match title,body --limit 100 --json number,title,body,url "remove test"`; supplement latest sample with `gh pr list` above using `--search "merged:>=2024-11-16 remove"`; Cap also `test` and `revert`. Rank test `deletions-additions`. Search is incomplete and wording-biased; supplemental GraphQL file lists may truncate. A second `delete tests` search hit HTTP 403. Reasons paraphrase descriptions, not verified causal conclusions.

**C:** `git ls-tree -r --name-only SHA`; `git show SHA:PATH` for root README files, Codecov/Coveralls-named files and `.github/workflows/*`; case-insensitive search `coverage|codecov|coveralls|jacoco`. No dashboard figure located.

**R:** `git grep -l -F "#[cfg(test)]" SHA -- "*.rs"` at Cap’s latest snapshot only; failed fetch prevents a complete count. Ratios omit this overlapping category.
