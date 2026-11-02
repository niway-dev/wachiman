## apps/kaipu-record/src/main/index.ts:897 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A card still up when the next take starts can pull the main window into the recording (confidence medium)**

The card has no timer and nothing closes it when a new take starts. `recordingReady` is only created (line 897) and destroyed at quit (line 1093); I found no other call on it in `apps/kaipu-record/src/main`. The capture toast is different: `dismissToast: () => captureToast?.dismiss()` (line 670) is wired into the capture hooks. The recording hub hides the main window at `recordingStart` (`recording-hub.ts:689`). If the user starts another recording while the previous card is still on screen and then presses a chip, Edit first or Open, `openInMain` calls `showMainWindow()` (index.ts:900). That shows and focuses the main window in the middle of the take. Content protection keeps the card out of the video, but not the main window. Close the card when a take starts, for example by exposing `close()` through a hook next to `dismissToast`. Alternatively, have `openInMain` do nothing while `hub.isActive() || hub.isPending()`.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-ready-window.ts:134 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: `show()` answers true even if the card page never loads, so the in-app fallback is skipped (confidence medium)**

`show()` returns true as soon as the `BrowserWindow` object exists. The page is then loaded with `void browserWindow.loadURL(...)` / `void browserWindow.loadFile(...)` (lines 261-267), and a rejected load is not handled. If the load fails, or the renderer never sends `card-ready`, `present()` never runs. The window stays hidden and the renderer's `useFloatingReadyCard` never sets `inApp`. The post-take card is then lost, although the hook's comment says it is "never lost". The window also stays in this state for the rest of the session, because `ensureWindow` reuses it. Catch the load promise in `load`. On failure, destroy or reset the window so the next `show()` recreates it. Since the caller already got true, the first failed attempt would still need a way to reach the page, for example by making `show()` wait for `card-ready` with a timeout.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/pages/library-detail/library-detail-page.tsx:141 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Going Back to the recording page re-opens the floating card (confidence medium)**

The "asked once" guard in `useFloatingReadyCard` is a `useRef` (use-floating-ready-card.ts:18), so it resets whenever the page remounts. Nothing clears `location.state.fromRecording` after the first visit: it is set at app-root.tsx:75 and only read at library-detail-page.tsx:101. So a user who presses a chip on the floating card and lands on Prepare, then goes Back, returns to the same history entry. `showCard` is true again, the probe settles, and a second floating card opens. The in-app card had the same behaviour. Now the card is an always-on-top window on every Space, so the repeat is much more intrusive, and the page comment ("once per arrival") and the backlog doc ("the card never shows twice") no longer hold. Consider keeping the asked key somewhere that survives a remount, such as a module-level set keyed by `location.key`, or replacing the history entry's state once the card is requested.

<!-- wachi:finding -->

