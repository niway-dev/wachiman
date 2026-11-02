## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:117 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Every library re-list unmounts ExportScreen and resets the user's selection (confidence medium)**

`useLocalLibrary().refresh` sets `isLoading` to true on every call (`use-local-library.ts:42`). `ExportPage` returns the "Loading" placeholder whenever `isLoading` is true, even when the video is already resolved. `ExportScreen` is therefore unmounted and remounted. Its local state (`selected`, the YouTube 1440p/4K choice, the Fill/Fit framings) goes back to the initial values, and the picked card and focus are lost.

A re-list happens without the user doing anything. `useLocalLibrary` fires `refreshCloudCatalog()` on mount (`use-local-library.ts:130`), and main broadcasts `library:changed` when that succeeds (`main/library/index.ts:73-75`). Account changes, tag edits and imports broadcast too (`index.ts:85-87`, `110`, `185`). A signed-in user who picks a destination right after opening Export can see the screen flash "Loading" and the selection revert to `?to=` or to "Where is it going?".

The editor routes avoid this with `if (isLoading && !source)` (`editor-routes.tsx:79`). Show the loading placeholder only while `video` is still unresolved (`isLoading && !video`), or keep the last resolved video. I did not run the app, so I have not seen the flash; I read the code path.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:251 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: "Ready" / "Open existing" ignores Fill/Fit for Reels and feeds (confidence medium)**

`existing = reusable[plan.target.presetId]` and the card's `isReady` (line 338) match on preset only. Vertical and square have no `ENCODE_REVISION` (`export-presets.ts:177-182`), so `encodeFingerprint` returns the bare `"whole"` for them. `export-runner.ts` passes `framing` to the plan (line 302) but not into the stored fingerprint (lines 452-454). A copy exported as Fill is therefore "Ready" for Fit. After the user switches Fit/Fill, the primary button and Enter open the old file instead of encoding the framing they just chose. "Export again" is available, so the result is visible, but the choice made on this screen is ignored. I could not check whether the old Prepare page had the same behaviour. Either include framing in the reuse key for these two presets or hide "Open existing" when the framing differs.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:375 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Enter exports even while the video picker's dialog is open (confidence low)**

`destinationStep` ignores events from inside `[role='dialog']` (line 364), but `isPrimaryEnter` does not. With "Change video" open and focus on the panel itself (for example after clicking its padding or the empty-state text), Enter reaches the document listener and starts or opens the copy behind the list. Escape and outside click are the only things the picker handles. Apply the same dialog guard in `isPrimaryEnter`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A video file dropped on the Library window now navigates the window to the file (confidence medium)**

The Library used to mount `useFileDrop`. That hook's comment (`use-file-drop.ts:10-11`) says why: a file dropped where nothing handles it makes Electron navigate the window to that file. After this change `LibraryPage` mounts no drop handler. I found no replacement. There is no `will-navigate` guard in `src/main` (`main/index.ts:400` only sets a window-open handler), no global `drop`/`dragover` listener, and `useFileDrop` is now mounted only through `usePrepareImport` in `ExportPage`. Users who learned to drop a recording on the Library will now see the app replaced by the raw video. They have to reload to get the UI back. The new test at `library-page.test.tsx:80` only checks that `importVideoFiles` is not called. It does not check that the drop is cancelled, so it passes while the window navigates away. Fix: keep a drop guard on the Library, for example `useFileDrop` with a handler that toasts or redirects to Export (`ROUTES.exportNew`). Alternatively, block navigation in the main process with `will-navigate`, which would cover every page. Extend the test to assert `defaultPrevented` on the drop.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/recent-exports.tsx:65 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Finished email exports are listed as "Chat" (confidence medium)**

Email shares the `balanced` preset with chat (`destinations.ts:70-71`). `destinationOfPreset("balanced")` returns `chat` (`destinations.ts:13`, `102-107`). The running row uses `running.destination ?? …`, so it names Email correctly. A finished row only has the stored `export.preset`, so an email copy shows the Chat logo and the Chat name. A user who exported for Email sees the finished copy labelled differently from the in-progress row for the same job. If the destination is not stored in the export sidecar, labelling `balanced` copies neutrally, or showing the preset's size or quality, would avoid a wrong name.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:240 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Fill / Fit explanation is only in a `title` tooltip (confidence medium)**

The deleted `ShapeCard` showed `framingFitHint` / `framingFillHint` as a visible paragraph next to a still preview. Here the text is only the `title` attribute of each radio. A keyboard or touch user, and a screen reader, will not reliably get it. What Fill does (crops the edges) and what Fit does (shows everything with bands) is the one real decision for Reels and feeds, and it now has no visible explanation. Show the hint for the active option as visible text, as the removed card did, and keep the `title` only if you want it as extra.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:119 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Opening Export clears the badge, but the Export page does not mark which copy is new (confidence medium)**

