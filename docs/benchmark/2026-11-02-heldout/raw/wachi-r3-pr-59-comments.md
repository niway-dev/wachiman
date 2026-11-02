## apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:223 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Capped-fps packet count trusts the source's average rate, which the docstring says never to do (confidence high)**

The docstring at lines 209-213 says the video rate "never assumes less than 30 fps — a variable-rate screen recording can burst above its average". The `maxFps !== null` branch does the opposite: it uses `Math.min(opts.maxFps, Math.max(1, opts.fps))`. A screen recording that is mostly static can average 5–10 fps, so the reservation is sized for 10 fps. But the fps cap in the worker (`export-worker.ts:293-294`) only limits the output to 30 fps, and bursts of motion can reach that rate.

Once `start()` gets real `sourceInfo`, this undercounts in both places. In the renderer, `use-video-export.ts:125` passes `sourceInfo.fps`. In the worker, `export-worker.ts:206` uses `averagePacketRate`. The `Math.max` at `export-worker.ts:212` doesn't help, because both inputs come from the same low average. When the reservation runs out, mediabunny throws mid-export and the hook redoes the whole encode without fast start. The user waits through two exports and still gets a file without fast start.

The Small-file byte budget subtracts `reserveBytes(packetCounts)` (line 366), so it is undercounted the same way.

Fix: when a cap is set, use the cap itself as the rate (`fps = opts.maxFps`). That is the true upper bound on frames per second and matches the docstring.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/export-presets.md:33 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Doc describes later stacked PRs' behaviour as if this code already does it (confidence high)**

Once this PR merges, the doc describes several things in the present tense that the code doesn't do yet:
- Line 32: the remembered preset and framing.
- Lines 33–35: `exportPreset` in the sidecar and preset-specific title suffixes. The hook still calls `recordingFinalize` with only `t("editedTitle")` and `derivedFromAssetId` (`use-video-export.ts:234-240`), and there is no `exportPreset` anywhere in `apps/kaipu-record/src`.
- Lines 61–66: the sheet's warning and "Export anyway".
- Lines 63–66: "After the worker is done, the hook stats the temp file (`recordingStat` IPC)… re-encodes once". There is no `recordingStat` IPC, and the `done` handler finalizes straight away.
- Line 14: the banner says component tests pass, but this slice has no component.

The banner does list the three PRs, but nothing says which behaviour belongs to which one. A reader on main would trust the size check and the title suffixes. Suggestion: tag those bullets and paragraphs with the PR that delivers them (UI / small-file), or add them when that PR lands.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts:353 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: FR9 retry test doesn't exercise the rebuilt bitmaps or a cancel during the relaunch (confidence high)**

The reason `launch()` was refactored is that overlay and slide bitmaps are transferred to the worker, so a retry has to rebuild them (`use-video-export.ts:145-146`, `154-181`). This test uses `CLIP_SCENE`, which has no overlays and no slides, so a regression that reused the detached bitmaps would still pass.

The window between `teardown(sessionId)` and the second `recordingCreate`, where `cancel()` must win (`use-video-export.ts:183`, `189-193`), is also untested. The retry is fire-and-forget (`void launch(...)`), so a cancel during it is the case most likely to leak a writer session.

Suggestion: add an overlay to the scene and assert that the second `postMessage` transfers new bitmaps, plus a test that cancels after the packet-count error and checks that no second worker is created and nothing is left un-aborted.

<!-- wachi:finding -->

