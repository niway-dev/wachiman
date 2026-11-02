## review by github-actions[bot] at 2026-11-02T03:43:37Z

👮 **Wachiman** · review of the whole pull request, at `e45c845`: all 31 files reviewed.

4 finding(s): 4 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡📝 **Consider · docs: Background-copy-toasts doc body still describes the removed UI and old strings (confidence high)** (`apps/documentation/src/content/docs/backlog/background-copy-toasts.md:62`): This PR adds only an "Update" banner (lines 16-18) to this page, which is still marked 🟢 Ready to validate. The front-matter description and the "What the user sees" and "How to validate" sections still describe behaviour and copy this PR removes. Examples: "Preparing your YouTube copy…", "Your YouTube copy is ready", "you can keep working", "✕ hides the card" and "Drag to upload". The i18n keys `hide` and `readyDragToUpload` are deleted, and the titles are now "Exporting for YouTube", "YouTube copy ready" and "Drag to YouTube Studio". Step 2 ("Click ✕: the card goes away") now minimizes the card to a pill. An owner doing QA from this checklist will see a mismatch. Either update the steps and strings, or mark the page as superseded by ready-copy-in-library for the progress and ready cards.

### Summary

**Batch 1 of 2.** I found no blockers in part 1. The destination fix in `copyPresetOf` is correct: the runner stores fingerprints as "whole#…", so the old strict comparison never matched. The sidebar route watch is also sound. There are three consider-level notes. The Library "Ready to upload" card's Show in Finder and drag actions don't call `markCopySeen`, unlike the toast, so the "1 copy ready" chip and outline persist after the user has already acted. One test is named "forgets it" but never asserts that. The minimized pill's progressbar is hidden from screen readers by the button's `aria-label`.

**Batch 2 of 2.** I found one low-severity docs issue in this part: the older background-copy-toasts doc still describes the removed UI and old strings. Nothing blocks the merge. The CSS, i18n and the new backlog doc check out against the code I read.

- **CSS:** every token the new stylesheets use exists in `packages/tokens/css/tokens.css`, apart from `--bg-hover`, which has a fallback. `.exportStack` sets `pointer-events: none`, and `.pill` and the status cards turn it back on.
- **i18n:** `en.json` and `es.json` carry the same new keys, and every ICU `select` has an `other` branch. The removed keys `hide` and `readyDragToUpload` have no remaining non-test users. The `destinationTag` select has no `archive` branch, so `archive` falls through to "Archive copy", which matches the CSS.
- **ready-copy-in-library doc:** its claims match `ready-copies.ts`, `sidebar.tsx`, `copy-destination.ts` and `export-widget-state.ts`. I did not read the diff of the runner or the library page, so I did not check their claims.
- **background-copy-toasts doc:** the new "Update" banner is the only change. Its front matter, "What the user sees" and "How to validate" still describe the old UI and strings, while the page stays marked 🟢. That is the one finding.

<details><summary>What the change connects to (8 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Library leads the grid with a ReadyCopyCard for each finished copy, replacing its regular card (`apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:126`) — A two-column card with a destination tag, a mono meta line and two actions leads the grid. The regular card (delete, tag, edit, Prepare) is hidden while it shows. If it fails: If the copy's video is not yet in visibleItems (onSaved refresh pending) or is filtered out, no card shows. The list is recomputed when the library refreshes. In list view the card never renders, but… Evidence: `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:126-133`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:409-420`, `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80-94`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-299`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:76-79`.
- Sidebar retires ready cards when the route leaves the Library (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:92`) — On the next Library visit the grid opens plain, with the copies still outlined as unseen. A copy that finishes while the user is away gets its own card on the next visit. If it fails: The ref lives in the always-mounted Sidebar, so it survives page remounts and StrictMode double effects. Router Back to /library from elsewhere sets the ref to true again, so the next departure retir… Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:92-105`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:97-100`.
- Export widget minimized state kept in a module store backed by sessionStorage (`apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:18`) — The progress widget shows as a pill when the user last minimized it. An error always renders the full card, because the render condition is status === "error" regardless of the flag. If it fails: When sessionStorage throws, both read and write fall back to in-memory state. A pill clicked open sets the flag false and the full card shows, which is where Cancel lives. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:36-52`.
- Destination read back from the file sidecar via copyPresetOf (fingerprint split at '#') (`apps/kaipu-record/src/renderer/src/features/prepare/copy-destination.ts:13`) — Copies show "For YouTube" and so on on the Library poster and in the Master copies panel, instead of falling back to the title. If it fails: An editor export ("edit:...#q30"), a GIF, an original or a file with a null fingerprint returns null and keeps the kind badge. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/copy-destination.ts:13-17`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:440`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-reuse.ts:18`, `apps/kaipu-record/src/renderer/src/features/prepare/copy-destination.test.ts:7-30`.
- Library drag-out calls window.electronAPI.startFileDrag(localId, video.title) (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:93`) — A native drag of the real file, named after the item title. If it fails: The main handler returns silently when the poster is missing and logs on rejection. Nothing shows in the UI, the same as the toast's drag. Evidence: `apps/kaipu-record/src/main/library/index.ts:161-175`, `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:90-94`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:290-295`.
- Minimize the export progress widget to a pill, and expand it again (`apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:152`) — ExportStatusCards swaps the card for the pill. The pill is rendered only while status is exporting. An error always renders the full card, and the ready card renders independently of the minimized flag. If it fails: sessionStorage throws: both read and write are wrapped in try/catch and the choice stays in memory. There is no stuck state, because the pill click always sets minimized back to false. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:40-52`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:199-204`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.module.css:19-29`.
- Ready-to-upload Library card: open, ✕ dismiss, Show in Finder, native drag (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:48`) — dismissReadyCard sets card=false, so the regular card returns, still outlined as unseen. retireReadyCards runs from the rail's route hook when the user leaves the Library. The doc's claims match this code. If it fails: No local id (localId null): the action row is not rendered, so nothing fails silently. The reveal IPC promise is voided and has no UI error path, the same as the toast. Evidence: `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:74-100`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:76-100`, `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:96-104`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-299`, `apps/documentation/src/content/docs/backlog/ready-copy-in-library.md:30-32`.
- DestinationTag on grid and ready cards, with the new i18n keys and CSS colours (`apps/kaipu-record/src/renderer/src/features/prepare/components/destination-tag.tsx:19`) — A tag with the destination colour and "For YouTube" (or the es text) shows on the poster. If it fails: None: every ICU select in en.json and es.json has an `other` branch, and the two files carry the same new keys. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/destination-tag.module.css:25-46`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destination-logo.module.css:11-29`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-44`, `packages/i18n/messages/en.json:1431`, `packages/i18n/messages/es.json:1431`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 22 | 835 | 4 | reviewed | 14 | $0.29 |
| Batch 2 of 2 | 9 | 427 | 1 | reviewed | 32 | $0.31 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.60</sub>

<!-- wachi:review -->

<!-- agent-review sha=e45c845143ba72f35fea4fac2f9d62a186dff986 -->

<!-- wachi:attempt id=49054277-f29d-4b38-9ac0-f987217f6efb -->

