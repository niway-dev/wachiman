## review by github-actions[bot] at 2026-11-02T03:23:44Z

👮 **Wachiman** · review of the whole pull request, at `3ec7a13`: all 23 files reviewed.

3 finding(s): 1 to fix, 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 has one bug to fix and one comment to move. An off-on-off toggle while the live-settings queue is busy, for example while a mic is opening, lets the queued `turnWebcamOn` reopen the camera after the user turned it off again. The camera light comes on and frames are recorded, while the toggle shows off and the editor hides those frames as a gap. The rest checks out against the PR description: parking in the hub, `placedBounds`, gap logging and seeding, and the relay lifecycle.

**Batch 2 of 2.** Part 2 holds the shared gap type and its sanitizer, the tests, and the ADR and spec text. It has one test-strength issue and no defects. The sanitizer keeps `src/shared` free of value imports from workspace packages (its only value import is relative, `./camera-bubble`). Main runs it both on finalize and when it reads a sidecar, and it drops malformed gaps one at a time. Gap times use the same clock as `durationMs`, so the trailing-gap and offset tests assert consistent values. ADR 0032 is still Proposed, and the new decision 6 is appended rather than rewritten, which follows the append-only rule. The spec's revised item 7 matches the engine: off is refused before begin and without a relay. The one finding: the relay test that claims a late frame from a cut camera is dropped and closed never exercises that branch, because cancelling the reader closes the fake stream first. One premise is still unverified: that mediabunny keeps writing the held frame while the relay is empty. It is recorded as an open contract because mediabunny is not installed in the checkout, so I could not read it.

<details><summary>What the change connects to (4 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- The relay holds the last frame while no camera feeds it (the premise of ADR 0032 decision 6) (`apps/kaipu-record/src/renderer/src/features/recording/webcam-relay.ts:9-12`) — Does mediabunny's MediaStreamVideoTrackSource with a frameRate option repeat the last frame when the track sends no frames, or does it keep the gap in timestamps (which would also keep sync)? mediabunny is not installed in the checkout, so I could not check. Files that would answer it: `node_modules/mediabunny/dist/modules/src/media-source.d.ts`.

**Closed, with the lines they rest on**
- Camera toggled off mid-take with a live webcam file parks the bubble instead of destroying it (`apps/kaipu-record/src/main/recording/recording-hub.ts:309`) — The bubble disappears, and the light goes off once both the preview and the recorder release the camera. Turning the camera on shows the same window again (camera-bubble-window.ts:81-86). If it fails: If the bubble renderer misses the broadcast, `useCameraOn` keeps its last value and the hidden window holds the camera until the take ends. If `getRecordingSettings` rejects, it is swallowed and the… Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:299-335`, `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:262-271`, `apps/kaipu-record/src/renderer/src/features/camera-bubble/camera-bubble.tsx:44-61`.
- The recorder releases and reopens the camera mid-take and feeds the same file through a relay (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:768`) — The webcam file goes on, and each gap is recorded and seeded as a hidden segment (recorder-store.ts:1017, webcam-model.ts:135-158). If it fails: A failed reopen ends the file and sets webcamUnavailable, which shows the post-take notice (recorder-store.ts:946-951, 1018). An off queued behind a busy queue can be overtaken by a stale on, which l… Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:769-819`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:860-953`.
- Renderer-supplied `webcam.gaps` are sanitized before they land on the sidecar (`apps/kaipu-record/src/shared/webcam-track.ts:184`) — The editor seeds each gap as a hidden webcam segment (webcam-model.ts:106-111), so the lane shows it striped and exports leave the face out there. If it fails: Bad input drops a single gap, never the whole meta. With no usable gap the `gaps` key is left out, and the file reads like an old sidecar. Evidence: `apps/kaipu-record/src/shared/webcam-track.ts:131-154`, `apps/kaipu-record/src/shared/webcam-track.ts:184-185`, `apps/kaipu-record/src/main/recording/recording-writer.ts:291`, `apps/kaipu-record/src/main/library/webcam-track-state.ts:21`, `apps/kaipu-record/src/renderer/src/features/video-editor/webcam/webcam-model.ts:106-111`.
- Gap end times use the same clock as durationMs, and a trailing gap closes at the take's end (`apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1017`) — The sidecar gaps line up with the screen timeline, which the editor's segments use in source seconds. If it fails: If the camera cannot be opened again, the gap closes at the failure and the user sees the webcamUnavailable toast after the save (recorder-store.ts:946-951, :1069-1070). Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:806-809`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1015-1018`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:939-952`, `apps/kaipu-record/src/renderer/src/features/recording/webcam-gaps.ts:27-30`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 14 | 851 | 5 | reviewed | 6 | $0.46 |
| Batch 2 of 2 | 9 | 606 | 4 | reviewed | 14 | $0.53 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.98</sub>

<!-- wachi:review -->

<!-- agent-review sha=3ec7a138c3a878b38284fd13c801ab7226a34abb -->

<!-- wachi:attempt id=fde6ccd4-1b93-4d57-b331-79c30728ddf7 -->

