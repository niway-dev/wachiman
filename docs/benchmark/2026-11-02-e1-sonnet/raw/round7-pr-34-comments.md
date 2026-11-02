## apps/kaipu-record/src/main/recording/recording-ready-window.ts:104 by github-actions[bot]

👮 **Wachiman** · 🟡🔐 **Consider · security: `recording-ready:show` accepts a call from any window, not just the main window (confidence medium)**

The `ipcMain.handle` for `recordingReadyShow` parses the payload but never checks `event.sender`. The three card-side channels do check it through `isOwnSender`. The camera bubble, control bar, capture overlay, toast and shade windows load the same preload and expose the same `window.electronAPI.showRecordingReady`. Any of them can float a card with an arbitrary `assetId`, and the Open/chip/Edit actions then navigate the main window to that id. `auth-store.ts:167-171` (`requireMainWindow`) does this check for auth IPC. The handler's own comments call the main window the only caller. Reject the call unless `event.sender` is the main window's `webContents`. `createRecordingReadyWindow` would need a `getMainWindow` dependency for that.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/index.ts:899 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The card stays clickable during the next take, and its actions pull the main window into the recording (confidence medium)**

Nothing hides the ready card when a new take starts: `recordingStart` (`recording-hub.ts:647-689`) hides the main window but does not touch the card. The PR's own step 7 ("record twice without closing the card") relies on that. While a take is active, a chip, Open or Edit first on the old card runs `openInMain`, which calls `showMainWindow()` (`index.ts:449-457`). That shows and focuses the main window the hub just hid. The window is not content-protected, so it lands in the video being recorded, with no error or other sign. Close the card when a take starts, or make `openInMain` do nothing while `hub.isActive()` or `hub.isPending()`.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/index.ts:899 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Hand-off does not check the recording still exists, unlike the toast's `openSavedScreenshot` (confidence low)**

`openSavedScreenshot` (`index.ts:683-695`) calls `currentVault().describe(id)` and bails with a warning if the item is gone before it sends anything. `openInMain` shows the main window and sends the hand-off without that check. If the recording was deleted while the card was up, the main window opens on a Prepare, editor or detail route for a missing asset. Is that handled well by those pages, or should main check first?

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/status-cards/post-recording-card.tsx:45 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Component docs still describe the in-app lifetime (confidence medium)**

The docblock says the card "stays until the user picks something, closes it or leaves the page". In the floating window there is no page to leave: it stays until an action, ✕ or Escape, or until the next take replaces it. Line 47 is also now well over the file's wrap width. Reword the paragraph to cover both hosts.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: The floating card is asked for again each time the detail page remounts under the same history entry (confidence medium)**

`useFloatingReadyCard` keeps its "asked once" guard in a `useRef` (`use-floating-ready-card.ts:18`). The ref lives only as long as the component. `fromRecording` comes from `location.state`, and nothing clears it. `app-root.tsx:75` pushes it, and the detail page never replaces the entry. So take a recording, press a chip or Open on the floating card, and let main navigate the main window away (`use-recording-ready-hand-offs.ts:31`). Pressing Back remounts the page on the original entry. `location.key` and `fromRecording` are intact, and the new ref is empty. The page then asks main for the card again, and a new always-on-top window floats over whatever app the user is in. The in-app card had the same remount behaviour. The cost is now higher, because the floating one interrupts other apps. The comment at lines 124-126 and the doc's "once per arrival" are also not true on Back. Fix: remember the asked key outside the component (a module-level set), or clear `fromRecording` with `navigate(..., { replace: true, state: null })` once the card has been asked for. If the card is meant to come back on Back, say so in the comment and the doc.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:140 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: A probe that never settles means the card never shows, with no fallback (confidence low)**

The floating ask now waits for `probeState.status` to be `ready` or `error` (line 140). `probeSource` (`probe-source.ts:28-47`) has no timeout. It awaits mediabunny track and packet calls, and it only returns null if one of them throws. If one hangs on a large or odd file, `useSourceProbe` stays `loading`. The floating card is never requested and the in-app fallback (`fallbackFor`) is never set, so the card is lost silently. Before this change the in-app card painted at once and filled in its numbers later. Consider a short deadline, for example treating `loading` as settled after about 2 s, so the card still opens with `durationSeconds` and `dimensions: null`.

<!-- wachi:finding -->

