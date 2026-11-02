# Blind findings for kaipu-record #269

Every finding below was posted by one of several automated reviewers on the same diff. Reviewer names and labels are removed. Judge each on its merits.


## F01 — `apps/documentation/src/content/docs/backlog/export-presets.md:32`

**Doc describes later-PR behaviour in the present tense **

Several sentences describe as current behaviour things that are not in the repository at this commit:
- Line 32: the last preset is remembered app-wide.
- Lines 33–35: an `exportPreset` sidecar field and per-preset title suffixes. `use-video-export.ts:235` still uses `t("editedTitle")` for every preset, and `exportPreset` appears nowhere under `apps/kaipu-record/src`.
- Lines 62–66: the sheet warning, "Export anyway", and the `recordingStat` post-export check and re-encode. There is no `recordingStat` in `src/shared/types/ipc.ts`.

The status banner says the work spans three PRs, but nothing in the body says which part has shipped. Someone validating on the Mac mini could test for behaviour that doesn't exist yet. Consider tagging these items with the PR that delivers them (e.g. "(PR 2)" / "(PR 3)"), or moving them to a "Planned" subsection until those PRs land.


## F02 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:223`

**Capped-fps packet count trusts the source's average rate, which the docstring says never to do **

The docstring at lines 209-213 says the video rate "never assumes less than 30 fps — a variable-rate screen recording can burst above its average". The `maxFps !== null` branch does the opposite: it uses `Math.min(opts.maxFps, Math.max(1, opts.fps))`. A screen recording that is mostly static can average 5–10 fps, so the reservation is sized for 10 fps. But the fps cap in the worker (`export-worker.ts:293-294`) only limits the output to 30 fps, and bursts of motion can reach that rate.

Once `start()` gets real `sourceInfo`, this undercounts in both places. In the renderer, `use-video-export.ts:125` passes `sourceInfo.fps`. In the worker, `export-worker.ts:206` uses `averagePacketRate`. The `Math.max` at `export-worker.ts:212` doesn't help, because both inputs come from the same low average. When the reservation runs out, mediabunny throws mid-export and the hook redoes the whole encode without fast start. The user waits through two exports and still gets a file without fast start.

The Small-file byte budget subtracts `reserveBytes(packetCounts)` (line 366), so it is undercounted the same way.

Fix: when a cap is set, use the cap itself as the rate (`fps = opts.maxFps`). That is the true upper bound on frames per second and matches the docstring.


## F03 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:224`

**Small file never checks the finished size against the cap **

The hook takes `presetId: "small-10" | "small-25"` and `resolveExportTarget` sets a target bitrate inside `cap × 0.92`. But the `done` branch finalizes straight away. Nothing stats the written file or re-encodes it when the encoder overshoots. The backlog doc (`backlog/export-presets.md` lines 63-66) says the hook calls a `recordingStat` IPC, re-encodes once at `V × 0.8 × cap / actual`, and shows a toast on a second overshoot. No `recordingStat` exists anywhere in `apps/kaipu-record/src`. VBR overshoot from hardware encoders (VideoToolbox) is the case the doc lists as still to be measured. With this code, a "10 MB" export can come out at 11 MB with no warning, and GitHub will then reject the upload. No UI passes `presetId` yet (only the hook and its test reference it), so nobody hits this today. Either add the stat/retry before the Small-file presets are exposed, or remove that paragraph from the doc.


## F04 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.test.ts:353`

**FR9 retry test doesn't exercise the rebuilt bitmaps or a cancel during the relaunch **

The reason `launch()` was refactored is that overlay and slide bitmaps are transferred to the worker, so a retry has to rebuild them (`use-video-export.ts:145-146`, `154-181`). This test uses `CLIP_SCENE`, which has no overlays and no slides, so a regression that reused the detached bitmaps would still pass.

The window between `teardown(sessionId)` and the second `recordingCreate`, where `cancel()` must win (`use-video-export.ts:183`, `189-193`), is also untested. The retry is fire-and-forget (`void launch(...)`), so a cancel during it is the case most likely to leak a writer session.

Suggestion: add an overlay to the scene and assert that the second `postMessage` transfers new bitmaps, plus a test that cancels after the packet-count error and checks that no second worker is created and nothing is left un-aborted.


## F05 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:13`

**Discord source note contradicts the 25 MB cap **

The header gives Discord's no-Nitro limit as 20 MB, then calls the 25 MB cap "chat with margin". A 25 MB file has no margin under a 20 MB limit; it would be rejected. Either the limit quoted here is wrong or the 25 MB rung isn't meant for Discord. Please correct the figure or say which destination the 25 MB preset targets, so the "one-line change" table stays trustworthy.


## F06 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:223`

**Capped packet count trusts the average rate, so variable-rate sources under-reserve the moov box **

