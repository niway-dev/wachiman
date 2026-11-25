# Engine hot paths, 2026-11-21

What the [baseline](2026-11-21-baseline.md) numbers are made of, which Node APIs the engine calls and
whether a Bun-native replacement would help, and the three changes the profile justified, each with
its before and after numbers.

Machine: Mac mini, Apple M4, macOS, Bun 1.3.4 (the pinned consumer runtime), Node 24.21.0.
Tree before: `4e4c48f` (the baseline). Tree after: `e49d544`.

## Summary

- A local review is dominated by waiting for `git` processes: 37 `git` spawns on the benchmark
  fixture, about 8.5 ms each, about 317 ms of a 475 ms review. The spawn API is not the cost; the
  number of processes is.
- Replacing Node APIs with Bun-native ones gains nothing measurable, so none was replaced
  (inventory and microbenchmarks below).
- Three changes remove 13 of the 37 `git` processes without changing behavior:
  `local review e2e` 472 to 343 ms (-27%) and a 569-file repository 657 to 592 ms (-10%) in the
  interleaved comparison (-15% in a second, separate run; see below). CLI start-up is unchanged.

## Where the time goes

All numbers are medians on the machine above. Startup floors come from one script that runs each
command 40 times after 5 warm-ups.

| Command | Median | What it is made of |
| --- | --- | --- |
| `bun empty.ts` (prints one line) | 8.8 ms | the Bun process itself |
| `node -e 0` | 23.7 ms | the Node process itself |
| `bun src/cli.ts --version` | 36.0 ms | Bun plus the module graph: about 27 ms, because `help.ts` imports the usage strings of about 17 command modules, which loads the whole graph for every command |
| `bun bin/wachiman.js --version` | 52.4 ms | the launcher's Bun probe plus the child Bun that runs the CLI |
| `node bin/wachiman.js --version` | 68.5 ms | the same with Node hosting the launcher (the npm path) |

For the review (`wachiman local --repo-dir <fixture> --base main`, 476 ms in the interleaved run):

| Part | Measured | Share |
| --- | --- | --- |
| 41 `spawnSync` calls, 37 of them `git`, timed by a preload counter | 316.8 ms | about 67% |
| Launcher and module graph (the `--version` row above) | about 52 ms | about 11% |
| Everything else: the fake `claude` process, about 50 file-system calls, rendering | about 107 ms (the remainder, not measured separately) | about 22% |

A CPU profile of the 569-file case (Bun 1.3.14, because 1.3.4 has no `--cpu-prof`) shows 436 of 532 ms
inside `spawnSync`. Of that, `snapshotHead` accounts for 172 ms and evidence gathering for about
125 ms; the settings stage (`openLocalSession`, `withLocalSettings`) for about 60 ms before the changes below.

Why the spawn count matters, measured with `spawnbench.ts` over 200 runs per row (two rounds):

| Spawn of `git rev-parse --verify -q HEAD` | Round 1 | Round 2 |
| --- | --- | --- |
| `node:child_process` `spawnSync` | 8.25 ms | 9.58 ms |
| `Bun.spawnSync` | 8.01 ms | 9.44 ms |
| `Bun.spawnSync` with `/usr/bin/git` as an absolute path | 7.82 ms | 9.33 ms |
| `/usr/bin/true` | 0.71 ms | 0.68 ms |

`node:child_process` in Bun is a wrapper over `Bun.spawnSync`, so migrating gives 0.2 ms per spawn, which
is inside the drift between rounds. The cost is `git`'s own start-up. Measured earlier on this machine,
`/usr/bin/git` is the `xcode-select` shim (about 9.5 ms) and the Command Line Tools `git` it forwards to
takes about 3.4 ms. Calling the real binary directly would change which `git` runs, so it is recorded
here and not applied.

## Inventory of Node APIs in `src/`

Counts are source lines that mention the name in `src/**/*.ts`, tests excluded, so they include import
lines. "Per review" is the number of calls in one `wachiman local` run on the benchmark fixture,
counted by a shim that replaced the `node:fs` import (file-system calls) or by a preload counter
(spawns). "Bun equivalent" lists what exists in Bun 1.3.4. In the Verdict column, timings read "Node vs Bun", Node
first, and the Bun forms of file reads, writes and `exists` are async, so adopting them would add an
`await` to synchronous code.

