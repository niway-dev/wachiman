## apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:224 by github-actions[bot]

👮 **Wachiman** · 🟡🐛 **Consider · bug: Small file never checks the finished size against the cap (confidence high)**

The hook takes `presetId: "small-10" | "small-25"` and `resolveExportTarget` sets a target bitrate inside `cap × 0.92`. But the `done` branch finalizes straight away. Nothing stats the written file or re-encodes it when the encoder overshoots. The backlog doc (`backlog/export-presets.md` lines 63-66) says the hook calls a `recordingStat` IPC, re-encodes once at `V × 0.8 × cap / actual`, and shows a toast on a second overshoot. No `recordingStat` exists anywhere in `apps/kaipu-record/src`. VBR overshoot from hardware encoders (VideoToolbox) is the case the doc lists as still to be measured. With this code, a "10 MB" export can come out at 11 MB with no warning, and GitHub will then reject the upload. No UI passes `presetId` yet (only the hook and its test reference it), so nobody hits this today. Either add the stat/retry before the Small-file presets are exposed, or remove that paragraph from the doc.

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/video-editor/export/use-video-export.ts:49 by github-actions[bot]

👮 **Wachiman** · 🟠❓ **Fix · question: Does mediabunny's overflow error actually match /maximum packet count/i? (confidence low)**

Every export now uses `fastStart: "reserve"`, including Original, the only preset the editor reaches today. That makes the FR9 fallback (lines 210-222) the only thing between a variable-rate burst that overflows `maximumPacketCount` and a failed export. Before this change the same export succeeded with `fastStart: false`. The fallback runs only when the worker's error text matches `/maximum packet count/i`. I could not check that string against the installed mediabunny version (there is no node_modules in the checkout), and the hook test mocks the message. If mediabunny words it differently (for example "packet count exceeded"), an overflow falls through to `fail(GENERIC_ERROR)` and an export that used to work now fails. Did you check the regex against mediabunny's actual throw site, and could a test pin it to the library's message?

<!-- wachi:finding -->

## apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts:223 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Capped branch can assume < 30 fps, contrary to the docblock (confidence high)**

The docblock says "The video rate never assumes less than 30 fps — a variable-rate screen recording can burst above its average". When `maxFps` is set (Small file below 1080p), the code uses `Math.min(opts.maxFps, Math.max(1, opts.fps))`. A mostly static recording averaging, say, 8 fps therefore reserves for 8 fps, even though bursts up to the 30 fps cap get through. The worker only raises the count using `computePacketStats(240)`, i.e. the first 240 packets (export-worker.ts:203-206). An edit that keeps the high-motion parts can overflow the reserve, which costs a full second encode through the fallback. `Math.min(opts.maxFps, Math.max(30, Math.ceil(opts.fps)))`, or simply `opts.maxFps`, matches the comment.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/export-presets.md:32 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Doc describes later-PR behaviour as if it already ships (confidence high)**

"What the user gets" and "How it works" describe these in the present tense: the remembered preset/framing (line 32), `exportPreset` in the sidecar and per-preset title suffixes (lines 33–35), and the post-export `recordingStat` size check and retry (lines 63–66). None of them exist at this head. `use-video-export.ts:234-240` always finalizes with `t("editedTitle")` and sends no `exportPreset`, and the repository has no `recordingStat` or `exportPreset` symbol. The 🟡 banner names the three stacked PRs, but the body never says which items each one delivers. If PRs 2 and 3 slip, anyone validating this slice on the Mac mini will look for behaviour that isn't there. Consider tagging each item with its PR (picker / small-file check), or moving the not-yet-built items under a "Coming in the next PRs" heading.

<!-- wachi:finding -->

