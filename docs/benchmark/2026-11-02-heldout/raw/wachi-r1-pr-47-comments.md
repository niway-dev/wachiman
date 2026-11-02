## apps/kaipu-record/src/main/infrastructure/settings-store.ts:82 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: The cache also turns the recovery re-assertions into no-ops, so the 'app vanishes from Dock/⌘-Tab after a recording' fix can come back (confidence medium)**

`appliedPolicy` only records what this process last *asked for*. It cannot see the state macOS actually has. The callers of `applyDockPolicy()` were written to repair a state that drifted outside our control:
- `recording-hub.ts:281-284`: "Hiding the main window for the recording can drop the app from the Dock / Cmd+Tab on macOS; re-assert the policy".
- `roadmap.md:185-187`: this re-assertion on stop is recorded as the fix for "the app vanishing from the Dock & ⌘-Tab after a recording".
- `index.ts:233-237`: the `⌘⌃O` rescue shortcut calls `applyDockPolicy()` to bring a lost app back.

`showInDock` defaults to `true` (`shared/types/ipc.ts:214`). For those users, `registerSettings()` sets `appliedPolicy = "regular"` at startup. After that, `forceRegularPolicy()` at recording start (`recording-hub.ts:267`), `applyDockPolicy()` on stop (`recording-hub.ts:284`) and the rescue shortcut (`index.ts:236`) all return at line 82 without touching AppKit. If macOS drops the app after the main window is hidden, the code that used to repair it no longer runs. The user is left with an app missing from the Dock and ⌘-Tab, with no error. The rescue shortcut no longer restores the Dock icon either. It still shows the window and focuses it.

Only the camera-on call at `recording-hub.ts:157` caused the reported bug. A fix that keeps the guard there but still repairs on the restore paths: let `applyDockPolicy` take a `{ force: true }` that `applyStopWindowState` and `bringAppToFront` pass. Another option is to decide "unchanged" from `app.dock?.isVisible()` instead of a module variable. Either way, check on device that a recording with Show in Dock on still leaves the app in ⌘-Tab after stop.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:109 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: `mainWindow.hide` not being called proves nothing about the reported bug (confidence high)**

The backlog doc this test cites says the `hide` came from native code, "no JavaScript calls `hide()`" (`bug-main-window-hides-on-blur.md:72-76`). The old code never called `mainWindow.hide()` on the camera path either, so `expect(mainWindow.hide).not.toHaveBeenCalled()` (lines 109 and 128) passes before and after the fix. Only the activation-policy assertions test the regression. The test name and the doc both say "never hides the main window" (`bug-main-window-hides-on-blur.md:29-30`), which overstates what a unit test can see here. Consider dropping the `hide` assertion, or renaming the test so it claims only what it checks: the camera toggle leaves the activation policy alone.

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/bug-main-window-hides-on-blur.md:100 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: The doc says hypothesis 1 'held', but the confirming experiment was not run (confidence medium)**

The heading says "hypothesis 1 held", and the Fix section calls the native ordering "exactly as measured below" and "the whole fix". The experiment the doc itself lays out has not been run: log each policy call with its caller and check that one lands right before each `blur → hide` (lines 102-119). The PR body also says "manual on-device check still pending". The only measurement shows `after applyDockPolicy, main visible: true` (line 56). It does not tie each cycle to a policy call. Hypothesis 3 (a dev-only `electron-vite` artefact, line 97) was never ruled out either. Word this as the expected cause until the on-device check confirms it, so whoever validates the 🟢 item knows that hypotheses 2 and 3 are still open.

<!-- wachi:finding -->

