## review by github-actions[bot] at 2026-11-02T06:07:32Z

👮 **Wachiman** · review of the whole pull request, at `3159fb1`: all 12 files reviewed.

3 finding(s): 1 to fix, 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Summary

**Batch 1 of 2.** Part 1 has two findings on `export-presets.ts`. The rest of this part is consistent with what the PR says it does.

1. **fix:** For fps-capped Small-file rungs, `packetCountsFor` reserves packets for the source's *average* frame rate. That contradicts its own "never below 30 fps" rationale. Screen recordings run at a variable rate, so the reserved moov space can be too small. The muxer then throws and the hook silently re-runs the whole export without fast start: twice the wait, and no fast start.
2. **consider:** The header note on Discord's upload limit (20 MB) contradicts the 25 MB cap it is used to justify.

Checked and found sound:
- **Fit/Fill placement:** the `framingRect` math and its tests.
- **Privacy:** the framer runs after redactions, so the blurred padding and the poster both come from the redacted view.
- **Mono downmix:** sample lifetimes are handled correctly.
- **Retry:** stale messages from the old worker are dropped, and a cancel during the retry is respected.

I could not check mediabunny's actual error text against `PACKET_RESERVE_ERROR`, because its sources aren't installed in the checkout. The hook tests use a message in the expected shape.

**Batch 2 of 2.** Part 2 (tests and docs): I found no defects in either test file. I worked through the expected values in `export-presets.test.ts` against `export-presets.ts`: the 1080p bitrates and the 4.5 Mbps square rate, the Small-file rung choices, `even()` rounding, and the packet-count formulas. The `use-video-export.test.ts` cases match the hook's retry logic: teardown, then a new session, then the stray-message guard. The backlog doc's numbers check out (≈430 KB reservation on a 2-min export, the bitrate rules, the worker raising packet counts). The one finding is a "consider": several statements in the doc describe behaviour from the later PRs in the stack as if it already exists. That covers the remembered preset, the `exportPreset` sidecar field, per-preset title suffixes and the `recordingStat` size check.

<details><summary>What the change connects to (6 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Retry an export with fastStart:false when the worker reports a too-small moov reservation (`apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:210`) — Progress resets to 0 and the export runs again. The saved file has moov at the end. The failure is only reported via captureException. If it fails: If the retried launch rejects (recordingCreate, rasterize), .catch calls fail() and the user sees the generic error. A cancel during the retry window flips activeRef, so launch returns early. The ret… Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:77-81`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:183-193`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:202`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:210-222`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts:367`.
- Reserve moov space with maximumPacketCount from renderer and worker estimates (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:203`) — If the reservation is too small, the user sees a silent full re-export without fast start. If it fails: A variable-rate source whose average is below its active rate under-reserves on capped Small-file rungs (reported as a finding). computePacketStats rejecting falls back to 30 fps. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:209-232`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:203-218`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:290-294`.
- Frame the source-size composed view onto a fixed canvas (Fit/Fill, blurred or black padding) (`apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-output-frame.ts:173`) — The fixed-preset output shows the redacted view letterboxed (Fit) or centre-cropped (Fill). Slides are always Fit. If it fails: If tinyCtx is null, the padding falls back to plain black. A missing view context throws in the worker, which posts an error, and the hook shows the generic error. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-output-frame.ts:59-105`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/compose-output-frame.ts:173-216`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:150-156`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:250-255`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:295-297`.
- Probe hardware encode support with canEncodeVideo before creating CanvasSource (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:161`) — None. The export proceeds, possibly with a software encoder. If it fails: If the probe rejects, .catch(() => false) applies and the software path is used. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:158-171`.
- Hook test: a 'maximum packet count' worker error aborts the session and relaunches once with fastStart:false; a second one fails (`apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts:353`) — Status stays 'exporting' and progress resets to 0. The second worker's 'done' finalizes the second session and calls onSaved once. If it fails: If the relaunch rejects (rasterize, createImageBitmap or recordingCreate), the .catch calls fail(GENERIC_ERROR) while the export is still active. A second packet-count error has runTarget.fastStart f… Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:200-223`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:147-198`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:77-81`, `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts:353-405`.
- Backlog doc claims the worker raises the renderer's packet counts using the real source rate (`apps/documentation/src/content/docs/backlog/export-presets.md:54`) — Documentation only. Evidence: `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:200-217`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 2 | 8 | 768 | 4 | reviewed | 10 | $0.61 |
| Batch 2 of 2 | 4 | 456 | 2 | reviewed | 9 | $0.36 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · 2 batches · $0.97</sub>

<!-- wachi:review -->

<!-- agent-review sha=3159fb1c69e4aad0dc853e4f386818b320fe7ac2 -->

<!-- wachi:attempt id=e2393cda-f542-4f55-a4bd-42de2a218606 -->

