# Blind findings for kaipu-record #255

Every finding below was posted by one of several automated reviewers on the same diff. Reviewer names and labels are removed. Judge each on its merits.


## F01 — `apps/kaipu-record/src/main/infrastructure/settings-store.ts:82`

**Restore Dock visibility without reapplying the activation policy.**

When the cached policy is `"regular"` but the Dock is hidden, the early return skips `app.dock?.show()`. The recording and camera-bubble transitions can leave the app unavailable in the Dock or Cmd+Tab.

Restore only the Dock in this same-policy case:


## F02 — `apps/kaipu-record/src/main/infrastructure/settings-store.ts:82`

**Policy cache ignores the Dock-hide that the floating panels trigger, so re-asserting can no longer restore the app **

`appliedPolicy` only records what this module set. Something else changes the policy behind its back. `CameraBubbleWindow.show()` creates a new window on every camera-on (destroy-on-off, `recording-hub.ts:162`). It then calls `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` without `skipTransformProcessType` (`camera-bubble-window.ts:47`), and `ControlBarWindow` makes the same call (`control-bar-window.ts:62`). Electron documents that, on macOS, this call switches the process to a UIElement (accessory) app, which is a Dock hide. The repo's own comments describe the same effect: "Showing a floating panel can drop the app from the Dock/Cmd+Tab on macOS; re-assert the policy" (`recording-hub.ts:155-157`, `281-284`). That re-assertion is the only repair, and this change turns it into a no-op because the cache still says `regular`.

With `showInDock = true` (the default), the result is:
- **Camera on:** the bubble is created and the app leaves the Dock and Cmd+Tab. `applyDockPolicy()` returns early at line 82, so the app stays out of them.
- **Recording:** `forceRegularPolicy()` (`recording-hub.ts:267`) runs before the bar is created asynchronously, so the bar's transform drops the app during the take. On stop, `applyDockPolicy()` (`recording-hub.ts:284`) is a no-op, so the app is still missing after the recording.
- **Rescue shortcut:** `bringAppToFront()` (`index.ts:234-237`) also relies on `applyDockPolicy()` and can't restore it either. Only flipping the `showInDock` setting off and on again recovers.

The new tests mock both window classes (`recording-hub.test.ts:39-54`), so they can't see this. Possible fixes:
- Pass `skipTransformProcessType: true` in both windows, after checking it still floats over full-screen Spaces.
- Reset `appliedPolicy = null` after creating a panel window.

I couldn't read Electron's native source from here, so the transform itself rests on Electron's documented behaviour and on this repo's comments.


## F03 — `apps/documentation/src/content/docs/backlog/bug-main-window-hides-on-blur.md:100`

**"Hypothesis 1 held" and "the whole fix" state as confirmed something that wasn't measured **

The doc's own plan says to log every policy call with its caller and confirm one precedes each `blur → hide` before applying the fix (lines 115-119). The PR body says the manual on-device check is still pending, and the doc records no such log. The doc also still lists `setVisibleOnAllWorkspaces` on the bubble and bar as hypothesis 2 (lines 93-96). That is the call that hides the Dock natively on each new bubble window. Until the experiment is run, consider wording these lines as the expected cause rather than a confirmed one.


## F04 — `apps/kaipu-record/src/main/infrastructure/settings-store.ts:82`

**The cache also turns the recovery re-assertions into no-ops, so the 'app vanishes from Dock/⌘-Tab after a recording' fix can come back **

`appliedPolicy` only records what this process last *asked for*. It cannot see the state macOS actually has. The callers of `applyDockPolicy()` were written to repair a state that drifted outside our control:
- `recording-hub.ts:281-284`: "Hiding the main window for the recording can drop the app from the Dock / Cmd+Tab on macOS; re-assert the policy".
- `roadmap.md:185-187`: this re-assertion on stop is recorded as the fix for "the app vanishing from the Dock & ⌘-Tab after a recording".
- `index.ts:233-237`: the `⌘⌃O` rescue shortcut calls `applyDockPolicy()` to bring a lost app back.

`showInDock` defaults to `true` (`shared/types/ipc.ts:214`). For those users, `registerSettings()` sets `appliedPolicy = "regular"` at startup. After that, `forceRegularPolicy()` at recording start (`recording-hub.ts:267`), `applyDockPolicy()` on stop (`recording-hub.ts:284`) and the rescue shortcut (`index.ts:236`) all return at line 82 without touching AppKit. If macOS drops the app after the main window is hidden, the code that used to repair it no longer runs. The user is left with an app missing from the Dock and ⌘-Tab, with no error. The rescue shortcut no longer restores the Dock icon either. It still shows the window and focuses it.

Only the camera-on call at `recording-hub.ts:157` caused the reported bug. A fix that keeps the guard there but still repairs on the restore paths: let `applyDockPolicy` take a `{ force: true }` that `applyStopWindowState` and `bringAppToFront` pass. Another option is to decide "unchanged" from `app.dock?.isVisible()` instead of a module variable. Either way, check on device that a recording with Show in Dock on still leaves the app in ⌘-Tab after stop.


## F05 — `apps/kaipu-record/src/main/recording/recording-hub.test.ts:109`

**`mainWindow.hide` not being called proves nothing about the reported bug **

