## apps/kaipu-record/src/main/recording/recording-shade-window.ts:134 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Reused shade has no recovery from a crashed or failed renderer, so one failure lasts the whole session (confidence medium)**

Before this change, every take created its own shade window, so a renderer that crashed or failed to load affected only that take. Now `ensureWindow` returns the existing window whenever `!isDestroyed()` (line 135). It listens only for `ready-to-show` and `closed` (lines 181-193), not for `render-process-gone`, `did-fail-load` or `unresponsive`.

This causes two problems:
- If the prewarmed page fails to load (or the renderer dies before it paints), `ready` stays false forever. Every later `show` sets `wanted` and returns at line 88, waiting for a `ready-to-show` that never comes. The hub's `onShown` (`markCountdownShown`, recording-hub.ts:546-551) never runs, so `recordingCountdownVisible` (recording-hub.ts:558-561) stays pending on every region countdown for the rest of the session.
- If the renderer crashes after it painted, `ready` stays true. `present` sends state to a dead page, shows an empty window and calls `onShown` at once. Every later countdown and REC border is invisible, with nothing telling the user why.

The overlay windows guard against exactly this case (capture-overlay-windows.ts:657-670). Suggested fix: on `render-process-gone` and on main-frame `did-fail-load` (ignoring ERR_ABORTED), destroy the window so the `closed` handler resets it and the next `show` loads a fresh one. The new test "loads a new window when its page is gone (crash, closed)" only calls `destroy()`, so it does not cover a crash.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-shade-window.ts:80 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Does setBounds size the shade correctly when it moves between displays with different scale factors? (confidence low)**

Before, the shade was created at the target display's bounds every take. Now one window is created at the primary display's bounds (line 58) and moved with a single `setBounds(display.bounds)`. On Windows, Electron has a known problem: one `setBounds` that moves a window across monitors with different DPI can give the wrong size. If that happens here, the dim and the REC border would sit in the wrong place around the area. Has this been tried on mixed-DPI setups? The PR body lists it as a risk to check by hand. If it does misbehave, calling `setBounds` twice (move, then resize) is the usual workaround.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:388 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Does the 50 ms settle wait run on time once the main window is hidden? (confidence low)**

`hideAppForTake` waits `delay(WINDOW_HIDE_SETTLE_MS)` in the main window's renderer right after main has called `mainWindow.hide()` (recording-hub.ts:599-604). The bar, shade, overlay and camera windows all set `backgroundThrottling: false`, but the main window does not set it anywhere in `src/main`. If Chromium throttles timers in this hidden renderer, the 50 ms timer can fire much later, and the clock starts late. Starting on time at the end of the countdown is the whole point of this change. Have you checked that the hidden main window's timers aren't throttled here (for example, because an active capture or AudioContext exempts the page)? Your own `clock started at countdown end +Nms` mark would show it.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.test.tsx:1063 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test name says 'when the take begins', but it never calls begin() (confidence high)**

"a level changed during the countdown is already in effect when the take begins" calls `prepareEngine` and `setMicLevel(60)` and checks the ramp, but never calls `prepared.begin()`. So nothing checks that `begin` keeps the level set during the countdown (for example, that it doesn't rebuild or reset the gain). Either `await prepared.begin()` and check the gain afterwards, or rename the test to match what it checks.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/screenshots/overlay/capture-overlay.test.tsx:231 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Spare test says the mode comes from the state, but the state's mode matches the query (confidence high)**

The test is named "takes the mode and the frame display from the state, not from the loaded query", but both pushes send `mode: "frame"` and the query is also `query("frame", …)`. So the mode half of the claim is never tested. If the overlay kept the query's `ui` for a spare, the test would still pass. The earlier test (line 226) does push `mode: "screen"`, but it only checks for `hint-pill`, which renders in every mode (`capture-overlay.tsx:310`). One way to cover it: load the spare with `query("frame", { spare: true })`, push `mode: "screen"`, and assert something only Screen mode renders.

<!-- wachi:finding -->

