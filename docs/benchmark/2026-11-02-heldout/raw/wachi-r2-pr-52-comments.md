## apps/kaipu-record/src/main/infrastructure/settings-store.ts:82 by github-actions[bot]

👮 **Wachiman** · 🔴🐛 **Blocker · bug: Policy cache ignores the Dock-hide that the floating panels trigger, so re-asserting can no longer restore the app (confidence medium)**

`appliedPolicy` only records what this module set. Something else changes the policy behind its back. `CameraBubbleWindow.show()` creates a new window on every camera-on (destroy-on-off, `recording-hub.ts:162`). It then calls `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` without `skipTransformProcessType` (`camera-bubble-window.ts:47`), and `ControlBarWindow` makes the same call (`control-bar-window.ts:62`). Electron documents that, on macOS, this call switches the process to a UIElement (accessory) app, which is a Dock hide. The repo's own comments describe the same effect: "Showing a floating panel can drop the app from the Dock/Cmd+Tab on macOS; re-assert the policy" (`recording-hub.ts:155-157`, `281-284`). That re-assertion is the only repair, and this change turns it into a no-op because the cache still says `regular`.

With `showInDock = true` (the default), the result is:
- **Camera on:** the bubble is created and the app leaves the Dock and Cmd+Tab. `applyDockPolicy()` returns early at line 82, so the app stays out of them.
- **Recording:** `forceRegularPolicy()` (`recording-hub.ts:267`) runs before the bar is created asynchronously, so the bar's transform drops the app during the take. On stop, `applyDockPolicy()` (`recording-hub.ts:284`) is a no-op, so the app is still missing after the recording.
- **Rescue shortcut:** `bringAppToFront()` (`index.ts:234-237`) also relies on `applyDockPolicy()` and can't restore it either. Only flipping the `showInDock` setting off and on again recovers.

The new tests mock both window classes (`recording-hub.test.ts:39-54`), so they can't see this. Possible fixes:
- Pass `skipTransformProcessType: true` in both windows, after checking it still floats over full-screen Spaces.
- Reset `appliedPolicy = null` after creating a panel window.

I couldn't read Electron's native source from here, so the transform itself rests on Electron's documented behaviour and on this repo's comments.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:109 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: `mainWindow.hide` assertion can't fail, even on the old code (confidence high)**

The camera branch of `applySettingsPatch` (`recording-hub.ts:146-165`) never calls `getMainWindow()`. The backlog doc also establishes that the observed `hide` came from native code with no JS caller (bug doc, finding 2). So `expect(mainWindow.hide).not.toHaveBeenCalled()` (here and at line 128) passed before the fix too. The only real regression signal is the activation-policy and `dock.show` call counts. The describe title "camera on keeps the main window visible" claims more than the test can observe. Consider renaming it to what it checks (no policy churn on camera-on), or dropping the vacuous assertion.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/bug-main-window-hides-on-blur.md:100 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: "Hypothesis 1 held" and "the whole fix" state as confirmed something that wasn't measured (confidence medium)**

The doc's own plan says to log every policy call with its caller and confirm one precedes each `blur → hide` before applying the fix (lines 115-119). The PR body says the manual on-device check is still pending, and the doc records no such log. The doc also still lists `setVisibleOnAllWorkspaces` on the bubble and bar as hypothesis 2 (lines 93-96). That is the call that hides the Dock natively on each new bubble window. Until the experiment is run, consider wording these lines as the expected cause rather than a confirmed one.

<!-- wachi:finding -->

