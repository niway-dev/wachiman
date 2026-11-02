## review by github-actions[bot] at 2026-11-02T03:28:42Z

👮 **Wachiman** · review of the whole pull request, at `b12d760`: all 47 files reviewed.

10 finding(s): 3 to fix, 7 to consider; 10 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 6.** Part 1: no findings. The routes and the legacy /prepare redirect are correct, and so are the Email destination (it shares chat's preset; destinationOfPreset still returns chat), the destination override in usePrepareCopy, and the drop and import flow, which keeps the selected destination. The Enter and arrow handling on the whole screen is guarded against fields, buttons, dialogs and other radio groups. One question is left open, about existing code: if probeSource can reject, Export stays on 'Reading…'.

**Batch 2 of 6.** I reviewed all five files in part 2 and found one real bug plus three smaller suggestions.

**The bug (fix):** dropping a file onto the Library now replaces the whole app window with the file. The Library no longer mounts the hook that catches window-wide drops (`useFileDrop`). Nothing else catches them: the main process has no guard that stops the window navigating away. The hook's own comment says what happens then: Electron opens the dropped file in the window. That contradicts the PR's claim that "dropping a file there does nothing".

**Suggestions (consider):**
- **Lost information on the new stage.** Fill / Fit no longer has its preview of what gets cropped, and the stage no longer says when the frame rate is capped or the sound changes.
- **Wrong names in Recent exports.** Rows are named by preset, so editor exports and Email copies show up as "Slack · Discord".
- **Arrow keys do nothing on two choices.** The 1440p / 4K and Fill / Fit choices are marked as radio groups but don't react to ←/→. The Export page relies on them handling arrows themselves.

One question is left open: whether starting a second export while one is still running is refused with a message. Export now stays on screen after starting, so a second export is one click away. I didn't read `use-prepare-copy.ts` closely enough to confirm.

**Batch 3 of 6.** In part 3, the deleted Prepare files and ImportDropZone leave no imports dangling. Their behaviour now lives in pages/export, and the legacy /prepare routes stay as redirects. The new use-file-drop test matches the hook's window-level listeners and depth counter. The destinations test correctly treats email as sharing chat's `balanced` preset. The sidebar's Export badge announces ready copies on /export and /library and adds 1 for a running export. That logic is sound, but no test puts the runner in the exporting state, so I left one consider-level finding about that missing coverage.

**Batch 4 of 6.** I reviewed the three test files in part 4. One real problem came up, and it is a fix, not a blocker; I'm moderately sure of it.

**The problem: dropping a video on Library now loses the app window.** Library no longer catches a file dropped on the window. The only code that does is a drag-and-drop hook that now runs only on the Export page. That hook's own comment says what happens when nothing catches a drop: Electron navigates the whole window to the file. The main process has nothing that blocks that navigation.

So a user who drops a video on Library, as they could before this change, sees the app replaced by the file. Any export running in the background at that moment is lost, with no warning. The new Library test makes this worse, not better: it only checks that no import started, and never checks that the drop was blocked.

The fix: Library or the app shell should still block file drops, either sending them to Export or ignoring them. The test should then check that the drop was blocked, as `export-page.test.tsx:416` already does.

The confidence is medium, not high, because the "Electron opens the dropped file" premise comes from the hook's comment and Electron's documented behaviour. I didn't see it happen.

**The other two files have no findings.**
- `export-page.test.tsx` tests what the Export page actually does: the keyboard rules for Enter and the arrow keys, reusing a copy that already exists, carrying the destination over after a drop, and redirecting old Prepare links.
- The `library-detail-page.test.tsx` changes only rename `/prepare` to `/export`.

**Batch 5 of 6.** I reviewed all 8 files in this part and found nothing that blocks the merge.

- **Deleted Prepare tests:** the cases removed from `prepare-page.test.tsx` all reappear in `export-page.test.tsx` as Export equivalents: drops, several videos, non-video files, the busy export, an unreadable file, screenshots and reuse of an existing copy. Two were changed on purpose: Archive is now "Keep full quality", and an unknown `?to=` now picks nothing instead of falling back to YouTube.
- **New stylesheets:** every CSS variable they use is defined, in `packages/tokens/css/tokens.css` or `base.css`.
- **Findings (both "consider"):**
  - The sidebar test named "with and without a video" only checks the case with a video.
  - The drop-zone comment says the Library picker won't be clipped, but its parent `.screen` still has `overflow: hidden`. With a long Library at the default window size, the bottom of the picker may be cut off. This rests on rough layout math, not a confirmed render.

**Batch 6 of 6.** Part 6 covers the shared routes, the stylesheets, the backlog docs and the i18n messages. The new routes take no value imports, so the preload rule is satisfied. Every `export.*` key the new screen uses exists in both en.json and es.json. Nothing in the renderer still uses the removed `library.import*` keys or `prepare.prepareAVideo`. The CSS selectors match the classes and data attributes that `export-stage.tsx` uses.

One fix: after this PR, only Export registers the window-wide file drop handler, and main has no `will-navigate` guard. So a video dropped on the Library likely sends the window to the file instead of doing nothing, as the doc and the PR body claim. I haven't seen it happen in Electron, so I rated it medium confidence. There is also one leftover comment in the Library stylesheet from the removed `.importZone` rule.

<details><summary>What the change connects to (15 closed, 3 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Probing the recording when Export opens on a video; an unreadable file redirects to /export with a toast (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:92`) — Can probeSource reject (an IPC failure), leaving Export stuck on 'Reading…'? Files that would answer it: `apps/kaipu-record/src/renderer/src/features/video-editor/export/probe-source.ts`.
- Primary action / Export again on the destination stage (`apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:121-139`) — Does usePrepareCopy.start refuse with a toast while another export runs, now that Export stays on screen after starting? Files that would answer it: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts`.
- Library picker opened from the Export empty-state drop zone (layout change: `.wrap` no longer scrolls) (`apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:10`) — How tall are the button and the Recent exports panel at 828×614? Does the picker's bottom go past `.screen`? Files that would answer it: `apps/kaipu-record/src/renderer/src/pages/export/video-picker.tsx`, `apps/kaipu-record/src/renderer/src/pages/export/video-picker.module.css`, `apps/kaipu-record/src/renderer/src/pages/export/recent-exports.module.css`.

**Closed, with the lines they rest on**
- A video dropped anywhere on Export, or picked via Browse files, is imported and Export opens on it with the selected destination (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85`) — Drop zone title switches between dropTitle, dropActive and dropImporting; the new video opens on Export with the chosen card. If it fails: An import rejection is caught in useImportVideos.run and reported through reportError; per-file failures get a toast. A cancelled dialog does nothing. useFileDrop is mounted for every ExportPage stat… Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-import.ts:36-57`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-import-videos.ts:76-94`, `apps/kaipu-record/src/renderer/src/features/prepare/prepare-path.ts:12-15`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:77-88`.
- Legacy /prepare and /prepare/:assetId URLs redirect to Export and keep the query (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:168`) — Old links land on Export with ?to= kept. The window preset stays main for both paths. Evidence: `apps/kaipu-record/src/shared/routes.ts:17-24`, `apps/kaipu-record/src/renderer/src/app/router.tsx:68-74`, `apps/kaipu-record/src/shared/window-size.ts:82-88`.
- Email is a destination that shares chat's preset; usePrepareCopy takes an explicit destination so the status cards say Email (`apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:119`) — The progress card names Email. Finished balanced files show as Chat in the lists that derive from the preset, as the destinations.ts comment says. The chat and email cards both show Ready when a balanced copy exists. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:64-107`, `apps/kaipu-record/src/renderer/src/pages/export/recent-exports.tsx:50`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:252-260`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:338`.
- Document-level keydown: Enter runs the primary action and the left/right arrows move the destination selection (`apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:277`) — Enter opens an existing copy or starts an export. When focus was on a card, it follows the selection. If it fails: A second Enter while an export runs hits the isVideoExportBusy guard and shows a toast. Evidence: `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:262-301`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:356-386`, `apps/kaipu-record/src/renderer/src/pages/export/video-picker.tsx:50-90`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:98-101`.
- User drops a file from the OS onto the Library screen (window-wide drop handling removed) (`apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53`) — Chromium's default runs: the window navigates to the dropped file and the app UI is replaced. If it fails: Silent: no toast and no in-app way back; the app has to be reloaded or restarted. Evidence: `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:9-11`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:48-51`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-import.ts:55`, `apps/kaipu-record/src/main/index.ts:400-403`.
- Open "Change video" / "Pick from Library" list and pick a recording (`apps/kaipu-record/src/renderer/src/pages/export/video-picker.tsx:86`) — Export reopens on the picked recording; ExportScreen is keyed by preparable.id, so its state resets. If it fails: No async work here. Arrow keys inside the dialog are excluded from destination stepping, and Enter on an item button is excluded from the primary action. Evidence: `apps/kaipu-record/src/renderer/src/pages/export/video-picker.tsx:45-59`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:86-88`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:152`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:364`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:384`.
- Recent exports reads the export runner and the Library list (`apps/kaipu-record/src/renderer/src/pages/export/recent-exports.tsx:34`) — The row goes from "exporting N%" to a finished row once the vault reports the new file. If it fails: The runner is a module singleton, so the state survives a remount or Back. destinationOfPreset covers every preset, so the `!` cannot yield undefined. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:160-191`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-local-library.ts:124-134`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:64-73`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:102-107`.
- New Export rail item with a badge counting the running export plus unannounced finished copies; visiting /export or /library announces them (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:111-123`) — The Rail renders the badge on the Export item with the export.railBadge plural label ("N copies in progress or ready"). The Library item has no badge any more. If it fails: The ready-copies store is in memory, so a relaunch starts with nothing pending. If the export errors, status becomes "error" and the in-progress count goes back to 0. The effect depends on [pathname,… Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:79-81`, `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:114-122`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:61-75`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:26`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:463`, `apps/kaipu-record/src/shared/routes.ts:17-24`, `packages/i18n/messages/en.json:946`, `apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:44-79`.
- Deletion of the Prepare page, its drop zone and its destination list; their logic moves to pages/export (`apps/kaipu-record/src/renderer/src/pages/prepare/prepare-page.tsx:1`) — /prepare URLs redirect to /export. Evidence: `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:375`, `apps/kaipu-record/src/renderer/src/pages/export/destination-row.tsx:11`, `apps/kaipu-record/src/shared/routes.ts:21-24`.
- A file from the OS dropped on the Library page after the Library import door is removed (`apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80`) — The platform default runs: Electron navigates the window to the dropped file, and the app UI is replaced. If it fails: The renderer state is lost, including any background export running in the renderer. Nothing warns the user, and the app needs a reload. Evidence: `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:8-11`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:48-51`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-import.ts:55`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85`, `apps/kaipu-record/src/main/index.ts:400-403`.
- Dropped video on Export is imported and opened with the selected destination (`apps/kaipu-record/src/renderer/src/pages/export/export-page.test.tsx:460`) — Export opens on the new asset with the ?to= destination. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-import.ts:42-52`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:75-88`.
- Rail badge moves from Library to Export, counting a running export plus finished copies the user has not been shown (`apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:44`) — The Export rail item shows a count and the accessible name "N copies in progress or ready". Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:111-123`, `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:72-82`, `apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:44-79`.
- The Library stops mounting the window-wide file drop handler (ImportDropZone/useFileDrop removed); only Export takes drops (`apps/documentation/src/content/docs/backlog/export-screen.md:50`) — Electron's default for an unhandled file drop is to navigate the window to the file, so the app UI is replaced by the video. The doc and the PR body say nothing happens. If it fails: Silent: no error or toast. The renderer navigates away from the app until it is reloaded. Evidence: `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:10-11`, `apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:29-33`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-import.ts:55`, `apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85`, `apps/kaipu-record/src/main/index.ts:400-403`.
- New routes /export/:assetId and /export in the shared route table, with /prepare kept as legacy redirects (`apps/kaipu-record/src/shared/routes.ts:17-24`) — The window-size preset and the sidebar resolve the new paths. The file takes no value imports, so the preload rule is satisfied. Evidence: `apps/kaipu-record/src/shared/routes.ts:13-42`, `apps/kaipu-record/src/shared/window-size.test.ts:18-25`.
- New stylesheet selectors for the size bar tone (data-tone fits/over/lighter/not-lighter) (`apps/kaipu-record/src/renderer/src/pages/export/export-stage.module.css:262-291`) — The bar and its tag are teal when the copy fits or is lighter, and amber when it is over the limit or not lighter. Evidence: `apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:307-330`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:123`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 6 | 13 | 777 | 4 | reviewed | 13 | $0.50 |
| Batch 2 of 6 | 5 | 987 | 4 | reviewed | 14 | $0.62 |
| Batch 3 of 6 | 7 | 789 | 4 | reviewed | 12 | $0.38 |
| Batch 4 of 6 | 3 | 603 | 2 | reviewed | 9 | $0.37 |
| Batch 5 of 6 | 8 | 854 | 2 | reviewed | 15 | $0.43 |
| Batch 6 of 6 | 11 | 843 | 4 | reviewed | 18 | $0.54 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 6 batches · $2.85</sub>

<!-- wachi:review -->

<!-- agent-review sha=b12d760bd90b1e9619bab115f500f9c1a30cccf3 -->

<!-- wachi:attempt id=1b459c89-8242-45d1-9742-0c99fbf7e2b1 -->

