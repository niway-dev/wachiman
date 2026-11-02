# Blind findings for kaipu-record #402

Every finding below was posted by one of several automated reviewers on the same diff. Reviewer names and labels are removed. Judge each on its merits.


## F01 — `apps/kaipu-record/src/main/recording/recording-shade-window.ts:187`

**Reused shade window never recovers from a renderer crash **

The shade window is now created once and kept for the whole session. `ensureWindow` only builds a new one when the window is `null` or destroyed (line 135), and it only listens for `closed` (lines 187-193). A renderer crash leaves the BrowserWindow open: it is not destroyed and `ready` stays true. After that, every later `show` takes the reuse path (lines 78-91). `send` goes to a dead webContents, `showInactive` puts up an empty transparent window, and `onShown` fires right away. The hub then marks the countdown as shown (`recording-hub.ts:546-551`), so the recorder starts counting with no visible 3-2-1 and no REC border, for every take until the app restarts. Nothing tells the user.

Before this change each take loaded a fresh window, so a crash affected only one take. The sibling overlay windows handle this case: `capture-overlay-windows.ts:657-660` reacts to `render-process-gone`, and to `did-fail-load` and `unresponsive`.

Fix: on `render-process-gone`, destroy the window (or set `this.window = null; this.ready = false`) so the next `show` loads a new one.


## F02 — `apps/kaipu-record/src/renderer/src/features/screenshots/overlay/overlay-query.test.ts:26`

**The spare test's `frame: null` / `intent: "capture"` assertions only check the defaults **

`QUERY` has no `frame` or `intent` parameter, so `frame: null` and `intent: "capture"` hold whether or not `spare=1` is set. The parser reads `frame` the same way with or without the flag (overlay-query.ts:90). As written, the test pins only `spare` and `scaleFactor`, while its name suggests it checks how a spare treats mode, intent and frame. Either drop those two expectations or name the test after what it checks (the flag is parsed). The state-driven behaviour itself is covered in capture-overlay.test.tsx.


## F03 — `apps/kaipu-record/src/main/recording/recording-shade-window.ts:185`

**Preserve the initial shade state until the renderer is ready.**

`ready-to-show` can send `recordingShadeState` before `RecordingShade` registers its listener. The preload listener does not replay earlier messages. The shade can therefore become visible while it remains in its idle state.

Have the renderer send a ready message after it subscribes. In response, call `present` or resend the current state.


## F04 — `apps/kaipu-record/src/main/recording/recording-shade-window.test.ts:191`

**"(crash, closed)" test only covers destroy **

The test calls `destroy()`, which goes through the `closed` path. A renderer crash leaves the window open and never fires `closed`, so the crash case in the test's name is not exercised. The fake window has no `webContents.on` to simulate it either. Either add a `render-process-gone` case with the fix above, or rename the test.


## F05 — `apps/documentation/src/content/docs/desktop/recording-pipeline.mdx:452`

**"With the countdown off nothing changes" leaves out the new hide-settle wait **

With the countdown off, `startTake` still goes through `hideAppForTake`. That function now asks `recordingHideMainWindow()` and waits `WINDOW_HIDE_SETTLE_MS` when the window was on screen, which is the Record page's case (recorder-store.ts:380-389). `beginTake` awaits that before `begin()` (recorder-store.ts:527). So a countdown-off take started from the Record page now begins about 50 ms later than before. Consider saying that it acquires at once and begins once it is acquired and the hide has settled (step 3), rather than "nothing changes".


## F06 — `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:490`

**System-audio write-back now happens during the countdown and survives a cancel **

The live-settings forwarder is now attached as soon as the countdown's acquisition resolves (line 490). Its constructor writes `isSystemAudioEnabled: false` back to the persisted settings when the prepared engine has no loopback (lines 727-730). Before this change, that write-back ran only once a take had actually started. Now a countdown the user cancels with Esc (lines 399-407) still turns their System audio toggle off for good, even though nothing was recorded. When loopback is missing permanently (the macOS dev build), the next real take would flip it off anyway. When the loopback acquisition fails only transiently, the user's preference is lost silently. One option: delay that one write-back until `beginTake` commits the take (for example from `sync`, or just before `prepared.begin()`), and keep `sysOn = false` locally.


