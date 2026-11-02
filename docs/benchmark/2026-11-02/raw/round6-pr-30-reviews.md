## review by github-actions[bot] at 2026-11-02T03:29:19Z

👮 **Wachiman** · review of the whole pull request, at `b12d760`: all 47 files reviewed.

9 finding(s): 4 to fix, 5 to consider; 9 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 6.** Part 1 of 6 has one issue to fix. `ExportPage` puts its full-screen \"Loading\" placeholder in place of the whole Export screen whenever `useLocalLibrary().isLoading` is true. That happens on every library re-list: the catalog refresh after mount, an account change, or a saved or imported copy. Each re-list remounts `ExportScreen`, which resets the picked destination, the YouTube resolution and the Fill/Fit choice. The `chosen` ref still holds the old pick, so the next drop or \"Change video\" opens with a destination the screen no longer shows. The rest of this part is consistent: the legacy `/prepare` redirect keeps the query, `preparePath`/`prepareNewPath` now point to Export, Email shares chat's Balanced preset with an explicit destination for the cards, and the keyboard and drop handling are sound.

**Batch 2 of 6.** Part 2 covers the new Export stage, Recent exports and video picker, the Library cleanup, and the deletion of `destination-detail.tsx`. The main problem is in the Library. Removing `useFileDrop` also removed the only window-level drop handler on that screen. Now a file dropped on the Library makes Electron navigate the whole window to that file; the hook's own comment describes this default. The PR says such a drop \"does nothing\", which is wrong. That's a fix. The other finding is minor: the size card is `role=\"img\"`, and its label leaves out the GitHub fits/over-limit verdict, so screen readers never hear it (consider). Everything else in the stage, picker and recent-exports code checks out against what it calls: plan groups and tones match the CSS, every preset maps to a destination, and the i18n keys exist.

**Batch 3 of 6.** I reviewed all 7 files in this part and have one finding, at "consider" severity.

**The finding (`shell/sidebar.tsx:117`):** the new `useExportBadge` clears the Export badge on `/export/:assetId` too. That screen doesn't show the Recent exports list (it only renders on the bare `/export`), so finished copies can stop being flagged without the user having seen them. The fix is to announce only on an exact `/export` match.

**Checked, nothing to flag:**
- The deleted Prepare files (`destination-list.tsx`, `prepare-drop-zone.tsx`, `prepare-page.tsx`) leave nothing behind that still imports them. `isPrimaryEnter` moved to `pages/export/export-page.tsx`.
- The `useFileDrop` tests moved to `use-file-drop.test.tsx` and still cover the same behaviour. Only the click and disabled checks went, and those belonged to the deleted `ImportDropZone`.
- `destinations.test.ts` correctly reflects Email sharing chat's Balanced preset.

**Open question, outside this part (`library-page.tsx`):** with the Library no longer taking window drops, a file dropped there may make Electron navigate the window to the file instead of "doing nothing" as the PR body says. The `useFileDrop` docstring describes exactly that, and the main process has no `will-navigate` guard. I couldn't confirm it without running the app; it's recorded as an open contract.

**Batch 4 of 6.** I reviewed all three test files in this part and found two problems, both in `library-page.test.tsx`.

