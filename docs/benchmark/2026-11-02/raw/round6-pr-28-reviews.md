## review by github-actions[bot] at 2026-11-02T03:24:47Z

👮 **Wachiman** · review of the whole pull request, at `dac8318`: all 14 files reviewed.

4 finding(s): 4 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 has no blocking or fix-level issues: the new destinations panel and the reworked copies panel are wired correctly, and leaving framing out of the copy-dimension calculation is safe because the vertical and square canvases have fixed sizes. Three points to consider. First, the copies panel's Drag handle skips the `markCopySeen` step that the ready card's drag takes, so a copy the user has dragged out still shows as unseen in the Library. Second, if reading the file fails, the destination cards show the loading "…" forever. Third, the "Open in Export" test never checks that the button is hidden when there is no export screen. The PR body also says there are seven destinations with Email as its own card, but `DESTINATION_IDS` at head lists six, with Email inside the chat card.

**Batch 2 of 2.** Part 2 (the tests, stylesheets, docs and i18n messages) matches the page and panel code it describes. Every new i18n key exists in both en.json and es.json. The removed `where*`, `copiesEmpty` and `copyProgress*` keys have no remaining callers. `sendTo` is kept because the Library card and row still use it. Every CSS class the page and panels use is still defined. The tests assert behaviour the code actually implements: six destination cards with their `?to=` values, the size tones, Not now, the saved notice, the copies grid and the Drag button. One documentation nit: the QA step tells testers to drag the copy's whole row, but only the Drag handle starts a file drag.

<details><summary>What the change connects to (11 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Click a destination card in "Where is it going?" (`apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:82`) — The Prepare screen opens with that destination selected. If it fails: Synchronous navigation; nothing async. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489-494`.
- "Not now" hides the destinations panel (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:494`) — The panel disappears and the Export a copy button appears in the actions. If it fails: Component state only: on Back or a remount it resets and the panel shows again. The PR body says this is intended. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:517`.
- Drag handle on a ready copy starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171-175`) — The file is dragged under the copy's title; the copy stays marked unseen in the Library. If it fails: Fire-and-forget IPC send. Main validates the id and returns silently when it is invalid, and the handle only renders when `copy.id !== null`. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:231-235`, `apps/kaipu-record/src/main/library/index.ts:161-165`, `apps/kaipu-record/src/preload/index.ts:87`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:55-58`.
- Open in Export → in the copies panel (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:513`) — The Prepare screen opens. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436-437`, `apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:122-126`.
- Probe the file for every local recording (resolution, estimates, copy dimensions) (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — Shows the dimensions in the metadata line, the per-destination estimates and each copy's "W × H · size". If it fails: On error, probe is null, the same as while loading: the destination cards show "…" indefinitely, and the meta and copy rows omit the dimensions silently. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41-56`.
- Copy row's picture size from the source probe and the copy's preset (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:104-114`) — "2560 × 1440 · 22 MB". Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:271-284`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:479-485`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:187`.
- Dismiss the "Saved to your Library" notice (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:407`) — The notice hides and the masterNote line appears. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-137`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341`.
- Destination card click on "Where is it going?" opens Prepare on that destination (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:489`) — The route changes to /prepare/:id?to=<destination>. The tests at library-detail-page.test.tsx:253-266 check all six. Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:73-93`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-42`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:253-266`.
- "Not now" hides the destinations panel and brings back Export a copy (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:494`) — The panel unmounts (line 489) and the Export a copy button appears (line 436). Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:138-139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436`, `apps/documentation/src/content/docs/backlog/prepare-screen.md:101-102`.
- "Saved to your Library" notice shown on a fresh recording, dismissable (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394`) — A green status row. masterNote is hidden while it shows (line 341). Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:136-137`, `apps/kaipu-record/src/renderer/src/pages/prepare/prepare-page.tsx:152-153`.
- Drag handle on a copy row starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171`) — The OS drags the real file into the target app. If it fails: If the id is invalid or there is no thumbnail icon, main returns silently. Other errors are only console.error'd in main, and the user sees nothing happen. This matches the existing ready card. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:231-236`, `apps/kaipu-record/src/main/library/index.ts:161-175`, `apps/kaipu-record/src/preload/index.ts:87`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 5 | 852 | 4 | reviewed | 12 | $0.57 |
| Batch 2 of 2 | 9 | 763 | 2 | reviewed | 16 | $0.59 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $1.16</sub>

<!-- wachi:review -->

<!-- agent-review sha=dac8318b631e64780f65ce94b4aaa57261d7d63d -->

<!-- wachi:attempt id=4235ec2b-2277-4a9f-ad3f-4a37a7c057ad -->