## F07 — `apps/kaipu-record/src/renderer/src/features/screenshots/overlay/capture-overlay.test.tsx:231`

**Spare test says the mode comes from the state, but the state's mode matches the query **

The test is named "takes the mode and the frame display from the state, not from the loaded query", but both pushes send `mode: "frame"` and the query is also `query("frame", …)`. So the mode half of the claim is never tested. If the overlay kept the query's `ui` for a spare, the test would still pass. The earlier test (line 226) does push `mode: "screen"`, but it only checks for `hint-pill`, which renders in every mode (`capture-overlay.tsx:310`). One way to cover it: load the spare with `query("frame", { spare: true })`, push `mode: "screen"`, and assert something only Screen mode renders.


## F08 — `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:89`

**Is 50 ms enough to keep the app window out of the first encoded frame? **

Before this change, `recordingStart` hid the main window and only then did the screen capture open. That took about a second, so the app's window was long gone before the first frame. Now, on the Record page, the capture opens during the countdown while the window is still on screen. `hideAppForTake` hides the window and then waits only `WINDOW_HIDE_SETTLE_MS` (50 ms) before `prepared.begin()` starts the output (recorder-store.ts:380-389, 525-535). The comment's estimate is one 30 fps frame plus one display refresh. That leaves no margin for the OS capture pipeline's latency (ScreenCaptureKit / DXGI delivery) or for the compositor canvas still holding the last frame it drew. If that latency goes over 50 ms on some machines, the app shows up in the first frame of the video and no error says so. Has the 50 ms been checked on real macOS and Windows captures? A safer option would be to wait for the first capture frame that arrives after the hide, for example via `requestVideoFrameCallback`, instead of a fixed delay.


## F09 — `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.test.tsx:1063`

**Test name says 'when the take begins', but it never calls begin() **

