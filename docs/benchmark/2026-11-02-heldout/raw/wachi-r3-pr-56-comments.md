## apps/kaipu-record/src/main/recording/recording-shade-window.ts:187 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A crashed shade renderer is reused for every later take and paints nothing (confidence medium)**

The shade window now lives for the whole session. `ensureWindow` only replaces it on `closed` (lines 187-193), and nothing listens for `webContents` `render-process-gone`. When the shade renderer crashes, the BrowserWindow stays open and `ready` stays true. Every later `show` sends state to a dead page, calls `showInactive` on an empty transparent window and fires `onShown`, so the hub marks the countdown as shown (recording-hub.ts:546-551). From then until the app restarts, the user gets no dim, no 3-2-1 number and no REC border, and nothing says why. Before this change each take loaded a new window, so a crash lasted for one take only. The overlay windows in this same PR guard against this case (capture-overlay-windows.ts:655-660). Suggested fix: on `render-process-gone`, destroy the window (or set `this.window = null` and `ready = false`) so the next `show` or `prewarm` loads a new one.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-shade-window.test.ts:191 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "(crash, closed)" test only covers destroy (confidence high)**

The test calls `destroy()`, which goes through the `closed` path. A renderer crash leaves the window open and never fires `closed`, so the crash case in the test's name is not exercised. The fake window has no `webContents.on` to simulate it either. Either add a `render-process-gone` case with the fix above, or rename the test.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-shade-window.ts:126 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Can a reused shade briefly show the previous take's frame? (confidence low)**

`hide()` hides the window first and only then sends `idle` (line 114, then line 115). While the window is hidden, Chromium may not produce a composited frame for that state. `present()` sends the new state and calls `showInactive()` straight away (lines 126-127), without waiting for the renderer to receive or paint it. So when the window comes back, can the OS show the last frame it composited, which is the previous take's REC border or dim, for a frame or two? The PR claims "a reused window never repaints the previous take" and lists the Retina ↔ non-Retina move as a manual check. Has this ordering been checked on macOS and Windows? An ack from the renderer after it paints, or `webContents.invalidate()` before the show, would close the gap.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:89 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Is 50 ms enough to keep the app window out of the first encoded frame? (confidence low)**

Before this change, `recordingStart` hid the main window and only then did the screen capture open. That took about a second, so the app's window was long gone before the first frame. Now, on the Record page, the capture opens during the countdown while the window is still on screen. `hideAppForTake` hides the window and then waits only `WINDOW_HIDE_SETTLE_MS` (50 ms) before `prepared.begin()` starts the output (recorder-store.ts:380-389, 525-535). The comment's estimate is one 30 fps frame plus one display refresh. That leaves no margin for the OS capture pipeline's latency (ScreenCaptureKit / DXGI delivery) or for the compositor canvas still holding the last frame it drew. If that latency goes over 50 ms on some machines, the app shows up in the first frame of the video and no error says so. Has the 50 ms been checked on real macOS and Windows captures? A safer option would be to wait for the first capture frame that arrives after the hide, for example via `requestVideoFrameCallback`, instead of a fixed delay.

<!-- wachi:finding -->

