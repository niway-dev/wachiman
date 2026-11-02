## apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A file dropped on the Library now navigates the whole window to that file (confidence high)**

The Library no longer calls `useFileDrop`, and nothing else on that screen cancels `dragover`/`drop`. The hook says why it listens on the window: "a file dropped where nothing handles it makes Electron navigate the window to that file" (`features/library/hooks/use-file-drop.ts:9-11`). The main process has no `will-navigate` guard either: only `setWindowOpenHandler`, which covers new windows and not same-window navigation (`src/main/index.ts:400-403`). Today the only other caller is `usePrepareImport` (`features/prepare/use-prepare-import.ts:55`), which is mounted only on Export.

So if a user drags an MP4 from Finder onto the Library, as they could before this change, the renderer is replaced by Chromium's file viewer. The app UI disappears, and there is no error and no way back. The PR body says "dropping a file there does nothing", but that is not what happens.

Fix: keep a window-level `dragover`/`drop` `preventDefault` that is mounted for the whole app, in the shell or `main.tsx`, and that ignores the files. Or add `webContents.on("will-navigate", e => e.preventDefault())` for `file:` URLs in main. Either fix also covers the other screens that have never handled drops.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:228 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Fill / Fit lost its preview, and the stage no longer shows a frame-rate cap or a sound change (confidence medium)**

The deleted `ShapeCard` drew a `FramingPreview` of the recording's thumbnail on the target canvas (`pages/prepare/destination-detail.tsx`, removed). That let the user see what Fill crops away before encoding a 1080×1920 copy. Now the only hint is a `title` tooltip on each segment (line 240), so Fill can cut off the edges of a screen recording and nothing on the screen shows it.

The deleted `ChangesCard` also showed `smoothCapped` (fps capped) and the sound change. The new stage shows neither. The PR says the screen is "restyled, not rewritten", but these are pieces of information users had before and no longer get. Consider keeping the preview for vertical/square and a line for a capped frame rate.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/recent-exports.tsx:17 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Recent exports labels editor exports and Email copies by preset, e.g. "Slack · Discord" (confidence medium)**

`recentCopies` keeps every derived recording that has an `export` sidecar. That includes edited exports from the editor, not only whole-recording copies made on Export. Each row is then named `EXPORT_NAME[destinationOfPreset(preset)]` (lines 65 and 71). An editor export with the default Balanced preset, or a copy the user made for Email, therefore shows as "Slack · Discord", and an editor Maximum export shows as Archive.

The running row already prefers `running.destination` (line 50). Consider using the persisted destination when the sidecar has one, or filtering to `WHOLE_RECORDING_FINGERPRINT` copies, so the strip names what the user actually picked.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:201 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The 1440p/4K and Fill/Fit radio groups don't respond to arrow keys (confidence medium)**

These are `role="radiogroup"` / `role="radio"` buttons with no key handling and no roving `tabindex`. `destinationStep` in export-page.tsx deliberately ignores arrows inside them, on the assumption that a radiogroup "answers its own arrows". Nothing here does, so ←/→ on a focused 1440p, 4K, Fill or Fit segment does nothing. Assistive tech still announces a radio group and expects arrows to work. Either handle ←/→ here or drop the radio roles in favour of plain toggle buttons (`aria-pressed`).

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:121 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: No test covers the new in-progress part of the Export badge (confidence high)**

`useExportBadge` now adds 1 while `status === "exporting"` (sidebar.tsx:121-122), and the label says "in progress or ready". Every case in `sidebar.test.tsx` only calls `noteFinishedCopy`. None of them puts the export runner in the `exporting` state. So nothing checks that a running export shows 1, that it stays shown on `/export`, or that the badge doesn't count the same copy twice when the export finishes (the runner calls `noteFinishedCopy` at export-runner.ts:463, and the ready card's asset is left out at sidebar.tsx:122). The runner is shared with the editor's own exports (`use-video-export.ts:26`), so an editor export also lights up this badge. Consider adding a test that drives the runner through exporting → ready.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Library no longer intercepts file drops, and the new test pins that: a video dropped on Library navigates the Electron window to the file (confidence medium)**