| Node API | Lines / files | Per review (fixture) | Bun equivalent | Verdict |
| --- | --- | --- | --- | --- |
| `spawnSync` (`node:child_process`) | 51 / 20 | 41 before, 28 after (`git`: 37 before, 24 after) | `Bun.spawnSync` | no gain: 8.25 vs 8.01 ms per spawn (Node vs Bun); the lever is the count |
| `spawn` (`node:child_process`) | 9 / 7 | 1 (the `claude` process) | `Bun.spawn` | no gain: one call, dominated by the child |
| `readFileSync` | 98 / 37 | 2 | `Bun.file(p).text()` (async only) | Bun is 1.9x slower for 1 KB (10.9 vs 21.1 us); for 10 MB it is 4.6% faster (777 vs 741 us), which does not apply because review files are capped at 1 MB |
| `writeFileSync` | 43 / 14 | 5 | `Bun.write` (async) | equal: 18.2 vs 18.3 us for 1 KB |
| `existsSync` | 87 / 24 | 4 | `Bun.file(p).exists()` (async) | Bun is 1.4x slower (0.94 vs 1.28 us) |
| `statSync` | 70 / 22 | 1 | `Bun.file(p).stat()` (async) | none sync; 1 call per review |
| `lstatSync` | 35 / 12 | 7 | none | none |
| `readdirSync` | 34 / 11 | 0 | `Bun.Glob` scan | not on the review path |
| `mkdirSync` | 38 / 16 | 2 | none sync | none |
| `mkdtempSync` and `rmSync` | 28 and 40 / 11 and 14 | 4 and 6 | none | 96.6 us for one pair; ten pairs under 1 ms |
| `realpathSync` | 40 / 17 | 4 | none | none |
| `renameSync`, `appendFileSync`, `copyFileSync` | 26, 5, 2 / 13, 3, 1 | 0 | `Bun.write` for the last two | not on the review path |
| `createHash` (`node:crypto`) | 18 / 9 | not counted | `Bun.CryptoHasher` | equal: 0.87 vs 0.81 us for 1 KB |
| `randomUUID` (`node:crypto`) | 2 / 1 | not counted | `crypto.randomUUID()` (the same call) | none |
| `fetch` | 2 / 1 | 0 (network paths only) | the same global | none |
| `node:readline` | 2 / 1 | 0 | none | none |
| `node:path`, `node:os` | 51 and 16 files | not counted | none (pure string and constant lookups) | none |

The file-system calls of a whole review add up to about 50 calls at 1 to 100 us each, below 1 ms of
a 340 to 475 ms run. No replacement can be measured against that, so no Node API was migrated, and the
inventory stays here as the answer to "which calls could move".

Microbenchmarks: `fsbench.ts`, median of 5 batches of 3000 operations after 200 warm-ups (60 for the
10 MB rows, 500 for the temporary-directory row).

## Changes

Each change is its own commit. Behavior is unchanged: the checks, their order and their messages are the same, and the existing tests
pass untouched; each commit adds tests where the behavior could drift. The commit messages carry each
change's own pairwise run, which differs a little from the table below because every run is a separate
sample.

| # | Commit | What it removes | `git` spawns per review | `local review e2e` | `local review big` (569 files) |
| --- | --- | --- | --- | --- | --- |
| 0 | `4e4c48f` (baseline) | | 37 | 472.1 ms | 656.7 ms |
| 1 | `e2f1bec` resolve the head and base once in `resolveRefs` | the second `rev-parse` that re-read a revision the first had already printed | 33 | 439.3 ms (-7.0%) | 681.0 ms (+3.7%, inside the noise) |
| 2 | `1c51d31` resolve the refs once per local review and ask | the input stage resolving again the refs the settings stage had resolved (base, head, merge-base) | 28 | 383.2 ms (-18.8%) | 633.2 ms (-3.6%) |
| 3 | `e49d544` list the start commit's instruction and settings files with one `ls-tree` | one `ls-tree` per instruction or settings path at the start commit (five processes when none exists) | 24 | 342.6 ms (-27.4%) | 591.6 ms (-9.9%) |

Medians of 30 interleaved rounds (each round runs every tree once, in rotating order, so time drift
cancels). An unchanged control copy of the base measured within +-1% of itself in the same harness.
The big case spreads more (p90 about 740 ms on base), which is why change 1 can read as +3.7% there
although its minimum improved (637.0 to 605.6 ms); it is kept because it removes 4 processes
deterministically and the e2e case moves by more than the noise. The git spawn counts are exact, not
sampled.

### Official bench, base against head

