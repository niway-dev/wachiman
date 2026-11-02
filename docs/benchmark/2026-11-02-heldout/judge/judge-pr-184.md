# Judge: kaipu-record #184 (head 2c33d5b8)

Note: jsdom has no pointer capture, so nothing about the catalogued mechanism was verified by running; all verdicts are from reading. No finding mentions pointer capture, `e.target`, `<tspan>` re-rendering, or the move branch (video-annotation-layer.tsx ~line 216).

## Per-finding

**F01** (overlay-shapes.tsx:133) - Partly valid (unconfirmed in browser). Line 131 uses `dy` on a `<tspan>`; `textLines` is `split("\n")` (tools.ts:76), so an empty middle line yields an empty tspan, and per SVG `dy` applies to a character that does not exist; the collapse is plausible but I cannot render it. Export repeats it at overlay-raster.ts:100. Severity Low (empty line inside a label is an edge case). Later fix: none seen in the path log (0208f27c touched text measurement, not this). Match: none. Quality 3 (Effect, Location, Cause, Fix clear; hedge on spec link only).

**F02** (layer.tsx:183) - Valid. hitTest text branch at lines 488-489 uses `text.length * fs * 0.55` wide and `fs * 1.3` tall, one line high, while OverlayShape draws every line (overlay-shapes.tsx:130-134). Double-clicking line 2+ returns null at line 183 and nothing opens. Severity Medium. Fixed in 4a337db4 ("measure the text hit box the same way the label is drawn"). Match: partial (same symptom, dblclick not opening, same handler path, but a bounds issue, not capture on a tspan). Quality 4.

**F03** (layer.tsx:337) - Valid. `if (editingText && text)` at 337 skips the commit for empty text, so the old label stays; screenshot editor deletes instead (cited lines not re-read by me). It is a parity/UX decision, not a crash. Severity Low. Later fix: none found. Match: none. Quality 4.

**F04** (layer.test.tsx:297) - Valid as a test-gap claim. Tests use a one-line "hello" label (the later commit 347c09ae also uses `label` "hello"), so the multi-line hit-test gap was untested. Severity Low. Later partly addressed by tests in 4a337db4/859e0080. Match: none (it does not claim any dblclick sequence gap). Quality 3.

**F05** (layer.tsx:415) - Valid. Lines 415 and 417 use `toolState.color` and `TEXT_PX[toolState.textSize]`; `editingText` (line 186) holds only x, y, id, initialText. Editor style differs from the label. Severity Low. Later fix: none found in the path log. Match: none. Duplicate group B. Quality 4.

**F06** (layer.tsx:417) - Valid, same evidence as F05; commit at 342 keeps the label's own size/color. Severity Low. Group B. Match: none. Quality 5 (concrete example with sizes and colors, fix path).

**F07** (layer.tsx:335) - Partly valid. `value.trim()` at 336 strips leading/trailing newlines. The code comment says "only the ends are trimmed", so this is deliberate; the claim that trailing breaks "cannot be retained" is true but low value, since a trailing blank line renders as an empty tspan anyway. Severity Info. Match: none. Quality 3.

**F08** (layer.tsx:337) - Valid, same as F03 (also covers whitespace-only). Severity Low. Group A with F03. Match: none. Quality 4.

**F09** (layer.tsx:417) - Valid, same as F05/F06 (hit-based fix suggestion at line 186 is accurate). Severity Low. Group B. Match: none. Quality 5.

**F10** (layer.tsx:435) - Valid but weak. The Enter handler (lines 433-435) has no `isComposing` guard; for IME users Enter confirming a composition would commit early. Based on a "learning", not on the diff's behavior; the textarea code predates or mirrors the screenshot editor. Severity Low. Later fix: none found. Match: none. Quality 3.

## Duplicates
- Group A: F03, F08 (clear reopened label keeps old text).
- Group B: F05, F06, F09 (editor uses tool color/size, not the label's).

## Catalogued bug
No finding matches. The real bug (pointer capture on `e.target`, a `<tspan>`, at the move branch, so the two clicks of a dblclick lose a shared target) was missed by all ten. F02 is the only partial: same user symptom and same `onDoubleClick` path, different mechanism.

## Final table

| F-id | verdict | severity | catalogued match | duplicate group | quality |
|---|---|---|---|---|---|
| F01 | Partly valid | Low | none | - | 3 |
| F02 | Valid | Medium | partial | - | 4 |
| F03 | Valid | Low | none | A | 4 |
| F04 | Valid | Low | none | - | 3 |
| F05 | Valid | Low | none | B | 4 |
| F06 | Valid | Low | none | B | 5 |
| F07 | Partly valid | Info | none | - | 3 |
| F08 | Valid | Low | none | A | 4 |
| F09 | Valid | Low | none | B | 5 |
| F10 | Valid | Low | none | - | 3 |

Quality quotes (<=25 words): F06 "While editing, the text shows small and blue. On commit it goes back to large and red"; F02 "hitTest can return null. Its text branch still uses a one-line height"; F10 "Check `e.nativeEvent.isComposing` before treating Enter as a commit."
