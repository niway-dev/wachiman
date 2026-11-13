# The local dashboard

`wachiman dashboard` shows, on your laptop, what your local reviews cost, how many findings they
captured and what you thought of them, and how your review loops went. It writes one HTML file you
open from disk, or prints the same figures as JSON. It runs no `claude`, calls no GitHub, starts no
server and never opens a browser. It makes no network request unless you pass `--refresh` with a
connected spend ledger (see below).

```sh
wachiman dashboard                       # writes ~/.wachiman/dashboard.html and prints its path
wachiman dashboard --out ./dashboard.html
wachiman dashboard --json                # wachiman.dashboard/1 on stdout
```

## What it covers

What the local history kept, plus the downloaded ledger entries when you connected one: runs saved by `wachiman local --history` and by `wachiman loop`
(which keeps a history), the verdicts you gave with `wachiman history --verdict`, and the loop state
files. It covers every repository in `~/.wachiman/history`, not only the one you are standing in
(`--repo-dir` is accepted like on every command and is not used).

Runs made by the GitHub Actions workflow never write the local history, so by default they are not
here. If you connect the spend ledger (`wachiman ledger connect <url>`, then `wachiman ledger pull`
or `wachiman dashboard --refresh`), the page adds them from the downloaded entries, next to the laptop
runs and always split by source (Actions, laptop) and by credential (billed API key, estimated
subscription). The page draws the limit only on the chart of what the ledger counts (Actions runs,
whole account); a second chart shows spend by source with no limit line. Laptop runs are never
counted against the ledger limit. See
[ADR 0039](adr/0039-the-laptop-reads-the-ledger-and-one-report-covers-laptop-and-actions-runs.md) and
[`ledger`](cli.md#ledger). Reservations that never settled and runs that were not reserved are shown
as their own lines, not as spend, and a period the downloaded days do not cover says "no data".

| Figure | Where it comes from |
| --- | --- |
| Spend per day and per repository | `costUsdEstimate` of each run, grouped by the UTC day of `savedAt`. An API-equivalent estimate from Claude Code, not a bill |
| Findings by severity | Distinct findings as `wachiman history` replays them: a finding seen in three runs counts once |
| Findings by verdict | Your last verdict on each finding (`correct`, `partial`, `wrong`), or `unjudged` |
| Loops | One row per branch with a loop state: rounds run, `open` or `converged`, the findings the loop saw |
| PR Confidence grades | Counted only where a run file carries one |

## What it cannot show

- **The reason a loop stopped.** The loop state keeps only `open` or `converged`. The round cap and a
  failed review are printed by `wachiman loop` and not saved, so the dashboard writes
  `not recorded` for the exit reason of every loop.
- **PR Confidence grades, today.** The grade is computed for GitHub pull request reviews
  and for `wachiman local --confidence <file>` (`wachiman loop` never produces it). GitHub reviews never
  write the local history; a local run does only with `--history`.
  So the dashboard normally says `not recorded`. If a run file carries `fidelity.grade`, the
  dashboard counts it by grade; it does not guess one for a run that has none, and it does not read
  GitHub for the owner's judgement of a grade.
- **Anything older than the history's retention.** A new `--history` run deletes runs older than 30
  days (`WACHIMAN_HISTORY_DAYS`, `0` keeps them all), and the dashboard only sees what is left.

## The index

The figures are read from an index, `~/.wachiman/index.sqlite` (or `$WACHIMAN_HOME/index.sqlite`),
that the dashboard builds by replaying the history run files, `verdicts.jsonl` and the loop state
files, using Bun's built-in SQLite ([ADR 0035](adr/0035-a-rebuildable-sqlite-index-beside-the-run-files.md)).

- **The run files stay the record.** The index holds nothing that cannot be rebuilt from them.
  Deleting it loses nothing.
- **Nothing else reads it.** `wachiman history`, `local` and `loop` replay the files exactly as
  before, and `status` reads the downloaded ledger day files directly; their output is the same with
  the index present, deleted or corrupt.
- **It is rebuilt, never repaired.** A missing index, a corrupt one, one written by another version of
  the schema, or one older than the files it was built from (a new run, a new verdict, a loop round)
  is deleted and built again. The new file is written under a temporary name and renamed into place,
  with mode `0600`, so a reader sees all of it or none.
- **A damaged run file** is moved aside to `<name>.unreadable-<unix-seconds>` with a warning, exactly as
  `wachiman history` does. A loop state file whose content does not parse, or has the wrong shape, is
  skipped with a `dashboard:` warning and left in place, so the index is rebuilt on every call and the
  warning repeats until the file is fixed or removed. A run file written by another version is left in
  place, so a downgrade loses no history, and so is a damaged run file that could not be moved aside;
  both are warned about only by the call that rebuilds the index. A loop file
  that cannot be read for another reason, such as permissions or I/O, makes the command fail with that
  error. A line of `verdicts.jsonl` that is not a verdict (for example a half-written last line) is
  ignored without a warning.

## The HTML page

One file, plain CSS and inline SVG charts and bars, no script, no font, no image and no link. A content security
policy in the page (`default-src 'none'`) tells the browser to load nothing else, and every name taken
from the history (repository, branch) is HTML-escaped. It shows the repository name and key, not its
path or remote, so it is safer to share.

## JSON

`--json` prints [`wachiman.dashboard/1`](formats/dashboard.v1.schema.json): `totals`, `spend`
(`byDay`, `byRepository`), `findings` (`bySeverity`, `byVerdict`), `loops` (`branches`, `totals`) and
`prConfidence` (`{"status": "not recorded", ...}` or the count by grade). `generatedAt` is the only
field that changes between two calls on the same history. With a ledger connected or pulled there is
also `usage` (the spend report). `--json` cannot be combined with `--out`.

Exit codes: 0 written or printed (also with no run kept); 1 a loop file could not be read, or the
index or the page could not be written; 2 usage error.