The docstring at lines 209-213 says the video rate "never assumes less than 30 fps — a variable-rate screen recording can burst above its average". The `maxFps !== null` branch does the opposite: `Math.min(opts.maxFps, Math.max(1, opts.fps))`. It reserves for the source's *average* rate, which can be far below 30 for a mostly static screen recording. In the worker (`export-worker.ts:203-211`), that average comes from only the first 240 packets (`computePacketStats(240)`). The renderer passes 30 when `sourceInfo` is omitted, but the worker raises the count with `Math.max`, never lowers it.

Example: a Small-file export below 1080p (maxFps 30) from a source that averages about 10 fps but has long active stretches near 30 fps can emit up to 30 frames/s after the cap. That outruns `d × 10 × 1.33` packets, the muxer throws, and `use-video-export.ts:210-221` silently re-runs the whole export with `fastStart: false`. The user waits twice as long and gets a file without fast start, which is the main point of this PR, with no visible signal.

Suggested fix: when capped, reserve for the cap itself. Use `opts.maxFps` (or `Math.min(opts.maxFps, Math.max(30, Math.ceil(opts.fps)))`) so the bound matches the frames the fps-cap loop at `export-worker.ts:293-294` can actually emit.


## F07 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:223`

**Capped branch can assume < 30 fps, contrary to the docblock **

The docblock says "The video rate never assumes less than 30 fps — a variable-rate screen recording can burst above its average". When `maxFps` is set (Small file below 1080p), the code uses `Math.min(opts.maxFps, Math.max(1, opts.fps))`. A mostly static recording averaging, say, 8 fps therefore reserves for 8 fps, even though bursts up to the 30 fps cap get through. The worker only raises the count using `computePacketStats(240)`, i.e. the first 240 packets (export-worker.ts:203-206). An edit that keeps the high-motion parts can overflow the reserve, which costs a full second encode through the fallback. `Math.min(opts.maxFps, Math.max(30, Math.ceil(opts.fps)))`, or simply `opts.maxFps`, matches the comment.


## F08 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:49`

**Does mediabunny's overflow error actually match /maximum packet count/i? **

Every export now uses `fastStart: "reserve"`, including Original, the only preset the editor reaches today. That makes the FR9 fallback (lines 210-222) the only thing between a variable-rate burst that overflows `maximumPacketCount` and a failed export. Before this change the same export succeeded with `fastStart: false`. The fallback runs only when the worker's error text matches `/maximum packet count/i`. I could not check that string against the installed mediabunny version (there is no node_modules in the checkout), and the hook test mocks the message. If mediabunny words it differently (for example "packet count exceeded"), an overflow falls through to `fail(GENERIC_ERROR)` and an export that used to work now fails. Did you check the regex against mediabunny's actual throw site, and could a test pin it to the library's message?


## F09 — `apps/documentation/src/content/docs/backlog/export-presets.md:33`

**Doc describes later stacked PRs' behaviour as if this code already does it **

Once this PR merges, the doc describes several things in the present tense that the code doesn't do yet:
- Line 32: the remembered preset and framing.
- Lines 33–35: `exportPreset` in the sidecar and preset-specific title suffixes. The hook still calls `recordingFinalize` with only `t("editedTitle")` and `derivedFromAssetId` (`use-video-export.ts:234-240`), and there is no `exportPreset` anywhere in `apps/kaipu-record/src`.
- Lines 61–66: the sheet's warning and "Export anyway".
- Lines 63–66: "After the worker is done, the hook stats the temp file (`recordingStat` IPC)… re-encodes once". There is no `recordingStat` IPC, and the `done` handler finalizes straight away.
- Line 14: the banner says component tests pass, but this slice has no component.

The banner does list the three PRs, but nothing says which behaviour belongs to which one. A reader on main would trust the size check and the title suffixes. Suggestion: tag those bullets and paragraphs with the PR that delivers them (UI / small-file), or add them when that PR lands.


## F10 — `apps/documentation/src/content/docs/backlog/export-presets.md:32`

**Doc describes later-PR behaviour as if it already ships **

"What the user gets" and "How it works" describe these in the present tense: the remembered preset/framing (line 32), `exportPreset` in the sidecar and per-preset title suffixes (lines 33–35), and the post-export `recordingStat` size check and retry (lines 63–66). None of them exist at this head. `use-video-export.ts:234-240` always finalizes with `t("editedTitle")` and sends no `exportPreset`, and the repository has no `recordingStat` or `exportPreset` symbol. The 🟡 banner names the three stacked PRs, but the body never says which items each one delivers. If PRs 2 and 3 slip, anyone validating this slice on the Mac mini will look for behaviour that isn't there. Consider tagging each item with its PR (picker / small-file check), or moving the not-yet-built items under a "Coming in the next PRs" heading.


## F11 — `apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts:300`

**Clamp clip frame durations to the segment boundary and use the emitted end for the FPS slot.**

`nextSlot` limits timestamp spacing, but `videoSource.add` receives the untrimmed decoded duration. A frame returned before `sourceEnd` can therefore extend into the next clip or slide. Audio advances at the exact segment boundary, so this can show the previous clip while the next segment's audio is playing.
