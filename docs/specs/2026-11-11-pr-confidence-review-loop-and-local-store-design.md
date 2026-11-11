# PR Confidence, a review loop and a local store

- **Status:** proposed 2026-11-11. Nothing here is implemented. Written on Claude Fable 5.2.
- **Date:** 2026-11-11
- **Issue:** [#181](https://github.com/niway-dev/wachiman/issues/181)
- **Creates:** [ADR 0033](../adr/0033-a-fidelity-grade-the-engine-computes-from-checked-claims.md)
  (PR Confidence), [ADR 0034](../adr/0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md)
  (review loop), [ADR 0035](../adr/0035-a-rebuildable-sqlite-index-beside-the-run-files.md)
  (local index). **Numbering:** `main` holds up to 0032; open pull requests hold 0014, 0015, 0017,
  0018, 0021, 0022 and 0024 to 0026.
- **Amends:** ADR 0031 (a grade now reads the risk map; the map itself stays "not a verdict") and
  ADR 0020 (its first reopen condition is met by the loop).

## Summary (one minute)

Three slices, built in this order.

1. **Review loop.** `wachiman loop` runs one review round on the laptop, compares it with the
   round before and tells the caller whether to stop. A coding agent fixes between rounds. The
   CLI never edits code.
2. **PR Confidence.** After every pull request review the engine states how much proof there is
   that the diff does what the pull request says and nothing else. It is a letter the engine
   computes from checked evidence, shown in the pull request description and recorded in the
   review. It is not a code quality score and it approves nothing.
3. **Local store.** A SQLite index rebuilt from the history run files, and a local page that shows
   spend, findings, loop rounds and how the PR Confidence trial is going.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | `wachiman loop` runs one round per call: a local review, a comparison with the previous round, an outcome. The agent fixes between calls. The CLI never edits code | The agent keeps no books in prose; retries, finding tracking and the stop rule live in tested code. The README promise that Wachiman changes no code stays true | 0034 (new) |
| 2 | Result `/2` carries each finding's history id when history is on. The loop turns history on | The agent and the CLI need one name for a finding. Today the id is only printed in the stderr history block (`src/sinks/common.ts:215-229`) | 0034 |
| 3 | `loop` has its own exit codes: `0` converged, `10` findings still open, `11` stopped without converging, `2` usage. `local` keeps its codes | `local` exits `0` whenever a review ran (`src/local.ts:234-237`), so a caller cannot branch on it | 0034 |
| 4 | Round 1 reviews the whole range. Later rounds review the commits since the previous round's head, as an ordinary range. Earlier findings are carried by their history status | Meets ADR 0020's first reopen condition without skipping files by history, so the prompt stays the one GitHub mode uses | 0034, amends 0020 |
| 5 | The loop stays open while a 🔴 Blocker or 🟠 Fix (ADR 0003) is `new`, `open` or `not-repeated`, not refuted by the verifier and not judged `wrong` with a reason. A finding is released without a judgement only when its lines changed and the round that read that change did not report it again; the loop checks this itself for a `not-repeated` finding, because the history never looks again at a finding it has settled. 🟡 Consider and ⚪ Info are listed and never keep it open | A loop that chases every note never ends; the two top levels are the ones the author is expected to act on in this pull request | 0034 |
| 6 | Three rounds by default (`--max-rounds`). A review call that fails is retried once. Every stop prints its reason. A stop is never an approval | Other tools cap at 3 to 5 rounds and report that the first round carries most of the value (section 5) | 0034 |
| 7 | A `wachiman-loop` skill ships beside `skills/wachiman-review` | The loop is useless without telling the agent what to do between rounds | 0034 |
| 8 | Each pull request review lists the **claims** found in the title and body. Each is `confirmed`, `contradicted`, `unverified` or `vague`, with a path and line the engine checks | A grade built on "the reviewer found nothing" certifies whatever the reviewer missed. This asks for positive evidence | 0033 (new) |
| 9 | Each changed file is assigned to a claim, or explained by a fixed engine rule (lockfiles, generated files, formatting-only changes, tests of a confirmed claim), or reported as **unexplained** | "And nothing else" is the half of fidelity no finding expresses | 0033 |
| 10 | The grade is `cannot say`, C, B, A- or A, computed by a pure engine function. The model never states it. A plus is added per extra countable proof, from slice 2c on | Same rule as the risk map (ADR 0031): the model proposes facts, the engine decides | 0033 |
| 11 | The grade fails closed. An incomplete run, unread files, or a new commit whose review has not finished give `cannot say`. A change to the author's text is caught by the next review, which compares the digest; between reviews only the digest shows it. Dropped risk facts lower A to A- | An unknown must not read as safe | 0033 |
| 12 | A risk level of `high` caps the grade at B. Medium risk facts become listed questions | A faithful change to payments or auth still needs a person | 0033 |
| 13 | A pull request with no checkable claim gets C with the reason "the pull request does not say what it changes". A claim that names nothing checkable is `vague` and counts as no claim | Owner's rule. It also stops a broad claim from covering every change | 0033 |
| 14 | The review body is the record. The description holds a mirror between markers, rewritten on every review, stamped with the reviewed commit and a digest of the author's text. Wachiman strips its own block before reading the body as the author's claim. On every push, a step with no model call rewrites the block to `cannot say` for the new commit. In the shipped caller it runs before the push wait, so a run that is cancelled while waiting, fails or hits the ceiling leaves no old letter | Agents rewrite whole pull request bodies, so the description cannot be the record. The owner wants the grade at the top of the pull request | 0033 |
| 15 | The human check is a reply in a Wachiman thread opened at each place that needs attention, recorded against the commit | GitHub does not let an author approve their own pull request. Reuses the thread follow-up of ADR 0008 and ADR 0012 | 0033 |
| 16 | Every A is marked "trial" until the owner has judged A-graded pull requests. The count and the bound it supports are shown. After 30 judged with no serious miss the owner may move to sampled reading, never to none | 0 misses in 30 only bounds the miss rate below about 10% (section 6) | 0033 |
| 17 | The feature is shown as "PR Confidence". The result field is `fidelity` | Findings already carry a `confidence` field (`src/engine.ts:153-166`) | 0033 |
| 18 | A SQLite index is built from the history run files with Bun's built-in SQLite. The run files stay the record, no existing command depends on the index, and it can be rebuilt | ADR 0020 rejected an index that every command depends on. Bun's built-in SQLite adds no dependency (ADR 0002) | 0035 (new) |
| 19 | `wachiman dashboard` writes a static local page from the index. No server | Owner's request; ADR 0001 keeps "no hosted service" | 0035 |
| 20 | Product code stays TypeScript on Bun. Python is for tooling outside the product | Bun is the one runtime the npm package installs (ADR 0028) | reuses 0002 |

## Open questions

Each has a default that applies if the owner does not answer.

1. **Where are claims produced?** (a) One small call per pull request lists the claims from the
   title and body, then every batch reports which claim each of its files serves and the evidence
   for it. (b) Every batch lists claims on its own and the engine merges them. (c) The verifier
   call does it all. Against (a): one more call, and a claim that spans two batches is judged in
   pieces. **Default: (a)**, with a cost criterion below.
2. **What miss rate ends the trial?** The owner has not named one. **Default:** read every
   A-graded pull request until 30 are judged, then read one in three, chosen at random.
3. **Where is the owner's judgement of a grade recorded?** (a) A pull request comment that the
   dashboard reads from GitHub. (b) A local command. Against (a): it needs a comment convention.
   **Default: (a)**, because GitHub mode never writes the local history (ADR 0020 decision 1).
4. **Does the loop end with a full pass?** A converged loop has only reviewed fix commits since
   round 1. **Default: no**; the outcome says "converged on incremental rounds".
5. **File or hunk?** Assigning hunks to claims is finer and costs more output.
   **Default: file**, with lines when the model gives them.
6. **Dashboard form.** **Default:** one HTML file plus `--json`.
7. **Cost ceiling for claims.** **Default:** no more than 15% over the cost per pull request of
   the weekly Martian run before the change. The 15% is a proposal, not a measurement.
8. **What happens when the author's text is edited and nothing is pushed?** The callers run on
   `opened`, `ready_for_review` and `synchronize` only. (a) The digest in the block is the only
   protection until the next push. (b) The caller also runs on `edited`, with a step that makes
   no model call and sets the block to `cannot say`. Against (b): a workflow change in every
   consumer repository, and a run on every title or body edit. **Default: (a)** for the first
   version, stated in the block's footer.

## Out of scope

- Submitting an approval, requesting changes, blocking a merge, or any tie to branch protection.
- Publishing the grade as a GitHub check run. Noted for later: it would bind the grade to a commit
  natively and show it in the pull request list.
- A cross-repository list of pull requests waiting for the owner.
- CI results as a proof. The engine does not read checks today, and CI is usually still running
  when the review is posted. It needs a run with no model call when CI ends.
- The linked issue's acceptance criteria as the source of intent.
- PR Confidence in `wachiman local`. Local mode only reads commit subjects
  (`src/connectors/local-git.ts:461`), which is too little to grade.
- Per-rule check agents. ADR 0006 is not implemented.
- Anything for running agents on another machine.

## Failures this must protect against

These are risks, not past incidents. Sources: the two attacks in section 7.

- An A on a pull request whose defect the reviewer did not see.
- A broad claim ("update cache behaviour") that covers an unintended change, when the same agent
  wrote the code and the description.
- A claim marked confirmed with a line that exists but does not prove it.
- A grade from commit H1 shown after a push to H2 whose review failed, was cancelled or hit the
  spend ceiling.
- A run that stopped at the ceiling or depth cap and still produced a grade above `cannot say`.
- A sensitive change in an ordinary path whose risk fact was dropped, so the cap never applied.
- The description block removed or reverted by an agent rewriting the whole body.
- The author's text edited after the review while the block still shows the old grade (only
  partly covered: open question 8).
