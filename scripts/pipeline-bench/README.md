# Pipeline benchmark

Measures the **code-only baseline** of the review engine: everything it does except the model. It
runs the real input build, file filtering, batch planning, evidence search and prompt assembly over
a pinned merge commit of a large public repository, with a stub provider that answers instantly with
full coverage. Every figure is therefore the engine's own work.

The `Pipeline bench` workflow runs the base and the head engine of a pull request one after the other on the
same runner and writes the comparison to the job summary (and a sticky comment on same-repository
pull requests). It reports and never gates.

## What it measures

- Size metrics, exact: files changed, kept and reviewable, lines, batches, provider calls, total
  prompt characters, total evidence bytes, evidence symbols and call sites, and a SHA-256 of every
  batch's `evidence.json` and of every prompt. A row that differs between base and head is flagged
  `changed`. The temporary run directory named in each prompt is replaced before hashing, and the
  evidence digest leaves out the wall-clock cap and time-box notes.
- Time, as the median of the runs (3 when the first run takes under 60 s, else 1): input build
  (git diff and snapshot), filter, split, plan batches, `reviewChange` in total, and the evidence
  step summed over batches and for the slowest batch.

## What it does not measure

The model (latency, cost, answer quality), the GitHub API, and posting a review. It also says nothing
about findings: the stub never reports one. Timings come from one base-then-head round, and the CLI
benchmark (`cli-bench.yml`) measured single rounds differing by up to 14% on the same runner; trust the
size metrics exactly and a timing only when it moves by more than about 15%.

## Run it locally

```sh
# Fetch a case (a shallow clone of its merge commit) and measure it.
bun scripts/pipeline-bench/fetch.ts trpc-7771 /tmp/bench/trpc-7771
bun --no-env-file --config=bunfig.toml scripts/pipeline-bench/run.ts \
  --src "$PWD/src" --repo /tmp/bench/trpc-7771 --case trpc-7771 > head.jsonl

# The same for another checkout of the engine (for example a worktree of main), then compare.
bun --no-env-file --config=bunfig.toml scripts/pipeline-bench/run.ts \
  --src /path/to/other/src --repo /tmp/bench/trpc-7771 --case trpc-7771 > base.jsonl
bun scripts/pipeline-bench/compare.ts --base base.jsonl --head head.jsonl
```

`--runs N` overrides the number of timing runs. Run cases one at a time: they compete for CPU.
`run.ts` imports the engine from `--src` at run time. It needs `buildLocalInput`, `reviewChange`,
`loadConfig` and `reviewOptionsOf`; an older engine without one exits with status 3 (nothing to
measure). A metric whose optional API is missing is `n/a`.

Each side first reads every git object of the case once, untimed (`git cat-file --batch-all-objects`),
so the first engine measured does not pay the cold git object cache that the second one would otherwise get for free. Only the git cache is warmed: the first timed run still pays module load and JIT, which the median of 3 runs absorbs. If the stub
cannot parse a batch's file list from the engine's prompt, the result carries `harnessMismatch` and
the report prints a warning.

## Add a case

Add an entry to `corpus.json`: `id`, `repo` (`owner/name`), `pr` (for readers), `sha` (the full
merge commit, which must have a first parent), and `tier`. Tier `pr` runs on every pull request that
touches the engine; `extreme` runs only on request (label `bench:extreme`, or a manual run with
`include_extreme`) because it can take half an hour per engine. Pick merge commits, not branch tips:
a SHA stays reachable on GitHub, a branch does not.
