# Measuring precision

Precision here means: of the findings a person judged, how many were right. It is the way to check
that a change to the prompt rules lowers false positives without hiding real findings. It is a
count of replies, not a measurement of truth: a person writes a verdict in the finding's thread,
and `src/precision.ts` counts what they wrote. It never measures recall (real defects the
reviewer did not report).

The reviewer is advisory. Nothing on this page changes what a review does to a pull request.

## 1. Judge a finding

Reply in the finding's own thread with a line that starts with `Verdict:`:

| Verdict line says | Counted as |
| --- | --- |
| `correct` | correct |
| `wrong`, `incorrect` or `false positive` | wrong |
| `partial`, `partially`, `partly` or `half`, or both "correct" and "wrong" | partly correct |

Details of how the line is read (all from `parseVerdict`):

- Any line of the reply that starts with `Verdict:` counts, in any letter case. Leading
  punctuation such as bold markers is fine: `**Verdict: wrong (false positive).**`.
- Only the verdict's own sentence is read, up to the first period followed by a space or the end of
  the line, or up to a closing `**`. The explanation after it can say anything.
- Negation is not understood. `Verdict: not correct` is counted as **correct**, because the
  sentence contains the word "correct". Write `Verdict: wrong` instead.
- A reply that matches none of the words above is not a verdict, and the next reply in the thread
  is tried.
- A finding with no verdict reply is counted as unjudged, never as correct.

## 2. Whose verdict counts

The collector does not check who wrote the verdict. It reads the replies to each finding and takes
the first one, in the order GitHub returns them, that parses as a verdict, whoever wrote it. The
only author it skips is the `github-actions[bot]` account, so the reviewer's own replies are never
read as verdicts. Any other account counts: the pull request author, a teammate, a bot that is not
`github-actions[bot]`, or, on a public repository, anyone who can comment.

So the tables are judgments by the participants in each thread. They are the maintainers' judgment
only when the maintainers are the only people who reply with a `Verdict:` line, which is something
you arrange, not something the script enforces. An issue for a strict, operator-only verdict
parser exists ([#42](https://github.com/niway-dev/wachiman/issues/42)); this script does not do
that today.

## 3. Run the collector

```sh
bun src/precision.ts <owner/repo> [<owner/repo> ...] [--prs 50]
```

For example, `bun src/precision.ts my-org/my-repo --prs 50`.

- It only reads GitHub, through `gh`, so it needs a `gh` login that can read each repository. It
  posts nothing and does not call a model provider.
- For each repository it takes the `--prs` most recent pull requests that `gh pr list --state all`
  returns (default 50; a value that is not a positive integer is a usage error, exit code 2).
- It counts only inline finding comments posted by `github-actions[bot]` that carry the engine's
  finding signature. Unsigned comments in the old label format count only if they were created
  before `LEGACY_CUTOFF` (2026-11-01). Findings in the review body, that is "Outside the diff",
  "For your information" (every `info` finding) and findings moved into the body after GitHub
  refused the inline comments, have no thread and are not counted.
- The model of each finding is read from the footer of the review that posted it
  (`<sub>… via …</sub>`); a review without that footer is grouped as `unknown`.

## 4. Read the tables

It prints one table per severity, topic and model, and one per confidence once any finding in the
sample carries a confidence (findings posted before the field existed are grouped as `unlabelled`). In each row, precision is correct divided by
judged, where a partly correct finding counts as half (it found something real and also asked for
something wrong) and unjudged findings are left out of the denominator. A group with nothing
judged shows `n/a`. Labels from before v1.1.0 (`Should fix`, `Note`) appear under their old names,
`should_fix (old)` and `note (old)`.

Synthetic example (invented numbers, not output from a real repository):

| Severity | Findings | Correct | Partly | Wrong | Unjudged | Precision |
| --- | --- | --- | --- | --- | --- | --- |
| fix | 3 | 1 | 0 | 1 | 1 | 50% |
| consider | 2 | 0 | 1 | 0 | 1 | 50% |

The `fix` row has two judged findings, one correct and one wrong, so (1 + 0) / 2 = 50%. The
`consider` row has one judged finding, partly correct, so (0 + 0.5) / 1 = 50%. The unjudged
findings are in the `Findings` column but not in the percentage.

## 5. What the numbers can and cannot tell you

- Compare the same repositories before and after a prompt change, over a similar number of judged
  findings. The tables are small samples: one wrong finding moves a group of ten by ten points.
- The unjudged findings are excluded, so a table can look better or worse than the whole set if
  the findings people bother to judge differ from the ones they skip. Look at the `Unjudged`
  column before trusting a percentage.
- Precision by severity matters most: a wrong `fix` or `blocker` costs the author the most time,
  because it is stated as fact. (`blocker` is a severity label. The review never blocks a merge.)
- It says nothing about findings the reviewer missed, and nothing about whether a "correct"
  finding was worth the author's time.
- [ADR 0003](adr/0003-two-axis-finding-labels.md) has a reopen condition about findings that
  should have had another severity. The verdict convention does not record that, so precision by
  severity is the nearest existing measure, not a test of that condition.
