# 482-b1 A-r2

questions: none (arm A engine)
cost_usd: 0.5702432, turns: 7, terminal: success, duration_ms: 71363

## Summary

I found nothing that blocks the merge in part 1 and left two "consider" findings. No value imports were added under `src/shared` (`settings-scope.ts` holds only literals and type imports). The five new IPC channels check their argument types, and `WorkspaceSettings` checks each value before anything is written. Moving the settings store's snapshots, broadcasts and listeners to the effective settings is consistent across the file.

1. **Workspace switch (`apps/kaipu-record/src/main/workspaces/index.ts:406`, medium confidence):** the overrides refresh inside `persistActive` runs after the registry has already saved the new active workspace. If that refresh throws, the switch transaction reports a failed switch and reopens the old workspace while the registry already points at the new one. A `.catch` on that refresh would prevent it.
2. **Screenshot capture cost (`apps/kaipu-record/src/main/workspaces/index.ts:307`, high confidence):** one screenshot now checks the folder's availability and reads its settings file more than once. On an evicted file each read can wait up to 2 seconds, so a quiet save can take up to 2 seconds longer.

## Findings

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/index.ts:406` A throw from the overrides refresh fails the switch after the registry already moved

`persistActive` now runs `reg.setActive(target)` and then `workspaceSettings.refresh(target)`. `switchWorkspace` treats any rejection of `persistActive` as a failed persist: it reopens the gate on the old workspace and aborts the windows (`switch-transaction.ts:71-77`). By that point, though, the registry has already stored `target` as active. `refresh` is not fully guarded. Its `read()` catches errors, but `isAvailable` → `reg.availability` (`registry.ts:624`) and `deps.changed()` → `notifyOverridesChanged` are not. `notifyOverridesChanged` runs every settings listener and `webContents.send`. If either one throws, the gate stamp says one workspace and the registry says another. The comment's "a read that fails leaves them inactive" covers only the file read. Wrapping this refresh in a `.catch` (as `screenshot-ipc.ts:192` does) would keep a settings hiccup from turning into a half-done switch.

### [consider/perf/high] `apps/kaipu-record/src/main/workspaces/index.ts:307` Each screenshot now probes availability and reads the folder file several times

`screenshot-ipc.ts:192` refreshes the active workspace's overrides before `handleCapture`. Then the save in `finish` goes through `saveCaptureToWorkspace` → `requireCaptureWorkspace` (`screenshot-save.ts:98/117`), which now calls `refreshActiveWorkspaceSettings()` again. That repeats `reg.availability` right after the probe at line 304 and re-reads `settings.json`. Each read can wait up to `READ_TIMEOUT_MS` (2 s) on an evicted file (`workspace-settings.ts:27`), so a quiet save can be delayed by up to 2 s more. The second read can't change this capture's policy, because it was fixed at the start. Recording start (`recording-hub.ts:222`) reaches the same refresh through `vaultDir`. Consider refreshing only at the start points the ADR names, not inside `requireCaptureWorkspace`.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:402`: Switch persists active id then refreshes the target's folder overrides
  - failure_mode: If refresh rejects (availability or listeners throw), the switch is reported failed while the registry already holds the target as active
  - before_after: switchWorkspace closes the gate, awaits persistActive, and on rejection reopens the gate and aborts the windows; afterCommit now also calls notifyOverridesChanged
  - open_question: 
- **closed** `apps/kaipu-record/src/main/screenshots/screenshot-ipc.ts:189`: Capture start re-reads the active folder overrides and fixes the copy policy
  - failure_mode: The refresh error is swallowed; a read timeout marks the file unreadable, so the overrides are inactive for this capture; the settings throwing gives a null policy and opens the editor with no copy
  - before_after: refresh, then handleCapture reads the workspace, then readPolicy reads getAppSettings().screenshotCopy once
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:525`: New settings-scope IPC handlers
  - failure_mode: Write failures return reason 'failed'; an unknown workspace returns 'unknown-workspace'; an unavailable folder returns 'unavailable'
  - before_after: Argument types are checked, keys go through isOverridableKey, and values are normalized in WorkspaceSettings.apply
  - open_question: 
