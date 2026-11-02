## apps/kaipu-record/src/renderer/src/pages/export/export-page.tsx:117 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Every library re-list unmounts the Export screen and throws away the picked destination (confidence medium)**

`ExportPage` returns the "Loading" placeholder whenever `isLoading` is true (line 117), before it gets to `<ExportScreen>`. `useLocalLibrary().refresh` sets `isLoading` back to true on every re-list (`use-local-library.ts:42`), not only the first one, and it re-lists on every `library:changed` broadcast (`use-local-library.ts:133`). Main sends that broadcast after the catalog refresh that the hook starts on mount succeeds (`use-local-library.ts:130`, `main/library/index.ts:73-76`), on account changes (`index.ts:85-87`), and when items are saved or imported (`index.ts:185`, among others).

Each time this happens, `ExportScreen` unmounts and mounts again. Its `selected`, `youtube` (1440p/4K) and `framings` (Fill/Fit) state go back to `initialDestination` from `?to=`, and the screen flashes "Loading…". In practice:
- A signed-in user picks a card in the first moments after opening Export, and the catalog refresh then resets it to "Where is it going?".
- The PR says Export stays on screen after an export starts. When the copy is saved and the library re-lists, the user's choice is wiped.

The `chosen` ref is cleared only when `assetId` changes (lines 78-80), so it keeps the old pick while the visible selection has reset. A dropped video or "Change video" then opens with a destination the screen no longer shows.

Suggested fix: show the placeholder only while the video is not available yet, e.g. `if (isLoading && !video)`. Keeping `ExportScreen` mounted across a refresh is safe because its `key` is `preparable.id` (line 152).

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:53 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A file dropped on the Library now navigates the whole window to that file (confidence high)**

This PR removes the `useFileDrop` call from the Library. That hook was the only window-level `dragover`/`drop` handler on this screen. In its own doc comment, the hook explains why it covers the whole window: "a file dropped where nothing handles it makes Electron navigate the window to that file" (`features/library/hooks/use-file-drop.ts:9-11`).

Nothing else guards against this:
- The renderer adds no other `drop` or `dragover` listener (the only ones are in `use-file-drop.ts:48-51`).
- `src/main/index.ts` has no `will-navigate` handler.

So after this change, dragging an MP4 from Finder onto the Library replaces the app with the file. The user loses the app UI and any in-memory state until a reload. Before this change, the same drop imported the video.

The PR body says "dropping a file there does nothing" (test step 12). That is not what will happen.

Suggested fix: keep a window-level guard on the Library that calls `preventDefault` on `dragover` and `drop` and ignores the files. This keeps the decision that the Library no longer imports. Even simpler, call `useFileDrop(() => {})`, or route the drop to Export.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-stage.tsx:312 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Screen readers don't hear the GitHub limit verdict on the size bar (confidence medium)**

The size card is `role="img"`, so assistive tech reads only its `aria-label`. That label is `barLabel` ("Your recording {from}, the copy {to}"). It leaves out the `tag`: "fits the 10 MB limit", "over GitHub's 10 MB free-plan limit" or "N% lighter". It also leaves out the `barPicture` line.

For GitHub, whether the copy fits the free-plan limit is the main thing this card tells the user, and a screen reader never announces it. Consider adding `tag` to the label, or dropping `role="img"` and keeping only the bar `aria-hidden`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:117 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Opening /export/:assetId clears the badge, but that screen doesn't show the finished copies (confidence high)**

`onExport` matches with `end: false`, so `/export/<assetId>` also calls `announceReadyCopies()`. That URL is what a recording page's "Prepare for…" and its quick chips now open. On that route, though, `ExportPage` renders the recording's header and stage. `RecentExports`, the list that actually points at finished copies, only renders on the bare `/export` (export-page.tsx:101-112).

So here is what happens: a copy finishes out of sight, then the user opens Export for a different recording. The badge clears even though nothing on screen pointed at the copy. That contradicts the doc comment's "both point at the copies" (sidebar.tsx:107-108). The copy is still outlined in the Library, so nothing is lost; only the rail's reminder goes away.

