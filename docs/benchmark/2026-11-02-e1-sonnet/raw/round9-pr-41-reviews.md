## review by github-actions[bot] at 2026-11-02T03:45:16Z

👮 **Wachiman** · review of the whole pull request, at `3ec7a13`: all 23 files reviewed.

6 finding(s): 6 to consider; 5 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡📝 **Consider · docs: Sections 2 and 3.2 still say a camera turned off ends the webcam file (confidence high)** (`apps/documentation/src/content/docs/specs/2026-10-30-webcam-track-design.md:329`): The PR rewrote decision 7 so that, with a relay, turning the camera off keeps the file running and records a gap. Two later passages in the same spec still describe the old rule. Line 286 says "after its last frame (turned off) the layer is not drawn". Lines 328-329 list a webcam file ended by "turned off" among the cases that leave the bubble in the screen capture. Under the new behaviour, off in a take with a relay parks the bubble, keeps it protected, and hides the face through a `gaps` segment. Only the no-relay and countdown cases and a failed reopen still end the file and unprotect the bubble. Qualify both passages, or point them at decision 7. `testing/webcam-track-check.md:41` (not in this PR) has the same stale claim: duration-mismatch is "expected when the camera was turned off mid-take (the webcam file ends there)". That is no longer so for takes with a relay.

### Summary

**Batch 1 of 2.** I reviewed this part and found no blockers. The main-process parking logic holds up: after a camera-off, parking and the take-end releases match the hub's rules. There are two actionable findings plus two smaller ones.

- **Open question:** `recorder-engine.ts:709` passes a third `{ frameRate }` argument to `MediaStreamVideoTrackSource`. `mediabunny` is not installed here, so I could not check whether that version accepts it. If it does not, the file will not repeat its last frame through a camera-off gap. The tests mock the class, so they cannot catch this.
- **Minor bug:** in an off, on, off, on sequence, the camera-off gap can close before the camera is feeding the file (`recorder-store.ts:943`). The comment at line 938 also misdescribes how the off is ordered against the pending on.
- **Cleanup and tests:** the new `releaseWebcam` declaration splits `releaseAll` from its doc comment (`recorder-engine.ts:438`). One hub test title claims reset coverage but only exercises abort (`recording-hub.test.ts:2065`).

**Batch 2 of 2.** Part 2 (shared sanitizer, tests, docs) is mostly sound. The gap sanitizer, `WebcamGapLog` and the gap-to-segment seeding match their tests when I trace the code, and main persists only sanitized gaps. There are two findings, both at \"consider\". One test in `webcam-relay.test.ts` claims to cover the late-frame drop but never reaches it. The webcam spec's section 2 and section 3.2 still say a camera turned off ends the file, which contradicts the revised decision 7.

<details><summary>What the change connects to (5 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Encoder source built with a third `{ frameRate }` argument and `sizeChangeBehavior: "contain"` (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:691`) — Does mediabunny ^1.61.4 accept a third constructor argument with `frameRate`, and the `sizeChangeBehavior` option? Files that would answer it: `node_modules/mediabunny (not installed in this checkout)`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.test.tsx`.

**Closed, with the lines they rest on**
- Camera toggled off mid-take parks the bubble window instead of destroying it (`apps/kaipu-record/src/main/recording/recording-hub.ts:309`) — The face is not in the screen capture after the camera is turned on again, because the same protected window is reused. The in-use light goes off because the bubble renderer releases the camera when the toggle is off (camera-bubble.tsx:44-61). If it fails: If the renderer cannot turn the webcam file off, main has already parked the window. The renderer then ends the file and reports it, `protects()` goes false, and turning the camera on destroys the pa… Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:299-335`, `apps/kaipu-record/src/main/recording/recording-hub.ts:844-855`, `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:162-169`, `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:228-239`.
- Renderer turns the webcam off and on mid-take through a relay track and a gap log (`apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924`) — The webcam lane gets hidden segments for each gap through `seedWebcamScene`, and the export leaves the face out there. If it fails: Open failure, no first frame or encoder failure all end the webcam file and release the camera, and the user is told on save. A quick off/on/off/on can close the gap before the camera feeds the file… Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:918-954`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:768-820`, `apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.ts:72-123`, `apps/kaipu-record/src/renderer/src/features/video-editor/webcam/webcam-model.ts:130-158`.
- Renderer sends `webcam.gaps` with recording finalize; main sanitizes and stores it in the sidecar (`apps/kaipu-record/src/shared/webcam-track.ts:184`) — The editor seeds each gap as a hidden webcam segment (`seedWebcamScene`), so the lane stripes the gap and the export hides the held frame. If it fails: Invalid gaps are silently dropped, so the face would show a frozen frame there. That only happens if the renderer sends bad data. Gaps are not clamped to the recording's duration in main; the editor… Evidence: `apps/kaipu-record/src/shared/webcam-track.ts:131-154`, `apps/kaipu-record/src/shared/webcam-track.ts:184-185`, `apps/kaipu-record/src/main/recording/recording-writer.ts:291-301`, `apps/kaipu-record/src/renderer/src/features/video-editor/webcam/webcam-model.ts:106-158`.
- User turns the camera off and on mid-take; the store records a gap and the engine keeps the webcam file running (`apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924`) — The editor shows a hidden segment over each off period. After a failed reopen the file ends, the bubble goes back into the capture, and a toast tells the user after the take. If it fails: A reopen that rejects or times out (3 s) ends the file, and the user is told. If off, on, off, on arrive in quick succession, the first queued `turnWebcamOn` is superseded and returns "ok" without fe… Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924-953`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:769-819`, `apps/kaipu-record/src/renderer/src/features/recording/webcam-gaps.ts:10-31`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.test.ts:1567-1662`.
- Tests: a relay track replaces the camera track as the webcam encoder input (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.test.tsx:1602`) — The tests stub `MediaStreamTrackProcessor` and `MediaStreamTrackGenerator` and check these cases. Prepare builds one webcam source on the relay with `frameRate` and `sizeChangeBehavior: contain`. Off and on keep one Output. Stop releases the reopened camera and the relay. Reopen… If it fails: The tests do not cover pause or resume during a gap, or repeated off/on while a reopen is in flight. Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.test.tsx:1602-1768`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:658-711`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:769-819`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:1102-1145`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 14 | 851 | 5 | reviewed | 22 | $0.38 |
| Batch 2 of 2 | 9 | 606 | 4 | reviewed | 19 | $0.32 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.70</sub>

<!-- wachi:review -->

<!-- agent-review sha=3ec7a138c3a878b38284fd13c801ab7226a34abb -->

<!-- wachi:attempt id=f45aafff-b929-4200-99ef-316f4a953dca -->

