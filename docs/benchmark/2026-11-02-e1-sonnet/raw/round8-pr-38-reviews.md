## review by github-actions[bot] at 2026-11-02T03:44:25Z

👮 **Wachiman** · review of the whole pull request, at `dac8318`: all 14 files reviewed.

5 finding(s): 5 to consider; 5 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** I found no bugs in this part. The three findings are all "consider" level: two test-quality gaps in `master-copies-panel.test.tsx` and one note about derived dimensions in `master-copies-panel.tsx`. I only read the code, as instructed, so none of it was run. The drag handler matches its siblings and validates its input in main. The Where-is-it-going panel and the heavy banner follow the new `showDestinations` logic without leaving a gap. After "Not now", "Export a copy" returns.

**Batch 2 of 2.** This part is mostly sound. I found no blockers. The stylesheets use tokens that exist in packages/tokens/css/tokens.css. The i18n keys the page and panels use are present in both en.json and es.json. The removed keys (where*, copiesEmpty, copyProgress*) have no remaining users. The kept `sendTo` key is still used by the Library card and row. The docs match the code. There are two minor test points. The \"Saved\" notice and the \"Your video is ready\" card both come back on Back to the same history entry, because `location.state` survives the remount, and nothing tests that. The heavy-master paths with copies or after \"Not now\" have no tests.

<details><summary>What the change connects to (7 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Drag handle on each ready copy row starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164`) — Main resolves the vault id, hard-links a friendly file named after `copy.title`, and calls `event.sender.startDrag`. The user drags the real file into another app. If it fails: The IPC handler is fire-and-forget (`ipcMain.on`). It rejects silently on a missing thumbnail or file and logs `file drag failed`. The user sees nothing happen, and the same failure exists on the sib… Evidence: `apps/kaipu-record/src/main/library/index.ts:161-175`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:228-240`, `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164-180`.
- Where-is-it-going cards replace the old strip; picking one opens Prepare on that destination (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489`) — The cards show an estimated size once the probe resolves. They show "…" before that, and always show the archive size. If it fails: If the probe fails or is unusable, `probe` stays null. Cards then show "…" indefinitely, but each card is still clickable, and the panel degrades without an error. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:189-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:517`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41-56`.
- Destination card click (and "Export a copy", "Open in Export →") opens Prepare on that destination (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149`) — The router navigates to /prepare/:assetId[?to=…]. The Prepare screen preselects the destination. If it fails: `openPrepare` does nothing without an `assetId`, which can't happen once the page has rendered a video. Nothing async is involved. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436-441`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489-494`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:73-83`.
- "Not now" hides the destinations panel; "Export a copy" returns (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:139`) — The panel disappears, and `showDestinations` is false. The "Export a copy" action appears, and a heavy master gets the banner with "Prepare a light copy →". If it fails: None. It is local state. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:517-523`.
- Fresh-recording "Saved to your Library" notice, once per arrival (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:136`) — A green role=status notice appears above the player, and the standing master note waits until ✕. If it fails: Re-shown on Back (see finding). Nothing is lost. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:129-137`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341-346`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394-412`, `apps/kaipu-record/src/renderer/src/shell/app-root.tsx:72`.
- Drag handle on a copy row starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171`) — The OS drags the real copy file with the copy's title as its file name. If it fails: Main returns silently when the copy has no poster thumbnail (`icon.isEmpty()`), and logs only on a thrown error. The user sees a drag that does nothing, and nothing else is lost. The IPC is send-only… Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:164-180`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:231-236`, `apps/kaipu-record/src/main/library/index.ts:161-175`.
- The page now probes the file for every local recording, not only a heavy one (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — The resolution joins the metadata line. Cards show `~N MB` estimates, or "…" while loading and on error. If it fails: On a probe error the cards keep "…" for the size with no error state. The cards stay clickable, so the action still works. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41-56`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:91`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 5 | 852 | 4 | reviewed | 18 | $0.27 |
| Batch 2 of 2 | 9 | 763 | 2 | reviewed | 26 | $0.38 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.65</sub>

<!-- wachi:review -->

<!-- agent-review sha=dac8318b631e64780f65ce94b4aaa57261d7d63d -->

<!-- wachi:attempt id=26ab8260-0929-45f8-ba02-f4f13c4459f2 -->

