## review by github-actions[bot] at 2026-11-02T03:15:59Z

👮 **Wachiman** · review of the whole pull request, at `b2705a9`: all 28 files reviewed.

5 finding(s): 1 to fix, 4 to consider; 5 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 has one bug to fix: a press on the floating card during a following take calls `showMainWindow()` with no check. The main window then lands in the recording, and the renderer running the recorder navigates away mid-take. Every other path that reveals the main window checks `hub.isActive()` first. Two smaller points, both optional: a card window that fails to load shows nothing and never falls back to the in-app card, and the `PostRecordingCard` docstring is stale. The IPC boundary is validated and checks who sent each message, and the shared contract has no value imports.

**Batch 2 of 2.** I reviewed all 13 files in part 2 and found two "consider" findings, nothing at "fix" or above. The renderer wiring works as described:
- **Fallback:** the in-app card shows only when main answers false or the IPC call fails.
- **Hand-offs:** the floating card's actions reuse the same path helpers as the in-app card (`preparePath`, `editorPathFor`).
- **Window sizing:** the frame height the card reports plus main's 16 px padding fits the card.
- **Tests, docs and messages:** the tests check the ordering, the typed actions and the fallback; the doc and i18n strings match the code.

The two findings, both in `library-detail-page.tsx`:
- **Back reopens the card (line 141, medium confidence):** the guard that stops the page asking twice resets when the page remounts. A router Back to the recording page therefore pops the always-on-top window up again, even after the user acted on it or closed it.
- **No timeout on reading the file (line 140, low confidence):** the card now waits for the file read to finish or fail. If that read never settles, no card shows anywhere and nothing tells the user.

<details><summary>What the change connects to (7 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Floating card action (chip / Edit first / Open) → main shows main window and sends recording-ready:open (`apps/kaipu-record/src/main/index.ts:899-902`) — Main window comes forward and the renderer navigates to Prepare / editor / detail via pathForHandOff. If it fails: During a following take the main window is shown into the recording and its renderer navigated away mid-take. If the main window was destroyed, sendToRenderer queues until the renderer is ready (main… Evidence: `apps/kaipu-record/src/main/index.ts:185`, `apps/kaipu-record/src/main/index.ts:475-477`, `apps/kaipu-record/src/main/index.ts:449-457`, `apps/kaipu-record/src/main/index.ts:145-150`, `apps/kaipu-record/src/main/recording/recording-hub.ts:689`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:206-208`.
- Main window invokes recording-ready:show; main creates/reuses the card window (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-147`) — Card appears top-right of the take's display, or of the display under the cursor. If it fails: A creation throw returns false, so the page shows the in-app card. A load failure or renderer crash returns true and never shows anything (silent). Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:258-268`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:21-29`.
- Hub records lastTakeDisplayId per take (`apps/kaipu-record/src/main/recording/recording-hub.ts:666`) — Picks which display the floating card opens on. If it fails: A window source or a failed lookup leaves the area/region value or null; the window falls back to the cursor display. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:707-713`, `apps/kaipu-record/src/main/recording/recording-hub.ts:934-941`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:237-244`.
- Card IPC from the card window (ready/resize/action) (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:108-126`) — Window resized to the card's height; an action closes the card, then hands off. If it fails: Foreign or malformed messages are ignored. Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:246-248`, `apps/kaipu-record/src/shared/types/recording-ready.ts:47-61`.
- The recording page asks main to float "Your video is ready" once the probe settles, and falls back to the in-app card (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141`) — A desktop window opens through main. When the ask fails, the status-stack card shows instead. If it fails: If the IPC rejects or main answers false, the page falls back to the in-app card (use-floating-ready-card.ts:26-28), and the test covers this case. If the probe never settles, no card shows anywhere.… Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:16-31`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:129-155`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/probe-source.ts:28-46`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:135-146`.
- The main window navigates on hand-offs from the floating card (`apps/kaipu-record/src/renderer/src/shell/app-root.tsx:31`) — The main window comes forward on Prepare, the editor or the recording page. If it fails: If the channel is never delivered, the floating window has already closed and the main window shows without navigating. Nothing is lost: the recording stays in the Library. Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:13-34`, `apps/kaipu-record/src/main/index.ts:897-903`, `apps/kaipu-record/src/renderer/src/features/editor/open-in-editor.ts:83`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:150`.
- New render target ?window=recording-ready mounts RecordingReadyCard (`apps/kaipu-record/src/renderer/src/main.tsx:66`) — The card paints inside a transparent 452 DIP window. The status-card max-width of calc(100vw - 32px) resolves to 420 px. If it fails: If the renderer never loads, the window shows nothing and there is no in-app fallback. The doc's "Not done" section acknowledges this. Evidence: `apps/kaipu-record/src/renderer/src/main.tsx:60-71`, `apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:24-53`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:18-19`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:73`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-card.module.css:4`, `apps/documentation/src/content/docs/backlog/floating-ready-window.md:55-56`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 15 | 998 | 8 | reviewed | 13 | $0.53 |
| Batch 2 of 2 | 13 | 297 | 4 | reviewed | 14 | $0.44 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.97</sub>

<!-- wachi:review -->

<!-- agent-review sha=b2705a9ce2593b29ae50235312a4226955bbbb36 -->

<!-- wachi:attempt id=99d8dd57-2442-410d-a0b6-a0a8c51103f8 -->

