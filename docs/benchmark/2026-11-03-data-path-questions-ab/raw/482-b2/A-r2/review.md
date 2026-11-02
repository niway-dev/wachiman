# 482-b2 A-r2

questions: none (arm A engine)
cost_usd: 0.5245736000000001, turns: 7, terminal: success, duration_ms: 70214

## Summary

Part 2 covers the `WorkspaceSettings` service and its tests. Inputs arriving over IPC are validated before they reach the service.

Findings:
- **Fix:** `copyToAll` names every disconnected workspace in `keptOwn`, including ones with no override of the key. It also leaves the machine-bound `uploadMode` of a disconnected workspace uncleared, even though that value lives on this Mac and could be cleared.
- **Consider:**
  - If recording the machine hash fails after the folder file is written, this Mac's own edit becomes `pending` and the workspace's confirmed overrides stop applying, with no broadcast.
  - A slow `refresh` can overwrite a newer cache entry.
  - `copyToAll` broadcasts the settings N+1 times.
  - Two capture-handler tests change prefs only after the handler has returned, so they don't test the "fresh read" their names describe.

## Findings

### [fix/bug/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:322` copyToAll lists every disconnected workspace in keptOwn, even ones with no override of the key

`apply` returns `unavailable` for a disconnected workspace before it looks at anything (line 192), and `copyToAll` then pushes that workspace's name into `keptOwn` with no further check (lines 322-323). Two cases come out wrong:

- **`uploadMode`:** this value is machine-bound and lives in `userData/workspace-settings.json` (`settings-overrides.ts:177-182`). It can be cleared whether or not the folder is connected. Today it is not cleared, so a disconnected workspace keeps its own upload mode after "Copy to all". A workspace that never had an `uploadMode` override is still named as having "kept its own".
- **Folder keys:** the `pending` branch (lines 324-328) already checks whether the file holds one of the keys. The `unavailable` branch never checks `this.deps.machine.get(ws.id).uploadMode` or the last cached read, so it names workspaces with nothing to keep.

The result is a false "kept its own value" message for workspaces that would really inherit the new All value. The only test (`workspace-settings.test.ts:433-443`) covers a disconnected workspace that does hold an override.

Suggested fix: clear the machine-bound `uploadMode` regardless of availability. Name an unavailable workspace only when its machine entry holds `uploadMode`, or when its folder state cannot be known (no cached read, or a cached read that holds the key).

### [consider/bug/high] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:241` A failed machine-record write after the folder write leaves this Mac's own edit pending and deactivates the workspace's confirmed overrides

`applyFolder` writes the folder file and puts the new hash in the cache (lines 241-242) before it records that hash with `machine.update` (lines 243-246). If that update throws, `MachineSettingsStore.update` rolls back its in-memory state (`settings-overrides.ts:250-256`) and `apply` returns `failed` without calling `changed()`.

At that point the folder file's hash no longer matches the recorded one, so `folderState` reports `pending`. Every override the user had confirmed for that workspace stops applying, and the next Settings read asks them to confirm values they just wrote. No broadcast goes out, so windows keep showing the old effective settings until something else triggers `changed()`.

Suggested fix: record the machine entry first, or restore the previous file and cache entry on failure. Either way, call `changed()` on this path.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:92` A slow refresh can overwrite a newer cache entry written by applyFolder or resolvePending

`refresh` awaits `isAvailable` and the file read (which can take up to 2 s), then calls `this.reads.set` unconditionally. Here is a failing sequence:

1. A capture start calls `refreshActiveWorkspaceSettings` and the read begins.
2. While it is in flight, a Settings edit runs `applyFolder`, which writes a new file, caches `{sha: new}` and records `use: new`.
3. The older read resolves and replaces the cache with the old bytes.

The old hash no longer matches the record, so the active workspace's overrides go `pending` (inactive) until the next refresh. A generation counter per id, or skipping the `set` when the cache changed during the await, would close this.

### [consider/perf/high] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:320` copyToAll broadcasts the settings once per workspace, then again at the end

Each successful `resetOverrides` goes through `apply`, which calls `this.deps.changed()` (line 214). That is `notifyOverridesChanged`, which sends the settings to every window and runs the keyed listeners. `copyToAll` then calls `changed()` once more (line 333). With N workspaces this is N+1 broadcasts, and the middle ones carry intermediate states. Consider an internal variant of `apply` that skips the notification, so `copyToAll` notifies only once.

### [consider/tests/high] `apps/kaipu-record/src/main/screenshots/capture-handler.test.ts:532` "not a fresh read" tests change prefs only after the handler has returned

In "the in-memory editor after a failed save gets the policy, not a fresh read", `prefs = { copy: "manual" }` runs after `await handler(...)` has already produced `out`. The assertion therefore cannot tell a start-time read from a later read inside the handler. The same applies to line 547 in "the retained bytes carry the policy…".

To test what the names claim, change `prefs` inside the provider's `capture` or inside the rejecting `saveToVault`, as the switch test at lines 490-495 does.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:304`: Settings → "Copy to all workspaces" (copyToAll) writes the All level, then resets each workspace's override
  - failure_mode: If writeAll throws, the result is failed and nothing has been reset. Disconnected workspaces are named, but their machine-bound uploadMode is not cleared.
  - before_after: Refreshes the source workspace, writes the shown value to All through updateAppSettings, then calls resetOverrides for each workspace. Each successful reset broadcasts; there is one more broadcast at the end.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:218`: setOverride/resetOverrides writes the folder file, then the machine record
  - failure_mode: If the machine.update fails after the folder write, the file stays changed while the record is stale. The state becomes pending, the overrides go inactive, and no broadcast is sent.
  - before_after: Re-reads from disk, refuses when the file is pending or unreadable, writes the file atomically, caches the new read, then records the hash with decision use.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:530-559`: IPC settings:resolve-pending / set-override input checks
  - failure_mode: Bad renderer input returns not-overridable, nothing-pending or invalid; nothing is written.
  - before_after: Checks the type of workspaceId, the key (isOverridableKey), the decision and the sha256 before calling WorkspaceSettings. Values go through normalizeOverride in apply.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:114-134`: Startup wiring: setOverridesSource plus an initial refresh of the active workspace
  - failure_mode: A folder read that times out counts as unreadable, so the overrides stay inactive. If isAvailable rejects, refresh rejects.
  - before_after: Opens the machine store, sets the overrides source, and reads the active folder file. refresh calls changed() when the active overrides differ.
  - open_question: 
