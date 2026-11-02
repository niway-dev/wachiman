## review by github-actions[bot] at 2026-11-02T03:44:53Z

👮 **Wachiman** · review of the whole pull request, at `b2705a9`: all 28 files reviewed.

3 finding(s): 1 to fix, 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** The floating card follows the capture toast's pattern correctly, and its IPC input is validated. The `shared/` file takes no value import from a workspace package, and the sender checks are in place. There are two findings. First, nothing closes the card when the next take starts (`apps/kaipu-record/src/main/index.ts:897`). A chip pressed mid-take would show the main window during the recording. Second, `show()` returns true before the page has loaded (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:134`). A failed load therefore never reaches the in-app fallback and leaves the window unusable for the session.

**Batch 2 of 2.** I found one issue in this part, a "consider" at medium confidence. Going Back to the recording page re-opens the floating card, because the "asked once" guard is a ref that resets on remount and `fromRecording` is never cleared. I left one contract open: the hand-off to a recreated main window is decided in main, which is another part. I found nothing wrong in the card component, `main.tsx`, the CSS, the tests, the i18n keys or the docs.

<details><summary>What the change connects to (5 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Hand-off from the floating card to the main window navigates through useRecordingReadyHandOffs mounted in AppRoot (`apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:28`) — If the main window was closed and is recreated by openInMain, does main defer the hand-off until the renderer's notifyReady, as it does for window-triggered actions (app-root.tsx:84-88)? Files that would answer it: `apps/kaipu-record/src/main/index.ts`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts`.

**Closed, with the lines they rest on**
- Main window asks main to float the card (`showRecordingReady` invoke -> `recording-ready:show`) (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:104`) — The card floats at the top-right of the recorded display. If the window cannot be created, or main answers false or rejects, the in-app card is shown. If it fails: Malformed payload: false, so the in-app fallback is used. Creation throws: caught and logged, false. Load fails after the window object exists: true is returned but nothing is ever shown, silently (s… Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-107`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:219-226`, `apps/kaipu-record/src/main/screenshots/capture-toast-window.ts:317-325`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:26-28`.
- Card button press -> main closes the card -> `openInMain` shows the main window and sends `recording-ready:open` (`apps/kaipu-record/src/main/index.ts:899`) — The main window comes forward on Prepare, the editor or the recording page. If it fails: The sender is validated with `isOwnSender` and the action with `parseRecordingReadyAction`. `handOffFor` refuses Edit when `canEdit` was false. A press while a take is recording shows the main window… Evidence: `apps/kaipu-record/src/main/index.ts:145-150`, `apps/kaipu-record/src/main/index.ts:449-457`, `apps/kaipu-record/src/main/index.ts:897-903`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:122-126`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:166-172`, `apps/kaipu-record/src/main/recording/recording-hub.ts:689`.
- Hub records `lastTakeDisplayId` at take start and refines it after the source lookup (`apps/kaipu-record/src/main/recording/recording-hub.ts:666`) — The card opens on the recorded display. For a window source or an unknown display it falls back to the display under the cursor. If it fails: If the take stops before the lookup resolves and neither an area nor a countdown region named a display, the value stays null and the cursor display is used. That is a harmless fallback. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:646`, `apps/kaipu-record/src/main/recording/recording-hub.ts:666`, `apps/kaipu-record/src/main/recording/recording-hub.ts:707-714`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:237-244`.
- Library detail page asks main to float "Your video is ready" once the file probe settles, instead of mounting the in-app status card (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141`) — The card appears in its own desktop window with duration, dimensions and size, and not in the page's status stack. If main answers false or the IPC rejects, the in-app card appears, because fallBack sets fallbackFor (use-floating-ready-card.ts:25-28,31). If it fails: A rejected or false answer falls back to the in-app card, so the card is not lost. A window that is created but never loads its renderer shows nothing and gets no fallback; the backlog doc admits thi… Evidence: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:130-155`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:16-32`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/shell/app-root.tsx:75`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`.
- Floating card window renders PostRecordingCard from main's payload and reports presses as typed actions (`apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:18`) — The card shows only after a payload arrives (it returns null before). A new payload remounts the card through key=assetId. Height is reported through ResizeObserver so main can fit the window. If it fails: If main never sends the payload, the transparent window stays empty. Main validates the sender and the payload before acting (recording-ready-window.ts:104-126). The renderer hides the card only thro… Evidence: `apps/kaipu-record/src/renderer/src/main.tsx:66-71`, `apps/kaipu-record/src/renderer/src/main.tsx:100-101`, `apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:24-69`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-126`, `apps/kaipu-record/src/renderer/src/assets/main.css:85-93`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 15 | 998 | 8 | reviewed | 13 | $0.27 |
| Batch 2 of 2 | 13 | 297 | 4 | reviewed | 23 | $0.28 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.55</sub>

<!-- wachi:review -->

<!-- agent-review sha=b2705a9ce2593b29ae50235312a4226955bbbb36 -->

<!-- wachi:attempt id=1b1d7f39-f27e-490b-b04d-2241af5d4b52 -->

