# Weak points of the fidelity grade

> **Working record, attack 2 of 2, 2026-11-11.** Behind the spec
> [PR Confidence, a review loop and a local store](2026-11-11-pr-confidence-review-loop-and-local-store-design.md).
> GPT-6.1 Sol at high reasoning effort was given only the claim and the facts it had to hold
> against, never the reasoning behind it, and was asked where the claim is weak. It attacked the second design: a grade for how faithful the diff is to what the pull request says.
> The reply below is unchanged. The first design and its attack are in [attack 1](2026-11-11-pr-confidence-weak-points-1-merge-readiness-grade.md).
> What was done with each weak point is in the spec, section 7.

<details>
<summary>Brief sent to the attacker</summary>

~~~text
Someone is confident in the claim below. Your job is to find where it is
weak. Do not balance it with its strengths and do not soften findings.
Do not edit, create or commit any file; reply with the document as your final message only. Keep it under 900 words.

Claim:
An AI code-review tool ("Wachiman") can grade every pull request for fidelity: how much proof there is that the diff does what the PR says and nothing else. The grade is computed by a pure engine function, never stated by the model. A: every claim taken from the PR title and body is marked confirmed by the model with a path and line that the engine checks exist; every changed region is assigned to a claim or is explained by a fixed rule (tests of a confirmed claim, lockfiles, generated files, formatting-only changes); no open finding. A plus sign is added per extra countable proof (CI tests passed; a second model call tried to refute each claim and failed). A-: as A, but with listed questions the engine could not settle. B: a claim is unconfirmed or a change is unexplained; the grade names where to look. C: the PR does not say what it changes, a claim is contradicted, or a blocker is open. A change touching a sensitive kind (auth, money, data migration, irreversible) is capped at B. During a trial the developer still reads every A-graded PR and records whether the grade was right; after 30 A-graded PRs with no serious miss, A becomes a sound basis for that developer to stop reading A-graded PRs. The grade is shown in a marker-delimited block in the PR description, rewritten on every review from the review body (which is the record) and stamped with the reviewed commit.

Facts it must hold against (verified or assumed):
- (verified, code) Today the engine only tells the model in the prompt that the PR title and body are the author's claim to verify. No output lists claims, their status, or which change serves which claim. The engine does not read CI results.
- (verified, code) Reviews run in batches of files; each batch is a separate model call that sees the PR metadata. A separate verifier call per PR exists and judges findings (supported / refuted / inconclusive); it is off by default.
- (verified, code) A risk map already exists: closed fact kinds (data-migration, irreversible, auth, money -> high; concurrency, public-contract, config-or-ci -> medium; dependency -> low) plus path rules; facts whose path or line do not exist are dropped; thresholds are uncalibrated and it has never run in a real workflow.
- (verified, benchmark notes) The reviewer's best F1 on a public code-review benchmark is about 48; an audit of 85 of its reported "false positives" found 40% real defects, 55% minor, 2% wrong.
- (verified, owner workflow) One developer is the only user. Coding agents write both the code and the PR title and body, under the developer's GitHub account, and routinely rewrite the whole PR body. The same developer directs those agents.
- (verified, repo docs) No hosted service, no queue, no server-side state. The tool runs as a GitHub Action with the default token and as a local CLI. It re-reviews on every push, incrementally, under a per-PR spend ceiling, and a run can stop before reviewing everything.
- (verified, measured) Baseline cost is about $0.48 per PR.
- (verified, GitHub docs) PR description edit history is capped at 100 revisions.
- (assumed) The developer judges trial PRs honestly and reads them fully.
- (assumed) PRs are small to medium (tens to a few hundred changed lines) and arrive at several per day.

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

## 1. Weak points, most serious first

“Known” below means supplied as verified; scenarios and likelihood judgments are inferences unless stated otherwise.

### 1. An A can certify an incomplete account of the change

**Break:** Fidelity to an agent-written description does not establish fidelity to the developer’s intent.

**Scenario:** An agent implements a requested cache change and accidentally changes expiration behavior. It writes “update cache behavior,” then maps both changes to that claim. The reviewer confirms the broad claim; every region is assigned; A follows despite an unintended regression.

**Likelihood:** Plausible and recurrent given the known workflow: agents write both code and descriptions. Frequency is unmeasured.

**Evidence:** Compare grades against developer-authored acceptance criteria fixed before implementation, including deliberately vague descriptions.

**Containment:** Require independently stated acceptance criteria and explicit exclusions. Broad claims must not qualify merely because they accommodate every change.

### 2. Existing coordinates do not prove a claim

**Break:** The pure engine computes a deterministic grade from fallible semantic judgments. Checking that cited lines exist validates coordinates, not entailment, completeness, or absence of side effects.

