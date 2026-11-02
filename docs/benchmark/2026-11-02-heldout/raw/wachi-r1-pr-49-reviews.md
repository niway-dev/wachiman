## review by github-actions[bot] at 2026-11-02T05:57:34Z

👮 **Wachiman** · review of the whole pull request, at `3159fb1`: all 12 files reviewed.

4 finding(s): 1 to fix, 3 to consider; 4 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 has no blockers. One question at fix severity and two consider-level findings.

1. **Fallback regex (question).** Original is the only preset the editor can reach today, and every export, Original included, now uses `fastStart: 'reserve'`. If the reservation overflows, the only recovery is a retry that runs when the worker's error text matches `/maximum packet count/i`. I could not check that string against mediabunny because there is no node_modules in the checkout. If it doesn't match, an export that used to succeed now fails.
2. **No size check for Small file (consider).** The backlog doc says the hook checks the finished file size and re-encodes when it goes over the cap. That check doesn't exist: no `recordingStat` anywhere in `apps/kaipu-record/src`. So a "10 MB" export can come out larger with no warning. No UI exposes Small file yet, so nobody hits this today.
3. **Packet-count comment (consider).** `packetCountsFor` says it never assumes less than 30 fps, but when a frame-rate cap is set (Small file below 1080p) it can. The likely cost is a second full encode through the fallback.

The rest matches what the PR describes: the `framingRect` math and its tests, the framer, the mono downmix, the frame-rate cap, and the retry's session and worker teardown.

**Batch 2 of 2.** Part 2 is tests and docs. What the tests assert matches export-presets.ts and the launch/retry logic in use-video-export.ts: even rounding, bitrate scaling, the Small-file ladder, packet counts, target pass-through, and the single retry without fast start. The only finding is a documentation one: the backlog page describes behaviour from PRs 2 and 3 (title suffixes, the exportPreset sidecar field, the remembered preset and the recordingStat size check) as if it already ships.

<details><summary>What the change connects to (5 closed, 1 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Open: the reviewer could not close these**
- Original export switches from fastStart:false to fastStart:'reserve' with maximumPacketCount per track (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:146`) — What exact message does mediabunny throw when a track exceeds maximumPacketCount, and is it thrown during add() or at finalize()? Files that would answer it: `node_modules/mediabunny/dist/modules/src/isobmff/isobmff-muxer.js`.

**Closed, with the lines they rest on**
- FR9 retry: relaunch worker into a new writer session after reserve overflow (`apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:210`) — The progress bar drops back to 0 and the export runs again; the user gets a file without fast start. If it fails: If launch rejects (recordingCreate, rasterize), it calls fail(GENERIC_ERROR) while still active, so the error dialog shows. A cancel during the relaunch returns early at line 183 or 189. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:147-198`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:200-223`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:77-81`.
- Fixed-canvas presets compose a source-size view then frame it onto the output with createFramer (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:296`) — The output is 1920×1080, 1080×1920 or 1080×1080, with black or blurred padding (Fit) or a centred crop (Fill). Slides are always Fit. If it fails: If either 2D context is missing, the worker throws, the error message reaches the hook, and the user sees the generic error. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:150-156`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-output-frame.ts:59-111`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-output-frame.ts:173-216`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:250-255`.
- Small-file presets: target bitrate inside the cap, mono downmix, fps cap (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:334`) — A file that may exceed the cap is saved with no warning. The preset is not reachable from the UI yet. If it fails: An encoder overshoot is silently kept. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:224-253`, `apps/documentation/src/content/docs/backlog/export-presets.md:59-66`.
- Hook test exercises the FR9 fast-start fallback: a 'maximum packet count' worker error aborts the session and relaunches once with fastStart:false (`apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts:353`) — Status stays 'exporting' and progress resets to 0. The user gets a file without fast start. The second test checks that a packet-count error on the fastStart:false run ends in the error state with no third worker. If it fails: If the relaunch rejects (bitmap or recordingCreate failure), the .catch calls fail(GENERIC_ERROR) while the export is still active, so the error is visible. If the user cancels during the relaunch, a… Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:77-81`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:183-193`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:200-223`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts:353-405`.
- Preset unit tests pin resolveExportTarget's dimensions, framing, bitrates, Small-file ladder and packet counts (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.test.ts:57`) — The worker uses the target's width and height for the output and its fastStart and packet counts for the MP4 muxer. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:186-237`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:250-406`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:119-134`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:212-217`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 8 | 768 | 4 | reviewed | 11 | $0.58 |
| Batch 2 of 2 | 4 | 456 | 2 | reviewed | 8 | $0.33 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.91</sub>

<!-- wachi:review -->

<!-- agent-review sha=3159fb1c69e4aad0dc853e4f386818b320fe7ac2 -->

<!-- wachi:attempt id=3a74af6d-bab1-4851-8db8-80b7942e8b0d -->