- Wachiman reading its own block as the author's claim on the next review.
- An agent answering the human-check thread with the owner's account.
- An agent marking findings `wrong` to make the loop converge.
- A loop that never ends, or one that reports "converged" after only reviewing fix commits.
- A corrupt or stale index that breaks `wachiman history`.

## Acceptance criteria

Loop (slice 1):

- [ ] `wachiman local --history --format json --result-version 2` prints an `id` on every finding,
      equal to the id `wachiman history --verdict` accepts.
- [ ] `wachiman loop --base <ref>` on a branch with a seeded 🔴 Blocker exits `10` and prints the
      open finding with its id.
- [ ] After a commit that fixes it, the next `wachiman loop` reviews only the new commits and exits `0`.
- [ ] With the finding left unfixed, the fourth call exits `11` with the reason `round cap`.
- [ ] A finding judged `wrong` with a reason no longer keeps the loop open and is listed in the outcome.
- [ ] A 🔴 Blocker at a line the fix commit did not change, in a file it did change, still keeps
      the loop open when the next round does not report it again (exit `10`, not `0`).
- [ ] The same finding is released when a later commit changes its lines and that round does not
      report it (exit `0`).
- [ ] A round whose review call fails twice exits `11` with the reason `review failed`.
- [ ] `bun test` covers the stop rule with no model call.

