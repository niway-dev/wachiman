# Open items after the field run and v1.5.0 (2026-11-03)

Working document: the checklist of what a session that started with the kaipu-record field run
(#87) left open. The PR that closes the last item deletes this file. **Do not merge this PR
until every item below is checked or explicitly dropped by the owner.**

## Where the session got to

- Shipped in v1.5.0: data-path questions (#88, ADR 0016), merge-only re-reviews send only the
  author's rows (#89, ADR 0011 amendment). kaipu-record is pinned to v1.5.0 (kaipu #488).
- Merged: the idea backlog (#94), the release-predictions skill (#96), v1.5.0 predictions
  (benchmarks #5, #7), docs pins (#98).
- Measured, not decided: re-review cost and model arms (benchmarks #8), blind audit by
  GPT-6.1 Sol (benchmarks #9 `plans/evidence/`), external references (hub
  csdev19/general-knowledge#91).

## Checklist

### 1. Haiku as proposer, a batched verifier — measure before deciding

- [ ] Owner confirms the decision rules in benchmarks #9 (`plans/haiku-as-default-reviewer.md`).
- [ ] Pick three held-out kaipu-record PRs opened after 2026-11-02.
- [ ] Pick the verifier model for the H→V arm: Sonnet 5.5 high or Opus 5.5 high.
- [ ] Decide whether to add a Haiku 5.5 medium arm (does the extra recall come from the model or
      from effort high?).
- [ ] Run the plan on the Claude Code subscription (stop guard $25), audit blind, write the report.
- [ ] Only then: decide the default model per role (first review, re-review, verifier) and write
      the ADR. Reconcile with #90 (spend tier, no model inputs) and #80 / ADR 0014 (cheap reader,
      expensive judge), which describe the same shape with Sonnet as the reader.

Known so far (not a conclusion): Haiku 5.5 high cost $0.07 per re-review against $0.50 for Opus,
posted about twice Opus's valid findings, and 5/17 and 2/13 invalid ones (Opus 0), mostly true
but pre-existing. It missed one Medium bug that Sonnet medium found. Batched verification is
estimated at $0.25–0.35 per re-review in total; one call per alarm would cost more than Opus alone.

### 2. Engine changes that follow from item 1

- [ ] Output scope rule: each finding names the line of this push that causes it, or it is
      dropped or listed separately. "Caused by a changed line", not "located on one" (#478,
      `registry.ts:821`). Do not cut the input context: that lost bugs.
- [ ] Free filters before any verifier call: cited line exists, traces to this push, not a
      duplicate of an open thread.
- [ ] Batched verifier call: the engine packs every alarm with its cited lines.

### 3. Re-review quiet window

- [ ] The owner agreed on a **15-minute** quiet window after the last push. #100 implements
      `push_debounce_seconds` with a default of **180 s**. Reconcile: change the default to 900,
      or keep 180 and set 900 in kaipu-record. The simulation found savings only from about 15
      minutes up. It does not block kaipu merges (the only required check is "Release candidate
      verified").

### 4. Open PRs to decide

- [ ] wachiman #99, lever T (send only the threads the push can change): saved 4 %, within noise,
      lost nothing.
- [ ] wachiman #100, cost per operation and push debounce (see item 3).
- [ ] wachiman-benchmarks #8, re-review cost study and model arms.
- [ ] wachiman-benchmarks #9, Haiku measurement plan.
- [ ] csdev19/general-knowledge #91, external references.
- [ ] wachiman #95, #90, #80, #76: design and research drafts the item 1 result reopens.

### 5. Release follow-ups

- [ ] Evaluate v1.5.0 against `releases/v1.5.0/PREDICTIONS.md` after five kaipu data PRs or on
      2026-11-17, whichever comes first.
- [ ] Register v1.6.0 predictions with the `registering-release-predictions` skill before the
      release PR.

### 6. Older items

- [ ] Bring kaipu-record #483 (workspaces part 4) to `main`; check the API migration's deploy
      order first.
- [ ] Blog post on the field run: waiting for the owner's hook, lesson and title.
- [ ] Docs that still say they describe v1.3.0: `costs.md`, `faq.md`, `reviews.md`,
      `review-policy.md`, `architecture.md`, `uninstall.md`.
- [ ] Model for the per-pattern tooling design docs (Opus 5.5 recommended; never answered).
- [ ] Fix the hub's broken link `conventions/verifiable-handoffs.md -> ./english-only.md`
      (pre-existing).
