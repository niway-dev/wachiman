# Judge: kaipu-record PR #402 (head 01dfe73f), blind

Evidence base: head files read via git show. Later-fix check: `git log 01dfe73f..origin/main` on the shade files shows only dac72e05 and ad43588c (unrelated); `git grep render-process-gone origin/main` finds no handler in recording-shade-window.ts. The catalogued bug is fixed in afd007df (adds a renderer-to-main "send me the state" request after `onState` subscribes; main resends in capture-overlay-windows.ts).

## Per-finding

**F01** Valid, Medium. recording-shade-window.ts:135 returns the existing window if not destroyed; listeners only `ready-to-show` (181) and `closed` (187-193); no `render-process-gone`. Crash leaves ready=true, so `present` (122-131) sends to a dead page and calls onShown. Not fixed later. Match: none. Group A. Quality: Effect 5, Location 4, Cause 5, Fix 5, Signal 4 (sum 4.6, rounded 5). Quote: "A renderer crash leaves the BrowserWindow open: it is not destroyed and `ready` stays true."

**F02** Valid, Low. overlay-query.test.ts:26-30: `frame: null` and `intent: "capture"` are the defaults, so the assertions do not depend on `spare=1`. Weak test, naming mismatch. Not fixed later (afd007df touched this test only to add a query case). Match: none. Quality 4. Quote: "`QUERY` has no `frame` or `intent` parameter, so `frame: null` and `intent: "capture"` hold whether or not `spare=1` is set."

**F03** Unconfirmed, Medium. Same race shape as the catalogued bug but in the shade window: ready-to-show sends state (recording-shade-window.ts:181-186) while recording-shade.tsx:42 attaches `onRecordingShadeState` in useEffect. Only reachable on the "loaded fresh" path (line 87-88); prewarm normally makes the window ready long before; needs a runtime. Not the overlay window of the ground truth, and afd007df did not change the shade. Match: partial (same mechanism, wrong window, speculative). Quality 3. Quote: "`ready-to-show` can send `recordingShadeState` before `RecordingShade` registers its listener."

**F04** Valid, Low. recording-shade-window.test.ts:191-198 only calls `destroy()` (fires `closed`); no crash path. Not fixed later. Match none. Group B (with F11). Quality 4. Quote: "A renderer crash leaves the window open and never fires `closed`, so the crash case in the test's name is not exercised."

**F05** Partly valid, Info. recording-pipeline.mdx:452 says "nothing changes ... starts when acquired", but recorder-store.ts:380-388 awaits the 50 ms settle when the main window was visible; beginTake awaits `hidden` (~527). Doc imprecision of ~50 ms. Not fixed later (not checked beyond the shade-file log). Match none. Quality 4. Quote: "a countdown-off take started from the Record page now begins about 50 ms later than before."

**F06** Valid, Medium. recorder-store.ts:490 attaches forwardLiveSettings at acquisition; its constructor (~723-728) calls `writeBack({isSystemAudioEnabled:false})` when `!handle.hasSystemAudio`, so a cancelled countdown (stopOrCancelRecording ~397-405) leaves the persisted toggle off. Silent preference change, with the workaround of re-enabling it. Not fixed later (not verified). Match none. Quality 5. Quote: "a countdown the user cancels with Esc still turns their System audio toggle off for good, even though nothing was recorded."

**F07** Valid, Low. capture-overlay.test.tsx:231-243: query is `query("frame", ...)` and both pushes send `mode:"frame"`, so the "mode from state" half is untested; only the frame display varies. Match: none (test for the state-driven path, but not the lost-message race). Quality 4. Quote: "both pushes send `mode: "frame"` and the query is also `query("frame", …)`. So the mode half of the claim is never tested."

**F08** Unconfirmed, Medium. hideAppForTake (recorder-store.ts:380-388) waits a fixed 50 ms; whether capture latency exceeds that needs a real capture. Phrased as a question. Match none. Quality 3. Quote: "If that latency goes over 50 ms on some machines, the app shows up in the first frame of the video and no error says so."

