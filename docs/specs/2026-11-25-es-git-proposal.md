# Proposal: read diffs and blobs through es-git

**Status: proposal, not approved.** Nothing is implemented. This file lives in a draft pull request
that is not to be merged; it is the place to discuss the idea. Tracker: [evaluate es-git for reading diffs and blobs](https://linear.app/niway/issue/NIW2-920).

## In one minute

The engine reads every change by starting `git` as a separate process: three `git diff` runs and one
`git cat-file --batch`. [es-git](https://github.com/toss/es-git) (Rust bindings of libgit2 for Node
and Bun) could read the same data inside the engine's own process. Before deciding, every benchmark
must be documented, and a cheaper change (one `git diff` run instead of three) must be measured in
the engine first.

| Decision | Why | ADR |
| --- | --- | --- |
| Do not start until the benchmarks are documented | A change to how the engine reads git can only be judged against a documented baseline | None |
| Try one `git diff` run before any native package | It halved the diff time on 57 real PRs, with byte-identical patches, and adds no dependency | None |
| Evaluate es-git only if reading still matters after that | A native package per platform is a real cost; it must buy a measured gain | None |

Open questions:

- Package size per platform, and whether prebuilt binaries exist for every platform Wachiman
  supports (macOS, Linux, Windows; x64 and arm64).
- Whether its diff output matches `git diff` byte for byte with the options the engine pins
  (rename detection, inter-hunk context of 1, three lines of context, no textconv, no external diff).
- Who maintains it and how often it is released.

Out of scope: replacing `git` for writes, for the call-site search (ripgrep does that), or for
anything outside reading a change.

## What the numbers say today

From the wachiman-multilingual baseline in the benchmarks repository (one Apple M5 laptop, 57 real
pull requests, median of 5 runs, no model and no search):

- Reading from git is 72% of the engine's read-and-classify time: the three `git diff` runs are
  47%, the `git cat-file --batch` read of the changed files is 25%.
- A typical PR reads in 50 to 100 ms; the largest (1,010 and 2,172 changed files) in about 1 s.
- One `git diff` run with `--raw --numstat -z` plus the patch options, instead of three runs: 3,549 ms
  to 1,747 ms over the 57 PRs (−51%), −64% on a small PR, −18% on the 1,010-file PR. The patch part
  was byte-identical in all 57.

Not measured yet: `snapshotHead`, the export of the whole head tree that a real review does. It is
the main suspect for most of the time a giant review spends outside the search, and it may matter
more than the diff.

## Before starting

1. Every benchmark is documented: the CLI benchmark, the pipeline benchmark, and the
   wachiman-multilingual baseline.
2. `snapshotHead` is measured.
3. The one-diff change is in the engine and measured against the baseline.

## How es-git would be judged

- Same corpus, same machine, same medians as the baseline; also on a CI runner.
- Its output compared byte for byte with the pinned `git diff` on all 57 PRs.
- Install size and install time added to `npm i -g wachiman`, per platform.
- It is adopted only if the gain over the one-diff engine is clear on both small and giant PRs.
