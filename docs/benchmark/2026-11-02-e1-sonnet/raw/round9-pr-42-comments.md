## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Library ready card's Show in Finder / drag don't mark the copy seen, unlike the toast (confidence medium)**

The toast's ready card calls `markCopySeen(recording.assetId)` before revealing (export-status-cards.tsx:280) and before starting the drag (:293). The header comment of `ready-copies.ts` (lines 10-11) says a copy stays unseen "until the user opens it ... or acts on its ready card (Show in Finder, drag it out)". The new Library card does neither: `onClick` at line 80 and `onDragStart` at line 93 call the IPC only. After the user reveals or drags the file out, the "N copies ready" chip and the pink outline keep pointing at a copy they just used. The card also stays in the grid until they leave the Library. If keeping the card after an action is intended, update the `ready-copies.ts` comment. Otherwise call `markCopySeen` (as the toast does) from both handlers, or pass an `onAct` callback from the page.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:38 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: File name hardcodes the extension (confidence low)**

The toast derives the extension from `recording.filePath` (export-status-cards.tsx:243) and falls back to `.mp4`. This card guesses `.gif` or `.mp4` from `video.kind`. The name is shown on screen, used in the drag button's aria-label, and used in the `title` attribute, so it can differ from the real file's name. `LibraryVideo` has no path field, so this may be the best available. A short comment saying it is a display name only would help.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.module.css:4 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Two or more Ready cards leave an empty cell in the 3-column grid (confidence medium)**

`.grid` is `repeat(3, 1fr)` with the default sparse auto-flow (`pages/library/library-page.module.css:366-371`), and every card here spans 2 columns. With a single card, the next regular card takes column 3 of that row. With two finished copies (the doc's validation step 7, `ready-copy-in-library.md:77-78`), the second card needs two columns, so it moves to the next row and column 3 of the first row stays empty. Every extra card adds another hole. Adding `grid-auto-flow: dense` to `.grid` would let the regular cards backfill. `.grid` lives in `library-page.module.css`, which is not in this part, so check it against the rest of the PR.

<!-- wachi:finding -->

