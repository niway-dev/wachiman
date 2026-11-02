## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Only Export takes window file drops now; a video dropped on the Library navigates the window to the file (confidence medium)**

`usePrepareImport` (which mounts `useFileDrop`) is now the only caller of `useFileDrop` outside tests. This PR removes it from the Library, which was the one page that took drops, and it is called here on Export only. `useFileDrop` is what calls `preventDefault` on `dragover` and `drop` (`features/library/hooks/use-file-drop.ts:29-47`), and `use-prepare-import.ts:32-34` says its purpose includes that "a drop never makes Electron navigate the window to the file".

Nothing else guards it. `src/main/index.ts` has no `will-navigate` or `will-navigate`-style handler, only `setWindowOpenHandler` (line 400), and no other renderer code listens for `drop` or `dragover`. So a video dragged onto the Library, the screen people will still drag files onto, takes Electron's default: the window loads `file://…` and the app UI is gone until a reload. The PR's step 12 claims "dropping a file there does nothing", but the code does not show that.

Fix: keep a drop guard that only prevents the default on pages other than Export. That can be a shared app-level `dragover`/`drop` `preventDefault`, or a `will-navigate` handler in main that blocks non-app URLs.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:251 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: "Ready" and the primary action ignore Fill/Fit, so Enter can open a copy with the other framing (confidence medium)**

`existing` is `reusable[plan.target.presetId]`, and `findReusableExports` matches only on `encodeFingerprint("whole", preset)` (`export-reuse.ts:74`). `vertical` and `square` have no `ENCODE_REVISION` entry (`export-presets.ts:177-182`), and the framing is not in the fingerprint. If the user already exported TikTok · Reels with Fit and now switches to Fill, the card shows "Ready", `hasExisting` is true, and the primary button and Enter (`primary`, line 262) open the Fit copy instead of encoding a Fill one. "Export again" is available, but Enter never reaches it. Consider treating a vertical or square copy as reusable only when its recorded framing matches the selected one, or not offering reuse for the framing destinations. I could not check whether Prepare behaved the same way, because its page is deleted in this PR.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A video dropped on the Library now navigates the Electron window to the file (confidence medium)**

The Library used to mount `useFileDrop`, which listens for `dragover` and `drop` on the window and calls `preventDefault`. That is what keeps Electron from navigating the window to a dropped file. This PR removes the hook from this page. `use-file-drop.ts:10-11` says why it exists: "a file dropped where nothing handles it makes Electron navigate the window to that file". `use-prepare-import.ts:32-34` repeats it: "a drop never makes Electron navigate the window to the file".

Nothing else guards the Library page. In `src/main` I found no `will-navigate` handler, only `setWindowOpenHandler` at `main/index.ts:400`. In the renderer, `useFileDrop` is only used by `use-prepare-import.ts`, which only Export mounts. Users who had the drop strip here will keep dropping videos on it. The window will load the raw `.mp4` and the app UI will be gone until a reload. The PR body says "dropping a file there does nothing", and `library-page.test.tsx:80` asserts only that nothing is imported. Neither covers the default action.

Fix: keep a drop guard on the Library (a `dragover`/`drop` `preventDefault` for `Files` drags, with no import), or add a `will-navigate` guard in main for the main window so a file URL cannot replace the app. The Library test should assert `event.defaultPrevented`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/recent-exports.tsx:65 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Finished Email copies show as "Slack · Discord" (confidence medium)**

A finished copy's destination comes from `destinationOfPreset(copy.export!.preset)`. Email and chat share the Balanced preset, and `destinationOfPreset` returns the first match (`destinations.ts:102-107`). A copy exported from the Email card is therefore listed with the Slack · Discord name and logo in Recent exports. The PR body lists this under its decisions. The running row uses `running.destination` first (line 50), so the same export is labelled Email while it runs and Slack · Discord once it finishes. The label changes after the export completes. Consider a neutral label for the shared Balanced preset, or recording the destination on the exported item.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:119 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Opening Export clears the badge, but the Export page never points at the finished copies (confidence medium)**

