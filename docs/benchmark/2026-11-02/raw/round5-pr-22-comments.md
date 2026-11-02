## apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Show in Finder and the drag on the Library's ready card leave the copy marked unseen (confidence high)**

The toast's version of these actions calls `markCopySeen(recording.assetId)` before both `revealLocalRecording` and `startFileDrag` (`export-status-cards.tsx:280` and `:293`). The ready-copies store defines that contract: a copy is unseen "until the user opens it ... or acts on its ready card (Show in Finder, drag it out)" (`ready-copies.ts:10-11`).

The new Library card skips that call on Show in Finder (line 80) and on drag start (line 93). Here is what happens: the user drags the YouTube copy from the Library's "Ready to upload" card into YouTube Studio, then leaves the Library. `retireReadyCards` removes the card, but the copy is still in `unseenCopyIds`. When the user comes back, the regular card is still outlined and the "1 copy ready" chip still counts it, even though the user already uploaded it. Only opening the copy's page clears it.

Fix: call `markCopySeen(video.assetId)` in both handlers, as the toast does. That also removes the card right away, which matches the toast's behaviour.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library/library-page.test.tsx:225 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "opening the copy goes to its page and forgets it" only checks the navigation (confidence high)**

The test checks `router.state.location.pathname` but never checks that the copy was forgotten. It doesn't assert that `getReadyCopies().copies` no longer contains `asset-copy`, even though `onOpen` calls `markCopySeen` (`library-page.tsx:416`). If someone removed that call, the test would still pass. Add an assertion on the ready-copies store, or on the absence of the ready card.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/background-copy-toasts.md:16 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Update banner leaves the page's strings and validation steps stale (confidence high)**

The banner mentions the ✕ → pill change and the move to the bottom right, but it does not cover the renamed strings. Several lines still describe the old copy: the frontmatter description and line 29 ("Preparing your YouTube copy…", "· you can keep working"), lines 33–36 and 68 ("Your YouTube copy is ready", **Drag to upload**), line 37 and validation step 5 at line 67 ("Preparing your export…" / "Your export is ready"), and step 2 at line 62 ("Click ✕: the card goes away"). In `packages/i18n/messages/en.json:1413-1430` these are now "Exporting for YouTube", "YouTube copy ready", "Exporting your video" and "Drag to YouTube Studio", and the ✕ is now a − that minimizes. If someone runs this page's steps for owner QA, they fail on wording alone. Either say in the banner that those strings and steps are superseded, or update them.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/ready-copy-in-library.md:30 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Leaving the Library retires cards that were never shown (confidence high)**

This page says a card stays until the user opens it, closes it, or "leaves the Library and comes back". Line 58 adds that only cards the filters show lead the grid, and only in grid view. But `retireReadyCards` (`ready-copies.ts:97-100`) clears `card` on every copy. `useLibraryBadge` calls it on any exit from the Library route (`sidebar.tsx:102`), whether or not the card was rendered. Say a copy finishes while the user is in list view or has a filter that hides it. After they leave, its Ready to upload card never appears, though the copy is still outlined as unseen. If that is intended, say so here. Otherwise only retire the cards that were rendered.

<!-- wachi:finding -->

