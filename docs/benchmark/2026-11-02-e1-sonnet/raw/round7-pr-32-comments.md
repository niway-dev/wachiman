## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Show in Finder and drag on the Library card never mark the copy as seen, unlike the toast (confidence medium)**

`ExportReadyCard` calls `markCopySeen(recording.assetId)` before revealing (`export-status-cards.tsx:280`) and before starting the drag (`:293`). The header of `ready-copies.ts:9-11` says a copy is unseen until the user "acts on its ready card (Show in Finder, drag it out)". The new Library card does neither (`ready-copy-card.tsx:80` and `:93`). After the user reveals or drags the file out of this card, the copy stays in `ready-copies`. Once the card retires on leaving the Library, the regular card keeps the "just ready" outline and the "1 copy ready" chip (`library-page.tsx:171`) until the copy page is opened. Either mark the copy seen on these actions, or update the `ready-copies.ts` comment to say the Library card's actions deliberately leave it unseen. Marking it seen also removes the card at once (`markCopySeen` filters the copy out), so decide whether the card should vanish on click.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:225 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test name says it "forgets" the copy but asserts only the route (confidence high)**

"opening the copy goes to its page and forgets it" only checks `router.state.location.pathname`. The `markCopySeen` call in `onOpen` (`library-page.tsx:416`) is not asserted, so removing it would leave the test green. Add `expect(getReadyCopies().copies).toEqual([])` or drop "forgets it" from the name. In this router the `/library/:assetId` route is a plain div and the sidebar is not mounted, so nothing else would mark it seen.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:199 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Pill's progressbar sits inside a button whose aria-label hides it (confidence medium)**

The pill is a `<button aria-label={t("expand")}>` with a `role="progressbar"` span inside. A button's descendants are presentational for assistive tech, and the button's own label overrides its content. A screen-reader user therefore hears "Show the export's progress" and never the destination or percent. The tests pass only because they query by text. Put the percent in the button's accessible name (for example the `pill` text plus the expand hint), or drop the nested progressbar role.

<!-- wachi:finding -->

