## review by github-actions[bot] at 2026-11-02T03:45:04Z

👮 **Wachiman** · review of the whole pull request, at `dac8318`: all 14 files reviewed.

6 finding(s): 6 to consider; 6 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** I read all five files in this part and found no blocker. I'd raise three smaller points. When a copy's export finishes, the page can briefly show "Where is it going?" again, because `running` clears before the library re-lists (library-detail-page.tsx:189). The drag test overwrites `window.electronAPI.startFileDrag` and never restores it. The GitHub row's size assertion is loose and doesn't check its picture size. Both the new drag handle and the destination cards behave like the existing paths they replace. The page now reads the source probe for every recording page, not only heavy or fresh ones. That is intended, and nothing breaks if the read fails.

**Batch 2 of 2.** Part 2 holds the page test, the stylesheets, the docs and the i18n messages. I found no defects that would block the merge. The CSS tokens all exist in `packages/tokens/css/tokens.css` and `base.css`, and the en and es keys match one-for-one. The six-destination claim in the docs matches `DESTINATION_IDS`; the PR body's \"seven\" is wrong, but it is not repo content. The doc's account of the page matches the page code. I made three \"consider\" findings. The UI says \"Export a copy\" but the screen it opens says \"Prepare for…\". The new always-on file probe has no test for an unreadable file, which would leave the cards on \"…\". And nothing tests a heavy master that already has copies. I ran nothing, and I did not read `probeSource`, the main-process `startFileDrag` handler or the `master-copies-panel` test, so those parts of the contracts are marked open."

<details><summary>What the change connects to (6 closed, 2 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Read the file for every local recording (new `useSourceProbe` call for non-heavy items) (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — What does `probeSource` do when the file can't be demuxed or the promise rejects? The `.then` in the hook has no `.catch`, so a rejection would leave the state stuck on "loading". Files that would answer it: `apps/kaipu-record/src/renderer/src/features/video-editor/export/probe-source.ts`.
- Drag a copy's row out of the page to start a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164`) — Does the `startFileDrag` handler in main check that the sender is the app window and that the id is a vault item, and does it ignore a missing file quietly? This is a pre-existing handler, and the diff does not widen the preload API. Files that would answer it: `apps/kaipu-record/src/main/library/index.ts`.

**Closed, with the lines they rest on**
- Destination card click opens Export on that destination (`apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:82`) — Navigates to `preparePath(assetId, destination)`. The panel shows per-destination size estimates from `planCopy` once the probe is ready, and "…" before that. If it fails: If the probe never resolves or is unusable, `useSourceProbe` reports error with `probe: null`. Cards then show "…" forever but stay clickable. Prepare re-probes on its own page. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41-56`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489-505`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`.
- Drag handle on a copy row starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171`) — Main starts an OS drag of the vault file under the copy's title. The browser's own drag is cancelled by `preventDefault`. If it fails: `startFileDrag` is a fire-and-forget `ipcRenderer.send`. A main-side failure is silent, the same as the existing status card path. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:231-236`, `apps/kaipu-record/src/preload/index.ts:87`, `apps/kaipu-record/src/main/library/index.ts:161`, `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164-180`.
- The source probe is now always read for any preparable recording page (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — The dimensions item and sizes appear after the probe resolves. No dimensions item shows if the probe fails. If it fails: Probe failure leaves `probe: null`. The UI degrades to file size only, and the failure is not reported to the user. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:282-289`.
- "Saved to your Library" notice shown for fromRecording navigations (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394`) — The notice may reappear on Back to the page. The master note is hidden while the notice shows. If it fails: Cosmetic only. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-137`, `apps/kaipu-record/src/renderer/src/shell/app-root.tsx:72`.
- Click a destination card in "Where is it going?" to open Prepare on that destination (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489`) — The router moves to `/prepare/:assetId?to=<id>` and Prepare opens with that destination selected. If it fails: No async call is involved, so there is no failure path of its own. If the file can't be read, Prepare itself shows its toast (`prepare-screen.md` says so). The `?to=` value is one of the fixed ids, n… Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489-494`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:73-93`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-43`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:253-266`.
- "Not now" on the destinations panel, and "Hide this notice" on the saved notice (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:139`) — The panel disappears and "Export a copy" appears among the actions. After the notice is dismissed, the standing "This is your original. It never changes." line appears. If it fails: The flags are `useState`, so a remount resets both: leaving and coming back, or router Back, brings the panel back. The notice also comes back, because `location.state.fromRecording` stays on the his… Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341-346`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394-412`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436-441`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:292-306`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:868-881`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 5 | 852 | 4 | reviewed | 13 | $0.26 |
| Batch 2 of 2 | 9 | 763 | 2 | reviewed | 27 | $0.42 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.68</sub>

<!-- wachi:review -->

<!-- agent-review sha=dac8318b631e64780f65ce94b4aaa57261d7d63d -->

<!-- wachi:attempt id=b94d8320-9022-40f4-a191-691c6131df1c -->

