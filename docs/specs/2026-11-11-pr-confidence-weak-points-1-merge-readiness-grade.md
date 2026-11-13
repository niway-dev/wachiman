> **Working record, attack 1 of 2, 2026-11-11.** Behind the spec
> [PR Confidence, a review loop and a local store](2026-11-11-pr-confidence-review-loop-and-local-store-design.md).
> GPT-6.1 Sol at high reasoning effort was given only the claim and the facts it had to hold
> against, never the reasoning behind it, and was asked where the claim is weak. It attacked the first design: a merge-readiness grade from A to C.
> The reply below is unchanged. That design was replaced: the grade became a measure of fidelity, attacked in [attack 2](2026-11-11-pr-confidence-weak-points-2-fidelity-grade.md).
> What was done with each weak point is in the spec, section 7.

<details>
<summary>Brief sent to the attacker</summary>

~~~text
Someone is confident in the claim below. Your job is to find where it is
weak. Do not balance it with its strengths and do not soften findings.
Do not edit, create or commit any file; reply with the document as your final message only.

Claim:
After every review of a pull request, an AI code-review tool ("Wachiman") can publish a merge-readiness grade as one of three letter tiers (A: a person needs to read nothing more; B: a person must look at up to three named places; C: a person must review the whole change), plus a fourth "cannot say" state. The grade is computed by a pure engine function, never stated by the model, from four inputs the review already produces: a path-and-fact risk level (low/medium/high), the open findings by severity, whether each finding passed a verifier, and review coverage. The tool writes the grade and the named places as a marker-delimited block inside the PR description (mirroring the review body, which stays the record), each named place as a markdown checkbox; the developer ticking the checkboxes is the "human check", and a no-model run triggered by the description edit recomputes and answers. With A restricted to "risk level low + no open finding + full coverage + verifier ran", grade A is trustworthy enough to skip human reading from the first day, without any calibration data, for a solo developer whose PRs are mostly written by coding agents.

Facts it must hold against (verified or assumed):
- (verified, repo docs) The tool runs as a GitHub Action with the default GITHUB_TOKEN, and also as a local CLI. No hosted service, no queue, no server-side state: both are explicit non-goals. State between runs lives in an HTML marker inside the posted review.
- (verified, ADR 0031) The risk level is `low|medium|high`, computed by a pure function from path rules plus "risk facts" of a closed kind list, each with path and line; facts whose path/line do not exist are dropped; the model never states a level; unreviewed files make the level a floor ("at least"). Thresholds are uncalibrated and the feature has never run against a real model or in a real workflow.
- (verified, ADR 0031 + README) Current documented promises: "The map is not a verdict: it approves nothing, blocks nothing and sets no check status" and "It never approves, requests changes or blocks a merge".
- (verified, ADR 0011/0012) The tool re-reviews on every push, incrementally, with a per-PR automatic spend ceiling (default $6); a run can stop at the ceiling or at a depth cap before reviewing everything.
- (verified, benchmark notes) On the Martian benchmark the reviewer's F1 is roughly 48 (best run), i.e. it misses a large share of known bugs; an audit of 85 of its "false positives" found 40% real defects, 55% minor, 2% wrong.
- (verified, ADR 0009) The engine reads the PR description as the author's claim to verify.
- (verified, GitHub docs) PR descriptions keep an edit history capped at 100 revisions (original + latest 99); users with write access can delete a revision's content. GitHub does not let a PR author approve their own PR.
- (verified, owner workflow) One developer is the only user. PRs are opened under the developer's own GitHub account by coding agents, which routinely rewrite the whole PR body (e.g. `gh pr edit --body`). Other bots (CodeRabbit) also review the same PRs and may write into the description.
- (verified, research) No published tool shows an outcome-calibrated LLM-stated percentage. Meta's Diff Risk Score is a model trained on incident history; Meta's auto-land system (RADAR) chains eligibility gates, rules, the score and an LLM review. Anthropic's internal process: a classifier sets a risk tier from the change; low tier needs no human once automated review is green; approval covers one specific commit.
- (assumed) The developer will tick checkboxes honestly and only after looking.
- (assumed) A `pull_request: edited` workflow event fires on a checkbox tick in the description and can run a job with no model call.

Write a Markdown document with these sections:
1. Weak points, most serious first. For each: what breaks, the concrete
   scenario (inputs, state, sequence) in which it breaks, how likely it is,
   the evidence that would confirm or rule it out, and one way to fix or
   contain it.
2. Hidden assumptions the claim needs to be true.
3. Alternatives that beat the claim, and under which conditions.
4. What would change your mind: the observation that would make the claim
   safe.
Mark what you know versus what you infer. Say so if you found nothing
serious; do not invent weak points to fill the list.
~~~

</details>

---

