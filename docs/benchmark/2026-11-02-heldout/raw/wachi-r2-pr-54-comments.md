## apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:223 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Capped packet count trusts the average rate, so variable-rate sources under-reserve the moov box (confidence medium)**

The docstring at lines 209-213 says the video rate "never assumes less than 30 fps — a variable-rate screen recording can burst above its average". The `maxFps !== null` branch does the opposite: `Math.min(opts.maxFps, Math.max(1, opts.fps))`. It reserves for the source's *average* rate, which can be far below 30 for a mostly static screen recording. In the worker (`export-worker.ts:203-211`), that average comes from only the first 240 packets (`computePacketStats(240)`). The renderer passes 30 when `sourceInfo` is omitted, but the worker raises the count with `Math.max`, never lowers it.

Example: a Small-file export below 1080p (maxFps 30) from a source that averages about 10 fps but has long active stretches near 30 fps can emit up to 30 frames/s after the cap. That outruns `d × 10 × 1.33` packets, the muxer throws, and `use-video-export.ts:210-221` silently re-runs the whole export with `fastStart: false`. The user waits twice as long and gets a file without fast start, which is the main point of this PR, with no visible signal.

Suggested fix: when capped, reserve for the cap itself. Use `opts.maxFps` (or `Math.min(opts.maxFps, Math.max(30, Math.ceil(opts.fps)))`) so the bound matches the frames the fps-cap loop at `export-worker.ts:293-294` can actually emit.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:13 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Discord source note contradicts the 25 MB cap (confidence medium)**

The header gives Discord's no-Nitro limit as 20 MB, then calls the 25 MB cap "chat with margin". A 25 MB file has no margin under a 20 MB limit; it would be rejected. Either the limit quoted here is wrong or the 25 MB rung isn't meant for Discord. Please correct the figure or say which destination the 25 MB preset targets, so the "one-line change" table stays trustworthy.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/export-presets.md:32 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Doc describes later-PR behaviour in the present tense (confidence high)**

Several sentences describe as current behaviour things that are not in the repository at this commit:
- Line 32: the last preset is remembered app-wide.
- Lines 33–35: an `exportPreset` sidecar field and per-preset title suffixes. `use-video-export.ts:235` still uses `t("editedTitle")` for every preset, and `exportPreset` appears nowhere under `apps/kaipu-record/src`.
- Lines 62–66: the sheet warning, "Export anyway", and the `recordingStat` post-export check and re-encode. There is no `recordingStat` in `src/shared/types/ipc.ts`.

The status banner says the work spans three PRs, but nothing in the body says which part has shipped. Someone validating on the Mac mini could test for behaviour that doesn't exist yet. Consider tagging these items with the PR that delivers them (e.g. "(PR 2)" / "(PR 3)"), or moving them to a "Planned" subsection until those PRs land.

<!-- wachi:finding -->

