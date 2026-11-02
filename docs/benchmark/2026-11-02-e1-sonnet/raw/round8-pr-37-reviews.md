## review by github-actions[bot] at 2026-11-02T03:43:55Z

👮 **Wachiman** · review of the whole pull request, at `e45c845`: all 31 files reviewed.

4 finding(s): 4 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡📝 **Consider · docs: Body and "How to validate" still describe the removed strings and ✕-hides behaviour (confidence high)** (`apps/documentation/src/content/docs/backlog/background-copy-toasts.md:29`): The "Update" banner at lines 16-18 points to the new doc, but the rest of the page still says the opposite of what this PR ships. The frontmatter description (line 3) and lines 29-38 quote "Preparing your YouTube copy…" and "Your YouTube copy is ready". Those strings are now "Exporting for YouTube" and "YouTube copy ready" (`packages/i18n/messages/en.json` `progressTitle` / `readyTitle`). Lines 31 and 62 say "✕ hides the card". The corner button is now − and minimizes to a pill (`status-card.tsx` `dismissIcon="minimize"`). Lines 34 and 68 call the ready card's drag button "Drag to upload"; for YouTube it now reads "Drag to YouTube Studio" (`dragTo`). This page is still marked 🟢 Ready to validate, so someone following validation steps 1, 2, 5 and 6 will see text that doesn't match. Update those steps and strings, or mark the superseded parts as historical.

### Summary

**Batch 1 of 2.** I found no blockers or fixes in part 1. The ready-copy card, the minimized export widget and the destination read-back are consistent with their callers and tests. I raise two low-confidence "consider" notes. The Library ready card's Show in Finder and drag actions do not mark the copy seen, unlike the toast. The `progressbar` role inside the minimized pill's button is not exposed to assistive tech.

**Batch 2 of 2.** I found nothing that blocks the merge in these CSS, i18n and doc files, and left two minor findings. I checked every file's claims against the code. The en and es keys match, and the removed keys `hide` and `readyDragToUpload` have no remaining callers. The destination colours match `destination-logo.module.css`. The doc's claims about `retireReadyCards`, `sessionStorage`, `copyDestinationOf` and newest-first ordering all hold. Two things to fix: `background-copy-toasts.md` still describes the old strings and the ✕-hides behaviour in its body and validation steps, and `ready-copy-card.module.css` uses an undefined `--bg-hover` token.

<details><summary>What the change connects to (6 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Leaving the Library retires every "Ready to upload" card (route watch in the sidebar hook) (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:92`) — The Library grid shows a leading card for each finished copy until the user opens it, closes it or navigates away. After that the regular card carries the outline and chip. If it fails: If the copy is not in `videos` yet when the user leaves, the card is retired unseen. This is a rare race that costs only the card, because the unseen outline and chip remain. Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:92-105`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:97-100`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:126-133`.
- The export widget's minimized choice is stored in sessionStorage and read through useSyncExternalStore (`apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:8`) — A progress pill or full card at bottom right, chosen by the stored flag. If it fails: If sessionStorage throws, the read returns false and the write is swallowed, so the choice holds only in memory. The widget does not break. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:34-55`.
- The destination is read back from the sidecar fingerprint with `copyPresetOf`, and the Library cards show a destination tag (`apps/kaipu-record/src/renderer/src/features/prepare/copy-destination.ts:13`) — Non-master recordings made from Prepare show "For YouTube" and similar tags in the Library grid. The master copies panel now recognises real copies. If it fails: An unknown preset or a null fingerprint gives null, and the card falls back to the kind badge. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/copy-destination.ts:13-30`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:440`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-reuse.ts:18`.
- Minimize the export widget to a pill, and expand it again (`apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:152`) — The pill (ring, "YouTube copy · N%") appears bottom right via the `.exportStack` container and expands again on click. The choice survives a remount and a renderer reload, and a relaunch starts expanded. If it fails: If sessionStorage throws, the try/catch keeps the choice in memory, so nothing is lost silently. A minimized export that errors flips to the error card without any user action. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:34-55`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:189-228`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.tsx:27-29`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.module.css:18-29`.
- Leaving the Library retires the "Ready to upload" cards; ✕ on a card dismisses it (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:102`) — The Library page leads the grid with two-column cards. After ✕, or after leaving and coming back, the regular `VideoCard` returns with the destination tag and the pink outline. The docs match this behaviour. If it fails: No async work is involved. The card state lives in memory, so a relaunch loses it, which the doc states. The route watch is not tied to page unmount, so StrictMode double-mounting does not retire the… Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:92-106`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:87-105`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:123-133`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:407-444`.
- Ready card: Show in Finder and Drag to <destination> (native file drag) (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:76`) — The renderer reaches main only through the existing `window.electronAPI` calls with the local recording id, so the Electron boundary is not widened. The drag is a native drag of the real file. If it fails: The card renders the actions only when `video.id !== null`, i.e. when there is a local file. `revealLocalRecording` is fire-and-forget (`void`), so a rejection is not surfaced here. The existing toas… Evidence: `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:74-100`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-300`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 22 | 835 | 4 | reviewed | 13 | $0.24 |
| Batch 2 of 2 | 9 | 427 | 1 | reviewed | 31 | $0.32 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.57</sub>

<!-- wachi:review -->

<!-- agent-review sha=e45c845143ba72f35fea4fac2f9d62a186dff986 -->

<!-- wachi:attempt id=90c46a43-8652-4837-afa1-58165ef378cd -->

