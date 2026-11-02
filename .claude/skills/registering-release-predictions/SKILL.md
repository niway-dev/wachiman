---
name: registering-release-predictions
description: Use when a Wachiman release is about to be cut or rolled out to a consumer repository (a release-please PR is ready, "publish 1.x", "bump kaipu to the new version"), or when a released version's field results are being judged.
---

# Registering release predictions

## Overview

A release is an experiment on real pull requests. Before it ships, write down what each change
should do, as numbers you can check later, and what is still broken. Judge the release against
that page, not against impressions afterwards.

## When to use

- A release PR (release-please) is ready to merge.
- A consumer's pin is about to move to a new tag.
- Some days after a rollout, to write the results against the predictions.

Not for docs-only releases with no engine, prompt, workflow or default change.

## The rule

The predictions file is committed and merged in `niway-dev/wachiman-benchmarks` **before** the
release PR merges. The commit time proves the order. After the release, the predictions are not
edited. A correction goes in a dated `## Amendments` section.

## Steps

1. List the release's `feat` and `fix` commits since the previous tag:
   `git log <prev-tag>..origin/main --no-merges --oneline`. Group them by user-visible change.
2. For each consumer the release goes to, read its caller workflow. Its triggers, model and
   inputs decide which changes run there at all. A change whose trigger the consumer lacks is
   predicted as "does not run here". Predict the consumer as it is: adding a trigger or input is
   the owner's decision, made separately, never folded into the pin bump.
3. Copy [template.md](template.md) to `releases/v<version>/PREDICTIONS.md` in
   wachiman-benchmarks and fill in every slot. Every number names its source (a benchmark report,
   a run log, an ADR). Take each prediction's metric from the mechanism the change's PR or ADR says
   it touches. A fix that removes base-branch code from a re-review predicts "a merge-only push
   costs $0", not "re-reviews get cheaper", unless its PR measured that.
4. Open the PR in wachiman-benchmarks and merge it. Then run `docs/releasing.md`'s checklist, merge
   the release PR, and bump the consumers' pins.
5. At the evaluation point the file names, write `releases/v<version>/RESULTS.md`. Score every
   prediction met, missed or not measurable, from the sources it named.

## Quick reference: a usable prediction

| Slot | Bad | Good |
| --- | --- | --- |
| Metric | "reviews get better" | "real Medium+ bugs found per data-path PR" |
| Predicted | "fewer false positives" | "invalid findings ≤ 1 in 20" |
| Baseline | none | "0 of 76 invalid, v1.3/1.4, field run 2026-11-02" |
| Where to read it | "the logs" | "`Data-path questions for part` log line, `review / Agent review` job" |
| Falsified if | none | "a fired batch costs > 25 % more than an unfired one (ADR 0016)" |

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Only checking that the tag and engine SHA match | That checks the publish, not the change. Predict each change's effect too |
| Leaving out what is still broken | Fill in "Known not fixed" with its current number, so a later improvement or regression is visible |
| Predicting for a trigger the consumer does not have | Read its caller workflow first (step 2) |
| Enabling a new trigger in the consumer "so the feature runs" | Predict "does not run here" and ask the owner |
| A cost prediction the change's own diagnosis contradicts | Read the PR body's measurements first |
| Writing the predictions after the rollout | They are then descriptions. Merge them before the release PR |
| Adjusting a prediction after seeing data | Add an amendment with a date. Leave the original |
