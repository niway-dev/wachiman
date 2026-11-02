# Judge: kaipu-record #269 (head 3159fb1c)

Ground truth: createDragCopy hard-link/copy across volumes (fixed in 3f729bd, drag-copies.ts). This PR (export presets) does not touch drag-copies at all, so no finding can match it.

## Per-finding
- F01 doc:32 - Valid. `exportPreset`/`recordingStat` absent from src (git grep); `use-video-export.ts:237` still uses `t("editedTitle")`; doc lines 32-35, 63-66 present-tense. Severity Low. No later fix checked. Catalogued: none. Dup group A.
- F02 export-presets.ts:223 - Valid. Capped branch `Math.min(opts.maxFps, Math.max(1, opts.fps))` contradicts the docblock at 209-212; worker only raises via `Math.max` from the same average (export-worker.ts:203-212). Real impact softened by the FR9 fallback (extra encode, no fast start). Severity Low-Medium -> Low. Catalogued: none. Dup group B.
- F03 use-video-export.ts:224 - Partly valid. No size check exists, and `recordingStat` is absent, but `presetId` is not exposed in any UI and the doc is explicit this is PR 3; it is a planned gap, not a regression. Severity Info. Catalogued: none. Overlaps A in the doc part.
- F04 use-video-export.test.ts:353 - Unconfirmed (test body not fully read). Plausible coverage gap, relevant only to tests. Severity Low. Catalogued: none.
- F05 export-presets.ts:13 - Partly valid. The comment says Discord 20 MB and the 25 MB cap is "chat with margin"; the contradiction is real in the text, but it is a comment only, with no runtime effect. Severity Info. Catalogued: none.
- F06 export-presets.ts:223 - Valid (same as F02), with a concrete scenario and a fix. Severity Low. Catalogued: none. Dup group B.
- F07 export-presets.ts:223 - Valid (same as F02), shorter. Severity Low. Catalogued: none. Dup group B.
- F08 use-video-export.ts:49 - Unconfirmed. The reviewer admits it did not verify mediabunny's message; it is a question, not a defect. Severity Info/Low. Catalogued: none.
- F09 doc:33 - Valid (same as F01, plus the "component tests pass" banner claim, which is minor). Severity Low. Catalogued: none. Dup group A.
- F10 doc:32 - Valid (same as F01). Severity Low. Catalogued: none. Dup group A.
- F11 export-worker.ts:300 - Partly valid. `videoSource.add(outTs, Math.max(wrapped.duration, minFrameGap))` (head; base line 238 passed `wrapped.duration`) does not clamp to the segment boundary; that unclamped duration existed at base, and the PR only adds the minFrameGap max. Mostly pre-existing, and the audio-sync claim is unverified. Severity Low. Catalogued: none.

## Duplicates
A = F01, F09, F10 (F03 partly). B = F02, F06, F07.

## Message quality (0-5: Effect, Location, Cause, Fix, Signal)
- F01: 4/5/5/4/4. "Someone validating on the Mac mini could test for behaviour that doesn't exist yet."
- F02: 5/5/5/5/4. "The user waits through two exports and still gets a file without fast start."
- F03: 4/5/4/4/2. "a '10 MB' export can come out at 11 MB with no warning"
- F04: 3/5/4/4/2. "a regression that reused the detached bitmaps would still pass."
- F05: 2/5/4/4/2. "A 25 MB file has no margin under a 20 MB limit; it would be rejected."
- F06: 5/5/5/5/5. "The user waits twice as long and gets a file without fast start ... with no visible signal."
- F07: 4/5/4/4/4. "An edit that keeps the high-motion parts can overflow the reserve"
- F08: 3/4/2/3/2. "Did you check the regex against mediabunny's actual throw site"
- F09: 4/5/5/4/4. "A reader on main would trust the size check and the title suffixes."
- F10: 4/5/5/4/4. "If PRs 2 and 3 slip, anyone validating this slice ... will look for behaviour that isn't there."
- F11: 2/3/3/3/2. "so this can show the previous clip while the next segment's audio is playing."

## Final table
| F-id | verdict | severity | catalogued match | duplicate group | quality |
|---|---|---|---|---|---|
| F01 | Valid | Low | none | A | 4.4 |
| F02 | Valid | Low | none | B | 4.8 |
| F03 | Partly valid | Info | none | A (part) | 3.4 |
| F04 | Unconfirmed | Low | none | - | 3.6 |
| F05 | Partly valid | Info | none | - | 3.2 |
| F06 | Valid | Low | none | B | 5.0 |
| F07 | Valid | Low | none | B | 4.2 |
| F08 | Unconfirmed | Info | none | - | 2.8 |
| F09 | Valid | Low | none | A | 4.4 |
| F10 | Valid | Low | none | A | 4.4 |
| F11 | Partly valid | Low | none | - | 2.6 |
