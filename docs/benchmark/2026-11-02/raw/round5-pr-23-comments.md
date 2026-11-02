## apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:91 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A failed probe leaves every non-archive card on "…" forever (confidence high)**

The panel takes only `probe` and treats `null` as "not read yet", so it shows `…` (line 91). The page passes `useSourceProbe(...).probe` (library-detail-page.tsx:142). That hook returns `{ status: "error", probe: null }` when the file can't be read or the probe is unusable, which includes a duration of 0 (use-prepare-copy.ts:29-31, 55-57). On a recording like that, all six destination cards except Archive show the loading ellipsis for good, and nothing tells the user the estimate is unavailable. The heavy-to-send text next to it already handles this case with `heavyBannerBodyNoEstimate`. Fix: pass the probe status (or an `estimateUnavailable` flag) and drop the size line, or show a "no estimate" label, when the status is `error`.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:100 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The test overwrites the shared `startFileDrag` stub and never restores it (confidence high)**

`window.electronAPI.startFileDrag = startFileDrag` replaces the stub that test/setup.ts:109 installs once per file, and the test never puts it back. Every later test in this file runs against the leftover `vi.fn()`. The sibling test does `vi.spyOn(window.electronAPI, "startFileDrag")` and then `mockRestore()` (export-status-cards.test.tsx:143,152). Using that pattern here would keep the tests independent.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:140 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The "Open in Export → shows only where…" test never checks the case where the button should be absent (confidence high)**

The test's name promises the button appears only when there is an export screen to open. It only renders with `onOpenExport` set and clicks the button. It never renders without the prop to check that the button is missing, which is the case the page relies on for non-preparable items (library-detail-page.tsx:513). Add a render with no `onOpenExport` and assert `queryByRole("button", { name: "Open in Export →" })` is null. Separately, every render passes `probe`, so the "only the file size" fallback in `factsOf` has no test either.

<!-- wachi:finding -->

