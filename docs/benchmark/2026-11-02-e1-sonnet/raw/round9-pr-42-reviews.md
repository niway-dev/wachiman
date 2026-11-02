## review by github-actions[bot] at 2026-11-02T03:45:04Z

👮 **Wachiman** · review of the whole pull request, at `e45c845`: all 31 files reviewed.

3 finding(s): 3 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** I found no defects that block merging; there are two minor "consider" notes on the Library ready card. The fingerprint fix (comparing only the part before `#`), the retire-on-route-leave logic and the sessionStorage widget state all hold up against the code and the tests. The `backgroundCopy` message keys the new components use exist in `en.json`. The first note is that the Library card's Show in Finder and drag actions don't call `markCopySeen`, which the toast's equivalents do and the header comment in `ready-copies.ts` describes. The second is that the card hardcodes `.mp4`/`.gif` as the displayed file extension instead of reading the real one. The docs page and CSS files were not in this part's diff, and I did not read them.

**Batch 2 of 2.** The nine files in this part (four stylesheets, three docs, two message files) hold up, with one visual issue. The 2-column Ready card, sparse auto-flow and a fixed 3-column grid mean two or more finished copies leave a hole in the first row, at the doc's own validation step 7; this is a consider. The CSS variables the stylesheets use are defined in the tokens or have fallbacks. The en and es message keys match, and the removed `hide` and `readyDragToUpload` keys have no remaining references. The ICU selects cover every `DestinationId`. The doc's claims about sessionStorage, `retireReadyCards`, the sidecar fingerprint split and the removed runner flags match the code I read.

<details><summary>What the change connects to (7 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Library 'Ready to upload' card: Show in Finder and native drag of the finished copy (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80`) — The 'N copies ready' chip and outline remain after the user used the file; the card stays until the Library is left. If it fails: Both IPC calls are fire-and-forget (`void` / send). A rejection is silent, same as the existing toast path and use-local-library reveal. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-299`, `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:76-98`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:10-11`.
- Retire Library ready cards when the route leaves /library (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:96-104`) — Leaving the Library clears the big cards; the next visit shows the plain grid with outlined copies. A copy that finishes while away gets a card on the next visit (wasOnLibrary is false, so nothing retires it). If it fails: No async work. If the user leaves the Library and a copy finishes at the same moment, the effect re-runs on the `copies` change with wasOnLibrary already false, so the new card is not retired. Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:92-106`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:93-100`.
- Minimized export widget state persisted in sessionStorage (`apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:8-35`) — The pill or the full widget shows according to the last choice. An error always renders the full card (the status === 'error' branch ignores `minimized`). If it fails: If sessionStorage throws, reads return false and writes are skipped, so the choice holds in memory only. Nothing is lost beyond a renderer reload. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:36-52`.
- Runner records destination and encoded size for each finished copy (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:450-454`) — The Library card shows the destination tag and 'W × H'. For an editor export, destination is undefined and the tag is omitted. If it fails: None new. A copy missing from visibleItems (filtered or deleted) gets no card, and the unseen map still holds it until opened. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-runner.ts:447-461`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:126-133`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:67-73`.
- Minimize the export progress widget to a pill, and expand it again by clicking the pill (`apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:152`) — A pill with a ring and "YouTube copy · N%" bottom right (`.pill`, `.exportStack`). Clicking it sets the flag back to false and the full card returns. The flag is read through useSyncExternalStore, so the screen updates immediately. If it fails: If sessionStorage throws, both the read and the write are caught and the choice stays in memory (export-widget-state.ts:10-35). The pill is the only way back to Cancel while minimized, and it stays v… Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:8-44`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:38-55`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:189-228`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.module.css:18-29`, `apps/documentation/src/content/docs/backlog/ready-copy-in-library.md:45-47`.
- Show a "Ready to upload" card in the Library for a just-finished copy: Show in Finder, drag the file out, open it, or close the card (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:27`) — The card appears at the head of the grid, newest first, and is replaced in the list by its regular card (library-page.tsx:126-133, 422-424). Leaving the Library retires it via `retireReadyCards`, called from the sidebar route hook (sidebar.tsx:102). That fires on a real route ch… If it fails: The IPC calls `revealLocalRecording` and `startFileDrag` are fire-and-forget (`void` / no await). A rejection is not shown to the user. The drag button and the reveal button render only when `video.i… Evidence: `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:74-100`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-299`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:67-105`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:126-133`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:409-421`, `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:102`.
- Render a destination tag (FOR YOUTUBE …) on library grid cards from the job's destination or from the file's sidecar (`apps/kaipu-record/src/renderer/src/features/prepare/components/destination-tag.tsx:9`) — The tag text comes from `backgroundCopy.destinationTag`; its colour comes from `data-destination` in `destination-tag.module.css`. `archive` and any other destination fall back to the neutral #2a2a30 background and the "Archive copy" / "Copia de archivo" label. Colours match `de… If it fails: A copy with no fingerprint or an unrecognised one gets no tag, a silent fallback to the regular badge. This is not a defect. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/copy-destination.ts:13-30`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destination-tag.tsx:16-20`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destination-tag.module.css:25-46`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destination-logo.module.css:11-29`, `packages/i18n/messages/en.json:1431`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 22 | 835 | 4 | reviewed | 16 | $0.29 |
| Batch 2 of 2 | 9 | 427 | 1 | reviewed | 30 | $0.36 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.65</sub>

<!-- wachi:review -->

<!-- agent-review sha=e45c845143ba72f35fea4fac2f9d62a186dff986 -->

<!-- wachi:attempt id=c8411075-052c-464d-93a0-aa65af523aa4 -->

