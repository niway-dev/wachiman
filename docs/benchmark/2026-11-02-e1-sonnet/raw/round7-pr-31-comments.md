## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:938 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Comment says an off waits on the queue, but off is not queued (confidence high)**

The comment says the turn-on is queued so that "an off that follows waits for this camera to open and releases it". The off branch (lines 924-934) calls `handle.turnWebcamOff()` synchronously and never touches `queue`. It does not wait. What makes it safe is the engine's `cameraRequest` counter: `turnWebcamOff` bumps it, and the late camera is then stopped at `recorder-engine.ts:790-793`. The queue only serialises one turn-on after another. Reword the comment so it names the counter, not the queue, as the guard.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:2065 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test name claims the hub reset is covered, but only abort is tested (confidence high)**

The test is named "a bubble parked when the take is aborted or the hub reset is destroyed too", yet it only drives `recordingAbort`. The forced-reset path, where `releaseParkedBubble()` was added at `recording-hub.ts:1022`, has no test. Either add a case for it or drop "or the hub reset" from the name.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.test.ts:69 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The 'cut camera's frames never get through' test passes without exercising the drop path (confidence medium)**

`relay.cut()` cancels the camera's reader, which closes the underlying stream. The test's own `try/catch` around `first.push(late)` shows that the enqueue throws (the stream is already cancelled), so `late` never reaches the pump. The branch in `webcam-relay.ts:91-94`, which closes and drops a frame delivered after the cut (`current !== reader`), is never run. `late.close` is never asserted either, although the comment says the frame is 'dropped (and closed)'. A regression that relayed a late frame, or leaked it by not closing it, would still pass. To cover the branch, make the fake processor's stream ignore cancellation (a reader whose `read()` resolves with a frame after the cut), then assert `late.close` was called and `written` has no 'a2'.

<!-- wachi:finding -->

