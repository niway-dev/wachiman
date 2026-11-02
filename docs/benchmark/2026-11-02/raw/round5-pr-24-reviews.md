## review by github-actions[bot] at 2026-11-02T03:24:24Z

👮 **Wachiman** · review of the whole pull request, at `b2705a9`: all 28 files reviewed.

6 finding(s): 1 to fix, 5 to consider; 6 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 has one fix-level finding and two minor points.

- **Fix:** the floating "Your video is ready" card is kept out of later captures only by content protection. On Windows before 10 2004, content protection paints the window black in captures instead of leaving it out. The card has no timer and nothing closes it when the next capture starts, so a card left open lands as a black box in the next full-display recording or screenshot. The capture toast it copies is closed before every capture as well.
- **Consider:** the `PostRecordingCard` docstring says the card closes when the user leaves the page, which isn't true for the floating window.
- **Consider:** pressing Back to the fresh recording's page asks main for the floating card again, even after the user dismissed it.

The rest checks out:
- **IPC contract:** messages from the card window are checked against the sender and validated before main acts on them.
- **Preload rule:** `shared/types/recording-ready.ts` has no value imports, so the preload rule holds.
- **Hand-off to the main window:** a recreated main window still gets the navigation, because sends are queued until its renderer is ready.

**Batch 2 of 2.** Part 2 covers the renderer wiring, tests, styles, docs and messages. The fallback and single-ask logic in `useFloatingReadyCard` works within one mount. Remounting the page under the same history entry (for example, Back after a chip) asks main again, so the always-on-top card re-floats. The doc's "never shows twice" claim is wrong for the same reason. The floating card also outlives the page, including when the recording it names is deleted. All three findings are "consider"; none blocks the merge. Tests, CSS and i18n additions look consistent with the code.

<details><summary>What the change connects to (7 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Main window asks main to float the ready card (`recording-ready:show` invoke) (`apps/kaipu-record/src/main/recording/recording-ready-window.ts:104`) — The card is shown inactive at the top-right of the recorded display once the card renderer sends `card-ready`. If it fails: If window creation throws, it resolves false and the page shows the in-app card. If the window is created but its load fails, it resolves true and nothing shows (stated in the PR body). A malformed p… Evidence: `apps/kaipu-record/src/main/recording/recording-ready-window.ts:104-107`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`, `apps/kaipu-record/src/main/screenshots/capture-toast-window.ts:305-307`, `apps/kaipu-record/src/main/index.ts:670`.
- Card action hands off to the main window (`openInMain`) (`apps/kaipu-record/src/main/index.ts:899`) — The main window is shown and focused; `useRecordingReadyHandOffs` navigates to Prepare, the editor or the detail page. If it fails: With no main webContents, sendToRenderer drops the send silently. After showMainWindow recreates the window, the send is queued until the renderer is ready. Evidence: `apps/kaipu-record/src/main/index.ts:145-150`, `apps/kaipu-record/src/main/index.ts:449-457`, `apps/kaipu-record/src/main/index.ts:683-695`.
- Hub remembers the latest take's display (`apps/kaipu-record/src/main/recording/recording-hub.ts:666`) — The card opens on that display, or on the display under the cursor when it is unknown. If it fails: An unknown or absent id falls back to `getCursorDisplay`. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:660-666`, `apps/kaipu-record/src/main/recording/recording-hub.ts:707-714`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:237-244`.
- Page asks for the floating card once per arrival; falls back to the in-app card (`apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:21`) — The floating card appears; the in-app card shows only when the call answers false or rejects. If it fails: A rejected invoke falls back to the in-app card, so nothing is lost. Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:16-31`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:130-155`.
- Recording page asks main to float "Your video is ready" once the probe settles (`apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141`) — On success there is no in-app card and a desktop window appears. On false or rejection, setFallbackFor makes inApp true and the in-app card shows (library-detail-page.tsx:155,263). If it fails: A rejection or false answer falls back to the in-app card, which is visible. A window that is created but whose renderer never loads shows nothing, with no fallback (documented under Not done). If sh… Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-floating-ready-card.ts:16-31`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:101`, `apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:130-155`, `apps/kaipu-record/src/renderer/src/features/prepare/use-prepare-copy.ts:42-67`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:134-147`.
- Floating window root ?window=recording-ready renders RecordingReadyCard (`apps/kaipu-record/src/renderer/src/main.tsx:66`) — The card paints after main sends the payload (recording-ready-window.ts:219-226). Its height is reported through resize. If it fails: Under StrictMode the effect runs twice in dev, which sends ready() twice and makes main resend the payload. That is harmless. Escape with no payload sends dismiss, and main ignores it because act ret… Evidence: `apps/kaipu-record/src/renderer/src/main.tsx:60-71`, `apps/kaipu-record/src/renderer/src/features/recording-ready/recording-ready-card.tsx:24-38`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:108-112`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:166-172`.
- Main window navigates on a floating-card hand-off (`apps/kaipu-record/src/renderer/src/shell/app-root.tsx:31`) — The main window lands on Prepare, the editor or the recording page. If it fails: If the asset was deleted meanwhile, the user lands on a missing-asset page. The floating card is not closed by the page. Evidence: `apps/kaipu-record/src/renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts:28-33`, `apps/kaipu-record/src/main/recording/recording-ready-window.ts:166-172`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 15 | 998 | 8 | reviewed | 9 | $0.53 |
| Batch 2 of 2 | 13 | 297 | 4 | reviewed | 14 | $0.48 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $1.00</sub>

<!-- wachi:review -->

<!-- agent-review sha=b2705a9ce2593b29ae50235312a4226955bbbb36 -->

<!-- wachi:attempt id=ad3f8c3b-2792-44da-8ef8-b0cf38ce5596 -->

