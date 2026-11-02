## review by github-actions[bot] at 2026-11-02T03:45:17Z

👮 **Wachiman** · review of the whole pull request, at `3ec7a13`: all 23 files reviewed.

5 finding(s): 1 to fix, 4 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### Outside the diff

- 🟡📝 **Consider · docs: Spec sections 2 and 3.2 still describe the old camera-off rule that item 7 now replaces (confidence high)** (`apps/documentation/src/content/docs/specs/2026-10-30-webcam-track-design.md:329`): Item 7 (lines 86-99) says a camera turned off mid-take parks the bubble and keeps the file running. Two passages elsewhere in the spec still state the old behaviour. Line 329 says a take whose webcam file ended "(turned off, unplugged, encoder failure)" leaves the bubble in the screen capture. Lines 285-286 say the editor does not draw the layer "after its last frame (turned off)". Under the new rule, turning the camera off no longer ends the file, and the editor hides the face through `webcam.gaps`. Only a failed reopen, unplug, encoder failure, a camera-off countdown or a missing relay still ends the file. `apps/documentation/src/content/docs/testing/webcam-track-check.md:41` has the same problem. It says `duration-mismatch` is expected when the camera was turned off mid-take because "the webcam file ends there". It now fires only when the file really ended. Reword these passages or point them at item 7 so a reader of the editor time-mapping and protection sections is not misled.

### Summary

**Batch 1 of 2.** I found one behavior bug and two minor issues in this part; I couldn't check the engine's use of mediabunny. The main bug is in `recorder-store.ts`: if the user turns the camera off, on, then off again while the on-request is still waiting behind another queued step, the engine opens the camera anyway. The recorder then holds the camera with the toggle off, and nothing tells the user. The other two are small: a doc comment in `recorder-engine.ts` is now attached to the wrong declaration, and a hub test is named for a reset case it doesn't run. I read all 14 files in this part, but could not check the mediabunny constructor arguments and hold-last-frame behavior because `node_modules` is missing; the contracts list this as open.

**Batch 2 of 2.** Part 2 holds the gap type and sanitizer in the shared file, the tests for the gap log, relay, engine, store and editor seeding, and the ADR 0032 and spec edits. I found no defects in the shared sanitizer or its tests. It imports only a relative module, and both the write and read paths sanitize `gaps`. I checked the store, engine, gap-log and `seedWebcamScene` tests against the code, including the 1-second minimum segment length, and their expectations are consistent with it. Two low-severity findings remain. The spec's section 2 and 3.2 (and `testing/webcam-track-check.md`) still describe the old rule that turning the camera off ends the file. One relay test never reaches the late-frame drop path its comment describes.

<details><summary>What the change connects to (6 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Engine relays the camera through a MediaStreamTrackGenerator so the webcam file survives camera-off (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:652-720`) — Does the installed mediabunny `MediaStreamVideoTrackSource` accept a third constructor argument `{ frameRate }` and the `sizeChangeBehavior: "contain"` option, and does it repeat the last frame while the generator track is empty? Files that would answer it: `node_modules/mediabunny (type declarations)`, `apps/kaipu-record/package.json`.

**Closed, with the lines they rest on**
- Camera turned off mid-take parks the bubble window instead of destroying it; turning it on shows the same window (`apps/kaipu-record/src/main/recording/recording-hub.ts:299-322`) — Bubble disappears on off and reappears on on. The recorded screen does not gain a new capturable window. The camera light is released by the bubble renderer, which now follows `isCameraEnabled` (`camera-bubble.tsx` `useCameraOn`). If it fails: If the take's webcam file has not started in the renderer when the hub parks (hub active before the engine's webcam output starts), the renderer ends the file. The webcam-ended IPC then unprotects th… Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:299-335`, `apps/kaipu-record/src/main/recording/recording-hub.ts:456-460`, `apps/kaipu-record/src/main/recording/recording-hub.ts:487-500`, `apps/kaipu-record/src/main/recording/recording-hub.ts:550-558`, `apps/kaipu-record/src/main/recording/recording-hub.ts:844-847`, `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:262-271`, `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:128-132`.
- Renderer forwarder turns the webcam off/on through the engine instead of ending the file (`apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:918-954`) — The editor shows hidden segments for the camera-off periods. A toast appears once the take is saved if the camera could not be reopened. If it fails: A turn-on still waiting in the queue is not cancelled by a following off. When it runs it opens the camera while the toggle is off, and nothing signals this (finding at line 939). A turn-on still in… Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924-953`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1016-1018`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:769-819`.
- Bubble preview renderer follows the Camera toggle (`apps/kaipu-record/src/renderer/src/features/camera-bubble/camera-bubble.tsx:44-61`) — Camera light goes off while the bubble is parked and comes back when it is shown again. If it fails: If the settings read rejects and no broadcast arrives, the preview stays on (the old behavior). The unsubscribe is returned from the effect. Evidence: `apps/kaipu-record/src/renderer/src/features/camera-bubble/camera-bubble.tsx:44-61`, `apps/kaipu-record/src/renderer/src/features/camera-bubble/camera-bubble.tsx:143-144`, `apps/kaipu-record/src/main/recording/recording-hub.ts:285-292`.
- Renderer sends `webcam.gaps` with finalize; main sanitizes it before it lands in the sidecar and again when the sidecar is read (`apps/kaipu-record/src/shared/webcam-track.ts:131`) — Hidden webcam segments appear in the editor lane where the camera was off. Garbage or hostile gaps cannot reach disk or the editor. If it fails: Both consumers go through the sanitizer: the write side at recording-writer.ts:291 and the sidecar read at webcam-track-state.ts:21. Bad input degrades to no gaps, so the face stays visible through a… Evidence: `apps/kaipu-record/src/shared/webcam-track.ts:131-154`, `apps/kaipu-record/src/shared/webcam-track.ts:184-185`, `apps/kaipu-record/src/main/recording/recording-writer.ts:291`, `apps/kaipu-record/src/main/library/webcam-track-state.ts:21`, `apps/kaipu-record/src/shared/webcam-track.ts:9-13`.
- Camera off and on mid-take drives the store's live forwarder: off parks the file, on reopens it, and each off period becomes a gap (`apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924`) — The editor stripes each gap, and a take whose camera could not reopen shows the `webcamUnavailable` toast. If it fails: A reopen that rejects or times out is bounded by `WEBCAM_OPEN_TIMEOUT_MS` in the engine and reported as "unavailable". The file ends, the gap closes, and the user is told after the take, so the failu… Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924-953`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1017-1018`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1069-1070`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:769-819`.
- The webcam encoder reads a relay track (MediaStreamTrackGenerator) fed by the current camera, instead of the camera track (`apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.ts:48`) — The webcam file keeps running through a camera-off period, holding its last frame. If it fails: If the Generator or Processor constructor throws, or either is missing, `createWebcamRelay` returns null and the take falls back to the old rule. `feed` resolves false when the camera ends or is cut… Evidence: `apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.ts:48-61`, `apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.ts:74-113`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:658-665`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:691-710`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:803-817`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 14 | 851 | 5 | reviewed | 19 | $0.47 |
| Batch 2 of 2 | 9 | 606 | 4 | reviewed | 20 | $0.34 |

</details>

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.81</sub>

<!-- wachi:review -->

<!-- agent-review sha=3ec7a138c3a878b38284fd13c801ab7226a34abb -->

<!-- wachi:attempt id=609cc93b-2fa6-4f79-a5dd-634b749683fb -->

