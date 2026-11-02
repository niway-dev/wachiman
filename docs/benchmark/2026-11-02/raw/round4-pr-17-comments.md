## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Show in Finder / drag on the Library ready card do not mark the copy seen, unlike the ready toast (confidence high)**

The ready toast's sibling actions call `markCopySeen(recording.assetId)` before `revealLocalRecording` and `startFileDrag` (`export-status-cards.tsx:280` and `:293`). The store's own contract also says a copy stays unseen only until the user "acts on its ready card (Show in Finder, drag it out)" (`ready-copies.ts:10-11`). This card calls the two IPCs without that step. Say the user reveals or drags the file from here and then leaves the Library. `retireReadyCards` turns the card off, but the copy is still in the store. Its regular card keeps the just-ready outline, and the "1 copy ready" chip keeps counting it until the copy's page is opened. Calling `markCopySeen` here would remove the copy right away, card included (`ready-copies.ts:76-79`). If that is too abrupt, mark it at retire time instead, or update the contract comment to say that only opening the copy counts as seeing it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:225 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "…and forgets it" test never checks that the copy was forgotten (confidence high)**

The test only checks `router.state.location.pathname`. It never checks that `markCopySeen` ran, for example that `getReadyCopies().copies` is empty afterwards. If the `markCopySeen` call in `onOpen` (`library-page.tsx:416`) were dropped, this test would still pass, because the page under test renders without the Sidebar, which marks the copy seen on the detail route.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/ready-copy-in-library.md:78 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Validation step 7 lists the cards oldest first while saying "newest first" (confidence high)**

Step 7 makes a GitHub copy and then a chat copy, says the Library shows them "newest first", and then lists "FOR GITHUB / FOR CHAT, Drag to GitHub / Drag to Slack". `readyCards` reverses the oldest-first list (`ready-copies.ts:103-105`), so the chat card comes first. The PR body's step 7 has the right order ("FOR CHAT / Drag to Slack, then FOR GITHUB / Drag to GitHub"). A QA reader following the doc will expect the wrong order. Suggested wording: "FOR CHAT / FOR GITHUB, Drag to Slack / Drag to GitHub".

<!-- wachi:finding -->

## packages/i18n/messages/en.json:1431 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: The PR body describes email strings that are not in this change (confidence high)**

Under "Email wording", the PR body says email has its own destination and its own text: "Exporting for email", "Email copy ready", "Drag to an email" and a FOR EMAIL tag. None of the `backgroundCopy` selects here (`progressTitle`, `readyTitle`, `pill`, `dragTo`, `destinationTag`) has an `email` branch. `DESTINATION_IDS` (`apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-43`) also has no `email`, so the code itself is consistent. Was the email work meant to be in this head, or should that bullet come out of the description? The new doc's banner (`ready-copy-in-library.md:8-9`) also says the branch is stacked on #459, while the body says #466.

<!-- wachi:finding -->

