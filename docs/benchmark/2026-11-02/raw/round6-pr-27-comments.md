## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Show in Finder / drag on the Library ready card do not mark the copy seen, unlike the ready toast (confidence high)**

`ExportReadyCard` calls `markCopySeen(recording.assetId)` before `revealLocalRecording` and before `startFileDrag` (export-status-cards.tsx:280 and :293). `ready-copies.ts:10-11` states the contract: a copy is unseen until the user opens it "or acts on its ready card (Show in Finder, drag it out)". The new `ReadyCopyCard` calls the same two IPCs at lines 80 and 93 but never calls `markCopySeen`. So after a user reveals or drags the copy out from the Library card, the big "Ready to upload" card stays at the top of the grid, and the copy keeps its "N copy ready" chip and its outline after the card retires. Fix: call `markCopySeen(video.assetId)` in both handlers, as the toast does. The library-page test at library-page.test.tsx:196-213 could also assert that the card is gone afterwards.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:202 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The pill's progressbar sits inside a button whose aria-label replaces its content (confidence medium)**

The pill is a `<button aria-label={t("expand")}>` that contains a `role="progressbar"` span. A button's children are presentational, so assistive tech announces only "Show the export's progress". The percent and the destination ("YouTube copy · 38%") never reach a screen reader while the widget is minimized. One option: drop the button's aria-label so its visible text becomes its name, or put the percent into the label.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.module.css:180 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: `--bg-hover` is not defined, so the ✕ hover always uses a white tint that does not show in the light theme (confidence medium)**

`.dismiss:hover` uses `var(--bg-hover, rgba(255, 255, 255, 0.06))`. No `--bg-hover` token is defined in `packages/tokens/css/tokens.css` or anywhere under the renderer, so the fallback always applies. The light theme exists (`[data-theme="light"]`, tokens.css:58, where `--bg-card` is `#ffffff`). On that background, a 6% white tint gives the close button no visible hover state. The existing `--bg-card-hover` token is defined for both themes (tokens.css:11, :62) and would work.

<!-- wachi:finding -->

