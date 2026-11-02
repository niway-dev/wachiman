# 482-b1 B-r2

questions: destructive-step, read-error-as-empty, overlapping-calls, stale-write-back
cost_usd: 0.44421340000000004, turns: 4, terminal: success, duration_ms: 47974

## Summary

Part 1 of 6 has one fix-level finding and one to consider. The fix: `MachineSettingsStore.open` treats any read error of `workspace-settings.json` as an empty file, and the next update overwrites it. That silently drops per-workspace upload-mode overrides (upload consent) and folder acceptance records. To consider: `requireCaptureWorkspace` now awaits a settings refresh without the catch its sibling call in `screenshot-ipc.ts` has, so a rejection there would fail a save or a recording start. The preload bridge and IPC handlers check their argument types before passing them on, and value validation happens in `WorkspaceSettings`.

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/workspaces/settings-overrides.ts:220` An unreadable workspace-settings.json opens as empty and is then overwritten, dropping every workspace's upload mode

`MachineSettingsStore.open` returns an empty store for every `readFile` error (line 218-221), not only ENOENT. If `userData/workspace-settings.json` exists but cannot be read at launch (EACCES, EIO, EBUSY), the store starts empty and `corrupt` stays false. The next `update()` for any workspace then runs `write()` (line 263-271), which serializes only what is in memory and atomically replaces the file. That wipes every other workspace's machine-bound `uploadMode` and its `folderOverrides` record.

Effect: a workspace the user set to `local-only` silently inherits the All level again (for example `automatic`), so new files can upload against the user's per-workspace choice. Every accepted folder file also goes back to `pending`. Nothing tells the user.

Fix: treat only ENOENT as empty. For any other error, either refuse writes or set `corrupt = true` so the existing file is renamed aside before it is replaced, as is already done for unparsable JSON. `readFolderOverrides` in the same file already makes this ENOENT/unreadable distinction (line 80-83).

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/index.ts:307` requireCaptureWorkspace now fails a save or recording start if the settings refresh rejects

`refreshActiveWorkspaceSettings()` runs `WorkspaceSettings.refresh`, which awaits `deps.isAvailable` → `reg.availability(id)` without a catch (workspace-settings.ts:94). In `screenshot-ipc.ts:192` the same call has `.catch(() => {})` and a comment saying it must never block a capture. Here it is awaited bare. Its callers are the screenshot save (screenshot-save.ts:98, 117) and the recording start (recording-hub.ts:222). A rejection in this refresh, which only feeds settings, would turn a save or a recording start into an error. A matching `.catch` here would keep the two call sites consistent.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/settings-overrides.ts:215`: MachineSettingsStore.open reads userData/workspace-settings.json; later update() rewrites the whole file from memory
  - failure_mode: EACCES/EIO/EBUSY at launch leads to an empty in-memory store, and the next update overwrites the file. Silent.
  - before_after: readFolderOverrides returns 'absent' only for ENOENT and 'unreadable' otherwise, and it is never written over. open() returns an empty store for any read error, and update() then writes the empty map plus the one change over the file.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/screenshots/screenshot-ipc.ts:192`: Capture IPC refreshes the active workspace's folder overrides before handleCapture
  - failure_mode: The folder read is capped at READ_TIMEOUT_MS. isAvailable has no timeout of its own, and a rejection is swallowed here.
  - before_after: Here the call is caught. refresh() reads the file with a 2 s timeout that turns into 'unreadable', and then calls changed() if the active overrides moved. readPolicy then reads deps.settings() once.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:402`: Switch persistActive refreshes the target's overrides; afterCommit calls notifyOverridesChanged
  - failure_mode: If the read fails, refresh stores 'unreadable', so no folder overrides apply. A refresh rejection from isAvailable would fail persistActive, and with it the switch.
  - before_after: After setActive, the target's file is read into the cache, and afterCommit recomputes the effective settings and broadcasts settings:changed.
  - open_question: 
