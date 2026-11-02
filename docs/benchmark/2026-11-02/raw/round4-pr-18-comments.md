## apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:91 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: If the probe fails, the size cards show "…" forever, as if still loading (confidence high)**

`estimate` returns null whenever `probe` is null, and the card then renders `"…"`. The page passes `useSourceProbe(...).probe`, and that is null in the `error` state too, not only while loading (`use-prepare-copy.ts:55-57`: an unusable probe becomes `{ status: "error", probe: null }`). So on a recording the probe can't read (zero duration or zero dimensions), every card except Archive keeps showing an ellipsis that never resolves. Consider passing the probe status, or showing nothing or a neutral label once the status is `error`, so a failed read doesn't look like a load that never finishes.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:174 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The copy's Drag handle doesn't mark the copy as seen, unlike the ready card's drag (confidence medium)**

The sibling drag in `ExportReadyCard` calls `markCopySeen(recording.assetId)` before `startFileDrag` (`export-status-cards.tsx:234-235`). `ready-copies.ts:54` describes that call as "The user opened the copy or acted on it". This new handle skips the call. A copy that finished in the background and is dragged out from the master's page therefore stays unseen, and keeps counting in the sidebar's Library badge (`sidebar.tsx:95-98`) until the user opens the copy's own page. Consider calling `markCopySeen(copy.assetId)` here as well.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:140 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The "shows only where there is an export screen" test never checks the case without one (confidence high)**

The test name promises that the button is hidden when there is no export screen. The test only renders with `onOpenExport` and checks that a click calls it. Add a render without `onOpenExport` and assert `queryByRole("button", { name: "Open in Export →" })` is null. That case is the one `library-detail-page.tsx:513` relies on for non-preparable items.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:100 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The test replaces `startFileDrag` on the shared stub and never restores it (confidence high)**

`window.electronAPI.startFileDrag = startFileDrag` overwrites the stub from `test/setup.ts` for every later test in this file. `afterEach` there only runs `cleanup()` (`setup.ts:99-101`). The sibling test uses `vi.spyOn(window.electronAPI, "startFileDrag")` plus `mockRestore()` (`export-status-cards.test.tsx:143,152`). Using the same pattern here keeps the tests independent.

<!-- wachi:finding -->

