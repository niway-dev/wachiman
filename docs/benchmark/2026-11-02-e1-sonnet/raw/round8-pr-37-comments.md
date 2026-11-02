## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Show in Finder / drag on the Library card does not mark the copy seen, unlike the toast (confidence low)**

The ready toast's Show in Finder and drag handlers call `markCopySeen` first (`export-status-cards.tsx:280` and `:293`). The header of `ready-copies.ts` says a copy is seen when the user "acts on its ready card (Show in Finder, drag it out)". The Library card's two actions (`ready-copy-card.tsx:80`, `:93`) do not. After the user reveals or drags the file out, the "1 copy ready" chip and the outline on the copy stay until the card is opened or the user leaves the Library. Calling `markCopySeen` on drag start would also remove the card mid-drag, so leaving it out may be intended. If so, say it in the `ready-copies.ts` header, which currently reads as if every ready card clears on action.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:216 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: role="progressbar" nested inside a <button> is dropped by assistive tech (confidence low)**

A button's children are presentational in the accessibility tree. The `progressbar` span inside the pill button (line 216) will not be exposed, so a screen-reader user only hears "Show the export's progress" and never the percent. Tests find it by text, so they do not catch this. Put the percent in the button's `aria-label`, for example `t("pill", …)` plus the expand hint, or render the progressbar outside the button.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.module.css:180 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: `--bg-hover` is not defined, so the ✕ hover fallback is white-on-light in the light theme (confidence medium)**

`var(--bg-hover, rgba(255, 255, 255, 0.06))` uses a token that exists nowhere in the repo. I searched for a `--bg-hover:` definition in `packages/tokens/css/tokens.css` and the rest of the repo and found none. The fallback therefore always applies. It is a 6% white wash, which is invisible on the light theme's white `--bg-card` (`tokens.css` has a light block at line 61). The tokens do define `--bg-card-hover`, with a dark and a light value. Use that. `tag-editor.module.css:85` has the same undefined-token pattern but is outside this PR.

<!-- wachi:finding -->