# Review: merge-readiness grades for Wachiman

**The claim fails at its central promise: the proposed inputs do not establish that an A-rated change is safe to merge without human reading.** A pure function makes the decision reproducible; it does not establish that the evidence supporting it is sufficient.

**Evidence labels:** **Known** means supplied as verified in the brief, or supported by the linked GitHub documentation. **Assumed** means explicitly assumed in the brief. **Inferred** identifies a consequence or hypothetical failure scenario. No repository implementation was inspected; scenarios below are counterexamples to the design claim, not reports of observed bugs.

## 1. Weak points, most serious first

### 1. A can certify a missed defect

**What breaks:** The rule treats “the reviewer found nothing” as sufficient evidence that a human need not read anything.

**Known:** The risk thresholds are uncalibrated. The feature has not run against a real model or workflow. The supplied benchmark demonstrates substantial detection limitations. F1 around 48 does **not** establish a particular recall rate or the defect rate among A-rated PRs.

**Concrete scenario — inferred:**

1. A small change touches a path classified as low risk.
2. It introduces a behavioral bug that the model neither reports as a finding nor represents as a risk fact.
3. Every changed file is processed, satisfying full coverage.
4. The verifier runs successfully but has no finding concerning that bug to verify.
5. Inputs are `low`, no open findings, full coverage, verifier ran.
6. The engine emits A, and the developer skips reading the defective change.

A verifier that checks reported findings cannot recover an unreported defect merely by running.

**Likelihood:** Credible and unquantified. Detection failures are established; their frequency inside the proposed A subset is unknown. That missing conditional rate is exactly what the safety claim needs.

**Evidence to confirm or rule out:** Independently adjudicate representative A candidates, including missed defects, downstream failures and serious near misses. Measure defects among A candidates rather than aggregate reviewer performance.

**Containment:** Launch A as an advisory eligibility result in shadow mode. Require human review until the eligible subset has evidence supporting an explicitly accepted residual risk.

### 2. Valid risk-fact coordinates do not establish low risk

**What breaks:** The risk engine can receive incomplete but structurally valid evidence and output low risk.

**Known:** Risk facts use a closed kind list. Nonexistent locations are dropped. Unreviewed files make the risk level a floor.

**Concrete scenario — inferred:**

A change in an ordinary helper alters tenant isolation through a caller elsewhere. The changed lines exist, but the model fails to identify the security implication, or the implication does not fit the fact taxonomy. Path rules do not elevate the file. All changed files were processed, so the unreviewed-file safeguard does not apply. The engine returns low risk.

Location validation proves that a cited line exists. It does not prove that all consequential facts were identified.

**Likelihood:** Plausible for cross-file behavior and unfamiliar code. Its frequency is unknown because the classification has not been evaluated in operation.

**Evidence to confirm or rule out:** Test risk classification against independently labeled historical changes, especially incidents in paths that appear routine. Measure consequential changes incorrectly classified low.

**Containment:** Start with a narrow eligibility allowlist backed by enforceable properties. Treat unsupported change kinds and unresolved behavioral dependencies as ineligible for A.

### 3. The four inputs cannot establish freshness or authorize human acknowledgment

**What breaks:** Identical grading inputs can describe both a current review and an obsolete review. The proposed function cannot distinguish them without additional context.

**Concrete scenario — inferred:**

1. Commit H1 receives A.
2. An agent pushes H2.
3. The new review is pending, fails, or stops at the spend ceiling.
4. The description still displays H1’s A.

A related sequence leaves three checked boxes from H1 in a rewritten description for H2. An honest developer checked the old change; nobody checked the new one.

Neither sequence requires dishonest checkbox use.

**Known:** Pushes trigger incremental reviews, and reviews can stop early. The proposed inputs do not explicitly include the reviewed head SHA, current head SHA, or acknowledgment identity.

**Likelihood:** Concurrent pushes and interrupted reviews are normal workflow conditions. Whether they produce false readiness depends on safeguards the claim does not specify.

**Evidence to confirm or rule out:** Exercise pushes during review, delayed completion, cancellation, failed publication and checkbox preservation across commits. Demonstrate that old results cannot be interpreted as readiness for the current head.

**Containment:** Bind review results and acknowledgments to the exact head SHA, review generation and checklist contents. Check currentness before publication and at the decision point. An old grade must remain visibly historical.

### 4. Full coverage is undefined for incremental review

**What breaks:** “All files reviewed” can be true while the current change has never been reviewed as a coherent whole.

**Known:** Wachiman reviews incrementally and can stop at a spend or depth limit.

**Concrete scenario — inferred:**

H1 changes a parser and receives review. H2 changes its caller, invalidating an assumption used during the parser review. The incremental run reviews the caller and retains the parser’s previous coverage. Every file now has a reviewed flag, but nobody examined the current interaction.