`bun run bench --runs 15`, run twice each, alternating base and head, from fresh clones on the same
machine:

| Case | Base, run 1 / run 2 | Head, run 1 / run 2 |
| --- | --- | --- |
| launcher `--version` (under bun) | 53.1 / 57.1 ms | 53.1 / 52.6 ms |
| launcher `--version` (under node) | 63.1 / 70.3 ms | 68.9 / 63.6 ms |
| launcher `--help` (under bun) | 52.3 / 57.4 ms | 57.6 / 53.0 ms |
| launcher `local --help` (under bun) | 52.6 / 57.5 ms | 57.3 / 52.6 ms |
| tests: engine fakes | 393.7 / 386.8 ms | 395.3 / 398.8 ms |
| local review (fake claude, e2e) | 434.4 / 482.7 ms | 306.8 / 316.4 ms |

The first five rows differ between the two runs of the same tree by up to 7.2 ms (base, `--version`
under Node: 63.1 vs 70.3 ms), in either direction, and no base-versus-head difference in them is larger
than that, so they are unchanged. In the review row every head run (306.8 and 316.4 ms) is faster than
every base run (434.4 and 482.7 ms), by 118.0 to 175.9 ms depending on which two runs are paired.
The interleaved comparison on the same clones (30 rounds) agrees: `--version` under Bun 54.3 vs 54.3 ms
(0.0%), under Node 70.3 vs 69.3 ms (-1.4%), `local --help` 53.7 vs 53.2 ms (-0.9%), review e2e 476.4 vs
344.5 ms (-27.7%), 569-file review 693.0 vs 589.4 ms (-14.9%). This is a separate run from the four-tree
comparison above (base 656.7 ms for the 569-file case there, 693.0 ms here): that case spreads widely
(p90 about 740 ms on base in both), so read its effect as a range of about -10% to -15%, not one
figure.

### Measured again after merging main (2026-11-25)

Main moved on (the review settings read at the merge-base, one ripgrep call per evidence batch, the
formatting commit). The three changes were re-applied on top of it and the bench run again on the Mac
mini, `bun scripts/bench.ts --runs=5` (the bench script is part of this branch, so the base tree ran
it copied in), two rounds alternating base (`c6edcdd`, main) and head, from fresh clones:

| Case | Base, run 1 / run 2 | Head, run 1 / run 2 |
| --- | --- | --- |
| launcher `--version` (under bun) | 58.8 / 57.9 ms | 58.5 / 59.7 ms |
| tests: engine fakes | 401.3 / 412.3 ms | 399.0 / 412.1 ms |
| local review (fake claude, e2e) | 490.0 / 491.1 ms | 344.0 / 323.6 ms |

The review row improves by about 30% (146 to 167 ms) and the unchanged rows do not move. `git` spawns
per review, counted with a `git` wrapper on the fake `claude`'s PATH over the 7 runs of the case (2
warm-ups and 5 measured): 259 on main (37 per review) and 168 on the head (24 per review), the same
37 and 24 as before the merge. Main's new settings read at the merge-base goes through the same
one-listing `ls-tree` as the instruction files, so no spawn was given up for it.

## Left unchanged

| Area | Why it stays |
| --- | --- |
| All Node to Bun API migrations (inventory above) | below the noise or slower; the file-system calls are under 1 ms per review |
| `snapshotHead` (172 ms on 569 files) and evidence gathering (about 125 ms) | the remaining cost is `git` work (`read-tree`, `ls-files`, one `git grep` per symbol); a further saving is one process each, under the +-3% resolution of the harness |
| Module graph (about 27 ms on every command) | `help.ts` pulls in the usage strings of every command; making them lazy changes the module layout of the CLI and needs its own decision, and `--help` and `--version` are already near the 8.8 ms Bun floor plus 27 ms |
| Absolute `git` path (about 6 ms per spawn on macOS) | changes which `git` runs; the consumer's `PATH` is the contract |
| Launcher (Node, then Bun) | not touched: `node bin/wachiman.js --version` exits 0 in every bench run above, and no launcher file is in this diff; the child Bun start is the floor of that path |

## Reproducing

Everything except the profile and the microbenchmarks is `bun run bench`. The counts, the interleaved
comparison and the microbenchmarks used small throwaway scripts (a preload that wraps the spawn calls, a
shim for the `node:fs` import, an A/B runner that rotates trees) that are not part of the repository;
the method is described above so any of them can be rebuilt.
