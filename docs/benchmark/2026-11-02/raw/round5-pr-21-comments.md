## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:939 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Camera off → on → off can leave the camera open while the toggle says off (confidence high)**

Turning the camera off calls `handle.turnWebcamOff()` synchronously (line 928). Turning it on again does not: it queues `handle.turnWebcamOn()` on the shared `queue` (line 939). Mic toggles (line 902) and noise-suppression reopens (line 868) also run on that queue. If the queue is busy, say while a mic is opening, an off that comes in after the on reaches the engine before the queued `turnWebcamOn` starts. In the engine, `turnWebcamOff` then finds `cameraWanted` already false. It bumps `cameraRequest` and returns true (recorder-engine.ts:769-778).

When the queued `turnWebcamOn` finally runs, it sees `cameraWanted === false`. It sets `cameraWanted` to true, takes a fresh `request` and opens the camera (recorder-engine.ts:781-787). Nothing bumps the counter after that, so the supersession check at line 790 passes. The camera's frames go into the webcam file and the in-use light comes on, while the toggle shows off and main has parked the bubble. The store sees "ok" with `webcamOn === false` and leaves the gap open, so the editor hides those frames. Nothing visible tells the user the camera is recording.

The comment at line 938 says an off that follows "waits for this camera to open and releases it", but the off path is not on the queue. Fix: inside the queued callback, return early when `!webcamOn` before calling `turnWebcamOn`. Another option is to put the off path on the queue too.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:438 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: `releaseAll`'s doc comment now sits on `releaseWebcam` (confidence high)**

The new `let releaseWebcam` and its JSDoc were added between the existing comment ("Frees everything acquired, for a start that failed…", lines 434-437) and `const releaseAll`. That leaves two consecutive JSDoc blocks. Editors attach the first one to `releaseWebcam`, and `releaseAll` loses its description. Move the declaration above the `releaseAll` comment.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.test.ts:79 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The "late frame is dropped and closed" case is never exercised (confidence high)**

`relay.cut()` cancels the old camera's reader (`webcam-relay.ts:66-70`), and that closes the fake stream. So `first.push(late)` throws inside the `try` and the frame never reaches the pump. The relay's own drop branch (`if (current !== reader) { value.close(); break; }`, `webcam-relay.ts:91-94`) never runs, and nothing checks `late.close`. The test passes because the stream was cancelled, not because the relay drops a frame that was already in flight. To cover the branch, use a fake processor whose `cancel` does not close the stream, or one that has already queued a frame when `cut()` runs, and then assert `expect(late.close).toHaveBeenCalled()`.

<!-- wachi:finding -->