The doc comment (lines 107-108) says Export and the Library clear the finished copies because "both point at the copies". Only the Library does: `library-page.tsx:61-62` reads `useReadyCopies`/`unseenCopyIds` to outline the copy and show the chip. The Export page's `RecentExports` (`pages/export/recent-exports.tsx:26-85`) lists the 3 newest copies. It never reads the ready-copies store, marks nothing as seen and highlights nothing. A user who opens Export only because the rail says "1 copy ready" loses the badge. Nothing on that page says which copy it was, and a copy ranked below the top 3 isn't shown at all. The copy stays 'unseen' in the Library, so nothing is lost, but the rail count goes away without the user having been shown anything. Either drop `onExport` from the announce condition, or have the Export page mark or highlight unseen copies, and adjust the comment to match.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:44 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The new running-export count in the badge has no test (confidence high)**

`useExportBadge` now adds 1 while `status === "exporting"` (sidebar.tsx:121-122), and the badge label was changed to "in progress or ready". The sidebar tests only cover finished copies through `noteFinishedCopy`. Nothing covers a running export raising the count, the sum of running plus unseen copies, or the running part dropping back to 0 when the job finishes. A regression there would not be caught.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: A video dropped on the Library now falls through to Electron's default, and the test only pins that nothing imports (confidence medium)**

The Library used to mount `useFileDrop`, which calls `preventDefault` on `drop` for the whole window (`features/library/hooks/use-file-drop.ts:40-47`). Its own comment says a file dropped where nothing handles it makes Electron navigate the window to that file. This PR removes that hook from the Library. I found no `will-navigate` guard in `apps/kaipu-record/src` (only `setWindowOpenHandler` at `main/index.ts:400`), and the only remaining `drop` listener is in `use-file-drop.ts`, which Export mounts through `usePrepareImport`. So a user who drops a video on the Library, previously the main import door, now gets the window navigated to the video file and the app UI replaced. The test at line 80 asserts only `importVideoFiles` is not called. It never checks whether the drop was prevented, so it cannot tell 'ignored safely' from 'window navigates away'. If this is intended (Editor and Settings already behave this way), add `expect(fireEvent.drop(...)).toBe(...)` to document it. Otherwise keep a window-level guard on the shell, which would also cover those pages.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:73 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The 'no Prepare or Import buttons' assertions cannot fail (confidence medium)**

`queryByRole('button', { name: 'Prepare a video' })` matches nothing because the string no longer exists in `packages/i18n/messages/en.json`. A grep for 'Prepare a video' finds no match. `'Import a video'` exists only as `importVideoTitle` (en.json:77), a native dialog title, not a page button label. A button re-added under a new label would not be caught. Only the `Drop a video here` check is meaningful, and only because it reuses Export's drop-zone title. Assert something that can regress, such as `screen.queryAllByRole('button')` not containing an import or prepare action, or `queryByTestId('import-drop-zone')` being null.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-page.test.tsx:285 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: 'Enter exports, from the page or a card' only tests a card (confidence high)**

The test fires `Enter` on a card only (line 288). `Enter` from the page (target `document.body`, a selected destination) is never exercised with a selection. The only body `Enter` calls are with nothing picked (line 165), where `start` is not called because there is no plan, and with `metaKey` (line 300). `isPrimaryEnter` returns true for `document.body` (`export-page.tsx:380-385`), so that path is live and untested. Add a `fireEvent.keyDown(document.body, { key: 'Enter' })` case with `?to=github`, or narrow the test name.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:39 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test name says "with and without a video" but only checks the with-video route (confidence high)**

The test renders only `/export/asset-1`. The bare `/export` route (`ROUTES.exportNew`), the one the NavLink points at, is never asserted active. The name promises both. Add a second `renderAt(ROUTES.exportNew)` assertion, or rename the test.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.module.css:108 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: Stale NIW2-579 comment left after `.importZone` was removed (confidence high)**

The `.importZone` rule was deleted, but its comment, "the 'Drop a video here' strip, between the header and the toolbar", stays. It now sits directly above the unrelated comment for `.stickyBar`, and the Library no longer has a drop strip. Delete the line.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-stage.module.css:3 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Comment calls 900 × 670 the default window; it is the minimum (confidence medium)**

`WINDOW_PRESETS.main` in `shared/window-size.ts:50` is 1040 × 760 with `minWidth: 900` and `minHeight: 670`. The comment says the stage is sized to fit "the default 900 × 670 window", but that size is the minimum. The meaning is fine; the wording should say minimum window. The same wording may be in `export-page.module.css`, which is outside this part.

<!-- wachi:finding -->

