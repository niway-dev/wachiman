# Weak points of the two recommendations, judged against the repositories

- **Date:** 2026-11-12
- **Status:** design input. The attacker (gpt-6.1-sol, reasoning high) saw only the claims and
  the facts, not our reasoning. Each weak point is judged here; the real ones become failures the
  spec must protect against. The raw replies are kept outside the repository (working documents).
- **Related:** [decisions](decisions-2026-11-12.md), [synthesis](synthesis.md),
  [state of the art](state-of-the-art.md), [t3code pipeline](t3code/05-pipeline-and-test-signal-agent.md)

## Claim A — Wachiman test notes

Claim attacked: the engine computes cheap test signals from the diff (real-time waits, mock-call-only
asserts, existence-only asserts, trivial snapshots, duplicated case literals, removed tests in
risk paths, a bug fix with no test) and turns them into per-batch questions (the ADR 0016 pattern);
findings are Consider/Info under the existing `🧪 tests` topic (ADR 0003); a workflow input
`tests: default | added-only | off` selects the preset; a team's own policy in `.github/wachiman.md`
replaces the default rubric; validation is t3code's 10 eval cases plus the diffs that deleted the
4 later-restored tests.

| # | Weak point | Judgement | What we do |
| --- | --- | --- | --- |
| A1 | Ten cases from one TypeScript project cannot show precision across consumers; "must get a comment" lets an irrelevant comment pass | **Real** | The t3code cases become regression fixtures with an expected target and expected suggestion. Enabling a detector by default needs a held-out set (our repositories' PRs plus non-bench PRs of the five Martian repositories; the 50 bench PRs and their goldens stay untouched) and a precision threshold fixed before the run |
| A2 | A prose policy cannot reliably replace the rubric: the engine still injects its questions and the model sees both | **Real** — `docs/review-policy.md` already says prose rules are not verified | The preset is an engine input that decides which questions fire, and the engine drops `🧪 tests` findings itself when the preset says so. Team prose adds judgement criteria only; a `custom` preset turns the default questions off in code |
| A3 | Path keywords miss risky deletions in neutral files, and batching can split a deleted test from its replacement | **Real** | The engine builds a PR-wide index of added, removed and moved test cases before batching. Risk paths only rank; they do not define importance |
| A4 | "Bug fix with no test" needs a PR-intent signal the engine does not have | **Real** — ADR 0033 (claims from title and body) is proposed, not built | Deferred out of v1. Reopens when ADR 0033 lands |
| A5 | Syntax patterns flag legitimate tests (an adapter whose contract is the call; an integration test that must wait) | **Real** | Detectors ship one by one, each behind its own precision gate. A finding must name the concrete duplicate or the failure the test cannot catch |
| A6 | Cheap detection is not cheap review: questions cost on every batch and every push | **Real** — ADR 0016 already requires replay for every question | Cap test questions per review, deduplicate across pushes, measure cost with and without under the same budget |
| A7 | Preset semantics undefined (grown test that also deletes an assertion; does `off` drop all test findings?) | **Real** | The spec carries a behaviour matrix: new file, new case, grown case, removed case, moved case, production-only change, findings from other questions |

Handled: none fully. Not applicable: none.

## Claim B — cs-tack `test-map` skill

Claim attacked: stdlib scripts map and scan tests; a Haiku swarm classifies each test twice,
deletes only on agreement, third vote on splits; keep-guards veto; a report proposes
delete/merge/move; apply deletes by title with ast-grep and cleans test-only exports with knip;
before/after counts and wall time; deletions in their own PR with a fresh-context review.

| # | Weak point | Judgement | What we do |
| --- | --- | --- | --- |
| B1 | Keep-guards depend on the same classifier recognising the protection (t3code's 22 auth tests matched "timers") | **Real** — observed in [02](t3code/02-the-big-purge.md) | Guards run first, in code (paths, keywords, issue references, clock-in-auth) and from the failure list the hub convention already requires (`conventions/test-audits.md`). Uncertain ownership means keep |
| B2 | Two passes of the same model agree on the same mistake; the third vote never sees unanimous errors | **Real** | Agreement ranks candidates; it is not permission. The pilot audits a sample of unanimous deletions to measure precision. The second pass runs on a different worker to reduce correlation |
| B3 | A smell or a green suite does not prove the test adds nothing | **Real** | Candidates in risk areas need executable evidence (a named surviving owner test; mutation testing with Stryker or mutmut where available). A surviving mutant is a lead, not permission |
| B4 | Deleting by title removes the wrong case (duplicate titles, `describe.each`) | **Real** | Deletions use a manifest bound to commit, file, span, suite path and node hash. Ambiguous or stale matches are refused; parameterised blocks move as a group |
| B5 | Two tests each "redundant because of the other" both get deleted | **Real** | Every delete names a retained owner; the whole batch is checked for deleted owners and cycles before applying |
| B6 | ast-grep and knip break the stdlib-only script convention; knip hides test-only exports by default | **Real** — cs-tack ADR 0029 says scripts use the Python standard library plus `gh` | An ADR amends the convention for this skill's apply step. knip runs with `--production`; export removal ships in a separate PR from test deletion |
| B7 | Small prompts miss context; full context makes the swarm expensive | **Partly handled** — the global roster already requires a measured per-agent cost and a `/usage` check before a fan-out | A total budget is set before the swarm; the pilot is one package |
| B8 | Test count and summed time do not measure protection or CI wait; regrowth eats the savings | **Real** | Measure CI wall-clock and the slowest shard, not only summed time. Regrowth control is Wachiman's job (claim A): the two designs are halves of one loop |

Handled fully: none. Not applicable: none.

## What changed in the recommendation

- **Wachiman:** ship engine-enforced presets and a PR-wide test index first, then detectors one at a
  time behind precision gates; the bug-fix regression ask waits for ADR 0033.
- **test-map:** propose first, delete only with named evidence, in small manifest-bound batches;
  guards and the failure list run before any model. Apply tooling needs an ADR amending cs-tack
  ADR 0029.
