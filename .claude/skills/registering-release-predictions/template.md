# v<version>: predictions

- **Registered:** <date>, before the release PR (<link>) merged.
- **Previous version:** v<prev>. **Changes:** <link to the release notes or compare view>.
- **Rolled out to:** <consumer repo>, pin `@v<prev>` → `@v<version>`, model <model>, triggers <list>.
- **Evaluation point:** <date, or after N pull requests on the consumer>, written as `RESULTS.md`
  next to this file.

## In one minute

<Three to five lines: what this release should improve, the one number that matters most, and
what it is known not to fix.>

## Predictions, one per change

| # | Change (commit or PR) | What it should improve | Metric | Baseline (source) | Predicted | Where to read it | Falsified if |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | | | | | | | |

Mark a change "does not run on <consumer>" when the consumer lacks its trigger or input.

## Known not fixed

Problems this release does not address, with the number they have today, so the next release can
show movement.

| Problem | Current number (source) | Expected in this release |
| --- | --- | --- |
| | | unchanged ± <range> |

## Risks to watch, and when to roll back

| Risk | Signal | Roll back the pin if |
| --- | --- | --- |
| | | |

## How the results will be scored

<Which runs, logs, API calls or audits produce each metric, and who checks verdicts by reading the
code. If a metric needs an audit of findings, say how many and by what method.>

## Amendments

<Dated corrections only. Never edit the tables above after the release.>