PR Confidence (slice 2):

- [ ] Result `/2` of a pull request review has a `fidelity` field with claims, unexplained files,
      the grade and its reasons. Result `/1` does not.
- [ ] A fixture with two confirmed claims and one file no claim explains gives B and names that file.
- [ ] The same fixture without that file gives A marked "trial".
- [ ] A fixture whose title and body name nothing checkable gives C with the stated reason.
- [ ] A fixture with a `money` risk fact gives at most B.
- [ ] A run stopped by the spend ceiling gives `cannot say`.
- [ ] The description block is written between markers, text outside them is byte-identical, and a
      second run replaces the block instead of adding one.
- [ ] A body that already holds the block yields the same claims as the body without it.
- [ ] A review run cancelled during the push wait leaves the block at `cannot say` for the new
      commit, with no letter from the previous commit.
- [ ] On the weekly Martian run, cost per pull request stays under the ceiling of open question 7
      and F1 stays inside the spread of earlier runs.

Local store (slice 3):

- [ ] Deleting the index and running `wachiman dashboard` rebuilds it and shows the same figures.
- [ ] `wachiman history` gives the same output with the index deleted or corrupt.
- [ ] `wachiman dashboard --json` reports spend per day and repository, findings by severity and
      verdict, and loop rounds, matching a fixture history.

