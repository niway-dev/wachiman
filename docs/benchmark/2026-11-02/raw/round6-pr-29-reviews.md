## review by github-actions[bot] at 2026-11-02T03:24:36Z

👮 **Wachiman** · review of the whole pull request, at `b2705a9`: all 28 files reviewed.

6 finding(s): 6 to consider; 6 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 (main window manager, IPC contract, preload, hub display, card renderer, hooks) is mostly sound. Everything that crosses IPC is validated, card actions are accepted only from the card's own webContents, and `shared/` takes no value imports. No blockers, and nothing at "fix". Four "consider" findings: (1) `show()` answers true before the card's renderer has loaded, so a load failure loses the card silently, with no in-app fallback; (2) after the user acts on the card, pressing Back remounts the page, which floats the card again; (3) the PostRecordingCard doc still says the card goes away when the user leaves the page, and the floating one does not, not even when the recording is deleted; (4) the card stays up during the next take, and content protection does not keep it out of the video on old Windows.

**Batch 2 of 2.** In this part, the renderer side of the floating card matches the capture-toast pattern it copies, both the render-target branch and the hand-off hook. The page's fallback to the in-app card on a false answer or a rejected IPC is wired correctly and tested, and the CSS padding matches main's window math. The one behavioural gap is the \"once per arrival\" guard. It is a ref that dies on unmount, so router Back to the same history entry floats the card on the desktop again. The old in-app card shared this gap, but an always-on-top window outside the app makes it more intrusive. No test covers that case. The docs, messages and the other tests are accurate.

<details><summary>What the change connects to (6 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Page asks once per arrival (useFloatingReadyCard) and remounts on Back (`apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:18`) — Is `fromRecording` read from location.state, so that it survives Back? Files that would answer it: `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx`.

**Closed, with the lines they rest on**
- Main window asks main to float the card (`recording-ready:show` invoke) (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:104`) — The card appears top-right of the recorded display, or of the cursor's display when that is unknown. On false, the page shows the in-app card. If it fails: Creation throws: false, so the in-app card shows. Load fails or the renderer crashes: true is already returned, nothing paints, and the card is lost silently (reported as a finding). The sender is no… Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-107`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:219-226`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:258-269`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:21-31`.
- Card action → main hides the card and hands off to the main window (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:122`) — The renderer's `useRecordingReadyHandOffs` navigates to Prepare, the editor or the detail page through the existing path helpers. If it fails: A foreign sender or malformed action is ignored. A press after close does nothing, because the payload is null. Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:122-126`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:166-172`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:246-248`, `apps/kaipu-record/src/main/index.ts:897-903`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:13-34`.
- Hub remembers the latest take's display (`apps/kaipu-record/src/main/recording/recording-hub.ts:666`) — The ready card opens on that display. A window source gives null, so the card uses the cursor's display. If it fails: A failed lookup leaves the countdown display or null, and the card falls back to the cursor's display. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:646`, `apps/kaipu-record/src/main/recording/recording-hub.ts:666`, `apps/kaipu-record/src/main/recording/recording-hub.ts:707-713`, `apps/kaipu-record/src/main/recording/recording-hub.ts:934-941`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:237-244`.
- Library detail page asks main to float the ready card once the probe settles (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141`) — The floating window appears on the desktop. If it fails, the in-app status-stack card appears (the inApp flag comes from fallbackFor === key). If it fails: If the IPC rejects or main answers false, the in-app card is the fallback (this is tested at test.tsx:759). If the IPC never resolves, no card is shown at all. If the window is created but its render… Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:16-31`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:130-155`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:263-277`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.test.tsx:759-766`, `apps/documentation/src/content/docs/backlog/floating-ready-window.md:55-56`.
- New render target ?window=recording-ready mounting RecordingReadyCard with a crash forwarder (`apps/kaipu-record/src/renderer/src/main.tsx:66`) — main.css pads the body by 16px. The card frame reports its height to main, and main sizes the window to card height + 2*padding. If it fails: The card renders nothing until main sends a payload in answer to ready(). It subscribes to onShow before calling ready, which is tested. Evidence: `apps/kaipu-record/src/renderer/src/main.tsx:60-71`, `apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:24-53`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:16-19`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:73`, `apps/kaipu-record/src/renderer/src/assets/main.css:85-93`.
- AppRoot subscribes to recording-ready hand-offs and navigates the main window (`apps/kaipu-record/src/renderer/src/shell/app-root.tsx:31`) — A chip opens /prepare/:id?to=..., Edit first opens /editor/video/:id, Open goes to /library/:id. The detail entry carries no fromRecording state, so the card does not reopen. Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:13-34`, `apps/kaipu-record/src/renderer/src/shell/app-root.tsx:27-31`, `apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.test.ts:4-17`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 15 | 998 | 8 | reviewed | 11 | $0.49 |
| Batch 2 of 2 | 13 | 297 | 4 | reviewed | 9 | $0.33 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.82</sub>

<!-- wachi:review -->

<!-- agent-review sha=b2705a9ce2593b29ae50235312a4226955bbbb36 -->

<!-- wachi:attempt id=4529942e-e1c6-4a7c-96a5-5009cd95888c -->

