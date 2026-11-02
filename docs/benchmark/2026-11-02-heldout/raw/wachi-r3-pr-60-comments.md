## apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:415 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Re-edit box uses the tool's colour and size, not the label's (confidence high)**

The textarea's `color` and `fontSize` come from `toolState` (lines 415-417), even when it reopens an existing label. Selecting an overlay does not copy its colour or size into the tool defaults: `resolveControls` only writes them back when the user picks a new value (`components/overlay-options.tsx:37-50`). So reopening a size-L yellow label while the tool is set to S pink shows the editor in a different colour and size than the label. Text the user lays out with line breaks also looks different once committed. The screenshot editor stores `color`/`size` in its editing state and uses `editing.color ?? tools.color` and `TEXT_PX[editing.size ?? tools.textSize]` (`screenshots/annotations/annotation-layer.tsx:147-148, 374-376`). Fix: store `hit.color` and `hit.size` in `editingText` and use them for the style.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:337 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Clearing a reopened label silently keeps the old text (confidence high)**

On re-edit, an empty or whitespace-only value skips the `if (editingText && text)` branch: nothing is committed and the editor closes. The user clears the text, presses Enter, and the original label comes back without any message. The screenshot editor treats clearing a reopened label as deleting it (`screenshots/annotations/annotation-layer.tsx:302-311`). Consider either matching that behaviour, or documenting that clearing a label means "cancel".

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.test.tsx:297 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Reopen tests only cover a single-line label hit on its first line (confidence high)**

Every reopen test double-clicks a one-line `"hello"` label. None covers a multi-line label, or double-clicking its second line. So the stale `hitTest` geometry (lines 488-489 of the layer) goes unnoticed, and so does the unsized textarea when a multi-line label is prefilled. Consider adding a case that reopens a two-line label by double-clicking its second line.

<!-- wachi:finding -->

