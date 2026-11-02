## apps/kaipu-record/src/main/recording/recording-shade-window.ts:187 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Reused shade window never recovers from a renderer crash (confidence medium)**

The shade window is now created once and kept for the whole session. `ensureWindow` only builds a new one when the window is `null` or destroyed (line 135), and it only listens for `closed` (lines 187-193). A renderer crash leaves the BrowserWindow open: it is not destroyed and `ready` stays true. After that, every later `show` takes the reuse path (lines 78-91). `send` goes to a dead webContents, `showInactive` puts up an empty transparent window, and `onShown` fires right away. The hub then marks the countdown as shown (`recording-hub.ts:546-551`), so the recorder starts counting with no visible 3-2-1 and no REC border, for every take until the app restarts. Nothing tells the user.

Before this change each take loaded a fresh window, so a crash affected only one take. The sibling overlay windows handle this case: `capture-overlay-windows.ts:657-660` reacts to `render-process-gone`, and to `did-fail-load` and `unresponsive`.

Fix: on `render-process-gone`, destroy the window (or set `this.window = null; this.ready = false`) so the next `show` loads a new one.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-shade-window.test.ts:191 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: "crash" case in the test name is not exercised (confidence high)**

The test is named "loads a new window when its page is gone (crash, closed)", but it only calls `destroy()`, which fires `closed`. A renderer crash does not destroy the window, so the case the name promises is not covered. Either cover a crash once one is handled (see the finding on `recording-shade-window.ts:187`), or drop "crash" from the name.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:490 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: System-audio write-back now happens during the countdown and survives a cancel (confidence medium)**

The live-settings forwarder is now attached as soon as the countdown's acquisition resolves (line 490). Its constructor writes `isSystemAudioEnabled: false` back to the persisted settings when the prepared engine has no loopback (lines 727-730). Before this change, that write-back ran only once a take had actually started. Now a countdown the user cancels with Esc (lines 399-407) still turns their System audio toggle off for good, even though nothing was recorded. When loopback is missing permanently (the macOS dev build), the next real take would flip it off anyway. When the loopback acquisition fails only transiently, the user's preference is lost silently. One option: delay that one write-back until `beginTake` commits the take (for example from `sync`, or just before `prepared.begin()`), and keep `sysOn = false` locally.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/desktop/recording-pipeline.mdx:452 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: "With the countdown off nothing changes" leaves out the new hide-settle wait (confidence high)**

With the countdown off, `startTake` still goes through `hideAppForTake`. That function now asks `recordingHideMainWindow()` and waits `WINDOW_HIDE_SETTLE_MS` when the window was on screen, which is the Record page's case (recorder-store.ts:380-389). `beginTake` awaits that before `begin()` (recorder-store.ts:527). So a countdown-off take started from the Record page now begins about 50 ms later than before. Consider saying that it acquires at once and begins once it is acquired and the hide has settled (step 3), rather than "nothing changes".

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/screenshots/overlay/overlay-query.test.ts:26 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The spare test's `frame: null` / `intent: "capture"` assertions only check the defaults (confidence medium)**

`QUERY` has no `frame` or `intent` parameter, so `frame: null` and `intent: "capture"` hold whether or not `spare=1` is set. The parser reads `frame` the same way with or without the flag (overlay-query.ts:90). As written, the test pins only `spare` and `scaleFactor`, while its name suggests it checks how a spare treats mode, intent and frame. Either drop those two expectations or name the test after what it checks (the flag is parsed). The state-driven behaviour itself is covered in capture-overlay.test.tsx.

<!-- wachi:finding -->

