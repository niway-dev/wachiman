# 482-b2 B-r1

questions: destructive-step, overlapping-calls, bounded-wait, stale-write-back
cost_usd: 0.45977879999999993, turns: 6, terminal: success, duration_ms: 62572

## Summary

Part 2 has two fix-level bugs, both in workspace-settings.ts, and three consider-level notes. I reviewed all six files in this part; the four test files other than settings-overrides.test.ts raised nothing.

1. **Lost write when two edits overlap.** The read, write and record steps for a workspace's folder file are not serialized. If the user changes two overrides in quick succession, the second write can silently drop the first. A `refresh()` running at the same time can also store an older read over the new one, which marks the workspace's overrides as `pending` and switches them off.
2. **Stale settings after a refused or failed write.** `apply()` updates its cache but never calls `changed()` on its refusal or failure paths. Every window keeps the old effective settings until something else triggers a refresh. `resolvePending` re-reads the same way and does call `changed()`, so `apply()` should match it.

The consider-level notes:
- A disconnected workspace cannot have its upload mode changed or reset, even though that value lives on this Mac. "Copy to all workspaces" then lists it as keeping its own value.
- Opening the "All workspaces" scope in Settings checks every workspace one after another. With several slow folders it waits about 2 s or more per workspace.
- The "serializes concurrent updates" test would still pass without the serialization, because its four updates use different ids.

## Findings

### [fix/bug/high] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:224` Two overlapping folder writes to one workspace lose the first change

`applyFolder` reads the folder file (line 224), awaits, builds `next` from that read, then writes the file and the machine record (lines 241-246). Nothing serializes calls for the same workspace: `MachineSettingsStore.update` only queues the machine-file write (settings-overrides.ts:244-260), not the read-modify-write of the folder file. Say the user changes Brand badge and then Copy mode quickly in the Work scope. A reads `{}`, B reads `{}`, A writes `{showBrandBadge}`, and B writes `{screenshotCopy}`. A's override is gone from the file and B's sha becomes the confirmed record. Nothing reports an error. The two awaits on a slow synced folder (up to READ_TIMEOUT_MS each) make that window wide. A `refresh()` in flight at the same time has the same problem: it can store an older read after `applyFolder` set the new one at line 242. The record then names the new sha while the cache holds the old one, so the workspace shows as `pending` and its overrides switch off. Fix: chain `apply`/`resolvePending`/`refresh` for each workspace id on a per-id promise tail, so the read, write and record run as one unit.

### [fix/bug/high] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:200` apply() updates the cache but skips changed() on its refusal and failure paths, so the effective settings stay stale

`applyFolder` always stores a fresh disk read in the cache (line 225), and after a successful file write it stores the new contents (line 242). `apply` returns early on `pending`/`unreadable` (line 200) and on a thrown write (lines 210-213), and none of those paths calls `this.deps.changed()`. The settings store caches `effective` and recomputes it only in `notifyOverridesChanged`/`updateAppSettings` (settings-store.ts:82-84, 232-238). Example: a sync has replaced the active workspace's file, the user then edits an override, and the re-read finds the file `pending`. `activeOverrides()` no longer includes the folder overrides, but every window and main listener keeps the old effective values until something else calls notify. A second case: the file write succeeds but `machine.update` fails (line 243). The cache then holds a file whose sha is not recorded, so the overrides silently drop to `pending` and no broadcast goes out. `resolvePending` re-reads the same way and does call `changed()` on its early returns (lines 277, 282). `apply` should match it: call `changed()` on every return after the cache was touched.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:192` Machine-only uploadMode is refused when the folder is unreachable, and copyToAll lists the workspace as keeping it

`apply` checks `isAvailable` before it looks at which keys it is changing. `uploadMode` lives in `userData/workspace-settings.json` on this Mac (settings-overrides.ts:177-182), so changing or clearing it does not need the folder. As written, a disconnected workspace cannot have its upload mode changed or reset. `copyToAll` then puts it in `keptOwn` even when it overrides no folder key at all. The same thing happens when a `pending` folder refusal (line 200) blocks an `uploadMode` reset included in the same call. You could apply the machine key whether or not the folder is reachable, and check availability only when `folderKeys.length > 0`.

### [consider/perf/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:126` The All scope read waits on every workspace in turn

`getScoped("all")` calls `refresh` once per workspace, one after another. Each refresh awaits `isAvailable` (which has no timeout here) and then a folder read bounded by 2 s. Opening the All scope in Settings can therefore wait about N × (availability + 2 s) when several folders are slow or evicted cloud files. Running the refreshes in parallel (`Promise.all`) would bound the wait by the slowest single workspace.

### [consider/tests/medium] `apps/kaipu-record/src/main/workspaces/settings-overrides.test.ts:244` "serializes concurrent updates" would pass without the serialization

The four updates use different ids. `update` sets the in-memory entry before it writes, and every write dumps the whole map (settings-overrides.ts:246-270). So without the `tail` queue the last write would still contain all four entries and the test would still pass. Two updates to the same id would actually exercise the queue, for example two `update("a", e => ({...e, ...}))` calls that each add a different field, with both fields asserted afterwards.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:218-248`: setOverride / resetOverrides write a folder override
  - failure_mode: No per-workspace lock, so two overlapping writes lose one change. A refusal or a failed write leaves the effective snapshot stale. A file write that succeeds followed by a failed machine.update leaves the file unconfirmed.
  - before_after: Both re-read the disk first. resolvePending calls changed() on every return after the cache was updated; apply does not on its refusals or failures.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:66-81`: Folder read with a timeout
  - failure_mode: Only the read is bounded (2 s). isAvailable has no bound of its own, and getScoped('all') runs one read per workspace in sequence.
  - before_after: 
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/index.ts:114-134`: Wiring into settings-store (setOverridesSource, notifyOverridesChanged)
  - failure_mode: 
  - before_after: notifyOverridesChanged recomputes effective and broadcasts only when the value changed.
  - open_question: 
