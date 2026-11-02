## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:85 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Dropping a video on the Library now navigates the Electron window to the file (confidence medium)**

`useFileDrop` is the only code in the renderer that calls `preventDefault` on `dragover`/`drop`. Its own comment (`features/library/hooks/use-file-drop.ts:10-11`) says a file dropped where nothing handles it makes Electron navigate the window to that file. Before this PR the Library mounted that hook, and the "Drop a video here" strip invited the drop. This PR removes `ImportDropZone` and the Library's use of the hook. A grep of `pages/` finds `usePrepareImport` (which wraps `useFileDrop`) only at this line, and a grep of `src` finds no `will-navigate` guard in main. So a user who drags a recording onto the Library, where the strip used to be, now replaces the app with the raw video and loses the session. Record, Editor and the other screens were already exposed. The Library is newly exposed, and it is the screen users drag files onto by habit. Fix by keeping a drop guard on the Library, or on the whole shell, that calls `preventDefault` and ideally points to Export. A `will-navigate` handler in main would also work. The backlog doc says the Library "no longer takes window drops" but does not mention this.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A video dropped on the Library window now navigates Electron to the file (confidence medium)**

Before this change the Library mounted `useFileDrop` (a window-level dragenter/dragover/drop handler) and imported whatever was dropped. This PR removes it, and nothing else on the Library screen takes over. Export has its own handler through `usePrepareImport` (`features/prepare/use-prepare-import.ts:55`), but that only exists while Export is mounted. Nothing in the renderer (outside `use-file-drop.ts`) handles `drop`, and `main/index.ts` has no `will-navigate` or `preventDefault` for navigation. `use-file-drop.ts:10-11` says "a file dropped where nothing handles it makes Electron navigate the window to that file". The Library was the screen with a visible "drop a video here" affordance, and the PR's own banner no longer mentions it. A user who drops a video there will probably replace the app UI with the raw file. Either keep a drop guard on the Library that preventDefaults and routes the file to Export, or add an app-wide guard (for example `will-navigate` in main, or a root-level handler that preventDefaults file drops). Other screens, such as Record and Editor, had no guard before this PR either. A root-level guard would cover them too, but I have not checked whether those screens are meant to take drops.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:121 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The in-progress half of the Export badge has no test (confidence medium)**

`useExportBadge` now adds 1 while `status === "exporting"` (sidebar.tsx:121-122). That is the new behaviour here, and the rail label says "in progress or ready". `sidebar.test.tsx` only drives `noteFinishedCopy`, so no test fails if the running term is dropped or inverted, or if the badge stops counting a running job once its ready card is on screen. I did not read the export-runner test helpers, so I can't say how hard it is to put the runner into `exporting`. Mocking `useExportRunner` or using the runner's own test hook, and asserting a badge of 1 during export and the right count at the exporting→ready handoff, would pin it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Library no longer guards file drops, so a video dropped on it navigates the window away (confidence medium)**

This test pins that Library ignores a video dropped on the window, and it passes whether or not anything handles the event. It never checks that the drop is prevented. `useFileDrop` is now mounted only through `usePrepareImport`, and that is called only from `ExportPage` (`export-page.tsx:85`). Its own comment says a file dropped where nothing handles it makes Electron navigate the window to that file (`use-file-drop.ts:10-11`). The main process has no `will-navigate` guard (grep of `src/main` finds only `setWindowOpenHandler`, `main/index.ts:400`). Before this PR the Library page mounted the hook, and Library is where users used to drop videos. Dropping an MP4 on Library will now replace the app with the raw file, so the user loses the app UI until they reload. Nothing in the UI explains this. Fix: keep a drop guard on Library that calls `preventDefault` on file drags without importing, or add a global `will-navigate` block in main. Then change this test to assert `fireEvent.drop(...)` returns `false` (default prevented), as `dropFiles` does in `export-page.test.tsx:416`. I did not read the `library-page.tsx` diff to confirm the guard was removed there, so the premise rests on the usage grep.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:39 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test name says "with and without a video" but only the with-video route is rendered (confidence high)**

The test renders only `/export/asset-1`. The bare `/export` route (`ROUTES.exportNew`), the one the rail link points to, is never checked for `aria-current`. The rail item is active through `matchPath({ path: to, end: false })` on `ROUTES.exportNew` (sidebar.tsx:68-69, 53). Add a second `renderAt(ROUTES.exportNew)` assertion, or rename the test.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:32 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The "in progress" half of the Export badge has no test (confidence medium)**

The badge is `running + libraryBadgeCount(...)`, where `running` is 1 while `useExportRunner().status === "exporting"` (sidebar.tsx:121-122). The aria label was changed to "copy in progress or ready", so the running count is new behaviour in this PR. Every test in this describe only covers finished copies via `noteFinishedCopy`. Nothing checks that an active export shows a badge of 1, or that the badge goes to 0 when the export ends. A test that drives the runner into `exporting` would cover it.

<!-- wachi:finding -->

## packages/i18n/messages/en.json:882 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: New `lineEmail`/`sayEmail`/`whyEmail` keys (and the rest of Prepare's line/say/why copy) are never read (confidence high)**

This PR adds `prepare.lineEmail`, `sayEmail` and `whyEmail` (same in es.json:882-884). With `destination-detail.tsx` and `destination-list.tsx` deleted, nothing reads them. `DESTINATION_COPY` in `features/prepare/destination-copy.ts` has a single consumer, `master-copies-panel.tsx:68`, and that reads only `.name`. `GROUP_COPY` (`destination-copy.ts:25`) has no consumer. So every `line*`, `say*`, `why*`, `groupKeep*`, `groupSendMore*` and `whyBigger/whySmaller/whyKeep` string under `prepare` is dead, and this PR adds three more. The Export screen has its own `sentence*` strings. Drop the unused fields from `DESTINATION_COPY`, delete `GROUP_COPY` and the dead keys in both locales, and don't add the three new Email keys. If a sibling branch is going to read them, say so in the doc.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.module.css:108 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: Orphaned comment for the removed drop strip (confidence high)**

The `.importZone` rule is gone, but the comment above it, "NIW2-579: the 'Drop a video here' strip, between the header and the toolbar", stays. It now sits directly on top of the `.stickyBar` comment and describes something that no longer exists in the Library. Remove it.

<!-- wachi:finding -->

