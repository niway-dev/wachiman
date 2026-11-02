## apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:417 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Re-edit box uses the current tool's colour and size, not the label's (confidence high)**

The textarea style always uses `toolState.color` and `TEXT_PX[toolState.textSize]` (lines 415, 417). That is right for a new label, but on re-edit the label keeps its own `color` and `size`: `commitText` only replaces `text` (line 342). A size-2 label reopened while the tool is at size 0 is edited in a much smaller font and possibly another colour. On commit it snaps back to its real size, so the editor doesn't show what will be rendered.

The sibling carries `color` and `size` in its editing state and uses `editing.color ?? tools.color` and `TEXT_PX[editing.size ?? tools.textSize]` (`screenshots/annotations/annotation-layer.tsx:142-150, 374-376`). Set them from `hit` in `onDoubleClick` (line 186) and use them here.

<!-- wachi:finding -->

