## review by github-actions[bot] at 2026-11-02T06:06:39Z

👮 **Wachiman** · review of the whole pull request, at `2c33d5b`: all 7 files reviewed.

6 finding(s): 4 to fix, 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟠🐛 **Fix · bug: Hit-test still uses single-line `text.length` geometry, so the second line of a label is not clickable (confidence high)** (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:488`): The PR says a multi-line label's lower half used to be unselectable and that `textBoxPx` fixes this. But the change only resizes the drawn outline (`overlay-shapes.tsx:144-145`). What a click actually selects is decided by `hitTest`, and it is unchanged: width is `o.text.length * fs * 0.55` (the full string, newlines included) and height is one line (`fs * 1.3`, lines 488-489). For a label like `"first\nsecond"`, a click or double-click on the second line misses. Pointerdown then clears the selection (line 212), and `onDoubleClick` (line 182) does not reopen the label. The hit box is also too wide to the right of the text, so it no longer matches the new outline. The screenshot editor's `hitTest` uses `textBoxPx` for this (`screenshots/annotations/annotation-layer.tsx:658`). Fix: compute `w`/`h` here from `textBoxPx(o.text, fs)`, divided by `size.w`/`size.h`.

- 🟠🐛 **Fix · bug: The label being re-edited keeps rendering under the textarea, so its text shows twice (confidence high)** (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:389`): On re-edit the SVG still draws the original overlay (lines 382-397). The textarea sits on top with `padding: 2px 4px` and an almost-transparent background (`rgba(0,0,0,0.04)`, `video-annotation-layer.module.css:36-37`). The old text is therefore visible, slightly offset, under whatever the user types, and it stays visible after they delete characters. The screenshot editor this PR ports from hides that label while it is open: `a.id === editing?.id ? null : <Shape …/>` (`screenshots/annotations/annotation-layer.tsx:351-354`). Fix: skip the overlay whose id is `editingText?.id` in the map.

- 🟠🐛 **Fix · bug: A reopened multi-line label shows only its first line until the user types (confidence high)** (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:165`): The textarea is created with `rows={1}` and `overflow: hidden`. It only resizes in `onInput` (lines 424-429), and a prefilled `defaultValue` does not fire `input`. So reopening `"first\nsecond"` shows a one-line box with the second line hidden. The open effect (lines 160-170) only focuses the textarea and leaves the caret where the browser puts it. The screenshot editor's equivalent effect sizes the textarea to its prefilled content and puts the caret at the end (`el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; el.setSelectionRange(len, len)`, `screenshots/annotations/annotation-layer.tsx:115-122`). The PR description says "every line stays visible", which is not true on reopen. Fix: run the same sizing and caret placement after `focus()`.

### Summary

Multi-line labels now draw and export correctly: the preview and the export SVG both emit one tspan per line, the same way the screenshot compositor does. Re-editing a label keeps its timeline window.

The re-edit port leaves out several steps the screenshot editor takes. In the video editor:
- **Lower lines can't be clicked.** `hitTest` still sizes a text label from `text.length` and one line, so the second line of a multi-line label can't be selected or double-clicked. The PR says this is fixed, but only the drawn outline changed.
- **The old text shows twice.** The label being edited keeps rendering under the textarea.
- **Wrong colour and size.** The editor takes them from the tool defaults instead of from the label.
- **Hidden lines on reopen.** A reopened multi-line label shows only its first line, because the textarea is never sized to the text it starts with.

Clearing a reopened label quietly does nothing; the screenshot editor deletes the label in that case. The new tests don't cover any of these cases.

<details><summary>What the change connects to (3 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Double-click a text overlay with the select tool to reopen it in place (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:179`) — On reopen the old text shows under the textarea and the editor's font and colour can differ from the label's. A multi-line label shows only its first line. Double-clicking the second line of a multi-line label does nothing, because hitTest still assumes one line. If it fails: No async work involved. The failures are silent visual mismatches, plus labels that cannot be hit on their lower lines. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:160-170`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:382-397`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:412-422`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:485-489`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:110-127`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:136-151`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:351-354`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:658`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.module.css:33-43`, `apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-options.tsx:37-50`.
- Commit a re-edited label (Enter or blur) (`apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:338`) — onCommit with the mapped overlays updates the scene and pushes one undo step. onSelect keeps the label selected. If it fails: An emptied re-edit is silently a no-op. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:332-363`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx:295-329`.
- Render and export multi-line text as one tspan per line (`apps/kaipu-record/src/renderer/src/features/video-editor/export/overlay-raster.ts:97`) — Line breaks appear in both the preview and the exported video. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/overlay-raster.ts:89-104`, `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/overlay-shapes.tsx:113-147`, `apps/kaipu-record/src/renderer/src/features/screenshots/annotations/tools.ts:69-78`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 7 | 262 | 4 | reviewed | 11 | $0.43 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · $0.43</sub>

<!-- wachi:review -->

<!-- agent-review sha=2c33d5b87c2d87a4f8706486e49009513da51d3a -->

<!-- wachi:attempt id=0892d524-488e-407b-9f1c-2acc13b15421 -->

