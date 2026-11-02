## apps/kaipu-record/src/main/infrastructure/settings-store.ts:82 by github-actions[bot]

👮 **Wachiman** · 🟠🐛 **Fix · bug: Memoizing on the last applied policy turns the rescue re-assertions into no-ops (confidence medium)**

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

<!-- wachi:finding -->

## apps/documentation/src/content/docs/backlog/bug-main-window-hides-on-blur.md:100 by github-actions[bot]

👮 **Wachiman** · 🟡📝 **Consider · docs: Doc says hypothesis 1 "held" but no confirming experiment is recorded (confidence high)**

The heading now says "hypothesis 1 held", and line 20 says "Why that is the whole fix". But the experiment this section describes (logging every policy call with its caller and checking that one comes before each `blur → hide`) has no recorded result. The PR body says the on-device check is still pending.

Hypothesis 3 (a dev-only `electron-vite` artefact, line 97) was also never ruled out. The measured log (lines 47–53) shows a full cycle before the camera was touched, and the doc never says which policy call caused it.

Suggest saying "hypothesis 1 assumed; to confirm on device" until the validation in the status banner has actually been done, or recording the log that confirmed it.

<!-- wachi:finding -->

## apps/kaipu-record/src/main/recording/recording-hub.test.ts:109 by github-actions[bot]

👮 **Wachiman** · 🟡🧪 **Consider · tests: `mainWindow.hide` assertion cannot fail (confidence high)**

The bug doc established that no JavaScript calls `hide()`: the hide was emitted from native code (bug doc lines 72–76). `fakeMainWindow().hide` is a fresh `vi.fn()` that nothing in the camera path ever calls, so `expect(mainWindow.hide).not.toHaveBeenCalled()` passes on both the old and the new code.

The real regression guard is the activation-policy count. The test name and the doc's claim ("never hides the main window") suggest more coverage than the test gives. Consider dropping the assertion, or renaming the test around the policy churn it actually checks.

<!-- wachi:finding -->

