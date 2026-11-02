# 482-b1 B-r1

questions: destructive-step, read-error-as-empty, overlapping-calls, stale-write-back
cost_usd: 0.46822640000000004, turns: 6, terminal: success, duration_ms: 61415

## Summary

Part 1 has two findings. (1) `MachineSettingsStore.open` handles every read error as an empty store. The next update then writes the whole map over `workspace-settings.json`, which silently loses every workspace's machine-bound `uploadMode` (upload consent) and its accepted folder-file records. Severity: fix. (2) A question about the switch. `refresh(target)` inside `persistActive` broadcasts the new settings before the switch commits. If it throws there, the registry has already switched but the switch is reported as failed. Severity: consider. The IPC input checks, the capture policy binding and the refresh at capture start look correct.

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/workspaces/settings-overrides.ts:220` An unreadable workspace-settings.json is treated as empty, then overwritten on the next update

`MachineSettingsStore.open` catches every `readFile` error and returns an empty store (lines 218-222). It does not tell ENOENT apart from EACCES/EIO/EBUSY. The next `update()` (lines 244-261) calls `write()`, which serializes the whole in-memory map (lines 268-270) and atomically replaces the file. So one transient read failure at launch, followed by any override edit or Use/Ignore answer, permanently deletes every other workspace's machine-bound `uploadMode` and every accepted folder-file record. This happens with no error or log. Losing `uploadMode` matters: a workspace the user set to `local-only` silently falls back to the All level (for example `automatic`), so files start uploading without consent. Losing the records puts every confirmed folder file back to `pending`. The corrupt-JSON path has a similar gap: if the `rename` aside fails (line 265), that is swallowed and the write goes ahead over the file. Suggested fix: return an empty store only for ENOENT. For any other code, mark the store unusable, so writes refuse or retry, or so it re-reads before the first write. Don't overwrite the file in that state.

### [consider/question/medium] `apps/kaipu-record/src/main/workspaces/index.ts:406` refresh(target) inside persistActive broadcasts before commit, and a throw there leaves the registry switched but the switch reported failed

`reg.setActive(target)` runs first, so `activeId()` is already the target. `WorkspaceSettings.refresh` (workspace-settings.ts:96-98) therefore calls `changed()` → `notifyOverridesChanged()`. That runs every main settings listener and broadcasts `settings:changed` with the target's effective settings while the gate is still closed and windows are still stamped to the old workspace (switch-transaction.ts:70-80). The `notifyOverridesChanged()` in `afterCommit` then does nothing, so the comment 'ready the moment it commits' doesn't hold. Separately, if anything in that refresh throws (`reg.availability` in `isAvailable`, or a settings listener inside `changed()`), `persistActive` rejects after the registry has already persisted the target. switch-transaction.ts:73-76 then reopens the gate on the old workspace and reports failure, while `reg.active()` names the new one. Could the refresh run without notifying (or be caught) inside `persistActive`, with the notification left to `afterCommit` alone?

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/settings-overrides.ts:215`: MachineSettingsStore.open reads userData/workspace-settings.json once and later writes the whole map back
  - failure_mode: Transient EACCES/EIO at launch → empty store → next update overwrites the file, deleting every workspace's entries
  - before_after: open swallows every read error (218-222); update writes the full map (263-271)
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/settings-overrides.ts:244`: MachineSettingsStore.update serializes concurrent updates
  - failure_mode: Write error rejects the caller's promise and memory is restored
  - before_after: Each change runs on a promise tail and reads this.get(id) inside the queued step, so overlapping updates don't drop each other; a failed write restores the previous entry
  - open_question: 
- **closed** `apps/kaipu-record/src/main/screenshots/screenshot-ipc.ts:192`: Capture start re-reads the active workspace's folder overrides before handleCapture
  - failure_mode: Silent; the capture proceeds with the All level values
  - before_after: refresh is raced against a timeout and resolves unreadable on failure (workspace-settings.ts:66-81); the .catch swallows any other throw
  - open_question: 
- **open** `apps/kaipu-record/src/main/workspaces/index.ts:402`: Workspace switch refreshes the target's overrides in persistActive
  - failure_mode: A throw after setActive reopens the old gate while the registry already names the target
  - before_after: setActive then refresh(target); refresh calls changed() since target is now active, before gate.commit
  - open_question: Can reg.availability or a settings listener throw during a switch?
- **closed** `apps/kaipu-record/src/main/screenshots/capture-handler.ts:162`: Capture policy read once at capture start and carried through result/toast/quiet bytes
  - failure_mode: Logged with console.error; no silent copy
  - before_after: readPolicy catches a throw → null → finish returns toEditor (288)
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:525`: New settings-scope IPC handlers validate renderer input
  - failure_mode: Invalid input returns ok:false
  - before_after: Strings and keys are checked with isOverridableKey; values are normalized in WorkspaceSettings.apply via normalizeOverride
  - open_question: 
