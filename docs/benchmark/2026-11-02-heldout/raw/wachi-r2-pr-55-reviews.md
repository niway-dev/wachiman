## review by github-actions[bot] at 2026-11-02T06:06:01Z

👮 **Wachiman** · review of the whole pull request, at `2c33d5b`: all 7 files reviewed.

4 finding(s): 4 to fix; 1 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟠🐛 **Fix · bug: Hit-test still treats a text label as a single line, so lines 2+ can't be clicked or double-clicked (confidence high)** (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:488`): The outline in `overlay-shapes.tsx:116,144-145` now uses `textBoxPx`, but the layer's own `hitTest` still sizes a text overlay from `o.text.length * fs * 0.55` and `fs * 1.3` (lines 488-489). For `"first\nsecond"` the hit box is one line tall and as wide as the whole string. Clicking the second line of a multi-line label, inside the dashed outline, misses: it can't be selected, moved, or double-clicked to reopen. `onDoubleClick` (line 182) and `onPointerDown` (line 211) both go through this `hitTest`. So the comment at `overlay-shapes.tsx:137-139` and the PR body ("half of it was not selectable") describe a fix that only changed the drawn rect.

The screenshot sibling already does this right at `screenshots/annotations/annotation-layer.tsx:657-660` (`textBoxPx(a.text, fs, widthPx)` divided by the layer size). Use `textBoxPx(o.text, fs)` here too. None of the new tests double-clicks below the first line (the test helper clicks at the label's origin, `video-annotation-layer.test.tsx:303`), so this gap went uncaught.

- 🟠🐛 **Fix · bug: Reopening a multi-line label shows only its first line (confidence high)** (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:165`): The textarea opens with `rows={1}` and `overflow: hidden` (lines 406, 421). The only code that sizes it to its content is `onInput` (lines 424-429), which runs only after a keystroke. A label reopened with `initialText = "first\nsecond"` therefore opens one row tall, and every line after the first is clipped and invisible until the user types something. The user edits text they can't see, and an immediate Enter or blur commits it as is.

The screenshot sibling handles this in its focus effect at `screenshots/annotations/annotation-layer.tsx:117-122`. It sets `height = scrollHeight` for the prefilled value and puts the caret at the end with `setSelectionRange`. The focus effect here (lines 160-170) only calls `focus()`. Port those lines.

- 🟠🐛 **Fix · bug: The label being re-edited is still drawn under the editor, so its old text shows through (confidence high)** (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:387`): While `editingText.id` is set, the overlay loop (lines 382-397) still renders that overlay. The textarea's background is `rgba(0, 0, 0, 0.04)` (`video-annotation-layer.module.css:37`), which is nearly transparent. The old text therefore shows through under the text being typed, and each edit that changes a character draws both versions on top of each other. The ported screenshot editor skips the label being edited for this reason (`screenshots/annotations/annotation-layer.tsx:351-352`: `a.id === editing?.id ? null : ...`). Add the same skip for `o.id === editingText?.id`.

### Summary

I found four problems, all fixable in this PR, and none blocks the merge.

The export and preview tspan changes are correct and match the screenshot compositor. The video re-edit port leaves out several things the screenshot editor already does:

1. **Hit-test is still single-line** (`video-annotation-layer.tsx:488`). `hitTest` sizes a text label as one line. Lines 2+ of a multi-line label can't be selected, moved or double-clicked, even though the new outline is drawn around them.
2. **Reopened text is clipped** (`video-annotation-layer.tsx:165`). A reopened multi-line label opens one row tall and the other lines stay hidden until the user types.
3. **Old label shows through** (`video-annotation-layer.tsx:387`). The label being edited is still drawn under the nearly transparent textarea, so old and new text overlap.
4. **Wrong font size and colour while editing** (`video-annotation-layer.tsx:417`). The editor uses the current tool's colour and size instead of the label's own.

The new tests miss all four: they only double-click at the label's origin and never look at the editor's layout.

<details><summary>What the change connects to (4 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Double-click a text label with the select tool to reopen it for editing (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:179`) — A prefilled textarea appears at the label's position. For a multi-line label only the first line is visible, the old label shows through underneath, and the font follows the current tool size. Clicks on line 2+ don't open the editor at all. If it fails: Silent: hidden lines stay hidden until a keystroke, and a missed hit does nothing. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:160-170`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:179-187`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:382-397`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:406-422`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:485-489`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:115-122`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:142-150`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:351-352`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.module.css:33-43`.
- Commit a re-edited label (Enter or blur) (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:338`) — onCommit with the mapped overlays array, so the timeline window (start/end) is kept. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:332-363`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:295-312`.
- Typing in the textarea while the video editor's global shortcuts are active (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:402`) — The page's key guard treats TEXTAREA as text editing just as it did INPUT, so shortcuts such as Delete don't fire while typing. Evidence: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx:164`.
- Export a multi-line text overlay as tspans (`apps/kaipu-record/src/renderer/src/features/video-editor/export/overlay-raster.ts:97`) — Line breaks are kept in the exported video. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/overlay-raster.ts:91-103`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/tools.ts:76-78`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 7 | 262 | 4 | reviewed | 13 | $0.49 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · $0.49</sub>

<!-- wachi:review -->

<!-- agent-review sha=2c33d5b87c2d87a4f8706486e49009513da51d3a -->

<!-- wachi:attempt id=784459ef-2f5a-4098-ab11-e9b37463811d -->