A second failure arises if processing a file counts as coverage despite truncation or incomplete analysis.

**Likelihood:** Plausible whenever coverage is accumulated across runs. It is not established that the implementation makes either mistake.

**Evidence to confirm or rule out:** A precise coverage definition and tests covering dependency changes, rebases, truncation, skipped files, depth limits and budget exhaustion. Show what invalidates previously earned coverage.

**Containment:** Track coverage against content versions and review assumptions. Use “cannot say” when completeness cannot be established. If reliable incremental invalidation is unavailable, require a complete final review before A eligibility.

### 5. The PR description is an unreliable acknowledgment and publication channel

**What breaks:** A marker-delimited block has no exclusive writer. Valid output can disappear, regress or acquire stale checkboxes through ordinary edits.

**Known:** Coding agents routinely replace the whole description. Other bots may write there. Description history is capped and revision content can be deleted. The posted review remains the intended record.

**Concrete scenario — inferred:**

An agent reads the body before Wachiman updates it. Wachiman publishes a new checklist. The developer checks one item. The agent then replaces the body using its older copy, restoring an earlier grade or checklist.

Markers identify a region; they do not prevent this lost update.

The review record may preserve what Wachiman published. It does not automatically preserve which checklist the human acknowledged.

**Likelihood:** Material in this owner’s stated workflow because full-body replacement already occurs. Collision frequency is unmeasured.

**Evidence to confirm or rule out:** Run interleaved edits by Wachiman, the developer and a body-rewriting agent. Check whether stale blocks are rejected, missing blocks become unknown, and acknowledgments remain associated with the correct review.

**Containment:** Keep authoritative grading state in the existing review record. Treat the description as a disposable projection. Record acknowledgments separately with their exact review and commit identity; never reconstruct authority solely from checkbox text.

### 6. B promises bounded human work without establishing bounded uncertainty

**What breaks:** At most three named places does not establish that those places contain everything a human needs to inspect.

**Concrete scenario — inferred:**

A PR has no findings but elevated risk from a behavioral change spanning several files. The engine selects three locations. The developer honestly inspects them and ticks the boxes. A consequential assumption remains in a fourth location.

Even one checkbox can conceal unbounded work: “verify all callers” names a place while requiring broad review.

**Known:** The proposed risk input is a level. A level alone does not identify the locations responsible for that risk. Findings supply locations only for detected findings.

**Likelihood:** Plausible for changes whose risk comes from interactions rather than isolated defects. The claim supplies no rule proving that three places suffice.

**Evidence to confirm or rule out:** Define how B locations are selected, what each inspection must establish, and how the engine detects dependencies outside those locations. Independently review B candidates for material omissions.

**Containment:** Reserve B for independently justified, bounded review tasks. Use C when required human judgment spreads beyond them. Completing B should record “requested inspections acknowledged”; it must not imply A’s stricter conditions became true.

### 7. Description edits can change the author’s claim without changing the code

**What breaks:** A no-model handler cannot generally revalidate a changed natural-language claim.

**Known:** Wachiman reads the PR description as the author’s claim to verify.

**Concrete scenario — inferred:**

Wachiman reviews a PR whose description says “changes display formatting.” An agent later rewrites it to claim “also preserves backward compatibility.” The same edit preserves checked boxes. A handler recomputes from existing risk, findings and coverage and republishes readiness without assessing the new claim.

There is also a feedback risk if Wachiman’s generated grade and checklist become part of the author claim on the next review.

**Likelihood:** Plausible because whole-body rewrites are routine. It depends on whether the implementation separates generated output from substantive author text.

**Evidence to confirm or rule out:** Tests distinguishing checkbox-only edits, generated-block edits and changes to substantive claims. Verify that generated output is excluded from the author-claim input.

**Containment:** Permit no-model acknowledgment only when the substantive author claim is unchanged. Invalidate claim verification after substantive edits and require review before restoring readiness.

### 8. The event assumption covers a human tick, not every state transition

**What breaks:** The workflow cannot rely on every description update triggering a follow-up run.

