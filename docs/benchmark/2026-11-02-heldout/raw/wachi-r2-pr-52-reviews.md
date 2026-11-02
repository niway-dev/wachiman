## review by github-actions[bot] at 2026-11-02T06:06:02Z

👮 **Wachiman** · review of the whole pull request, at `78e20a2`: all 5 files reviewed.

3 finding(s): 1 blocker(s), 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Summary

The PR caches the last activation policy that was applied, so `applyDockPolicy()` and `forceRegularPolicy()` don't touch AppKit again when nothing changed. One premise is wrong: this module isn't the only thing that changes the policy. Every new camera bubble, and the control bar, calls `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, which on macOS hides the Dock natively. The repo's own comments say the re-assertions exist to undo exactly that. With the cache, the camera-on path, the recording-stop path and the ⌘⌃O rescue shortcut become no-ops, so the app can stay out of the Dock and Cmd+Tab for the rest of the session. This blocker has medium confidence: it rests on Electron's documented behaviour and the repo's comments, since I couldn't read Electron's native source. The new tests mock both window classes, so they can't catch it. One hub assertion (`mainWindow.hide` not called) also passed before the fix. The backlog doc says the hypothesis held, but the PR body says the on-device check is still pending.

<details><summary>What the change connects to (4 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- Camera ON re-asserts the Dock policy through the now-cached applyDockPolicy() (`apps/kaipu-record/src/main/recording/recording-hub.ts:157`) — The app can drop out of the Dock and Cmd+Tab after the camera is switched on, with nothing restoring it. If it fails: Silent: the cached policy disagrees with the real process state for the rest of the session. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:152-163`, `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:20-47`, `apps/kaipu-record/src/main/infrastructure/settings-store.ts:78-86`.
- Recording stop restores the Dock policy via applyDockPolicy() (`apps/kaipu-record/src/main/recording/recording-hub.ts:284`) — After a recording the app may stay missing from the Dock/Cmd+Tab. If it fails: Silent; the forceReset path (recording-hub.ts:316-322) has the same no-op. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:262-288`, `apps/kaipu-record/src/main/recording/control-bar-window.ts:38-62`.
- Rescue shortcut bringAppToFront() relies on applyDockPolicy() (`apps/kaipu-record/src/main/index.ts:236`) — The ⌘⌃O rescue shows the main window but may not bring back the Dock/Cmd+Tab entry. If it fails: Silent. Evidence: `apps/kaipu-record/src/main/index.ts:233-238`, `apps/kaipu-record/src/main/infrastructure/settings-store.ts:94-96`.
- Settings update applies side effects (Dock policy, login item) (`apps/kaipu-record/src/main/infrastructure/settings-store.ts:125-130`) — Toggling showInDock still adds or removes the Dock icon. Evidence: `apps/kaipu-record/src/main/infrastructure/settings-store.ts:141-148`, `apps/kaipu-record/src/main/infrastructure/settings-store.test.ts:90-104`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 5 | 332 | 5 | reviewed | 14 | $0.52 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · $0.52</sub>

<!-- wachi:review -->

<!-- agent-review sha=78e20a2530cd0d7eaad647a55b561dee147836bc -->

<!-- wachi:attempt id=86eccdfd-5d04-4e57-b5e9-791a53d6b927 -->

