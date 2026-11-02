## review by github-actions[bot] at 2026-11-02T03:15:20Z

👮 **Wachiman** · review of the whole pull request, at `e45c845`: all 31 files reviewed.

4 finding(s): 4 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 of 2. The core logic holds up: the copy-destination fingerprint fix, the ready-card store, the route-based card retirement (the sidebar lives in AppShell, which hosts every page except sign-in) and the session-wide minimized widget. There are two findings, both "consider". First, the Library's Ready to upload card reveals or drags the file without calling markCopySeen, which the ready toast does. Second, a Library page test called "...and forgets it" never checks that the copy was forgotten.

**Batch 2 of 2.** Part 2 covers the stylesheets, the backlog docs and the i18n messages; nothing in it blocks the merge.

- **Stylesheets:** every token they use is defined (`--bg-hover` has a fallback). The bottom-right export stack keeps its children clickable: the container has pointer-events none, and the pill and the card set it back to auto. The two-column ready card fits the Library grid's fixed three columns.
- **Messages:** `en.json` and `es.json` have matching keys. All the new selects cover every `DestinationId`, plus the "export" fallback. The removed `hide` and `readyDragToUpload` keys are no longer used anywhere.
- **Docs:** the doc's descriptions of the sessionStorage minimized state and of card retirement match the code. One validation step lists the cards in the wrong order: it says "newest first" but lists the GitHub card (made first) before the chat card.
- **PR body:** it claims email-specific strings ("Exporting for email", FOR EMAIL…). There is no email branch in the messages and no email destination in `DESTINATION_IDS`. It also names a different base branch (#466) than the new doc (#459).

<details><summary>What the change connects to (5 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Show in Finder and native drag from the Library's Ready to upload card (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:80`) — Finder reveals the file, or the OS drag starts. The copy stays unseen (outline and chip) after the card is retired. If it fails: revealLocalRecording's promise is voided, so a rejection is silent, the same as in the sibling and in use-local-library.ts:98. startFileDrag is a fire-and-forget send. The card is not rendered when v… Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:277-299`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:9-13`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:76-79`, `apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.tsx:74-99`.
- Retire Ready to upload cards when the route leaves the Library (`apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:95`) — The next Library visit shows the plain grid. Copies that finish later get their own card. If it fails: Nothing is async. If AppShell remounts, the ref resets to false. That happens only for routes outside the shell (sign-in), where the cards stay until the next leave. Evidence: `apps/kaipu-record/src/renderer/src/shell/sidebar.tsx:92-106`, `apps/kaipu-record/src/renderer/src/shell/app-shell.tsx:36-53`, `apps/kaipu-record/src/renderer/src/app/router.tsx:63-106`.
- Session-wide minimized state of the export widget (sessionStorage) (`apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:25`) — A pill with a ring while exporting, or the full card. The ready card is unaffected. If it fails: Storage access is wrapped in try/catch, and the state falls back to memory. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:34-55`.
- Minimize the export progress widget to a pill, and click the pill to open the widget again (styles .pill/.ring and the bottom-right .exportStack) (`apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.module.css:76`) — The pill shows at the bottom right with a ring whose stroke-dashoffset follows the percent. The stack container has pointer-events:none, and the pill (like StatusCard's .card) sets pointer-events:auto, so the pill stays clickable. If it fails: If sessionStorage throws, the flag still holds in memory. The state survives remounts because it is module-level, and a relaunch starts expanded. Evidence: `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:34-55`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:152-154`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-status-cards.tsx:199-226`, `apps/kaipu-record/src/renderer/src/features/status-cards/export-widget-state.ts:10-35`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.module.css:19-29`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-stack.tsx:27-29`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-card.module.css:5`.
- The ready copy card spans two grid columns at the top of the Library grid (.card grid-column: span 2) (`apps/kaipu-record/src/renderer/src/features/library/components/ready-copy-card.module.css:4`) — One two-column card per ready copy, newest first, in place of the copy's regular card. ✕ calls dismissReadyCard, so the copy goes back to its regular card and stays outlined as unseen. Evidence: `apps/kaipu-record/src/renderer/src/pages/library/library-page.module.css:366-371`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:126-133`, `apps/kaipu-record/src/renderer/src/pages/library/library-page.tsx:407-424`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/ready-copies.ts:87-105`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 22 | 835 | 4 | reviewed | 11 | $0.44 |
| Batch 2 of 2 | 9 | 427 | 1 | reviewed | 23 | $0.51 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.95</sub>

<!-- wachi:review -->

<!-- agent-review sha=e45c845143ba72f35fea4fac2f9d62a186dff986 -->

<!-- wachi:attempt id=a5eb51ea-8a83-404a-a00f-08dc345fdbcc -->