**Scenario:** “Retries preserve ordering” cites a real retry loop. The model confirms it while missing concurrent completion elsewhere. Tests exercise sequential execution. A second model repeats the same assumption.

**Likelihood:** Unknown. The supplied benchmark establishes fallibility, but its F1 cannot estimate the false-A rate.

**Evidence:** Seed plausible, correctly cited false confirmations and measure how often the complete grading process awards A.

**Containment:** Describe A as model-assessed evidence coverage. Permit unattended acceptance only for narrowly defined behaviors backed by executable checks or independently calibrated review.

### 3. Thirty clean PRs cannot justify stopping review

**Break:** The trial supplies insufficient evidence about serious misses.

**Scenario:** All 30 trial As are judged correctly. Even assuming independent, representative PRs and perfect human detection, zero misses leaves a one-sided 95% upper bound of approximately **9.5%** on the per-PR miss probability. Correlated PRs or changing models weaken the inference further.

**Likelihood:** The statistical insufficiency is certain; the actual miss rate is unknown. Honest, complete reading does not guarantee detecting every defect.

**Evidence:** Predefine “serious miss,” an acceptable rate, and confidence level; then collect representative outcomes and delayed defect discoveries.

**Containment:** Keep randomized human audits and reset calibration after material changes. Under the same ideal assumptions, demonstrating a rate below 1% requires approximately 299 clean observations, not 30.

### 4. Partial and incremental reviews can manufacture apparent completeness

**Break:** “Every changed region” requires a complete, current inventory across batches and pushes. That mechanism does not exist in the supplied current output.

**Scenario:** A push changes a caller and helper in separate batches. Each looks correct locally; their interaction fails. Alternatively, the spending ceiling stops the run before the helper is reviewed, while earlier confirmations remain available for grading.

**Likelihood:** Partial completion is explicitly possible; interaction failures and stale evidence are plausible but unmeasured.

**Evidence:** Test budget exhaustion, cross-batch contradictions, and pushes invalidating previously confirmed claims. Require an accounting of every region against the exact reviewed snapshot.

**Containment:** Fail closed on incomplete coverage. Revalidate dependent evidence after changes and perform a PR-wide consistency assessment before awarding A.

### 5. The sensitive-change cap depends on an unvalidated detector

**Break:** A guaranteed B cap cannot rest on uncalibrated model facts and path rules.

**Scenario:** A generic utility change alters monetary rounding. Its path does not look financial; the model omits the money fact or cites an invalid location. The fact is dropped, and the cap never activates.

**Likelihood:** Unknown; the risk map has never run in a real workflow. Dropping invalid facts creates a concrete route from detection failure to apparent safety.

**Evidence:** Measure recall on sensitive changes hidden in ordinary paths, including malformed citations.

**Containment:** Treat invalid risk evidence as unresolved. Require conservative ownership rules or human classification before sensitive changes become eligible for unattended acceptance.

### 6. Plus signs and the description block overstate evidence durability

**Break:** Neither extra proof nor the published record has the claimed reliability.

**Scenario:** CI passes tests unrelated to a claim; a refutation call shares the original model’s blind spot. The PR receives plus signs. Later, an agent rewrites the whole description and removes the block, or edits claims without changing the stamped commit.

**Likelihood:** Description rewrites are routine. Correlated model errors are plausible. CI evidence is currently unavailable to the engine, and the existing verifier judges findings rather than claims.

**Evidence:** Test metadata-only edits, concurrent description writes, claim-specific test coverage, and refuter independence.

**Containment:** Bind evidence to both commit and claim-text digest; invalidate on either changing. Preserve immutable review records and show separate evidence dimensions instead of additive plus signs.

## 2. Hidden assumptions the claim needs

- Claim extraction captures omissions, qualifications, and externally defined intent.
- Allowed exceptions cannot conceal behavioral changes in generated files, dependencies, or tests.
- “No open finding” means adequate investigation rather than depleted budget.
- Trial PRs represent future PRs, models, prompts, and dependency behavior.
- A- questions have defined severity; unresolved correctness questions cannot coexist with unattended acceptance.

## 3. Alternatives that beat the claim

- **Coverage report without a trust grade:** better immediately, while calibration and structured outputs are absent.
- **Narrow unattended acceptance rules:** better for mechanically verifiable changes with complete checks and conservative exclusions.
- **Risk-directed human review plus random audits:** better when semantic intent dominates and serious misses remain unmeasured.

## 4. What would change my mind

A frozen implementation must fail closed under incomplete runs, stale metadata, invalid evidence, and missed sensitive classifications; survive seeded semantic counterexamples; and demonstrate an independently audited false-A rate below a predefined acceptable threshold on representative future traffic. Thirty clean PRs do not establish that observation.
