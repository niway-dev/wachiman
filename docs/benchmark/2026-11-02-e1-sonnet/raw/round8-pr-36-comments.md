## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:939 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: An off→on→off toggle can leave the camera open while the toggle is off (confidence medium)**

The turn-on is queued (`queue = queue.then(...)`), but the next turn-off is not: it calls `handle.turnWebcamOff()` synchronously (line 928). The comment at line 938 says the off "waits for this camera to open and releases it". That only holds once `turnWebcamOn` is already running, because only then does its `request !== cameraRequest` check catch the off.

If the queued on is still waiting behind another item (a mic `getUserMedia`, a noise-suppression reopen), this happens:
- The second off runs `turnWebcamOff()` at `recorder-engine.ts:769`. `cameraWanted` is already false, so it bumps `cameraRequest`, cuts the relay and returns true.
- The queued `turnWebcamOn()` then runs. `if (cameraWanted) return "ok"` (line 781) does not fire, so it opens the camera and feeds the relay.
- The forwarder sees `webcamOn === false`, so it does not close the gap (line 943).

The result: the recorder holds the camera (in-use light on) while the user's toggle is off. The bubble's renderer has released it, so nothing shows this, and the gap stays open until the next toggle or the end of the take.

Fix: skip the queued turn-on if the camera was turned off again before it runs, for example `if (!webcamOn) return;` at the top of the queued callback (line 940). Alternatively, have `turnWebcamOn` check the current wanted state after it is dequeued.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:438 by github-actions[bot]

👮 **Wachiman** · 🟡🧹 **Consider · cleanup: New `releaseWebcam` declaration splits `releaseAll` from its doc comment (confidence high)**

The block comment at 434–437 ("Frees everything acquired, for a start that failed…") described `releaseAll`. The inserted `/** Releases the webcam relay… */ let releaseWebcam` now sits between that comment and `releaseAll` (line 440). The first comment is therefore no longer attached to the function it describes. Move the `releaseWebcam` declaration above the `releaseAll` doc block.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:2065 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test name claims the hub-reset path, but only abort is exercised (confidence high)**

The title is "a bubble parked when the take is aborted or the hub reset is destroyed too", but the body only calls `recordingAbort`. The reset path, where `releaseParkedBubble()` was added at `recording-hub.ts:1022`, has no coverage. Either add the reset case or drop it from the title.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.test.ts:78 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The cut-camera test never reaches the code path its comment describes (confidence medium)**

The comment at line 79 says a frame the old camera still delivers "is dropped (and closed), not relayed". `relay.cut()` cancels the reader, so the stream is already closed. `first.push(late)` then throws, which the surrounding try/catch swallows. The test therefore never exercises the `current !== reader` branch in `webcam-relay.ts:91-94` that closes and drops a late frame, and nothing asserts `late.close`. The test would still pass if that branch were deleted. Either drive a read that has already resolved with a value before the cut, or reword the comment to say the cancel is what keeps the frames out.

<!-- wachi:finding -->

