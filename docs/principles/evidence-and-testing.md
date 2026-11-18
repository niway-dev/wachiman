# Evidence and testing

This is a proposed evaluation checklist for applying the [principles](principles.md), not a
claim that every artifact is currently generated. The [source register](sources.md) explains
the influences; these artifact fields and acceptance criteria are Wachiman's recommendations.

## Choose the evidence for the claim

| Claim | Useful artifact | What it does not establish |
| --- | --- | --- |
| A defect is found | Frozen faulty change, expected defect, report and adjudication | General recall across other codebases |
| A fix removes the defect | Faulty/fixed pair and a relevant failing/passing check | Absence of unrelated defects |
| Noise decreased | Consecutive or held-out sample, judgments and comparison | Quality if only previously selected wins were tested |
| The CLI installs | Packed tarball, temporary installation, commands and exit codes | Behavior on an untested OS |
| A loop converges | Round history, scope per round, unresolved findings and stop reason | Merge approval or a complete final full review |
| A provider costs less | Comparable task set, settings, usage and quality results | Invoice accuracy or the same saving for every repository |

## A minimal reproducible record

Keep the code revision and diff, task intent, review instructions and their source revision,
model/provider and runtime versions, effort, configuration, commands, outputs and exit codes.
Record reviewed and omitted scope, latency, usage, grading criteria, the human adjudication of
ambiguous cases and known limits. Use an isolated fixture where possible; redact credentials.

For a regression test, establish that it fails on the faulty implementation and passes on the
fix. Include valid cases that must stay valid. Snapshot tests capture selected output details;
review their diffs. They cannot decide whether a diagnosis is semantically correct.

For probabilistic evaluations, separate development examples from held-out examples and report
the number of trials and variation. Fix the rubric before comparing candidates, including how
to count duplicate findings, partial coverage and timeouts. Preserve failed runs instead of
excluding them after seeing the result.

## Practical entry points in this repository

- [Package install verification](../../scripts/verify-package.sh) exercises a packed installation
  without a real model call; [its tests](../../test/package-install.test.ts) check the script.
- [Precision guide](../precision.md) explains classifying findings.
- [Result formats](../formats/README.md) define structured outputs consumers can inspect.
- [Security limits](../../SECURITY.md) constrain claims that a test pass can support.

These engineering criteria are not a formal certification or compliance standard.
