## review by github-actions[bot] at 2026-11-02T03:45:05Z

👮 **Wachiman** · review of the whole pull request, at `b2705a9`: all 28 files reviewed.

7 finding(s): 1 to fix, 6 to consider; 7 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** The floating-card design follows the capture toast's pattern. Its IPC is sender-checked and parsed, and `shared/` has no value imports from workspace packages. One real regression: nothing closes the card when a new recording starts, and its actions call `showMainWindow()` unconditionally. A press on a leftover card mid-take un-hides the main window into the recording, which `triggerStartRecording` explicitly avoids. A stale card can also persist when the next take is not eligible for one. Two smaller notes: the hub test covers only one of the display-resolution branches, and the `show` invoke does not check its sender.

**Batch 2 of 2.** I found no blocker or fix-level defect in this part. The flow works: the page asks main once the probe settles and falls back to the in-app card on a false answer or a rejected IPC. The hand-off paths reuse `preparePath` and `editorPathFor`. The window root, CSS, i18n keys and tests line up with the main-process code I read. I'm posting four "consider" findings:
- Router Back to the same history entry remounts the page and re-floats the card, because the `asked` ref resets.
- The hand-off hook is untested beyond its pure path mapping.
- The probe-error branch of the floating ask is untested.
- The backlog doc says main "closes" the window, but it only hides it.

One contract stays open: whether `openInMain` waits for the main window's renderer before sending the hand-off. That code is in `main/index.ts`, which belongs to the other part of the PR.

<details><summary>What the change connects to (5 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- The floating card's hand-offs navigate the main window through `useRecordingReadyHandOffs` in `AppRoot` (`apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:28`) — Does `openInMain` in apps/kaipu-record/src/main/index.ts wait for the main window's renderer to finish loading before it sends `recording-ready:open`, for the case where the main window was hidden or had to be recreated? Files that would answer it: `apps/kaipu-record/src/main/index.ts`, `apps/kaipu-record/src/preload/index.ts`.

**Closed, with the lines they rest on**
- Card action (chip, Edit first, Open) → close floating window, show main window, send `recording-ready:open` to the renderer (`apps/kaipu-record/src/main/index.ts:899`) — If the card is pressed during a later take, the main window appears and the video records it. After a normal stop, the main window is shown and navigates to Prepare, the editor or the detail page. If it fails: Mid-take press: the main window is burned into the recording. Main window destroyed: `showMainWindow()` calls `createWindow()` and `sendToRenderer` queues until `rendererReady` (`index.ts:145-149`, :… Evidence: `apps/kaipu-record/src/main/index.ts:449-457`, `apps/kaipu-record/src/main/index.ts:474-481`, `apps/kaipu-record/src/main/index.ts:145-149`, `apps/kaipu-record/src/main/index.ts:897-903`, `apps/kaipu-record/src/main/recording/recording-hub.ts:689`, `apps/kaipu-record/src/main/screenshots/capture-window-hooks.ts:52-58`.
- Main window asks main to float the card (`recording-ready:show`, invoke) and falls back in-app on false or rejection (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:104`) — The card is floating on the recorded display, or the in-app card is shown when `show` returns false or the IPC rejects. If it fails: Creation throws: `show` logs, resets `this.window` and returns false, so the fallback runs. A window that is created but never loads its renderer never reports ready, so nothing shows and there is no… Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:219-226`, `apps/kaipu-record/src/main/screenshots/capture-toast-window.ts:148-160`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:21-30`.
- Renderer-to-main IPC from the card window (ready, resize, action), sender-checked and parsed (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:108`) — Foreign senders and malformed payloads are ignored silently. If it fails: Nothing reaches the user, which is acceptable for these inputs. The unchecked `show` sender is reported separately as a low-severity consider. Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-126`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:246-248`, `apps/kaipu-record/src/shared/types/recording-ready.ts:47-85`.
- After a fresh recording's probe settles, the detail page asks main to float the card; it falls back to the in-app card on false or a rejected IPC (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141`) — On success the card appears in its own desktop window, and the in-app card is suppressed because `inApp` stays false. On failure `fallbackFor` is set and `showInAppCard` turns true, which renders the same card on the status stack. The tests at library-detail-page.test.tsx:741-76… If it fails: IPC rejection and a false answer both reach `fallBack`, so the card is not lost. A window that is created but never loads its renderer never sends `ready`. Main has answered true, so there is no fall… Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:136-155`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:16-32`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/probe-source.ts:28-47`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`.
- The card window renders `RecordingReadyCard` at `?window=recording-ready`, with main sizing the window to the card's reported height (`apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:18`) — The card paints in a transparent window with room for its shadow. The window is 452 wide, the card is 420 wide (`status-card.module.css` `data-wide`), and `max-width: calc(100vw - 32px)` also resolves to 420. `RecordingReadyCard` subscribes first and then sends `ready`, and main… If it fails: `resize` ignores non-positive heights, so a card measured while hidden does not shrink the window to nothing. No unhandled platform default applies, because the window is not a drop target and has no… Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:24-29`, `apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:41-53`, `apps/kaipu-record/src/renderer/src/assets/main.css:81-93`, `apps/kaipu-record/src/renderer/src/features/status-cards/status-card.module.css:15-16`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:108-121`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:218-226`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 15 | 998 | 8 | reviewed | 19 | $0.32 |
| Batch 2 of 2 | 13 | 297 | 4 | reviewed | 22 | $0.37 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.69</sub>

<!-- wachi:review -->

<!-- agent-review sha=b2705a9ce2593b29ae50235312a4226955bbbb36 -->

<!-- wachi:attempt id=e2252aa4-fdc0-484c-bfe0-2b29eb0b88cd -->

