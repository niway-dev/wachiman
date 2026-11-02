# Review benchmark: Wachi, Pullfrog and CodeRabbit on kaipu-record's real bugs

- **Status:** proposed 2026-10-31. The bug catalogue exists; no benchmark repository has been
  created and no bug has been verified by hand yet. Side-by-side observations on live PRs are
  recorded under `<date>/` in [wachiman-benchmarks](https://github.com/niway-dev/wachiman-benchmarks).
- **Date:** 2026-10-31
- **Creates:** no ADR.
- **Refs:** #43; [bug catalogue](https://github.com/niway-dev/wachiman-benchmarks/blob/main/kaipu-record-bug-catalogue.md)

## In one minute

**Summary.** Replay the hardest real bugs of the public repository niway-dev/kaipu-record and
see which reviewer catches them. For each bug, find the pull request that introduced it, rebuild
that pull request on a repository whose history stops at its parent, and let each reviewer see
the exact diff a human reviewer saw. Three identical public repositories, one per provider, so
no bot reads another's comments. Clean control pull requests measure noise. A blind judge
scores every finding. The result feeds the blog post and video about why Wachi exists.

**Decisions.**

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | Replay the introducing PR at its parent commit, not reintroduce the bug into today's code | Today's code moved on; a reintroduced bug is synthetic and may not apply cleanly. The original diff is what a reviewer actually saw | none |
| 2 | Find introducing PRs with SZZ (blame the lines each fix removed, on the fix's parent). Treat SZZ output as candidates and verify each bug by hand before scoring | SZZ is the standard method (used by Greptile) but mislabels mixed PRs and refactors | none |
| 3 | Three identical public repositories, one per provider, history truncated at the parent commit | Removes the last-commenter advantage and hides the fix from `git log` | none |
| 4 | Add clean control PRs with no known bug | Without them the benchmark counts hits but not noise | none |
| 5 | Blind judging: findings exported without the bot's name and scored with the `Verdict:` convention | Vendor benchmarks disagree mostly through who counts hits and who judges | none |
| 6 | Same model for Wachi and Pullfrog. CodeRabbit's model is not selectable and is reported as is | Isolates the harness from the model | none |
| 7 | Pilot of 10 bugs from the top 15 before the full set, starting with small introducing PRs | Cheap check that the setup and the scoring hold | none |
| 8 | Score: known-bug recall, valid new findings, invalid findings (precision), cost and wall time per PR | A reviewer that finds the seeded bug and buries it in noise has not won | none |

**Open questions.**

1. Model for the run. Default: Claude Sonnet 5.5 for Wachi and Pullfrog; Opus 5.5 as a second
   pass on the pilot only if budget allows.
2. Organisation for the three repositories. Default: a separate account or organisation, so the
   apps' installs and learnings do not touch niway-dev.
3. CodeRabbit cost on public repositories. Not verified. Default: check before installing.

**Out of scope.** Private code. A public leaderboard. Tuning Wachi's prompt on the benchmark's
own bugs before the run.

## Known biases, declared up front

1. **Wachi has history on kaipu.** An earlier Wachi version reviewed kaipu from PR #301 on
   (missed 16 catalogued bugs, caught 1), and some prompt rules were tuned on those reviews.
   Most of the top 15 predate it ("did not run"), which limits the effect.
2. **Pullfrog has history on kaipu too.** Its runs seed a stored learnings file
   (`learnings seeded … (existing=yes)` in the #467 log). The benchmark repositories start
   fresh, which removes this for all three.
3. **Claude found most of the bugs.** The catalogue's finders are mostly Claude models (Fable,
   Opus, Sonnet). Selection may favour the two Claude-based reviewers over CodeRabbit. Reported
   as is.

## The catalogue

145 real bugs from about 90 fix PRs, mined read-only on 2026-10-30. By difficulty: 36 at level
5, 56 at level 4, 40 at level 3. Most common classes: state machines (33), ordering races (28),
data loss (16), cross-file contracts (15). Full table and per-bug details:
[kaipu-record-bug-catalogue.md](https://github.com/niway-dev/wachiman-benchmarks/blob/main/kaipu-record-bug-catalogue.md). Mining scripts and
the brief given to the mining agents: [mining/](https://github.com/niway-dev/wachiman-benchmarks/tree/main/mining/).

**Claude Fable** appears as finder, fixer and source:

- Its pre-tester audit found 46 confirmed bugs; 30 are in the catalogue, all fixed by Opus 4.8.
- In five cases a symptom was reported and Fable 5.1 found the cause and fixed it (#143, #414,
  #419, #423, #425). It is in the trailers of 10 fixes.
- Two of its own fixes introduced bugs: #143 caused REC-B8 (fixed in #416) and #255 caused the
  activation-policy cache bug (fixed in #366). Good cases: bugs a strong model let through.

**Top 15** (difficulty ≥ 4, introducing PR identified with medium or high confidence, ≤ 40
files, bug at least partly visible in its diff):

| Bug | Fix | Introduced | Class | Found by / fixed by | Prior reviewer |
| --- | --- | --- | --- | --- | --- |
| Spare overlay loses state before its listener | #418 | #402 | race | owner / Opus 5.5 | **missed** |
| Activation-policy cache skips restore | #366 | #255 | state | user / **Fable 5.1** | did not run |
| Auth IPC throw loses the error kind | #81 | #69 | cross-file | Opus 5 | did not run |
| `getSession` with a null body | #81 | #68 | state | Opus 5 | did not run |
| CSRF 403 from the origin | #79 | #68 | cross-file | Sonnet 5 | did not run |
| Bearer token exposed through the web proxy | #81 | #66 | security | Opus 5 | did not run |
| REC-B8: cursor tail cut uses a late wall clock | #416 | #143 | cross-file | Opus auditor / Opus 5.5 | did not run |
| Cursor tail cut floors the duration | #143 | #133 | data loss | **Fable 5.1** / **Fable 5.1** | did not run |
| A skipped required check reads green | #183 | #174 | CI | maintainer / Opus 5 | did not run |
| Ticket extend races read and release | #342 | #276 | race | Opus 5.5 | did not run |
| SHOT-B5: clearing a label deletes the wrong shape | #370 | #52 | race | Opus auditor / Sonnet 5.5 | did not run |
| SHOT-B1: save marks clean over a new edit | #360 | #18 | race | Opus auditor / Sonnet | did not run |
| "Exported" badge compares clocks | #159 | #156 | state | owner / Opus 5 | did not run |
| Label double-click broken by pointer capture | #187 | #184 | state | owner / Opus 5 | did not run |
| LIB-B12: drag-out copies the whole file | #412 | #269 | platform | Opus auditor / Opus 5.5 | did not run |

Catalogue limits: Linear tickets (NIW2-…) were not readable; fixes in #17–#25 are squash commits
split by hand; difficulty was judged by the mining agents; the app was not run. Some introducing
PRs are large (#402: 26 files, +1,820 lines).

## Field observations

Live PRs where Wachi and Pullfrog reviewed the same head are recorded outside the controlled
benchmark, one folder per day: [2026-10-31](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-10-31/README.md) (kaipu-record
#463–#467). They are not blind and have no seeded ground truth, but they show where the two
reviewers differ and feed the benchmark's cross-file class.

## Exhibition replay

A public, side-by-side demonstration on the PRs of the
[2026-10-31 field benchmark](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-10-31/README.md), run after the improvements it
ranks (contract check, peer call sites, focus-file memory, ADR path) ship in a Wachi release.

**Method.** For each PR, push two branches that point at the commits both reviewers saw: a base
branch at the original base commit and a head branch at the original head commit. No commit is
rewritten, so the diff is byte-identical to the one reviewed on 2026-10-31. Open a PR from head to
base titled `[replay] <original title>`, labelled `replay`, never merged and closed once both
reviews are in.

| PR | Base commit | Head commit | Files | Why it is in the replay |
| --- | --- | --- | --- | --- |
| #464 | `13b7ff5da65f3d0b59d0542132babf328ce373b3` | `e45c845143ba72f35fea4fac2f9d62a186dff986` | 31 | Precedent and contract in the same batch |
| #465 | `13b7ff5da65f3d0b59d0542132babf328ce373b3` | `dac8318b631e64780f65ce94b4aaa57261d7d63d` | 14 | Precedent outside the diff; smallest |
| #467 | `13b7ff5da65f3d0b59d0542132babf328ce373b3` | `b12d760bd90b1e9619bab115f500f9c1a30cccf3` | 47 | Background flow across main and renderer |
| #463 | `c58b68f437293377f0188e6c460ad782a313dbb1` | `3ec7a138c3a878b38284fd13c801ab7226a34abb` | 23 | Control: Wachi already caught a serious bug here |
| #466 | `13b7ff5da65f3d0b59d0542132babf328ce373b3` | `b2705a9ce2593b29ae50235312a4226955bbbb36` | 28 | Lifecycle (remount) |

Each base commit was checked to be an ancestor of its head, and the file counts match the
original reviews.

**Live and replay are complementary.** kaipu-record keeps both bots (and may add CodeRabbit)
as a live test: first reviews do not cross-contaminate. Replays need the benchmark repositories
because live PRs cannot be re-run at the same commit, Pullfrog's stored learnings for kaipu-record
already contain these bugs, second reviews do read each other's threads (#463), and the author's
fixes answer both bots at once.

**Where.** Three public repositories created on 2026-10-31, one per reviewer, each with the
ten `replay/pr-<n>/{base,head}` branches already pushed (script and files under
[`replay/` in wachiman-benchmarks](https://github.com/niway-dev/wachiman-benchmarks/tree/main/replay/)):
[kaipu-bench-wachi](https://github.com/niway-dev/kaipu-bench-wachi),
[kaipu-bench-pullfrog](https://github.com/niway-dev/kaipu-bench-pullfrog),
[kaipu-bench-coderabbit](https://github.com/niway-dev/kaipu-bench-coderabbit). Wachi runs on
demand (`/wachi review`) from a workflow on the default branch, because a `pull_request` event
would run the replayed commit's own `agent-review.yml` (v1.2.0); that one is disabled in the
repository once it has registered. The owner installs the Pullfrog and CodeRabbit apps on their
repositories; pull requests are opened only after that, so every reviewer sees each PR once, at
open. Still outstanding from the live runs: Pullfrog's stored learnings
for kaipu-record include what its runs learned on these PRs (its #464 run added three
sections), and kaipu's focus file will carry the new memory lines, so both reviewers come in with
priors. The exhibition reports that and makes no generalisation claim; the controlled benchmark,
in fresh repositories, is where claims are made.

**Score.** Same table as the field benchmark, plus one column per original Pullfrog-only bug:
did each reviewer find it. Several Wachi runs per PR, since one run can be lucky.

## Sources

- [Greptile benchmarks](https://www.greptile.com/benchmarks) (SZZ-style replay of real fixes)
- [Macroscope benchmark](https://macroscope.com/content/ai-code-review-benchmark-best-models)
- [Should we trust AI code review benchmarks?](https://dev.to/izgorodin/should-we-trust-ai-code-review-benchmarks-3p6n)
- [Tenki benchmark](https://tenki.cloud/benchmarks/code-reviewer) ·
  [Entelligence benchmark-maxxing](https://github.com/Entelligence-AI/benchmark-maxxing)
- Pullfrog and Wachi run logs: see the [field benchmark](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-10-31/README.md).
