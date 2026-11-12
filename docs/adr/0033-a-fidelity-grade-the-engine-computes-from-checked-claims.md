# ADR 0033: Every pull request review carries a fidelity grade the engine computes from checked claims

- **Status:** proposed 2026-11-11. Not implemented. Amends
  [ADR 0031](0031-a-risk-map-whose-level-the-engine-computes-from-checked-facts.md): a grade now
  reads the risk map; the map itself stays "not a verdict". Reuses ADR 0031's rule (the model
  proposes facts, the engine decides), [ADR 0003](0003-two-axis-finding-labels.md) (severity) and
  [ADR 0030](0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  (result `/2`).
- **Date:** 2026-11-11
- **Spec:** [PR Confidence, a review loop and a local store](../specs/2026-11-11-pr-confidence-review-loop-and-local-store-design.md)
- **Issue:** #181
- **Numbering:** 0033 because `main` holds up to 0032 and open pull requests hold 0014, 0015,
  0017, 0018, 0021, 0022 and 0024 to 0026.

## Context

The owner wants each review to end with one answer: how much of this pull request still needs a
person. The risk map (ADR 0031) says where the risk is and stops there by design. Findings say
what is wrong, and their absence says nothing: a reviewer that missed a defect reports none.

Today the engine tells the model, in the prompt only, that the title and body are the author's
claim to verify (`src/engine.ts:1427-1429`). No output says which claim held, and nothing maps a
changed file to a claim.

The owner's goal, in their words: the grade should say how sure we are that the code is faithful
to the change the pull request proposes, with no side effects. A feature must be able to reach the
top grade; a grade reserved for documentation changes was rejected by the owner.

## Decision

1. Each pull request review produces **claims**: the statements in the title and body, each
   `confirmed`, `contradicted`, `unverified` or `vague`, with a path and line. The engine drops
   evidence whose line does not exist, which makes the claim `unverified`. A claim that names
   nothing checkable is `vague` and counts as no claim.
2. Each changed file is assigned to a claim, or explained by a fixed engine rule (lockfiles,
   generated files, formatting-only changes, tests of a confirmed claim), or reported as
   **unexplained**.
3. The grade is `cannot say`, C, B, A- or A, computed by a pure engine function from the claims,
   the unexplained files, the open findings, the risk map and the run's completeness. The model
   never states a grade. The rule table is in the spec, section 3. A plus is added to A for
   each extra proof the engine can count; the first one is the verifier trying to refute each
   claim and failing. Each proof stays a separate visible row, so a plus never hides which proof
   it stands for.
4. The grade **fails closed**: an incomplete run, unread files, or a new commit whose review has
   not finished give `cannot say`. Each review reads the current text as the claim and records its
   digest; if the text changes while the run is working, the run writes `cannot say`. Between
   reviews only the digest shows an edit.
5. A risk level of `high` caps the grade at B. Medium risk facts and dropped risk facts become
   listed questions, which give A- at most.
6. A pull request with no checkable claim gets C.
7. The review body is the record. The description holds a mirror between markers, rewritten by
   the reviewing run, stamped with the reviewed commit and a digest of the author's text. The
   engine strips its own block before reading the body as the author's claim. On every run of the
   review job, a step with no model call rewrites the block to `cannot say` for the commit under
   review, before the push wait.
8. The human check is a reply in a Wachiman thread at a place that needs attention, recorded
   against the commit. It never raises the grade; it is shown beside it.
9. Every A is marked "trial" while the owner judges A-graded pull requests. The block shows what A
   means: every claim has cited evidence and no change is unexplained. The count of judged pull
   requests and the miss rate it bounds are shown. Reading may become sampled; it never stops.
10. The feature is shown as "PR Confidence"; the result field is `fidelity`, in `/2` only.

## Alternatives rejected

- **A percentage.** No tool surveyed shows a model-stated percentage calibrated against outcomes;
  the one calibrated score found is trained on incident history. A number would claim precision
  nobody measured.
- **The model states the grade.** Not reproducible, and it breaks the rule ADR 0031 set.
- **A only for a safe list of change kinds** (documentation, tests, copy). Rejected by the owner:
  a feature could never reach A, so the grade would say nothing about most pull requests.
- **A grade from the absence of findings.** It certifies whatever the reviewer missed.
- **The description as the record, with checkboxes as the human check.** Agents rewrite whole
  pull request bodies, a tick can outlive the commit it was made on, and the edit history keeps
  100 revisions.
- **GitHub's Approve as the human check.** An author cannot approve their own pull request, and
  the owner's pull requests are opened under their own account.
- **Evidence rows with no letter.** Safer while nothing is calibrated, but the owner asked for one
  answer per pull request. The rows stay visible beside the letter.

## Consequences

- Review cost rises by the claims step. The ceiling is a spec open question and an acceptance
  criterion on the Martian run.
- The grade is only as good as the model's reading: a cited line can exist and not prove the
  claim. The block says so, and the trial exists because of it.
- An edit to the author's text with no push starts no review, so the block keeps its letter
  until the next push. The digest makes the mismatch detectable; nothing corrects it (spec, open
  question 8).
- The reset step lives in the workflows, not in the review: the reusable workflow (consumers
  get it by moving their pinned version) and the copy template (consumers update the file). A
  push that starts no review job resets nothing: a draft pull request, or `review_on_push: false`.
- When one agent writes both the code and the description, a claim can be written to fit the
  diff. Decision 1's `vague` status contains broad claims; it does not solve the problem.
- A clear pull request description becomes part of what Wachiman rewards.
- README "What it will not do" gains a sentence when this ships: the grade is information; it
  approves nothing and blocks nothing.
- The README statement that Wachiman never approves stays literally true.

## Non-goals

- Submitting an approval, setting a check status, or gating a merge.
- Judging code quality.
- A grade in `wachiman local`.

## Reopen if

- The owner's judgements show A wrong on a serious miss more often than the rate they accept.
- More than 60% of graded pull requests in 50 reviews land on the same letter: the scale does not
  separate them.
- The owner wants the linked issue's acceptance criteria to be the intent: that changes decision 1.
- The grade is to be published as a check run or to gate a merge: that is a new decision.
- The claims step breaks the cost ceiling on the Martian run.
- Plus signs are read as more proof than the rows behind them: drop them and keep the rows.
