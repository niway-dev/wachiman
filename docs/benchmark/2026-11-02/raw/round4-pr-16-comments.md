## apps/kaipu-record/src/main/recording/recording-hub.ts:304 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: A failed reopen leaves the face out of both the webcam file and the screen capture (confidence medium)**

When the camera is turned back on while the webcam file is still live, `takeRecordsWebcam()` is true, so line 305 shows the same parked window. That window is protected, and by the PR's own premise (lines 310-313, `camera-bubble-window.ts:40-44`) the running capture leaves it out. Only after that does the renderer try to reopen the camera (`turnWebcamOn`, recorder-engine.ts:779-819). If the reopen fails (busy, denied, or no frame within `WEBCAM_OPEN_TIMEOUT_MS`), it calls `endWebcam`, and main's `recordingWebcamEnded` handler (line 456-460) only runs `bubbleProtection.webcamEnded` and `applyProtection()` on that same excluded window. Main never destroys it or creates a new window, so for the rest of the take the face is in no file. The comment at recorder-store.ts:946-947 says "main put the bubble back in the capture", but nothing does that. The user only hears about it after saving (`webcamUnavailable`). Suggested fix: in the `recordingWebcamEnded` handler, while a take is active and the camera is on, replace the window (destroy + show) the same way line 304 does for a parked one.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:938 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Comment says a following off waits on the queue; it does not (confidence high)**

The comment says the on is queued "so an off that follows waits for this camera to open and releases it". But the off branch (lines 924-934) runs synchronously in the listener and calls `handle.turnWebcamOff()` right away, without going through `queue`. The engine handles a superseded open through `cameraRequest` (recorder-engine.ts:790-793). The comment should describe that mechanism instead.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:438 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: `releaseAll`'s doc comment now sits on `releaseWebcam` (confidence high)**

The new `let releaseWebcam` and its own JSDoc were inserted between `releaseAll`'s doc block (lines 434-437) and `releaseAll`. That leaves two doc comments in a row, and the "Frees everything acquired…" text no longer attaches to `releaseAll`. Move the declaration above that doc block.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.test.ts:79 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The "late frame is dropped and closed" case never reaches the relay's drop branch (confidence high)**

`relay.cut()` calls `reader.cancel()` (`webcam-relay.ts:66-70`). That cancels the fake camera's stream, so `first.push(late)` throws inside the `try` and the frame never reaches the pump. The assertion `written` = `["a1", "b1"]` would pass even if the `current !== reader` guard (`webcam-relay.ts:91-93`) were deleted. The comment also says the late frame is "closed", but nothing checks `late.close`. To cover the guard, enqueue the late frame before `cut()` resolves the pending read, or let the fake processor's `cancel` ignore the cancellation so the frame is still read. Then assert `late.close` was called and the frame was not written.

<!-- wachi:finding -->