1. **Fix (tests, high confidence):** the test \"does not take a video dropped on the window\" passes even if Library still handles drops. It no longer mocks `pathForFile`, and the setup's default of `\"\"` makes the import code skip the file before it calls `importVideoFiles`.
2. **Fix (bug, medium confidence):** Library no longer stops a dropped file from opening in the window. Now that it has no window-level drop handler, an unhandled file drop (by Electron's default) loads the file in the window and replaces the app. Nothing else in the renderer cancels the drop, and the main window has no `will-navigate` guard. The Export test checks this case; this test should too. The medium confidence is because it relies on Electron's default drop behaviour, which I did not run.

`export-page.test.tsx` matches what `export-page.tsx` does: keyboard handling, the redirects from old Prepare URLs, the drop and import flow, and reopening an existing copy. The `library-detail-page.test.tsx` changes are only the `/prepare` → `/export` path rename.

**Batch 5 of 6.** Part 5 holds stylesheets, the sidebar test and the deleted Prepare test; I found nothing that blocks the merge.\n\n- The scenarios from the deleted Prepare test reappear in export-page.test.tsx: drop, several files, a non-video file, Enter, busy and an unreadable file. The window-level drop behaviour is also covered in use-file-drop.test.tsx.\n- Nothing still imports the deleted stylesheet or components.\n- Every CSS variable the new styles use is defined in packages/tokens or base.css.\n- Every class the new components use exists in their modules.\n- The `send-more` / `keep-light` selectors match what `groupOf` returns.\n\nTwo points to consider:\n1. The sidebar test named \"with and without a video\" only checks the URL with a video.\n2. The drop zone comment says the Library picker must not be clipped, but `.screen`'s `overflow: hidden` can still clip it at small window heights. I estimated the heights from the CSS rather than measuring them.

**Batch 6 of 6.** I found one cosmetic issue in part 6 and nothing that needs fixing. A comment for the deleted Library drop strip is still in `library-page.module.css:108`; it now sits above the sticky bar and reads as if it describes it. It can be deleted.

What I checked:
- **`routes.ts`:** it adds no value imports, so the preload rule holds. The old `/prepare` URLs redirect to `/export` and keep the query string, so `?to=` survives. The redirect replaces the history entry, so Back does not bounce through it.
- **Removed i18n keys** (`library.importVideo`, `importing`, the `importDrop*` keys and `prepareAVideo`): nothing in the app's `src` still uses them.
- **Removed CSS classes:** every class the new `export-stage.tsx` uses still exists in the rewritten stylesheet, and none of the deleted ones are still referenced. The new `data-tone` selectors match the attributes the component sets.
- **en/es messages:** the new keys match between the two languages.

I did not confirm every behaviour the backlog doc describes (the rail badge, how Email copies are labelled), because that code is in other parts of the review.

<details><summary>What the change connects to (13 closed, 2 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Deleting ImportDropZone and its test: the Library no longer takes window file drops. (`apps/kaipu-record/src/renderer/src/features/library/components/import-drop-zone.test.tsx:1`) — Does an unhandled file drop on the Library (or any page other than Export) now navigate the Electron window away from the app, as the useFileDrop docstring says? Files that would answer it: `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx`, `apps/kaipu-record/src/main/index.ts`.
- Empty Export state: the Library picker dropdown opens below Pick from Library inside the drop zone (`apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:10`) — Does the zone's position plus the picker's height exceed the 614px page at the minimum window size, given the real Recent exports panel height? Files that would answer it: `apps/kaipu-record/src/renderer/src/pages/export/recent-exports.module.css`, `apps/kaipu-record/src/renderer/src/pages/export/video-picker.tsx`.

**Closed, with the lines they rest on**
- Library refresh (library:changed) while the Export screen is open (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:117`) — The Export screen flashes Loading and ExportScreen remounts, so the selection, YouTube resolution and framing reset to ?to=. If it fails: The user's choice is lost silently; the chosen ref keeps the old pick, so the next drop or Change video uses a destination the screen no longer shows. Evidence: `apps/kaipu-record/src/renderer/src/features/library/hooks/use-local-library.ts:41-65`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-local-library.ts:124-134`, `apps/kaipu-record/src/main/library/index.ts:73-87`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:77-80`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:117`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:212`.
- Window-wide file drop on Export imports and opens the video (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85`) — The drop zone lights up via drop.dragging; after the import, Export opens on the new video. If it fails: Import errors are handled by useImportVideos (toasts); a non-video is skipped with a toast. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-import.ts:36-57`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:21-58`, `apps/kaipu-record/src/renderer/src/features/prepare/prepare-path.ts:12-15`.
- Start an export copy with an explicit destination (Email) (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:252-260`) — Progress and ready cards name the destination; 'email' falls back through destinationArg. If it fails: Busy: a toast. The export runner handles failures; the onSaved exceptions are captured. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:97-131`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:55-57`.
- Legacy /prepare URLs redirect to /export keeping the query (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:168-173`) — The Export screen with ?to= preselected. Evidence: `apps/kaipu-record/src/shared/routes.ts:17-24`, `apps/kaipu-record/src/renderer/src/app/router.tsx:68-74`.
- Library no longer handles window file drops (useFileDrop/useImportVideos removed) (`apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53`) — Electron's default for an unhandled file drop: the window navigates to the dropped file, replacing the app. If it fails: The app UI is lost until a reload; this is not the 'does nothing' the PR describes. Evidence: `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:8-11`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:29-51`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:46-54`.
- VideoPicker: open the list and pick a Library original (`apps/kaipu-record/src/renderer/src/pages/export/video-picker.tsx:86-89`) — Export reopens on the picked video. Escape or an outside click closes the list. Arrow keys inside the dialog are excluded from the row stepping, and Enter on its buttons is excluded from 'export'. If it fails: Nothing async in the picker itself. Evidence: `apps/kaipu-record/src/renderer/src/pages/export/video-picker.tsx:45-59`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:86-88`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:150-152`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:364`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:384`, `apps/kaipu-record/src/renderer/src/features/library/lineage.ts:65-67`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:22-26`.
- RecentExports: show the running export and the newest finished copies; a row opens the copy's page (`apps/kaipu-record/src/renderer/src/pages/export/recent-exports.tsx:35-36`) — The progress percentage updates while the runner reports fraction. A finished copy shows up once the Library list includes it. If it fails: On a runner error, status leaves 'exporting', so the running row disappears and the error surfaces through the runner's own UI. destinationOfPreset covers every ExportPresetId. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:26-27`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:59`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:418`, `apps/kaipu-record/src/shared/types/export-preset.ts:8-17`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:102-107`.
- DestinationStage primary / Export again buttons (`apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:121-139`) — The export starts in the background and the screen stays; progress shows in the status cards and in the rail badge. If it fails: copy.start goes through the unchanged usePrepareCopy and export runner, which reports errors through runner status. Evidence: `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:252-266`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:321-325`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:337-338`.
- The rail's Export item shows a badge counting the running export plus finished copies the user hasn't been shown. Opening Export or the Library announces them. (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:111`) — The badge number and its aria label come from export.railBadge ('# copies in progress or ready'). The count drops when the export finishes, and the copy whose ready card is on screen is left out. If it fails: If the export errors, status becomes "error" and the running count drops to 0; the error card is the visible signal. The store lives in memory, so a relaunch starts empty. On /export/:assetId the bad… Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:111-123`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:61-75`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:26`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:321-326`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:462-463`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:101-112`, `packages/i18n/messages/en.json:946`.
- A file dropped on the Library window (the Library page no longer mounts the drop hook) (`apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80`) — Chromium/Electron's default for an unhandled file drop is to navigate the window to the file, which replaces the app UI. If it fails: No error is shown. The main window has no will-navigate guard, so the app UI is lost until it is reloaded. Evidence: `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:8-11`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:48-51`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-import.ts:55`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85`, `apps/kaipu-record/src/main/index.ts:400-403`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.test.tsx:414-416`.
- Old /prepare URLs redirect to /export and keep the query (`apps/kaipu-record/src/renderer/src/pages/export/export-page.test.tsx:374`) — The Export screen opens with the destination from ?to=. Evidence: `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:168-173`.
- Export rail item shows a badge for copies in progress or finished unseen; opening Export or the Library clears it (`apps/kaipu-record/src/shell/sidebar.test.tsx:44`) — The badge number and badgeLabel (export.railBadge) on the Export rail item; the tests assert the text and the accessible name. Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:79-81`, `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:111-123`, `apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:44-79`.
- Legacy /prepare/:assetId and /prepare URLs redirect to /export routes with the query kept (`apps/kaipu-record/src/shared/routes.ts:21`) — Old links and callers land on the Export screen with the destination still preselected; using replace means Back does not bounce through the redirect. Evidence: `apps/kaipu-record/src/renderer/src/app/router.tsx:69-74`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:168-173`, `apps/kaipu-record/src/shared/routes.ts:17-24`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 6 | 13 | 777 | 4 | reviewed | 20 | $0.63 |
| Batch 2 of 6 | 5 | 987 | 4 | reviewed | 17 | $0.65 |
| Batch 3 of 6 | 7 | 789 | 4 | reviewed | 19 | $0.53 |
| Batch 4 of 6 | 3 | 603 | 2 | reviewed | 10 | $0.41 |
| Batch 5 of 6 | 8 | 854 | 2 | reviewed | 22 | $0.49 |
| Batch 6 of 6 | 11 | 843 | 4 | reviewed | 10 | $0.27 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 6 batches · $2.98</sub>

<!-- wachi:review -->

<!-- agent-review sha=b12d760bd90b1e9619bab115f500f9c1a30cccf3 -->

<!-- wachi:attempt id=9dc30344-c916-4558-838b-d1dfd9ebb14e -->