**F09** Valid, Low. recorder-engine.test.tsx:1063-1067 never calls `begin()`, so the name overclaims. Match none. Quality 4. Quote: "calls `prepareEngine` and `setMicLevel(60)` and checks the ramp, but never calls `prepared.begin()`."

**F10** Valid, Medium. Same defect as F01 plus the failed-load branch: if the page never loads, ready stays false, `show` returns at line 87-88 and onShown never fires (recording-hub.ts:546-551 depends on it); no `did-fail-load` handler. Not fixed later. Match none. Group A. Quality 5. Quote: "Every later `show` sets `wanted` and returns at line 88, waiting for a `ready-to-show` that never comes."

**F11** Valid, Low. Same test issue as F04 (test at :191). Match none. Group B. Quality 4. Quote: "A renderer crash does not destroy the window, so the case the name promises is not covered."

**F12** Unconfirmed, Medium. `window.setBounds(display.bounds)` at recording-shade-window.ts:~80 on a reused window; the Windows mixed-DPI sizing issue needs a runtime. Match none. Quality 3. Quote: "On Windows, Electron has a known problem: one `setBounds` that moves a window across monitors with different DPI can give the wrong size."

**F13** Valid, High. capture-overlay-windows.ts `reveal` (call to `sendState` at ~691) runs from `ready-to-show` (line ~651); CaptureOverlay attaches `bridge.onState` in useEffect and the preload does not buffer, so the spare stays `received=false` and renders null, while the window is shown and focused and swallows input. Fixed by afd007df (request-state handshake). High because the user's recording start looks stuck with no error and input is blocked (silent wrong result; no workaround except Esc/restart). Match: **match**. Quality 4. Quote: "If `ready-to-show` runs before that effect, the spare keeps `received` set to `false` and renders `null`."

**F14** Valid, Medium. Same as F01 (ensureWindow at :135-137; no render-process-gone/did-fail-load/unresponsive). Match none. Group A. Quality 4. Quote: "The shade window is now long-lived, but it has no `render-process-gone`, `did-fail-load` or `unresponsive` handler."

**F15** Valid, Medium. Same as F01. Match none. Group A. Quality 5. Quote: "When the shade renderer crashes, the BrowserWindow stays open and `ready` stays true. Every later `show` sends state to a dead page."

**F16** Unconfirmed, Low. hide() (recording-shade-window.ts:~114-115) hides then sends idle; present() sends then showInactive without waiting for a paint; whether a stale frame flashes needs a runtime. Match none. Quality 3. Quote: "can the OS show the last frame it composited, which is the previous take's REC border or dim, for a frame or two?"

**F17** Invalid. Premise false: apps/kaipu-record/src/main/index.ts:260 calls `mainWindow.webContents.setBackgroundThrottling(false)`, so the hidden main window is not throttled. Match none. Quality n/a (misleading).

## Duplicate groups
- Group A (shade renderer crash/failed load, no recovery): F01, F10, F14, F15.
- Group B (shade test does not exercise crash): F04, F11.
- Others unique. F03 and F13 share a mechanism but concern different windows, so they are not duplicates.

## Final table

| F-id | verdict | severity | catalogued match | dup group | quality (0-5) |
|---|---|---|---|---|---|
| F01 | Valid | Medium | none | A | 5 |
| F02 | Valid | Low | none | - | 4 |
| F03 | Unconfirmed | Medium | partial | - | 3 |
| F04 | Valid | Low | none | B | 4 |
| F05 | Partly valid | Info | none | - | 4 |
| F06 | Valid | Medium | none | - | 5 |
| F07 | Valid | Low | none | - | 4 |
| F08 | Unconfirmed | Medium | none | - | 3 |
| F09 | Valid | Low | none | - | 4 |
| F10 | Valid | Medium | none | A | 5 |
| F11 | Valid | Low | none | B | 4 |
| F12 | Unconfirmed | Medium | none | - | 3 |
| F13 | Valid | High | match | - | 4 |
| F14 | Valid | Medium | none | A | 4 |
| F15 | Valid | Medium | none | A | 5 |
| F16 | Unconfirmed | Low | none | - | 3 |
| F17 | Invalid | - | none | - | n/a |
