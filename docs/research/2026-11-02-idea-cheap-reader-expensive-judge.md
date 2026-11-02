# Idea: a cheap model reads, an expensive model judges

- **Status:** idea, not a decision. Nothing is planned or built. Revisit after the v1.4.0
  benchmark ([2026-11-02](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-11-02/README.md)) and a Sonnet-only run of it.
- **Raised:** 2026-11-02, by the owner: "Sonnet as a subagent to lighten costs, Opus for the hard
  work."

## How a review runs today

- The engine splits the diff into batches. Each batch is one independent `claude -p` call: a fresh
  agent that shares no context with the other batches. Batches run one after another.
- Every batch uses the same model: Opus 5.5 in the benchmark, Sonnet 5.5 by default for consumers.
  The default has never been benchmarked.
- Tools: `read`, `glob` and `grep` only. The agent cannot start subagents.

## Where the cost is

Measured on a Pullfrog review of kaipu-record #465 ([harness options](2026-10-31-harness-options.md)):
cache reads about 50 %, cache writes about 36 %, output about 14 %. Most of the spend is the
agent re-reading context over 25–45 turns. A cheaper model only for the output would save little;
it has to do the reading.

## Options

1. **The engine picks the model per batch.** Sonnet for tests, docs and styles; Opus for code with
   new calls or open contracts. Simplest, and code decides. Risk: test-quality findings, Wachiman's
   most reliable output, may come from the expensive model.
2. **A Sonnet reader before each Opus batch.** The engine runs Sonnet to answer factual questions
   ("who else calls `startFileDrag`, and what do they do around it?") and keep only `file:line`
   citations with excerpts, no conclusions. Opus reads that and judges. A semantic version of the
   call-site evidence in #69, aimed at the reading cost. Risk: a reader that summarises wrong biases
   the judge, hence citations only.
3. **Subagents inside the Opus call**, as Pullfrog's prompt allows. Not favoured: the model would
   control spend and need a tool it does not have ([Pullfrog and CodeRabbit](2026-10-30-pullfrog-and-coderabbit.md)).

## What would decide it

- **E1:** one v1.4.0 run with `model: claude-sonnet-5-5` on every batch, compared with the Opus
  runs. If Sonnet finds nearly the same, the default is fine and option 2 matters less. If it
  loses the hard bugs, option 2 has a clear target: Opus quality at a cost closer to Sonnet's.
- Model prices come from the reviews' own cost footers, not from memory.

## A fact from the benchmark logs

Pullfrog's prompt allows specialist subagents, but in the 14 Pullfrog runs whose tool calls are
saved in [niway-dev/wachiman-benchmarks](https://github.com/niway-dev/wachiman-benchmarks) (2026-10-31 live and re-reviews, 2026-11-01 replays) it started
**none**: the only "Task" in those logs is the closing line `» Task complete.`. Its advantage on
those PRs came from one agent following one action across files, not from specialisation.
CodeRabbit's internals are not visible; nothing here says whether it uses several agents.
