## apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:417 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Re-edit box uses the current tool's color and size, not the label's (confidence high)**

When a label is reopened by double-click, the textarea is still styled from `toolState.color` and `TEXT_PX[toolState.textSize]` (lines 415-417). Say a label is size 2 and red, and the toolbar is on size 0 and blue. While editing, the text shows small and blue. On commit it goes back to large and red, because only `text` is replaced (line 342). The editor the user types into doesn't match the label they're changing. The screenshot editor, which this code mirrors, stores the label's own color and size when it reopens it (annotation-layer.tsx:142-150) and uses them (`editing.color ?? tools.color`, `TEXT_PX[editing.size ?? tools.textSize]`, annotation-layer.tsx:374-376). Do the same here: put `color`/`size` into `editingText` in `onDoubleClick` and fall back to `toolState` only for a new label.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:337 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Clearing a reopened label's text keeps the old text instead of removing the label (confidence high)**

If the user reopens a label, deletes all of its text and presses Enter or clicks away, `text` is empty, the `editingText && text` guard skips the commit, and the label keeps its old text. The screenshot editor treats a cleared re-edit as a delete (annotation-layer.tsx:302-309). Consider calling `onCommit(overlays.filter(o => o.id !== editingText.id))` for an empty re-edit, so the two editors behave the same way.

<!-- wachi:finding -->