**Known:** GitHub documents that `pull_request: edited` events caused by the repository’s `GITHUB_TOKEN` do not create workflow runs. A human edit is a different case. [GitHub workflow-trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

**Concrete scenario — inferred:**

Wachiman writes or repairs its description block using `GITHUB_TOKEN`, expecting the resulting edit to invoke the acknowledgment/reconciliation handler. No run starts.

Conversely, an edit under a user credential may trigger the handler even when it was a coding agent rewriting the body rather than a human acknowledging an item.

**Likelihood:** The token-trigger suppression is deterministic where applicable. Whether it breaks this design depends on its event dependencies.

**Evidence to confirm or rule out:** A real workflow exercise covering human ticks, token-authenticated writes, agent edits and CLI publication. Verify which paths execute reconciliation directly.

**Containment:** Reconcile within the publishing run rather than depending on its own edit event. Explicitly configure human-edit handling, distinguish meaningful changes, and provide a CLI path that performs the same validation.

### 9. “Skip human reading” changes the product’s approval promise

**What breaks:** The proposed meaning contradicts the existing documented boundary.

**Known:** Current documentation says the map is not a verdict and approves nothing. A means a person needs to read nothing more.

**Concrete scenario — inferred:**

An A-rated PR introduces a defect. The developer skipped reading because that is the advertised meaning of A. The absence of a GitHub approval or blocking check does not change the fact that Wachiman supplied the decision to dispense with review.

**Likelihood:** Certain at the level of product semantics if A retains the claimed meaning.

**Evidence to confirm or rule out:** An explicit policy decision replacing the existing promise, defining what readiness covers and the residual risk the owner accepts. Renaming the grade does not resolve its behavioral meaning.

**Containment:** Keep the result advisory, or deliberately adopt and validate an approval policy. Do not present the existing non-verdict promise and the proposed A promise as compatible.

## 2. Hidden assumptions the claim needs to be true

- **A candidates have sufficiently few serious missed defects.** No supplied evidence establishes that conditional rate.
- **Reviewing every changed file captures consequential interactions.** File coverage alone does not establish this.
- **Low risk means low consequence even when the model omits facts.** Coordinate validation cannot establish completeness.
- **“Verifier ran” has meaningful semantics when there are zero findings.** Invocation alone supplies no negative evidence.
- **Verifier errors cannot erase real findings.** If verifier rejection removes findings, its false negatives could improve the grade incorrectly.
- **The grade is current for the exact merge candidate.** Freshness requires identity and lifecycle checks beyond the four summarized inputs.
- **Human acknowledgments survive edits without transferring to different work.** Honest checking does not prevent stale checkbox reuse.
- **An edit under the developer’s account identifies human action.** Coding agents use that same account.
- **Three inspections bound the remaining review obligation.** A numerical cap on locations does not establish this.
- **All non-A combinations have defined behavior.** High risk with no findings, verifier failure and partial coverage need explicit outcomes.
- **The solo developer’s accepted risk has been defined.** Being the only user does not establish that agent-written changes are safe to leave unread.
- **Industrial precedents transfer to this tool.** The supplied precedents include historical outcome training, eligibility gates or commit-specific approval. They do not validate these four inputs.

## 3. Alternatives that beat the claim, and under which conditions

| Alternative | When it beats the claim |
|---|---|
| **Shadow grading with independent human review** | At launch, when neither risk thresholds nor the A subset have outcome evidence. It measures the exact promise before relying on it. |
| **A narrow, enforceable no-human-review allowlist** | When eligible changes have mechanically checkable boundaries, such as constrained generated output. Eligibility need not depend on the reviewer successfully noticing every risk. |
| **Review routing without a readiness verdict** | When the immediate need is to direct attention. Wachiman can name useful inspection locations without claiming all remaining uncertainty is contained there. |
| **Commit-bound acknowledgments stored alongside the review record** | When agents and bots rewrite descriptions. This preserves the existing no-service architecture while making the description a projection rather than authority. |
| **A separate readiness policy combining current review, required checks and explicit eligibility gates** | When the owner actually wants to delegate merge decisions. Review summaries alone cannot establish all merge prerequisites. |
| **Full human review for agent-written behavioral changes** | While the proposed unattended subset remains unvalidated, particularly where consequences or dependencies are difficult to bound. |

## 4. What would change my mind: the observation that would make the claim safe

**The first-day, no-calibration promise cannot be established by observing that the engine follows its rules.** The disputed question is whether those rules admit consequential defects.

I would reconsider an operationally bounded version after observing:

1. **An explicit safety target:** the owner defines acceptable residual risk and excluded consequences.
2. **Representative shadow results:** independent review of A candidates demonstrates that serious missed defects fall within that target, with uncertainty reported.
3. **Validated eligibility:** low-risk classification and coverage hold against representative historical defects, cross-file changes and incremental-review invalidation.
4. **A verifier contract:** zero findings, verifier failure and verifier disagreement have defined, conservative meanings.
5. **Proven lifecycle behavior:** real workflow exercises show that pushes, canceled runs, body rewrites and reordered completions cannot transfer a grade or acknowledgment to another revision.
6. **Bounded B obligations:** independent review confirms that the named inspections actually contain the remaining human review task.
7. **An explicit replacement for the non-verdict promise:** documentation matches the authority the tool is asking the developer to delegate.

Until then, A establishes only that **the available review outputs satisfied a policy**. It does not establish that skipping human reading is safe.
