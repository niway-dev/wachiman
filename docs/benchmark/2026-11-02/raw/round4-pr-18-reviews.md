## review by github-actions[bot] at 2026-11-02T03:16:15Z

👮 **Wachiman** · review of the whole pull request, at `dac8318`: all 14 files reviewed.

5 finding(s): 4 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### For your information

- ⚪📝 **Info · docs: PR body says seven destinations with Email as its own card; the code and this doc say six (confidence high)** (`apps/documentation/src/content/docs/backlog/prepare-screen.md:114`): The pull request's "Notes for review" says "Seven destinations, as in the design. Since the export-screen merge, Email is its own card over chat's Balanced preset." That is not true at the head commit. `DESTINATION_IDS` lists six entries: youtube, vertical, square, github, chat, archive (`apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-43`). The page test checks exactly those six cards (`library-detail-page.test.tsx:254-259`). This doc line, which says "the code has six", is correct. Only the PR description needs fixing.

### Summary

**Batch 1 of 2.** Part 1 has four findings, all at "consider": two behaviour points and two test points. Nothing blocks the merge.

The page logic holds together. The new panel replaces the removed strip and sends picks through the same `openPrepare` call. "Not now", the saved notice and the heavy banner turn on and off together correctly. The picture sizes on copy rows match what an export would produce.

- **Ellipsis that never resolves:** when the file read fails, the destination cards keep showing "…", which looks like they are still loading.
- **Badge not cleared on drag:** the new Drag handle on a copy row doesn't mark the copy as seen. The existing ready card's drag does, so a dragged copy keeps counting in the sidebar's Library badge.
- **Tests:** one test name promises the "Open in Export →" button is hidden when there's no export screen, but nothing checks that. Another test swaps in its own `startFileDrag` and never restores it.

**Batch 2 of 2.** Part 2 (the page test, the stylesheets, the backlog docs and the en/es messages) is consistent with the code. Every message key this PR removes is no longer referenced. `sendTo` stays because the Library card and row still use it. The removed strip stylesheet has no importers left. The new title row ellipsizes correctly, because the h1's overflow:hidden lets the flex item shrink. The tests match the new behavior, including the dropped \"file isn't read\" assertion, which reflects the intended change to probe every local recording. The backlog doc's six-destination note is right; the PR description's \"seven destinations, Email is its own card\" claim is not, since DESTINATION_IDS still lists six. No blocking issues. One contract is still open: what useSourceProbe does when the probe fails.

<details><summary>What the change connects to (10 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Probe the file for every local recording (resolution, destination estimates, copy picture size) (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — Does useSourceProbe catch a rejected probe IPC and leave probe null, or does it surface an error or toast on every page visit? Files that would answer it: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts`.

**Closed, with the lines they rest on**
- Clicking a destination card in "Where is it going?" opens Prepare on that destination (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:493`) — The router moves to the Prepare screen for that destination. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:78-83`.
- The probe now runs for every preparable recording page, and DestinationsPanel and MasterCopiesPanel take their estimates and dimensions from it (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:142`) — The dimensions meta item, the destination card sizes and the copy row picture sizes appear once the probe resolves. If it fails: On a probe error the probe stays null: the dimensions meta and copy dimensions are left out (fine), but the destination cards show "…" indefinitely (reported as a finding). Evidence: `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:41-56`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:91`.
- "Not now" hides the destinations panel (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:494`) — The panel disappears, and the "Export a copy" button and the heavy banner appear (they are gated on !showDestinations). Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:138-139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:517`.
- The Drag handle on a copy row starts a native file drag through IPC (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171-175`) — Main checks the id, needs a thumbnail as the icon, makes a hard-linked friendly name and calls startDrag. If it fails: Fire-and-forget ipcRenderer.send. Main returns silently when the id is invalid or the thumbnail is missing, and logs other errors to the console. Nothing shows the user a failure, the same as the exi… Evidence: `apps/kaipu-record/src/preload/index.ts:87`, `apps/kaipu-record/src/main/library/index.ts:161-175`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:231-236`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:54-58`.
- The copy row shows the picture size that resolveExportTarget computes from the copy's preset and the source probe (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:104-114`) — "2560 × 1440 · 22 MB" in the row's facts line. If it fails: Without a probe the row falls back to the file size alone. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:433-522`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:187`.
- "Saved to your Library" notice and its ✕ dismissal (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394-412`) — A green status notice above the player. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:128-137`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341`.
- Click a "Where is it going?" destination card to open Prepare on that destination (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:493`) — The router moves to /prepare/asset-b?to=<destination>. The tests check all six cards and the heavy-master GitHub card. If it fails: Synchronous navigation with no async work. If assetId is missing, openPrepare does nothing, but the page has already returned "File not found" in that case. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:149-151`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:161-171`, `apps/kaipu-record/src/renderer/src/features/prepare/components/destinations-panel.tsx:73-93`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-43`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:253-266`.
- "Not now" hides the destinations panel and brings back "Export a copy" (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:494`) — The panel goes away. The Export a copy button appears in the actions and opens Prepare with no ?to=. The heavy banner shows again for a heavy master because of `heavy && !showDestinations`. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:138-139`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:190-191`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:436-441`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:517-523`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:292-306`.
- "Saved to your Library" notice on a fresh recording, dismissed by ✕ (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:394`) — role=status banner with the en/es savedNotice* strings. The test checks the text, the ✕ and the note coming back. If it fails: No async work. On Back to the same history entry, location.state.fromRecording is still set and the dismissal state is reset, so the notice shows again. The post-recording card works the same way. Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:134-137`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:341-346`, `packages/i18n/messages/en.json:779-781`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:868-881`.
- Drag handle on a copy row starts a native file drag (`apps/kaipu-record/src/renderer/src/features/prepare/components/master-copies-panel.tsx:171`) — The page test only checks that the button is visible. The component test checks the startFileDrag call. If it fails: Fire-and-forget ipcRenderer.send, so nothing reports a failure. This is the same as the existing ready-card path. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:235`, `apps/kaipu-record/src/preload/index.ts:87`, `apps/kaipu-record/src/main/library/index.ts:161`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:526-528`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 5 | 852 | 4 | reviewed | 14 | $0.59 |
| Batch 2 of 2 | 9 | 763 | 2 | reviewed | 17 | $0.63 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $1.22</sub>

<!-- wachi:review -->

<!-- agent-review sha=dac8318b631e64780f65ce94b4aaa57261d7d63d -->

<!-- wachi:attempt id=b1222b2c-7fe8-4c42-8e75-69ee5b0c01cc -->