To match the comment, announce only on an exact match of `ROUTES.exportNew` (`end: true`), as the Library check does. The comment at line 52 ("Active on /export and /export/:assetId") is about the highlight and can stay as it is.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟠🧪 **Fix · tests: "does not take a video dropped on the window" passes even if Library still handles drops (confidence high)**

This test removed the `pathForFile` mock. The test setup's default is `pathForFile: () => ""` (`src/renderer/src/test/setup.ts:156`), and `importDropped` puts any file with an empty path into `skipped` and returns before it calls `importVideoFiles` (`features/library/hooks/use-import-videos.ts:102-111`). So `expect(importVideoFiles).not.toHaveBeenCalled()` would also pass if Library still mounted `useFileDrop`. Set `window.electronAPI.pathForFile = vi.fn((f) => `/Users/me/Movies/${f.name}`)` as the Export tests do (`export-page.test.tsx:421`), so the assertion can actually fail.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:85 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Library no longer stops a dropped file from replacing the app window (confidence medium)**

The new test makes sure Library does not import a dropped file, but it does not check what happens to the drop instead. `useFileDrop` explains why the whole window had a listener: "a file dropped where nothing handles it makes Electron navigate the window to that file" (`features/library/hooks/use-file-drop.ts:9-11`). After this change, `usePrepareImport`/`useFileDrop` is only mounted on Export (`pages/export/export-page.tsx:85`); no other renderer code listens for `dragover` or `drop`. The main window also has no `will-navigate` guard (`src/main/index.ts:400-403` only sets `setWindowOpenHandler`).

Result: a user who drops a video on Library out of habit (it used to import) sees the app replaced by the raw file. No error appears, and they have to reload to get the app back. The Export test checks exactly this case (`!fireEvent.drop(...)`, `export-page.test.tsx:414-416`); this test should check it too.

Suggested fix: keep a window-level handler in the app shell that calls `preventDefault` on file `dragover`/`drop` events nothing else handles (or add a `will-navigate` guard in main), and assert here that `fireEvent.drop(document.body, …)` returns false.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/shell/sidebar.test.tsx:39 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "with and without a video" only checks the with-video URL (confidence high)**

The test is named "is active on Export with and without a video", but it only renders `/export/asset-1`. Nothing checks bare `/export` (`ROUTES.exportNew`), which is the case that depends on the `end: false` default in `isActive` (sidebar.tsx:68-69). Add a second `renderAt(ROUTES.exportNew)` plus the `aria-current` assertion so the test covers both halves of its name.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/export/export-drop-zone.module.css:10 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The Library picker can still be clipped, by `.screen`'s `overflow: hidden` (confidence medium)**

This comment drops the scroll box so that "the Library picker opens below its button and must not be clipped". But the empty state renders inside `.screen` (export-page.tsx:103), and `.screen` has `overflow: hidden` (export-page.module.css:15). The picker panel is `position: absolute; top: calc(100% + 6px); max-height: min(320px, 45vh)` (video-picker.module.css:6-12), and its containing block is the `.root` inside `.screen`, so `.screen` still clips it.

At the minimum window size (900 × 670, window-size.ts:50) the page is 828 × 614. The header sits above the zone and the Recent exports panel below it, so a panel up to ~300px tall that opens below the button near the bottom of the centred zone can run past the bottom of `.screen`. When it does, the bottom of the list is cut off and the last rows can't be scrolled into view. I estimated these heights from the CSS and did not measure them.

Possible fixes: open the picker upward when there isn't room, render it in a portal, or cap its `max-height` to the space below the button.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.module.css:108 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: Orphaned comment for the removed import drop strip (confidence high)**

The `.importZone` rule was deleted, but its comment ("NIW2-579: the 'Drop a video here' strip, between the header and the toolbar.") is still here. It now sits right above the `.stickyBar` comment, so it reads as if it describes the sticky bar. Delete line 108.

<!-- wachi:finding -->

