## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Dragging a copy out doesn't mark it seen, unlike the ready card's Drag (confidence high)**

The other `startFileDrag` call site for a finished copy, `ExportReadyCard` (`features/status-cards/export-status-cards.tsx:231-235`), calls `markCopySeen(recording.assetId)` before it starts the native drag, and its test checks that this clears the ready-copies list. This new Drag handle starts the same drag for the same kind of file but skips that step. So a copy the user has just dragged into Slack or Finder from "Copies from this original" stays outlined as unseen in the Library and keeps counting toward the "copy ready" chip and the rail badge (`ready-copies.ts:55-80`). Consider calling `markCopySeen(copy.assetId)` in `onDragStart` here as well.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:91 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: An unreadable file leaves every estimate on "…" for good (confidence medium)**

The page passes only `useSourceProbe(...).probe` (`library-detail-page.tsx:142`). On a failed read, `useSourceProbe` returns `{ status: "error", probe: null }` (`use-prepare-copy.ts:55-57`), so the panel gets the same `null` it gets while loading, and every card except Archive shows the loading ellipsis forever. Before this PR the page only probed heavy or fresh recordings and the strip showed no numbers, so this state is new. Consider passing the probe status, so that on error the cards drop the size line (or say it is unknown) instead of looking like they are still loading.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:140 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "shows only where there is an export screen" never checks that it's hidden (confidence high)**

The test's name says the button shows *only* when there is an export screen, but it only renders with `onOpenExport` and clicks the button. The other half of the contract, that there is no "Open in Export →" button when `onOpenExport` is omitted (the page omits it for a non-preparable source, `library-detail-page.tsx:513`), is never asserted. Add a `renderPanel([copy({})])` case that expects `queryByRole("button", { name: "Open in Export →" })` to be null, or rename the test.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/prepare-screen.md:184 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: QA step says to drag the copy's row, but only the Drag handle starts a file drag (confidence high)**

The validation script says "Drag the copy's row out of the page into Finder". In `master-copies-panel.tsx:164-179` only the separate **Drag** button is `draggable` and calls `startFileDrag`. The rest of the row is a `<Link>` (`master-copies-panel.tsx:153`), so dragging it starts the browser's default link drag, which carries a URL, not the file. Anyone following the QA step literally would see a failure that isn't real. Suggested wording: "Drag the copy's Drag handle into Finder". Line 110 of the same doc already describes the handle correctly.

<!-- wachi:finding -->

