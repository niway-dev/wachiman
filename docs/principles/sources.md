# Source register

Checked 2026-11-17. Summaries below distinguish a source's practice from a proposed application.
External articles are evidence of what their authors describe, not independent validation of
Wachiman. This collection is not endorsed by the referenced teams.

## S1 — Claude Code team's review process

Source: [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/),
Addy Osmani, Morgan Westlee Lunt and Qing Wang, 2026-10-15. Relevant sections: “The life of a
change”, “How we make the reviewer better”, and “How you can adopt this process”.

Their account combines early verification, independent review, checked findings, limited review
rounds, risk-sensitive human attention and recovery. They evaluate time saved with reverts and
incidents as counterchecks, and use past failures to improve evaluations.

Wachiman application: assess review usefulness, convergence and blind spots together. Our bounded
loop is one mechanism, not their complete integration and release system. Their reported results
must not appear as Wachiman results. No reduction in our incident rate is established here.

## S2 — Claude Code verification and context guidance

Source: [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices).
Relevant sections: keeping `CLAUDE.md` short, scoping rules and giving Claude a check to run.

The guide distinguishes instructions from enforceable checks and recommends scoped context and
observable verification. Wachiman application: keep review-specific knowledge focused and ask for
evidence that a check exercised the behavior. This does not grant the reviewer permission to run
arbitrary project commands; execution authority is a separate engine decision.

## S3 — Evaluation of agents

Source: [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents),
Anthropic Engineering, 2026-01-09. Relevant sections: evaluation structure, graders, and capability
versus regression evaluations.

The article distinguishes a transcript from the final outcome, treats repeated trials as useful
for variable model behavior, and combines programmatic, model and human grading as appropriate.
Wachiman application: preserve inputs and artifacts, assess findings against a defensible reference,
and report repeated-run variability. A model judging another model is not independent ground truth.

## S4 — Release safety beyond review

Source: [Canarying Releases](https://sre.google/workbook/canarying-releases/), Google SRE Workbook,
chapter 16, Alec Warner and Štěpán Davidovič with contributors.

This chapter explains evaluating limited rollouts before wider exposure. Wachiman application:
make the boundary of review explicit. A clean review cannot establish production behavior, and
an integration process still needs appropriate deployment observation and recovery. This is a
boundary principle, not a planned deployment controller in Wachiman.

## S5 — Executable examples from a public repository

Source: [Ruff contributor guide](https://github.com/astral-sh/ruff/blob/f4f75dd70e8cd1d53494859ed8b90197285fd4b6/CONTRIBUTING.md),
Astral, sections “Rule testing: fixtures and snapshots” and “The test plan”, pinned to commit
`f4f75dd70e8cd1d53494859ed8b90197285fd4b6` on the date above.

The guide describes examples with expected diagnostics and selective snapshots for diagnostic or
fix details. Wachiman application: test reviewer output contracts with explicit expectations;
inspect snapshot changes rather than treating an updated snapshot as proof of correctness.
Reproducing an experiment still requires recording its runtime, inputs and commands alongside
that revision. No source code or test fixtures were copied into this collection.

## Adding a source

Record title, author/team, URL (commit permalink for code), publication date when available,
date checked, relevant section, original observation, proposed application, limits and a falsifying
test. If it only adds an appealing phrase, it does not yet justify a product change.
