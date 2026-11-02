## review by github-actions[bot] at 2026-11-02T03:24:57Z

👮 **Wachiman** · review of the whole pull request, at `3ec7a13`: all 23 files reviewed.

4 finding(s): 2 to fix, 2 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** I reviewed part 1 and found one bug to fix before merging (not a blocker) and two smaller suggestions.

**Bug to fix — the camera can stay on after the user turns it off.** In `recorder-store.ts`, turning the camera off runs `turnWebcamOff` right away, but turning it on waits in a queue. If an off arrives before a queued on has started, the on runs anyway and opens the camera again. The queue can be busy because of a mic toggle, a noise-suppression change, or an earlier camera-on during quick clicks. The bubble stays hidden and the toggle says off, but the camera light is on and the face is recorded into the webcam file until the next on or the end of the take. The editor hides that footage, but the file still contains it. Simple fix: in the queued step, skip the call when the toggle has already flipped back to off (`if (!webcamOn) return;`).

**Suggestions:**
- **Gap can close early.** When one camera-on is superseded by a newer one, the gap is closed before the newer camera's first frame arrives. The frozen frame can then show in the editor for up to the open timeout.
- **Test name overstates coverage.** In `recording-hub.test.ts`, the test named "aborted or the hub reset" only covers abort. The release of a hidden bubble on a forced reset or on stop has no test.

**What checks out:** the main-process side holds together:
- turning the camera off mid-take hides and keeps the bubble window instead of destroying it;
- if the webcam file ended while the bubble was hidden, turning the camera on creates a new window;
- the hidden window is released at finalize, abort, stop and reset;
- it remembers where the bubble sat for a take that ends with the camera off.

The bubble's preview follows the Camera toggle correctly, the frame relay closes its readers cleanly, and the editor's handling of short gaps and gaps near the end looks right.

**Not verified:** `node_modules` is not checked out, so I could not confirm that the installed mediabunny accepts the new `frameRate` argument and the `sizeChangeBehavior: "contain"` option.

**Batch 2 of 2.** I reviewed all 9 files in part 2 and found one problem. If the camera goes off → on → off → on while the first reopen is still pending, the store closes the camera-off gap too early (recorder-store.ts:943, a part-1 file). The editor then shows the frozen held frame until the second camera's first frame arrives. The store tests don't cover this sequence, so I filed it as a "fix" on recorder-store.test.ts:1646. The gap sanitizer, the gap log, the relay tests, the editor seeding tests and both doc updates match the code. I also checked the countdown fallback against the engine: off is refused before the take begins, so the file ends as before.

<details><summary>What the change connects to (5 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Encoder reads the relay track with an explicit frameRate and sizeChangeBehavior (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:691`) — Does the installed mediabunny version accept a third constructor argument with frameRate, and the sizeChangeBehavior: 'contain' option? node_modules is not checked out, so I could not check. Files that would answer it: `node_modules/mediabunny/dist/mediabunny.d.ts`.

**Closed, with the lines they rest on**
- Camera toggled off mid-take parks the bubble instead of destroying it (`apps/kaipu-record/src/main/recording/recording-hub.ts:309`) — The bubble disappears and the preview camera stops. The recorder's camera stops through turnWebcamOff (recorder-engine.ts:769-778). If it fails: If the renderer ends the webcam file instead (no relay, or the take has not begun), main gets recordingWebcamEnded (recording-hub.ts:456-460). On the next on, the parked window is replaced (recording… Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:299-335`, `apps/kaipu-record/src/main/recording/recording-hub.ts:456-460`, `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:262-271`, `apps/kaipu-record/src/renderer/src/features/camera-bubble/camera-bubble.tsx:44-61`.
- Recorder reopens the camera and feeds the same webcam file through the relay (`apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:779`) — The camera light comes back on and the gap closes in the sidecar (recorder-store.ts:943). If it fails: If the open fails or times out, the webcam file ends. The store sets webcamReopenFailed, which shows the "camera wasn't available" notice after the take (recorder-store.ts:948-951, 1018). Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:763-820`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:918-953`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:1015-1018`.
- Renderer-supplied webcam.gaps sanitized in main before landing on the sidecar (`apps/kaipu-record/src/shared/webcam-track.ts:131`) — Gaps seed hidden webcam segments in the editor (webcam-model.ts:111, 135-158). If it fails: Bad input drops only the bad gap and never rejects the whole meta. End times are not bounded by the duration here; the editor clamps them only when durationSeconds is passed. Evidence: `apps/kaipu-record/src/shared/webcam-track.ts:131-154`, `apps/kaipu-record/src/shared/webcam-track.ts:184-185`, `apps/kaipu-record/src/renderer/src/features/video-editor/webcam/webcam-model.ts:135-158`.
- Store closes a camera-off gap when turnWebcamOn resolves (`apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:939-953`) — The hidden segment ends early, and the editor shows the held (frozen) frame. If it fails: Silent: a frozen face shows in the editor and export after rapid toggling. Evidence: `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts:924-953`, `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts:769-819`.
- Editor seeds gaps as hidden segments (`apps/kaipu-record/src/renderer/src/features/video-editor/webcam/webcam-model.ts:106-158`) — The lane shows the gap striped and the export hides the face there. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/scene.ts:140`, `apps/kaipu-record/src/renderer/src/features/video-editor/scene.ts:153`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 14 | 851 | 5 | reviewed | 9 | $0.61 |
| Batch 2 of 2 | 9 | 606 | 4 | reviewed | 11 | $0.42 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $1.02</sub>

<!-- wachi:review -->

<!-- agent-review sha=3ec7a138c3a878b38284fd13c801ab7226a34abb -->

<!-- wachi:attempt id=59fc0523-3215-4482-864e-20f9fc8f3200 -->

