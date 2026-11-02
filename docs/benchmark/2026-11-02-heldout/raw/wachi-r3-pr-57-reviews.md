## review by github-actions[bot] at 2026-11-02T06:05:52Z

👮 **Wachiman** · review of the whole pull request, at `78e20a2`: all 5 files reviewed.

3 finding(s): 1 to fix, 2 to consider; 3 on their lines. Reply in a comment's thread to answer it.

### Summary

The fix stops the camera-on path from calling `app.dock.show()`, which is the trigger the diagnosis points to. The tests show that unchanged policies are skipped and real changes still happen. One fix-level finding: the memo is module-wide, so recording stop and the ⌘⌃O rescue shortcut also become no-ops when the setting hasn't changed (the default `showInDock: true`). Code comments say those calls exist to undo macOS dropping the app from the Dock/Cmd+Tab, and that undo no longer happens. Two smaller points: the doc says the cause is confirmed before the on-device check was done, and one test assertion cannot fail.

<details><summary>What the change connects to (2 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**
- applyDockPolicy/forceRegularPolicy now return early when the requested policy equals the last one this process applied (`apps/kaipu-record/src/main/infrastructure/settings-store.ts:80`) — Camera on no longer triggers dock.show(), so it no longer causes the blur/hide/show cycle. With showInDock true, recording stop and ⌘⌃O no longer re-add the app to the Dock/Cmd+Tab if macOS dropped it. If it fails: Silent: appliedPolicy is never reset, so a policy change made outside this module (macOS dropping the app) is never repaired for the rest of the session. Evidence: `apps/kaipu-record/src/main/infrastructure/settings-store.ts:78-96`, `apps/kaipu-record/src/main/recording/recording-hub.ts:153-157`, `apps/kaipu-record/src/main/recording/recording-hub.ts:275-285`, `apps/kaipu-record/src/main/index.ts:233-237`, `apps/kaipu-record/src/main/infrastructure/settings-store.ts:125-130`.
- forceRegularPolicy at recording start now skips when regular is already applied (`apps/kaipu-record/src/main/recording/recording-hub.ts:267`) — With showInDock false the Dock icon still appears during recording and is removed on stop. With showInDock true nothing is re-applied. If it fails: If the renderer crashes, forceReset -> applyStopWindowState still runs applyDockPolicy, which transitions correctly because appliedPolicy tracks the forced regular. Evidence: `apps/kaipu-record/src/main/recording/recording-hub.ts:262-268`, `apps/kaipu-record/src/main/recording/recording-hub.ts:316-322`, `apps/kaipu-record/src/main/index.ts:166-169`, `apps/kaipu-record/src/main/infrastructure/settings-store.test.ts:106-124`.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 5 | 332 | 5 | reviewed | 9 | $0.35 |

</details>

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · effort high · $0.35</sub>

<!-- wachi:review -->

<!-- agent-review sha=78e20a2530cd0d7eaad647a55b561dee147836bc -->

<!-- wachi:attempt id=e962a75b-bb52-4baa-a36d-5c7cd16352d1 -->

