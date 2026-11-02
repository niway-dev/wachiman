## apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:943 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Off→on→off→on quickly closes the camera-off gap before the camera is back (confidence medium)**

The off branch (`turnWebcamOff`, line 928) runs immediately, but the on branch is queued (line 939). Sequence: on (queued, opening), off (bumps `cameraRequest` in the engine, `webcamOn=false`), on again (`webcamOn=true`, queued behind the first). The first `turnWebcamOn` finishes with `request !== cameraRequest` and returns "ok" without a camera feeding the relay (recorder-engine.ts:810). Because `webcamOn` is true again, line 943 calls `gaps.close(takeTimeMs())`. The gap ends while the second open has not started, so the editor shows the held last frame as live for up to the open time. Close the gap only when the engine confirms its camera is feeding, e.g. have `turnWebcamOn` distinguish "superseded" from "fed". The comment on line 938 is also wrong: the off is not on the queue (line 928 calls the engine directly). It is the engine's `cameraRequest` counter that makes a late camera release itself.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:709 by github-actions[bot]

👮 **Wachiman** · 🟡❓ **Consider · question: Third constructor argument of MediaStreamVideoTrackSource: is it part of mediabunny's API? (confidence low)**

`new MediaStreamVideoTrackSource(track, encodingConfig, { frameRate })` passes a third argument, and the test asserts `args[2]` is `{ frameRate: 30 }` (recorder-engine.test.tsx:1683). `mediabunny` is not installed in this checkout, so I could not check the 1.61.x signature. The tests mock the class, so they cannot show the argument is honoured. If mediabunny ignores it (or `tsc` rejects it), the relay track reports no frame rate and the file no longer repeats the last frame through a camera-off gap, which is the mechanism the comment on lines 706-708 relies on. Can you point to the mediabunny option or doc that reads this argument?

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:438 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: New `releaseWebcam` declaration splits `releaseAll` from its doc comment (confidence high)**

The existing JSDoc "Frees everything acquired, for a start that failed or a prepared take released…" (lines 434-437) now sits above the new `/** Releases the webcam relay… */ let releaseWebcam` declaration, so it documents `releaseWebcam` while `releaseAll` (line 440) has none. Move the `releaseWebcam` declaration and its comment above the `releaseAll` comment.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:2065 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: Test title claims the hub reset path is covered, but only abort is exercised (confidence high)**

"a bubble parked when the take is aborted or the hub reset is destroyed too" only calls `recordingAbort`. The reset path at recording-hub.ts:1022 (`releaseParkedBubble()` after `bubbleProtection.reset()`) has no test. Add one or drop "or the hub reset" from the title.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.test.ts:79 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: The test never reaches the relay's late-frame drop branch it describes (confidence medium)**

The comment at line 79 says a frame the old camera still delivers "is dropped (and closed), not relayed". `relay.cut()` cancels the reader, which closes the fake stream. The following `first.push(late)` then throws, and the `try/catch` swallows that, so `late` never reaches `webcam-relay.ts:91-93` (`current !== reader` → `value.close()`). The test also never asserts `late.close`. The final `written` equals `["a1","b1"]` check would pass even if that guard were deleted, because the cancelled stream already blocks the frame. To cover the guard, make the fake camera's read resolve with a frame after `cut()`, for example by holding a pending `read` or using a stream whose `cancel` does not close it. Then assert `late.close` was called and `written` excludes it. Otherwise reword the comment to say the cut only cancels the reader.

<!-- wachi:finding -->

