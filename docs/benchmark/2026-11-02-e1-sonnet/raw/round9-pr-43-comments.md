## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:189 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: "Where is it going?" can flash back when a copy's export finishes (confidence medium)**

`hasCopies` is `exports.length > 0 || running !== null` (l.189), and `running` comes from `runningCopyOf`, which is non-null only while `status === "exporting"` (master-copies-panel.tsx:35). When the export finishes, `running` goes to null at once. `exports` only fills after the `readyId` effect's async `refresh()` (l.146-148) returns. In that gap `hasCopies` is false, so `showDestinations` is true and the DestinationsPanel reappears. The "Export a copy" button disappears with it, and the page layout jumps until the re-list lands. A short-lived state, but it is a visible flicker on the happy path. Consider treating a ready copy for this asset as "has copies" until the list catches up, for example by also checking `runner.ready?.recording.derivedFromAssetId`, or whatever field links the new recording to its source.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:100 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Drag test overwrites the global `electronAPI.startFileDrag` and never restores it (confidence high)**

`window.electronAPI.startFileDrag = startFileDrag` replaces the shared stub from test/setup.ts:153 for the rest of the file. The sibling test in export-status-cards.test.tsx:143-152 uses `vi.spyOn(...)` and `mockRestore()`. Use `vi.spyOn(window.electronAPI, "startFileDrag")` with a restore, so a later test in this file cannot read a leaked mock.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:74 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The GitHub row's size assertion is loose and skips its picture size (confidence medium)**

`getByText("9.0 MB", { exact: false })` matches any element whose text contains "9.0 MB". The YouTube row asserts the full `"2560 × 1440 · 22 MB"`, but the Light row does not assert its derived dimensions. The `resolveExportTarget(preset, probe, …)` branch in `factsOf` (master-copies-panel.tsx:109) is therefore only checked for the YouTube canvas preset. Assert the exact facts string for the Light row too, which checks the tier path.

<!-- wachi:finding -->

## packages/i18n/messages/en.json:778 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: The page says "Export"; the screen it opens says "Prepare" (confidence medium)**

The recording page now labels the action "Export a copy" (line 778), "Open in Export →" (786) and "Export a copy for {destination}" (785). Those all open the screen whose own strings still read "Prepare for {destination} · {size}" (878-879) and "Prepare another video" (806). The heavy-to-send banner (766) also still says "Prepare a light copy →". The same page can show "Export a copy" and "Prepare a light copy →" at once, and both go to the same screen. The Spanish file repeats this: "Exportar una copia" and "Abrir en Exportar →" against that screen's "Preparar…" strings. `backlog/prepare-screen.md` calls it Prepare throughout, and `backlog/export-presets` calls the editor's own sheet Export. Pick one name for the screen, or say in the doc why the page names it differently.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:269 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: No test for a file that can't be read: the cards keep "…" with no error (confidence medium)**

`useSourceProbe` turns an unreadable file into `status: "error", probe: null` (`use-prepare-copy.ts:51-58`), and the page keeps only `.probe` (`library-detail-page.tsx:142`). In `DestinationsPanel`, a null probe makes every non-archive card show "…" (`destinations-panel.tsx:43,91`). A failed read looks the same as a read in progress, and the "…" never goes away. Clicking a card still works, and Prepare then shows its own "Couldn't read this recording" toast. Before this PR the page read the file only for heavy recordings; now every local recording is read, so this failure is on the common path. The new card-size test only covers a successful probe (`probe` mock at lines 12-21). Add a case where `probe` resolves to an unusable result. Decide whether the cards should show nothing, or a dash, instead of "…" once the read has failed.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:757 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The doc's "heavy master with copies keeps the banner" case has no test (confidence medium)**

`prepare-screen.md` says "A heavy copy, or a heavy master with copies, keeps the banner". The page's rule is `heavy && !showDestinations` (`library-detail-page.tsx:517`). The tests cover a heavy master with no copies (the hint folds into the panel, line 712) and the banner on a heavy item (line 741). None puts a heavy master together with an existing copy. The Drag handle and the running row are also not exercised through the page. Add one heavy-master-plus-copy test so the `!showDestinations` condition is pinned.

<!-- wachi:finding -->

