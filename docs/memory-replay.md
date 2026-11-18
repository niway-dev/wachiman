# Memory replay: does repository memory lower review noise without hiding real bugs?

This is the protocol for the experiment behind
[the memory design](specs/2026-11-18-repository-memory-design.md) (acceptance criterion 14). It is
written before any run so that the commits, the counts and the decision rules cannot be chosen after
the results are known. **Nothing in this document is a result.** The [Results](#results) section says
whether the experiment has been run.

## Hypothesis

Repository memory lowers the number of review comments the owner does not want, without hiding a real
bug. That is a hypothesis. A replay on one repository with three runs per arm can support or fail to
support it; it cannot prove it, and a repository with a different history may behave differently.

Two things are measured, and they pull against each other:

- **Noise**: findings posted that the author judges wrong, intentional or not important.
- **Safety**: Blocker and Fix findings that the without-memory arm posts and the with-memory arm loses.

## What the replay needs from Wachiman

Everything already exists on the laptop. No new mechanism is added beyond the control switch.

| Need | Command |
| --- | --- |
| Review exactly one commit, against its parent, whatever `HEAD` is | `wachiman local --commit <sha>` |
| Review with memory (the memory folder of the commit the diff starts at, read from that commit only) | the default |
| Review as if the repository had no memory folder | `wachiman local --commit <sha> --no-memory` |
| Keep each finding's identity across the reviews of a sequence, and settle a finding when the code it cites changes | `--history` |
| Machine-readable result with `memory` and `muted` | `--format json --result-version 2 --output <file>` |
| Outcomes, muted findings and memory size from a history | `wachiman memory report --format json` |
| The author's judgement of a finding | `wachiman history --verdict <id> wrong\|intentional\|not-important` |

`--no-memory` is tested to produce the same prompt and the same provider arguments as a repository
with no `.wachiman/memory/` folder; it is the only difference between the arms.

## Design

### The evaluated commits

1. Pick the repository and its default branch. The pilot is kaipu-record, the repository that
   motivated the design.
2. Pick the **freeze commit F**: a commit on the default branch whose `.wachiman/memory/` holds the
   entries to be tested (at least one exception and one convention, or the result says which kind was
   absent). Memory is read at each reviewed commit's parent, so it is frozen only if it does not change
   inside the window. Check it before running:

   ```sh
   git log --oneline F..L -- .wachiman/memory     # must print nothing
   ```

3. The evaluated commits are the next N commits on the default branch after F (`git rev-list
   --first-parent --reverse F..HEAD`), skipping merge commits, commits that touch no reviewable
   file, and commits over 800 changed lines. N is 8 to 12. The list of N shas is written in the
   Results section **before the first run** and is not edited afterwards.
4. Add one more commit after the last: the **settling commit**. It is reviewed in every run so that
   the findings of the last evaluated commit can be seen as fixed or not. Its own findings are not
   counted.
5. No entry in F's memory may cite, as evidence, a pull request whose commits are evaluated. An entry
   learned from the same changes would be answering a question it already saw.

### The arms

- **With memory**: the commits are reviewed in order with the default settings.
- **Without memory**: the same commits, in the same order, with `--no-memory`.

Everything else is identical: the same clone state, the same account and model, the same
`WACHIMAN_VERIFY` setting, the same budget. Each commit is reviewed on its own with `--commit`, in
order, so every review sees one increment, as a pull request review does after a push.

### Runs and order

Three runs per arm, six sequences in all. Interleave them (with, without, with, without, with,
without) so that drift in the provider's behaviour over the days of the experiment lands on both arms.
Each run uses its own Wachiman home, so its history holds that run alone:

```sh
export WACHIMAN_HOME="$REPLAY/home-<arm>-<n>"
for sha in $COMMITS $SETTLING; do
  wachiman local --repo-dir "$CLONE" --commit "$sha" --history [--no-memory] \
    --format json --result-version 2 --output "$REPLAY/<arm>-<n>-${sha:0:7}.json"
done
```

`$REPLAY`, `$CLONE`, `$COMMITS` and `$SETTLING` are the experiment's scratch folder, a clone of the
repository, and the pre-registered shas.

### What is counted per run

| Count | Where it comes from |
| --- | --- |
| Findings posted, by severity (Blocker, Fix, Consider, Info) | `.findings` of each result file |
| Findings muted by memory (with-memory arm only) | `.muted` of each result file, or `memory report` |
| Findings matching what the author later fixed | The history's `probably-fixed` status: the cited code changed in a later commit of the window and the finding did not return (`wachiman history --json`) |
| Findings the author judged wrong | The owner's verdicts, below |

Judging is done once, blind. After all six runs, collect the distinct findings (same commit and path,
lines within 3 of each other and the same topic count as the same finding; a pair the owner cannot
decide by reading is two findings). Shuffle them, remove the arm and run, and the owner records for
each one `wrong`, `intentional`, `not-important` or no verdict, by reading the diff and the finding. A
verdict then applies to every run that posted that finding. The owner is the judge because the
author's own replies to these changes do not exist: the commits were reviewed after the fact.

Each run has its own home and its own history, so a verdict is recorded once per run that posted the
finding, and the id differs from one history to the next. Keep a table of rows `(finding, home, id)`,
one row per run that posted it (the ids are in `wachiman history --json` for that home). After the
blind pass, replay each decided verdict into every row's history:

```sh
WACHIMAN_HOME="$REPLAY/home-<arm>-<n>" wachiman history --repo-dir "$CLONE" \
  --verdict <id-in-that-home> wrong|intentional|not-important [--reason "<why>"]
```

A finding with no verdict gets no command. When all six histories are done, `wachiman memory report`
run under each `WACHIMAN_HOME` gives that run's counts.

### The spread, and what counts as an effect

For each count and each arm, report the three values, their **min, max and mean**. The run-to-run
spread of an arm is `max - min`. The difference between the arms is the difference of the means.

> **A difference no larger than the larger of the two arms' spreads is reported as no measurable
> effect.**

With three runs this rule only detects large effects, and "no measurable effect" is not evidence of no
effect. A difference larger than the spread is reported as a difference in this repository on this
window, with the three values of each arm beside it, never as a percentage alone.

### The guardrail

> No Blocker or Fix finding that appears in the without-memory arm may be absent from the with-memory
> arm in **all three** runs.

A finding "appears in the without arm" when it is posted in at least one of its three runs, and is
"absent from the with arm" when none of the three with-memory runs posts it (matched as above). A
single miss is not a failure, because a run can miss a real finding with no memory at all; three
misses of a finding the other arm posts is the pattern that memory could cause.

A guardrail on findings the author fixed is not enough, for three reasons:

- A real bug the author never fixed (merged unnoticed, fixed in a later pull request, or never
  read) is not in the fixed set, so a memory that hid it would pass.
- What authors fix is biased towards cheap, local changes. A bug that costs a day to fix is
  fixed less often than a typo, and the guardrail would be blind to the bugs that matter.
- It judges only findings that were posted. A memory convention in the prompt can change what the
  model looks for, and then a bug is not found at all; only the without arm shows that it existed.

The engine already forbids an exception from muting a Blocker, a Fix or a security finding, so a miss
under the guardrail points to the conventions in the prompt or to run-to-run variation, which is why
the rule needs all three runs. Every guardrail miss is reported, with the finding, even when the
experiment otherwise shows no difference.

### Cost and how to bound it

Every review costs model calls: 2 arms x 3 runs x (N + 1) reviews, 48 to 78 for N between 8 and 12,
plus the one-off judging. The reviews run on the signed-in subscription, so the cost is quota, and
each result records its own figure under `execution`.

Bound it before the first run:

1. Review one evaluated commit once, with and without memory, and read both costs. Multiply the larger
   by the number of reviews. If that is above what the owner will spend, reduce N, not the runs per
   arm: fewer than three runs cannot show a spread.
2. Set `WACHIMAN_BUDGET_USD` for every review to twice the larger of those two costs, so one runaway
   commit cannot spend the experiment.
3. Run the first sequence in full and add its cost to the plan before starting the next. Stop the
   experiment if the running total passes the ceiling written in the Results section; a partial
   experiment is reported as partial.

## Results

**Not run.** The replay has not been run on kaipu-record or on any other repository. There are no
figures here, and no statement in this repository, the design or the documentation should say that
memory lowers review noise or leaves bugs unhidden until this section holds them.

When it is run, this section is replaced with: the freeze commit and the evaluated shas, the date,
the Wachiman version, the model, the ceiling and the cost spent, a table of the counts above with the
three values and min, max and mean per arm, the guardrail result with every miss named, and the
judging sheet.
