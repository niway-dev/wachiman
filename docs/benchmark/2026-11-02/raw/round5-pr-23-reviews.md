## review by github-actions[bot] at 2026-11-02T03:24:34Z

👮 **Wachiman** · review of the whole pull request, at `dac8318`: all 14 files reviewed.

3 finding(s): 1 to fix, 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** I reviewed the five files in part 1 and found one bug worth fixing and two test gaps; nothing blocks the merge. The bug: the new \"Where is it going?\" panel gets only `probe`, which is `null` both while the file is being read and after reading fails. When the probe fails, every card except Archive shows \"…\" permanently and nothing says the estimate is unavailable. In `master-copies-panel.test.tsx`, the drag test replaces the shared `startFileDrag` stub without restoring it, and the \"Open in Export → shows only where…\" test never checks the case where the button should be absent. The drag handle follows the existing `startFileDrag` call sites. The cards, Not now, Open in Export and Saved-notice paths follow the existing `openPrepare` and post-recording-card patterns. One question is still open: I didn't read `probeSource`, so I couldn't confirm whether it can reject, which would leave the probe stuck on loading.

**Batch 2 of 2.** Part 2 covers the detail-page tests, the stylesheets, the backlog docs and the i18n messages. I found nothing to flag in them.

- **i18n.** No code still references any removed `library.*` key (the `where*` keys, `copiesEmpty`, `copyProgress*`). Every new key is used, and `sendTo` stays for the Library card and row. The Spanish ETA wording works with the `etaMinutes`/`etaSeconds` strings.
- **Stylesheets.** Every CSS-module class the new components and the page use is defined. The deleted strip stylesheet has no importer left.
- **Docs.** The backlog doc matches the code:
  - Six destinations, read from `DESTINATION_IDS`.
  - The archive card shows the recording's own size.
  - The amber/teal tone follows `groupOf`.
  - "Not now" lasts only for the visit, because the dismissal lives in component state.
  - The file is now read for every local recording.
- **Tests.** The updated tests check the new behaviour: the title row, every destination card's `?to=`, "Not now", the "Saved" notice, the copies row's derived picture size and Drag. The "up to 25 MB" test drops its assertion that the file is never read, which matches the new always-read behaviour.

One thing outside these files: the pull request body says the panel has seven destinations, but the code and `prepare-screen.md` both have six. The doc is the accurate one.

For awareness, both outside this part's files:
- The copies panel's Drag uses the same `startFileDrag` IPC as the ready card but does not call `markCopySeen`.
- The "Saved" notice comes back after going to Prepare and pressing Back, as the post-recording card already does.

<details><summary>What the change connects to (10 closed, 2 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Probe the file for every local recording (previously only heavy recordings or when the post-recording card showed) (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — Can probeSource reject? If it can, the probe stays on loading and the rejection goes unhandled. Files that would answer it: `apps/kaipu-record/src/renderer/src/features/video-editor/export/probe-source.ts`.
- The page now probes the file for every local recording, not only heavy ones (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — Does useSourceProbe catch a rejected probe and leave probe null, or does it surface or report an error? Files that would answer it: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts`.

**Closed, with the lines they rest on**
- Click a destination card in "Where is it going?" (`apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:82`) — The Prepare screen opens with that destination selected. If it fails: openPrepare does nothing when assetId is missing, but the panel only renders once a video has been found, so that case doesn't arise. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:384-387`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489-505`.
- Size estimate per destination card, computed from the source probe (`apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41`) — The size line on each card, amber for send-more destinations and teal otherwise. If it fails: If the probe errors, useSourceProbe returns probe null, the same value it returns while loading, so the cards stay on "…" for good with no message. Reported as a finding. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:88-95`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:179-213`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`.
- "Not now" dismisses the destinations panel (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:494`) — The panel disappears and "Export a copy" leads the actions. If it fails: The state lives only in the component, so the panel comes back after the page remounts (leaving and returning, or Back from Prepare). That matches the PR's "lasts until you leave the page". Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:517`.
- Drag handle on a ready copy starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171`) — The OS drag carries the real file, named after the copy's title. If it fails: The IPC is fire-and-forget (ipcRenderer.send). Main ignores an id containing path separators or ".." (main/library/index.ts:163). A file that doesn't resolve produces no drag and no message, the same… Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:231-236`, `apps/kaipu-record/src/renderer/src/features/library/components/gif-viewer.tsx:25-28`, `apps/kaipu-record/src/preload/index.ts:87`, `apps/kaipu-record/src/main/library/index.ts:161-165`.
- "Open in Export →" in the copies panel (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:122`) — Prepare opens with nothing preselected. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:507-515`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436-441`.
- "Saved to your Library" notice and its ✕ dismissal (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394`) — A green status line above the player. After ✕, the "This is your original" note appears. If it fails: location.state.fromRecording survives Back to this history entry and the dismissal state does not, so the notice reappears on return. The post-recording card behaves the same way. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-137`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341`.
- A "Where is it going?" destination card opens Prepare on its destination (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:493`) — The router moves to /prepare/:assetId?to=<destination>; the Prepare screen opens with that destination selected. If it fails: Synchronous navigation; no async call. assetId is guarded before navigating. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:73-94`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-43`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:253-266`.
- Saved-to-your-Library notice and its ✕ on a fresh recording (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394-412`) — A green role=status notice above the player. ✕ hides it and shows "This is your original. It never changes.". If it fails: The dismissal lives in component state. Prepare and then Back remounts the page under the same history entry, which still carries fromRecording, so the notice comes back. The post-recording card beha… Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-137`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341-346`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:868-881`.
- "Not now" hides the destinations panel and brings back Export a copy (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:494`) — The panel disappears and Export a copy (no ?to=) appears first among the actions. If it fails: Component state only: it resets on remount, which matches the doc's "for that visit". Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:138-139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436-441`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:517-523`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:292-306`.
- Drag handle on a ready copy starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171-175`) — The OS drags the copy's real file into the drop target, named after the copy's title. If it fails: startFileDrag is fire-and-forget, as in the existing card. A drag from this panel leaves the copy "unseen" for the background-copy pointer. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:232-235`, `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164-180`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 5 | 852 | 4 | reviewed | 11 | $0.59 |
| Batch 2 of 2 | 9 | 763 | 2 | reviewed | 18 | $0.64 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $1.23</sub>

<!-- wachi:review -->

<!-- agent-review sha=dac8318b631e64780f65ce94b4aaa57261d7d63d -->

<!-- wachi:attempt id=1d2200b2-736c-49ee-9717-eefe23c1cf67 -->

