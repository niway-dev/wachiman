## review by github-actions[bot] at 2026-11-02T03:44:28Z

👮 **Wachiman** · review of the whole pull request, at `b2705a9`: all 28 files reviewed.

6 finding(s): 6 to consider; 6 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** The floating-card design holds together. Presses and resizes check the sender, and malformed IPC input is parsed away. A failed window creation falls back to the in-app card. `shared/` stays free of workspace value imports. There are two behavioural findings, both at consider. `recording-ready:show` has no sender check, unlike the auth IPC. The card also survives into the next take, so pressing it mid-recording shows the unprotected main window inside that take. I also asked whether the hand-off should check the recording still exists, as the toast's `openSavedScreenshot` does. The `PostRecordingCard` docblock still describes the in-app lifetime. I did not run anything and did not read the backlog doc or the part-2 files beyond a grep for the i18n keys.

**Batch 2 of 2.** I found no blocking problems in the renderer, test, CSS, doc and message files of this part. I read them only; I did not build or run anything. The hand-off paths reuse `preparePath`, `editorPathFor` and `ROUTES.libraryDetail`, as the in-app card does. The editor route works without router state. Main's `showMainWindow` plus `sendToRenderer` queueing covers a hidden or recreated main window. The in-app fallback after a false or rejected ask is tested. I left two points at \"consider\". First, the \"asked once\" ref resets when the detail page remounts under the same history entry (for example Back from Prepare), so the floating card is requested again. The in-app card did the same, but a floating window is more intrusive. Second, the floating ask now waits for the file probe, and that probe has no timeout, so a probe that hangs means no card at all and no fallback."

<details><summary>What the change connects to (7 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Main window asks main to float the card (`showRecordingReady` → `recording-ready:show`) (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:104`) — A card floats at the top-right of the recorded display, or of the display under the pointer when the take's display is unknown. The window is shown with `showInactive` and is content-protected. If it fails: If `createWindow` throws, `show()` logs, nulls the window and returns false, so the page shows its in-app card. If the IPC rejects, the hook falls back as well. A window that is created but never loa… Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-107`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:219-226`, `apps/kaipu-record/src/main/infrastructure/auth-store.ts:167-171`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:21-30`.
- Press on the card (chip, Edit first, Open, ✕, Escape) → close → hand-off to the main window (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:122`) — The main window comes forward and the renderer navigates through `pathForHandOff`. If it fails: The card is not hidden when a new take starts, so a press during the take shows the main window mid-recording (reported as a finding). The asset is not checked for existence (reported as a question). Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:122-126`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:166-172`, `apps/kaipu-record/src/main/index.ts:145-150`, `apps/kaipu-record/src/main/index.ts:449-457`, `apps/kaipu-record/src/main/index.ts:683-695`, `apps/kaipu-record/src/main/index.ts:899-902`, `apps/kaipu-record/src/main/recording/recording-hub.ts:689`.
- Hub remembers the display of the latest take (`lastTakeDisplayId`) (`apps/kaipu-record/src/main/recording/recording-hub.ts:666`) — The card opens on the recorded display. If it fails: A take stopped before the lookup resolves keeps the area or countdown display, or null, so the card falls back to the cursor display. That is only a placement difference. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:646`, `apps/kaipu-record/src/main/recording/recording-hub.ts:666`, `apps/kaipu-record/src/main/recording/recording-hub.ts:707-714`, `apps/kaipu-record/src/main/recording/recording-hub.ts:934-941`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:237-244`.
- Card renderer reports its height and its readiness (`resize`, `card-ready`) (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:108`) — The window fits the card and nothing paints before the renderer can receive the payload. If it fails: A window destroyed by the system is recreated on the next `show`. A malformed size is ignored. Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:108-121`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:70-80`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:209-213`, `apps/kaipu-record/src/main/screenshots/capture-toast-window.ts:118-124`.
- The detail page asks main to float "Your video is ready" once a fresh recording's file has been probed (IPC `showRecordingReady`) (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141`) — A floating always-on-top card in a corner of the recorded display. The detail page shows no in-app card unless the fallback fired. If it fails: A rejected IPC or a false answer falls back to the in-app card (covered by a test). A probe that never settles shows nothing and falls back to nothing. A window that is created but whose renderer fai… Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:18-31`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/probe-source.ts:28-47`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:124-155`, `apps/kaipu-record/src/renderer/src/shell/app-root.tsx:75`.
- A press on the floating card is turned into a route in the main window (`recording-ready:open` hand-off) (`apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:13`) — The main window comes forward and navigates to Prepare, the editor or the recording page. If it fails: If the main window was destroyed, `showMainWindow` recreates it and the send is queued. The hook is mounted in `AppRoot`, so it is subscribed whenever the shell is up. Navigation away from an unsaved… Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:13-34`, `apps/kaipu-record/src/renderer/src/features/prepare/prepare-path.ts:8-11`, `apps/kaipu-record/src/renderer/src/features/editor/open-in-editor.ts:32-35`, `apps/kaipu-record/src/main/index.ts:145-150`, `apps/kaipu-record/src/main/index.ts:449-457`, `apps/kaipu-record/src/main/index.ts:897-903`, `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx:223-233`.
- A new window root `?window=recording-ready` renders `RecordingReadyCard` and reports its height to main (`apps/kaipu-record/src/renderer/src/main.tsx:66`) — A transparent 452 DIP-wide window sized to the card, with the shadow unclipped. If it fails: Until the renderer reports ready, main does not show the window. If the renderer never loads, nothing shows and there is no fallback (documented under "Not done"). Main ignores resize and action mess… Evidence: `apps/kaipu-record/src/renderer/src/main.tsx:60-71`, `apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:24-53`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-126`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:218-226`, `apps/kaipu-record/src/renderer/src/assets/main.css:81-93`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 15 | 998 | 8 | reviewed | 16 | $0.38 |
| Batch 2 of 2 | 13 | 297 | 4 | reviewed | 28 | $0.35 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.74</sub>

<!-- wachi:review -->

<!-- agent-review sha=b2705a9ce2593b29ae50235312a4226955bbbb36 -->

<!-- wachi:attempt id=18c99cfa-1251-4dd7-b3de-ea53b74e7968 -->

