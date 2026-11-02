## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:363 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: The stage's 1440p / 4K and Fill / Fit groups do not handle their own arrow keys (confidence high)**

`destinationStep` skips ←/→ inside any other `[role='radiogroup']`, and the doc comment (lines 351-355) says that group "answers its own arrows". The groups in `export-stage.tsx:201-218` and `export-stage.tsx:233-248` are plain `role="radio"` buttons with only `onClick`. They have no `onKeyDown` and no roving tabIndex, so arrows there do nothing at all. Either give those groups arrow handling and one tab stop each, as `DestinationRow` has, or correct the comment.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A file dropped on the Library now hits Electron's default and navigates the window away from the app (confidence medium)**

This change removes `useFileDrop` from the Library. That hook was the Library's only `dragover`/`drop` handler, and its own docstring says why the window needs one: "a file dropped where nothing handles it makes Electron navigate the window to that file" (`features/library/hooks/use-file-drop.ts:8-11`). The main process does not stop it either. `src/main/index.ts` sets `setWindowOpenHandler` (line 400) but has no `will-navigate` guard, and no other window-level `drop`/`dragover` listener exists in `src/` (the only ones are in `use-file-drop.ts:48-51`).

The PR says that after this change "dropping a file there does nothing". In practice, dragging an MP4 from Finder onto the Library replaces the renderer with the file. The app UI disappears, and so does any renderer-side state, including an export the background runner (`export-runner.ts`) is encoding in that renderer. No error explains what happened.

The Library is where a user who used to import by dropping will try it first. The simplest fix is to keep a window-wide drop guard mounted here: call `useFileDrop` with a handler that sends the files to Export or shows a toast pointing there. A broader option is an app-wide guard, such as `will-navigate` with `preventDefault` in main or a root-level dragover/drop `preventDefault`, which would also cover the other screens that never had one.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:201 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: 1440p / 4K and Fill / Fit are radiogroups that don't respond to arrow keys (confidence high)**

Both segmented controls render `role="radiogroup"` with `role="radio"` buttons (here and at line 233), but neither has a key handler. `destinationStep` in `export-page.tsx:363` deliberately skips arrows inside any radiogroup that isn't the destination row, on the premise that such a group "answers its own arrows" (`export-page.tsx:352-354`). These two groups don't, so ←/→ does nothing when focus is on them. Screen readers announce these as radio groups, so keyboard users will expect the arrows to work. Either add a roving ←/→ handler that calls `onYoutube`/`onFraming`, or drop the radio roles and use `aria-pressed` buttons.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:121 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: No test covers the new "copy in progress" part of the rail badge (confidence high)**

`useExportBadge` now adds 1 while `status === "exporting"` (lines 121-122), and the badge label says "in progress or ready" (`export.railBadge`). `sidebar.test.tsx` never mentions `exporting`, `status` or `useExportBadge`, so nothing checks the running count, the sum with the unannounced copies, or that the count goes away when the export fails (`status: "error"`, export-runner.ts:337). Consider adding a case that puts the runner in `exporting`, alone and next to a finished copy.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Library no longer handles file drops, so a dropped file can make Electron open it in place of the app (confidence medium)**

This test pins the new Library behaviour: nothing handles a file dropped on the window. It only checks that `importVideoFiles` is not called, and it ignores what `fireEvent.drop` returns (line 85). Library used to mount `useFileDrop` through its import drop zone, so window-level `dragover`/`drop` were `preventDefault`ed. Now the only caller of `useFileDrop` is `usePrepareImport` (`features/prepare/use-prepare-import.ts:55`), which only Export mounts. The hook's own doc names the risk: "a file dropped where nothing handles it makes Electron navigate the window to that file" (`features/library/hooks/use-file-drop.ts:10-11`). The main window has no `will-navigate` guard, only `setWindowOpenHandler` (`main/index.ts:400-403`). So a video dropped on Library, which until this PR was the place to drop videos, can replace the app UI with a file:// player and leave no way back. I didn't confirm Chromium's default navigation in Electron here; I'm relying on the hook's comment for that.

Suggested fix: keep a window-level handler that only calls `preventDefault` while Library (or the whole shell) is mounted. Alternatively, add a `will-navigate` guard in main. Either way, assert in this test that the drop was prevented (`expect(fireEvent.drop(...)).toBe(false)`), as `dropFiles` does in export-page.test.tsx:416.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:39 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "with and without a video" only checks the with-a-video URL (confidence high)**

The test's name says Export is active "with and without a video", but it only renders `/export/asset-1`. The bare `/export` case (`ROUTES.exportNew`, `apps/kaipu-record/src/shared/routes.ts:20`) is never checked for `aria-current`. Either add `renderAt(ROUTES.exportNew)` with the same assertion, or rename the test.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:48 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The badge's "in progress" half is never tested (confidence high)**

`useExportBadge` now adds 1 while `useExportRunner().status === "exporting"` (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:121-122`). It also drops the copy currently shown in the ready card through `libraryBadgeCount(copies, ready?.recording.assetId)`. The label these tests assert is "N copy in progress or ready", but every test only drives `noteFinishedCopy`, so the new running-export count is never exercised. One test that mocks the runner as exporting (or starts a job) would pin the new behaviour, including that the count stays after visiting Export, because only finished copies get announced.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:10 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The Library picker can still be clipped, by `.screen`'s `overflow: hidden` (confidence medium)**

The comment says `.wrap` is not a scroll box so the picker that opens below "Pick from Library" is not clipped. But on the no-video screen, `.wrap` sits inside `.screen`, which has `overflow: hidden` (`apps/kaipu-record/src/renderer/src/pages/export/export-page.module.css:15`, used at `export-page.tsx:103`). The picker panel is `position: absolute` inside a relative `.root` (`video-picker.module.css:1-18`), so `.screen` clips it. The panel opens 6px below the button and can be up to `min(320px, 45vh)` tall (about 300px in the 670px window). The zone is vertically centred between the header and the Recent exports strip, so its button sits roughly in the middle of the 614px page. My estimate puts the panel's bottom tens of pixels below the page edge. With a long Library, the last rows of the panel's own scroll would then be unreachable. I worked this out from the stylesheets and did not render it, so please check it at the default window size. If it overflows, opening the panel upward (`bottom: calc(100% + 6px)`) or capping `max-height` to the space left would fix it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.module.css:108 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: Orphaned comment for the removed import drop strip (confidence high)**

The `.importZone` rule was deleted, but the comment that described it (`NIW2-579: the "Drop a video here" strip, between the header and the toolbar.`) is still there. It now sits directly above the `.stickyBar` comment, so it reads as if it described the sticky toolbar. Delete line 108.

<!-- wachi:finding -->

