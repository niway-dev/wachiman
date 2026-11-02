## review by github-actions[bot] at 2026-11-02T03:23:57Z

👮 **Wachiman** · review of the whole pull request, at `e45c845`: all 31 files reviewed.

4 finding(s): 1 to fix, 3 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 review. I read all 22 files in this part.

**Bug (fix).** The Library's new \"Ready to upload\" card has the same Show in Finder and drag actions as the ready toast, but it skips the `markCopySeen` call the toast makes before each one (`ready-copy-card.tsx:80` and `:93`). After a user drags the copy out from the Library card, the copy stays outlined and stays counted in the \"1 copy ready\" chip until they open its page.

**Test gap (consider).** The library-page test \"opening the copy goes to its page and forgets it\" only checks the navigation. Nothing asserts the copy is forgotten, so removing the `markCopySeen` call in `onOpen` would not fail it.

**Checked and correct:**
- The fingerprint fix in `copyPresetOf`: it now compares only the part before `#`, which matches what `encodeFingerprint` writes.
- The session-wide minimized widget state.
- Retiring the ready cards from the rail's route watch when the user leaves the Library.

**Outside this part.** The PR body describes email-destination wording, but `DestinationId` in this tree has no `email`, and the i18n `select`s list none.

**Batch 2 of 2.** Part 2 (stylesheets, docs, messages): no defects. Every CSS token used resolves in packages/tokens/css/tokens.css, and `--bg-hover` has a fallback. The pill and the status card turn pointer events back on inside the new stack, which sets them to none. Nothing references the removed i18n keys (`hide`, `readyDragToUpload`). en and es have matching keys, and the ICU selects fall back correctly for `export` and `archive`. The new backlog doc has a sidebar entry and an index row. Two doc notes: (1) background-copy-toasts.md still describes the old strings and the ✕ behaviour in its body and validation steps. (2) ready-copy-in-library.md says a card lasts until the user leaves the Library, but retireReadyCards also clears cards that were never rendered (list view or filtered out). One more for awareness, in part-1 code: the Library card's Show in Finder and drag do not call markCopySeen, while the toast's do. The comment in ready-copies.ts says acting on the ready card clears the copy.

<details><summary>What the change connects to (7 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Show in Finder on the Library's Ready to upload card (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80`) — Finder reveals the file. The card stays, and after the user leaves and comes back the regular card keeps the unseen outline and the chip. If it fails: The reveal is fire-and-forget with `void`, the same as use-local-library.ts:98, so a rejection is silent. That matches the existing behaviour. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:280`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:10-11`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:119-121`.
- Native drag of the copy from the Library's Ready to upload card (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:90-94`) — The file is dragged out. The copy stays counted as unseen. If it fails: startFileDrag is a one-way ipcRenderer.send (preload/index.ts:87), so there is nothing to await. A failure in main is silent here, the same as the existing callers. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:293-294`.
- Retire the ready cards when the route leaves the Library (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:95-103`) — On the next visit the Library opens on the plain grid, with regular cards outlined as unseen. If it fails: The ref belongs to the Sidebar instance. If the rail remounts while the Library is not the previous route, the ref starts false, which is correct. Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:96-104`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:97-100`.
- Minimize the export widget to a pill, with the choice kept in sessionStorage (`apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:25-35`) — The pill shows while the export runs and minimized is true (export-status-cards.tsx:40-43). If it fails: If storage throws, the try/catch falls back to keeping the choice in memory only. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-16`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:40-43`.
- Minimized export widget: the pill with a progress ring (.pill, .ring*) inside the new bottom-right stack (`apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.module.css:76`) — The stack sets pointer-events:none (status-stack.module.css:28). The pill (export-status-cards.module.css:77) and the card (status-card.module.css:5) turn it back on, so both stay clickable. The ring's dashoffset comes from the percent (export-status-cards.tsx:207-214). If it fails: sessionStorage errors are caught and the choice stays in memory (export-widget-state.ts:28-33). An error always renders the full card (export-status-cards.tsx:43). Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.module.css:19-29`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-card.module.css:5`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:40-52`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`.
- Ready to upload card spans two grid columns, with a destination tag, Show in Finder and a native drag (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.module.css:2`) — The page renders it at the head of the grid for each card that is visible (library-page.tsx:126-133). When the user leaves the Library route, retireReadyCards clears the cards (sidebar.tsx:102). If it fails: revealLocalRecording is fire-and-forget (`void`), with no visible error. The same is true in the toast. Evidence: `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:74-98`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-295`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:126-133`, `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:96-104`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:97-100`.
- Destination tag colours (`apps/kaipu-record/src/renderer/src/features/prepare/components/destination-tag.module.css:25`) — The tag is rendered on the poster by DestinationTag (destination-tag.tsx:18-20). Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/destination-logo.module.css:11-28`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destination-tag.tsx:18-20`, `packages/i18n/messages/en.json:1431`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 22 | 835 | 4 | reviewed | 11 | $0.47 |
| Batch 2 of 2 | 9 | 427 | 1 | reviewed | 21 | $0.52 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.99</sub>

<!-- wachi:review -->

<!-- agent-review sha=e45c845143ba72f35fea4fac2f9d62a186dff986 -->

<!-- wachi:attempt id=7bb2a1dd-e39a-4ab4-91d8-89bc7e489d58 -->

