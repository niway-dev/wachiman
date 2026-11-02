# 482-b1 A-r1

questions: none (arm A engine)
cost_usd: 0.6757956, turns: 9, terminal: success, duration_ms: 70749

## Summary

Part 1 reviewed: the preload and shared types, settings-store's effective/All split, capture-policy binding, the workspace-settings wiring and IPC, and the override file store. The IPC handlers check their argument types and validate values before writing. shared/settings-scope.ts uses only type imports.\n\nThree findings:\n- **Fix (medium confidence):** `MachineSettingsStore.open` treats any read error like a missing file. The next write then silently replaces `workspace-settings.json`, losing other workspaces' upload modes and folder-file confirmations.\n- **Consider:** `QuietCapture.policy` and the toast payload's `policy` are written but never read. `openQuietCapture` doesn't forward the policy to the editor.\n- **Consider:** each capture start runs repeated availability probes and folder reads, with up to a 2 s timeout before the overlay appears.\n\nOne contract is still open: whether the switch transaction rolls back when `persistActive` rejects after `setActive` has succeeded.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/settings-overrides.ts:220` A read error other than ENOENT empties the machine store, and the next write overwrites the file

`MachineSettingsStore.open` treats every `readFile` failure (EACCES, EIO, EBUSY…) the same way as a missing file: `catch { return store; }` returns an empty store with `corrupt = false`. The next `update()` (any upload-mode override, any "Use them"/"Ignore" answer) then calls `write()`, which atomically replaces `workspace-settings.json` with only that one entry. Every other workspace's machine-bound `uploadMode` and every recorded folder-file confirmation are lost, with no error and no log. After that, folder files the user had accepted show as `pending` again and their upload consent falls back to the All level.

The JSON-parse branch already protects the file (`corrupt = true` moves it aside before the first write). Do the same for a non-ENOENT read error: return empty only on `ENOENT`, and set `corrupt = true` (or refuse writes) for any other error, so the existing file is kept aside rather than silently replaced.

### [consider/cleanup/high] `apps/kaipu-record/src/main/screenshots/last-quiet-capture.ts:12` `QuietCapture.policy` and `CaptureToastPayload.policy` are stored but nothing reads them

`capture-handler.ts:322` and `:334` attach `policy` to the kept bytes and the toast payload. The docs say the toast's Save and Annotate use it (`screenshot-capture.ts:245`, `:250-253`), but no code reads it. `openQuietCapture` (`main/index.ts:726-734`) forwards only `png, width, height, mode`, so the editor opened from the toast's Annotate gets a blob source without `policy` and falls back to `"manual"` (`screenshot-editor-page.tsx:162`). The toast's Save never reads it either (`capture-toast-window.ts:242-279`). Either forward `policy` in `openQuietCapture`, or drop the fields and correct the comments so they don't claim a guarantee the code doesn't give.

### [consider/perf/medium] `apps/kaipu-record/src/main/screenshots/screenshot-ipc.ts:192` A screenshot capture now probes availability and re-reads the folder file several times

Each `screenshot:capture` first awaits `refreshActiveWorkspaceSettings()` here. That runs a `reg.availability()` probe and a folder read with a timeout of up to 2 s (`workspace-settings.ts:27`, `:94`), all before the overlay appears. Afterwards, the save path calls `requireCaptureWorkspace()` (`screenshot-save.ts:98`/`:117`), which probes availability again and now also calls `refreshActiveWorkspaceSettings()` a second time (`workspaces/index.ts:307`), even though the policy was already bound at capture start. On a slow or evicted synced folder, the hotkey can wait up to ~2 s before the overlay shows, and the save repeats the work. Consider dropping the refresh in `requireCaptureWorkspace` for screenshot saves, or reusing the availability result the refresh just computed.

## Contracts

- **closed** `apps/kaipu-record/src/main/screenshots/screenshot-ipc.ts:189-194`: Screenshot capture re-reads the active workspace's folder settings before the overlay opens
  - failure_mode: A failed read stores `unreadable`, so the overrides are inactive and the All values apply. A rejection is swallowed, and the capture continues with the cached overrides. Worst case, the overlay is delayed by up to the 2 s read timeout.
  - before_after: Before: handleCapture ran directly inside vaultActivity. After: it awaits refresh (an availability probe plus a read with a 2 s timeout), and a failure is swallowed by .catch.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/screenshots/capture-handler.ts:162`: The capture policy is bound at start and travels with the result, the kept bytes and the toast payload
  - failure_mode: If the settings throw, policy is null and the editor opens without copying anything.
  - before_after: The policy is read once and used for decideAfterCapture. It is also attached to QuietCapture and the toast payload.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:525-560`: New settings:* scoped IPC handlers (get-scoped, set-override, reset, copy-to-all, resolve-pending)
  - failure_mode: A write failure returns { ok:false, reason:'failed' }. A handler called before init throws through requireWorkspaceSettings, which rejects the invoke.
  - before_after: Workspace ids, keys and decisions are type-checked. Values are validated in WorkspaceSettings.apply through normalizeOverride.
  - open_question: 
- **open** `apps/kaipu-record/src/main/workspaces/index.ts:402-410`: Workspace switch refreshes the target's overrides in persistActive and notifies after commit
  - failure_mode: refresh never throws on a read failure (read returns `unreadable`). If isAvailable rejects, the rejection propagates into the switch transaction.
  - before_after: After setActive, refresh(target) runs, and afterCommit calls notifyOverridesChanged before refreshTitles and broadcastState.
  - open_question: Does switchWorkspace roll back correctly if persistActive rejects after reg.setActive has already succeeded?
