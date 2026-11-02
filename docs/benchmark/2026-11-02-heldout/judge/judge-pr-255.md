# Judge: kaipu-record #255 (blind)

Ground truth confirmed: fix 72ab3e26 (#366) adds `skipTransformProcessType` to both floating windows and replaces the module cache with an `isVisible()` probe. At head, settings-store.ts:82 returns early on `appliedPolicy === policy`, and camera-bubble-window.ts:47 calls `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` unguarded.

## Per-finding

**F01** (settings-store.ts:82). Valid (partly specific). Early return skips `dock.show()` when cache is "regular" but Dock hidden (settings-store.ts:82-85). Names the effect but not the cause (floating windows). Fix (show only the Dock) is plausible; the real fix used a live probe. Severity: Medium (app lost from Dock/Cmd+Tab, workaround = toggle setting). Later fix: 72ab3e26. Match: **match** (cache diverges from real state, restore no-op), though cause of divergence unnamed.

**F02** (settings-store.ts:82). Valid. Names exactly the ground-truth chain: bubble (camera-bubble-window.ts:47) and bar call setVisibleOnAllWorkspaces without skipTransformProcessType, cache stays "regular", restore no-op. Offers the exact fix (skipTransformProcessType) plus cache reset. Severity: Medium. Fixed 72ab3e26. Match: **match**.

**F03** (bug-main-window-hides-on-blur.md:100). Valid-ish (docs overclaim: heading "hypothesis 1 held" at line 100 while the experiment is unrun). Severity: Info. Later: 72ab3e26 touched this doc but did not retract wording (unconfirmed). Match: none.

**F04** (settings-store.ts:82). Valid. Cache can't see macOS state; recovery re-assertions (stop, rescue shortcut) become no-ops. Attributes the drop to main window hide rather than floating panels (wrong cause), but suggests `isVisible()` probe, which is the actual fix. Severity: Medium. Fixed 72ab3e26. Match: **match** (mechanism right, trigger partly misattributed; strict could be partial, but the probe fix and the consequence are exact).

**F05** (recording-hub.test.ts:109). Valid. `mainWindow.hide` is never called on the camera path, so the assertion is vacuous (test lines 109, 128); the policy-count assertions do the work. Severity: Low. No fix found. Match: none.

**F06** (doc :100). Valid, same as F03; Info. Match: none.

**F07** (test :109). Valid, duplicate of F05; Low. Match: none.

**F08** (doc :100). Valid, same as F03; adds hypothesis 3 not ruled out (doc line 97). Info. Match: none.

**F09** (settings-store.ts:82). Valid. Same as F04: memo turns rescue/stop/recording-start re-assertions into no-ops; cause attributed to "macOS changed on its own", floating panels mentioned in the comment. Fix suggestions (forced variant) workable. Medium. Fixed 72ab3e26. Match: **match** (generic cause, strict reading could be partial; consequence and mechanism correct).

**F10** (test :109). Valid, duplicate of F05; Low. Match: none.

## Duplicates
- Cache no-op: F02, F04, F09 (F01 same site, narrower).
- Doc overclaim: F03, F06, F08.
- Vacuous hide assertion: F05, F07, F10.

## Message quality (0-5)
- F01: 2. Effect yes, location yes, cause weak. "early return skips app.dock?.show()" ; fix snippet cut off.
- F02: 5. "ControlBarWindow makes the same call (control-bar-window.ts:62)... this change turns it into a no-op because the cache still says regular."
- F03: 4. "state as confirmed something that wasn't measured".
- F04: 4. "appliedPolicy only records what this process last asked for. It cannot see the state macOS actually has."
- F05: 4. "passes before and after the fix".
- F06: 4. "the confirming experiment was not run".
- F07: 4. "can't fail, even on the old code".
- F08: 4. "no confirming experiment is recorded".
- F09: 4. "cannot see that kind of drop"; fix options clear.
- F10: 3. Concise, correct, less evidence.

## Table
| F-id | verdict | severity | catalogued match | duplicate group | quality |
|---|---|---|---|---|---|
| F01 | Valid | Medium | match | A (cache) | 2 |
| F02 | Valid | Medium | match | A | 5 |
| F03 | Valid | Info | none | B (doc) | 4 |
| F04 | Valid | Medium | match | A | 4 |
| F05 | Valid | Low | none | C (test) | 4 |
| F06 | Valid | Info | none | B | 4 |
| F07 | Valid | Low | none | C | 4 |
| F08 | Valid | Info | none | B | 4 |
| F09 | Valid | Medium | match | A | 4 |
| F10 | Valid | Low | none | C | 3 |
