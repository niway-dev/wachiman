## review by github-actions[bot] at 2026-11-02T03:43:34Z

👮 **Wachiman** · review of the whole pull request, at `dac8318`: all 14 files reviewed.

4 finding(s): 4 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡📝 **Consider · docs: "How it works" still names the old panel heading (confidence high)** (`apps/documentation/src/content/docs/backlog/prepare-screen.md:133`): The PR renames the heading to "Copies from this original" (`library.copiesHeading` in en.json and es.json). The bullet at lines 133-134 still says the new copy shows "under Copies from this master". The rewritten sections above and the manual-test paragraph at the end use the new name, so this is the one leftover.

### Summary

**Batch 1 of 2.** I found no blockers in this part. The removed `WhereIsThisGoingStrip` has no remaining references, and `sendTo` is still used by the video card and row. I raised two "consider" items, both unconfirmed against a running app:

- **Failed probe:** `DestinationsPanel` shows "…" on every non-archive card indefinitely when the source probe fails, because loading and error both give `probe: null`.
- **Drag test:** the drag test in `master-copies-panel.test.tsx` overwrites `window.electronAPI.startFileDrag` and never restores it. The sibling test in `export-status-cards.test.tsx` uses `vi.spyOn` with `mockRestore`.

I read all five files in this part in full. I did not read the CSS modules, the i18n files, the docs or the page test, which belong to the other part.

**Batch 2 of 2.** Part 2 (tests, CSS, docs, i18n) is mostly consistent with the code. The CSS tokens (`--tone-heavy`, `--tone-saving`, `--accent-green`, `--bg-input` and the rest) are defined. The i18n keys the page uses exist in both locales, and `sendTo` is still used by the Library card and row. The doc claims I could check match the code. I found two small items. `prepare-screen.md:133-134` still says \"Copies from this master\" (the heading is now \"Copies from this original\"). The \"file isn't read\" guard was dropped without a probe-not-called assertion for screenshots or GIFs. No blockers.

<details><summary>What the change connects to (9 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Drag handle on each ready copy row hands the copy's vault file to a native drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164`) — Dragging the button drags the real file, named after the copy's title, into another app. If it fails: If main fails (no poster, vault error) it only logs to the console and the drag silently does not start. This is the same as the existing sibling callers. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164-180`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:228-240`, `apps/kaipu-record/src/main/library/index.ts:161-174`, `apps/kaipu-record/src/preload/index.ts:87`.
- A destination card opens Export on that destination; "Not now" hides the panel (`apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:82`) — Navigation to `/prepare/:assetId?to=<destination>`. The size line comes from `planCopy` on the probe and from `formatMB(sizeBytes)` for the archive card. If it fails: A failed probe leaves the non-archive cards on "…" indefinitely (reported as a finding). Clicking still works. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41-56`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:78-92`, `apps/kaipu-record/src/renderer/src/features/prepare/prepare-path.ts:8-11`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489-505`.
- The detail page now probes the source file for every preparable recording, not only heavy ones or ones with the post-recording card (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — The resolution appears in the metadata line once the probe lands. The cards and copy rows fill in their sizes at that point. If it fails: If the probe rejects or is unusable, the state is "error" with a null probe. The metadata and copy rows fall back to file size only, and the destination cards stay on "…" (reported). Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`, `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:104-114`.
- "Saved to your Library" notice over the player of a fresh recording (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394`) — A green notice shows until ✕. The master note below the title is hidden while the notice is up. If it fails: The notice can reappear after Back, which is the same limitation as the existing card. Nothing is lost. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-137`, `apps/kaipu-record/src/renderer/src/shell/app-root.tsx:72`.
- "Export a copy" button and "Open in Export →" open Prepare with nothing preselected (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436`) — The router moves to the Prepare screen. The tests assert pathname `/prepare/asset-b` and an empty search. If it fails: Pure client-side navigation, with no async call and no failure path. `preparePath` encodes the assetId. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436-441`, `apps/kaipu-record/src/renderer/src/features/prepare/prepare-path.ts:8-11`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:292-306`.
- DestinationsPanel card click and "Not now" dismissal (`apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:78`) — The panel is replaced by the "Export a copy" button. Size labels show "…" until the probe resolves, or permanently if the probe errors, because `useSourceProbe` then returns `probe: null` and the panel only has the null case. If it fails: If `probeSource` fails, `useSourceProbe` returns status "error" with probe null. The non-archive cards keep showing "…" and the Light estimate in the heavy note stays on the no-estimate text. Navigat… Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41-56`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:73-95`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489-504`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`.
- Drag handle on a copy row starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164`) — A native OS drag of the copy's file begins. There is no in-page feedback. If it fails: It is `ipcRenderer.send`, fire and forget, so a rejection or an unknown id in main is silent in the renderer. That is the same as the two existing callers. The button renders only when `copy.id !== n… Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164-180`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:235`, `apps/kaipu-record/src/renderer/src/features/library/components/gif-viewer.tsx:27`, `apps/kaipu-record/src/preload/index.ts:87`, `apps/kaipu-record/src/main/library/index.ts:161`.
- The page now probes the file for every local recording, not only a heavy one (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — The resolution appears in the meta line after the probe resolves. The cards read "…" until then. If it fails: On probe error the hook stays idle for the dependent UI and nothing is surfaced. The meta line simply omits the resolution. The hook's effect is cancelled through an `alive` flag on unmount or when t… Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:282-289`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:47-66`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:757-771`.
- "Saved to your Library" notice shown when the page opens with `fromRecording` in the location state (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:137`) — A green `role=status` notice replaces the standing master note until ✕ is clicked. The test covers the dismiss. If it fails: No async or IPC work, so no failure path. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-137`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341-346`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394-412`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:868-881`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 5 | 852 | 4 | reviewed | 23 | $0.30 |
| Batch 2 of 2 | 9 | 763 | 2 | reviewed | 21 | $0.31 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.61</sub>

<!-- wachi:review -->

<!-- agent-review sha=dac8318b631e64780f65ce94b4aaa57261d7d63d -->

<!-- wachi:attempt id=1144373f-5eb2-4b80-bb67-98a11c5c5df2 -->

