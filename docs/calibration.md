# Calibrating the finding priority

The priority word on a finding (Must, Should, Could, FYI) comes from a table keyed by severity and
confidence. `wachiman calibrate` measures how findings fared on GitHub and proposes the next table.
It reads GitHub through `gh` and writes only under the Wachiman home. Nothing the engine reads
changes until a person edits `src/priority.ts` from the proposal and commits it.

## 1. Look at the outcomes

```
wachiman calibrate <owner/repo> [--prs 50] [--json]
```

For each finding the reviewer posted on the last `n` pull requests, it reads the thread and records
the first human reply that states an outcome. A reply's first meaningful line is its first line that is not empty and does not start with `>`, so an agent's callout header is skipped:

| Outcome | The reply's first meaningful line | Notes |
| --- | --- | --- |
| wrong | a `Verdict:` line that [precision](precision.md) counts as wrong | wins over the others |
| fixed | contains `fixed`, `done`, `addressed`, `applied`, `settled`, `resolved` or `updated`, or starts with `Added` or `Agreed` | `Fixed in 64198cf. …` |
| declined | contains `declin…`, `won't fix`, `not fixing`, `keeping`, `intentional`, `by design`, `no change`, `out of scope`, `on purpose`, `not changing`, `no longer applies`, `as intended`, `deliberate`, `kept as is` or `the claim holds`, or starts with `Not changed`, `Verified:`, `Confirmed:` or `Checked against` | `Declined: …` |
| unanswered | none of the above | no reply, or a reply that decides nothing |

If one first line holds both a fix word and a decline word, the earlier one wins.

The table has one row per severity and confidence, with n, fixed, declined, wrong and unanswered,
for all pull requests and then split by who opened them. **Fixed and declined are shares of fixed
plus declined; wrong and unanswered are shares of n.** A finding with no confidence is its own row,
never merged with medium.

The owner and agent split is decided by the reply that decided the outcome. Agents post from the
owner's account, so a login cannot tell them apart; instead, a reply carrying a
`responding on behalf of` callout (`> 🤖 **Model responding on behalf of Name**`) is an agent's, and
any other deciding reply is the owner's. A finding no reply decided falls back to the pull request:
agent when its description has a `Generated with [Claude Code]` or `Generated with Codex` line or its
author is a bot, owner otherwise. The table headers say this.

These rates are reported and never fitted. A fix rate measures compliance, not whether the
finding warranted action.

## 2. Judge a blind sample

```
wachiman calibrate <owner/repo> --judge [--count 40] [--seed <n>]
```

It writes `~/.wachiman/calibration/<owner>__<repo>/judging-<UTC date>.jsonl` and stops; it asks
nothing. Each line is one finding with the Priority row and any `Must`, `Should`, `Could`, `FYI`,
`Important` or `Nit` word removed from its label, and `"wouldAct": null`.

- The draw is uniform random, stratified over the seven movable cells (consider and fix at high,
  medium and low, and blocker at low): one finding per cell in turn, so each gets about five of 40,
  and a cell with few findings gives all it has. Unanswered findings are in the pool.
- Blocker at high or medium (always Must) and info (always FYI) are never sampled.
- `--seed` makes the draw repeatable; the default is today's date as `YYYYMMDD`.
- A finding in an earlier judging file for the repository is never drawn again.

Open the file, read each finding without looking at how its pull request answered it, and set
`wouldAct` to `true` (a careful reviewer would act on it) or `false`.

## 3. Propose the next table

```
wachiman calibrate <owner/repo> --propose
```

It reads every judging file, skips lines still `null`, and for each movable cell counts the
judgements, those saying `true`, and the distinct pull requests. A cell is measured only with at
least 20 judgements from at least 5 pull requests; its word then moves only when the 90% Wilson
interval of the `true` share leaves the word's band (at least 60 Should, 25 up to 60 Could, below
25 FYI). A low-confidence Blocker or Fix is never proposed above Could.

It writes `proposed-table.json` (version `v2`, one entry per cell with word, n, yes, prs, measured
and provenance) in the same folder and prints the change per cell, for example
`consider · medium: could → should (n 24, 5 PRs, interval 0.62–0.88)`, with that cell's fix and
decline rates beside it. With no judgements it says so and proposes nothing.
