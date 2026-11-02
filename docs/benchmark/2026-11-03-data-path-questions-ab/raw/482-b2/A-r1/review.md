# 482-b2 A-r1

questions: none (arm A engine)
cost_usd: 0.6231992000000001, turns: 8, terminal: success, duration_ms: 80271

## Summary

Part 2 has no blockers and nothing at fix level: three consider-level findings, all in `workspace-settings.ts`. I read the six files in full, plus `settings-overrides.ts`, the wiring and IPC handlers in `workspaces/index.ts`, `settings-store.ts`, and the renderer code that calls `copyToAll` / `resetOverrides`.

1. **`uploadMode` can be silently kept (line 199).** When a workspace's folder file is waiting for the user's answer, `apply` returns before it writes an `uploadMode` change made in the same call. `copyToAll` then does not list that workspace among the ones that kept their own value. No page sends that mix of keys today, but the IPC handler accepts any list.
2. **A failed record makes the user's own edit look pending (line 243).** If the folder file is written but saving its hash to the machine file fails, the edit shows as waiting for confirmation and stops applying. Other windows and main listeners are not told until the next change.
3. **Slow "All workspaces" view (line 127).** Opening Settings on "All workspaces" re-reads every workspace one after another, each with up to a 2-second timeout. Several cloud-synced workspaces can add up to a long wait.

The six test files assert what their names say.

## Findings

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:199` A pending folder file blocks the uploadMode reset in the same call, and copyToAll then does not report it

In `apply`, the folder keys are handled first, and when `applyFolder` returns "pending" the function returns right away (line 200), so an `uploadMode` change in the same `changes` is never written. `copyToAll` (lines 324-328) only adds such a workspace to `keptOwn` when the pending file holds one of the wanted keys. `uploadMode` is never in a folder file (settings-overrides.ts:98 reads only FOLDER_OVERRIDE_KEYS), so a call like `copyToAll(id, ["uploadMode", "exportQuality"])` would leave that workspace's machine-bound uploadMode in place and still report success with no name in `keptOwn`. No page sends that mix today: the banners use `["recordingQuality","exportQuality"]`, `["showBrandBadge"]` and `["screenshotCopy"]` (settings-pages.tsx:167,215,405), and the per-row button sends one key. The IPC handler (index.ts:545-549) accepts any list of overridable keys, though. Two possible fixes: write the machine-bound key whatever the folder outcome is, or check `key in read.overrides || key === "uploadMode"` in the pending branch.

### [consider/bug/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:243` If recording the hash fails after the folder write, this Mac's own edit shows as pending

`applyFolder` writes the folder file (line 241), puts the new read in the cache (line 242) and only then records the new sha256 in the machine file (243-246). If `machine.update` throws, `MachineSettingsStore.update` rolls the record back (settings-overrides.ts:253-256). The folder file then holds the new bytes while the record keeps the old hash. `folderState` returns "pending" (settings-overrides.ts:168), so every folder override of the workspace stops applying, and the user is asked to confirm an edit they made themselves. `apply` also returns "failed" without calling `deps.changed()` (lines 210-213), so main listeners and other windows keep the old effective settings until the next notify. Calling `changed()` in the catch would at least resync the snapshot.

### [consider/perf/medium] `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:127` The All-workspaces scoped read refreshes every workspace one after another

`getScoped("all")` awaits `refresh` for each workspace in turn. Each refresh awaits `isAvailable` and then a read that can take up to `READ_TIMEOUT_MS` (2 s) when a file has been evicted (line 27). With several cloud-synced workspaces, opening Settings on "All workspaces" waits roughly N × 2 s. Running the refreshes with `Promise.all` would cap the wait at one timeout.

## Contracts

- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:178`: settings:set-override / reset-overrides write a workspace override
  - failure_mode: A write error returns {ok:false, reason:'failed'} with a console.error. If the folder write succeeds but the machine record fails, the edit is left pending and changed() is not called (reported as a finding).
  - before_after: Validates keys and values, checks availability, re-reads the folder file from disk, refuses pending or unreadable files, writes the file atomically, records the sha256, then calls changed() (notifyOverridesChanged), which recomputes, wakes listeners and broadcasts.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:304`: copyToAll: write the All level, then clear every workspace's override
  - failure_mode: A failed All write returns 'failed' before any reset. A pending folder file skips the uploadMode reset without listing the workspace in keptOwn (reported as a finding).
  - before_after: Refreshes the source workspace, writes the shown values through updateAppSettings, then resets each workspace and collects keptOwn.
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:88`: refresh(id) at app start, on add, on switch and at each capture start
  - failure_mode: A timeout, a rejected read or a disconnected folder all count as unreadable, so the overrides become inactive.
  - before_after: Reads the file, with a 2 s timeout, into the cache. If the active workspace's overrides changed, it calls changed().
  - open_question: 
- **closed** `apps/kaipu-record/src/main/workspaces/workspace-settings.ts:265`: resolvePending: Use them / Ignore
  - failure_mode: A changed file returns 'changed', an absent or unreadable one returns 'nothing-pending', and a machine write error returns 'failed'.
  - before_after: Re-reads the file and compares its sha256 with the one the user saw. Only then does it record the decision and call changed().
  - open_question: 