Only one place in the app still takes a file drop at the window level: `useFileDrop`, which is mounted only through `usePrepareImport` (`use-prepare-import.ts:55`), which now only `ExportPage` calls (`export-page.tsx:85`). The hook's own comment explains why it exists (`use-file-drop.ts:10-11`): "a file dropped where nothing handles it makes Electron navigate the window to that file". The main process has no `will-navigate` guard. It sets only `setWindowOpenHandler` (`main/index.ts:400-403`), and that does not cover drop navigation.

Before this PR, Library mounted the drop hook. The removed test "imports a video dropped anywhere on the window" covered that. Now a user who drops a video on Library out of habit loses the whole renderer to a `file://` page. The background export also runs in the renderer, so a copy being exported at that moment is lost with no warning.

The new test only checks that `importVideoFiles` was not called. It does it synchronously, and the import would be async anyway (`importDropped` from `useImportVideos`), so the assertion would pass even if a handler were present. It never checks whether the drop was default-prevented. Compare `export-page.test.tsx:416`, which does check this through `fireEvent.drop`'s return value.

Suggested fix: Library (or the app shell) should still call `preventDefault` on file `dragover`/`drop`, either by redirecting to Export or by ignoring the drop. The test should then assert `fireEvent.drop(...)` returns `false`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:39 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "with and without a video" only checks with a video (confidence high)**

The test is named "is active on Export with and without a video", but it only renders `/export/asset-1`. Nothing checks that the rail item is lit on `/export` (`ROUTES.exportNew`), which is the item's own `to` and the URL the empty state uses. Add a second `renderAt(ROUTES.exportNew)` with the same `aria-current` assertion. Nothing tests the "in progress" half of the badge either: `useExportBadge` adds 1 while `status === "exporting"` (`sidebar.tsx:121`), but every test here drives the badge only through `noteFinishedCopy`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:10 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Dropping the scroll box on `.wrap` doesn't stop the Library picker being clipped (confidence medium)**

The comment says `.wrap` is not a scroll box so the Library picker "must not be clipped". But in the empty state `.wrap` sits inside `.screen` (`export-page.tsx:103-113`), and `.screen` has `overflow: hidden` (`export-page.module.css:15`). The picker is `position: absolute` and can grow to `max-height: min(320px, 45vh)` (`video-picker.module.css:7,11`), so `.screen` still cuts it off. My rough layout math, for the default 614 px page with the header, the centred zone and the Recent exports panel below it, puts the button about half way down. A full 45vh list opening below it would then run past the bottom edge, and its last rows could not be scrolled into view. Check this at the default window size with a long Library. If it clips, either open the picker upward when there is no room below, or cap its height to the space left.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/export-screen.md:50 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Dropping a file on the Library now navigates the whole window to that file (confidence medium)**

This doc (and step 12 of the PR body) says the Library "no longer takes window drops", which suggests a drop there does nothing. The code points to a different outcome. `useFileDrop` is the only thing that calls `preventDefault` on `dragover`/`drop`, and its own comment says why it exists: "a file dropped where nothing handles it makes Electron navigate the window to that file" (`apps/kaipu-record/src/renderer/src/features/library/hooks/use-file-drop.ts:10-11`, `:29-33`). After this PR its only caller is `usePrepareImport`, which only Export mounts (`features/prepare/use-prepare-import.ts:55`, `pages/export/export-page.tsx:85`). Main has no `will-navigate` guard: the only navigation hook on `mainWindow` is `setWindowOpenHandler` (`apps/kaipu-record/src/main/index.ts:400-403`), and that handles new windows, not in-place navigation.

So dragging an MP4 onto the Library, which handled drops until this PR, would replace the app UI with Chromium's video viewer, and nothing on screen explains it. `library-page.test.tsx` only checks that `importVideoFiles` is not called, which jsdom cannot tell apart from a navigation.

Possible fixes: keep a no-op window-level `dragover`/`drop` `preventDefault` on the Library or in the shell, or add a `will-navigate` handler in main that blocks `file:` URLs. Either way, make the doc's sentence match. I haven't run this in Electron (the PR hasn't either), hence medium confidence.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.module.css:108 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: Leftover comment for the removed `.importZone` rule (confidence high)**

`.importZone` was deleted, but the comment above it ("NIW2-579: the 'Drop a video here' strip, between the header and the toolbar.") is still there. It now sits on top of the sticky-toolbar comment, so it seems to describe the toolbar. Remove it along with the rule.

<!-- wachi:finding -->