---

## 1. Build order and what each slice needs

| Slice | Needs | Why this order |
| --- | --- | --- |
| 1. Loop | Finding id in `/2`; the `loop` subcommand; the skill | Nothing to calibrate; most pieces exist (history, verdicts, `--agent-prompt`) |
| 2a. Claims, unexplained files, grade, description block | A claims step; a new result field; a description writer | The evidence must exist before the letter means anything |
| 2b. Human check in threads | Thread follow-up running in a real workflow (ADR 0008 is not implemented; ADR 0012 has not run in one) | Depends on work not yet field-proven |
| 2c. Plus signs | The verifier judging claims, not only findings | Extra proof on top of 2a |
| 3. Index and dashboard | Loop rounds and grades recorded | Shows the trial count of decision 16 |

## 2. The loop

A round is one `wachiman loop` call. Loop state is kept per branch beside the history: the base,
the head of each round and the round number. `--base` starts a loop; a call with a loop already
open continues it.

What a round prints, in terminal and JSON form: the round number, the findings that keep the loop
open with their ids, the findings that no longer do and why (`probably-fixed`, `refuted`,
`judged wrong`), the notes that never count, and the outcome line.

Round 2 and later pass the previous round's head as the base, so the review is the same kind of
range review a developer can already ask for with `--base`. A finding from an earlier round whose
file the fix commits did not touch keeps its status: the agent did not change it, so it is still
open. The history also settles a finding as `not-repeated` when its file was reviewed, its lines
did not change and the run did not report it again (`src/history/match.ts:113-127`). A later
round only reads the fix commits, so an unfixed finding at an unchanged line is often not
reported again. The loop therefore counts `not-repeated` as still open: the agent either changes
those lines or judges the finding. The history does not re-settle a settled finding
(`src/history/match.ts:57,114`), so the loop makes this check on its own: a `not-repeated`
finding is released when a later round's range changes its lines and that round does not report
it. The history statuses of ADR 0020 are unchanged. "Fixed" stays inferred, as ADR 0020 says.

## 3. PR Confidence

### Grade rules

The first matching row wins.

| Grade | When |
| --- | --- |
| `cannot say` | The run did not finish, files were left unread, the review of a new commit has not finished, or the author's text no longer matches the digest the last review recorded |
| C | No checkable claim; or a claim is contradicted; or a 🔴 Blocker is open |
| B | A claim is unverified; or a file is unexplained; or a 🟠 Fix is open; or the risk level is `high` |
| A- | Questions remain: medium risk facts, dropped risk facts, "needs a person" places, or open 🟡 Consider findings |
| A | None of the above |

A plus is added to A per extra proof (slice 2c): the verifier tried to refute each claim and
could not. Every place that needs attention is listed, grouped by file, with no cap.

During the trial the block says what A means: every claim has cited evidence and no change is
unexplained. It does not say the pull request is safe to merge unread.

### The description block

```markdown
<!-- wachiman:confidence:start -->
## 👮 Wachiman · PR Confidence

> [!WARNING]
> ### B · One unexplained change
> Both claims verified. Look at `src/session.ts` line 40.

Reviewed at `abc1234` on 2026-11-11 · [full review](<review url>) · Your check: pending

| Evidence | Result |
| :--- | :--- |
| Claims verified | ✅ 2 / 2 |
| Unexplained changes | ⚠️ 1 |
| Refutation check | — Not performed |
| Sensitive paths | ✅ None |

**👀 Your attention**

- [`src/session.ts` L40](<permalink at abc1234>) — timeout changed; no claim in the pull request explains it.

<details>
<summary>✅ Verified claims (2/2)</summary>

- **Export button:** `src/Toolbar.tsx` L52–L78
- **Export function:** `src/export.ts` L10–L46

</details>

<sub>👮 Wachiman · measures whether the diff does what the pull request says, not code quality.</sub>
<!-- wachiman:confidence:end -->
```

Links use the reviewed commit, never `HEAD`. Not verified: whether GitHub renders a heading inside
an alert in a pull request description; check it on a real pull request before fixing the layout.

