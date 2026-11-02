## review by github-actions[bot] at 2026-11-02T03:24:09Z

👮 **Wachiman** · review of the whole pull request, at `e45c845`: all 31 files reviewed.

4 finding(s): 1 to fix, 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### For your information

- ⚪❓ **Info · question: The PR body promises email wording, but no email destination or email strings exist at this head (confidence high)** (`packages/i18n/messages/en.json:1413`): The PR body says email "gets its own text: 'Exporting for email', 'Email copy ready', 'Drag to an email' and a FOR EMAIL tag". At this head, `DESTINATION_IDS` is youtube/vertical/square/github/chat/archive (`apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:36-43`). None of the new `select` messages (`progressTitle`, `readyTitle`, `pill`, `dragTo`, `destinationTag`) in en.json or es.json has an `email` branch. Either the description belongs to a different head or the merge with #467 is missing from this branch.

### Summary

**Batch 1 of 2.** Part 1 has one fix: the Library's new 'Ready to upload' card calls Show in Finder and the drag without `markCopySeen`. The ready toast does call it, and `ready-copies.ts` documents that acting on a ready card makes the copy seen. As a result the card, the chip and the outline stay after the user has acted. There is also one accessibility suggestion: the minimized pill's progress is hidden behind its button's aria-label. The fingerprint fix, the session-wide widget state and the route-based card retirement read correctly. One gap in the PR body: it describes email wording ('Exporting for email', a FOR EMAIL tag), but `DestinationId` at head has no 'email' destination, and the i18n selects in this tree have no email branch.

**Batch 2 of 2.** I reviewed part 2 (the stylesheets, backlog docs and i18n messages) and found nothing that blocks the merge.

The tag colours in destination-tag.module.css match destination-logo.module.css. Every token the new CSS uses exists, except `--bg-hover`: it is undefined, so the ✕ hover falls back to a white tint that does not show in the light theme.

I checked the claims in the new backlog doc against the code, and they hold:
- the session-scoped minimized state;
- `retireReadyCards` called from the rail's route hook;
- ready cards newest first;
- the removed `progressHidden` / `hideExportProgress`.

No code still uses the removed i18n keys (`hide`, `readyDragToUpload`). The ICU `select` fallbacks cover the null destination, which is passed as "export".

The PR body describes email-destination wording that does not exist at this head. Whether the bottom-right widget covers page controls at the default window size is still an open question.

<details><summary>What the change connects to (5 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Export cards move from the top-right stack to a fixed bottom-right stack on every screen (`apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.module.css:19`) — Does the bottom-right widget cover a page's own bottom-right controls, such as Prepare's primary button or the editor's timeline and export controls, at the 900 × 670 default window? The PR says Electron was not launched. Files that would answer it: `apps/kaipu-record/src/renderer/src/pages`, `apps/kaipu-record/src/renderer/src/features/prepare`.

**Closed, with the lines they rest on**
- Show in Finder / drag the file out from the Library 'Ready to upload' card (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:76-98`) — The ready card stays in the grid, and the copy stays outlined and counted in the 'copy ready' chip after the user has already acted on it. If it fails: revealLocalRecording is fire-and-forget with `void`, and a rejection is silent, the same as the sibling. startFileDrag is a one-way send. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-299`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:10-11`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:76-79`.
- Retire the ready cards when the route leaves the Library (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:95-104`) — The next Library visit opens on the plain grid. A copy that finishes later gets a new card. Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:95-104`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:97-100`.
- Minimized widget state stored in sessionStorage (`apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`) — The pill or the full widget shows bottom right. An error always renders the full card. If it fails: If storage is unavailable, the choice still holds in memory and is lost on reload. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:34-55`.
- Read a copy's destination from the sidecar fingerprint (`apps/kaipu-record/src/renderer/src/features/prepare/copy-destination.ts:13-30`) — The grid tag and the 'Copies from this master' names. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:185-188`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-reuse.ts:18`, `apps/kaipu-record/src/renderer/src/features/prepare/destinations.ts:98-103`.
- Minimize the export widget to a pill with a progress ring, and click the pill to expand it again (`apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.module.css:76`) — The pill sits in `.exportStack`, which is fixed at the bottom right with `pointer-events: none`. The pill sets `pointer-events: auto` and the status card sets it too, so both stay clickable. If it fails: If sessionStorage throws, `read` returns false and `setExportWidgetMinimized` keeps the choice in memory only. Nothing is lost beyond persistence across a reload. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:40-51`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:152-154`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:199-204`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.module.css:19-29`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-card.module.css:5`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.module.css:77`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 22 | 835 | 4 | reviewed | 9 | $0.44 |
| Batch 2 of 2 | 9 | 427 | 1 | reviewed | 19 | $0.44 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.89</sub>

<!-- wachi:review -->

<!-- agent-review sha=e45c845143ba72f35fea4fac2f9d62a186dff986 -->

<!-- wachi:attempt id=2e2f8bb9-0f47-4c09-8c93-70a90b5a08cb -->