"a level changed during the countdown is already in effect when the take begins" calls `prepareEngine` and `setMicLevel(60)` and checks the ramp, but never calls `prepared.begin()`. So nothing checks that `begin` keeps the level set during the countdown (for example, that it doesn't rebuild or reset the gain). Either `await prepared.begin()` and check the gain afterwards, or rename the test to match what it checks.


## F10 — `apps/kaipu-record/src/main/recording/recording-shade-window.ts:134`

**Reused shade has no recovery from a crashed or failed renderer, so one failure lasts the whole session **

Before this change, every take created its own shade window, so a renderer that crashed or failed to load affected only that take. Now `ensureWindow` returns the existing window whenever `!isDestroyed()` (line 135). It listens only for `ready-to-show` and `closed` (lines 181-193), not for `render-process-gone`, `did-fail-load` or `unresponsive`.

This causes two problems:
- If the prewarmed page fails to load (or the renderer dies before it paints), `ready` stays false forever. Every later `show` sets `wanted` and returns at line 88, waiting for a `ready-to-show` that never comes. The hub's `onShown` (`markCountdownShown`, recording-hub.ts:546-551) never runs, so `recordingCountdownVisible` (recording-hub.ts:558-561) stays pending on every region countdown for the rest of the session.
- If the renderer crashes after it painted, `ready` stays true. `present` sends state to a dead page, shows an empty window and calls `onShown` at once. Every later countdown and REC border is invisible, with nothing telling the user why.

The overlay windows guard against exactly this case (capture-overlay-windows.ts:657-670). Suggested fix: on `render-process-gone` and on main-frame `did-fail-load` (ignoring ERR_ABORTED), destroy the window so the `closed` handler resets it and the next `show` loads a fresh one. The new test "loads a new window when its page is gone (crash, closed)" only calls `destroy()`, so it does not cover a crash.


## F11 — `apps/kaipu-record/src/main/recording/recording-shade-window.test.ts:191`

**"crash" case in the test name is not exercised **

The test is named "loads a new window when its page is gone (crash, closed)", but it only calls `destroy()`, which fires `closed`. A renderer crash does not destroy the window, so the case the name promises is not covered. Either cover a crash once one is handled (see the finding on `recording-shade-window.ts:187`), or drop "crash" from the name.


## F12 — `apps/kaipu-record/src/main/recording/recording-shade-window.ts:80`

**Does setBounds size the shade correctly when it moves between displays with different scale factors? **

Before, the shade was created at the target display's bounds every take. Now one window is created at the primary display's bounds (line 58) and moved with a single `setBounds(display.bounds)`. On Windows, Electron has a known problem: one `setBounds` that moves a window across monitors with different DPI can give the wrong size. If that happens here, the dim and the REC border would sit in the wrong place around the area. Has this been tried on mixed-DPI setups? The PR body lists it as a risk to check by hand. If it does misbehave, calling `setBounds` twice (move, then resize) is the usual workaround.


## F13 — `apps/kaipu-record/src/main/screenshots/capture-overlay-windows.ts:691`

**Synchronize the first overlay state with the renderer subscription.**

`reveal` sends `screenshotOverlayState` from the `ready-to-show` callback. `CaptureOverlay` registers `bridge.onState` in a React `useEffect`, and the preload listener does not buffer earlier messages. If `ready-to-show` runs before that effect, the spare keeps `received` set to `false` and renders `null`.

Add a renderer-ready handshake, or resend the state when the renderer reports that it has registered the listener.


## F14 — `apps/kaipu-record/src/main/recording/recording-shade-window.ts:137`

**The reused shade window never recovers from a renderer crash or failed load.**

`ensureWindow` returns the existing window whenever `isDestroyed()` is false. The shade window is now long-lived, but it has no `render-process-gone`, `did-fail-load` or `unresponsive` handler.

If the renderer dies, `ready` stays true and `present` sends to a dead page. Each later countdown shows an empty, screen-covering window. The window never gets replaced.

The capture overlay handles these events. Do the same here. Destroy the window on these events so the existing `closed` handler resets state and the next `show` creates a new one.


## F15 — `apps/kaipu-record/src/main/recording/recording-shade-window.ts:187`

**A crashed shade renderer is reused for every later take and paints nothing **

The shade window now lives for the whole session. `ensureWindow` only replaces it on `closed` (lines 187-193), and nothing listens for `webContents` `render-process-gone`. When the shade renderer crashes, the BrowserWindow stays open and `ready` stays true. Every later `show` sends state to a dead page, calls `showInactive` on an empty transparent window and fires `onShown`, so the hub marks the countdown as shown (recording-hub.ts:546-551). From then until the app restarts, the user gets no dim, no 3-2-1 number and no REC border, and nothing says why. Before this change each take loaded a new window, so a crash lasted for one take only. The overlay windows in this same PR guard against this case (capture-overlay-windows.ts:655-660). Suggested fix: on `render-process-gone`, destroy the window (or set `this.window = null` and `ready = false`) so the next `show` or `prewarm` loads a new one.


## F16 — `apps/kaipu-record/src/main/recording/recording-shade-window.ts:126`

**Can a reused shade briefly show the previous take's frame? **

`hide()` hides the window first and only then sends `idle` (line 114, then line 115). While the window is hidden, Chromium may not produce a composited frame for that state. `present()` sends the new state and calls `showInactive()` straight away (lines 126-127), without waiting for the renderer to receive or paint it. So when the window comes back, can the OS show the last frame it composited, which is the previous take's REC border or dim, for a frame or two? The PR claims "a reused window never repaints the previous take" and lists the Retina ↔ non-Retina move as a manual check. Has this ordering been checked on macOS and Windows? An ack from the renderer after it paints, or `webContents.invalidate()` before the show, would close the gap.


## F17 — `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:388`

**Does the 50 ms settle wait run on time once the main window is hidden? **

`hideAppForTake` waits `delay(WINDOW_HIDE_SETTLE_MS)` in the main window's renderer right after main has called `mainWindow.hide()` (recording-hub.ts:599-604). The bar, shade, overlay and camera windows all set `backgroundThrottling: false`, but the main window does not set it anywhere in `src/main`. If Chromium throttles timers in this hidden renderer, the 50 ms timer can fire much later, and the clock starts late. Starting on time at the end of the countdown is the whole point of this change. Have you checked that the hidden main window's timers aren't throttled here (for example, because an active capture or AudioContext exempts the page)? Your own `clock started at countdown end +Nms` mark would show it.
