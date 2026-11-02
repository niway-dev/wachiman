# What the held-out benchmark missed, and the timing questions that would catch it

- **Date:** 2026-11-02.
- **Source data:** the held-out report in
  [niway-dev/wachiman-benchmarks, `2026-11-02-heldout/`](https://github.com/niway-dev/wachiman-benchmarks/tree/main/2026-11-02-heldout)
  (blind-judged; merged as wachiman-benchmarks #2). The per-bug explanation below was drafted by
  GPT-6 Astra from that report and checked against it.
- **Status:** analysis and proposals. Nothing here is implemented.

## Summary

| | |
| --- | --- |
| Result | Wachiman v1.4.0 (Opus, 3 runs) found **2 of 4** catalogued bugs (#255 in 3/3, #276 in 1/3). CodeRabbit (1 run) found **3 of 4** (#402, #255, #276). Nobody found #184. #269 carried no catalogued bug (catalogue error, since corrected to #286). |
| Precision | Wachiman posted 49 findings, 40 valid, **1 invalid** (its first in 50 reviews). CodeRabbit posted 12, 7 valid. Message quality 4.17 against 3.22. |
| The misses share a class | All three missed bugs are **ordering in time**: a message sent before its receiver exists (#402), a value that changes between the check and the act (#276), a pointer-capture target that does not survive the interaction (#184). |
| Current questions do not reach them | Run offline on the five held-out diffs, none of the five data-path questions merged in #88 ([ADR 0016](../adr/0016-data-path-questions-chosen-by-the-engine.md)) selects the batch that holds a missed bug. Details below. |
| Proposal | Three timing questions, each with an engine-side detector, measured with a hypothesis registered before the run. |
| Limits | 4 useful PRs, one CodeRabbit run, no Pullfrog, judged by reading. Neither reviewer has a proven lead. |

## The catalogued bugs

W1–W3 are Wachiman's runs; CR is CodeRabbit.

| PR | The bug, as the user sees it | Wachiman | CodeRabbit | Author's fix | Found by |
| --- | --- | --- | --- | --- | --- |
| #402 | A transparent window blocks every click because it lost its first state message | W1–W3: no | Yes, High: the `ready-to-show` send runs before the `useEffect` listener | `afd007df`: the window subscribes, then asks main to resend the state | CR |
| #255 | Kaipu disappears from the Dock and Cmd+Tab, and restoring it does nothing | W1–W3: yes, `Fix`. W2 names the exact cause (floating panel windows) | Yes, the stale cache, with a thin explanation | `72ab3e26`: probe `isVisible()` as well as the cache | Both |
| #276 | A concurrent renewal lets the reservation be released and the object deleted while an upload ticket is still valid | W1: yes, `Fix · security`; W2, W3: no | Yes, in both cancel and sweep | `8ded5c29`: the window check moves into the same `UPDATE` as `release()` | Both |
| #269 | Not in this PR | n/a | invents nothing | — | not scorable |
| #184 | Double-click no longer opens label editing | W1–W3: no | A different real defect (one-line hit box) | `347c09ae`: capture the pointer on the stable layer through `ref.current`, not on the `<tspan>` | Nobody |

## Everything else that was posted

Grouped by defect, duplicates merged. Severity is the blind judge's.

| Defect | Severity | Found by | Fixed later? |
| --- | --- | --- | --- |
| #402: the reused shade window never recovers from a renderer crash or failed load | **Medium** | W1, W2, W3, CR | not found |
| #402: cancelling the countdown leaves system audio off | **Medium** | W2 | unverified |
| #402: four weak tests (crash only destroys the window; defaults; same mode in query and state; "on begin" never calls `begin()`) | Low | W1, W2, W3 | mixed |
| #255: the `hide()` assertion also passes before the fix | Low | W1, W2, W3 | not found |
| #255: the doc states an unmeasured hypothesis as confirmed | Info | W1, W2, W3 | unverified |
| #276: ineligible rows spend the sweep's batch limit and delay deletes | Low–Medium | W1, W2, W3, CR | **yes, `8ded5c29`** |
| #276: documented duration ignores renewals; the spec mixes `<` and `<=`; a comment cites a removed flag | Low / Info | W1, W2, W3 | not found |
| #269: the doc describes pending features as done; packet reservation by average FPS forces a re-encode | Low | W1, W2, W3 | unverified |
| #184: the hit box does not cover multi-line labels | **Medium** | CR | **yes, `4a337db4`** |
| #184: the editor uses the tool's colour and size, not the label's; emptying a label keeps the old text | Low | W1, W2, W3 | not found |
| #184: Enter commits before IME composition ends | Low | CR | not found |
| **Invalid**, #402: "missing `setBackgroundThrottling(false)`" | — | W1 | false premise: `main/index.ts:260` already calls it |

## Why each miss happened, and the question that was missing

### #402: a message sent before its receiver exists

Main sends the shade state on `ready-to-show`. React may not have attached the listener yet, so the
message is dropped and the window stays empty, focused and on top of everything. All three
Wachiman runs spent their attention on the shade's crash recovery (a real, different bug) and its
tests.

The v1.4.0 flow question asks "what happens when the background work finishes"; it never reaches
"what if it finishes **too early**". Missing question:

> For each message, event or IPC send these lines add, where is its receiver registered, and can
> the send run before that registration? If it can, who delivers the message again (a request on
> subscribe, a replayed last value, a queue)? Cite the send and the registration.

**Detector (proposal):** an added send (`webContents.send`, `postMessage`, `emit`, `dispatchEvent`)
in a PR that also adds or changes a subscription (`ipcRenderer.on`, a preload `on*` bridge, a
subscribing `useEffect`), or a send tied to a lifecycle event (`ready-to-show`, `did-finish-load`,
`DOMContentLoaded`). On #402 both halves are in the added lines
(`recording-shade-window.ts` sends, `recording-shade.tsx` adds the `useEffect`).

### #276: the check and the act are separate steps

`cancelUpload` reads the revision, checks `ticketWindowClosed(revision.ticketExpiresAt, now)`, and
then calls `release()`. A renewal can move `ticketExpiresAt` between the read and the release, so
the release and the delete run while a valid ticket can still write the object. W1 found it; W2
and W3 did not, and no contract described the race.

Missing question:

> For each guard these lines add before a write (an `if` that returns early, a status or time
> check), what reads the value it tests, and what can change that value between the read and the
> write? Does the write itself re-check it (a conditional `UPDATE … WHERE`, a compare-and-set, a
> transaction), or does it trust the earlier read?

**Detector (proposal):** an added early-return guard whose condition reads a field of a record
fetched with `await` in the same function, followed by an awaited mutating call (`release`,
`update`, `save`, `delete*`, `set*`). On #276 the guard is added and the `release()` it protects is
unchanged code, which is why the current questions do not fire (see below).

### #184: the capture target does not survive the interaction

The PR splits label text into one `<tspan>` per line. The unchanged pointer handler captures the
pointer on `e.target`, which is now a `<tspan>` that re-renders when the selection changes, so the
second click of a double-click no longer reaches the handler. The bug lives in code the PR did not
touch, and jsdom does not implement pointer capture, so a test would not show it either.

Missing question:

> When these lines change the children of an element that handles pointer, drag or double-click
> events, which node receives the events and which node holds the capture? Does that node survive a
> re-render during the gesture, as it must for move and resize?

**Detector (proposal):** added child elements (`<tspan>`, list items, wrappers) inside a file whose
head contents call `setPointerCapture` or read `e.target` in a pointer or mouse handler. This needs
the head file, not only the added lines; the evidence pass already reads it.

## Why the current data-path questions do not fire

Run on 2026-11-02 with `selectQuestions` logic from `main` (`src/questions/index.ts`) over each
held-out diff (merge base to head), one file at a time:

| PR | Questions selected | On the bug's file? |
| --- | --- | --- |
| #402 | `bounded-wait` (on `recorder-store.ts`) | no: the bug is in `recording-shade-window.ts` and `recording-shade.tsx` |
| #255 | none | — |
| #276 | none | — |
| #269 | none | — |
| #184 | none | — |

Cause, per bug:

- **#276:** `destructive-step` matches only delete calls in the **added** lines. The added lines
  hold the guard; `release()` and the storage delete are unchanged, and `release` is not in its
  pattern. `overlapping-calls` does ask "a check made before an await: is it still true after it?",
  but its selector looks for an async read-await-write of shared state in the added lines, which
  this diff does not have.
- **#402 and #184:** no current question is about delivery order or event targets.

This is expected: the five questions came from the field run's misses (write paths, files,
caches). The held-out misses are a different class, which is the point of a held-out set.

## How to reproduce

1. **The replays.** Branches `replay/pr-<n>/{base,head}` at the SHAs in
   `replay/manifest-heldout-2026-11-02.tsv` (wachiman-benchmarks). `replay/bench.sh create|open|rounds|collect`
   sets up a bench repo, opens one PR per row, triggers repeat rounds on `head-r<k>` branches and
   collects the reviews. CodeRabbit needs `@coderabbitai review` on each PR because kaipu's
   `.coderabbit.yaml` at the head disables automatic review.
2. **The offline selection check** (free, no model): for each manifest row, take
   `git diff --unified=0 $(git merge-base base head) head` per file, keep the `+` lines, and call
   each question's `applies(lines, filename)`. This is how the table above was produced; a new
   detector must select the bug's batch on all three PRs before any paid run.
3. **The paid check:** the A/B harness in `2026-11-03-data-path-questions-ab/harness`
   (wachiman-benchmarks) runs arm A (main) and arm B (main plus the new questions) from the local
   terminal on the Claude Code subscription.

## Measurement plan

1. Implement the three detectors and questions behind the same registry as ADR 0016.
2. Firing check on the five held-out PRs (each must select the bug's batch) and on the exhibition
   set (firing rate on batches without the pattern, which is the cost).
3. **Register the hypothesis before running**, in wachiman-benchmarks: for example, #402 found in
   ≥ 2 of 3 runs, #276 in ≥ 2 of 3, #184 in ≥ 1 of 3, no more than one invalid finding per run, and
   cost per batch within 10 % of arm A. The numbers are a starting proposal, not a commitment.
4. Three runs per arm on the held-out PRs, blind-judged as in the held-out report.
5. Then **new held-out PRs**, because after this step these four are in-sample too.

## What this does not show

- Four PRs and one CodeRabbit run cannot rank the two reviewers. CodeRabbit's lead on #402 fits
  both "its code graph helps on cross-file ordering" and "the sample is too small".
- The detectors are proposals. Their false-positive rate is unknown until the firing check runs.
- Writing a question from a known miss and testing it on that same miss proves only that the tool
  can improve; generalisation needs PRs nobody used to write the question.
