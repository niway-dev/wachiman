## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:939 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A camera-off that lands before a queued turnWebcamOn runs leaves the camera recording while the toggle says off (confidence high)**

Turning the camera on puts `handle.turnWebcamOn()` on `queue` (line 939). Turning it off calls `handle.turnWebcamOff()` synchronously (line 928), not on the queue. The comment says "an off that follows waits for this camera to open", but the off does not wait. Here is how it goes wrong when the queued on has not started yet. This happens when an earlier item still holds `queue`: a mic toggle awaiting `acquireMicrophone`, a noise-suppression reopen, or an earlier `turnWebcamOn` still opening during quick off/on/off clicks.

1. Off: `turnWebcamOff` sets `cameraWanted = false` and `cameraRequest++` (recorder-engine.ts:771-772), then returns true.
2. The queued on runs later. `cameraWanted` is false, so it does not return at line 781. It takes a new request number (line 783), opens the camera and feeds the relay (lines 784-808). No later toggle bumps `cameraRequest`, so it returns "ok".
3. Back in the store, `webcamOn` is false, so the gap stays open (line 943).

Result: the user turned the camera off and main parked the bubble (hidden), but the recorder holds the camera open again. The in-use light is on, and the face is written into `<name>.webcam.mp4` until the next on or the end of the take. The editor hides it only because the gap stays open, so the file still contains footage the user turned off.

Fix: in the queued callback, skip the call when the toggle has moved on, e.g. `if (!webcamOn) return;` before `await handle.turnWebcamOn()`. Alternatively, queue the off as well.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:943 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: A superseded turnWebcamOn closes the gap before the newer camera delivers a frame (confidence medium)**

When an on is superseded (off, then on again while it opens), the engine returns "ok" for the stale request (recorder-engine.ts:792 and :810). By then the newer on has set `webcamOn = true`, so `gaps.close(takeTimeMs())` runs at line 943 even though the camera from the next queued `turnWebcamOn` has not reached the file yet. The held frame then shows in the editor while that camera opens, for up to `WEBCAM_OPEN_TIMEOUT_MS`. This goes against the stated rule that a gap closes on the first new frame. One option is to have the engine tell "superseded" apart from "fed", or to tag each queued on with a request number in the store and close the gap only for the latest one.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:2065 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test claims to cover the hub reset but exercises only abort (confidence high)**

The test is named "a bubble parked when the take is aborted or the hub reset is destroyed too", but it only drives `recordingAbort`. The new `releaseParkedBubble()` in the forced-reset path (recording-hub.ts:1022) and in `applyStopWindowState` (:846) has no coverage. Add a case for the reset, or rename the test.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.test.ts:1646 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A quick off → on → off → on closes the gap before the second camera's first frame, so the editor shows a frozen face (confidence medium)**

The store test covers off → on → off while the camera reopens. It does not cover the case where a second `on` arrives while the first reopen is still pending, and the code gets that case wrong.

Sequence (recorder-store.ts:924-953 with recorder-engine.ts:769-819):
1. off: the gap opens.
2. on₁: queued. The engine starts `openWebcamWithin`.
3. off₂: the engine bumps `cameraRequest` and returns true. `gaps.open` does nothing because a gap is already open.
4. on₂: the store sets `webcamOn = true` and queues a second `turnWebcamOn` after on₁.
5. on₁'s open finishes. `request !== cameraRequest`, so the engine stops that stream and returns "ok" (recorder-engine.ts:790-792). Back in the store, `webcamOn` is now true, so `gaps.close(takeTimeMs())` runs (recorder-store.ts:943).
6. Only after that does on₂ open its camera and feed its first frame. That can take up to `WEBCAM_OPEN_TIMEOUT_MS`.

The gap therefore ends while the relay is still cut and the file is still holding the last frame. The editor seeds a hidden segment only up to that point, so the preview and the export show a frozen face until on₂'s frames arrive. If on₂ fails, the frozen face shows until the file ends. Nothing warns the user.

Suggested fix: close the gap only when the `on` that resolved is the latest one the store issued. For example, keep a counter for `on` requests and skip `gaps.close` when a newer `on` is queued. Add a test here: off, on (pending), off, on, then resolve the first `on`. The gap should stay open until the second one resolves.

<!-- wachi:finding -->

