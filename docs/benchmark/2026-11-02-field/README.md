# Field run 2026-11-02: the kaipu-record "workspaces" chain

- **Status:** analysed 2026-11-02. Every bot finding was re-counted from the GitHub API and checked
  against the code at the commit it was posted on, by five Claude Sonnet 5.5 subagents, reading
  only. Per-PR audits: [`prs/`](prs/). Raw API dumps: [`raw/`](raw/). One inventory per PR, with
  each thread and the fixing agent's reply: [`inventory/`](inventory/).
- **Not a replay.** These are the live reviews, at whatever engine version kaipu-record pinned at
  the time. Most were v1.3.0. The owner turned Pullfrog off at about 04:30 UTC on 2026-11-02, so
  it reviewed only the first pushes of #478, #479 and #482. See [Versions](#versions-the-current-engine-was-barely-tested).

## In one minute

- **What:** seven kaipu-record PRs that shipped one feature (several workspaces, NIW2-370) between
  2026-10-30 and 2026-11-02: about 24,000 added lines. Agents wrote most of the code and a human
  owner tested each part in the app. Wachiman reviewed all seven. Pullfrog reviewed three (#478,
  #479, #482) and CodeRabbit four (#478, #479, #482, #483).
- **Result on the three PRs all three bots reviewed** (#478, #479, #482; 11 distinct real bugs of
  severity Medium or higher, one of them High):

| | Wachiman | Pullfrog | CodeRabbit |
| --- | --- | --- | --- |
| Findings posted | 44 | 9 | 17 |
| Invalid findings | **0** | 0 | 0 |
| Real Medium+ bugs found (of 11) | 2 | 4 | **6** |
| The High bug (#479, roll-forward deletes an unverified source) | missed | found | found |
| Unique real Medium+ (no other bot found it) | 2 | 3 | **5** |
| Cost on the 7 heads both Wachiman and Pullfrog reviewed | **$4.31** | $8.83 | $0 (public repo) |
| Wachiman's 10 further runs, after Pullfrog was turned off | $4.72 | did not run | — |
| Total cost on these three PRs | $9.03 | $8.83 (stopped early) | $0 |

- **Across all seven PRs** Wachiman posted 76 findings: 70 valid, 6 partly valid, 0 invalid. Four
  were real Medium+ bugs, none High. It cost $14.66, and **49 % of that ($7.23) went to the
  per-push re-reviews**, which found one real Medium+ bug.
- **Reading:**
  - Wachiman stays the most precise and the broadest. It posted most of the Low findings that were
    fixed (tests, docs, error mapping, i18n).
  - On the PRs that move or store user data it found **2 of 11 real Medium+ bugs**, against 4 for
    Pullfrog and 6 for CodeRabbit. On #482 it found 0 of 5. In one case its summary approved the
    exact code that held the bug.
  - The per-push loop paid for itself for CodeRabbit, not for Wachiman. CodeRabbit found 4 of its
    real Medium+ bugs in re-reviews, at no charge. Wachiman found 1 in re-reviews, for $7.23.
  - **On the same commits, Wachiman cost half of Pullfrog: $4.31 against $8.83.** The totals look
    equal ($9.03 against $8.83) only because the owner turned Pullfrog off at about 04:30 UTC, and
    Wachiman then reviewed 10 more pushes ($4.72) that Pullfrog never saw.
  - The cost that did grow is the per-push loop: 19 re-reviews, half of Wachiman's bill. v1.4.0's
    re-reviews cost twice v1.3.0's ($0.57 against $0.27 on average).
- **What it means for Wachiman:** five blind spots, listed in
  [What to improve](#what-to-improve-in-wachiman), and one engine bug: incremental reviews
  re-review code merged in from the base branch.
- **Caveat:** only 8 of the 26 Wachiman runs used v1.4.0, the version kaipu-record pins now, and
  only one of them was a full review (#484, 59 changed lines). This run mostly measures v1.3.0. Whether v1.4.0
  closes these gaps needs a replay of these PRs. They make a held-out set, because none of their
  bugs was used to design v1.4.0.

## The PRs

All are in [niway-dev/kaipu-record](https://github.com/niway-dev/kaipu-record), and all are
merged.

| PR | What | +/− lines, files | Wachiman versions | Pullfrog | CodeRabbit |
| --- | --- | --- | --- | --- | --- |
| [#439](https://github.com/niway-dev/kaipu-record/pull/439) | Sidecar read errors never mint a new asset id | +442/−27, 17 | v1.2.0 (1 full) | — | — |
| [#449](https://github.com/niway-dev/kaipu-record/pull/449) | Part 1: registry, migration, switch transaction, switcher | +5338/−593, 92 | v1.2.0 (1 full) | — | — |
| [#478](https://github.com/niway-dev/kaipu-record/pull/478) | Part 1b: New/Edit workspace, colours, Change folder… | +3767/−97, 41 | v1.3.0 (1 full, 3 incr.), v1.4.0 (3 incr.) | 3 runs | yes |
| [#479](https://github.com/niway-dev/kaipu-record/pull/479) | Part 2: Move to (link or copy+sha256+delete, journal, crash recovery) | +4473/−93, 65 | v1.3.0 (1 full, 2 incr.), v1.4.0 (1 incr.) | 3 runs | yes |
| [#482](https://github.com/niway-dev/kaipu-record/pull/482) | Part 3: per-workspace settings, inheritance, sync confirmation | +4518/−117, 47 | v1.3.0 (1 full, 4 incr.), v1.4.0 (1 incr.) | 1 run | yes |
| [#483](https://github.com/niway-dev/kaipu-record/pull/483) | Part 4: per-workspace cloud, synced-folder safety | +5489/−157, 104 | v1.3.0 (1 full, 3 incr.), v1.4.0 (1 incr.) | did not run | yes |
| [#484](https://github.com/niway-dev/kaipu-record/pull/484) | Check-and-fix row: a near miss expanded the row | +54/−5, 3 | v1.4.0 (1 full, 1 incr.) | did not run | no review |

Every Wachiman run used Claude Opus 5.5. The version comes from each run's
`referenced_workflows` in the Actions API. kaipu-record moved to v1.3.0 on 2026-10-31 and to
v1.4.0 at 04:01 UTC on 2026-11-02, in the middle of this chain.

**#483 is not on `main`.** It was stacked on `feature/niw2-601-workspaces-part-3-settings` and
merged into that branch at 06:30:15, 21 seconds after #482 had merged that branch into `main`.
No later PR brings it over: `main...0253fd77` is 9 commits ahead. Part 4 has to be re-landed in
kaipu-record.

## Verified counts

Counts include findings written only in a review body (Wachiman's "Outside the diff" and "GitHub
refused them inline" lists, CodeRabbit's "Outside diff range" and follow-up sections, Pullfrog's
details blocks). The draft of this page counted 70 Wachiman findings from inline comments alone,
and 116 "reviews" that included the empty review objects GitHub creates for thread replies. Both
numbers are corrected here.

| PR | Wachiman posted (valid / partly) | Wachiman real Medium+ | Pullfrog posted / real Medium+ | CodeRabbit posted / real Medium+ | Distinct real Medium+, all sources |
| --- | --- | --- | --- | --- | --- |
| #439 | 2 (2 / 0) | 0 | — | — | 0 |
| #449 | 13 (13 / 0) | 1 | — | — | 1 + 1 CSS bug nobody caught |
| #478 | 17 (15 / 2) | 1 | 3 / 1 | 3 / 1 | 3 |
| #479 | 15 (14 / 1) | 1 | 3 / 2 | 5 / 1 | 3 (1 High) |
| #482 | 12 (12 / 0) | **0** | 3 / 1 | 9 / 4 | 5 |
| #483 | 15 (12 / 3) | 1 | did not run | 4 / 1 | 2 |
| #484 | 2 (2 / 0) | 0 | — | — | 0 |
| **Total** | **76 (70 / 6)** | **4** | **9 / 4** | **21 / 7** | **14** |

No bot posted an invalid finding in this run.

## Cost

Wachiman's cost is the sum of `cost_usd` over every Claude call in the 26 `review / Agent review`
runs: $14.66. The review footers sum to $14.64, so the footers are right. Pullfrog's is the usage
table at the end of each `pullfrog.yml` run (7 runs on these PRs). CodeRabbit does not bill public
repositories. On private ones it is $24–72 per developer per month
([pricing](https://www.coderabbit.ai/pricing), read 2026-11-01).

| PR | Wachiman full review | Wachiman re-reviews (count) | Wachiman total | Pullfrog (runs) |
| --- | --- | --- | --- | --- |
| #439 | $0.21 | — | $0.21 | — |
| #449 | $1.50 | — | $1.50 | — |
| #478 | $0.76 | $2.64 (6) | $3.40 | $2.91 (3) |
| #479 | $1.20 | $1.12 (3) | $2.32 | $3.66 (3) |
| #482 | $1.45 | $1.86 (5) | $3.31 | $2.26 (1) |
| #483 | $2.04 | $1.45 (4) | $3.49 | — |
| #484 | $0.25 | $0.16 (1) | $0.41 | — |
| **Total** | **$7.41** | **$7.23 (19)** | **$14.66** | **$8.83 (7)** |

**Same commits, same moment.** Pullfrog ran on 7 heads before it was turned off, and Wachiman
reviewed the same 7:

| Head | PR | Kind | Wachiman | Pullfrog |
| --- | --- | --- | --- | --- |
| `07a47af` | #478 | first review | $0.76 | $1.58 |
| `886d67f` | #478 | re-review | $0.20 | $0.68 |
| `7620879` | #478 | re-review | $0.17 | $0.65 |
| `aac7202` | #479 | first review | $1.20 | $2.00 |
| `670b1ba` | #479 | re-review | $0.34 | $1.02 |
| `02dbb2e` | #479 | re-review | $0.19 | $0.64 |
| `833ca60` | #482 | first review | $1.45 | $2.26 |
| **Total** | | | **$4.31** | **$8.83** |

Wachiman is 2.0 times cheaper per review on identical commits, and 3.3 times cheaper per
re-review ($0.23 against $0.75 on average; first reviews $3.41 against $5.84). The earlier comparison on kaipu-record #463–#478
measured 4.8 times ($7.83 against $37.81). Its other 10 runs ($4.72) came after Pullfrog was
turned off, so they have no Pullfrog counterpart.

**By engine version:**

| Version | Runs (full + re-reviews) | Cost | Cost per re-review | Findings posted | Real Medium+ |
| --- | --- | --- | --- | --- | --- |
| v1.2.0 | 2 + 0 | $1.71 | — | 15 | 1 |
| v1.3.0 | 4 + 12 | $8.66 | $0.27 | 44 | 2 |
| v1.4.0 | 1 + 7 | $4.27 | $0.57 | 17 | 1 |

v1.4.0's re-reviews cost twice v1.3.0's. Two causes are likely: v1.4.0 adds call-site evidence
and the flow questions to every batch (on the 2026-11-02 replay it cost 1.8 times v1.3.0), and
its re-reviews ran later in the chain, after merges of `main`. The single v1.4.0 full review
(#484, 59 lines) says nothing about v1.4.0 on a large PR.

- Wachiman's full reviews cost $0.31 per 1,000 added lines, in line with the 2026-11-01 replay
  ($0.35).
- The re-reviews doubled the bill. Several of them re-read code that came from `main` through a
  merge rather than code the author wrote (see [engine bug](#what-to-improve-in-wachiman)).

## The 14 real Medium+ bugs, by reviewer

"full" = the bot's first review; "re-k" = its k-th re-review after a push. An empty cell means the
bot ran and did not find it; "—" means it did not run on that PR.

| PR | Bug | Sev. | Wachiman | Pullfrog | CodeRabbit | Fixed |
| --- | --- | --- | --- | --- | --- | --- |
| #449 | A window that closes mid-switch leaves the switch waiting 120 s | Medium | full (v1.2.0, "Consider") | — | — | yes |
| #478 | The Default→brand-colour upgrade overwrites a rename made on another Mac (folder reachable) | Medium | | full | | `649c902` |
| #478 | The same upgrade, deferred while the folder is unplugged, overwrites the remote rename on reconnect. It survived the first fix | Medium | | | re-2 | `8a8f83e` |
| #478 | Change folder… refuses the moved folder of a `pendingInit` workspace | Medium | re-4 (v1.4.0, "Fix") | | | `85200ab3` |
| #479 | **Roll-forward healing deletes the source without checking it is still the moved item: the user's edits, or another item that took its name** | **High** | | full | full | `3639b994` |
| #479 | Roll-forward drops the journal even when `unlink` failed, leaving a bare duplicate under a new identity | Medium | | full | | `3639b994` |
| #479 | Enter/Space in the portaled Move-to menu opens the item instead of moving it | Medium | full ("Fix") | | | `7e503dfa` |
| #482 | The capture-start refresh does not bound the availability probe (hotkey lag) | Medium | | full | | `a0bcd775` |
| #482 | Two edits of the same workspace interleave and lose a key | Medium | | | full | `a0bcd775` |
| #482 | `copyToAll` from an unreadable source clears every other workspace's override | Medium | | | full (partly), re-2 | `d9accc88` |
| #482 | An unreadable (not missing) machine settings file is treated as empty and overwritten | Medium | | | re-2 | `d9accc88` |
| #482 | The capture-start refresh adopts a pending workspace's id without rebinding the gate, so saves are refused as stale | Medium | | | re-4 | **no, merged open** (by reading) |
| #483 | The assignment queue is not tied to an account, so another account's sign-in drops owed assignments | Medium | full ("Consider") | — | | `a47dea62` |
| #483 | The eviction probe of a Library listing has no overall deadline | Medium | | — | full | `77d67e59`, `4ed15804` |

Two severities differ from the draft. The auditors rated #482's "unreadable settings file" and
`copyToAll` Medium, not Major: they lose settings records, not media, and most lost values fall
back to a safe default. CodeRabbit's #478 "Major" is also Medium.

## Real bugs no bot found

| Where | Bug | Sev. | Found by | Status |
| --- | --- | --- | --- | --- |
| #479 (part 2) | A same-volume hard-link move inside Google Drive, OneDrive or iCloud renames or unsyncs the cloud item | High for synced users | the fixing agent, while writing #483 | fixed in `c36db614`, which is in #483 and **not on main** |
| #479 | A title or tag edit made in the source while a committed move waits is deleted by roll-forward. The High fix compares media and `.edit.json` only | Medium | the fixing agent, left as a follow-up | **open on main** |
| #479 | A running group move did not lock Change folder… | Medium | the author at merge time | fixed in `413ee15`. Wachiman's v1.4.0 review of that merge approved it |
| #449 | Every workspace tile rendered grey and every tag chip rose (CSS cascade order) | Medium | the owner, in the app | fixed in #478, `7620879e` |
| #476 (outside the list) | A near miss on a Check-and-fix checkbox expanded the row instead of toggling it (`:focus-within` reflow) | Medium | the owner, in the app | fixed in #484 |
| #439 | `remove()` deletes an item whose sidecar cannot be read, against the PR's own contract | Low | a later commit (`e44dfb52`) | fixed |

On the two CSS bugs:
- **#449:** Wachiman's batch 6 (risk 2, the lowest of six) said moving the palette to a global
  file "is safe, because both `tag-chip.tsx` and `workspace-switcher.tsx` import it". It checked
  that the palette reaches both components, not that the components' own CSS redeclares `--tag`.
  The `.chip` default was outside the diff hunk. Only `.tile` was visible in the diff, which
  corrects the draft's "the diff showed both files".
- **#476:** the `:focus-within` rule came in #476's last commit, `984e9963`. Wachiman had no run
  on that commit, so it never saw the rule. Pullfrog and CodeRabbit reviewed it and approved it.
  This one was a coverage gap, not a reasoning gap.

## Wachiman's misses, by cause

Ten real Medium+ bugs were found by another bot and not by Wachiman. The auditors traced each one
to the batch that covered the code:

| Bug | What Wachiman's summary said about that code | Likely cause |
| --- | --- | --- |
| #482 unreadable settings file overwritten | "the folder file and machine-store file reads and writes handle the missing and corrupt cases sensibly" | **A read error treated as empty, then written back.** It checked "missing" and "corrupt JSON", not "present but unreadable" |
| #479 roll-forward deletes an unverified source (High) | It flagged the `rm(.kaipu/drag)` line directly above the two unguarded deletes, and moved on. The batch scored risk 5, below the entry point's 8 | **A destructive step in a recovery path** that never re-checks what it deletes |
| #479 journal dropped when `unlink` fails | same block | the same: a cleanup step whose failure is swallowed |
| #482 `copyToAll` from an unreadable source | it accepted "today's UI never sends…" as the guard | trusted a UI gate to protect a destructive main-process step |
| #482 two edits interleave | "the service's validation and its scoped reads hold up"; it traced one call's order, never two at once | **concurrency between two in-flight calls** |
| #482 pending id adopted without rebinding the gate | nothing | cross-file and cross-PR side effect |
| #482 unbounded availability probe | it checked that the 2 s constant matches the ADR, not what the constant bounds | **an unbounded wait** behind a constant that looks like a bound |
| #483 eviction probe with no overall deadline | the batch "read correctly" | the same: unbounded wait |
| #478 brand-colour upgrade over a remote rename (×2) | its `649c902` summary described the write-back, then stopped at the one case the new test built | **cached state written back over another machine's change** |

## The review loop

Re-reviews on every push started with kaipu-record#477.

| | Wachiman | CodeRabbit | Pullfrog |
| --- | --- | --- | --- |
| Re-reviews on these PRs | 19 | 6, on request | 4 re-runs |
| Real Medium+ bugs found only in a re-review | 1 (#478 `pendingInit`, v1.4.0) | 4 (#478 deferred upgrade; #482 unreadable file, `copyToAll`, gate adoption) | 0 |
| Cost of the re-reviews | $7.23 | $0 | included above |

- Wachiman's re-reviews did catch real regressions introduced by the previous round's fix: on
  #483 three of them (the sweep placed by `link()`, a failed read after a switch, the "soft"
  probe deadline), and on #482 four Low race variants. That is the useful part of re-reviewing.
  Most of the rest was Low or Info.
- **Engine bug.** When the author merged `main` into the branch, the "changes since" diff included
  code that came from `main`. On #482 the first re-review (`75698b7`, "all 28 files") discussed
  part 2's healing, tag minting and Move-to menu. On #479, #482 and #483 the last v1.4.0
  re-reviews posted findings on part 1b's relocate code, which was already merged. That costs
  money and produces findings the PR author did not write.

## What to improve in Wachiman

Ranked by the real bugs each one would have reached in this run. These are proposals; none is
implemented.

1. **Destructive steps must re-verify their target.** For every `unlink`, `rm`, overwrite or
   "clear others" the diff adds, ask: what proves the thing deleted is still the thing we mean,
   and what happens when the delete fails? Recovery and cleanup paths first. Reaches: #479 High,
   #479 journal, #482 `copyToAll`, #439 `remove()`.
2. **A read error is not "empty".** Flag a `catch` that returns a default when the same value is
   later written back. Reaches: #482 unreadable settings file, and the `copyToAll` source.
3. **Two calls at once.** For a cache or store with async writes, ask what happens when two calls
   for the same key overlap, not only in what order one call runs. Reaches: #482 interleaving,
   and the race family Wachiman only found after CodeRabbit's fix.
4. **Every wait needs a total bound.** Ask what bounds a probe or loop overall, not only per call.
   Reaches: #482 probe, #483 eviction deadline. Wachiman caught the 120 s wait on #449, so the
   question works when it is asked.
5. **Cached state written back.** When a deferred write uses values read earlier, ask what happens
   if another machine changed them in between. Reaches: #478 ×2.
6. **Fix incremental reviews of merges from the base.** Diff the PR's own changes, `merge-base →
   head` against the previous `merge-base → head`, so code that arrives from `main` is not
   re-reviewed. Saves cost and noise.
7. **Risk ordering.** On #479 the recovery code scored risk 5 and the entry point 8. Code that
   deletes user files should rank at least as high as the code that calls it.
8. **Lower priority: CSS cascade.** Two of six bugs no bot found were CSS interaction bugs. One was
   a reasoning gap (#449, a redeclared custom property), one a coverage gap (#476, a commit with no
   run). A cheap check is to open the full module file when a diff moves a rule out of it.

Items 1–5 are flow questions of the kind v1.4.0 added in #70, applied to data paths. **Whether
v1.4.0 already asks them is not measured by this run**, because only one of its eight runs here
was a full review.

## Versions: the current engine was barely tested

| Version | Runs | Full reviews | Real Medium+ found |
| --- | --- | --- | --- |
| v1.2.0 | 2 | 2 (#439, #449) | 1 |
| v1.3.0 | 16 | 4 (#478, #479, #482, #483) | 2 |
| v1.4.0 | 8 | 1 (#484, 59 changed lines) | 1 (in a re-review) |

The [v1.4.0 replay](../2026-11-02/README.md) found 7.3 real Medium+ bugs per run on the five PRs
it was designed against. This run neither confirms nor refutes that: v1.4.0 never did a first
review of a data-path PR here.

**Next step proposed: replay these PRs on v1.4.0.** Use #478, #479, #482 and #483 at the head each
bot first reviewed, in kaipu-bench-wachi, three runs. The 14 bugs above become the expected set
with the author's fix as ground truth. They are held-out: none was known when v1.4.0 was designed.
The four PRs change about 18,700 lines. At the v1.4.0 replay's $0.63 per 1,000 changed lines, that
is about $12 per run and $35 for three. Not run yet.

## Limits

- **Live run, not controlled.** Bots reviewed different heads, CodeRabbit only when asked, and
  the owner turned Pullfrog off after its 04:26 UTC run on 2026-11-02. Comparisons of findings are
  made only on the three PRs where all three ran. Cost comparisons with Pullfrog use only the
  heads both reviewed.
- **The expected set leans on what the bots found.** A bug no bot and no person noticed is not in
  the table.
- **Verdicts come from reading code, not running the app.** The #482 gate-adoption bug, the only
  Medium+ that merged unfixed, is confirmed by trace only.
- **Not blind.** The auditors knew which bot wrote each finding.
- **Small numbers.** 11 Medium+ bugs on three PRs. One bug moves a bot's count by a lot.

## Method

1. `pulls/<n>/comments`, `pulls/<n>/reviews`, `issues/<n>/comments` and `pulls/<n>/commits` for
   each PR, saved in [`raw/`](raw/). Wachiman is `github-actions[bot]`, Pullfrog `pullfrog[bot]`,
   CodeRabbit `coderabbitai[bot]`.
2. Per-PR inventories ([`inventory/`](inventory/)) of every bot comment with its thread.
3. Five Claude Sonnet 5.5 subagents, one per large PR and one for #439, #449 and #484, checked every
   finding against the kaipu-record clone with `git show <sha>:<path>`. They used the fixing
   agent's replies as leads, not as proof, and audited every Medium+ finding and every decline in
   depth. Severity scale: High = data loss or silent failure of a core function; Medium = a
   user-visible bug or wrong state in a plausible flow; Low = edge case, hardening or test
   quality; Info = docs and naming.
4. Costs come from the Actions logs, as described in [Cost](#cost).

## Sources

- The PRs above, their review threads and the fixing commits named in [`prs/`](prs/).
- Earlier evidence: [2026-10-31 field benchmark](../2026-10-31/README.md),
  [2026-11-01 replay](../2026-11-01/README.md), [v1.4.0 replay](../2026-11-02/README.md),
  [results so far](../results.md) and the
  [kaipu-record bug catalogue](../kaipu-record-bug-catalogue.md).
