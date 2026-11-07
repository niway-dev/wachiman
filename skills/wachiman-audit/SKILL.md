---
name: wachiman-audit
description: Use when the developer asks how Wachiman's findings compare with another reviewer's (CodeRabbit, Pullfrog, any bot) on real pull requests, what one found that the other missed, or whether a day or a release of reviews was worth its cost.
---

# Audit Wachiman against another reviewer

## Why

Comparing two reviewers by hand mixes things that must stay apart: a finding posted on one commit
with a finding posted on the next, a live CI run with a rerun on a laptop, a tool that found nothing
with a tool that never ran. The pairing is mechanical and a script does it; the judgement is not,
and that is the only part you do.

## The one command

From a worktree of `niway-dev/wachiman-benchmarks`:

```sh
bun scripts/pair.ts --repo <owner/name> --prs <a-b[,c]> --other coderabbit|pullfrog --out <YYYY-MM-DD-<topic>>/pairs
```

It writes `pairs.csv`, `special-cases.csv`, `reviews.csv`, `findings.csv` and a generated `pairs.md`.
Never edit those files, and never build the comparison from the PR page instead of them.

## What a pair is

A **pair** is one commit that both tools finished reviewing. Only findings with
`comparison: paired` in `findings.csv` are compared. A commit one tool reviewed and the other did
not, a refusal (no credit), a skip (path filters) or a partial review is a **special case**: it is
reported, with its reason and what would make it comparable, and it is never counted in the
comparison. A rerun on a laptop at the same commit makes a new row with `basis: rerun`; it goes in
the special-cases section, not in the pairs.

## Judge, then write

For every paired finding, add one row to a hand-written `verdicts.csv` next to the pairs:

| column | values |
| --- | --- |
| `id` | the `findings.csv` id; a comment that bundles several points gets `<id>-1`, `<id>-2` |
| `verdict` | `verified` (you read the code at that commit), `owner-accepted` (fixed after the comment), `answered` (a question with a checkable answer), `wrong`, `unverified` |
| `defect_severity` | `high`, `medium`, `low`, `none`: yours, not the tool's label |
| `difficulty` | 1 to 5: how hard for a human reviewer of the diff to find |
| `matched_by` | the other tool's finding id on the same defect, or empty |
| `judge` | the model that decided, e.g. `claude-fable-5-1` |
| `evidence` | `path:line` at the commit, or the fixing sha |

Then write `README.md` in the same folder, in this order:

1. **One-minute block**: PRs, pairs, special cases, verified defects, and the one-line answer to
   "what did the other tool find that Wachiman did not", with `basis` and the Wachiman versions
   seen (from `pairs.csv`, not from memory: a footer never shows the version).
2. **Pairs**: the `pairs.md` table, plus per pair what each tool found and the verdicts.
3. **Gaps**: for each finding only the other tool made and you verified: what happens, why that
   tool found it (its posted commands or cited files), severity, difficulty.
4. **Special cases**: the `special-cases.csv` table ordered by what was lost: `refused` first (a
   change merged with no Wachiman review), then `skipped`, `partial`, `unpaired`.
5. **Cost**: Wachiman's sum from `pairs.csv`. The other tool's cost only when it published one;
   otherwise "not published", never an estimate.
6. **Limits**: days, PRs, repositories, who judged, what is still `unverified`.

Open the result as a draft PR on `wachiman-benchmarks`. Nothing about a comparison goes under
`wachiman/docs`.

## Never

| Tempting | Instead |
| --- | --- |
| "Both tools reviewed the PR" | Both reviewed the **commit**: check `pairs.csv` |
| Counting a laptop rerun with the live runs | `basis: rerun`, special-cases section |
| Writing the Wachiman version from the release of the day | `wachiman_version` column: #535 ran v1.7.0 on the night v1.8.0 shipped |
| Guessing the other tool's cost | "not published" |
| Scoring a finding only one tool made and nobody verified | `unverified`, listed, not scored |
| Committing a private repository's findings to the benchmarks repo | Counts only: the posted findings quote the code, and wachiman-benchmarks is public |
