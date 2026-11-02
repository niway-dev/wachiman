# Blind findings for kaipu-record #184

Every finding below was posted by one of several automated reviewers on the same diff. Reviewer names and labels are removed. Judge each on its merits.


## F01 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/overlay-shapes.tsx:133`

**Position nonempty lines by their line index.**

For `a\n\nb`, the empty middle `` has no character to position. Its `dy` does not reserve a line, so `b` appears one line too high. The export renderer repeats this calculation at `overlay-raster.ts` Line 100. Use an absolute `y` derived from `i` in both renderers so empty lines retain their spacing. ([w3.org](https://www.w3.org/TR/SVG/text.html))


## F02 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:183`

**Use multiline bounds for the double-click hit test.**

When the user double-clicks a label’s second or later line, `hitTest` can return `null`. Its text branch still uses a one-line height at Line 489, although `OverlayShape` now draws every line. Measure the hit box with `textBoxPx` so every visible line can reopen the label.


## F03 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:337`

**Clearing a reopened label's text keeps the old text instead of removing the label **

If the user reopens a label, deletes all of its text and presses Enter or clicks away, `text` is empty, the `editingText && text` guard skips the commit, and the label keeps its old text. The screenshot editor treats a cleared re-edit as a delete (annotation-layer.tsx:302-309). Consider calling `onCommit(overlays.filter(o => o.id !== editingText.id))` for an empty re-edit, so the two editors behave the same way.


## F04 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.test.tsx:297`

**Reopen tests only cover a single-line label hit on its first line **

Every reopen test double-clicks a one-line `"hello"` label. None covers a multi-line label, or double-clicking its second line. So the stale `hitTest` geometry (lines 488-489 of the layer) goes unnoticed, and so does the unsized textarea when a multi-line label is prefilled. Consider adding a case that reopens a two-line label by double-clicking its second line.


## F05 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:415`

**Re-edit box uses the tool's colour and size, not the label's **

The textarea's `color` and `fontSize` come from `toolState` (lines 415-417), even when it reopens an existing label. Selecting an overlay does not copy its colour or size into the tool defaults: `resolveControls` only writes them back when the user picks a new value (`components/overlay-options.tsx:37-50`). So reopening a size-L yellow label while the tool is set to S pink shows the editor in a different colour and size than the label. Text the user lays out with line breaks also looks different once committed. The screenshot editor stores `color`/`size` in its editing state and uses `editing.color ?? tools.color` and `TEXT_PX[editing.size ?? tools.textSize]` (`screenshots/annotations/annotation-layer.tsx:147-148, 374-376`). Fix: store `hit.color` and `hit.size` in `editingText` and use them for the style.


## F06 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:417`

**Re-edit box uses the current tool's color and size, not the label's **

When a label is reopened by double-click, the textarea is still styled from `toolState.color` and `TEXT_PX[toolState.textSize]` (lines 415-417). Say a label is size 2 and red, and the toolbar is on size 0 and blue. While editing, the text shows small and blue. On commit it goes back to large and red, because only `text` is replaced (line 342). The editor the user types into doesn't match the label they're changing. The screenshot editor, which this code mirrors, stores the label's own color and size when it reopens it (annotation-layer.tsx:142-150) and uses them (`editing.color ?? tools.color`, `TEXT_PX[editing.size ?? tools.textSize]`, annotation-layer.tsx:374-376). Do the same here: put `color`/`size` into `editingText` in `onDoubleClick` and fall back to `toolState` only for a new label.


## F07 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:335`

**Preserve leading and trailing line breaks on commit.**

When a user inserts a trailing line break with Shift+Enter and then commits or blurs, `value.trim()` on the next line removes that break. The same call removes leading blank lines. These edits therefore cannot retain the line structure that `textLines` and `textBoxPx` support. Reject whitespace-only labels separately, but preserve the committed text.


## F08 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:337`

**Clearing a reopened label silently keeps the old text **

On re-edit, an empty or whitespace-only value skips the `if (editingText && text)` branch: nothing is committed and the editor closes. The user clears the text, presses Enter, and the original label comes back without any message. The screenshot editor treats clearing a reopened label as deleting it (`screenshots/annotations/annotation-layer.tsx:302-311`). Consider either matching that behaviour, or documenting that clearing a label means "cancel".


## F09 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:417`

**Re-edit box uses the current tool's colour and size, not the label's **

The textarea style always uses `toolState.color` and `TEXT_PX[toolState.textSize]` (lines 415, 417). That is right for a new label, but on re-edit the label keeps its own `color` and `size`: `commitText` only replaces `text` (line 342). A size-2 label reopened while the tool is at size 0 is edited in a much smaller font and possibly another colour. On commit it snaps back to its real size, so the editor doesn't show what will be rendered.

The sibling carries `color` and `size` in its editing state and uses `editing.color ?? tools.color` and `TEXT_PX[editing.size ?? tools.textSize]` (`screenshots/annotations/annotation-layer.tsx:142-150, 374-376`). Set them from `hit` in `onDoubleClick` (line 186) and use them here.


## F10 — `apps/kaipu-record/src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx:435`

**Ignore Enter while an IME composition is active.**

When an IME uses Enter to confirm a character, this handler prevents the key’s default action and commits the label before composition finishes. Check `e.nativeEvent.isComposing` before treating Enter as a commit. Based on learnings: Enter handlers must ignore IME confirmation unless they use a composition guard.

_Source: Learnings_