## 4. Local store

One SQLite file under the Wachiman home, filled by replaying the run files. A missing, old or
corrupt index is rebuilt; it is never the only copy of anything. The dashboard reads the index and
writes one HTML file. Spend on GitHub-side reviews is the subject of
[the usage dashboard spec](2026-10-31-usage-dashboard-design.md) (proposed, not implemented; only
its summary was read for this spec); merging the two views is left open.

## 5. What other tools do (research, 2026-11-11)

- Macroscope Approvability auto-approves low-risk pull requests behind gates and has a preview
  mode: <https://docs.macroscope.com/approvability>
- Macroscope CLI has an `autoloop` capped at five cycles:
  <https://macroscope.com/blog/introducing-macroscope-cli>
- Anthropic sets an approval tier from the change with a classifier, asks the author to reconsider
  after three rounds, and binds an approval to one commit:
  <https://claude.dev/blog/solving-code-review-at-anthropic/>
- Meta's Diff Risk Score is a model trained on incident history:
  <https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/>;
  its auto-land system chains gates, rules, the score and an LLM review: <https://arxiv.org/abs/2605.30208>
- Stated model confidence is partly calibrated at best: <https://arxiv.org/abs/2305.14975>,
  <https://arxiv.org/abs/2306.13063>. Neither paper tests code review.
- GitHub keeps at most 100 edits of a description:
  <https://docs.github.com/en/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment>
- CodeRabbit writes its summary into the description at a placeholder:
  <https://docs.coderabbit.ai/pr-reviews/summaries>
- Cursor Bugbot Autofix stops after three runs per pull request per day (a staff reply on the forum):
  <https://forum.cursor.com/t/bugbot-autofix-stopping-mid-pr/161079>

## 6. Why 30 is not enough to stop reading

With 0 serious misses in 30 judged pull requests, and assuming they are independent and the owner
catches every miss, the miss rate is below about 9.5% at 95% confidence. Showing a rate below 1%
needs about 299. The count restarts when the reviewer model or the prompt changes materially.

## 7. Weak points and what was done with each

Two attacks by GPT-6.1 Sol at high effort, kept unchanged and uncommitted in `.session/weak-points/`.

| Weak point | Answer |
| --- | --- |
| A can certify a missed defect | Decisions 8 and 9 ask for positive evidence; decision 16 keeps a person reading |
| Low risk from incomplete facts | Decisions 11 and 12; dropped facts lower the grade |
| A stale grade after a push | Decision 14: a step with no model call resets the block before the push wait. The shipped caller waits 180 s before any model call and a newer push cancels the run while it waits (`templates/caller-workflow.yml:115-119,137`), so the reset cannot live inside the review itself. Consumer repositories get it when they update their caller workflow; until then the commit stamp is the only signal. A push to a draft pull request starts no review job (`templates/caller-workflow.yml:129`), so there the old letter stays with its stamp |
| Incremental coverage | Decision 11; open question 4 for the loop |
| The description is an unreliable channel | Decision 14: it mirrors the review |
| Three places may not bound the work | No cap on the attention list; a human check never turns B into A |
| Description edits change the claim | Partly. The shipped callers start no run on a description edit (`templates/caller-workflow.yml:68`), so the old letter stays until the next push. The digest lets a reader or the next review detect it; nothing updates the block. Open question 8 |
| Events from the Actions token start no run | The block is written inside the reviewing run |
| "Skip reading" changes the product promise | Decision 16 and ADR 0033: the grade approves nothing |
| The same agent writes code and claims | Decision 13; reading the issue's criteria is out of scope and reopens ADR 0033 |
| Coordinates do not prove a claim | Accepted and stated in the block's wording |
| 30 clean pull requests | Decision 16 and section 6 |
| Plus signs overstate proof | Each proof stays a visible row; CI is out of scope |

## Sources and unverified claims

- Code references were collected by a read-only worker on `origin/main` at `fd99401`; spot-check
  them before building.
- The baseline cost of about $0.48 per pull request and the Martian F1 come from
  `wachiman-benchmarks` `martian/history.md`; not re-read for this spec.
- The verifier's default state differs between the CLI contract spec and later decisions; confirm
  it in code before slice 2c.