The backlog doc this test cites says the `hide` came from native code, "no JavaScript calls `hide()`" (`bug-main-window-hides-on-blur.md:72-76`). The old code never called `mainWindow.hide()` on the camera path either, so `expect(mainWindow.hide).not.toHaveBeenCalled()` (lines 109 and 128) passes before and after the fix. Only the activation-policy assertions test the regression. The test name and the doc both say "never hides the main window" (`bug-main-window-hides-on-blur.md:29-30`), which overstates what a unit test can see here. Consider dropping the `hide` assertion, or renaming the test so it claims only what it checks: the camera toggle leaves the activation policy alone.


## F06 — `apps/documentation/src/content/docs/backlog/bug-main-window-hides-on-blur.md:100`

**The doc says hypothesis 1 'held', but the confirming experiment was not run **

The heading says "hypothesis 1 held", and the Fix section calls the native ordering "exactly as measured below" and "the whole fix". The experiment the doc itself lays out has not been run: log each policy call with its caller and check that one lands right before each `blur → hide` (lines 102-119). The PR body also says "manual on-device check still pending". The only measurement shows `after applyDockPolicy, main visible: true` (line 56). It does not tie each cycle to a policy call. Hypothesis 3 (a dev-only `electron-vite` artefact, line 97) was never ruled out either. Word this as the expected cause until the on-device check confirms it, so whoever validates the 🟢 item knows that hypotheses 2 and 3 are still open.


## F07 — `apps/kaipu-record/src/main/recording/recording-hub.test.ts:109`

**`mainWindow.hide` assertion can't fail, even on the old code **

The camera branch of `applySettingsPatch` (`recording-hub.ts:146-165`) never calls `getMainWindow()`. The backlog doc also establishes that the observed `hide` came from native code with no JS caller (bug doc, finding 2). So `expect(mainWindow.hide).not.toHaveBeenCalled()` (here and at line 128) passed before the fix too. The only real regression signal is the activation-policy and `dock.show` call counts. The describe title "camera on keeps the main window visible" claims more than the test can observe. Consider renaming it to what it checks (no policy churn on camera-on), or dropping the vacuous assertion.


## F08 — `apps/documentation/src/content/docs/backlog/bug-main-window-hides-on-blur.md:100`

**Doc says hypothesis 1 "held" but no confirming experiment is recorded **

The heading now says "hypothesis 1 held", and line 20 says "Why that is the whole fix". But the experiment this section describes (logging every policy call with its caller and checking that one comes before each `blur → hide`) has no recorded result. The PR body says the on-device check is still pending.

Hypothesis 3 (a dev-only `electron-vite` artefact, line 97) was also never ruled out. The measured log (lines 47–53) shows a full cycle before the camera was touched, and the doc never says which policy call caused it.

Suggest saying "hypothesis 1 assumed; to confirm on device" until the validation in the status banner has actually been done, or recording the log that confirmed it.


## F09 — `apps/kaipu-record/src/main/infrastructure/settings-store.ts:82`

**Memoizing on the last applied policy turns the rescue re-assertions into no-ops **

Every caller other than the settings update calls `applyDockPolicy()` to repair a state that macOS changed on its own, not one this module changed. The doc comment right below (lines 88–92) says hide/show cycles and floating panels "can otherwise drop the app from the switcher". `applyStopWindowState` (`recording-hub.ts:281-284`) repeats that reason, and so does the ⌘⌃O rescue shortcut `bringAppToFront` (`index.ts:233-237`, "Bring the app back to the foreground from any state"). `appliedPolicy` only records what this process last asked for, so it cannot see that kind of drop.

With `showInDock: true` (the default, see `settings-store.test.ts:68`), startup sets `appliedPolicy = "regular"`. After that:
- `forceRegularPolicy()` at recording start returns early.
- `applyDockPolicy()` at recording stop returns early.
- `applyDockPolicy()` in the rescue shortcut returns early.

None of them reaches `setActivationPolicy`/`dock.show()` for the rest of the session. If the drop those comments describe happens, the stop path and the rescue shortcut no longer bring the app back into the Dock/Cmd+Tab, and nothing tells the user.

The bug only needed the camera-on path (`recording-hub.ts:157`) to stop re-asserting. Possible fixes:
- Keep the early return for that path only, e.g. drop the call there or make it memoized.
- Give `bringAppToFront` and `applyStopWindowState` a forced variant that ignores `appliedPolicy`. Those paths show and focus the window anyway, so a `dock.show()` cycle there is harmless.

If the drop-from-switcher behaviour turned out not to be real, update the comments at lines 88–92 and in `recording-hub.ts` and `index.ts` to say so. Then the memo is the whole story.


## F10 — `apps/kaipu-record/src/main/recording/recording-hub.test.ts:109`

**`mainWindow.hide` assertion cannot fail **

The bug doc established that no JavaScript calls `hide()`: the hide was emitted from native code (bug doc lines 72–76). `fakeMainWindow().hide` is a fresh `vi.fn()` that nothing in the camera path ever calls, so `expect(mainWindow.hide).not.toHaveBeenCalled()` passes on both the old and the new code.

The real regression guard is the activation-policy count. The test name and the doc's claim ("never hides the main window") suggest more coverage than the test gives. Consider dropping the assertion, or renaming the test around the policy churn it actually checks.
