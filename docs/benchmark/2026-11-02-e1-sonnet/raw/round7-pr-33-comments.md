## apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:91 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: A failed probe leaves every non-archive card on "…" forever (confidence medium)**

`useSourceProbe` returns `probe: null` both while loading and when the read fails (`status: "error"`, use-prepare-copy.ts:42-67). `estimate()` returns null for both (line 43), so the card shows "…" with no end if the file cannot be probed. The prop doc says the cards "show no estimate until it is" read, which is true only for loading. `MasterCopiesPanel` degrades to the file size alone when `probe` is null, so the two panels handle a failed probe differently. Consider showing nothing (or a dash that does not look like loading) once the probe has errored. That needs the page to pass the status, or the panel to take a `probeFailed` flag.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.test.tsx:100 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Drag test overwrites the global `electronAPI.startFileDrag` and never restores it (confidence high)**

`window.electronAPI.startFileDrag = startFileDrag;` replaces the shared stub from test/setup.ts:153 for the rest of the file's run. The sibling test (export-status-cards.test.tsx:143-152) uses `vi.spyOn(window.electronAPI, "startFileDrag")` and `mockRestore()`. Use the same pattern here so later tests do not see the replaced mock.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:757 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The "file isn't read on this page" guard was dropped without a replacement (confidence medium)**

The old assertion `expect(probe).not.toHaveBeenCalled()` was removed. That is right for a local recording, which is now always probed. Nothing now checks the case that still must not probe: a screenshot or GIF, where `asPreparable` returns null and `useSourceProbe(null)` should stay idle. The screenshot test at lines 160-170 could assert `probe` was not called. The `probe` mock is the one the heavy-to-send describe block already uses.

<!-- wachi:finding -->

