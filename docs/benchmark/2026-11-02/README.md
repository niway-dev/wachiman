# Field run 2026-11-02: the kaipu-record "workspaces" chain (draft, analysis pending)

> **Status: draft.** This page collects the raw context of a real, unreplayed run while it is
> fresh. The cost/benefit analysis is not done yet: the [instructions](#how-to-analyse-this-run)
> at the end say how to do it. Numbers marked *approx.* come from a quick scrape of review bodies
> and must be re-counted before anything here is quoted.

## In one minute

- **What:** seven kaipu-record PRs that shipped one feature (several workspaces, NIW2-370) between
  2026-10-30 and 2026-11-02. They were written mostly by agents (Claude Opus 5.5 and Sonnet 5.5),
  and a human owner tested each part in the real app. Wachiman (v1.3.x, re-review on every push
  since kaipu-record#477) reviewed all of them. Pullfrog reviewed four, and CodeRabbit five.
- **Why it matters:** this is the largest live run so far. ~23,000 added lines, three
  data-integrity-heavy PRs (a file-move engine, a settings store with sync confirmation, and
  synced-folder safety), and a stacked chain where every push re-triggered three reviewers.
- **First impressions (to be checked):**
  - Wachiman posted the most findings at the lowest cost, and had no confirmed false positive.
  - **Its three misses are the point of this run.** On the two PRs that move or store user data,
    the **most severe** finding came from Pullfrog or CodeRabbit:
    - kaipu-record#479: the recovery step deleted an unverified source;
    - kaipu-record#482: an unreadable machine settings file was overwritten as empty;
    - kaipu-record#478: a deferred colour upgrade overwrote a rename made on another Mac.
  - Two shipped UI bugs were caught by **no bot**, only by the owner testing (see
    [misses](#bugs-no-reviewer-caught)).
  - Re-review on every push created a **review loop**. Agents fixed a round, pushed, got a new
    round of mostly-minor findings, and pushed again. Part 3 went through five rounds.

## The PRs

All are in [niway-dev/kaipu-record](https://github.com/niway-dev/kaipu-record), and all are
merged.

| PR | What | +/− lines, files | Reviewers present |
| --- | --- | --- | --- |
| [#439](https://github.com/niway-dev/kaipu-record/pull/439) | Sidecar read errors never mint a new asset id (data integrity) | +442/−27, 17 | Wachiman |
| [#449](https://github.com/niway-dev/kaipu-record/pull/449) | Workspaces part 1: registry, migration, switch transaction, switcher | +5338/−593, 92 | Wachiman |
| [#478](https://github.com/niway-dev/kaipu-record/pull/478) | Part 1b: New/Edit workspace, colours, "Change folder…" (relocate) | +3767/−97, 41 | Wachiman, Pullfrog, CodeRabbit |
| [#479](https://github.com/niway-dev/kaipu-record/pull/479) | Part 2: Move to (rename/link or copy+sha256+delete, journal, crash recovery) | +4473/−93, 65 | Wachiman, Pullfrog, CodeRabbit |
| [#482](https://github.com/niway-dev/kaipu-record/pull/482) | Part 3: per-workspace settings with inheritance and sync confirmation | +4518/−117, 47 | Wachiman, Pullfrog, CodeRabbit |
| [#483](https://github.com/niway-dev/kaipu-record/pull/483) | Part 4: per-workspace cloud, synced-folder safety (Drive/OneDrive/iCloud) | +5489/−157, 104 | Wachiman, CodeRabbit (Pullfrog did not run) |
| [#484](https://github.com/niway-dev/kaipu-record/pull/484) | Check-and-fix row: a near miss expanded the row instead of toggling | +54/−5, 3 | Wachiman |

## Raw counts (approx.)

These are top-level inline comments per bot, scraped on 2026-11-02, with replies excluded.
"Wachiman reviews" counts every review object it posted, including the per-push incremental
reviews and the "Looks addressed" follow-ups. "Cost" sums the `$` cells in the review bodies'
coverage tables. That can double-count or miss runs, so re-derive it from the workflow logs.

| PR | Wachiman findings (Fix / Consider) | Wachiman reviews | Wachiman cost (approx.) | Pullfrog inline | CodeRabbit inline |
| --- | --- | --- | --- | --- | --- |
| #439 | 2 (0 / 2) | 1 | $0.21 | — | — |
| #449 | 13 (2 / 11) | 1 | $1.50 | — | — |
| #478 | 16 (3 / 13) | 50 | $3.41 | 2 | 3 |
| #479 | 12 (6 / 6) | 21 | $2.32 | 1 | 5 |
| #482 | 10 (2 / 8) | 24 | $3.31 | 3 | 3 (+ more in review bodies) |
| #483 | 15 (3 / 12) | 16 | $3.49 | did not run | 2 |
| #484 | 2 (0 / 2) | 3 | $0.41 | — | — |
| **Total** | **70** | **116** | **≈ $14.65** | **6** | **13+** |

Pullfrog's cost is not in its comments; it is printed in each run's log (`pullfrog.yml`). The
earlier comparison (kaipu-record #463–#478, 16 PRs) measured **$37.81 for Pullfrog against
$7.83 for Wachiman** on the same PRs. CodeRabbit runs on its own service and is free on public
repositories. It skips PRs whose base is not `main`, so on a stack it reviewed only after an
`@coderabbitai review` request.

## Verdicts recorded by the fixing agents

Each fixing agent recorded a verdict per finding when it answered the thread, after checking it
against the code. They are first-hand but **unaudited**.

### #479: Move to

| Bot | Finding | Bot severity | Verdict |
| --- | --- | --- | --- |
| Wachiman | Healing empties all of `.kaipu/drag/` (could delete a drag in progress) | Fix | **Real, data** |
| Pullfrog | Healing deletes the source's user edits; journal dropped when `unlink` fails | Important | **Real, data loss**. Most severe of the PR |
| CodeRabbit | Healing deletes a different item that took the source's stem | Major | **Real, data loss** (same family) |
| Wachiman | Every group-move error reported as "stale" | Fix | Real |
| Wachiman | Enter/Space in the Move menu opens the item | Fix | Real |
| Wachiman | Spanish strings say "workspace" | Fix | Real (cosmetic) |
| Wachiman | `skipped` doc contradicts code | Fix | Minor |
| Wachiman | Stop before any move reads "Moved 0 items" | Fix | Real, minor |
| Wachiman | Failed post-commit heal reported as `io`; `mode` always "copied" | Consider | Real |
| Wachiman | Rejected device-id promise cached for the process | Consider | Real, minor |
| Wachiman | `ensureByName` mints tags past the cap | Consider | Real, minor |
| Wachiman | `orderForMove` reverses exports | Consider | Real, minor |
| Wachiman | IPC error shown as "stale" | Consider | Real, minor |
| Wachiman (round 2) | After a lost IPC reply, the `io` text says "original untouched" | Consider | Real, minor |
| CodeRabbit | Item id not validated (path traversal, not exploitable) | Minor | Hardening |
| CodeRabbit | Select-mode cards lack `aria-pressed` | Minor | Minor |
| CodeRabbit | Focus not managed in the portaled menu | Minor | Minor |
| CodeRabbit (round 2) | `chmod` tests fail on Windows/root | Minor | Minor |

### #482: per-workspace settings

| Bot | Count | Notable |
| --- | --- | --- |
| Wachiman | 10 | Hash recorded after the write leaves own overrides "pending" (medium); a pending file blocks clearing `uploadMode` (medium); three refresh/write race variants (minor) |
| Pullfrog | 3 | The capture-start refresh does not bound the availability probe (**medium**, real) |
| CodeRabbit | 7 | **An unreadable `workspace-settings.json` treated as empty and overwritten (major)**; **`copyToAll` proceeds from an unreadable source (major)**; two writes of the same workspace can interleave (medium); one declined |

20 findings in total, 19 fixed and 1 declined. No false positives.

### #483: cloud and synced folders

| Bot | Count | Notable |
| --- | --- | --- |
| Wachiman | 13 over three rounds | A failed `cloudState()` leaves "Loading…" forever (Fix); out-of-order answers show the previous workspace; the main process does not refuse an evicted source before a move reads it; the probe deadline was not a hard bound. Two migration-journal findings were **declined**: the files come from another open PR, kaipu-record#364. |
| CodeRabbit | 3 | **The evicted-file check during listing has no overall time limit (major)**; **the media protocol reused a cached "local" answer (major)** |
| Pullfrog | 0 | did not run |

The fixing agent also found, **without any reviewer**, that part 2's same-volume hard-link
move is unsafe inside Google Drive. Hard links there rename or unsync the cloud item, which is
the same mechanism as kaipu-record NIW2-577.

### #478: part 1b

- **CodeRabbit, Major:** the deferred "Default → brand colour" upgrade overwrote a rename or
  recolour made on another Mac. The agent reproduced it and fixed it. Pullfrog had flagged the
  same family earlier in the PR; Wachiman did not.
- **Wachiman, Fix:** the empty-folder refusal mentioned a "Move to" button that did not exist in
  this part. Also: "Change folder…" refused the moved folder of a `pendingInit` workspace. And
  picking the current folder showed "now points to the new folder".
- **Declined:** relocating the active workspace drops a pending quiet capture. That is by design,
  and the order is pinned by a test.

### #449: workspaces part 1 (Wachiman only)

13 findings: 2 Fix and 11 Consider. All 13 were addressed in one round. They include:
- the preload switching guard cleared by every broadcast;
- a cached video URL that could play another workspace's item;
- a gate rebind race during a probe;
- a 120 s wait when a window closes mid-switch;
- a registry write failure leaving in-memory state changed.

The owner's manual test found no bug Wachiman had missed on this PR.

## Bugs no reviewer caught

1. **Every workspace tile rendered grey, and every tag chip rendered rose** (kaipu-record#449,
   which merged; fixed in #478). Part 1 moved the tag palette into a global
   `[data-color="…"] { --tag: … }` stylesheet imported *before* each CSS module. `.tile` and
   `.chip` declared their own `--tag` default with equal specificity, so they won on source order
   and overrode every colour. The diff showed both files. No bot reasoned about cascade order,
   and the owner found it by looking at the app.
2. **A near miss on a checkbox expanded its row instead of toggling it** (Check-and-fix dialog,
   from kaipu-record#476; fixed in #484). The cause was `.row:focus-within { white-space: normal }`:
   the mousedown focused the box, the row reflowed taller, the box moved out from under the
   cursor, and the mouseup missed it. A reviewer would need to connect a focus style with a
   layout shift under the pointer.

Both are CSS interaction bugs that a unit test cannot see. Measure how often this category
appears before deciding whether Wachiman should look for it (cascade order, layout-shifting
focus/hover styles).

## Process observations

- **The review loop.**
  - With re-review on every push, a fix-and-push round produced a new round of mostly-minor
    findings. In #482 the agent went through five rounds (heads 75698b79 → 1fb4fd6c → d9accc88 →
    543053c4 → ad0fa5cc).
  - The orchestrator ended the loop by telling agents to make at most one fix-and-push round,
    then reply without pushing unless a finding was a data-loss bug.
  - **Question:** should Wachiman's incremental review lower its finding threshold, or cap
    Consider-level findings on re-reviews?
- **Stacked PRs.** CodeRabbit ignores non-`main` bases. Wachiman and Pullfrog reviewed stacked
  PRs normally. Retargeting after a lower merge produced conflicts that no reviewer comments on.
- **Agents cannot wait for checks.** The orchestration runtime forbids polling. Several agents
  stopped with "reviews pending", and the orchestrator had to start a new agent to answer the
  late threads. A review that arrives after the author agent stops costs a second agent run.
- **Severity labels.**
  - Wachiman's "Fix / Consider" matched the agents' verdicts well: no "Fix" was judged false.
  - Its two data-loss misses were not mislabelled findings. Wachiman never raised them at all.

## How to analyse this run

Do this in a fresh session. Give it this page and nothing else.

1. **Re-count every number above** from the GitHub API, for each PR and each bot. List the
   inline comments (`pulls/<n>/comments`, top-level only), the review bodies (`pulls/<n>/reviews`)
   and the issue comments (`issues/<n>/comments`).
   - Identify Wachiman by `github-actions[bot]` and the `<!-- wachi:finding -->` marker.
   - Identify Pullfrog by `pullfrog[bot]` and CodeRabbit by `coderabbitai[bot]`.
   - Keep findings that only appear in a review body; CodeRabbit and Pullfrog do this.
2. **Cost.**
   - Wachiman: read each run's cost from the workflow logs of `review / Agent review`
     (`gh run view --log`). Don't trust the review-body tables, which the scrape above may have
     double-counted. Split the full first review, incremental re-reviews and "Looks addressed"
     runs.
   - Pullfrog: read each run's log of `pullfrog.yml` for its cost table.
   - CodeRabbit: $0 on this public repository. Note its list price for private repositories.
3. **Verdict, per finding.** Classify each one as real bug (Medium+), minor, nit, or false
   positive, by reading the code at the PR head and the fix commit. Start from the agents'
   verdicts above, but audit at least every Medium+ one and every decline. Mark whether it was
   fixed, and whether another bot found the same issue.
4. **Benefit metrics.** Report these per bot:
   - real Medium+ bugs found;
   - data-loss bugs found;
   - unique real bugs (that no other bot found);
   - false positives;
   - cost per real Medium+ bug;
   - rounds triggered (pushes caused by its findings).
5. **Cost/benefit questions to answer:**
   - On data-moving PRs (#479, #482, #483), what would a second reviewer have caught that
     Wachiman did not, and at what cost? Is that a case for running a second engine only on
     PRs whose files match a data-path rule (`main/library/**`, `main/workspaces/**`)?
   - What did the per-push re-reviews cost, and how many real bugs did they find that the first
     review missed? Did that pay for the loop they caused?
   - Which Wachiman blind spot do the two misses and the three data-loss findings point to?
     Candidates: crash-recovery and cleanup paths that delete files; read-then-write races in a
     cache; CSS cascade and layout shifts. Can a prompt or a risk-ordering change target it, and
     how would we test it in the replay benchmark (`../replay`)?
   - Using the earlier figures ($37.81 against $7.83 on 15 PRs, and the 2026-11-01 replay),
     should kaipu-record keep Pullfrog at all, keep it only on data-path PRs, or replace it with
     a Wachiman Opus pass on those PRs?
6. **Write the result** as a "Results" section on this page, with a one-minute summary first.
   Then turn every recommendation that changes the engine into an issue or ADR in this
   repository. Kaipu-specific decisions (which bots kaipu-record keeps) go to kaipu-record's
   ADR 0028, not here.

## Sources

- The PRs above, their review threads and the fixing commits named in the threads.
- Earlier evidence: [2026-10-31 field benchmark](../2026-10-31/README.md),
  [2026-11-01 replay](../2026-11-01/README.md), and the
  [kaipu-record bug catalogue](../kaipu-record-bug-catalogue.md).
- The verdict tables come from the reports of the agents that answered the threads on
  2026-11-01/02. They are first-hand but unaudited.