Visiting `/export*` now calls `announceReadyCopies()`, so the rail badge drops to 0 on arrival. The doc comment at lines 107-108 justifies this with "both point at the copies". Only the Library page does: `library-page.tsx:61-62` reads `useReadyCopies`/`unseenCopyIds` for its chip and outline. Nothing under `pages/export` reads `useReadyCopies` or `unseenCopyIds` (I grepped `apps/kaipu-record/src/renderer/src`). So a user who finishes a copy in the background and clicks the Export item loses the "new copy ready" signal without seeing which copy is new. Either have the Export page's recent list highlight unseen copies, or announce only on the Library route. Otherwise the comment should say Export only lists copies, without marking the new one.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A video dropped on the Library now falls through to Electron's default, and the test doesn't check for it (confidence medium)**

The PR removes the Library's `useFileDrop` import door (`ImportDropZone`). `usePrepareImport` is now the only non-test caller of `useFileDrop` (`features/prepare/use-prepare-import.ts:55`). `useFileDrop`'s own doc says why it listens on the window: "a file dropped where nothing handles it makes Electron navigate the window to that file" (`features/library/hooks/use-file-drop.ts:10-11`). Before this PR the Library intercepted that drop. After it, nothing on the Library page calls `preventDefault` on `drop`.

I found no guard elsewhere. There is no `will-navigate` handler in `src/main`, no drop handling in `shell/app-root.tsx`, and nothing in the preload. So a user who drops a video on the Library, the old import door, probably gets the main window navigated to the file and has to reload the app. The Library page also has no copy telling them to go to Export.

The new test "does not take a video dropped on the window" only asserts `importVideoFiles` was not called. It passes whether or not the window navigates away. The Export tests already show the right check: `dropFiles` returns `!fireEvent.drop(...)`, i.e. whether the default was prevented.

Fix: add a window-level guard that swallows file drops everywhere outside Export, for example in `app-root.tsx`, or call `useFileDrop` with a no-op on the Library. Then assert that `fireEvent.drop` on the Library is default-prevented. The other pages that never handled drops, such as the editors, share the exposure; I did not check them.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-page.test.tsx:352 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "Export again" and the full-size archive path are asserted too loosely (confidence medium)**

Two tests check less than their names say. The "a copy that exists reads Ready" test only asserts that the "Export again" button is visible (line 352). It never clicks it, so nothing proves `onExportAgain` runs `startCopy` (`export-page.tsx:324`) instead of `onOpenExisting`. "Keep full quality keeps the full size" (line 258) only checks `presetId: "maximum"`, not a size. Add a click on "Export again" that expects `exportController.start` to be called once with `presetId: "balanced"` and no navigation.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:39 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test name claims "with and without a video" but only checks /export/asset-1 (confidence high)**

`is active on Export with and without a video` renders only `/export/asset-1`. The bare `ROUTES.exportNew` (`/export`) case is never asserted, although the nav item's `to` is `ROUTES.exportNew` (sidebar.tsx:53) and the `/export` and `/export/:assetId` routes are both registered in `renderAt`. Add a second render at `ROUTES.exportNew`, or rename the test.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:44 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The "copy in progress" half of the Export badge has no test (confidence medium)**

`useExportBadge` now adds `running = status === "exporting" ? 1 : 0` to the finished-copy count (sidebar.tsx:121-122), and the label reads "copy in progress or ready". The old Library badge counted only finished copies, so this is new behaviour. The tests here only cover finished copies. Nothing in the other test files that mention `exporting` or `useExportBadge` drives the rail badge from an exporting runner state either. A test that sets the runner to exporting and expects the badge to read 1, and then 2 with a finished copy, would pin this.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:10 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Library picker may still be clipped at the bottom of the screen (confidence low)**

The comment says `.wrap` is not a scroll box so the Library picker opening below its button is not clipped. But `.screen` in export-page.module.css:15 is `overflow: hidden` and fixed at the page height. The no-video layout stacks the header, this zone and `RecentExports`, so the zone's buttons sit roughly mid-screen. `.panel` in video-picker.module.css opens at `top: calc(100% + 6px)` with `max-height: min(320px, 45vh)`. In the 900×670 window with a long Library list, could the panel's bottom run past the 614px page and be cut off by `.screen`? I did not check this against a rendered layout.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.module.css:108 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: Orphaned comment for the removed `.importZone` rule (confidence high)**

The PR deletes `.importZone`, but the comment above it (`NIW2-579: the "Drop a video here" strip, between the header and the toolbar.`) stays. It now sits directly above the `.stickyBar` comment and describes a strip the Library no longer has. Delete line 108.

<!-- wachi:finding -->

