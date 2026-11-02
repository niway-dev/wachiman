## review by github-actions[bot] at 2026-11-02T03:15:29Z

👮 **Wachiman** · review of the whole pull request, at `3ec7a13`: all 23 files reviewed.

4 finding(s): 1 to fix, 3 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** I reviewed all 14 files in part 1 and found one bug worth fixing plus two minor comment/cleanup notes. I could not check that the installed mediabunny accepts the new `sizeChangeBehavior` option or the third `frameRate` argument, because `node_modules` is not in the checkout.\n\nThe bug is in main's `recordingWebcamEnded` handler (`recording-hub.ts:456-460`, flagged at line 304) and loses the face for the rest of the take:\n1. The user turns the camera back on while the webcam file is still running.\n2. Main shows the same parked window, which the screen capture leaves out.\n3. Only then does the renderer try to reopen the camera. If that fails (camera busy, permission denied, or no frame in time), the webcam file ends.\n4. Main then only removes protection from that same excluded window. It never replaces it with a new window, so the face is in neither the webcam file nor the screen recording. The user finds out only after saving.\n\nThe store comment at `recorder-store.ts:946-947` says main puts the bubble back in the capture; nothing does.\n\nThe other two are minor:\n- **Wrong comment:** `recorder-store.ts:938` says a following camera-off waits on the queue. It does not; the off runs immediately, and the engine discards the superseded open instead.\n- **Misplaced doc comment:** in `recorder-engine.ts`, the new `releaseWebcam` declaration was inserted between `releaseAll` and its doc comment, so that comment no longer attaches to `releaseAll`.\n\nThe rest holds up as described:\n- A parked bubble is released at finalize, abort, stop and reset.\n- Finalize reads the bubble's position before the stop message destroys a parked window, because the renderer sends stop after finalize.\n- The early-out on a superseded camera open (`cameraRequest`), the gap log and the gap-segment seeding behave as their comments say.

**Batch 2 of 2.** I found no defects in part 2, only one minor test gap. `sanitizeWebcamGaps` in `webcam-track.ts` handles bad input correctly. It drops bad entries one by one, clamps a start before 0, merges overlaps and caps the list at 1000, and it imports nothing new from workspace packages. The tests' expectations match the engine, store, relay and model code I read. That includes the 1 s stretch in `gapSegments`, the request counter that drops a camera turned off again while it was opening, and the gap still open at the stop being closed at the take's end. The updates to ADR 0032 and the spec describe the code accurately, and the ADR only adds a new item. The one finding is in `webcam-relay.test.ts`. Its \"late frame is dropped\" case would still pass if the relay's `current !== reader` guard were deleted: the cut cancels the stream, so the late push throws before the relay ever reads the frame. The test's comment also says the frame is closed, but nothing checks that.

<details><summary>What the change connects to (5 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Camera toggled off mid-take parks the bubble instead of destroying it (`apps/kaipu-record/src/main/recording/recording-hub.ts:309`) — Bubble disappears and the camera light goes off once the bubble preview (camera-bubble.tsx:143-144) and the engine (turnWebcamOff) stop their tracks. If it fails: If the renderer has no relay, turnWebcamOff returns false and endWebcam reports webcamEnded. On the next on, main sees isParked && !takeRecordsWebcam and replaces the window (line 304). Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:299-335`, `apps/kaipu-record/src/main/recording/recording-hub.ts:844-847`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924-934`, `apps/kaipu-record/src/renderer/src/features/camera-bubble/camera-bubble.tsx:44-61`.
- Camera toggled on mid-take reopens the camera into the same webcam file via the relay (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:779`) — Main reshows the same parked (excluded) window before the renderer knows whether the reopen worked. If it fails: On failure endWebcam → recordingWebcamEnded → main only unprotects the excluded window, so the face is missing from both outputs for the rest of the take (finding). Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:779-819`, `apps/kaipu-record/src/main/recording/recording-hub.ts:456-460`, `apps/kaipu-record/src/main/recording/recording-hub.ts:304-305`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:939-952`.
- Finalize reads placedBounds before releasing a parked bubble (`apps/kaipu-record/src/main/recording/recording-hub.ts:498`) — Editor seeds the bubble layout where it was before the camera was turned off. Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1042`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1068`, `apps/kaipu-record/src/main/recording/recording-hub.ts:844-847`.
- Camera-off periods are sent to main with finalize as `webcam.gaps`, sanitized there, and saved on the sidecar (`apps/kaipu-record/src/shared/webcam-track.ts:184`) — `initialScene` passes the gaps to `seedWebcamScene` with the recording's duration, so each gap becomes a hidden webcam segment. The lane shows it striped and the export leaves the face out there. If it fails: A malformed gap list from the renderer is reduced to the usable gaps, or the key is left out; the meta itself is never rejected because of gaps. A session saved before the webcam existed is re-seeded… Evidence: `apps/kaipu-record/src/shared/webcam-track.ts:131-154`, `apps/kaipu-record/src/shared/webcam-track.ts:184-185`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:928-952`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1017`, `apps/kaipu-record/src/renderer/src/features/recording/webcam-gaps.ts:10-31`, `apps/kaipu-record/src/renderer/src/features/video-editor/scene.ts:140`, `apps/kaipu-record/src/renderer/src/features/video-editor/scene.ts:151-154`, `apps/kaipu-record/src/renderer/src/features/video-editor/webcam/webcam-model.ts:135-158`.
- Turning the camera off or on mid-take, as the engine tests describe it (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.test.tsx:1693`) — The webcam file keeps running through the gap and the camera's in-use light goes off. If the camera cannot be opened again, the file ends and `onWebcamEnded` fires. If it fails: If the camera fails to open, or sends no frame within `WEBCAM_OPEN_TIMEOUT_MS`, `endWebcam` runs and the call returns "unavailable". The store then closes the gap and shows the webcamUnavailable toas… Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:741-760`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:769-819`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:939-952`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 14 | 851 | 5 | reviewed | 11 | $0.55 |
| Batch 2 of 2 | 9 | 606 | 4 | reviewed | 10 | $0.44 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.99</sub>

<!-- wachi:review -->

<!-- agent-review sha=3ec7a138c3a878b38284fd13c801ab7226a34abb -->

<!-- wachi:attempt id=156dc0ed-cd7b-492d-991c-77d0a5211f2b -->

