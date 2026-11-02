## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:100 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Drag test overwrites the global electronAPI stub and never restores it (confidence medium)**

`window.electronAPI.startFileDrag = startFileDrag` replaces the stub from `src/renderer/src/test/setup.ts:153` for the rest of the file, and for later test files if the setup object is shared. The sibling test in `export-status-cards.test.tsx:143-152` uses `vi.spyOn(window.electronAPI, "startFileDrag")` and calls `mockRestore()`. Use the same pattern here so the stub is restored.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:140 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "shows only where there is an export screen" test checks only the present case (confidence high)**

The title says the button appears only where there is an export screen to open. The body renders with `onOpenExport` set and clicks it. It never renders without the prop and checks that `Open in Export →` is absent. That omission is what the library detail page relies on (`library-detail-page.tsx:513`, `preparable ? … : undefined`). Add a `queryByRole("button", { name: "Open in Export →" })` null assertion for the case without the prop.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:109 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Picture size on a copy row is predicted from the preset, not read from the copy (confidence low)**

`factsOf` calls `resolveExportTarget(preset, probe, probe.durationSec)`, where `probe` is the current page's source. The "2560 × 1440" shown on a ready row is therefore what the preset would produce for today's probe. It is not the dimensions of the saved file. That is the same math Prepare uses to make the copy, so it normally agrees. If the preset's tier rules change later, or the source is re-probed differently, older copies would show dimensions their files do not have. Showing a derived value as a fact is silent, so consider noting it in the doc comment, or reading the copy's own size if the library item carries it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:868 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Saved notice comes back on Back to the same history entry, and no test covers it (confidence medium)**

The notice is gated by `fromRecording` (read from `location.state`, library-detail-page.tsx:101) and by `noticeDismissedFor` in component state (library-detail-page.tsx:136-137). `app-root.tsx:72` navigates here with `state: { fromRecording: true }`. If the user clicks a destination card, lands on /prepare, then goes Back, the same history entry returns with the same state. The page remounts, `noticeDismissedFor` is null again, and "Saved to your Library. This is the original…" shows again (so does the top-right "Your video is ready" card, which has the same gating). That can be after the copy was exported. The page comment says "once per arrival". This test only covers dismiss-then-stay on one mount. If re-showing on Back is not wanted, clear the state when a card or ✕ is used (`navigate(..., { replace: true, state: null })`) and add a remount test.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:757 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Heavy master with copies and heavy master after "Not now" are untested; the old probe assertion was dropped (confidence medium)**

The page now shows the heavy-to-send banner on a heavy master in two new states: copies exist, or "Not now" was clicked (`heavy && !showDestinations`, library-detail-page.tsx:517). The heavy tests cover only a heavy master with the panel showing and a heavy copy. A regression that loses the "Prepare a light copy →" action on a heavy master after "Not now" would pass. The "up to 25 MB" test also lost its `probe` not-called assertion because the page now always reads the file. The comment at the top of this file (lines 10-11, "The banner and the post-recording card read the file") is stale for the same reason.

<!-- wachi:finding -->

